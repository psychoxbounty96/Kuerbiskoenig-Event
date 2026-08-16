import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { json } from "../_shared/cors.ts";
import { constantTimeEqual } from "../_shared/twitch-domain.ts";
import { syncTwitchStreams, twitchClientFromEnvironment } from "../_shared/twitch-service.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "function_not_configured" }, 503);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!constantTimeEqual(authorization, `Bearer ${SERVICE_ROLE_KEY}`)) {
    return json({ ok: false, error: "service_role_authorization_required" }, 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { eventSlug?: string };
    let query = service.from("events").select("id,slug,event_settings!inner(twitch_tracking_enabled)").in("status", ["testing", "active", "paused"]);
    if (body.eventSlug) query = query.eq("slug", body.eventSlug);
    const { data: events, error } = await query;
    if (error) throw error;
    const syncableEvents = (events ?? []).filter((event) => {
      const settings = Array.isArray(event.event_settings) ? event.event_settings[0] : event.event_settings;
      return settings?.twitch_tracking_enabled !== false;
    });
    if (!syncableEvents.length) return json({ ok: false, error: "no_syncable_events" }, 404);

    const twitch = twitchClientFromEnvironment();
    const results = [];
    for (const event of syncableEvents) {
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id, p_job_key: "twitch_sync", p_status: "running",
        p_error: null, p_next_expected_at: null, p_metadata: { source: "edge_function" },
      });
      try {
        const result = await syncTwitchStreams(service, twitch, event.id);
        results.push({ eventSlug: event.slug, ...result });
        await service.rpc("mark_event_job_status", {
          p_event_id: event.id, p_job_key: "twitch_sync", p_status: "healthy",
          p_error: null, p_next_expected_at: new Date(Date.now() + 120_000).toISOString(), p_metadata: result,
        });
      } catch (error) {
        await service.rpc("mark_event_job_status", {
          p_event_id: event.id, p_job_key: "twitch_sync", p_status: "error",
          p_error: error instanceof Error ? error.message : "twitch_sync_failed",
          p_next_expected_at: new Date(Date.now() + 120_000).toISOString(), p_metadata: {},
        });
        throw error;
      }
    }
    return json({ ok: true, message: "Twitch Stream-Sync abgeschlossen; kein Boss-Schaden ausgelöst.", data: results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "twitch_sync_failed" }, 502);
  }
});
