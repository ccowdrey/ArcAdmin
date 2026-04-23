// sync-scenes/index.ts
// ArcNode — Scene Sync Edge Function
//
// Handles scene sync between iPad (writer) and iPhone (reader).
//
// POST /sync-scenes  — Upsert all scenes for a vehicle (iPad calls this on save)
//   Body: { vehicle_id: string, scenes: SceneData[] }
//   Returns: { synced: number }
//
// GET /sync-scenes?vehicle_id=UUID  — Fetch all scenes for a vehicle (iPhone reads)
//   Returns: SceneData[] (the scene_data JSONB column, decoded)
//
// Deploy:
//   cd ~/Desktop/ArcOS-iPad/arcos-admin
//   npx supabase functions deploy sync-scenes --no-verify-jwt --project-ref agpsalkaajjivoytcipb
//

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Get auth user from JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify the user's JWT to get their ID
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // ── GET: Fetch scenes for a vehicle ──────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const vehicleId = url.searchParams.get("vehicle_id");

      if (!vehicleId) {
        return new Response(
          JSON.stringify({ error: "vehicle_id required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data, error } = await supabase
        .from("scenes")
        .select("scene_data")
        .eq("vehicle_id", vehicleId)
        .eq("user_id", userId)
        .order("name", { ascending: true });

      if (error) {
        console.error("Fetch scenes error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Return the scene_data JSONB directly — matches SceneData Codable format
      const scenes = (data || []).map((row: any) => row.scene_data);

      return new Response(JSON.stringify(scenes), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST: Upsert scenes from iPad ────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      const { vehicle_id, scenes } = body;

      if (!vehicle_id || !Array.isArray(scenes)) {
        return new Response(
          JSON.stringify({ error: "vehicle_id and scenes[] required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Get current scene IDs in DB for this vehicle
      const { data: existing } = await supabase
        .from("scenes")
        .select("id")
        .eq("vehicle_id", vehicle_id)
        .eq("user_id", userId);

      const existingIds = new Set((existing || []).map((r: any) => r.id));
      const incomingIds = new Set(scenes.map((s: any) => s.id));

      // Delete scenes that were removed on iPad
      const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
      if (toDelete.length > 0) {
        await supabase
          .from("scenes")
          .delete()
          .in("id", toDelete)
          .eq("user_id", userId);
      }

      // Upsert all incoming scenes
      const rows = scenes.map((scene: any) => ({
        id: scene.id,
        vehicle_id,
        user_id: userId,
        name: scene.name || "",
        scene_data: scene, // Store full SceneData as JSONB
        add_to_dashboard: scene.addToDashboard || false,
        is_active: scene.isActive || false,
      }));

      const { error } = await supabase
        .from("scenes")
        .upsert(rows, { onConflict: "id" });

      if (error) {
        console.error("Upsert scenes error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(
        `Synced ${scenes.length} scenes for vehicle ${vehicle_id} (deleted ${toDelete.length})`
      );

      return new Response(
        JSON.stringify({
          synced: scenes.length,
          deleted: toDelete.length,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sync-scenes error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
