import type { TwitchEventSubSubscription, TwitchStream } from "./twitch-client.ts";

export const TWITCH_BATCH_SIZE = 100;
export const VIEWER_SAMPLE_INTERVAL_SECONDS = 120;
export const SUPPORTED_EVENTSUB_TYPES = ["stream.online", "stream.offline", "channel.raid"] as const;

export function normalizeViewerCount(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function sampleBucket(timestamp: string | Date) {
  const milliseconds = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp);
  const interval = VIEWER_SAMPLE_INTERVAL_SECONDS * 1_000;
  return new Date(Math.floor(milliseconds / interval) * interval).toISOString();
}

export function viewerSampleKey(streamId: string, sampledAt: string | Date) {
  return `twitch-api:${streamId}:${sampleBucket(sampledAt)}`;
}

export function buildStreamSyncPlan<T extends { id: string; twitch_user_id: string }>(
  streamers: T[],
  streams: TwitchStream[],
) {
  const byUserId = new Map(streams.map((stream) => [stream.user_id, stream]));
  return streamers.map((streamer) => ({ streamer, stream: byUserId.get(streamer.twitch_user_id) ?? null }));
}

export function eventSubKey(type: string, condition: Record<string, string>) {
  const canonical = Object.entries(condition).sort(([left], [right]) => left.localeCompare(right));
  return `${type}:${JSON.stringify(Object.fromEntries(canonical))}`;
}

export function desiredEventSubSubscriptions(twitchUserIds: string[]) {
  return [...new Set(twitchUserIds.filter(Boolean))].flatMap((id) => [
    { type: "stream.online" as const, condition: { broadcaster_user_id: id } },
    { type: "stream.offline" as const, condition: { broadcaster_user_id: id } },
    { type: "channel.raid" as const, condition: { from_broadcaster_user_id: id } },
    { type: "channel.raid" as const, condition: { to_broadcaster_user_id: id } },
  ]);
}

export function isManagedSubscription(subscription: TwitchEventSubSubscription, callback: string) {
  return (
    (SUPPORTED_EVENTSUB_TYPES as readonly string[]).includes(subscription.type) &&
    subscription.transport.method === "webhook" &&
    subscription.transport.callback === callback
  );
}

export function raidIsEligible(fromTwitchUserId: string, toTwitchUserId: string, enabledIds: Iterable<string>) {
  const ids = enabledIds instanceof Set ? enabledIds : new Set(enabledIds);
  return fromTwitchUserId !== toTwitchUserId && ids.has(fromTwitchUserId) && ids.has(toTwitchUserId);
}

export async function createEventSubSignature(secret: string, messageId: string, timestamp: string, rawBody: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${messageId}${timestamp}${rawBody}`));
  return `sha256=${[...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function isFreshEventSubTimestamp(timestamp: string, now = Date.now()) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed >= now - 10 * 60_000 && parsed <= now + 60_000;
}
