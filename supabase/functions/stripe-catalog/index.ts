// ArcNode Admin — Stripe Catalog Edge Function
// ==============================================
// Returns the active Stripe product catalog (one row per active price) for
// the BOM builder. Keeps the Stripe secret key server-side.
//
// Deploy: supabase functions deploy stripe-catalog --project-ref agpsalkaajjivoytcipb
// Secret:  supabase secrets set STRIPE_SECRET_KEY=rk_live_... --project-ref agpsalkaajjivoytcipb
//          (a restricted key with read-only Products + Prices access is enough)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

// Pages through /v1/prices (active only, product expanded).
async function listActivePrices(stripeKey: string) {
  const prices: any[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ active: "true", limit: "100" });
    params.append("expand[]", "data.product");
    if (startingAfter) params.set("starting_after", startingAfter);
    const res = await fetch(`https://api.stripe.com/v1/prices?${params}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || `Stripe error ${res.status}`);
    prices.push(...body.data);
    if (!body.has_more || body.data.length === 0) break;
    startingAfter = body.data[body.data.length - 1].id;
  }
  return prices;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Invalid token" }, 401);

    // ArcNode staff only — company admins don't see our pricing.
    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("is_admin")
      .eq("id", callerData.user.id)
      .single();
    if (callerProfile?.is_admin !== true) return json({ error: "Super admin access required" }, 403);

    if (jwtAal(authHeader) !== "aal2") {
      return json({ error: "Two-factor authentication required" }, 403);
    }

    const prices = await listActivePrices(stripeKey);

    const items = prices
      .filter((p) => p.product && typeof p.product === "object" && p.product.active && !p.product.deleted)
      .map((p) => ({
        price_id: p.id,
        product_id: p.product.id,
        name: p.product.name,
        description: p.product.description || "",
        sku: p.product.metadata?.sku || p.metadata?.sku || "",
        nickname: p.nickname || "",
        currency: p.currency,
        // null for tiered / customer-chooses prices — the builder lets you type one in.
        unit_amount: p.unit_amount,
        interval: p.recurring?.interval || null,
        interval_count: p.recurring?.interval_count || 1,
        is_default: p.product.default_price === p.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || Number(b.is_default) - Number(a.is_default));

    return json({ items });
  } catch (e) {
    console.error("stripe-catalog error:", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});
