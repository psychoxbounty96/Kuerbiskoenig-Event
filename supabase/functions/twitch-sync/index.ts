import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { json } from "../_shared/cors.ts";
import { constantTimeEqual } from "../_shared/twitch-domain.ts";
import {
  safeTwitchError,
  syncEventSubSubscriptions,
  syncTwitchStreams,
  twitchClientFromEnvironment,
} from "../_shared/twitch-service.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TWITCH_SYNC_CRON_SECRET = Deno.env.get("TWITCH_SYNC_CRON_SECRET") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "function_not_configured" }, 503);
  const authorization = request.headers.get("Authorization") ?? "";
  const serviceAuthorized = constantTimeEqual(authorization, `Bearer ${SERVICE_ROLE_KEY}`);
  const cronAuthorized = TWITCH_SYNC_CRON_SECRET.length >= 32
    && constantTimeEqual(authorization, `Bearer ${TWITCH_SYNC_CRON_SECRET}`);
  if (!serviceAuthorized && !cronAuthorized) {
    return json({ ok: false, error: "service_role_authorization_required" }, 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      eventSlug?: string;
      operation?: "streams" | "eventsub";
    };
    const operation = body.operation ?? "streams";
    if (!(["streams", "eventsub"] as string[]).includes(operation)) {
      return json({ ok: false, error: "unsupported_operation" }, 400);
    }
    let query = service.from("events").select("id,slug,event_settings!inner(twitch_tracking_enabled)").in("status", ["testing", "active", "paused"]);
    if (body.eventSlug && operation === "streams") query = query.eq("slug", body.eventSlug);
    const { data: events, error } = await query;
    if (error) throw error;
    const syncableEvents = (events ?? []).filter((event) => {
      const settings = Array.isArray(event.event_settings) ? event.event_settings[0] : event.event_settings;
      return settings?.twitch_tracking_enabled !== false;
    });
    if (!syncableEvents.length) return json({ ok: false, error: "no_syncable_events" }, 404);

    const twitch = twitchClientFromEnvironment();
    if (operation === "eventsub") {
      for (const event of syncableEvents) {
        await service.rpc("mark_event_job_status", {
          p_event_id: event.id, p_job_key: "eventsub_sync", p_status: "running",
          p_error: null, p_next_expected_at: null, p_metadata: { source: "service_endpoint" },
        });
      }
      try {
        const result = await syncEventSubSubscriptions(
          service,
          twitch,
          Deno.env.get("TWITCH_EVENTSUB_CALLBACK_URL") ?? "",
          Deno.env.get("TWITCH_EVENTSUB_SECRET") ?? "",
        );
        for (const event of syncableEvents) {
          await service.rpc("mark_event_job_status", {
            p_event_id: event.id, p_job_key: "eventsub_sync", p_status: "healthy",
            p_error: null, p_next_expected_at: null, p_metadata: { source: "service_endpoint", ...result },
          });
        }
        return json({ ok: true, message: "Twitch EventSub-Subscriptions synchronisiert.", data: result });
      } catch (error) {
        const detail = safeTwitchError(error, "eventsub_sync_failed");
        for (const event of syncableEvents) {
          await service.rpc("mark_event_job_status", {
            p_event_id: event.id, p_job_key: "eventsub_sync", p_status: "error",
            p_error: detail, p_next_expected_at: null, p_metadata: { source: "service_endpoint" },
          });
        }
        throw error;
      }
    }

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
        const detail = safeTwitchError(error, "twitch_sync_failed");
        await service.rpc("mark_event_job_status", {
          p_event_id: event.id, p_job_key: "twitch_sync", p_status: "error",
          p_error: detail,
          p_next_expected_at: new Date(Date.now() + 120_000).toISOString(), p_metadata: {},
        });
        throw error;
      }
    }
    return json({ ok: true, message: "Twitch Stream-Sync abgeschlossen; kein Boss-Schaden ausgelöst.", data: results });
  } catch (error) {
    return json({ ok: false, error: safeTwitchError(error, "twitch_sync_failed") }, 502);
  }
});
