import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("generic engine packages contain no Halloween event identities", async () => {
  const sources = await Promise.all([
    read("packages/pack-schema/src/index.ts"), read("packages/event-engine/src/minions.ts"),
    read("packages/event-engine/src/phases.ts"), read("packages/astro-integration/src/index.ts"),
  ]);
  assert.doesNotMatch(sources.join("\n"), /kürbis|halloween|ghost|kings_herald/i);
});

test("Supabase platform registers and applies versioned packs using event-scoped definitions", async () => {
  const sql = await read("supabase/migrations/202609060001_event_pack_platform.sql");
  assert.match(sql, /create table if not exists public\.event_pack_releases/i);
  assert.match(sql, /create or replace function public\.register_event_pack_release/i);
  assert.match(sql, /create or replace function public\.apply_event_pack/i);
  assert.match(sql, /create or replace function public\.create_event_from_pack/i);
  assert.match(sql, /runtime_generator/i);
  assert.match(sql, /raid_special_minion_key/i);
  assert.match(sql, /minion_spawn_windows/i);
});

test("StreamElements builds are pack-versioned and embed no privileged secret", async () => {
  const manifest = JSON.parse(await read("dist/streamelements/halloween-2026/test/manifest.json"));
  const js = await read("dist/streamelements/halloween-2026/test/js.js");
  assert.deepEqual(manifest.pack, { key: "halloween-2026", version: "1.0.0" });
  assert.match(js, /pack:\s*\{"schemaVersion":1/);
  assert.doesNotMatch(js, /SUPABASE_SERVICE_ROLE_KEY|TWITCH_CLIENT_SECRET|sb_secret_/i);
  assert.doesNotMatch(js, /localhost|127\.0\.0\.1|file:\/\//i);
});

test("Astro integration is headless and accepts an explicit event slug", async () => {
  const source = await read("packages/astro-integration/src/index.ts");
  assert.match(source, /eventSlug: string/);
  assert.match(source, /get_public_event_state/);
  assert.match(source, /postgres_changes/);
  assert.doesNotMatch(source, /halloween|kürbis/i);
});
