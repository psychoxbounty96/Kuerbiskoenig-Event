import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationUrl = new URL("supabase/migrations/202608160003_discord_live_announcements.sql", root);
const serviceUrl = new URL("supabase/functions/_shared/discord-announcements.ts", root);
const domainUrl = new URL("supabase/functions/_shared/discord-domain.ts", root);
const twitchServiceUrl = new URL("supabase/functions/_shared/twitch-service.ts", root);
const eventSubUrl = new URL("supabase/functions/twitch-eventsub/index.ts", root);

test("Discord announcement outbox is private, idempotent and excludes non-public/test streamers", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table if not exists public\.discord_stream_announcements/i);
  assert.match(sql, /unique \(event_id, streamer_id, twitch_stream_id, discord_channel_id\)/i);
  assert.match(sql, /e\.status='active'/i);
  assert.match(sql, /s\.gameplay_enabled and s\.public_visible and not s\.is_test_account/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.discord_stream_announcements from public, anon, authenticated/i);
});

test("Discord sending stays server-side and is called by EventSub plus polling recovery", async () => {
  const [service, domain, polling, eventsub] = await Promise.all([
    readFile(serviceUrl, "utf8"),
    readFile(domainUrl, "utf8"),
    readFile(twitchServiceUrl, "utf8"),
    readFile(eventSubUrl, "utf8"),
  ]);
  assert.match(service, /DISCORD_ANNOUNCEMENT_WEBHOOK_URL/);
  assert.match(domain, /allowed_mentions/);
  assert.match(service, /claim_discord_stream_announcement/);
  assert.match(service, /finish_discord_stream_announcement/);
  assert.match(polling, /maybeSendDiscordLiveAnnouncement/);
  assert.match(eventsub, /maybeSendDiscordLiveAnnouncement/);
  assert.doesNotMatch(
    service + domain + polling + eventsub,
    /https:\/\/(?:www\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]{20,}/,
  );
});
