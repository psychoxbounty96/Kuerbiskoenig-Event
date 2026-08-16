import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "streamelements-widget");
const outputRoot = path.join(root, "dist", "streamelements");
const publicConfigPath = path.join(sourceDir, "public-config.json");

const publicConfig = JSON.parse(await readFile(publicConfigPath, "utf8"));
const supabaseUrl = process.env.WIDGET_SUPABASE_URL || process.env.VITE_SUPABASE_URL || publicConfig.supabaseUrl;
const publishableKey = process.env.WIDGET_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || publicConfig.publishableKey;
const assetBase = process.env.WIDGET_ASSET_BASE || publicConfig.assetBase;
const bossAsset = process.env.WIDGET_BOSS_ASSET || publicConfig.bossAsset;
const assetManifest = process.env.WIDGET_ASSET_MANIFEST || publicConfig.assetManifest;
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const widgetBuildVersion = String(packageMetadata.version || "dev");

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "")) throw new Error("Invalid WIDGET_SUPABASE_URL.");
if (!publishableKey || /REPLACE_ME|YOUR_PROJECT/.test(publishableKey)) throw new Error("WIDGET_SUPABASE_PUBLISHABLE_KEY is missing.");
if (!/^https:\/\//.test(assetBase || "")) throw new Error("Invalid WIDGET_ASSET_BASE.");
if (!/^https:\/\//.test(bossAsset || "")) throw new Error("Invalid WIDGET_BOSS_ASSET.");
if (!/^https:\/\//.test(assetManifest || "")) throw new Error("Invalid WIDGET_ASSET_MANIFEST.");

const [html, css, jsTemplate, visualFields] = await Promise.all([
  readFile(path.join(sourceDir, "widget.html"), "utf8"),
  readFile(path.join(sourceDir, "widget.css"), "utf8"),
  readFile(path.join(sourceDir, "widget.js"), "utf8"),
  readFile(path.join(sourceDir, "fields.json"), "utf8").then(JSON.parse),
]);

const button = (label, group) => ({ type: "button", label, value: label, group });
const testFields = {
  ...visualFields,
  showDebugPanel: { ...visualFields.showDebugPanel, value: true },
  testReloadState: button("Reload Boss State", "🧪 GENERAL TESTS"),
  testRunTick: button("Run Minion Tick", "🧪 GENERAL TESTS"),
  testViewerSample: button("Create Test Viewer Sample", "🧪 GENERAL TESTS"),
  testPassiveTick: button("Run Passive Damage Tick", "🧪 GENERAL TESTS"),
  testBossHit: button("Test Boss Hit (-1,000)", "👑 BOSS TESTS"),
  testBossBigHit: button("Test Boss Big Hit (-25,000)", "👑 BOSS TESTS"),
  testResetBoss: button("Reset Test Boss", "👑 BOSS TESTS"),
  testPhase1: button("Phase I", "👑 BOSS TESTS"),
  testPhase2: button("Phase II", "👑 BOSS TESTS"),
  testPhase3: button("Phase III", "👑 BOSS TESTS"),
  testPhase4: button("Phase IV", "👑 BOSS TESTS"),
  testSpawnGhost: button("Spawn Ghost", "👻 MINION TESTS"),
  testSpawnZombie: button("Spawn Zombie Horde", "👻 MINION TESTS"),
  testSpawnSpider: button("Spawn Spider Queen", "👻 MINION TESTS"),
  testSpawnWitch: button("Spawn Witch", "👻 MINION TESTS"),
  testSpawnBats: button("Spawn Bat Swarm", "👻 MINION TESTS"),
  testSpawnReaper: button("Spawn Reaper", "👻 MINION TESTS"),
  testSpawnHerald: button("Spawn Raid Herald", "👻 MINION TESTS"),
  testForceSuccess: button("Force Current Minion Success", "👻 MINION TESTS"),
  testForceFailure: button("Force Current Minion Failure", "👻 MINION TESTS"),
  testCancelMinion: button("Cancel Current Minion", "👻 MINION TESTS"),
  testExpireMinion: button("Expire Current Minion", "👻 MINION TESTS"),
  testRaid: button("Simulate Eligible Raid", "👻 MINION TESTS"),
  testHeraldNow: button("Spawn Herald Now", "👻 MINION TESTS"),
  testFog: button("Test Fog (visual only)", "🌫 CURSE TESTS"),
  testZombieHands: button("Test Zombie Hands (visual only)", "🌫 CURSE TESTS"),
  testSpiderWeb: button("Test Spider Web (visual only)", "🌫 CURSE TESTS"),
  testWitchDistortion: button("Test Witch Distortion (visual only)", "🌫 CURSE TESTS"),
  testBatAttack: button("Test Bat Attack (visual only)", "🌫 CURSE TESTS"),
  testDarkness: button("Test Darkness (visual only)", "🌫 CURSE TESTS"),
  testRoyalCurse: button("Test Royal Curse (visual only)", "🌫 CURSE TESTS"),
};

const variants = [
  { name: "production", eventSlug: "halloween-2026", testControls: false, fields: visualFields },
  { name: "test", eventSlug: "halloween-2026-test", testControls: true, fields: testFields },
];

function assertBalanced(value, open, close, label) {
  let depth = 0;
  for (const character of value) {
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth < 0) throw new Error(`${label} has an unmatched ${close}.`);
  }
  if (depth !== 0) throw new Error(`${label} has unbalanced ${open}${close}.`);
}

function validateBuild(contents, variant) {
  const combined = `${contents.html}\n${contents.css}\n${contents.js}\n${contents.fields}`;
  const forbidden = [
    [/__SUPABASE_|__EVENT_|__ASSET_|__BOSS_|__TEST_|__WIDGET_/, "unresolved build token"],
    [/\blocalhost\b|127\.0\.0\.1|file:\/\//i, "local runtime URL"],
    [/\bimport\s+(?:[^.(]|\()/, "unresolved import"],
    [/\brequire\s*\(/, "CommonJS require"],
    [/\bprocess\./, "Node process API"],
    [/SUPABASE_SERVICE_ROLE_KEY|TWITCH_CLIENT_SECRET|TWITCH_EVENTSUB_SECRET|MINION_PARTICIPANT_PEPPER|sb_secret_/i, "secret material"],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(combined)) throw new Error(`${variant}: ${label} found.`);
  }
  if (!contents.html.includes('id="pumpkin-widget"')) throw new Error(`${variant}: widget root missing.`);
  assertBalanced(contents.css, "{", "}", `${variant} CSS`);
  new Function(contents.js);
  JSON.parse(contents.fields);
}

await rm(outputRoot, { recursive: true, force: true });

for (const variant of variants) {
  const outputDir = path.join(outputRoot, variant.name);
  const js = jsTemplate
    .replaceAll("__SUPABASE_URL__", supabaseUrl)
    .replaceAll("__SUPABASE_PUBLISHABLE_KEY__", publishableKey)
    .replaceAll("__EVENT_SLUG__", variant.eventSlug)
    .replaceAll("__ASSET_BASE__", assetBase)
    .replaceAll("__BOSS_ASSET__", bossAsset)
    .replaceAll("__ASSET_MANIFEST__", assetManifest)
    .replaceAll("__WIDGET_BUILD_VERSION__", widgetBuildVersion)
    .replaceAll("__TEST_CONTROLS__", String(variant.testControls));
  const fields = `${JSON.stringify(variant.fields, null, 2)}\n`;
  const manifest = `${JSON.stringify({
    format: "streamelements-custom-widget",
    version: 2,
    buildVersion: widgetBuildVersion,
    variant: variant.name,
    eventSlug: variant.eventSlug,
    testControls: variant.testControls,
    files: { html: "html.html", css: "css.css", js: "js.js", fields: "fields.json" },
  }, null, 2)}\n`;
  validateBuild({ html, css, js, fields }, variant.name);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, "html.html"), html, "utf8"),
    writeFile(path.join(outputDir, "css.css"), css, "utf8"),
    writeFile(path.join(outputDir, "js.js"), js, "utf8"),
    writeFile(path.join(outputDir, "fields.json"), fields, "utf8"),
    writeFile(path.join(outputDir, "manifest.json"), manifest, "utf8"),
  ]);
}

console.log("StreamElements builds created: dist/streamelements/{production,test}");
