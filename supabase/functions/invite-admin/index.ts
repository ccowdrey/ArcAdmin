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

// Reads the `aal` claim from the caller's JWT. Only call after
// auth.getUser() has validated the token with the auth server.
function jwtAal(authHeader: string): string {
  try {
    const part = authHeader.replace(/^Bearer\s+/i, "").split(".")[1]
      .replace(/-/g, "+").replace(/_/g, "/");
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(padded)).aal ?? "aal1";
  } catch {
    return "aal1";
  }
}

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Only signed-in admins with a two-factor (AAL2) session may invite.
    // Without this, anyone holding the public anon key could create accounts.
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (jwtAal(authHeader) !== "aal2") {
      return new Response(
        JSON.stringify({ error: "Two-factor authentication required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("is_admin")
      .eq("id", callerData.user.id)
      .single();

    const { data: companyAdmin } = await callerClient
      .from("company_admins")
      .select("role")
      .eq("user_id", callerData.user.id)
      .limit(1);

    const isSuper = callerProfile?.is_admin === true;
    const isCompanyAdmin = companyAdmin && companyAdmin.length > 0;

    if (!isSuper && !isCompanyAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client with service_role key (from secrets)

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
      redirectTo: "https://admin.arcnode.app",
    });

    // Re-inviting someone whose invite link was already opened (often by an
    // email security scanner) fails with "already registered", because
    // opening the link confirms the account even though no password was set.
    // For invited users, send a set-password email instead so they can finish.
    if (error && /already (been )?registered|email_exists/i.test(`${error.message} ${(error as any).code ?? ""}`)) {
      const { data: prof } = await supabaseAdmin
        .from("profiles").select("id").ilike("email", email).limit(1);
      const existingId = prof?.[0]?.id;
      const { data: existing } = existingId
        ? await supabaseAdmin.auth.admin.getUserById(existingId)
        : { data: null };
      if (existing?.user?.invited_at) {
        const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
          redirectTo: "https://admin.arcnode.app",
        });
        if (!resetError) {
          return new Response(
            JSON.stringify({ user_id: existing.user.id, email: existing.user.email, resent: "set_password" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.error("Re-invite (recovery) error:", resetError);
      }
    }

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
