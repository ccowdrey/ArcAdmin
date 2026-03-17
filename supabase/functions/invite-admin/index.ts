// ArcNode Admin — Invite Admin Edge Function
// =============================================
// Invites a new user via Supabase Auth admin API
// Keeps the service_role key server-side
//
// Deploy: supabase functions deploy invite-admin
// Set secret: supabase secrets set SERVICE_ROLE_KEY=your_key_here

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, first_name, last_name } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client with service_role key (from secrets)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Invite the user — sends them an email with a "Set your password" link
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        first_name: first_name || "",
        last_name: last_name || "",
      },
    });

    if (error) {
      console.error("Invite error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = data.user?.id;

    // Update profile with name if the trigger created the row
    if (userId && (first_name || last_name)) {
      // Small delay for the auth trigger to create the profile row
      await new Promise((r) => setTimeout(r, 1500));

      await supabaseAdmin
        .from("profiles")
        .update({ first_name: first_name || null, last_name: last_name || null })
        .eq("id", userId);
    }

    return new Response(
      JSON.stringify({ user_id: userId, email: data.user?.email }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Unexpected error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
