import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("clean installation removes prototype runtime and administrator data", async () => {
  const sql = await read("supabase/migrations/202609060101_clean_engine_installation.sql");
  assert.match(sql, /truncate table[^;]+restart identity cascade/is);
  assert.match(sql, /delete from auth\.users/i);
  assert.match(sql, /cron\.unschedule/i);
});

test("clean installation has no automatic seed event", async () => {
  const config = await read("supabase/config.toml");
  const seedFiles = await readdir(new URL("supabase/seed/", root)).catch(() => []);
  assert.match(config, /\[db\.seed\][\s\S]*enabled = false/);
  assert.deepEqual(seedFiles.filter((name) => name.endsWith(".sql")), []);
});

test("widget is product-named and pack-bound at build time", async () => {
  const manifest = JSON.parse(await read("dist/streamelements/halloween-2026/production/manifest.json"));
  const html = await read("dist/streamelements/halloween-2026/production/html.html");
  assert.match(manifest.name, /^PXB Event Engine Widget/);
  assert.equal(manifest.engine, "pxb-community-event-engine");
  assert.equal(manifest.version, 4);
  assert.match(html, /id="pxb-event-engine-widget"/);
});
