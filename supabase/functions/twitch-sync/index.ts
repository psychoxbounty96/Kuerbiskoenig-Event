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
    let query = service.from("events").select("id,slug").in("status", ["testing", "active", "paused"]);
    if (body.eventSlug) query = query.eq("slug", body.eventSlug);
    const { data: events, error } = await query;
    if (error) throw error;
    if (!events?.length) return json({ ok: false, error: "no_syncable_events" }, 404);

    const twitch = twitchClientFromEnvironment();
    const results = [];
    for (const event of events) {
      results.push({ eventSlug: event.slug, ...(await syncTwitchStreams(service, twitch, event.id)) });
    }
    return json({ ok: true, message: "Twitch Stream-Sync abgeschlossen; kein Boss-Schaden ausgelöst.", data: results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "twitch_sync_failed" }, 502);
  }
});
