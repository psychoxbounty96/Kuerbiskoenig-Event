import { CURSE_TYPES, MINION_TYPES, MOCK_DAMAGE_CLASS_BASES, type MinionDefinitionConfig } from "./config";
import type { BossPhaseId, MinionInstance } from "./types";

export interface ParsedBossCommand {
  matched: boolean;
  answer: string | null;
  reason: "ok" | "not_command" | "too_many_arguments";
}

export function parseBossCommand(value: unknown): ParsedBossCommand {
  if (typeof value !== "string") return { matched: false, answer: null, reason: "not_command" };
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens[0].toLowerCase() !== "!boss") {
    return { matched: false, answer: null, reason: "not_command" };
  }
  if (tokens.length > 2) return { matched: false, answer: null, reason: "too_many_arguments" };
  return { matched: true, answer: tokens[1]?.toLowerCase() ?? null, reason: "ok" };
}

export function stabilizeViewerEstimate(samples: number[], minimumFallback = 4) {
  const valid = samples.filter((value) => Number.isFinite(value) && value >= 0).slice(-3);
  if (!valid.length) return Math.max(1, Math.round(minimumFallback));
  const sorted = [...valid].sort((a, b) => a - b);
  if (sorted.length === 1) return Math.round(sorted[0]);
  if (sorted.length === 2) return Math.round((sorted[0] + sorted[1]) / 2);
  return Math.round(sorted[1]);
}

export function calculateRequiredParticipants(options: {
  viewerEstimate: number;
  minionDefinition: Pick<MinionDefinitionConfig, "minRequired" | "maxRequired" | "curveExponent" | "participationFactor">;
}) {
  const { minionDefinition } = options;
  const viewers = Math.max(1, Number.isFinite(options.viewerEstimate) ? options.viewerEstimate : 1);
  const curved = minionDefinition.minRequired
    + minionDefinition.participationFactor * Math.pow(viewers, minionDefinition.curveExponent);
  return Math.max(minionDefinition.minRequired, Math.min(minionDefinition.maxRequired, Math.round(curved)));
}

export function validateMinionAnswer(definition: MinionDefinitionConfig, answer: string | null, runtimeConfig: Record<string, unknown>) {
  if (definition.gameMode === "PARTICIPATION") return answer === null;
  if (!answer) return false;
  const allowed = Array.isArray(runtimeConfig.options)
    ? runtimeConfig.options.map((value) => String(value).toLowerCase())
    : definition.options?.map((value) => value.toLowerCase()) ?? [];
  return allowed.includes(answer.toLowerCase());
}

export function evaluateVote(options: {
  answers: string[];
  requiredParticipants: number;
  correctAnswer: string;
}) {
  const normalized = options.answers.map((answer) => answer.toLowerCase());
  if (normalized.length < options.requiredParticipants) {
    return { success: false, reason: "minimum_not_reached" as const, winner: null, tie: false };
  }
  const counts = new Map<string, number>();
  for (const answer of normalized) counts.set(answer, (counts.get(answer) ?? 0) + 1);
  const best = Math.max(...counts.values());
  const winners = [...counts.entries()].filter(([, count]) => count === best).map(([answer]) => answer);
  if (winners.length !== 1) return { success: false, reason: "tie" as const, winner: null, tie: true };
  const winner = winners[0];
  return {
    success: winner === options.correctAnswer.toLowerCase(),
    reason: winner === options.correctAnswer.toLowerCase() ? "correct" as const : "wrong" as const,
    winner,
    tie: false,
  };
}

function pick<T>(values: readonly T[], random: () => number) {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

export function createRuntimeConfig(typeId: keyof typeof MINION_TYPES, phase: BossPhaseId, random = Math.random) {
  if (typeId === "zombie_horde") {
    const options = ["links", "mitte", "rechts"];
    return { options, correctAnswer: pick(options, random), tieStrategy: "failure" };
  }
  if (typeId === "spider_queen") {
    const optionCount = Math.min(6, phase >= 3 ? 6 : phase === 2 ? 5 : 4);
    const options = Array.from({ length: optionCount }, (_, index) => String(index + 1));
    return { options, correctAnswer: pick(options, random), optionCount, marker: "crown" };
  }
  if (typeId === "witch") {
    return {
      question: "Welches Tier wird klassisch mit Vampiren verbunden?",
      options: ["a", "b", "c"],
      optionLabels: { a: "Wolf", b: "Fledermaus", c: "Katze" },
      correctAnswer: "b",
    };
  }
  if (typeId === "bat_swarm") {
    const count = 4 + Math.floor(random() * 9);
    return { options: Array.from({ length: 9 }, (_, index) => String(index + 4)), correctAnswer: String(count), count };
  }
  if (typeId === "reaper") {
    return {
      sequence: ["💀", "🕯️", "🎃"],
      options: ["a", "b", "c"],
      optionLabels: { a: "🎃 → 🕯️ → 💀", b: "💀 → 🕯️ → 🎃", c: "🕯️ → 💀 → 🎃" },
      correctAnswer: "b",
    };
  }
  return { options: [] };
}

export function createMinionInstance(options: {
  typeId: keyof typeof MINION_TYPES;
  instanceId: string;
  definitionId?: string;
  streamer: { id: string; slug: string; displayName: string };
  viewerSamples: number[];
  phase: BossPhaseId;
  now?: number;
  triggerSource?: MinionInstance["triggerSource"];
  triggerReference?: string | null;
  random?: () => number;
  scheduledFor?: number;
}): MinionInstance {
  const definition = MINION_TYPES[options.typeId];
  const now = options.now ?? Date.now();
  const spawnedAt = options.scheduledFor ?? now;
  const viewerEstimate = stabilizeViewerEstimate(options.viewerSamples);
  const requiredParticipants = calculateRequiredParticipants({ viewerEstimate, minionDefinition: definition });
  const introEndsAt = spawnedAt + definition.introDurationMs;
  const gameplayStartsAt = introEndsAt;
  const acceptsAnswersAt = gameplayStartsAt + definition.observeSeconds * 1_000;
  return {
    instanceId: options.instanceId,
    definitionId: options.definitionId ?? `definition-${definition.id}`,
    typeId: definition.id,
    name: definition.name,
    icon: definition.icon,
    command: definition.command,
    gameMode: definition.gameMode,
    damageClass: definition.damageClass,
    failureCurseKey: definition.failureCurseKey,
    introTitle: definition.introTitle,
    gameplayTitle: definition.gameplayTitle,
    instruction: definition.instruction,
    streamerId: options.streamer.id,
    streamerSlug: options.streamer.slug,
    streamerName: options.streamer.displayName,
    status: spawnedAt > now ? "scheduled" : "intro",
    viewerEstimate,
    requiredParticipants,
    participantCount: 0,
    durationSeconds: definition.duration,
    runtimeConfig: createRuntimeConfig(options.typeId, options.phase, options.random),
    spawnedAt,
    introEndsAt,
    gameplayStartsAt,
    acceptsAnswersAt,
    expiresAt: acceptsAnswersAt + definition.duration * 1_000,
    damageAwarded: 0,
    triggerSource: options.triggerSource ?? "admin",
    triggerReference: options.triggerReference ?? null,
  };
}

export function provisionalMinionDamage(minion: Pick<MinionInstance, "damageClass" | "viewerEstimate">) {
  const base = MOCK_DAMAGE_CLASS_BASES[minion.damageClass];
  const communityFactor = Math.max(0.75, Math.min(2, Math.pow(Math.max(1, minion.viewerEstimate) / 10, 0.25)));
  return Math.round(base * communityFactor);
}

export function phaseCurseIntensity(phase: BossPhaseId) {
  return ({ 1: 0.7, 2: 0.85, 3: 1, 4: 1.1 } as const)[phase];
}

export function getCurseDefinition(key: string | null) {
  return key && Object.hasOwn(CURSE_TYPES, key) ? CURSE_TYPES[key as keyof typeof CURSE_TYPES] : null;
}

export function isOpenMinionStatus(status: MinionInstance["status"]) {
  return ["scheduled", "intro", "active", "success", "failure", "curse"].includes(status);
}

export function getMinionClockStage(minion: MinionInstance, now: number) {
  if (minion.status === "scheduled" || now < minion.spawnedAt) return "scheduled" as const;
  if (minion.status === "intro" || now < minion.gameplayStartsAt) return "intro" as const;
  if (minion.status === "active" && now < minion.acceptsAnswersAt) return "observe" as const;
  if (minion.status === "active" && now < minion.expiresAt) return "active" as const;
  return minion.status;
}

export function acceptParticipantAction(options: {
  definition: MinionDefinitionConfig;
  runtimeConfig: Record<string, unknown>;
  participants: Map<string, string | null>;
  participantId: string;
  text: string;
}) {
  const parsed = parseBossCommand(options.text);
  if (!parsed.matched || !validateMinionAnswer(options.definition, parsed.answer, options.runtimeConfig)) {
    return { accepted: false, duplicate: false, reason: "invalid" as const };
  }
  if (options.participants.has(options.participantId)) {
    return { accepted: false, duplicate: true, reason: "duplicate" as const };
  }
  options.participants.set(options.participantId, parsed.answer);
  return { accepted: true, duplicate: false, reason: "accepted" as const };
}

export function calculateRaidSpecialDelaySeconds(random = Math.random, minimum = 90, maximum = 120) {
  const low = Math.max(0, Math.floor(Math.min(minimum, maximum)));
  const high = Math.max(low, Math.floor(Math.max(minimum, maximum)));
  return low + Math.floor(random() * (high - low + 1));
}
