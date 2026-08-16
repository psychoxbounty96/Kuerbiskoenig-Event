import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  constantTimeEqual,
  createEventSubSignature,
  eventSubKey,
  isFreshEventSubTimestamp,
  normalizeViewerCount,
  sampleBucket,
  SUPPORTED_EVENTSUB_TYPES,
  viewerSampleKey,
} from "../_shared/twitch-domain.ts";
import {
  twitchClientFromEnvironment,
  updateTwitchHealth,
  writeTwitchLog,
} from "../_shared/twitch-service.ts";

type EventSubEnvelope = {
  challenge?: string;
  subscription?: {
    id: string;
    type: string;
    version?: string;
    status: string;
    condition: Record<string, string>;
    transport?: { callback?: string };
  };
  event?: Record<string, unknown>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EVENTSUB_SECRET = Deno.env.get("TWITCH_EVENTSUB_SECRET") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const plain = (body: string, status = 200) => new Response(body, {
  status,
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});

async function affectedStreamers(twitchUserId: string) {
  const { data, error } = await service.from("streamers")
    .select("id,event_id,enabled,tracking_enabled,gameplay_enabled")
    .eq("twitch_user_id", twitchUserId);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; event_id: string; enabled: boolean; tracking_enabled: boolean; gameplay_enabled: boolean }>;
}

async function markWebhookReceived(eventIds: Iterable<string>) {
  const now = new Date().toISOString();
  for (const eventId of new Set(eventIds)) {
    await updateTwitchHealth(service, eventId, { last_webhook_at: now, webhook_configured: true });
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return plain("method_not_allowed", 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !EVENTSUB_SECRET) return plain("webhook_not_configured", 503);

  const messageId = request.headers.get("Twitch-Eventsub-Message-Id") ?? "";
  const timestamp = request.headers.get("Twitch-Eventsub-Message-Timestamp") ?? "";
  const signature = request.headers.get("Twitch-Eventsub-Message-Signature") ?? "";
  const messageType = request.headers.get("Twitch-Eventsub-Message-Type") ?? "";
  const subscriptionTypeHeader = request.headers.get("Twitch-Eventsub-Subscription-Type") ?? "";
  const subscriptionVersionHeader = request.headers.get("Twitch-Eventsub-Subscription-Version") ?? "";
  const rawBody = await request.text();

  if (!messageId || messageId.length > 256 || !timestamp || !signature || !messageType) {
    return plain("missing_eventsub_headers", 400);
  }

  const expected = await createEventSubSignature(EVENTSUB_SECRET, messageId, timestamp, rawBody);
  if (!isFreshEventSubTimestamp(timestamp) || !constantTimeEqual(signature, expected)) {
    console.warn("EventSub signature invalid", { messageId });
    await service.from("twitch_integration_status").update({
      health_status: "error",
      health_reason: "Ungültige oder veraltete EventSub-Signatur empfangen.",
      last_invalid_signature_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("webhook_configured", true);
    await writeTwitchLog(service, null, "eventsub_signature_invalid", "EventSub-Nachricht wegen ungültiger Signatur abgelehnt.", {
      level: "warning",
      metadata: { message_id: messageId },
    });
    return plain("invalid_signature", 403);
  }

  let envelope: EventSubEnvelope;
  try {
    envelope = JSON.parse(rawBody) as EventSubEnvelope;
  } catch {
    return plain("invalid_json", 400);
  }
  const subscription = envelope.subscription;
  const subscriptionType = subscription?.type || subscriptionTypeHeader;
  if (!subscription || !(SUPPORTED_EVENTSUB_TYPES as readonly string[]).includes(subscriptionType)) {
    return plain("unsupported_subscription_type", 400);
  }
  if ((subscriptionTypeHeader && subscriptionTypeHeader !== subscription.type) ||
      (subscriptionVersionHeader && subscriptionVersionHeader !== "1") ||
      (subscription.version && subscription.version !== "1")) {
    return plain("subscription_header_mismatch", 400);
  }

  const { data: claimed, error: claimError } = await service.rpc("claim_twitch_eventsub_message", {
    p_message_id: messageId,
    p_message_type: messageType,
    p_subscription_type: subscriptionType,
    p_subscription_id: subscription.id,
    p_message_timestamp: timestamp,
  });
  if (claimError) return plain("deduplication_failed", 500);

  if (messageType === "webhook_callback_verification") {
    if (claimed) {
      await service.from("twitch_eventsub_subscriptions").upsert({
        twitch_subscription_id: subscription.id,
        subscription_type: subscription.type,
        condition: subscription.condition,
        condition_key: eventSubKey(subscription.type, subscription.condition),
        status: subscription.status,
        callback_url: subscription.transport?.callback ?? Deno.env.get("TWITCH_EVENTSUB_CALLBACK_URL") ?? "",
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await service.rpc("finish_twitch_eventsub_message", {
        p_message_id: messageId,
        p_status: "challenge",
        p_error: null,
      });
    }
    return plain(envelope.challenge ?? "", 200);
  }

  if (!claimed) return plain("", 204);

  try {
    const event = envelope.event ?? {};
    const affectedEvents = new Set<string>();
    if (messageType === "revocation") {
      const conditionId = Object.values(subscription.condition)[0] ?? "";
      const streamers = conditionId ? await affectedStreamers(conditionId) : [];
      streamers.forEach((streamer) => affectedEvents.add(streamer.event_id));
      await service.from("twitch_eventsub_subscriptions").upsert({
        twitch_subscription_id: subscription.id,
        subscription_type: subscription.type,
        condition: subscription.condition,
        condition_key: eventSubKey(subscription.type, subscription.condition),
        status: subscription.status,
        callback_url: subscription.transport?.callback ?? Deno.env.get("TWITCH_EVENTSUB_CALLBACK_URL") ?? "",
        revoked_at: new Date().toISOString(),
        last_error: subscription.status,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      for (const eventId of affectedEvents) {
        await updateTwitchHealth(service, eventId, {
          health_status: "warning",
          health_reason: `EventSub-Subscription widerrufen: ${subscription.status}`,
          last_error_at: new Date().toISOString(),
          last_error: subscription.status,
          last_webhook_at: new Date().toISOString(),
        });
        await writeTwitchLog(service, eventId, "eventsub_revoked", "EventSub-Subscription wurde widerrufen.", {
          level: "warning",
          metadata: { subscription_id: subscription.id, type: subscription.type, status: subscription.status },
        });
      }
      await service.rpc("finish_twitch_eventsub_message", { p_message_id: messageId, p_status: "revoked", p_error: null });
      return plain("", 204);
    }

    if (messageType !== "notification") throw new Error("unsupported_message_type");
    if (subscriptionType === "stream.online") {
      const twitchUserId = String(event.broadcaster_user_id ?? "");
      const streamId = String(event.id ?? "");
      const startedAt = String(event.started_at ?? new Date().toISOString());
      const streamers = (await affectedStreamers(twitchUserId)).filter((streamer) => streamer.enabled && streamer.tracking_enabled);
      const twitch = twitchClientFromEnvironment();
      for (const streamer of streamers) {
        affectedEvents.add(streamer.event_id);
        const { error } = await service.rpc("mark_twitch_stream_online", {
          p_event_id: streamer.event_id,
          p_streamer_id: streamer.id,
          p_stream_id: streamId,
          p_started_at: startedAt,
          p_observed_at: timestamp,
        });
        if (error) throw error;
        try {
          const current = (await twitch.getStreamsByUserIds([twitchUserId]))
            .find((stream) => stream.user_id === twitchUserId);
          if (current) {
            const observedAt = new Date();
            const { error: sampleError } = await service.rpc("upsert_twitch_stream_snapshot", {
              p_event_id: streamer.event_id,
              p_streamer_id: streamer.id,
              p_stream_id: current.id,
              p_viewer_count: normalizeViewerCount(current.viewer_count),
              p_started_at: current.started_at,
              p_sampled_at: sampleBucket(observedAt),
              p_idempotency_key: viewerSampleKey(current.id, observedAt),
              p_source: "twitch_api",
            });
            if (sampleError) throw sampleError;
          }
        } catch (syncError) {
          console.warn("EventSub online enrichment failed; online state retained", syncError);
          await updateTwitchHealth(service, streamer.event_id, {
            health_status: "warning",
            health_reason: "EventSub Online empfangen; Twitch-Daten konnten noch nicht nachgeladen werden.",
            last_error_at: new Date().toISOString(),
            last_error: syncError instanceof Error ? syncError.message.slice(0, 500) : "online_enrichment_failed",
          });
        }
      }
    } else if (subscriptionType === "stream.offline") {
      const twitchUserId = String(event.broadcaster_user_id ?? "");
      const streamers = (await affectedStreamers(twitchUserId)).filter((streamer) => streamer.enabled && streamer.tracking_enabled);
      for (const streamer of streamers) {
        affectedEvents.add(streamer.event_id);
        const { error } = await service.rpc("mark_twitch_stream_offline", {
          p_event_id: streamer.event_id,
          p_streamer_id: streamer.id,
          p_observed_at: timestamp,
          p_source: "twitch_eventsub",
        });
        if (error) throw error;
      }
    } else if (subscriptionType === "channel.raid") {
      const fromId = String(event.from_broadcaster_user_id ?? "");
      const toId = String(event.to_broadcaster_user_id ?? "");
      const fromStreamers = await affectedStreamers(fromId);
      const toStreamers = await affectedStreamers(toId);
      [...fromStreamers, ...toStreamers].filter((streamer) => streamer.enabled && streamer.tracking_enabled)
        .forEach((streamer) => affectedEvents.add(streamer.event_id));
      for (const eventId of affectedEvents) {
        const { error } = await service.rpc("record_twitch_raid", {
          p_event_id: eventId,
          p_from_twitch_user_id: fromId,
          p_to_twitch_user_id: toId,
          p_viewer_count: normalizeViewerCount(event.viewers),
          p_twitch_message_id: messageId,
          p_occurred_at: timestamp,
          p_source: "twitch_eventsub",
          p_metadata: {
            from_login: event.from_broadcaster_user_login ?? null,
            to_login: event.to_broadcaster_user_login ?? null,
          },
        });
        if (error) throw error;
      }
    }

    await service.from("twitch_eventsub_subscriptions").update({
      status: subscription.status,
      last_notification_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("twitch_subscription_id", subscription.id);
    await markWebhookReceived(affectedEvents);
    for (const eventId of affectedEvents) {
      await writeTwitchLog(service, eventId, "eventsub_received", `EventSub ${subscriptionType} verarbeitet.`, {
        metadata: { subscription_id: subscription.id, message_id: messageId },
      });
    }
    await service.rpc("finish_twitch_eventsub_message", { p_message_id: messageId, p_status: "processed", p_error: null });
    return plain("", 204);
  } catch (error) {
    const message = error instanceof Error ? error.message : "eventsub_processing_failed";
    await service.rpc("finish_twitch_eventsub_message", { p_message_id: messageId, p_status: "error", p_error: message.slice(0, 500) });
    console.error("EventSub processing failed", { messageId, error: message });
    return plain("processing_failed", 500);
  }
});
