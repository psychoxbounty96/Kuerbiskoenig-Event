import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack } from "./validate-packs.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const availablePacks = (await readdir(resolve(projectRoot, "event-packs"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const packKey = option("--pack") || process.env.EVENT_PACK_KEY || availablePacks[0];
const packPath = resolve(projectRoot, "event-packs", packKey, "pack.json");
const pack = validatePack(JSON.parse(await readFile(packPath, "utf8")), packKey);
const targetRoot = resolve(projectRoot, "public", "event-packs", pack.key, pack.version);

function sourceOf(asset) {
  if (!asset) return "";
  return typeof asset === "string" ? asset : asset.source || asset.fallbackSource || "";
}

const assetPaths = new Set([
  sourceOf(pack.boss.asset),
  ...pack.minions.map((item) => sourceOf(item.asset)),
  ...pack.effects.map((item) => sourceOf(item.asset)),
].filter((value) => value && !/^https:\/\//i.test(value)));

for (const assetPath of assetPaths) {
  if (isAbsolute(assetPath) || assetPath.includes("..")) throw new Error(`Unsafe pack asset path: ${assetPath}`);
  const normalized = assetPath.replace(/^[/\\]+/, "");
  const candidates = [
    resolve(projectRoot, "event-packs", pack.key, normalized),
    resolve(projectRoot, normalized),
    resolve(projectRoot, "public", normalized),
  ];
  let copied = false;
  for (const source of candidates) {
    try {
      const target = resolve(targetRoot, normalized);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      copied = true;
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (!copied) throw new Error(`Pack asset not found: ${assetPath}`);
}

console.log(`Synced ${assetPaths.size} assets for ${pack.key}@${pack.version}.`);
