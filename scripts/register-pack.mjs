import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validatePack } from "./validate-packs.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const packKey = option("--pack") || process.env.EVENT_PACK_KEY;
const eventId = option("--event-id");
const resetBoss = args.includes("--reset-boss");
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!packKey) throw new Error("Use --pack <pack-key> or EVENT_PACK_KEY.");
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl || "")) throw new Error("SUPABASE_URL is missing or invalid.");
if (!serviceKey || /REPLACE_ME/i.test(serviceKey)) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");

const source = await readFile(path.join(process.cwd(), "event-packs", packKey, "pack.json"), "utf8");
const manifest = validatePack(JSON.parse(source), packKey);
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

async function rpc(name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}

const registered = await rpc("register_event_pack_release", {
  p_manifest: manifest,
  p_content_hash: createHash("sha256").update(source).digest("hex"),
});
console.log("Registered pack release", registered);

if (eventId) {
  const applied = await rpc("apply_event_pack", {
    p_event_id: eventId,
    p_pack_key: manifest.key,
    p_pack_version: manifest.version,
    p_reset_boss: resetBoss,
  });
  console.log("Applied pack release", applied);
}
