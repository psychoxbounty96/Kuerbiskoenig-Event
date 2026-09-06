import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const packsRoot = path.join(process.cwd(), "event-packs");
const keyPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid event pack: ${message}`);
}

export function validatePack(pack, source = "pack") {
  assert(pack && typeof pack === "object", `${source} must contain an object`);
  assert(pack.schemaVersion === 1, `${source} uses an unsupported schemaVersion`);
  assert(keyPattern.test(pack.key || ""), `${source} has an invalid key`);
  assert(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pack.version || ""), `${source} has an invalid version`);
  assert(Array.isArray(pack.events) && pack.events.length, `${source} needs an event target`);
  assert(Array.isArray(pack.boss?.phases) && pack.boss.phases.length, `${source} needs boss phases`);
  assert(Array.isArray(pack.minions), `${source} needs a minions array`);
  assert(Array.isArray(pack.effects), `${source} needs an effects array`);
  const unique = (values, label) => assert(new Set(values).size === values.length, `${source} contains duplicate ${label}`);
  unique(pack.events.map((event) => event.slug), "event slugs");
  unique(pack.boss.phases.map((phase) => phase.id), "phase ids");
  for (const [index, phase] of pack.boss.phases.entries()) {
    assert(Number.isInteger(phase.id) && phase.id > 0 && phase.id <= 32767, `${source} has an invalid phase id`);
    if (index === 0) assert(phase.maxPercent === 100, `${source} first phase must start at 100 percent`);
    if (index > 0) assert(pack.boss.phases[index - 1].minPercent === phase.maxPercent, `${source} has a phase boundary gap`);
    if (index === pack.boss.phases.length - 1) assert(phase.minPercent === 0, `${source} last phase must end at zero percent`);
  }
  unique(pack.minions.map((minion) => minion.key), "minion keys");
  unique(pack.effects.map((effect) => effect.key), "effect keys");
  const effects = new Set(pack.effects.map((effect) => effect.key));
  const minions = new Set(pack.minions.map((minion) => minion.key));
  const damageClasses = new Set(Object.keys(pack.damageClasses || {}));
  const phaseIds = new Set(pack.boss.phases.map((phase) => phase.id));
  assert(damageClasses.size > 0, `${source} needs damage classes`);
  for (const minion of pack.minions) {
    assert(keyPattern.test(minion.key || ""), `${source} has an invalid minion key`);
    assert(phaseIds.has(minion.phaseMinimum), `${source} references missing phase ${minion.phaseMinimum}`);
    assert(!minion.failureEffectKey || effects.has(minion.failureEffectKey), `${source} references missing effect ${minion.failureEffectKey}`);
    assert(damageClasses.has(minion.damageClass), `${source} references missing damage class ${minion.damageClass}`);
    assert(minion.maximumParticipants >= minion.minimumParticipants && minion.minimumParticipants > 0, `${source} has invalid participant bounds for ${minion.key}`);
    if (minion.runtime?.type === "question-pool") {
      assert(Array.isArray(minion.runtime.questions) && minion.runtime.questions.length, `${source} has an empty question pool for ${minion.key}`);
    }
  }
  assert(!pack.scheduling.raidSpecialMinionKey || minions.has(pack.scheduling.raidSpecialMinionKey), `${source} has an unknown raid special`);
  const serialized = JSON.stringify(pack);
  assert(!/(sb_secret_|service.?role|client.?secret|access.?token|refresh.?token|private.?key)/i.test(serialized), `${source} contains secret-like material`);
  return pack;
}

const directories = (await readdir(packsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
let count = 0;
for (const directory of directories) {
  const source = path.join(packsRoot, directory.name, "pack.json");
  const pack = JSON.parse(await readFile(source, "utf8"));
  validatePack(pack, directory.name);
  assert(pack.key === directory.name, `${directory.name} directory and pack key differ`);
  count += 1;
}
assert(count > 0, "at least one pack is required");
console.log(`Validated ${count} event pack(s).`);
