import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  resolveTwitchStreamerIds,
  syncEventSubSubscriptions,
  syncTwitchStreams,
  twitchClientFromEnvironment,
} from "../_shared/twitch-service.ts";

type Body = Record<string, unknown> & { action?: string; eventSlug?: string };
type Role = "owner" | "admin" | "operator" | "viewer";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function twitchLogin(value: unknown) {
  return text(value).toLowerCase();
}

function slugify(value: unknown) {
  return text(value).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid_number");
  return parsed;
}

function boolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

async function audit(eventId: string, userId: string, action: string, targetType?: string, targetId?: string, metadata: unknown = {}) {
  const { error } = await service.from("admin_audit_log").insert({
    event_id: eventId,
    actor_user_id: userId,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    metadata,
  });
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "function_not_configured" }, 503);

  try {
    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return json({ ok: false, error: "authentication_required" }, 401);
    const { data: authData, error: authError } = await service.auth.getUser(token);
    if (authError || !authData.user) return json({ ok: false, error: "invalid_session" }, 401);

    const body = (await request.json()) as Body;
    const action = text(body.action);
    const eventSlug = text(body.eventSlug);
    if (!action || !eventSlug) return json({ ok: false, error: "action_and_event_required" }, 400);

    const { data: event, error: eventError } = await service
      .from("events")
      .select("id, slug, status")
      .eq("slug", eventSlug)
      .single();
    if (eventError || !event) return json({ ok: false, error: "event_not_found" }, 404);

    const { data: membership, error: membershipError } = await service
      .from("event_admins")
      .select("role")
      .eq("event_id", event.id)
      .eq("user_id", authData.user.id)
      .single();
    if (membershipError || !membership) return json({ ok: false, error: "not_an_event_admin" }, 403);
    const role = membership.role as Role;

    if (action === "get_context") {
      return json({ ok: true, message: "Admin-Kontext geladen.", data: { role, eventId: event.id } });
    }
    if (role === "viewer") return json({ ok: false, error: "viewer_is_read_only" }, 403);

    let result: unknown = null;
    let targetType: string | undefined;
    let targetId: string | undefined;

    if (action === "apply_damage") {
      const { data, error } = await service.rpc("apply_boss_damage", {
        p_event_id: event.id,
        p_streamer_id: null,
        p_source: "admin",
        p_raw_amount: Math.max(0, Math.floor(number(body.amount))),
        p_idempotency_key: text(body.idempotencyKey),
        p_force: boolean(body.force),
        p_actor_user_id: authData.user.id,
      });
      if (error) throw error;
      result = data;
      targetType = "boss";
    } else if (action === "set_boss_hp") {
      const { data, error } = await service.rpc("admin_set_boss_hp", {
        p_event_id: event.id,
        p_hp: Math.floor(number(body.hp)),
      });
      if (error) throw error;
      result = data;
      targetType = "boss";
    } else if (action === "reset_boss") {
      if (role !== "owner") return json({ ok: false, error: "owner_role_required" }, 403);
      const { data, error } = await service.rpc("admin_reset_boss", { p_event_id: event.id });
      if (error) throw error;
      result = data;
      targetType = "boss";
    } else if (action === "update_settings") {
      const input = (body.settings && typeof body.settings === "object" ? body.settings : {}) as Record<string, unknown>;
      const allowed: Record<string, string> = {
        eventPaused: "event_paused",
        damageEnabled: "damage_enabled",
        minionsEnabled: "minions_enabled",
        globalDamageMultiplier: "global_damage_multiplier",
        passiveDamageMultiplier: "passive_damage_multiplier",
        activeDamageMultiplier: "active_damage_multiplier",
        passiveTickSeconds: "passive_tick_seconds",
      };
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [clientKey, dbKey] of Object.entries(allowed)) {
        if (Object.hasOwn(input, clientKey)) patch[dbKey] = input[clientKey];
      }
      const { data, error } = await service.from("event_settings").update(patch).eq("event_id", event.id).select().single();
      if (error) throw error;
      await service.rpc("touch_event", { p_event_id: event.id });
      result = data;
      targetType = "settings";
    } else if (action === "set_event_status") {
      const status = text(body.status).toLowerCase();
      if (!["draft", "testing", "active"].includes(status)) {
        return json({ ok: false, error: "invalid_event_status" }, 400);
      }
      const { data, error } = await service.rpc("admin_set_event_status", {
        p_event_id: event.id,
        p_status: status,
      });
      if (error) throw error;
      result = data;
      targetType = "event";
      targetId = event.id;
    } else if (action === "spawn_minion") {
      const typeId = text(body.typeId);
      const streamerId = text(body.streamerId);
      const { data: definition, error: definitionError } = await service
        .from("minion_definitions").select("id").eq("event_id", event.id).eq("key", typeId).single();
      if (definitionError || !definition) return json({ ok: false, error: "minion_definition_not_found" }, 404);
      const { data, error } = await service.rpc("spawn_minion_v4", {
        p_event_id: event.id,
        p_definition_id: definition.id,
        p_streamer_id: streamerId,
        p_force: boolean(body.force),
        p_trigger_source: "admin",
        p_trigger_reference: null,
        p_spawned_at: new Date().toISOString(),
      });
      if (error) throw error;
      result = data;
      targetType = "minion_event";
      targetId = typeof data?.minionEventId === "string" ? data.minionEventId : undefined;
    } else if (action === "resolve_minion") {
      const minionId = text(body.instanceId);
      const { data, error } = await service.rpc("resolve_minion_v4", {
        p_event_id: event.id,
        p_minion_event_id: minionId,
        p_resolution: text(body.resolution),
        p_actor_user_id: authData.user.id,
        p_force: true,
        p_resolution_source: "admin_debugger",
      });
      if (error) throw error;
      result = data;
      targetType = "minion_event";
      targetId = minionId;
    } else if (action === "upsert_streamer") {
      const streamer = (body.streamer && typeof body.streamer === "object" ? body.streamer : {}) as Record<string, unknown>;
      const streamerId = text(body.streamerId);
      const displayName = text(streamer.displayName);
      const slug = text(streamer.slug).toLowerCase() || slugify(displayName);
      const normalizedTwitchLogin = twitchLogin(streamer.twitchLogin);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ ok: false, error: "invalid_streamer_slug" }, 400);
      if (!normalizedTwitchLogin) return json({ ok: false, error: "twitch_login_required" }, 400);
      let duplicateQuery = service.from("streamers").select("id")
        .eq("event_id", event.id)
        .eq("twitch_login", normalizedTwitchLogin);
      if (streamerId) duplicateQuery = duplicateQuery.neq("id", streamerId);
      const { data: duplicates, error: duplicateError } = await duplicateQuery.limit(1);
      if (duplicateError) throw duplicateError;
      if (duplicates?.length) return json({ ok: false, error: "duplicate_twitch_login" }, 409);
      let twitchUserId: string | null | undefined;
      if (streamerId) {
        const { data: existing } = await service.from("streamers")
          .select("twitch_login,twitch_user_id").eq("event_id", event.id).eq("id", streamerId).single();
        twitchUserId = twitchLogin(existing?.twitch_login) === normalizedTwitchLogin
          ? existing?.twitch_user_id
          : null;
      }
      const row = {
        event_id: event.id,
        slug,
        display_name: displayName,
        community_name: text(streamer.communityName) || `${displayName} Community`,
        twitch_login: normalizedTwitchLogin,
        twitch_url: text(streamer.twitchUrl),
        avatar_url: text(streamer.avatarUrl) || null,
        enabled: boolean(streamer.enabled, true),
        is_test_account: boolean(streamer.isTestAccount),
        sort_order: Math.floor(number(streamer.sortOrder ?? 0)),
        updated_at: new Date().toISOString(),
        ...(streamerId ? { twitch_user_id: twitchUserId ?? null } : {}),
      };
      if (!row.display_name) return json({ ok: false, error: "streamer_display_name_required" }, 400);
      const query = streamerId
        ? service.from("streamers").update(row).eq("event_id", event.id).eq("id", streamerId)
        : service.from("streamers").insert(row);
      const { data, error } = await query.select().single();
      if (error) throw error;
      await service.rpc("touch_event", { p_event_id: event.id });
      result = data;
      targetType = "streamer";
      targetId = data.id;
    } else if (action === "set_streamer_enabled") {
      const streamerId = text(body.streamerId);
      const { data, error } = await service.from("streamers")
        .update({ enabled: boolean(body.enabled), updated_at: new Date().toISOString() })
        .eq("event_id", event.id).eq("id", streamerId).select().single();
      if (error) throw error;
      if (!boolean(body.enabled)) {
        const { error: offlineError } = await service.rpc("mark_twitch_stream_offline", {
          p_event_id: event.id,
          p_streamer_id: streamerId,
          p_observed_at: new Date().toISOString(),
          p_source: "streamer_disabled",
        });
        if (offlineError) throw offlineError;
      }
      await service.rpc("touch_event", { p_event_id: event.id });
      result = data;
      targetType = "streamer";
      targetId = streamerId;
    } else if (action === "resolve_twitch_ids" || action === "resolve_twitch_id") {
      const streamerId = action === "resolve_twitch_id" ? text(body.streamerId) : undefined;
      if (action === "resolve_twitch_id" && !streamerId) return json({ ok: false, error: "streamer_id_required" }, 400);
      result = await resolveTwitchStreamerIds(service, twitchClientFromEnvironment(), event.id, streamerId);
      targetType = "twitch_integration";
      targetId = streamerId;
    } else if (action === "sync_twitch_streams") {
      const streamerId = text(body.streamerId) || undefined;
      result = await syncTwitchStreams(service, twitchClientFromEnvironment(), event.id, streamerId);
      targetType = "twitch_integration";
      targetId = streamerId;
    } else if (action === "sync_eventsub_subscriptions") {
      if (role !== "owner" && role !== "admin") return json({ ok: false, error: "admin_role_required" }, 403);
      result = await syncEventSubSubscriptions(
        service,
        twitchClientFromEnvironment(),
        Deno.env.get("TWITCH_EVENTSUB_CALLBACK_URL") ?? "",
        Deno.env.get("TWITCH_EVENTSUB_SECRET") ?? "",
      );
      targetType = "twitch_eventsub";
    } else if (action === "simulate_raid") {
      const fromStreamerId = text(body.fromStreamerId);
      const toStreamerId = text(body.toStreamerId);
      if (!fromStreamerId || !toStreamerId || fromStreamerId === toStreamerId) {
        return json({ ok: false, error: "distinct_raid_streamers_required" }, 400);
      }
      const { data: raidStreamers, error: streamerError } = await service.from("streamers")
        .select("id,twitch_user_id,enabled")
        .eq("event_id", event.id)
        .in("id", [fromStreamerId, toStreamerId]);
      if (streamerError) throw streamerError;
      const from = raidStreamers?.find((streamer) => streamer.id === fromStreamerId);
      const to = raidStreamers?.find((streamer) => streamer.id === toStreamerId);
      if (!from?.enabled || !to?.enabled || !from.twitch_user_id || !to.twitch_user_id) {
        return json({ ok: false, error: "raid_streamers_must_be_enabled_and_resolved" }, 400);
      }
      const manualMessageId = `manual:${crypto.randomUUID()}`;
      const { data, error } = await service.rpc("record_twitch_raid", {
        p_event_id: event.id,
        p_from_twitch_user_id: from.twitch_user_id,
        p_to_twitch_user_id: to.twitch_user_id,
        p_viewer_count: Math.max(0, Math.floor(number(body.viewerCount))),
        p_twitch_message_id: manualMessageId,
        p_occurred_at: new Date().toISOString(),
        p_source: "manual_test",
        p_metadata: { simulated_by: authData.user.id },
      });
      if (error) throw error;
      result = data;
      targetType = "raid_event";
      targetId = typeof data?.raidId === "string" ? data.raidId : undefined;
    } else {
      return json({ ok: false, error: "unknown_action" }, 400);
    }

    await audit(event.id, authData.user.id, action, targetType, targetId, {
      reason: text(body.reason) || null,
      force: boolean(body.force),
    });
    let responseMessage = "Serveraktion ausgeführt.";
    if (action === "resolve_twitch_ids" || action === "resolve_twitch_id") {
      const summary = result as { resolved?: number; notFound?: string[] };
      responseMessage = `${summary.resolved ?? 0} Twitch-ID(s) aufgelöst.`;
      if (summary.notFound?.length) responseMessage += ` Nicht gefunden: ${summary.notFound.join(", ")}.`;
    } else if (action === "sync_twitch_streams") {
      const summary = result as { checked?: number; live?: number; offline?: number; samples?: number };
      responseMessage = `${summary.checked ?? 0} Streamer geprüft: ${summary.live ?? 0} live, ${summary.offline ?? 0} offline, ${summary.samples ?? 0} neue Samples. Kein Boss-Schaden.`;
    } else if (action === "sync_eventsub_subscriptions") {
      const summary = result as { current?: number; created?: number; removed?: number };
      responseMessage = `${summary.current ?? 0} EventSub-Subscriptions aktiv/pending; ${summary.created ?? 0} erstellt, ${summary.removed ?? 0} entfernt.`;
    } else if (action === "simulate_raid") {
      responseMessage = "Test-Raid gespeichert; kein Raid-Bonus und kein Boss-Schaden ausgelöst.";
    } else if (action === "set_event_status") {
      responseMessage = text(body.status) === "active" ? "Event zentral aktiviert." : `Eventstatus auf ${text(body.status)} gesetzt.`;
    }
    return json({ ok: true, message: responseMessage, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const secrets = [SERVICE_ROLE_KEY, Deno.env.get("TWITCH_CLIENT_SECRET") ?? "", Deno.env.get("TWITCH_EVENTSUB_SECRET") ?? ""];
    const safeMessage = secrets.filter(Boolean).reduce((current, secret) => current.replaceAll(secret, "[redacted]"), message);
    return json({ ok: false, error: safeMessage }, 400);
  }
});
