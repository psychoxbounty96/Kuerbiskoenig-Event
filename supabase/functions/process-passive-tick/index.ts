import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, json } from "../_shared/cors.ts";

interface PassiveTickInput {
  eventId: string;
  streamerId: string;
  viewerCount: number;
  timestamp: string;
  idempotencyKey: string;
}

async function processPassiveTick(input: PassiveTickInput) {
  // Contract placeholder only: balancing and viewer ingestion are intentionally absent in v0.2.
  void input;
  return { appliedDamage: 0, enabled: false };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (Deno.env.get("PASSIVE_TICK_ENABLED") !== "true") {
    return json({ ok: false, error: "passive_tick_disabled_by_default" }, 503);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("Authorization") ?? "";
  if (!url || !key || authorization !== `Bearer ${key}`) return json({ ok: false, error: "unauthorized" }, 401);

  const service = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await service.rpc("expire_stale_minions", { p_event_id: null });
  if (error) return json({ ok: false, error: error.message }, 400);

  const placeholder = await processPassiveTick({
    eventId: "disabled",
    streamerId: "disabled",
    viewerCount: 0,
    timestamp: new Date().toISOString(),
    idempotencyKey: "disabled-placeholder",
  });

  // v0.2 intentionally performs no passive boss damage. A later scheduler can
  // call apply_boss_damage with deterministic idempotency keys after balancing.
  return json({ ok: true, expiredMinions: data, passiveDamageApplied: placeholder.appliedDamage });
});
