import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationUrl = new URL("supabase/migrations/202608110002_v0_3_twitch_awareness.sql", root);
const webhookUrl = new URL("supabase/functions/twitch-eventsub/index.ts", root);
const serviceUrl = new URL("supabase/functions/_shared/twitch-service.ts", root);
const syncUrl = new URL("supabase/functions/twitch-sync/index.ts", root);
const schedulerMigrationUrl = new URL("supabase/migrations/202608160002_enable_twitch_tracking_scheduler.sql", root);
const onboardingMigrationUrl = new URL("supabase/migrations/202608110003_zero_config_onboarding.sql", root);
const widgetUrl = new URL("streamelements-widget/widget.js", root);
const widgetFieldsUrl = new URL("streamelements-widget/fields.json", root);
const adminFunctionUrl = new URL("supabase/functions/admin-event-action/index.ts", root);

test("v0.3 migration contains private history, runtime and monitoring models with RLS", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "streamer_runtime", "stream_sessions", "viewer_samples", "raid_events", "twitch_eventsub_messages",
    "twitch_eventsub_subscriptions", "twitch_integration_status", "twitch_system_log",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /passive_damage_preview bigint[\s\S]*check \(passive_damage_preview is null\)/i);
  assert.doesNotMatch(sql, /perform public\.apply_boss_damage/i);
  assert.doesNotMatch(sql, /viewer_(user|login|identity)|twitch_viewer_id/i);
});

test("polling creates samples and sessions but preserves state on Twitch API failure", async () => {
  const source = await readFile(serviceUrl, "utf8");
  assert.match(source, /getStreamsByUserIds/);
  assert.match(source, /No state is mutated before all Twitch batches have completed successfully/);
  assert.ok(source.indexOf("getStreamsByUserIds") < source.indexOf('rpc("upsert_twitch_stream_snapshot"'));
  assert.match(source, /rpc\("mark_twitch_stream_offline"/);
  assert.match(source, /viewerSampleKey/);
});

test("EventSub streamer lookup selects the event relationship explicitly", async () => {
  const source = await readFile(serviceUrl, "utf8");
  assert.match(source, /events!streamers_event_id_fkey\(status\)/);
  assert.match(source, /safeTwitchError/);
});

test("EventSub verifies exact raw body, freshness and HMAC before parsing", async () => {
  const source = await readFile(webhookUrl, "utf8");
  const rawIndex = source.indexOf("await request.text()");
  const signatureIndex = source.indexOf("createEventSubSignature");
  const parseIndex = source.indexOf("JSON.parse(rawBody)");
  assert.ok(rawIndex >= 0 && signatureIndex >= 0 && parseIndex >= 0);
  assert.ok(rawIndex < parseIndex);
  assert.match(source, /isFreshEventSubTimestamp/);
  assert.match(source, /constantTimeEqual\(signature, expected\)/);
  assert.match(source, /webhook_callback_verification/);
  assert.match(source, /messageType === "revocation"/);
  assert.match(source, /claim_twitch_eventsub_message/);
  assert.match(source, /finish_twitch_eventsub_message/);
  assert.match(source, /stream\.online/);
  assert.match(source, /stream\.offline/);
  assert.match(source, /channel\.raid/);
});

test("scheduler endpoint requires service authorization and never accepts public Twitch secrets", async () => {
  const [source, schedulerSql] = await Promise.all([
    readFile(syncUrl, "utf8"),
    readFile(schedulerMigrationUrl, "utf8"),
  ]);
  assert.match(source, /Bearer \$\{SERVICE_ROLE_KEY\}/);
  assert.match(source, /TWITCH_SYNC_CRON_SECRET\.length >= 32/);
  assert.match(source, /constantTimeEqual/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_TWITCH/);
  assert.match(schedulerSql, /'\*\/2 \* \* \* \*'/);
  assert.match(schedulerSql, /twitch_sync_cron_secret/);
  assert.doesNotMatch(schedulerSql, /service_role_key|process-passive-tick|minion-tick/);
  const appSources = await Promise.all([
    "app/lib/types.ts", "app/lib/providers/supabase-data-provider.ts", "app/overlay/page.tsx",
  ].map((path) => readFile(new URL(path, root), "utf8")));
  assert.doesNotMatch(appSources.join("\n"), /TWITCH_CLIENT_SECRET|TWITCH_EVENTSUB_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
});

test("zero-config migration normalizes and uniquely scopes Twitch logins per event", async () => {
  const sql = await readFile(onboardingMigrationUrl, "utf8");
  assert.match(sql, /set twitch_login = lower\(btrim\(twitch_login\)\)/i);
  assert.match(sql, /unique index streamers_event_twitch_login_unique_idx[\s\S]*\(event_id, twitch_login\)/i);
  assert.match(sql, /duplicate_normalized_twitch_login/i);
  assert.match(sql, /function public\.resolve_stream_elements_identity\([\s\S]*security definer/i);
  assert.match(sql, /where event_id = v_event\.id and twitch_login = v_login/i);
  assert.match(sql, /'status', 'disabled'/i);
  assert.match(sql, /grant execute on function public\.resolve_stream_elements_identity\(text, text\) to anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.admin_set_event_status\(uuid, text\) to service_role/i);
  assert.match(sql, /set event_paused = false/i);
  const resolver = sql.slice(sql.indexOf("create or replace function public.resolve_stream_elements_identity"));
  assert.doesNotMatch(resolver, /insert into public\.streamers/i);
});

test("production StreamElements widget derives identity from channel.username with no visible identity fields", async () => {
  const [source, fields, adminSource] = await Promise.all([
    readFile(widgetUrl, "utf8"),
    readFile(widgetFieldsUrl, "utf8"),
    readFile(adminFunctionUrl, "utf8"),
  ]);
  const parsedFields = JSON.parse(fields);
  assert.equal(parsedFields.streamerSlug, undefined);
  assert.equal(parsedFields.eventSlug, undefined);
  assert.equal(parsedFields.twitchLogin, undefined);
  assert.match(source, /event\?\.detail\?\.channel\?\.username/);
  assert.match(source, /eventSlug: "__EVENT_SLUG__"/);
  assert.match(source, /resolve_stream_elements_identity/);
  assert.match(source, /item\.streamer_id === identity\.streamerId/);
  assert.match(source, /FALLBACK_REFRESH_MS/);
  assert.match(source, /get_stream_elements_widget_state/);
  assert.match(source, /fieldData/);
  assert.doesNotMatch(source, /insert.*streamer/i);
  assert.match(adminSource, /duplicate_twitch_login/);
  assert.match(adminSource, /normalizedTwitchLogin/);
  assert.match(adminSource, /rpc\("admin_set_event_status"/);
});
