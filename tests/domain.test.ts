import assert from "node:assert/strict";
import test from "node:test";
import { calculateBossPhase } from "../app/lib/config";
import { createMinionInstance } from "../app/lib/minion-engine";
import { canApplyDamage, clampBossHp, computeConfiguredDamage, getVisibleMinionForStreamer, markCrossedMilestones } from "../app/lib/domain";
import type { EventSettingsState, MinionInstance } from "../app/lib/types";

test("phase boundaries use (min, max] and keep zero in phase IV", () => {
  const max = 10_000_000;
  assert.equal(calculateBossPhase(max, max).id, 1);
  assert.equal(calculateBossPhase(7_500_001, max).id, 1);
  assert.equal(calculateBossPhase(7_500_000, max).id, 2);
  assert.equal(calculateBossPhase(5_000_000, max).id, 3);
  assert.equal(calculateBossPhase(2_500_000, max).id, 4);
  assert.equal(calculateBossPhase(0, max).id, 4);
});

test("configured damage composes the server-mirrored multipliers", () => {
  const settings: EventSettingsState = {
    eventPaused: false,
    damageEnabled: true,
    minionsEnabled: true,
    globalDamageMultiplier: 1.5,
    activeDamageMultiplier: 2,
    passiveDamageMultiplier: 0.5,
    passiveTickSeconds: 120,
  };
  assert.equal(computeConfiguredDamage(1_000, settings), 3_000);
  assert.equal(clampBossHp(-500, 10_000), 0);
  assert.equal(clampBossHp(12_000, 10_000), 10_000);
  assert.equal(canApplyDamage({ ...settings, eventPaused: true }).allowed, false);
  assert.equal(canApplyDamage({ ...settings, damageEnabled: false }).allowed, false);
  assert.equal(canApplyDamage({ ...settings, eventPaused: true }, true).allowed, true);
});

test("milestones are marked once when HP crosses their threshold", () => {
  const first = markCrossedMilestones([
    { id: "75", label: "75", percent: 75, description: "", reachedAt: null, sortOrder: 1 },
  ], 8_000, 7_500, 10_000, "2026-08-11T00:00:00.000Z");
  assert.equal(first[0].reachedAt, "2026-08-11T00:00:00.000Z");
  const second = markCrossedMilestones(first, 7_500, 7_000, 10_000, "later");
  assert.equal(second[0].reachedAt, "2026-08-11T00:00:00.000Z");
});

test("overlay selects only the requested streamer's active minion", () => {
  const base = createMinionInstance({ typeId: "ghost", instanceId: "base", streamer: { id: "base", slug: "base", displayName: "Base" }, viewerSamples: [8], phase: 1, now: 100 });
  base.status = "active";
  base.expiresAt = 10_000;
  const minions: MinionInstance[] = [
    { ...base, instanceId: "a", streamerId: "a", streamerSlug: "alpha", streamerName: "Alpha" },
    { ...base, instanceId: "b", streamerId: "b", streamerSlug: "beta", streamerName: "Beta", spawnedAt: 200 },
  ];
  assert.equal(getVisibleMinionForStreamer(minions, "alpha", 500)?.instanceId, "a");
  assert.equal(getVisibleMinionForStreamer(minions, "beta", 500)?.instanceId, "b");
  assert.equal(getVisibleMinionForStreamer(minions, "gamma", 500), null);
});
