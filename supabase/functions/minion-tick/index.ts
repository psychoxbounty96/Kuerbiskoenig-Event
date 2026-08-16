import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "function_not_configured" }, 503);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!constantTimeEqual(authorization, `Bearer ${SERVICE_ROLE_KEY}`)) return json({ ok: false, error: "service_role_required" }, 401);
  let currentEventId: string | null = null;
  try {
    const body = await request.json().catch(() => ({})) as { eventId?: string };
    let query = service.from("events").select("id,slug").in("status", ["testing", "active", "paused"]);
    if (body.eventId) query = query.eq("id", body.eventId);
    const { data: events, error: eventsError } = await query;
    if (eventsError) throw eventsError;
    if (!events?.length) return json({ ok: false, error: "event_not_found" }, 404);
    const results = [];
    for (const event of events) {
      currentEventId = event.id;
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id, p_job_key: "minion_tick", p_status: "running",
        p_error: null, p_next_expected_at: null, p_metadata: { source: "edge_function" },
      });
      const { data, error } = await service.rpc("process_minion_tick", { p_event_id: event.id });
      if (error) throw error;
      results.push({ eventSlug: event.slug, ...data });
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id, p_job_key: "minion_tick", p_status: "healthy",
        p_error: null, p_next_expected_at: new Date(Date.now() + 10_000).toISOString(), p_metadata: data ?? {},
      });
    }
    currentEventId = null;
    return json({ ok: true, data: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "minion_tick_failed";
    if (currentEventId) await service.rpc("mark_event_job_status", {
      p_event_id: currentEventId, p_job_key: "minion_tick", p_status: "error",
      p_error: message, p_next_expected_at: new Date(Date.now() + 10_000).toISOString(), p_metadata: {},
    });
    return json({ ok: false, error: message }, 400);
  }
});
