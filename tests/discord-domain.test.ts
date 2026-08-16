import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiscordLiveAnnouncement,
  isDiscordIncomingWebhookUrl,
} from "../supabase/functions/_shared/discord-domain";

test("Discord incoming webhook URLs are restricted to official HTTPS endpoints", () => {
  assert.equal(isDiscordIncomingWebhookUrl("https://discord.com/api/webhooks/123456789012345678/token_value"), true);
  assert.equal(isDiscordIncomingWebhookUrl("http://discord.com/api/webhooks/123456789012345678/token_value"), false);
  assert.equal(isDiscordIncomingWebhookUrl("https://example.com/api/webhooks/123456789012345678/token_value"), false);
});

test("Discord live payload disables mentions and builds a Twitch embed", () => {
  const payload = buildDiscordLiveAnnouncement({
    displayName: "Knoobbi",
    twitchLogin: "knoobbi",
    twitchUrl: "https://twitch.tv/knoobbi",
    streamTitle: "Wir testen den Kürbiskönig!",
    gameName: "Just Chatting",
    thumbnailUrl: "https://static-cdn.jtvnw.net/previews-ttv/live_user_knoobbi-{width}x{height}.jpg",
    viewerCount: 23,
    startedAt: "2026-08-16T12:00:00.000Z",
  });
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.embeds[0].url, "https://twitch.tv/knoobbi");
  assert.match(payload.embeds[0].title, /Knoobbi ist jetzt live/);
  assert.equal(payload.embeds[0].image?.url.includes("1280x720"), true);
});
