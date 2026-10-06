-- Trip routes not showing in ArcAdmin: let admins read trip_points.
-- Run in the Supabase SQL editor.
--
-- Symptom: the Trips tab lists trips, but clicking one draws no route. The
-- row fetch (`trips`) succeeds for admins because its SELECT policy grants
-- "own" OR profiles.is_admin, but the breadcrumb fetch (`trip_points`) only
-- grants the trip's owner — so PostgREST returns [] (RLS filters silently,
-- no 403) and the map stays empty. ArcAdmin now shows "N recorded GPS points,
-- but none were returned to this account" in that case; this migration is
-- the fix for it.
--
-- ── 1. Diagnose first (read-only) ──────────────────────────────────────────
-- Policies currently on the two tables:
--   select tablename, policyname, cmd, roles, qual
--   from pg_policies where tablename in ('trips', 'trip_points')
--   order by tablename, policyname;
--
-- Trips whose summary says points exist — the RLS case if the map is empty:
--   select t.id, t.source, t.started_at, t.point_count,
--          (select count(*) from trip_points p where p.trip_id = t.id) as stored
--   from trips t order by t.started_at desc limit 20;
--
-- Trips with NO stored points at all — a recorder/ingest problem, not RLS.
-- (Cerbo trips: ingest-trip-gps creates the trip stub BEFORE inserting points,
-- so a failed points insert leaves exactly this shape — a trip with no route.)
--   select t.id, t.source, t.started_at, t.point_count, t.distance_km
--   from trips t
--   where not exists (select 1 from trip_points p where p.trip_id = t.id)
--   order by t.started_at desc;
--
-- ── 2. Fix: admin read policy on trip_points (mirrors the trips policy) ────
-- profiles.is_admin is the super-admin flag ArcAdmin already keys on.

alter table trip_points enable row level security;

drop policy if exists "trip_points_admin_read" on trip_points;
create policy "trip_points_admin_read"
  on trip_points
  for select
  to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- Owners keep reading their own breadcrumbs (no-op if an equivalent policy
-- already exists — PostgreSQL ORs SELECT policies together).
drop policy if exists "trip_points_owner_read" on trip_points;
create policy "trip_points_owner_read"
  on trip_points
  for select
  to authenticated
  using (
    exists (
      select 1 from trips t
      where t.id = trip_points.trip_id and t.user_id = auth.uid()
    )
  );

-- ── 3. Verify ──────────────────────────────────────────────────────────────
-- As an admin user (Supabase SQL editor → "Run as" a user, or just reload
-- ArcAdmin and click a trip): the route should draw and the status line read
-- "<N> GPS points".
--
-- Company admins: not covered here. `trips` itself only grants own + is_admin
-- today (see TESTING_TRIPS.md); when the company-scoped trips policy is added,
-- add the matching trip_points policy alongside it.
