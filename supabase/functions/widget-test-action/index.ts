import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

type Body = Record<string, unknown> & {
  action?: string;
  eventSlug?: string;
  channelUsername?: string;
  requestId?: string;
  definitionKey?: string;
  effectKey?: string;
  phaseId?: number;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALLOWED_ACTIONS = new Set([
  "reload_state", "tick", "test_boss_hit", "test_boss_big_hit", "reset_test_boss",
  "test_passive_tick",
  "set_phase", "spawn_minion", "test_effect", "spawn_raid_special_now",
  "force_minion_success", "force_minion_failure", "cancel_minion", "expire_minion",
  "simulate_eligible_raid", "create_test_viewer_sample",
]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedLogin(value: unknown) {
  const login = text(value).toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(login) ? login : "";
}

function normalizedSlug(value: unknown) {
  const slug = text(value).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

function normalizedDefinitionKey(value: unknown) {
  const key = text(value).toLowerCase();
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(key) ? key : "";
}

function forbiddenAuthorityFields(body: Body) {
  return ["damage", "amount", "hp", "currentHp", "current_hp", "success", "resolution", "streamerId", "eventId"]
    .some((key) => Object.hasOwn(body, key));
}

async function currentMinion(eventId: string, streamerId: string) {
  const { data, error } = await service.from("minion_events")
    .select("id,status")
    .eq("event_id", eventId)
    .eq("streamer_id", streamerId)
    .in("status", ["scheduled", "intro", "active", "success", "failure", "curse"])
    .order("spawned_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "function_not_configured" }, 503);

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > 4096) return json({ ok: false, error: "payload_too_large" }, 413);

  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ ok: false, error: "payload_too_large" }, 413);
    const body = JSON.parse(raw) as Body;
    if (forbiddenAuthorityFields(body)) return json({ ok: false, error: "client_authority_forbidden" }, 400);

    const action = text(body.action);
    const eventSlug = normalizedSlug(body.eventSlug);
    const channelUsername = normalizedLogin(body.channelUsername);
    const requestId = text(body.requestId) || crypto.randomUUID();
    if (!ALLOWED_ACTIONS.has(action) || !eventSlug || !channelUsername || requestId.length > 160) {
      return json({ ok: false, error: "invalid_test_action" }, 400);
    }

    const { data: event, error: eventError } = await service.from("events")
      .select("id,slug,status")
      .eq("slug", eventSlug)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event || event.status !== "testing") return json({ ok: false, error: "test_event_required" }, 403);

    const { data: streamer, error: streamerError } = await service.from("streamers")
      .select("id,event_id,twitch_login,twitch_user_id,enabled,is_test_account,tracking_enabled,gameplay_enabled")
      .eq("event_id", event.id)
      .eq("twitch_login", channelUsername)
      .maybeSingle();
    if (streamerError) throw streamerError;
    if (!streamer?.enabled || !streamer.gameplay_enabled || !streamer.is_test_account) {
      return json({ ok: false, error: "test_account_required" }, 403);
    }

    if (action !== "tick") {
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { count, error: rateError } = await service.from("widget_test_action_log")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("streamer_id", streamer.id)
        .gte("created_at", oneMinuteAgo);
      if (rateError) throw rateError;
      if ((count ?? 0) >= 30) return json({ ok: false, error: "test_action_rate_limited" }, 429);

      const { error: logError } = await service.from("widget_test_action_log").insert({
        event_id: event.id,
        streamer_id: streamer.id,
        action,
        request_id: requestId,
        metadata: {
          source: "streamelements_widget",
          definition_key: normalizedDefinitionKey(body.definitionKey) || null,
          effect_key: normalizedDefinitionKey(body.effectKey) || null,
          phase_id: Number.isInteger(Number(body.phaseId)) ? Number(body.phaseId) : null,
        },
      });
      if (logError?.code === "23505") return json({ ok: true, message: "Testaktion bereits verarbeitet.", data: { idempotent: true } });
      if (logError) throw logError;
    }

    let result: unknown = null;

    if (action === "reload_state") {
      result = { reload: true };
    } else if (action === "tick") {
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id, p_job_key: "minion_tick", p_status: "running",
        p_next_expected_at: null, p_metadata: { source: "widget_test" },
      });
      const { data, error } = await service.rpc("process_minion_tick", { p_event_id: event.id });
      if (error) throw error;
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id, p_job_key: "minion_tick", p_status: "healthy",
        p_next_expected_at: null, p_metadata: { source: "widget_test" },
      });
      result = data;
    } else if (action === "test_passive_tick") {
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id, p_job_key: "passive_damage_tick", p_status: "running",
        p_next_expected_at: null, p_metadata: { source: "widget_test" },
      });
      const { data, error } = await service.rpc("process_passive_damage_tick", {
        p_event_id: event.id,
        p_now: new Date().toISOString(),
      });
      if (error) throw error;
      await service.rpc("mark_event_job_status", {
        p_event_id: event.id, p_job_key: "passive_damage_tick", p_status: "healthy",
        p_next_expected_at: null, p_metadata: { source: "widget_test" },
      });
      result = data;
    } else if (action === "test_boss_hit" || action === "test_boss_big_hit") {
      const amount = action === "test_boss_hit" ? 1_000 : 25_000;
      const { data, error } = await service.rpc("apply_boss_damage", {
        p_event_id: event.id,
        p_streamer_id: streamer.id,
        p_source: "admin",
        p_raw_amount: amount,
        p_idempotency_key: `widget-test:${requestId}`,
        p_force: true,
        p_actor_user_id: null,
      });
      if (error) throw error;
      result = data;
    } else if (action === "reset_test_boss") {
      const { data, error } = await service.rpc("admin_reset_boss", { p_event_id: event.id });
      if (error) throw error;
      result = data;
    } else if (action === "set_phase") {
      const phaseId = Number(body.phaseId);
      if (!Number.isInteger(phaseId) || phaseId < 1) return json({ ok: false, error: "invalid_phase" }, 400);
      const { data: boss, error: bossError } = await service.from("bosses")
        .select("max_hp").eq("event_id", event.id).single();
      if (bossError) throw bossError;
      const { data: phase, error: phaseError } = await service.from("boss_phases")
        .select("min_percent,max_percent").eq("event_id", event.id).eq("phase_number", phaseId).single();
      if (phaseError) throw phaseError;
      const targetPercent = (Number(phase.min_percent) + Number(phase.max_percent)) / 2;
      const { data, error } = await service.rpc("admin_set_boss_hp", {
        p_event_id: event.id,
        p_hp: Math.max(1, Math.floor(Number(boss.max_hp) * targetPercent / 100)),
      });
      if (error) throw error;
      result = data;
    } else if (action === "spawn_minion" || action === "spawn_raid_special_now") {
      let minionKey = normalizedDefinitionKey(body.definitionKey);
      if (action === "spawn_raid_special_now") {
        const { data: settings, error: settingsError } = await service.from("event_settings")
          .select("raid_special_minion_key").eq("event_id", event.id).single();
        if (settingsError) throw settingsError;
        minionKey = normalizedDefinitionKey(settings.raid_special_minion_key);
      }
      if (!minionKey) return json({ ok: false, error: "invalid_minion_definition" }, 400);
      const { data: definition, error: definitionError } = await service.from("minion_definitions")
        .select("id").eq("event_id", event.id).eq("key", minionKey).eq("enabled", true).single();
      if (definitionError) throw definitionError;
      const { data, error } = await service.rpc("spawn_minion_v4", {
        p_event_id: event.id,
        p_definition_id: definition.id,
        p_streamer_id: streamer.id,
        p_force: true,
        p_trigger_source: "manual_test",
        p_trigger_reference: `widget-test:${requestId}`,
        p_spawned_at: new Date().toISOString(),
      });
      if (error) throw error;
      result = data;
    } else if (["force_minion_success", "force_minion_failure", "cancel_minion", "expire_minion"].includes(action)) {
      const minion = await currentMinion(event.id, streamer.id);
      if (!minion) return json({ ok: false, error: "no_current_minion" }, 409);
      const resolution = action === "force_minion_success" ? "success"
        : action === "force_minion_failure" ? "failure"
        : action === "cancel_minion" ? "cancelled" : "expired";
      const { data, error } = await service.rpc("resolve_minion_v4", {
        p_event_id: event.id,
        p_minion_event_id: minion.id,
        p_resolution: resolution,
        p_actor_user_id: null,
        p_force: true,
        p_resolution_source: "widget_test",
      });
      if (error) throw error;
      result = data;
    } else if (action === "test_effect") {
      const curseKey = normalizedDefinitionKey(body.effectKey);
      if (!curseKey) return json({ ok: false, error: "invalid_effect" }, 400);
      const { data: curse, error } = await service.from("curse_definitions")
        .select("key,duration_ms,intensity,presentation")
        .eq("event_id", event.id).eq("key", curseKey).eq("enabled", true).single();
      if (error) throw error;
      result = {
        visualCurse: {
          key: curse.key,
          durationMs: Math.min(15_000, Math.max(1_000, Number(curse.duration_ms))),
          intensity: Math.min(1.1, Math.max(0, Number(curse.intensity))),
          presentation: curse.presentation,
        },
        statisticsChanged: false,
      };
    } else if (action === "simulate_eligible_raid") {
      const { data: senders, error: senderError } = await service.from("streamers")
        .select("id,twitch_user_id")
        .eq("event_id", event.id).eq("enabled", true).eq("gameplay_enabled", true).eq("is_test_account", true)
        .neq("id", streamer.id).limit(1);
      if (senderError) throw senderError;
      const sender = senders?.[0];
      if (!sender) return json({ ok: false, error: "test_raid_sender_missing" }, 409);
      const messageId = `widget-test-raid:${requestId}`;
      const { data, error } = await service.from("raid_events").insert({
        event_id: event.id,
        from_streamer_id: sender.id,
        to_streamer_id: streamer.id,
        from_twitch_user_id: sender.twitch_user_id || `manual-test:${sender.id}`,
        to_twitch_user_id: streamer.twitch_user_id || `manual-test:${streamer.id}`,
        viewer_count: 25,
        twitch_message_id: messageId,
        occurred_at: new Date().toISOString(),
        eligible: true,
        source: "manual_test",
        metadata: { source: "streamelements_widget", request_id: requestId },
      }).select("id,eligible,occurred_at").single();
      if (error) throw error;
      result = data;
    } else if (action === "create_test_viewer_sample") {
      const now = new Date().toISOString();
      if (!streamer.tracking_enabled) return json({ ok: false, error: "tracking_disabled" }, 409);
      const { data, error } = await service.rpc("upsert_twitch_stream_snapshot", {
        p_event_id: event.id,
        p_streamer_id: streamer.id,
        p_stream_id: `manual-test:${streamer.id}`,
        p_viewer_count: 25,
        p_started_at: now,
        p_sampled_at: now,
        p_idempotency_key: `widget-test:${requestId}`,
        p_source: "manual_test",
      });
      if (error) throw error;
      result = data;
    }

    await service.rpc("touch_event", { p_event_id: event.id });
    return json({ ok: true, message: "Testaktion serverseitig ausgeführt.", data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "widget_test_action_failed";
    return json({ ok: false, error: message }, 400);
  }
});
