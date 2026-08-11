import assert from "node:assert/strict";
import test from "node:test";
import { MINION_TYPES } from "../app/lib/config";
import {
  acceptParticipantAction,
  calculateRaidSpecialDelaySeconds,
  calculateRequiredParticipants,
  createMinionInstance,
  evaluateVote,
  getMinionClockStage,
  parseBossCommand,
  stabilizeViewerEstimate,
  validateMinionAnswer,
} from "../app/lib/minion-engine";
import { getVisibleMinionForStreamer } from "../app/lib/domain";

test("chat parser accepts the exact case-insensitive whitespace-tolerant !boss grammar", () => {
  assert.deepEqual(parseBossCommand("!boss"), { matched: true, answer: null, reason: "ok" });
  assert.equal(parseBossCommand("!boss A").answer, "a");
  assert.equal(parseBossCommand("  !boss   B  ").answer, "b");
  assert.equal(parseBossCommand("!boss links").answer, "links");
  assert.equal(parseBossCommand("!bossabc").matched, false);
  assert.equal(parseBossCommand("!boss A extra").matched, false);
});

test("one valid action per user is counted while an invalid attempt may be corrected", () => {
  const participants = new Map<string, string | null>();
  const definition = MINION_TYPES.witch;
  const runtime = { options: ["a", "b", "c"] };
  assert.equal(acceptParticipantAction({ definition, runtimeConfig: runtime, participants, participantId: "u1", text: "!bos a" }).accepted, false);
  assert.equal(acceptParticipantAction({ definition, runtimeConfig: runtime, participants, participantId: "u1", text: "!boss a" }).accepted, true);
  assert.equal(acceptParticipantAction({ definition, runtimeConfig: runtime, participants, participantId: "u1", text: "!boss b" }).duplicate, true);
  assert.equal(acceptParticipantAction({ definition, runtimeConfig: runtime, participants, participantId: "u2", text: "!boss b" }).accepted, true);
  assert.equal(participants.size, 2);
});

test("participation and answer formats are definition-driven", () => {
  assert.equal(validateMinionAnswer(MINION_TYPES.ghost, null, {}), true);
  assert.equal(validateMinionAnswer(MINION_TYPES.ghost, "a", {}), false);
  assert.equal(validateMinionAnswer(MINION_TYPES.zombie_horde, "links", { options: ["links", "mitte", "rechts"] }), true);
  assert.equal(validateMinionAnswer(MINION_TYPES.zombie_horde, "oben", { options: ["links", "mitte", "rechts"] }), false);
});

test("viewer estimate uses the last three valid samples and ignores API gaps", () => {
  assert.equal(stabilizeViewerEstimate([8, 10, 50]), 10);
  assert.equal(stabilizeViewerEstimate([10, 20]), 15);
  assert.equal(stabilizeViewerEstimate([12]), 12);
  assert.equal(stabilizeViewerEstimate([], 4), 4);
  assert.equal(stabilizeViewerEstimate([Number.NaN, -1], 4), 4);
});

test("difficulty is frozen at spawn and uses a diminishing soft curve", () => {
  const small = calculateRequiredParticipants({ viewerEstimate: 8, minionDefinition: MINION_TYPES.ghost });
  const large = calculateRequiredParticipants({ viewerEstimate: 50, minionDefinition: MINION_TYPES.ghost });
  assert.equal(small, 4);
  assert.ok(large > small && large < 25);
  const minion = createMinionInstance({ typeId: "ghost", instanceId: "g", streamer: { id: "s", slug: "s", displayName: "S" }, viewerSamples: [8, 10, 50], phase: 1, now: 1_000 });
  assert.equal(minion.viewerEstimate, 10);
  assert.equal(minion.requiredParticipants, calculateRequiredParticipants({ viewerEstimate: 10, minionDefinition: MINION_TYPES.ghost }));
});

test("vote resolution covers correct, wrong, minimum and tie", () => {
  assert.equal(evaluateVote({ answers: ["b", "b", "a"], requiredParticipants: 3, correctAnswer: "b" }).success, true);
  assert.equal(evaluateVote({ answers: ["a", "a", "b"], requiredParticipants: 3, correctAnswer: "b" }).reason, "wrong");
  assert.equal(evaluateVote({ answers: ["b"], requiredParticipants: 2, correctAnswer: "b" }).reason, "minimum_not_reached");
  assert.equal(evaluateVote({ answers: ["a", "b"], requiredParticipants: 2, correctAnswer: "b" }).reason, "tie");
});

test("server-time stages recover across intro, observe, active and result states", () => {
  const minion = createMinionInstance({ typeId: "bat_swarm", instanceId: "b", streamer: { id: "s", slug: "s", displayName: "S" }, viewerSamples: [10], phase: 2, now: 1_000 });
  assert.equal(getMinionClockStage(minion, 1_500), "intro");
  minion.status = "active";
  assert.equal(getMinionClockStage(minion, minion.gameplayStartsAt + 100), "observe");
  assert.equal(getMinionClockStage(minion, minion.acceptsAnswersAt + 100), "active");
  minion.status = "curse";
  assert.equal(getMinionClockStage(minion, minion.expiresAt + 1), "curse");
});

test("multiple streamer minions remain independently scoped", () => {
  const a = createMinionInstance({ typeId: "ghost", instanceId: "a", streamer: { id: "a", slug: "alpha", displayName: "Alpha" }, viewerSamples: [8], phase: 1, now: 1_000 });
  const b = createMinionInstance({ typeId: "witch", instanceId: "b", streamer: { id: "b", slug: "beta", displayName: "Beta" }, viewerSamples: [30], phase: 2, now: 1_000 });
  a.status = "active"; b.status = "active";
  assert.equal(getVisibleMinionForStreamer([a, b], "alpha", 2_000)?.instanceId, "a");
  assert.equal(getVisibleMinionForStreamer([a, b], "beta", 2_000)?.instanceId, "b");
  assert.notEqual(a.requiredParticipants, b.requiredParticipants);
});

test("eligible raid special delay remains within 90 to 120 seconds", () => {
  assert.equal(calculateRaidSpecialDelaySeconds(() => 0), 90);
  assert.equal(calculateRaidSpecialDelaySeconds(() => 0.999999), 120);
});
