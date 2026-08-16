import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function slug(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "function_not_configured" }, 503);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!constantTimeEqual(authorization, `Bearer ${SERVICE_ROLE_KEY}`)) {
    return json({ ok: false, error: "service_role_authorization_required" }, 401);
  }

  let currentEventId: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { eventSlug?: unknown };
    const eventSlug = slug(body.eventSlug);
    if (body.eventSlug && !eventSlug) return json({ ok: false, error: "invalid_event_slug" }, 400);

    let query = service.from("events").select("id,slug").in("status", ["testing", "active", "paused"]);
    if (eventSlug) query = query.eq("slug", eventSlug);
    const { data: events, error: eventsError } = await query;
    if (eventsError) throw eventsError;
    if (!events?.length) return json({ ok: false, error: "event_not_found" }, 404);

    const now = new Date();
    const results = [];
    for (const event of events) {
      currentEventId = event.id;
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id,
        p_job_key: "passive_damage_tick",
        p_status: "running",
        p_error: null,
        p_next_expected_at: null,
        p_metadata: { source: "edge_function" },
      });
      const { data, error } = await service.rpc("process_passive_damage_tick", {
        p_event_id: event.id,
        p_now: now.toISOString(),
      });
      if (error) throw error;
      results.push({ eventSlug: event.slug, ...data });
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id,
        p_job_key: "passive_damage_tick",
        p_status: "healthy",
        p_error: null,
        p_next_expected_at: new Date(now.getTime() + 120_000).toISOString(),
        p_metadata: data ?? {},
      });
    }
    currentEventId = null;
    return json({ ok: true, message: "Passive Ticks serverseitig verarbeitet.", data: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "passive_tick_failed";
    if (currentEventId) {
      await service.rpc("mark_event_job_status", {
        p_event_id: currentEventId,
        p_job_key: "passive_damage_tick",
        p_status: "error",
        p_error: message,
        p_next_expected_at: new Date(Date.now() + 120_000).toISOString(),
        p_metadata: {},
      });
    }
    return json({ ok: false, error: message }, 400);
  }
});
