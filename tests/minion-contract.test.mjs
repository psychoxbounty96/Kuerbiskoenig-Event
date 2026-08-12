import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationUrl = new URL("supabase/migrations/202608110004_v0_4_minion_engine.sql", root);
const actionUrl = new URL("supabase/functions/minion-action/index.ts", root);
const tickUrl = new URL("supabase/functions/minion-tick/index.ts", root);
const widgetUrl = new URL("streamelements-widget/widget.js", root);

test("v0.4 migration defines generic runtime, private participants, scheduler and all seven definitions", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["curse_definitions","minion_damage_classes","minion_questions","minion_event_secrets","minion_participants","minion_system_log","minion_spawn_schedules","minion_special_queue"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  for (const key of ["ghost","zombie_horde","spider_queen","witch","bat_swarm","reaper","kings_herald"]) assert.match(sql, new RegExp(`'${key}'`));
  for (const status of ["scheduled","intro","active","success","failure","curse","complete","cancelled","expired"]) assert.match(sql, new RegExp(`'${status}'`));
  assert.match(sql, /unique \(minion_event_id, participant_key\)/i);
  assert.match(sql, /status in \('intro','active','success','failure','curse'\)/i);
  assert.match(sql, /percentile_cont\(0\.5\)/i);
  assert.match(sql, /raid_special_delay_min_seconds[\s\S]*default 90/i);
  assert.match(sql, /raid_special_delay_max_seconds[\s\S]*default 120/i);
  assert.doesNotMatch(sql, /boss_heal|current_hp\s*=\s*current_hp\s*\+/i);
});

test("chat submission validates scope, time, dedupe, rate and never accepts client damage", async () => {
  const [sql, source] = await Promise.all([readFile(migrationUrl, "utf8"), readFile(actionUrl, "utf8")]);
  const submit = sql.slice(sql.indexOf("create or replace function public.submit_minion_action"), sql.indexOf("create or replace function public.advance_minion_engine"));
  assert.match(submit, /event_id=p_event_id and streamer_id=p_streamer_id for update/i);
  assert.match(submit, /now\(\) < v_minion\.accepts_answers_at or now\(\) >= v_minion\.expires_at/i);
  assert.match(submit, /on conflict do nothing returning id into v_inserted/i);
  assert.match(submit, /v_requests > 8/i);
  assert.match(source, /hasForbiddenDamageField/);
  assert.match(source, /HMAC/);
  assert.match(source, /MINION_PARTICIPANT_PEPPER/);
  assert.doesNotMatch(source, /displayName|twitch_login/i);
});

test("damage is class-based and server authoritative with idempotent boss mutation", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const resolve = sql.slice(sql.indexOf("create or replace function public.resolve_minion_v4"), sql.indexOf("create or replace function public.submit_minion_action"));
  assert.match(resolve, /from public\.minion_damage_classes/i);
  assert.match(resolve, /public\.apply_boss_damage/i);
  assert.match(resolve, /'minion:'\|\|v_minion\.id::text/i);
  assert.match(resolve, /v_minion\.viewer_estimate/i);
  assert.doesNotMatch(resolve, /p_damage|p_raw_damage/i);
});

test("tick is service-only and cancellation guards cover pause, offline, disable and boss kill", async () => {
  const [sql, source] = await Promise.all([readFile(migrationUrl, "utf8"), readFile(tickUrl, "utf8")]);
  assert.match(source, /authorization !== `Bearer \$\{SERVICE_ROLE_KEY\}`/);
  assert.match(sql, /event_settings_cancel_minions/i);
  assert.match(sql, /streamer_runtime_cancel_minions/i);
  assert.match(sql, /streamers_cancel_minions/i);
  assert.match(sql, /bosses_cancel_minions/i);
  assert.match(sql, /status='cancelled'/i);
});

test("StreamElements widget handles chat, server timestamps, realtime and exact streamer scoping", async () => {
  const source = await readFile(widgetUrl, "utf8");
  assert.match(source, /onEventReceived/);
  assert.match(source, /listener==="message"/);
  assert.match(source, /minion-action/);
  assert.match(source, /milliseconds\(minion\.expires_at\)-now/i);
  assert.match(source, /item\.streamer_id===identity\.streamerId/);
  assert.match(source, /postgres_changes/);
  assert.match(source, /FALLBACK_REFRESH_MS/);
  assert.doesNotMatch(source, /damage\s*:/i);
});

test("all seven minions ship mapped placeholder artwork for Pages and StreamElements", async () => {
  const source = await readFile(widgetUrl, "utf8");
  const folders = ["ghost", "zombie", "spider", "witch", "bats", "reaper", "herald"];
  for (const folder of folders) {
    const file = new URL(`assets/minions/${folder}/placeholder.jpg`, root);
    assert.ok((await stat(file)).size > 50_000, `${folder} artwork should be a real image`);
    assert.match(source, new RegExp(folder));
  }
  assert.match(source, /MINION_ARTWORK_BASE/);
  assert.match(source, /psychoxbounty96\.github\.io\/Kuerbiskoenig-Event\/assets\/minions/);
  assert.match(source, /function minionArtwork/);
});
