import type { EventPackDamageClass, EventPackMinion, RuntimeGenerator } from "../../pack-schema/src";

export interface ParsedCommand {
  matched: boolean;
  answer: string | null;
  reason?: "ok" | "invalid";
}

export interface RuntimeMinionInstance {
  instanceId: string;
  definitionId: string;
  typeId: string;
  name: string;
  icon: string;
  command: string;
  gameMode: EventPackMinion["gameMode"];
  damageClass: EventPackDamageClass;
  failureCurseKey: string | null;
  introTitle: string;
  gameplayTitle: string;
  instruction: string;
  presentation: string;
  streamerId: string;
  streamerSlug: string;
  streamerName: string;
  status: "scheduled" | "intro" | "active" | "success" | "failure" | "curse" | "complete" | "cancelled" | "expired";
  viewerEstimate: number;
  requiredParticipants: number;
  participantCount: number;
  durationSeconds: number;
  runtimeConfig: Record<string, unknown>;
  spawnedAt: number;
  introEndsAt: number;
  gameplayStartsAt: number;
  acceptsAnswersAt: number;
  expiresAt: number;
  damageAwarded: number;
  triggerSource: "scheduler" | "raid" | "admin" | "manual_test";
  triggerReference?: string | null;
}

export function parseCommand(value: unknown, command = "!boss"): ParsedCommand {
  if (typeof value !== "string" || !command.trim()) return { matched: false, answer: null, reason: "invalid" };
  const escaped = command.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.trim().match(new RegExp(`^${escaped}(?:\\s+([^\\s]+))?\\s*$`, "i"));
  if (!match) return { matched: false, answer: null, reason: "invalid" };
  return { matched: true, answer: match[1]?.trim().toLowerCase() ?? null, reason: "ok" };
}

export function stabilizeViewerEstimate(samples: number[], minimumFallback = 4) {
  const valid = samples.filter((sample) => Number.isFinite(sample) && sample >= 0).slice(0, 3).sort((a, b) => a - b);
  if (!valid.length) return Math.max(0, Math.round(minimumFallback));
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? Math.round(valid[middle]) : Math.round((valid[middle - 1] + valid[middle]) / 2);
}

export function calculateRequiredParticipants(options: { viewerEstimate: number; minionDefinition: EventPackMinion }) {
  const definition = options.minionDefinition;
  const viewers = Math.max(0, options.viewerEstimate);
  const scaled = definition.minimumParticipants + Math.pow(Math.max(1, viewers), definition.curveExponent) * definition.participationFactor;
  return Math.max(definition.minimumParticipants, Math.min(definition.maximumParticipants, Math.round(scaled)));
}

export function createRuntimeConfig(generator: RuntimeGenerator, random = Math.random): Record<string, unknown> {
  if (generator.type === "random-choice") {
    const index = Math.min(generator.options.length - 1, Math.floor(random() * generator.options.length));
    const correctAnswer = generator.options[Math.max(0, index)] ?? "";
    return {
      options: generator.options,
      correctAnswer,
      ...(generator.visualTarget ? { visualTarget: correctAnswer } : {}),
      tieStrategy: generator.tieStrategy ?? "failure",
    };
  }
  if (generator.type === "random-number") {
    const minimum = Math.floor(Math.min(generator.minimum, generator.maximum));
    const maximum = Math.floor(Math.max(generator.minimum, generator.maximum));
    const answer = minimum + Math.floor(random() * (maximum - minimum + 1));
    return {
      options: Array.from({ length: maximum - minimum + 1 }, (_, index) => String(minimum + index)),
      correctAnswer: String(answer),
      count: answer,
      optionCount: maximum,
    };
  }
  if (generator.type === "random-option-count") {
    const minimum = Math.floor(Math.min(generator.minimumOptions, generator.maximumOptions));
    const maximum = Math.floor(Math.max(generator.minimumOptions, generator.maximumOptions));
    const optionCount = minimum + Math.floor(random() * (maximum - minimum + 1));
    const correctAnswer = 1 + Math.floor(random() * optionCount);
    return {
      options: Array.from({ length: optionCount }, (_, index) => String(index + 1)),
      correctAnswer: String(correctAnswer),
      targetIndex: String(correctAnswer),
      optionCount,
    };
  }
  if (generator.type === "fixed-sequence") {
    return {
      sequence: generator.sequence,
      options: generator.options,
      optionLabels: generator.optionLabels,
      correctAnswer: generator.correctAnswer.toLowerCase(),
      tieStrategy: generator.tieStrategy ?? "failure",
    };
  }
  if (generator.type === "question-pool") {
    const index = Math.min(generator.questions.length - 1, Math.floor(random() * generator.questions.length));
    const question = generator.questions[Math.max(0, index)];
    if (!question) return { options: [] };
    return {
      question: question.question,
      options: Object.keys(question.answers).map((key) => key.toLowerCase()),
      optionLabels: Object.fromEntries(Object.entries(question.answers).map(([key, value]) => [key.toLowerCase(), value])),
      correctAnswer: question.correctAnswer.toLowerCase(),
      tieStrategy: "failure",
    };
  }
  return { options: [] };
}

export function validateMinionAnswer(
  definition: Pick<EventPackMinion, "gameMode">,
  answer: string | null,
  runtimeConfig: Record<string, unknown>,
) {
  if (definition.gameMode === "PARTICIPATION") return answer === null;
  const options = Array.isArray(runtimeConfig.options) ? runtimeConfig.options.map(String).map((option) => option.toLowerCase()) : [];
  return Boolean(answer && options.includes(answer.toLowerCase()));
}

export function evaluateVote(options: {
  answers: Array<string | null>;
  requiredParticipants: number;
  correctAnswer: string;
  tieStrategy?: "failure";
}) {
  const valid = options.answers.filter((answer): answer is string => Boolean(answer));
  if (valid.length < options.requiredParticipants) return { success: false, reason: "minimum_not_reached", winner: null };
  const counts = new Map<string, number>();
  for (const answer of valid) counts.set(answer, (counts.get(answer) ?? 0) + 1);
  const maximum = Math.max(...counts.values());
  const winners = [...counts.entries()].filter(([, amount]) => amount === maximum).map(([answer]) => answer);
  if (winners.length !== 1) return { success: false, reason: "tie", winner: null };
  const winner = winners[0];
  return { success: winner === options.correctAnswer.toLowerCase(), reason: winner === options.correctAnswer.toLowerCase() ? "correct" : "wrong", winner };
}

export function createMinionInstance(options: {
  definition: EventPackMinion;
  instanceId: string;
  definitionId?: string;
  streamer: { id: string; slug: string; displayName: string };
  viewerSamples: number[];
  now?: number;
  triggerSource?: RuntimeMinionInstance["triggerSource"];
  triggerReference?: string | null;
  random?: () => number;
  scheduledFor?: number;
}): RuntimeMinionInstance {
  const definition = options.definition;
  const now = options.now ?? Date.now();
  const spawnedAt = options.scheduledFor ?? now;
  const viewerEstimate = stabilizeViewerEstimate(options.viewerSamples);
  const requiredParticipants = calculateRequiredParticipants({ viewerEstimate, minionDefinition: definition });
  const introEndsAt = spawnedAt + definition.introDurationMs;
  const gameplayStartsAt = introEndsAt;
  const acceptsAnswersAt = gameplayStartsAt + definition.observeSeconds * 1_000;
  return {
    instanceId: options.instanceId,
    definitionId: options.definitionId ?? `definition-${definition.key}`,
    typeId: definition.key,
    name: definition.name,
    icon: definition.icon,
    command: definition.command,
    gameMode: definition.gameMode,
    damageClass: definition.damageClass,
    failureCurseKey: definition.failureEffectKey,
    introTitle: definition.introTitle,
    gameplayTitle: definition.gameplayTitle,
    instruction: definition.instruction,
    presentation: definition.presentation,
    streamerId: options.streamer.id,
    streamerSlug: options.streamer.slug,
    streamerName: options.streamer.displayName,
    status: spawnedAt > now ? "scheduled" : "intro",
    viewerEstimate,
    requiredParticipants,
    participantCount: 0,
    durationSeconds: definition.durationSeconds,
    runtimeConfig: createRuntimeConfig(definition.runtime, options.random),
    spawnedAt,
    introEndsAt,
    gameplayStartsAt,
    acceptsAnswersAt,
    expiresAt: acceptsAnswersAt + definition.durationSeconds * 1_000,
    damageAwarded: 0,
    triggerSource: options.triggerSource ?? "admin",
    triggerReference: options.triggerReference ?? null,
  };
}

export function provisionalMinionDamage(
  minion: Pick<RuntimeMinionInstance, "damageClass" | "viewerEstimate">,
  damageClasses: Record<EventPackDamageClass, { baseDamage: number }>,
) {
  const base = damageClasses[minion.damageClass]?.baseDamage ?? 0;
  const communityFactor = Math.max(0.75, Math.min(2, Math.pow(Math.max(1, minion.viewerEstimate) / 10, 0.25)));
  return Math.round(base * communityFactor);
}

export function isOpenMinionStatus(status: RuntimeMinionInstance["status"]) {
  return ["scheduled", "intro", "active", "success", "failure", "curse"].includes(status);
}

export function getMinionClockStage(
  minion: Pick<RuntimeMinionInstance, "status" | "spawnedAt" | "gameplayStartsAt" | "acceptsAnswersAt" | "expiresAt">,
  now: number,
) {
  if (minion.status === "scheduled" || now < minion.spawnedAt) return "scheduled" as const;
  if (minion.status === "intro" || now < minion.gameplayStartsAt) return "intro" as const;
  if (minion.status === "active" && now < minion.acceptsAnswersAt) return "observe" as const;
  if (minion.status === "active" && now < minion.expiresAt) return "active" as const;
  return minion.status;
}

export function acceptParticipantAction(options: {
  definition: EventPackMinion;
  runtimeConfig: Record<string, unknown>;
  participants: Map<string, string | null>;
  participantId: string;
  text: string;
}) {
  const parsed = parseCommand(options.text, options.definition.command);
  if (!parsed.matched || !validateMinionAnswer(options.definition, parsed.answer, options.runtimeConfig)) {
    return { accepted: false, duplicate: false, reason: "invalid" as const };
  }
  if (options.participants.has(options.participantId)) return { accepted: false, duplicate: true, reason: "duplicate" as const };
  options.participants.set(options.participantId, parsed.answer);
  return { accepted: true, duplicate: false, reason: "accepted" as const };
}

export function calculateRaidSpecialDelaySeconds(random = Math.random, minimum = 90, maximum = 120) {
  const low = Math.max(0, Math.floor(Math.min(minimum, maximum)));
  const high = Math.max(low, Math.floor(Math.max(minimum, maximum)));
  return low + Math.floor(random() * (high - low + 1));
}
