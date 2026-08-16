import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { maybeSendDiscordLiveAnnouncement } from "./discord-announcements.ts";
import { TwitchClient, type TwitchEventSubSubscription } from "./twitch-client.ts";
import {
  buildStreamSyncPlan,
  desiredEventSubSubscriptions,
  eventSubKey,
  isManagedSubscription,
  normalizeViewerCount,
  sampleBucket,
  viewerSampleKey,
} from "./twitch-domain.ts";

type ServiceClient = SupabaseClient;
type StreamerRow = {
  id: string;
  event_id: string;
  display_name: string;
  twitch_login: string;
  twitch_user_id: string | null;
  enabled: boolean;
  tracking_enabled: boolean;
};

export function safeTwitchError(error: unknown, fallback = "Unbekannter Twitch-Fehler") {
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message.slice(0, 500);
  }
  return fallback;
}

export function twitchClientFromEnvironment() {
  return new TwitchClient({
    clientId: Deno.env.get("TWITCH_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("TWITCH_CLIENT_SECRET") ?? "",
  });
}

export async function writeTwitchLog(
  service: ServiceClient,
  eventId: string | null,
  eventType: string,
  message: string,
  options: { streamerId?: string | null; level?: "info" | "warning" | "error"; metadata?: Record<string, unknown> } = {},
) {
  const { error } = await service.from("twitch_system_log").insert({
    event_id: eventId,
    streamer_id: options.streamerId ?? null,
    level: options.level ?? "info",
    event_type: eventType,
    message,
    metadata: options.metadata ?? {},
  });
  if (error) console.error("Twitch system log could not be stored", error.message);
}

export async function updateTwitchHealth(
  service: ServiceClient,
  eventId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await service.from("twitch_integration_status").upsert({
    event_id: eventId,
    updated_at: new Date().toISOString(),
    ...patch,
  });
  if (error) console.error("Twitch health could not be updated", error.message);
}

export async function resolveTwitchStreamerIds(
  service: ServiceClient,
  twitch: TwitchClient,
  eventId: string,
  streamerId?: string,
) {
  let query = service.from("streamers")
    .select("id,event_id,display_name,twitch_login,twitch_user_id,enabled,tracking_enabled")
    .eq("event_id", eventId)
    .eq("tracking_enabled", true);
  if (streamerId) query = query.eq("id", streamerId);
  const { data, error } = await query;
  if (error) throw error;
  const streamers = (data ?? []) as StreamerRow[];
  const withLogin = streamers.filter((streamer) => streamer.twitch_login.trim());
  if (!withLogin.length) throw new Error("Keine Twitch-Logins zum Auflösen vorhanden.");

  try {
    const users = await twitch.resolveUsersByLogin(withLogin.map((streamer) => streamer.twitch_login));
    const byLogin = new Map(users.map((user) => [user.login.toLowerCase(), user]));
    const resolved: string[] = [];
    const notFound: string[] = [];
    for (const streamer of withLogin) {
      const user = byLogin.get(streamer.twitch_login.toLowerCase());
      if (!user) {
        notFound.push(streamer.twitch_login);
        await writeTwitchLog(service, eventId, "twitch_id_not_found", `Twitch-Nutzer „${streamer.twitch_login}“ wurde nicht gefunden.`, {
          streamerId: streamer.id,
          level: "warning",
        });
        continue;
      }
      const { error: updateError } = await service.from("streamers").update({
        twitch_user_id: user.id,
        avatar_url: user.profile_image_url || null,
        twitch_url: `https://twitch.tv/${user.login}`,
        updated_at: new Date().toISOString(),
      }).eq("id", streamer.id).eq("event_id", eventId);
      if (updateError) throw updateError;
      resolved.push(streamer.id);
      await writeTwitchLog(service, eventId, "twitch_id_resolved", `Twitch-ID für ${streamer.display_name} aufgelöst.`, {
        streamerId: streamer.id,
        metadata: { twitch_login: user.login, twitch_user_id: user.id },
      });
    }
    await service.rpc("touch_event", { p_event_id: eventId });
    return { resolved: resolved.length, notFound, total: withLogin.length };
  } catch (error) {
    await updateTwitchHealth(service, eventId, {
      health_status: "error",
      health_reason: safeTwitchError(error),
      last_error_at: new Date().toISOString(),
      last_error: safeTwitchError(error),
    });
    await writeTwitchLog(service, eventId, "twitch_api_request_failed", "Twitch-ID-Auflösung fehlgeschlagen.", {
      level: "error",
      metadata: { operation: "get_users", error: safeTwitchError(error) },
    });
    throw error;
  }
}

export async function syncTwitchStreams(
  service: ServiceClient,
  twitch: TwitchClient,
  eventId: string,
  streamerId?: string,
) {
  let query = service.from("streamers")
    .select("id,event_id,display_name,twitch_login,twitch_user_id,enabled,tracking_enabled")
    .eq("event_id", eventId)
    .eq("enabled", true)
    .eq("tracking_enabled", true)
    .not("twitch_user_id", "is", null);
  if (streamerId) query = query.eq("id", streamerId);
  const { data, error } = await query;
  if (error) throw error;
  const streamers = (data ?? []) as Array<StreamerRow & { twitch_user_id: string }>;
  if (!streamers.length) {
    const reason = "Keine aktivierten Streamer mit aufgelöster Twitch-ID.";
    await updateTwitchHealth(service, eventId, { health_status: "warning", health_reason: reason, last_error: null });
    return { checked: 0, live: 0, offline: 0, samples: 0, warning: reason };
  }

  const observedAt = new Date();
  let streams;
  try {
    // No state is mutated before all Twitch batches have completed successfully.
    streams = await twitch.getStreamsByUserIds(streamers.map((streamer) => streamer.twitch_user_id));
  } catch (error) {
    const message = safeTwitchError(error);
    await updateTwitchHealth(service, eventId, {
      health_status: "error",
      health_reason: message,
      last_sync_at: observedAt.toISOString(),
      last_error_at: observedAt.toISOString(),
      last_error: message,
    });
    await writeTwitchLog(service, eventId, "twitch_api_request_failed", "Twitch Get Streams fehlgeschlagen; Zustand blieb unverändert.", {
      level: "error",
      metadata: { operation: "get_streams", error: message },
    });
    throw error;
  }

  let live = 0;
  let offline = 0;
  let samples = 0;
  for (const item of buildStreamSyncPlan(streamers, streams)) {
    if (item.stream) {
      const viewerCount = normalizeViewerCount(item.stream.viewer_count);
      const sampledAt = sampleBucket(observedAt);
      const { data: result, error: rpcError } = await service.rpc("upsert_twitch_stream_snapshot", {
        p_event_id: eventId,
        p_streamer_id: item.streamer.id,
        p_stream_id: item.stream.id,
        p_viewer_count: viewerCount,
        p_started_at: item.stream.started_at,
        p_sampled_at: sampledAt,
        p_idempotency_key: viewerSampleKey(item.stream.id, observedAt),
        p_source: "twitch_api",
      });
      if (rpcError) throw rpcError;
      live += 1;
      if (result?.sampleId) samples += 1;
      await maybeSendDiscordLiveAnnouncement(service, {
        eventId,
        streamerId: item.streamer.id,
        streamId: item.stream.id,
        stream: {
          streamTitle: item.stream.title,
          gameName: item.stream.game_name,
          thumbnailUrl: item.stream.thumbnail_url,
          viewerCount,
          startedAt: item.stream.started_at,
        },
      });
    } else {
      const { error: rpcError } = await service.rpc("mark_twitch_stream_offline", {
        p_event_id: eventId,
        p_streamer_id: item.streamer.id,
        p_observed_at: observedAt.toISOString(),
        p_source: "twitch_api",
      });
      if (rpcError) throw rpcError;
      offline += 1;
    }
  }

  const { data: subscriptionRows } = await service.from("twitch_eventsub_subscriptions").select("status");
  const revokedOrError = (subscriptionRows ?? []).filter(
    (row) => row.status !== "enabled" && !String(row.status).includes("pending"),
  ).length;
  await updateTwitchHealth(service, eventId, {
    health_status: revokedOrError ? "warning" : "healthy",
    health_reason: revokedOrError
      ? `${revokedOrError} EventSub-Subscription(s) sind widerrufen oder fehlerhaft.`
      : "Twitch API erreichbar; letzter Stream-Sync erfolgreich.",
    last_sync_at: observedAt.toISOString(),
    last_success_at: observedAt.toISOString(),
    last_error: null,
  });
  return { checked: streamers.length, live, offline, samples };
}

function subscriptionRow(subscription: TwitchEventSubSubscription) {
  return {
    twitch_subscription_id: subscription.id,
    subscription_type: subscription.type,
    condition: subscription.condition,
    condition_key: eventSubKey(subscription.type, subscription.condition),
    status: subscription.status,
    callback_url: subscription.transport.callback ?? "",
    revoked_at: subscription.status === "enabled" || subscription.status.includes("pending") ? null : new Date().toISOString(),
    last_error: subscription.status === "enabled" || subscription.status.includes("pending") ? null : subscription.status,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function mirrorEventSubSubscriptions(
  service: ServiceClient,
  callback: string,
  subscriptions: TwitchEventSubSubscription[],
) {
  const current = subscriptions.filter((subscription) => isManagedSubscription(subscription, callback));
  if (current.length) {
    const { error } = await service.from("twitch_eventsub_subscriptions").upsert(current.map(subscriptionRow), {
      onConflict: "twitch_subscription_id",
    });
    if (error) throw error;
  }

  const currentIds = new Set(current.map((subscription) => subscription.id));
  const { data: mirroredRows, error: mirroredError } = await service.from("twitch_eventsub_subscriptions")
    .select("twitch_subscription_id")
    .eq("callback_url", callback);
  if (mirroredError) throw mirroredError;
  const staleIds = (mirroredRows ?? [])
    .map((row) => row.twitch_subscription_id as string)
    .filter((subscriptionId) => !currentIds.has(subscriptionId));
  if (staleIds.length) {
    const { error } = await service.from("twitch_eventsub_subscriptions")
      .delete()
      .in("twitch_subscription_id", staleIds);
    if (error) throw error;
  }
  return current;
}

export async function syncEventSubSubscriptions(
  service: ServiceClient,
  twitch: TwitchClient,
  callback: string,
  secret: string,
) {
  if (!callback.startsWith("https://")) throw new Error("TWITCH_EVENTSUB_CALLBACK_URL muss eine HTTPS-URL sein.");
  if (secret.length < 10 || secret.length > 100) throw new Error("TWITCH_EVENTSUB_SECRET muss 10 bis 100 Zeichen lang sein.");

  const { data: streamerData, error: streamerError } = await service.from("streamers")
    .select("id,event_id,twitch_user_id,enabled,tracking_enabled,events!streamers_event_id_fkey(status)")
    .not("twitch_user_id", "is", null);
  if (streamerError) throw streamerError;
  const allStreamers = (streamerData ?? []) as unknown as Array<{
    event_id: string;
    twitch_user_id: string;
    enabled: boolean;
    tracking_enabled: boolean;
    events: { status: string };
  }>;
  const activeIds = allStreamers
    .filter((streamer) => streamer.enabled && streamer.tracking_enabled && ["testing", "active", "paused"].includes(streamer.events.status))
    .map((streamer) => streamer.twitch_user_id);
  const desired = desiredEventSubSubscriptions(activeIds);
  const desiredKeys = new Set(desired.map((item) => eventSubKey(item.type, item.condition)));
  const eventIds = [...new Set(allStreamers.map((streamer) => streamer.event_id))];
  let removed = 0;
  let created = 0;
  let current: TwitchEventSubSubscription[] = [];
  let totalCost = 0;
  let maxTotalCost = 0;
  try {
    let snapshot = await twitch.getEventSubSubscriptionSnapshot();
    const managed = snapshot.subscriptions.filter((subscription) => isManagedSubscription(subscription, callback));
    const kept = new Set<string>();

    for (const subscription of managed) {
      const key = eventSubKey(subscription.type, subscription.condition);
      if (!desiredKeys.has(key) || kept.has(key)) {
        await twitch.deleteEventSubSubscription(subscription.id);
        removed += 1;
      } else {
        kept.add(key);
      }
    }

    for (const item of desired) {
      const key = eventSubKey(item.type, item.condition);
      if (kept.has(key)) continue;
      const response = await twitch.createEventSubSubscription({ ...item, callback, secret });
      if (response.data.length) {
        const { error } = await service.from("twitch_eventsub_subscriptions").upsert(response.data.map(subscriptionRow), {
          onConflict: "twitch_subscription_id",
        });
        if (error) throw error;
      }
      kept.add(key);
      created += 1;
    }

    snapshot = await twitch.getEventSubSubscriptionSnapshot();
    totalCost = snapshot.totalCost;
    maxTotalCost = snapshot.maxTotalCost;
    current = await mirrorEventSubSubscriptions(service, callback, snapshot.subscriptions);
  } catch (error) {
    const detail = safeTwitchError(error, "EventSub-Synchronisierung fehlgeschlagen.");
    try {
      const recoverySnapshot = await twitch.getEventSubSubscriptionSnapshot();
      totalCost = recoverySnapshot.totalCost;
      maxTotalCost = recoverySnapshot.maxTotalCost;
      current = await mirrorEventSubSubscriptions(service, callback, recoverySnapshot.subscriptions);
    } catch (recoveryError) {
      console.error("EventSub recovery mirror failed", safeTwitchError(recoveryError));
    }
    for (const eventId of eventIds) {
      await updateTwitchHealth(service, eventId, {
        health_status: "error",
        health_reason: detail,
        webhook_configured: true,
        last_error: detail,
      });
      await writeTwitchLog(service, eventId, "eventsub_subscription_sync_failed", detail, {
        level: "error",
        metadata: { created, removed, current: current.length, total_cost: totalCost, max_total_cost: maxTotalCost },
      });
    }
    throw new Error(`EventSub-Synchronisierung fehlgeschlagen: ${detail}`);
  }

  const now = new Date().toISOString();
  for (const eventId of eventIds) {
    await updateTwitchHealth(service, eventId, {
      health_status: "healthy",
      health_reason: "EventSub-Subscriptions synchronisiert.",
      webhook_configured: true,
      last_subscription_sync_at: now,
      last_error: null,
    });
    await writeTwitchLog(service, eventId, "eventsub_subscriptions_synced", "EventSub-Subscriptions synchronisiert.", {
      metadata: { created, removed, total: current.length, total_cost: totalCost, max_total_cost: maxTotalCost },
    });
  }
  return { desired: desired.length, current: current.length, created, removed, totalCost, maxTotalCost };
}
