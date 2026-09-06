import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validatePack } from "./validate-packs.mjs";

const root = process.cwd();
const sourceDir = path.join(root, "streamelements-widget");
const outputRoot = path.join(root, "dist", "streamelements");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const availablePacks = (await readdir(path.join(root, "event-packs"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const packKey = option("--pack") || process.env.EVENT_PACK_KEY || availablePacks[0];
const requestedEvent = option("--event") || process.env.EVENT_SLUG;
const requestedVariant = option("--variant");
const packPath = path.join(root, "event-packs", packKey, "pack.json");
const pack = validatePack(JSON.parse(await readFile(packPath, "utf8")), packKey);
const publicConfig = JSON.parse(await readFile(path.join(sourceDir, "public-config.json"), "utf8"));
const supabaseUrl = process.env.WIDGET_SUPABASE_URL || process.env.VITE_SUPABASE_URL || publicConfig.supabaseUrl;
const publishableKey = process.env.WIDGET_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || publicConfig.publishableKey;
const assetRoot = (process.env.WIDGET_ASSET_ROOT || publicConfig.assetRoot || "").replace(/\/$/, "");
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const widgetBuildVersion = String(packageMetadata.version || "dev");

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "")) throw new Error("Invalid WIDGET_SUPABASE_URL.");
if (!publishableKey || /REPLACE_ME|YOUR_PROJECT|sb_secret_/i.test(publishableKey)) throw new Error("A browser-safe publishable key is required.");
if (!/^https:\/\//.test(assetRoot)) throw new Error("Invalid WIDGET_ASSET_ROOT.");

const absoluteUrl = (value) => /^https:\/\//.test(value || "") ? value : `${assetRoot}/${pack.key}/${pack.version}/${String(value || "").replace(/^\//, "")}`;
const absoluteAsset = (value) => {
  if (typeof value === "string") return { type: "static", url: absoluteUrl(value), fallbackUrl: absoluteUrl(value) };
  if (!value || value.type === "css") return { type: "css" };
  return {
    ...value,
    url: absoluteUrl(value.source),
    fallbackUrl: value.fallbackSource ? absoluteUrl(value.fallbackSource) : undefined,
    source: undefined,
    fallbackSource: undefined,
  };
};
const widgetPack = {
  schemaVersion: pack.schemaVersion,
  key: pack.key,
  version: pack.version,
  name: pack.name,
  theme: pack.theme,
  boss: { ...pack.boss, asset: absoluteAsset(pack.boss.asset) },
  minions: pack.minions.map((minion) => ({
    key: minion.key, name: minion.name, icon: minion.icon, command: minion.command,
    presentation: minion.presentation, asset: absoluteAsset(minion.asset),
  })),
  effects: pack.effects.map((effect) => ({
    key: effect.key, name: effect.name, durationMs: effect.durationMs,
    presentation: effect.presentation, asset: effect.asset ? absoluteAsset(effect.asset) : null,
  })),
};

const [html, css, jsTemplate, visualFields] = await Promise.all([
  readFile(path.join(sourceDir, "widget.html"), "utf8"),
  readFile(path.join(sourceDir, "widget.css"), "utf8"),
  readFile(path.join(sourceDir, "widget.js"), "utf8"),
  readFile(path.join(sourceDir, "fields.json"), "utf8").then(JSON.parse),
]);

const button = (label, group) => ({ type: "button", label, value: label, group });
const fixedButtons = {
  testReloadState: ["Reload Boss State", "🧪 GENERAL TESTS", { action: "reload_state" }],
  testRunTick: ["Run Encounter Tick", "🧪 GENERAL TESTS", { action: "tick" }],
  testViewerSample: ["Create Test Viewer Sample", "🧪 GENERAL TESTS", { action: "create_test_viewer_sample" }],
  testPassiveTick: ["Run Passive Damage Tick", "🧪 GENERAL TESTS", { action: "test_passive_tick" }],
  testBossHit: ["Test Boss Hit (-1,000)", "👑 BOSS TESTS", { action: "test_boss_hit" }],
  testBossBigHit: ["Test Boss Big Hit (-25,000)", "👑 BOSS TESTS", { action: "test_boss_big_hit" }],
  testResetBoss: ["Reset Test Boss", "👑 BOSS TESTS", { action: "reset_test_boss" }],
  testForceSuccess: ["Force Current Encounter Success", "⚔️ ENCOUNTER TESTS", { action: "force_minion_success" }],
  testForceFailure: ["Force Current Encounter Failure", "⚔️ ENCOUNTER TESTS", { action: "force_minion_failure" }],
  testCancelMinion: ["Cancel Current Encounter", "⚔️ ENCOUNTER TESTS", { action: "cancel_minion" }],
  testExpireMinion: ["Expire Current Encounter", "⚔️ ENCOUNTER TESTS", { action: "expire_minion" }],
  testRaid: ["Simulate Eligible Raid", "⚔️ ENCOUNTER TESTS", { action: "simulate_eligible_raid" }],
  testSpecialNow: ["Spawn Raid Special Now", "⚔️ ENCOUNTER TESTS", { action: "spawn_raid_special_now" }],
};
const testFields = { ...visualFields, showDebugPanel: { ...visualFields.showDebugPanel, value: true } };
const buttonActions = {};
for (const [field, [label, group, descriptor]] of Object.entries(fixedButtons)) {
  testFields[field] = button(label, group);
  buttonActions[field] = descriptor;
}
for (const phase of pack.boss.phases) {
  const field = `testPhase_${phase.id}`;
  testFields[field] = button(`Phase ${phase.id}: ${phase.name}`, "👑 BOSS TESTS");
  buttonActions[field] = { action: "set_phase", phaseId: phase.id };
}
for (const minion of pack.minions) {
  const field = `testEncounter_${minion.key.replace(/[^a-z0-9_]/gi, "_")}`;
  testFields[field] = button(`${minion.icon} ${minion.name}`, "⚔️ ENCOUNTER TESTS");
  buttonActions[field] = { action: "spawn_minion", definitionKey: minion.key };
}
for (const effect of pack.effects) {
  const field = `testEffect_${effect.key.replace(/[^a-z0-9_]/gi, "_")}`;
  testFields[field] = button(`Test ${effect.name} (visual only)`, "✨ EFFECT TESTS");
  buttonActions[field] = { action: "test_effect", effectKey: effect.key };
}

let targets = pack.events;
if (requestedEvent) targets = targets.filter((target) => target.slug === requestedEvent);
if (requestedVariant) targets = targets.filter((target) => target.variant === requestedVariant);
if (!targets.length) throw new Error("No widget target matches the requested pack/event/variant.");

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
    [/__[A-Z][A-Z0-9_]+__/, "unresolved build token"],
    [/\blocalhost\b|127\.0\.0\.1|file:\/\//i, "local runtime URL"],
    [/\bimport\s+(?:[^.(]|\()/, "unresolved import"],
    [/\brequire\s*\(/, "CommonJS require"],
    [/\bprocess\./, "Node process API"],
    [/SUPABASE_SERVICE_ROLE_KEY|TWITCH_CLIENT_SECRET|TWITCH_EVENTSUB_SECRET|MINION_PARTICIPANT_PEPPER|sb_secret_/i, "secret material"],
  ];
  for (const [pattern, label] of forbidden) if (pattern.test(combined)) throw new Error(`${variant}: ${label} found.`);
  if (!contents.html.includes('id="pxb-event-engine-widget"')) throw new Error(`${variant}: widget root missing.`);
  assertBalanced(contents.css, "{", "}", `${variant} CSS`);
  new Function(contents.js);
  JSON.parse(contents.fields);
}

await rm(path.join(outputRoot, pack.key), { recursive: true, force: true });
for (const target of targets) {
  const outputDir = path.join(outputRoot, pack.key, target.variant);
  const fieldsObject = target.testControls ? testFields : visualFields;
  const actions = target.testControls ? buttonActions : {};
  const js = jsTemplate
    .replaceAll("__SUPABASE_URL__", supabaseUrl)
    .replaceAll("__SUPABASE_PUBLISHABLE_KEY__", publishableKey)
    .replaceAll("__EVENT_SLUG__", target.slug)
    .replaceAll("__PACK_MANIFEST__", JSON.stringify(widgetPack))
    .replaceAll("__BUTTON_ACTIONS__", JSON.stringify(actions))
    .replaceAll("__WIDGET_BUILD_VERSION__", widgetBuildVersion)
    .replaceAll("__TEST_CONTROLS__", String(target.testControls));
  const fields = `${JSON.stringify(fieldsObject, null, 2)}\n`;
  const manifest = `${JSON.stringify({
    name: `PXB Event Engine Widget — ${pack.name}`,
    engine: "pxb-community-event-engine",
    format: "streamelements-custom-widget", version: 4, buildVersion: widgetBuildVersion,
    pack: { key: pack.key, version: pack.version }, variant: target.variant, eventSlug: target.slug,
    testControls: target.testControls, files: { html: "html.html", css: "css.css", js: "js.js", fields: "fields.json" },
  }, null, 2)}\n`;
  validateBuild({ html, css, js, fields }, `${pack.key}/${target.variant}`);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, "html.html"), html, "utf8"),
    writeFile(path.join(outputDir, "css.css"), css, "utf8"),
    writeFile(path.join(outputDir, "js.js"), js, "utf8"),
    writeFile(path.join(outputDir, "fields.json"), fields, "utf8"),
    writeFile(path.join(outputDir, "manifest.json"), manifest, "utf8"),
  ]);
}
console.log(`StreamElements build created for ${pack.key}: ${targets.map((target) => target.variant).join(", ")}`);
