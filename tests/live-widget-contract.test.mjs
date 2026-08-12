import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readinessMigration = new URL("supabase/migrations/202608120001_live_widget_readiness.sql", root);
const testEventDataMigration = new URL("supabase/migrations/202608120002_live_widget_test_event_data.sql", root);
const testActionFunction = new URL("supabase/functions/widget-test-action/index.ts", root);

async function widgetVariant(name) {
  const base = new URL(`dist/streamelements/${name}/`, root);
  const [html, css, js, fields, manifest] = await Promise.all([
    readFile(new URL("html.html", base), "utf8"),
    readFile(new URL("css.css", base), "utf8"),
    readFile(new URL("js.js", base), "utf8"),
    readFile(new URL("fields.json", base), "utf8"),
    readFile(new URL("manifest.json", base), "utf8"),
  ]);
  return { html, css, js, fields: JSON.parse(fields), manifest: JSON.parse(manifest) };
}

test("standalone StreamElements builds contain no local runtime or unresolved module dependency", async () => {
  for (const name of ["production", "test"]) {
    const built = await widgetVariant(name);
    const all = `${built.html}\n${built.css}\n${built.js}\n${JSON.stringify(built.fields)}`;
    assert.doesNotMatch(all, /__SUPABASE_|__EVENT_|__ASSET_|__BOSS_|__TEST_/);
    assert.doesNotMatch(all, /localhost|127\.0\.0\.1|file:\/\//i);
    assert.doesNotMatch(all, /\bimport\s|\brequire\s*\(|\bprocess\./);
    assert.doesNotMatch(all, /SUPABASE_SERVICE_ROLE_KEY|TWITCH_CLIENT_SECRET|MINION_PARTICIPANT_PEPPER|sb_secret_/i);
    assert.match(built.html, /pumpkin-widget/);
    assert.match(built.html, /boss-artwork/);
    assert.match(built.js, /bossAsset: "https:\/\//);
    assert.equal(built.manifest.variant, name);
  }
});

test("production fields contain only visual controls while test build exposes documented widget buttons", async () => {
  const production = await widgetVariant("production");
  const testing = await widgetVariant("test");
  assert.equal(Object.values(production.fields).some((field) => field.type === "button"), false);
  assert.equal(production.fields.streamerSlug, undefined);
  assert.equal(production.fields.eventSlug, undefined);
  for (const key of [
    "testBossHit", "testBossBigHit", "testResetBoss", "testPhase1", "testPhase4",
    "testSpawnGhost", "testSpawnZombie", "testSpawnSpider", "testSpawnWitch", "testSpawnBats",
    "testSpawnReaper", "testSpawnHerald", "testForceSuccess", "testForceFailure", "testCancelMinion",
    "testExpireMinion", "testFog", "testZombieHands", "testSpiderWeb", "testWitchDistortion",
    "testBatAttack", "testDarkness", "testRoyalCurse", "testRaid", "testHeraldNow",
  ]) assert.equal(testing.fields[key].type, "button", `${key} should be a StreamElements button field`);
  assert.match(production.js, /eventSlug: "halloween-2026"/);
  assert.match(testing.js, /eventSlug: "halloween-2026-test"/);
});

test("test accounts are explicit, event scoped and excluded from public statistics", async () => {
  const sql = await readFile(readinessMigration, "utf8");
  assert.match(sql, /add column if not exists is_test_account boolean not null default false/i);
  assert.match(sql, /test_actions_authorized[^;]+is_test_account[^;]+status = 'testing'/is);
  assert.match(sql, /get_stream_elements_widget_state/i);
  assert.match(sql, /not coalesce\(s\.is_test_account,false\)/i);
  assert.match(sql, /viewer_samples_calibration[\s\S]+source='twitch_api'[\s\S]+not s\.is_test_account/i);
});

test("dedicated test event receives the complete v0.4 engine configuration without production mutation", async () => {
  const sql = await readFile(testEventDataMigration, "utf8");
  assert.match(sql, /where e\.slug='halloween-2026-test'/i);
  assert.doesNotMatch(sql, /where e\.slug='halloween-2026'/i);
  for (const key of ["ghost", "zombie_horde", "spider_queen", "witch", "bat_swarm", "reaper", "kings_herald"]) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  for (const key of ["fog", "zombie_hands", "spider_web", "witch_distortion", "bat_attack", "darkness", "royal_curse"]) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  for (const damageClass of ["STANDARD", "HIGH", "ELITE", "SPECIAL"]) {
    assert.match(sql, new RegExp(`'${damageClass}'`));
  }
});

test("widget test actions derive authority server side and cannot accept client damage or HP", async () => {
  const source = await readFile(testActionFunction, "utf8");
  assert.match(source, /event\.status !== "testing"/);
  assert.match(source, /!streamer\?\.enabled \|\| !streamer\.is_test_account/);
  assert.match(source, /forbiddenAuthorityFields/);
  assert.match(source, /"damage", "amount", "hp"/);
  assert.match(source, /rpc\("apply_boss_damage"/);
  assert.match(source, /rpc\("spawn_minion_v4"/);
  assert.match(source, /rpc\("resolve_minion_v4"/);
  assert.match(source, /source: "manual_test"/);
  assert.doesNotMatch(source, /body\.amount|body\.damage|body\.hp|body\.resolution/);
});

test("real widget lifecycle uses StreamElements events, Supabase Realtime, fallback and server chat action", async () => {
  const testing = await widgetVariant("test");
  assert.match(testing.js, /onWidgetLoad/);
  assert.match(testing.js, /detail\?\.channel\?\.username/);
  assert.match(testing.js, /onEventReceived/);
  assert.match(testing.js, /listener === "widget-button"/);
  assert.match(testing.js, /listener === "message"/);
  assert.match(testing.js, /postgres_changes/);
  assert.match(testing.js, /get_stream_elements_widget_state/);
  assert.match(testing.js, /functions\/v1\/minion-action/);
  assert.match(testing.js, /functions\/v1\/widget-test-action/);
  assert.match(testing.js, /FALLBACK_REFRESH_MS/);
  assert.match(testing.js, /lastSafeState/);
  assert.match(testing.js, /await detectEditorMode\(\)/);
  assert.match(testing.css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/i);
  assert.match(testing.css, /\.minion-card\s*\{[^}]*position:\s*fixed/is);
  assert.match(testing.css, /@keyframes bats-across-screen/);
  assert.match(testing.js, /renderedMinionSignature/);
  assert.match(testing.js, /MINION_ARTWORK_CACHE/);
  assert.match(testing.js, /minion-progress/);
});
