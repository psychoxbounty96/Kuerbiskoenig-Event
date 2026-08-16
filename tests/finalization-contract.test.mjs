import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("finalization migration separates tracking, gameplay, public visibility and calibration", async () => {
  const sql = await readFile(new URL("supabase/migrations/202608160001_event_finalization.sql", root), "utf8");
  for (const column of ["tracking_enabled", "gameplay_enabled", "public_visible", "include_in_calibration"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column} boolean not null`, "i"));
  }
  assert.match(sql, /passive_damage_mode[^;]+disabled[^;]+dry_run[^;]+test[^;]+active/i);
  assert.match(sql, /create table if not exists public\.passive_damage_ticks/i);
  assert.match(sql, /unique\s*\(\s*event_id\s*,\s*run_id\s*,\s*streamer_id\s*,\s*bucket_started_at\s*\)/i);
  assert.match(sql, /stable_passive_viewer_estimate/i);
  assert.match(sql, /limit 3/i);
  assert.match(sql, /process_passive_damage_tick/i);
  assert.match(sql, /no_fresh_viewer_sample/i);
  assert.match(sql, /passive_damage_mode='dry_run'/i);
  assert.match(sql, /update public\.event_settings[^;]+passive_damage_enabled=false[^;]+passive_damage_mode='disabled'[^;]+e\.slug='halloween-2026'/is);
  assert.match(sql, /viewer_samples_calibration[^;]+source='twitch_api'[^;]+not s\.is_test_account[^;]+include_in_calibration/is);
  assert.match(sql, /revoke all on function public\.get_public_event_state_v4_unfiltered\(text\) from public,anon,authenticated/i);
  assert.match(sql, /s\.public_visible and s\.gameplay_enabled and not s\.is_test_account/i);
  assert.match(sql, /'average_viewers'[^;]+'median_viewers'[^;]+'peak_viewers'/is);
  assert.match(sql, /'streams_per_week'[^;]+'total_live_seconds'[^;]+'passive_damage_per_hour'/is);
});

test("passive endpoint is service-authorized and cannot accept a client damage value", async () => {
  const source = await readFile(new URL("supabase/functions/process-passive-tick/index.ts", root), "utf8");
  assert.match(source, /constantTimeEqual/);
  assert.match(source, /Bearer \$\{SERVICE_ROLE_KEY\}/);
  assert.match(source, /process_passive_damage_tick/);
  assert.doesNotMatch(source, /body\.(damage|amount|hp)/);
});

test("widget assets use a versioned HTTPS manifest with static and spritesheet runtime support", async () => {
  const [manifestText, widget, html] = await Promise.all([
    readFile(new URL("public/assets/widget-assets.json", root), "utf8"),
    readFile(new URL("streamelements-widget/widget.js", root), "utf8"),
    readFile(new URL("streamelements-widget/widget.html", root), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.version, 1);
  assert.match(manifest.boss.url, /^https:\/\//);
  assert.equal(Object.keys(manifest.minions).length, 7);
  assert.equal(Object.keys(manifest.curses).length, 7);
  assert.match(widget, /asset\.type [!=]==? "spritesheet"/);
  assert.match(widget, /backgroundPosition/);
  assert.match(widget, /requestAnimationFrame\(animateActors\)/);
  assert.match(widget, /document\.hidden/);
  assert.match(widget, /WIDGET_BUILD_VERSION/);
  assert.match(html, /id="boss-actor"/);
  assert.match(html, /id="minion-actor"/);
  for (const clip of ["idle", "hit", "heavy_hit", "phase_change", "attack", "laugh", "defeated", "prelaunch", "paused"]) {
    assert.ok(manifest.boss.clips[clip], `boss clip ${clip} missing`);
  }
  for (const clip of ["intro", "idle", "observe", "active", "success", "failure", "curse", "exit"]) {
    assert.ok(manifest.clipProfiles[manifest.minions.ghost.profile][clip], `minion clip ${clip} missing`);
  }
});

test("operator controls expose safe passive and tracking settings without client secrets", async () => {
  const [admin, action, provider] = await Promise.all([
    readFile(new URL("app/admin/page.tsx", root), "utf8"),
    readFile(new URL("supabase/functions/admin-event-action/index.ts", root), "utf8"),
    readFile(new URL("app/lib/providers/supabase-data-provider.ts", root), "utf8"),
  ]);
  assert.match(admin, /trackingEnabled/);
  assert.match(admin, /gameplayEnabled/);
  assert.match(admin, /includeInCalibration/);
  assert.match(admin, /adminRunPassiveTick/);
  assert.match(action, /run_passive_tick/);
  assert.match(provider, /passive_damage/);
  assert.doesNotMatch(`${admin}\n${provider}`, /SUPABASE_SERVICE_ROLE_KEY|TWITCH_CLIENT_SECRET|TWITCH_EVENTSUB_SECRET|MINION_PARTICIPANT_PEPPER/);
});
