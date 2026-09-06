import { ACTIVE_EVENT_PACK, CURSE_TYPES, MINION_TYPES, MOCK_DAMAGE_CLASS_BASES, type MinionDefinitionConfig } from "./config";
import type { BossPhaseId, MinionInstance } from "./types";
import {
  acceptParticipantAction as acceptGenericParticipantAction,
  calculateRaidSpecialDelaySeconds,
  calculateRequiredParticipants as calculateGenericRequiredParticipants,
  createMinionInstance as createGenericMinionInstance,
  createRuntimeConfig as createGenericRuntimeConfig,
  evaluateVote,
  getMinionClockStage,
  isOpenMinionStatus,
  parseCommand,
  stabilizeViewerEstimate,
  validateMinionAnswer as validateGenericMinionAnswer,
} from "../../packages/event-engine/src/minions";
import { phaseIntensity } from "../../packages/event-engine/src/phases";

function toPackDefinition(definition: MinionDefinitionConfig) {
  return {
    key: definition.id,
    name: definition.name,
    icon: definition.icon,
    gameMode: definition.gameMode,
    phaseMinimum: definition.phaseMin,
    weight: definition.weight,
    introDurationMs: definition.introDurationMs,
    durationSeconds: definition.duration,
    observeSeconds: definition.observeSeconds,
    damageClass: definition.damageClass,
    failureEffectKey: definition.failureCurseKey || null,
    command: definition.command,
    minimumParticipants: definition.minRequired,
    maximumParticipants: definition.maxRequired,
    participationFactor: definition.participationFactor,
    curveExponent: definition.curveExponent,
    introTitle: definition.introTitle,
    gameplayTitle: definition.gameplayTitle,
    instruction: definition.instruction,
    presentation: definition.presentation,
    runtime: definition.runtime,
    asset: definition.asset,
  };
}

export const parseBossCommand = (value: unknown) => parseCommand(value, "!boss");

export function calculateRequiredParticipants(options: { viewerEstimate: number; minionDefinition: MinionDefinitionConfig }) {
  return calculateGenericRequiredParticipants({
    viewerEstimate: options.viewerEstimate,
    minionDefinition: toPackDefinition(options.minionDefinition),
  });
}

export function validateMinionAnswer(definition: MinionDefinitionConfig, answer: string | null, runtimeConfig: Record<string, unknown>) {
  return validateGenericMinionAnswer(toPackDefinition(definition), answer, runtimeConfig);
}

export { calculateRaidSpecialDelaySeconds, evaluateVote, getMinionClockStage, isOpenMinionStatus, stabilizeViewerEstimate };

export function createRuntimeConfig(typeId: string, phase: BossPhaseId, random = Math.random) {
  void phase;
  const definition = MINION_TYPES[typeId];
  if (!definition) throw new Error(`Unknown minion definition: ${typeId}`);
  return createGenericRuntimeConfig(definition.runtime, random);
}

export function createMinionInstance(options: {
  typeId: string;
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
  void options.phase;
  const definition = MINION_TYPES[options.typeId];
  if (!definition) throw new Error(`Unknown minion definition: ${options.typeId}`);
  return createGenericMinionInstance({ ...options, definition: toPackDefinition(definition) });
}

export function provisionalMinionDamage(minion: Pick<MinionInstance, "damageClass" | "viewerEstimate">) {
  const base = MOCK_DAMAGE_CLASS_BASES[minion.damageClass];
  const communityFactor = Math.max(0.75, Math.min(2, Math.pow(Math.max(1, minion.viewerEstimate) / 10, 0.25)));
  return Math.round(base * communityFactor);
}

export function phaseCurseIntensity(phase: BossPhaseId) {
  return phaseIntensity(ACTIVE_EVENT_PACK.boss.phases, phase);
}

export function getCurseDefinition(key: string | null) {
  return key ? CURSE_TYPES[key] ?? null : null;
}

export function acceptParticipantAction(options: {
  definition: MinionDefinitionConfig;
  runtimeConfig: Record<string, unknown>;
  participants: Map<string, string | null>;
  participantId: string;
  text: string;
}) {
  return acceptGenericParticipantAction({ ...options, definition: toPackDefinition(options.definition) });
}
