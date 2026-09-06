import assert from "node:assert/strict";
import test from "node:test";
import { calculatePhase, getNextMilestone } from "../packages/event-engine/src/phases";
import { createRuntimeConfig, parseCommand, provisionalMinionDamage } from "../packages/event-engine/src/minions";
import { validateEventPack, type EventPackManifest } from "../packages/pack-schema/src";

const samplePack: EventPackManifest = {
  schemaVersion: 1,
  key: "winter-demo",
  version: "1.2.0",
  locale: "de-DE",
  name: "Winter Demo",
  description: "Engine contract fixture",
  engine: { minimumVersion: "1.0.0" },
  events: [{ slug: "winter-demo-test", variant: "test", testControls: true }],
  theme: { className: "winter", colors: { primary: "#fff" }, labels: { event: "WINTER" } },
  boss: {
    name: "Frost Titan",
    defaultMaxHp: 500,
    asset: { type: "spritesheet", source: "assets/boss.png", columns: 4, rows: 2, frameCount: 8, clips: { idle: { startFrame: 0, frameCount: 4, fps: 8, loop: true } } },
    phases: [
      { id: 10, name: "Calm", minPercent: 60, maxPercent: 100, color: "#fff", spawnWindowMinutes: [2, 4], intensity: 0.5 },
      { id: 20, name: "Storm", minPercent: 20, maxPercent: 60, color: "#acf", spawnWindowMinutes: [1, 3], intensity: 0.8 },
      { id: 30, name: "Finale", minPercent: 0, maxPercent: 20, color: "#48f", spawnWindowMinutes: [1, 2], intensity: 1 },
    ],
    milestones: [{ percent: 60, label: "Storm", description: "Storm begins" }],
  },
  damageClasses: { LIGHT: { baseDamage: 25, provisional: true } },
  minions: [{
    key: "snowball", name: "Snowball", icon: "❄", gameMode: "VOTE", phaseMinimum: 10, weight: 1,
    introDurationMs: 1000, durationSeconds: 15, observeSeconds: 0, damageClass: "LIGHT", failureEffectKey: "frost",
    command: "!winter", minimumParticipants: 1, maximumParticipants: 10, participationFactor: 0.4, curveExponent: 0.7,
    introTitle: "Incoming", gameplayTitle: "Choose", instruction: "!winter A", presentation: "question",
    runtime: { type: "question-pool", questions: [{ question: "Cold?", answers: { a: "Yes", b: "No" }, correctAnswer: "a" }] },
    asset: "assets/snowball.png",
  }],
  effects: [{ key: "frost", name: "Frost", durationMs: 5000, intensity: 0.4, presentation: "color-distortion" }],
  scheduling: { raidSpecialMinionKey: null, raidDelaySeconds: [5, 10], raidCooldownSeconds: [30, 60] },
};

test("a non-Halloween pack with arbitrary phase ids and damage classes validates", () => {
  assert.equal(validateEventPack(samplePack).key, "winter-demo");
  assert.equal(calculatePhase(samplePack.boss.phases, 250, 500).id, 20);
  assert.equal(calculatePhase(samplePack.boss.phases, 50, 500).id, 30);
});

test("commands and question runtime are supplied by the pack", () => {
  assert.equal(parseCommand(" !WINTER   A ", samplePack.minions[0].command).answer, "a");
  assert.equal(parseCommand("!boss", samplePack.minions[0].command).matched, false);
  assert.deepEqual(createRuntimeConfig(samplePack.minions[0].runtime, () => 0), {
    question: "Cold?", options: ["a", "b"], optionLabels: { a: "Yes", b: "No" }, correctAnswer: "a", tieStrategy: "failure",
  });
});

test("damage and milestones use pack definitions", () => {
  assert.ok(provisionalMinionDamage({ damageClass: "LIGHT", viewerEstimate: 10 }, samplePack.damageClasses) > 0);
  assert.equal(getNextMilestone(samplePack.boss.milestones, 400, 500).label, "Storm");
});

test("pack manifests reject unknown damage and effect references", () => {
  assert.throws(() => validateEventPack({ ...samplePack, minions: [{ ...samplePack.minions[0], damageClass: "MISSING" }] }), /unknown damage class/);
  assert.throws(() => validateEventPack({ ...samplePack, minions: [{ ...samplePack.minions[0], failureEffectKey: "missing" }] }), /unknown effect/);
});
