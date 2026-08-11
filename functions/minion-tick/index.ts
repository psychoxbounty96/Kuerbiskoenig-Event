import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "function_not_configured" }, 503);
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization !== `Bearer ${SERVICE_ROLE_KEY}`) return json({ ok: false, error: "service_role_required" }, 401);
  try {
    const body = await request.json().catch(() => ({})) as { eventId?: string };
    const { data, error } = await service.rpc("process_minion_tick", { p_event_id: body.eventId || null });
    if (error) throw error;
    return json({ ok: true, data });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "minion_tick_failed" }, 400);
  }
});
