import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

async function readBuilt(path) {
  return readFile(new URL(`../github-pages-dist/${path}`, import.meta.url), "utf8");
}

async function readApplicationBundle() {
  const assetsUrl = new URL("../github-pages-dist/assets/", import.meta.url);
  const files = await readdir(assetsUrl);
  const javascript = files.filter((file) => file.endsWith(".js"));
  return (await Promise.all(javascript.map((file) => readFile(new URL(file, assetsUrl), "utf8")))).join("\n");
}

test("builds the public GitHub Pages entry", async () => {
  const html = await readBuilt("index.html");
  assert.match(html, /Kürbiskönig/);
  assert.match(html, /data-page="public"/);
  assert.match(html, /assets\/main-[^"]+\.js/);
  assert.doesNotMatch(html, /dist\/server|codex-preview|chatgpt/i);
});

test("builds static admin and overlay entries", async () => {
  const admin = await readBuilt("admin/index.html");
  const overlay = await readBuilt("overlay/index.html");
  assert.match(admin, /data-page="admin"/);
  assert.match(overlay, /data-page="overlay"/);
  assert.match(admin, /noindex,nofollow/);
  assert.match(overlay, /noindex,nofollow/);
});

test("ships website, admin and overlay application code in the static bundle", async () => {
  const bundle = await readApplicationBundle();
  assert.match(bundle, /Community-Rangliste/);
  assert.match(bundle, /Minion Debugger/);
  assert.match(bundle, /Overlay erfolgreich verbunden/);
  assert.match(bundle, /Simulate Raid/);
  assert.doesNotMatch(bundle, /YOUR_PROJECT|sb_publishable_REPLACE_ME/);
});

test("publishes all minion placeholder images at stable GitHub Pages paths", async () => {
  for (const folder of ["ghost", "zombie", "spider", "witch", "bats", "reaper", "herald"]) {
    const image = new URL(`../github-pages-dist/assets/minions/${folder}/placeholder.jpg`, import.meta.url);
    assert.ok((await stat(image)).size > 50_000, `${folder} artwork should be published`);
  }
});

test("publishes the boss artwork at the stable StreamElements URL", async () => {
  const image = new URL("../github-pages-dist/assets/boss/pumpkin-king.png", import.meta.url);
  assert.ok((await stat(image)).size > 1_000_000, "boss artwork should be published");
});
