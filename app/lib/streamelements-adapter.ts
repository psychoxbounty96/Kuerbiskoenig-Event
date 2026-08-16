import type {
  EventStatus,
  OverlayIdentityResolution,
  OverlayIdentityStatus,
  StreamerState,
} from "./types";

const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeTwitchLogin(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeEventSlug(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return EVENT_SLUG_PATTERN.test(normalized) ? normalized : "";
}

export function extractStreamElementsChannelUsername(event: unknown) {
  const detail = event && typeof event === "object" && "detail" in event
    ? (event as { detail?: unknown }).detail
    : null;
  const channel = detail && typeof detail === "object" && "channel" in detail
    ? (detail as { channel?: unknown }).channel
    : null;
  const username = channel && typeof channel === "object" && "username" in channel
    ? (channel as { username?: unknown }).username
    : null;
  return normalizeTwitchLogin(username);
}

function emptyResolution(
  status: OverlayIdentityStatus,
  channelUsername: string | null,
  eventSlug: string | null,
  eventId: string | null = null,
  eventStatus: EventStatus | null = null,
): OverlayIdentityResolution {
  return {
    status,
    channelUsername,
    eventId,
    eventSlug,
    eventStatus,
    streamerId: null,
    streamerSlug: null,
    streamerDisplayName: null,
    isTestAccount: false,
    testActionsAuthorized: false,
  };
}

export function resolveParticipantIdentity(options: {
  channelUsername: unknown;
  eventSlug: unknown;
  currentEventId: string;
  currentEventSlug: string;
  currentEventStatus: EventStatus;
  streamers: Array<
    Pick<StreamerState, "id" | "slug" | "displayName" | "twitchLogin" | "enabled" | "isTestAccount">
    & Partial<Pick<StreamerState, "gameplayEnabled">>
  >;
}): OverlayIdentityResolution {
  const channelUsername = normalizeTwitchLogin(options.channelUsername);
  const eventSlug = normalizeEventSlug(options.eventSlug);
  if (!channelUsername) return emptyResolution("error", null, eventSlug || null);
  if (!eventSlug || eventSlug !== options.currentEventSlug) {
    return emptyResolution("not_registered", channelUsername, eventSlug || null);
  }

  const matches = options.streamers.filter(
    (streamer) => normalizeTwitchLogin(streamer.twitchLogin) === channelUsername,
  );
  if (matches.length > 1) {
    return emptyResolution("error", channelUsername, eventSlug, options.currentEventId, options.currentEventStatus);
  }
  if (!matches.length) {
    return emptyResolution("not_registered", channelUsername, eventSlug, options.currentEventId, options.currentEventStatus);
  }
  const streamer = matches[0];
  if (!streamer.enabled || streamer.gameplayEnabled === false) {
    return emptyResolution("disabled", channelUsername, eventSlug, options.currentEventId, options.currentEventStatus);
  }
  return {
    status: "resolved",
    channelUsername,
    eventId: options.currentEventId,
    eventSlug,
    eventStatus: options.currentEventStatus,
    streamerId: streamer.id,
    streamerSlug: streamer.slug,
    streamerDisplayName: streamer.displayName,
    isTestAccount: Boolean(streamer.isTestAccount),
    testActionsAuthorized: Boolean(streamer.isTestAccount) && options.currentEventStatus === "testing",
  };
}

export function getDevelopmentIdentityOverrides(search: string, defaultStreamer: string, defaultEventSlug: string) {
  const query = new URLSearchParams(search);
  return {
    channelUsername: normalizeTwitchLogin(query.get("streamer") ?? defaultStreamer),
    eventSlug: normalizeEventSlug(query.get("event") ?? defaultEventSlug) || defaultEventSlug,
  };
}

export type OverlayDisplayMode = "hidden" | "prelaunch" | "live" | "paused";

export function getOverlayDisplayMode(
  identityStatus: OverlayIdentityStatus,
  eventStatus: EventStatus | null,
  eventPaused: boolean,
): OverlayDisplayMode {
  if (identityStatus !== "resolved") return "hidden";
  if (eventStatus === "draft" || eventStatus === "testing") return "prelaunch";
  if (eventStatus === "paused" || eventPaused) return "paused";
  return eventStatus === "active" ? "live" : "hidden";
}

function readNested(record: unknown, keys: string[]) {
  let value = record;
  for (const key of keys) {
    if (!value || typeof value !== "object" || !(key in value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function handleStreamElementsChatMessage(event: unknown, identity?: OverlayIdentityResolution) {
  if (identity?.status !== "resolved" || !identity.streamerId || !identity.eventId) {
    return { handled: false as const, reason: "identity-not-resolved" as const };
  }
  const listener = readNested(event, ["detail", "listener"]);
  if (listener !== "message") return { handled: false as const, reason: "not-chat-message" as const };
  const data = readNested(event, ["detail", "event", "data"]);
  const envelope = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const text = typeof envelope.text === "string" ? envelope.text : "";
  const tags = envelope.tags && typeof envelope.tags === "object"
    ? envelope.tags as Record<string, unknown>
    : {};
  const userId = String(envelope.userId ?? envelope.user_id ?? tags["user-id"] ?? "").trim();
  const messageId = String(envelope.msgId ?? envelope.msg_id ?? tags.id ?? "").trim();
  const displayName = String(envelope.displayName ?? envelope.display_name ?? envelope.nick ?? "").trim();
  if (!text || !userId) return { handled: false as const, reason: "invalid-chat-payload" as const };
  return {
    handled: true as const,
    streamerId: identity.streamerId,
    eventId: identity.eventId,
    userId,
    displayName,
    text,
    messageId: messageId || `se-${userId}-${Date.now()}`,
  };
}
