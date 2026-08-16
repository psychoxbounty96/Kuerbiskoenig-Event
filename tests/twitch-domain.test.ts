import assert from "node:assert/strict";
import test from "node:test";
import {
  extractStreamElementsChannelUsername,
  getDevelopmentIdentityOverrides,
  getOverlayDisplayMode,
  handleStreamElementsChatMessage,
  normalizeTwitchLogin,
  resolveParticipantIdentity,
} from "../app/lib/streamelements-adapter";
import { TwitchApiError, TwitchClient } from "../supabase/functions/_shared/twitch-client";
import {
  buildStreamSyncPlan,
  constantTimeEqual,
  createEventSubSignature,
  desiredEventSubSubscriptions,
  isFreshEventSubTimestamp,
  normalizeViewerCount,
  raidIsEligible,
  sampleBucket,
  viewerSampleKey,
} from "../supabase/functions/_shared/twitch-domain";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("Twitch resolution uses an app token, batches logins and reports unknown users as missing", async () => {
  const calls: string[] = [];
  const client = new TwitchClient(
    { clientId: "client-id", clientSecret: "client-secret" },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth2/token")) return jsonResponse({ access_token: "app-token", expires_in: 3_600 });
      const parsed = new URL(url);
      assert.deepEqual(parsed.searchParams.getAll("login"), ["known", "missing"]);
      return jsonResponse({ data: [{ id: "42", login: "known", display_name: "Known", profile_image_url: "" }] });
    },
  );
  const users = await client.resolveUsersByLogin(["Known", "missing"]);
  assert.deepEqual(users.map((user) => user.id), ["42"]);
  assert.equal(calls.filter((call) => call.includes("oauth2/token")).length, 1);
});

test("missing Twitch credentials fail before a network request", async () => {
  let called = false;
  const client = new TwitchClient({ clientId: "", clientSecret: "" }, async () => {
    called = true;
    return jsonResponse({});
  });
  await assert.rejects(() => client.resolveUsersByLogin(["known"]), (error: unknown) => {
    assert.ok(error instanceof TwitchApiError);
    assert.equal(error.code, "credentials_missing");
    return true;
  });
  assert.equal(called, false);
});

test("stream sync plan supports multiple live streams and explicit offline recovery", () => {
  const streamers = [
    { id: "a", twitch_user_id: "1" },
    { id: "b", twitch_user_id: "2" },
    { id: "c", twitch_user_id: "3" },
  ];
  const streams = [
    { id: "s1", user_id: "1", user_login: "a", user_name: "A", viewer_count: 12, started_at: "2026-01-01T10:00:00Z", type: "live" },
    { id: "s2", user_id: "2", user_login: "b", user_name: "B", viewer_count: 24, started_at: "2026-01-01T10:10:00Z", type: "live" },
  ];
  const plan = buildStreamSyncPlan(streamers, streams);
  assert.equal(plan.filter((item) => item.stream).length, 2);
  assert.equal(plan.find((item) => item.streamer.id === "c")?.stream, null);
});

test("viewer samples are non-negative and idempotent inside a two-minute bucket", () => {
  assert.equal(normalizeViewerCount(-5), 0);
  assert.equal(normalizeViewerCount(Number.NaN), 0);
  assert.equal(normalizeViewerCount(20.9), 20);
  assert.equal(sampleBucket("2026-08-11T12:03:59.000Z"), "2026-08-11T12:02:00.000Z");
  assert.equal(
    viewerSampleKey("stream-1", "2026-08-11T12:03:59.000Z"),
    viewerSampleKey("stream-1", "2026-08-11T12:02:01.000Z"),
  );
});

test("raid eligibility requires two different enabled event streamers", () => {
  const enabled = new Set(["from", "to"]);
  assert.equal(raidIsEligible("from", "to", enabled), true);
  assert.equal(raidIsEligible("external", "to", enabled), false);
  assert.equal(raidIsEligible("from", "external", enabled), false);
  assert.equal(raidIsEligible("from", "from", enabled), false);
});

test("EventSub desired set contains online, offline and separate raid directions", () => {
  const desired = desiredEventSubSubscriptions(["42"]);
  assert.equal(desired.length, 4);
  assert.deepEqual(desired.map((item) => item.type), ["stream.online", "stream.offline", "channel.raid", "channel.raid"]);
  assert.deepEqual(desired[2].condition, { from_broadcaster_user_id: "42" });
  assert.deepEqual(desired[3].condition, { to_broadcaster_user_id: "42" });
});

test("EventSub HMAC covers message id, timestamp and exact raw body", async () => {
  const timestamp = new Date().toISOString();
  const signature = await createEventSubSignature("0123456789abcdef", "message-1", timestamp, '{"x":1}');
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(constantTimeEqual(signature, signature), true);
  const differentLastCharacter = signature.endsWith("0") ? "1" : "0";
  assert.equal(constantTimeEqual(signature, `${signature.slice(0, -1)}${differentLastCharacter}`), false);
  assert.equal(isFreshEventSubTimestamp(timestamp), true);
  assert.equal(isFreshEventSubTimestamp("2020-01-01T00:00:00Z"), false);
});

const eventIdentity = {
  eventSlug: "halloween-2026",
  currentEventId: "event-1",
  currentEventSlug: "halloween-2026",
  currentEventStatus: "testing" as const,
  streamers: [
    { id: "streamer-1", slug: "knoobbi", displayName: "Knoobbi", twitchLogin: "knoobbi", enabled: true },
    { id: "streamer-2", slug: "disabled", displayName: "Disabled", twitchLogin: "disabled", enabled: false },
  ],
};

test("StreamElements resolves channel.username to the registered event participant", () => {
  const resolution = resolveParticipantIdentity({ ...eventIdentity, channelUsername: "knoobbi" });
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.streamerId, "streamer-1");
  assert.equal(resolution.streamerSlug, "knoobbi");
});

test("Twitch login normalization handles case and surrounding whitespace only", () => {
  assert.equal(normalizeTwitchLogin(" Knoobbi "), "knoobbi");
  assert.equal(resolveParticipantIdentity({ ...eventIdentity, channelUsername: "KNOOBBI" }).status, "resolved");
  assert.equal(resolveParticipantIdentity({ ...eventIdentity, channelUsername: " knoobbi " }).status, "resolved");
});

test("unknown and wrong-event channels are not registered", () => {
  assert.equal(resolveParticipantIdentity({ ...eventIdentity, channelUsername: "randomchannel" }).status, "not_registered");
  assert.equal(resolveParticipantIdentity({ ...eventIdentity, channelUsername: "knoobbi", eventSlug: "christmas-2026" }).status, "not_registered");
});

test("disabled participant is rejected without Twitch User ID dependency", () => {
  const resolution = resolveParticipantIdentity({ ...eventIdentity, channelUsername: "disabled" });
  assert.equal(resolution.status, "disabled");
  assert.equal(resolution.streamerId, null);
});

test("tracking-only participant cannot resolve as a gameplay widget", () => {
  const resolution = resolveParticipantIdentity({
    ...eventIdentity,
    channelUsername: "knoobbi",
    streamers: [{ ...eventIdentity.streamers[0], gameplayEnabled: false }],
  });
  assert.equal(resolution.status, "disabled");
});

test("duplicate normalized login fails closed instead of selecting randomly", () => {
  const resolution = resolveParticipantIdentity({
    ...eventIdentity,
    channelUsername: "Knoobbi",
    streamers: [...eventIdentity.streamers, { id: "streamer-3", slug: "duplicate", displayName: "Duplicate", twitchLogin: " KNOOBBI ", enabled: true }],
  });
  assert.equal(resolution.status, "error");
  assert.equal(resolution.streamerId, null);
});

test("widget load without channel username fails closed", () => {
  assert.equal(extractStreamElementsChannelUsername({ detail: { channel: {} } }), "");
  assert.equal(resolveParticipantIdentity({ ...eventIdentity, channelUsername: "" }).status, "error");
});

test("onWidgetLoad channel extraction is normalized", () => {
  assert.equal(extractStreamElementsChannelUsername({ detail: { channel: { username: " Knoobbi " } } }), "knoobbi");
});

test("event activation, pause and resume change display mode without changing identity", () => {
  const identity = resolveParticipantIdentity({ ...eventIdentity, channelUsername: "knoobbi" });
  assert.equal(getOverlayDisplayMode(identity.status, "testing", false), "prelaunch");
  assert.equal(getOverlayDisplayMode(identity.status, "active", false), "live");
  assert.equal(getOverlayDisplayMode(identity.status, "active", true), "paused");
  assert.equal(getOverlayDisplayMode(identity.status, "active", false), "live");
  assert.equal(identity.streamerId, "streamer-1");
});

test("development query override remains explicit preview-only input", () => {
  assert.deepEqual(getDevelopmentIdentityOverrides("?streamer=Knoobbi&event=halloween-2026", "", "fallback-event"), {
    channelUsername: "knoobbi",
    eventSlug: "halloween-2026",
  });
});

test("chat adapter carries the resolved streamer identity into a valid v0.4 action", () => {
  const identity = resolveParticipantIdentity({ ...eventIdentity, channelUsername: "knoobbi" });
  assert.deepEqual(handleStreamElementsChatMessage({ detail: { listener: "message", event: { data: {
    userId: "twitch-user-1", displayName: "Viewer", text: "!boss B", msgId: "message-1",
  } } } }, identity), {
    handled: true,
    streamerId: "streamer-1",
    eventId: eventIdentity.currentEventId,
    userId: "twitch-user-1",
    displayName: "Viewer",
    text: "!boss B",
    messageId: "message-1",
  });
  assert.deepEqual(handleStreamElementsChatMessage({}), { handled: false, reason: "identity-not-resolved" });
});
