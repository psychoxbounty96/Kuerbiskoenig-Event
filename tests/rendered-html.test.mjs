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
  assert.match(bundle, /Die Raid-Party/);
  assert.match(bundle, /Der Weg zum Thron/);
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

test("GitHub Pages shell exposes raid branding and social metadata", async () => {
  const source = await readFile("deployment/github-pages/site/index.html", "utf8");

  assert.match(source, /assets\/branding\/favicon-32x32\.png/);
  assert.match(source, /assets\/branding\/apple-touch-icon\.png/);
  assert.match(source, /property="og:image"[^>]+og\.png/);
  assert.match(source, /name="twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(source, /favicon\.svg/);
});

test("publishes the boss artwork at the stable StreamElements URL", async () => {
  const image = new URL("../github-pages-dist/assets/boss/pumpkin-king.png", import.meta.url);
  const legacyImage = new URL("../github-pages-dist/assets/boss/Kürbiskönig mit leuchtendem Zepter.png", import.meta.url);
  assert.ok((await stat(image)).size > 1_000_000, "boss artwork should be published");
  assert.equal((await stat(legacyImage)).size, (await stat(image)).size, "existing widgets should retain a working boss URL");
});

test("publishes the website branding, favicon set and social card", async () => {
  const assets = [
    "assets/branding/kuerbiskoenig-logo-head.png",
    "assets/branding/favicon.ico",
    "assets/branding/favicon-32x32.png",
    "assets/branding/favicon-16x16.png",
    "assets/branding/apple-touch-icon.png",
    "og.png",
  ];

  for (const path of assets) {
    assert.ok((await stat(new URL(`../github-pages-dist/${path}`, import.meta.url))).size > 500, `${path} should be published`);
  }
});
