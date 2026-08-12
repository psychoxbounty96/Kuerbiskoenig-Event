import type { BossPhaseId, MinionDamageClass, MinionGameMode, ProviderMode } from "./types";

// Boundary rule shared with the SQL migration: (min, max], except Phase IV [0, 25].
export const PHASES = [
  { id: 1, roman: "I", name: "Das Erwachen", minPercent: 75, maxPercent: 100, color: "#d8a35d" },
  { id: 2, roman: "II", name: "Der Fluch", minPercent: 50, maxPercent: 75, color: "#c878f2" },
  { id: 3, roman: "III", name: "Die Dunkelheit", minPercent: 25, maxPercent: 50, color: "#7f75e9" },
  { id: 4, roman: "IV", name: "Der Untergang", minPercent: 0, maxPercent: 25, color: "#e65333" },
] as const;

export const MILESTONES = [
  { percent: 75, label: "Phase II", description: "Der Fluch beginnt" },
  { percent: 50, label: "Phase III", description: "Die Dunkelheit bricht herein" },
  { percent: 25, label: "Phase IV", description: "Der Untergang naht" },
  { percent: 10, label: "Finale Warnung", description: "Der Kürbiskönig steht kurz vor dem Fall" },
] as const;

export interface MinionDefinitionConfig {
  id: string;
  name: string;
  icon: string;
  gameMode: MinionGameMode;
  phaseMin: BossPhaseId;
  weight: number;
  introDurationMs: number;
  duration: number;
  observeSeconds: number;
  damageClass: MinionDamageClass;
  failureCurseKey: string;
  command: "!boss";
  minRequired: number;
  maxRequired: number;
  participationFactor: number;
  curveExponent: number;
  introTitle: string;
  gameplayTitle: string;
  instruction: string;
  options?: readonly string[];
}

export const MINION_TYPES = {
  ghost: {
    id: "ghost",
    name: "Rastloser Geist",
    icon: "👻",
    gameMode: "PARTICIPATION",
    phaseMin: 1,
    weight: 1,
    introDurationMs: 3_000,
    duration: 40,
    observeSeconds: 0,
    damageClass: "STANDARD",
    failureCurseKey: "fog",
    command: "!boss",
    minRequired: 2,
    maxRequired: 24,
    participationFactor: 0.45,
    curveExponent: 0.72,
    introTitle: "Ein Geist ist erschienen!",
    gameplayTitle: "Fangt den Geist!",
    instruction: "Schreibe !boss",
  },
  zombie_horde: {
    id: "zombie_horde",
    name: "Zombiehorde",
    icon: "🧟",
    gameMode: "VISUAL_CHOICE",
    phaseMin: 1,
    weight: 1,
    introDurationMs: 3_000,
    duration: 25,
    observeSeconds: 4,
    damageClass: "STANDARD",
    failureCurseKey: "zombie_hands",
    command: "!boss",
    minRequired: 2,
    maxRequired: 24,
    participationFactor: 0.42,
    curveExponent: 0.72,
    introTitle: "Eine Horde nähert sich!",
    gameplayTitle: "Wo greift die Horde an?",
    instruction: "!boss links · mitte · rechts",
    options: ["links", "mitte", "rechts"],
  },
  spider_queen: {
    id: "spider_queen",
    name: "Spinnenkönigin",
    icon: "🕷️",
    gameMode: "VISUAL_CHOICE",
    phaseMin: 1,
    weight: 1,
    introDurationMs: 3_000,
    duration: 25,
    observeSeconds: 0,
    damageClass: "STANDARD",
    failureCurseKey: "spider_web",
    command: "!boss",
    minRequired: 2,
    maxRequired: 24,
    participationFactor: 0.42,
    curveExponent: 0.72,
    introTitle: "Die Spinnenkönigin kriecht heran!",
    gameplayTitle: "Findet die Königin!",
    instruction: "Schreibe z. B. !boss 4",
  },
  witch: {
    id: "witch",
    name: "Die Hexe",
    icon: "🧙",
    gameMode: "VOTE",
    phaseMin: 2,
    weight: 1.1,
    introDurationMs: 3_000,
    duration: 35,
    observeSeconds: 0,
    damageClass: "HIGH",
    failureCurseKey: "witch_distortion",
    command: "!boss",
    minRequired: 2,
    maxRequired: 26,
    participationFactor: 0.4,
    curveExponent: 0.72,
    introTitle: "Die Hexe stellt euch eine Frage!",
    gameplayTitle: "Die Hexe fragt:",
    instruction: "Antworte mit !boss A, B oder C",
    options: ["a", "b", "c"],
  },
  bat_swarm: {
    id: "bat_swarm",
    name: "Fledermausschwarm",
    icon: "🦇",
    gameMode: "MEMORY",
    phaseMin: 2,
    weight: 1.05,
    introDurationMs: 3_000,
    duration: 20,
    observeSeconds: 5,
    damageClass: "STANDARD",
    failureCurseKey: "bat_attack",
    command: "!boss",
    minRequired: 2,
    maxRequired: 24,
    participationFactor: 0.42,
    curveExponent: 0.72,
    introTitle: "Ein Schwarm verdunkelt den Himmel!",
    gameplayTitle: "Wie viele waren es?",
    instruction: "Schreibe z. B. !boss 7",
  },
  reaper: {
    id: "reaper",
    name: "Der Sensenmann",
    icon: "💀",
    gameMode: "MEMORY",
    phaseMin: 3,
    weight: 0.7,
    introDurationMs: 3_000,
    duration: 25,
    observeSeconds: 4,
    damageClass: "HIGH",
    failureCurseKey: "darkness",
    command: "!boss",
    minRequired: 2,
    maxRequired: 26,
    participationFactor: 0.4,
    curveExponent: 0.72,
    introTitle: "Der Sensenmann prüft euer Gedächtnis!",
    gameplayTitle: "Welche Folge war richtig?",
    instruction: "Antworte mit !boss A, B oder C",
    options: ["a", "b", "c"],
  },
  kings_herald: {
    id: "kings_herald",
    name: "Herold des Königs",
    icon: "👑",
    gameMode: "PARTICIPATION",
    phaseMin: 1,
    weight: 0,
    introDurationMs: 4_000,
    duration: 45,
    observeSeconds: 0,
    damageClass: "ELITE",
    failureCurseKey: "royal_curse",
    command: "!boss",
    minRequired: 4,
    maxRequired: 38,
    participationFactor: 0.55,
    curveExponent: 0.72,
    introTitle: "Verstärkung ist eingetroffen!",
    gameplayTitle: "Schlagt den Herold zurück!",
    instruction: "Schreibe !boss",
  },
} as const satisfies Record<string, MinionDefinitionConfig>;

export const CURSE_TYPES = {
  fog: { key: "fog", name: "Geisternebel", durationMs: 12_000, baseIntensity: 0.7 },
  zombie_hands: { key: "zombie_hands", name: "Zombiehände", durationMs: 10_000, baseIntensity: 0.7 },
  spider_web: { key: "spider_web", name: "Spinnenbefall", durationMs: 12_000, baseIntensity: 0.7 },
  witch_distortion: { key: "witch_distortion", name: "Hexenfluch", durationMs: 11_000, baseIntensity: 0.7 },
  bat_attack: { key: "bat_attack", name: "Fledermausangriff", durationMs: 10_000, baseIntensity: 0.7 },
  darkness: { key: "darkness", name: "Dunkelheit", durationMs: 10_000, baseIntensity: 0.7 },
  royal_curse: { key: "royal_curse", name: "Königlicher Fluch", durationMs: 12_000, baseIntensity: 0.7 },
} as const;

// Provisional, event-configurable preview values. Production authority lives in minion_damage_classes.
export const MOCK_DAMAGE_CLASS_BASES: Record<MinionDamageClass, number> = {
  STANDARD: 5_000,
  HIGH: 8_000,
  ELITE: 12_000,
  SPECIAL: 15_000,
};

export const DAMAGE_PRESETS = [100, 1_000, 5_000, 10_000, 50_000] as const;
export const STORAGE_KEY = "pumpkin-king-event-state-v4";
export const BROADCAST_CHANNEL = "pumpkin-king-event-sync-v4";
export const RESOLUTION_DISPLAY_MS = 4_500;
export const MAX_LOG_ENTRIES = 40;
export const REFRESH_INTERVAL_MS = 30_000;

export const DATA_PROVIDER_MODE: ProviderMode =
  process.env.NEXT_PUBLIC_DATA_PROVIDER === "supabase" ? "supabase" : "mock";
const configuredEventSlug = process.env.NEXT_PUBLIC_EVENT_SLUG || "halloween-2026";
const adminEventOverride = typeof window !== "undefined" && /\/admin\/?$/.test(window.location.pathname)
  ? new URLSearchParams(window.location.search).get("event")?.trim().toLowerCase() ?? ""
  : "";
export const EVENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(adminEventOverride)
  ? adminEventOverride
  : configuredEventSlug;
// Development / debug only. The production StreamElements widget resolves channel.username automatically.
export const DEFAULT_OVERLAY_STREAMER = process.env.NEXT_PUBLIC_STREAMER_SLUG || "knoobbi";

export function calculateBossPhase(currentHp: number, maxHp: number) {
  const percent = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
  return (
    PHASES.find(
      (phase) =>
        percent <= phase.maxPercent &&
        (phase.minPercent === 0 ? percent >= phase.minPercent : percent > phase.minPercent),
    ) ?? PHASES[PHASES.length - 1]
  );
}

export function getPhaseTargetHp(phaseId: BossPhaseId, maxHp: number) {
  const targetPercent: Record<BossPhaseId, number> = {
    1: 100,
    2: 75,
    3: 50,
    4: 25,
  };
  return Math.round(maxHp * (targetPercent[phaseId] / 100));
}

export function getNextMilestone(currentHp: number, maxHp: number) {
  const percent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0;
  const milestone = MILESTONES.find((item) => item.percent < percent);

  if (!milestone) {
    return { label: "Boss besiegen", damageRemaining: Math.max(0, currentHp), percent: 0 };
  }

  return {
    ...milestone,
    damageRemaining: Math.max(0, currentHp - Math.round(maxHp * (milestone.percent / 100))),
  };
}

// v0.3 dry-run boundary: no formula and no automatic HP mutation by design.
export function calculatePassiveDamagePreview(viewerCount: number): null {
  void viewerCount;
  return null;
}
