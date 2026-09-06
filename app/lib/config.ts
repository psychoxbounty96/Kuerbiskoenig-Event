import { EVENT_PACKS, getEventPack } from "../../event-packs/registry";
import { calculatePhase, getNextMilestone as nextMilestone, getPhaseTargetHp as phaseTargetHp } from "../../packages/event-engine/src/phases";
import type { EventPackDamageClass, EventPackGameMode, EventPackMinion } from "../../packages/pack-schema/src";
import type { BossPhaseId, ProviderMode } from "./types";

export const PACK_KEY = process.env.NEXT_PUBLIC_PACK_KEY || Object.keys(EVENT_PACKS)[0];
export const ACTIVE_EVENT_PACK = getEventPack(PACK_KEY);

export function getPackAssetSource(asset: EventPackMinion["asset"] | null | undefined) {
  if (!asset) return "";
  if (typeof asset === "string") return asset;
  return asset.source || asset.fallbackSource || "";
}

export function getPackAssetUrl(asset: EventPackMinion["asset"] | null | undefined) {
  const source = getPackAssetSource(asset);
  if (!source) return "";
  if (/^https:\/\//i.test(source)) return source;
  return `${import.meta.env.BASE_URL}${source.replace(/^\/+/, "")}`;
}

function roman(value: number) {
  const numerals: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let remaining = Math.max(1, Math.floor(value));
  let result = "";
  for (const [amount, symbol] of numerals) while (remaining >= amount) { result += symbol; remaining -= amount; }
  return result;
}

export const PHASES = ACTIVE_EVENT_PACK.boss.phases.map((phase) => ({ ...phase, roman: roman(phase.id) }));
export const MILESTONES = ACTIVE_EVENT_PACK.boss.milestones;

export interface MinionDefinitionConfig {
  id: string;
  name: string;
  icon: string;
  gameMode: EventPackGameMode;
  phaseMin: BossPhaseId;
  weight: number;
  introDurationMs: number;
  duration: number;
  observeSeconds: number;
  damageClass: EventPackDamageClass;
  failureCurseKey: string;
  command: string;
  minRequired: number;
  maxRequired: number;
  participationFactor: number;
  curveExponent: number;
  introTitle: string;
  gameplayTitle: string;
  instruction: string;
  presentation: string;
  runtime: EventPackMinion["runtime"];
  asset: EventPackMinion["asset"];
  options?: readonly string[];
}

export const MINION_TYPES = Object.fromEntries(ACTIVE_EVENT_PACK.minions.map((definition) => [definition.key, {
  id: definition.key,
  name: definition.name,
  icon: definition.icon,
  gameMode: definition.gameMode,
  phaseMin: definition.phaseMinimum,
  weight: definition.weight,
  introDurationMs: definition.introDurationMs,
  duration: definition.durationSeconds,
  observeSeconds: definition.observeSeconds,
  damageClass: definition.damageClass,
  failureCurseKey: definition.failureEffectKey ?? "",
  command: definition.command,
  minRequired: definition.minimumParticipants,
  maxRequired: definition.maximumParticipants,
  participationFactor: definition.participationFactor,
  curveExponent: definition.curveExponent,
  introTitle: definition.introTitle,
  gameplayTitle: definition.gameplayTitle,
  instruction: definition.instruction,
  presentation: definition.presentation,
  runtime: definition.runtime,
  asset: definition.asset,
  options: definition.runtime.type === "random-choice" || definition.runtime.type === "fixed-sequence" ? definition.runtime.options : undefined,
}])) as Record<string, MinionDefinitionConfig>;

export const CURSE_TYPES = Object.fromEntries(ACTIVE_EVENT_PACK.effects.map((effect) => [effect.key, {
  key: effect.key,
  name: effect.name,
  durationMs: effect.durationMs,
  baseIntensity: effect.intensity,
  presentation: effect.presentation,
  asset: effect.asset ?? null,
}])) as Record<string, { key: string; name: string; durationMs: number; baseIntensity: number; presentation: string; asset: EventPackMinion["asset"] | null }>;

export const MOCK_DAMAGE_CLASS_BASES = Object.fromEntries(
  Object.entries(ACTIVE_EVENT_PACK.damageClasses).map(([key, value]) => [key, value.baseDamage]),
) as Record<EventPackDamageClass, number>;

export const DAMAGE_PRESETS = [100, 1_000, 5_000, 10_000, 50_000] as const;
export const STORAGE_KEY = "pxb-event-engine-state-v1";
export const BROADCAST_CHANNEL = "pxb-event-engine-sync-v1";
export const RESOLUTION_DISPLAY_MS = 4_500;
export const MAX_LOG_ENTRIES = 40;
export const REFRESH_INTERVAL_MS = 30_000;

export const DATA_PROVIDER_MODE: ProviderMode = process.env.NEXT_PUBLIC_DATA_PROVIDER === "supabase" ? "supabase" : "mock";
const defaultEvent = ACTIVE_EVENT_PACK.events.find((event) => event.variant === "production") ?? ACTIVE_EVENT_PACK.events[0];
const configuredEventSlug = process.env.NEXT_PUBLIC_EVENT_SLUG || defaultEvent.slug;
const adminEventOverride = typeof window !== "undefined" && /\/admin\/?$/.test(window.location.pathname)
  ? new URLSearchParams(window.location.search).get("event")?.trim().toLowerCase() ?? ""
  : "";
export const EVENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(adminEventOverride) ? adminEventOverride : configuredEventSlug;
export const DEFAULT_OVERLAY_STREAMER = process.env.NEXT_PUBLIC_STREAMER_SLUG || "";

export function calculateBossPhase(currentHp: number, maxHp: number) {
  return calculatePhase(PHASES, currentHp, maxHp);
}

export function getPhaseTargetHp(phaseId: BossPhaseId, maxHp: number) {
  return phaseTargetHp(PHASES, phaseId, maxHp);
}

export function getNextMilestone(currentHp: number, maxHp: number) {
  return nextMilestone(MILESTONES, currentHp, maxHp);
}

export function calculatePassiveDamagePreview(viewerCount: number): null {
  void viewerCount;
  return null;
}
