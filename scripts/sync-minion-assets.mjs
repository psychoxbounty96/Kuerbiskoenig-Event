import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artwork = {
  ghost: "ghost",
  zombie_horde: "zombie",
  spider_queen: "spider",
  witch: "witch",
  bat_swarm: "bats",
  reaper: "reaper",
  kings_herald: "herald",
};

for (const folder of Object.values(artwork)) {
  const source = resolve(projectRoot, "assets", "minions", folder, "placeholder.jpg");
  const targetDirectory = resolve(projectRoot, "public", "assets", "minions", folder);
  await mkdir(targetDirectory, { recursive: true });
  await copyFile(source, resolve(targetDirectory, "placeholder.jpg"));
}

const bossSource = resolve(projectRoot, "assets", "boss", "Kürbiskönig mit leuchtendem Zepter.png");
const bossTargetDirectory = resolve(projectRoot, "public", "assets", "boss");
await mkdir(bossTargetDirectory, { recursive: true });
await copyFile(bossSource, resolve(bossTargetDirectory, "pumpkin-king.png"));
await copyFile(bossSource, resolve(bossTargetDirectory, "Kürbiskönig mit leuchtendem Zepter.png"));

console.log(`Synced ${Object.keys(artwork).length} minion artworks and the boss artwork.`);
