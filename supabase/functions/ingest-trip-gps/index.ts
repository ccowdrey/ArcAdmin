// ingest-trip-gps
// ===============
// Receives GPS breadcrumb batches from the Cerbo's arcnode-gps-tracker daemon
// and assembles them into trips/trip_points — the iPad-independent capture path.
//
// Auth: per-vehicle `x-api-key` header validated against vehicles.cerbo_api_key
// (same key the Cerbo relay uses for live status). Deploy with verify_jwt=false
// so the Cerbo's api-key auth is honored instead of a Supabase JWT.
//
// The Cerbo streams batches tagged with a stable trip_id + started_at while a
// trip is in progress (and a final ended=true batch). We upsert idempotently:
// points on (trip_id, timestamp), the trip on id — so re-sent batches and
// retries never duplicate. The trip summary is recomputed from all of its
// points on every batch, so it's always authoritative.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MIN_TRIP_SECONDS = 120; // discard trips shorter than 2 min (matches iPad)
const MIN_TRIP_POINTS = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// deno-lint-ignore no-explicit-any
function summarize(points: any[]) {
  const pts = points.filter((p) => p.latitude != null && p.longitude != null);
  if (pts.length === 0) {
    return {
      distance_km: 0, duration_seconds: 0, point_count: 0,
      avg_speed_kmh: 0, max_speed_kmh: 0,
      start_lat: null, start_lng: null, end_lat: null, end_lng: null,
    };
  }
  let distKm = 0;
  for (let i = 1; i < pts.length; i++) {
    distKm += haversineKm(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
  }
  const first = pts[0], last = pts[pts.length - 1];
  const durationSec = Math.max(0, Math.round((Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 1000));
  const speeds = pts.map((p) => (typeof p.speed === "number" ? p.speed : 0)).filter((s) => s > 0); // m/s
  const avgMs = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const maxMs = pts.reduce((m, p) => Math.max(m, typeof p.speed === "number" ? p.speed : 0), 0);
  return {
    distance_km: +distKm.toFixed(2),
    duration_seconds: durationSec,
    point_count: pts.length,
    avg_speed_kmh: +(avgMs * 3.6).toFixed(1),
    max_speed_kmh: +(maxMs * 3.6).toFixed(1),
    start_lat: first.latitude, start_lng: first.longitude,
    end_lat: last.latitude, end_lng: last.longitude,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const apiKey = req.headers.get("x-api-key") || "";
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const vehicleId = String(body.vehicle_id || "");
  const tripId = String(body.trip_id || "");
  const startedAt = String(body.started_at || "");
  const ended = body.ended === true;
  const source = String(body.source || "cerbo_relay");
  const points = Array.isArray(body.points) ? body.points : [];

  if (!vehicleId || !tripId || !startedAt) {
    return json({ error: "vehicle_id, trip_id, started_at required" }, 400);
  }
  if (!apiKey) return json({ error: "missing x-api-key" }, 401);

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Auth: validate the per-vehicle Cerbo API key ──
  const { data: veh, error: vErr } = await supa
    .from("vehicles")
    .select("id, user_id, cerbo_api_key")
    .eq("id", vehicleId)
    .maybeSingle();
  if (vErr) return json({ error: "vehicle lookup failed" }, 500);
  if (!veh || !veh.cerbo_api_key || veh.cerbo_api_key !== apiKey) {
    return json({ error: "unauthorized" }, 401);
  }

  // ── Ensure the parent trip row exists BEFORE inserting points ──
  // trip_points.trip_id is a FK to trips.id, so the trip must exist first.
  // We create/patch a stub here and fill in the summary + ended_at below.
  const { error: stubErr } = await supa.from("trips").upsert(
    { id: tripId, user_id: veh.user_id, vehicle_id: vehicleId, started_at: startedAt, source },
    { onConflict: "id" },
  );
  if (stubErr) return json({ error: "trip create failed", detail: stubErr.message }, 500);

  // ── Insert breadcrumbs (idempotent on trip_id + timestamp) ──
  // deno-lint-ignore no-explicit-any
  const pointRows = (points as any[])
    .filter((p) => p && p.latitude != null && p.longitude != null && p.timestamp)
    .map((p) => ({
      trip_id: tripId,
      timestamp: p.timestamp,
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speed ?? null,
      altitude: p.altitude ?? null,
      heading: p.heading ?? null,
      source,
    }));

  if (pointRows.length) {
    const { error: pErr } = await supa
      .from("trip_points")
      .upsert(pointRows, { onConflict: "trip_id,timestamp", ignoreDuplicates: true });
    if (pErr) return json({ error: "points insert failed", detail: pErr.message }, 500);
  }

  // ── Recompute the trip summary from ALL of its points (authoritative) ──
  // PostgREST caps a single response at the project's max-rows (1000 by
  // default), so we MUST page through — otherwise a trip longer than 1000
  // points (~2.5–4 h) would freeze its summary at the 1000th point. Recomputing
  // from all points keeps this idempotent against batch retries.
  const PAGE = 1000;
  // deno-lint-ignore no-explicit-any
  const allPts: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("trip_points")
      .select("timestamp, latitude, longitude, speed")
      .eq("trip_id", tripId)
      .order("timestamp", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return json({ error: "summary read failed", detail: error.message }, 500);
    if (!data || data.length === 0) break;
    allPts.push(...data);
    if (data.length < PAGE) break;
  }

  const summary = summarize(allPts);

  // On trip end, discard trips too short to be meaningful (matches the iPad).
  if (ended && (summary.duration_seconds < MIN_TRIP_SECONDS || summary.point_count < MIN_TRIP_POINTS)) {
    await supa.from("trip_points").delete().eq("trip_id", tripId);
    await supa.from("trips").delete().eq("id", tripId);
    return json({ ok: true, discarded: true, reason: "below minimum duration/points" });
  }

  const tripRow = {
    id: tripId,
    user_id: veh.user_id,
    vehicle_id: vehicleId,
    started_at: startedAt,
    ended_at: ended ? new Date().toISOString() : null,
    source,
    ...summary,
  };
  const { error: tErr } = await supa.from("trips").upsert(tripRow, { onConflict: "id" });
  if (tErr) return json({ error: "trip upsert failed", detail: tErr.message }, 500);

  return json({
    ok: true,
    trip_id: tripId,
    inserted: pointRows.length,
    total_points: (allPts || []).length,
    ended,
  });
});
