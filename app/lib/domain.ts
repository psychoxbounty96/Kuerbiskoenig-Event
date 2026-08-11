import { calculateBossPhase } from "./config";
import type { EventSettingsState, MilestoneState, MinionInstance } from "./types";

export function clampBossHp(value: number, maxHp: number) {
  return Math.max(0, Math.min(maxHp, Math.round(value)));
}

export function canApplyDamage(settings: EventSettingsState, force = false) {
  if (force) return { allowed: true, reason: null };
  if (settings.eventPaused) return { allowed: false, reason: "Das Event ist pausiert." };
  if (!settings.damageEnabled) return { allowed: false, reason: "Der Damage-Kill-Switch ist aktiv." };
  return { allowed: true, reason: null };
}

export function computeConfiguredDamage(
  rawDamage: number,
  settings: EventSettingsState,
  sourceMultiplier = 1,
) {
  return Math.max(
    0,
    Math.round(rawDamage * settings.globalDamageMultiplier * settings.activeDamageMultiplier * sourceMultiplier),
  );
}

export function markCrossedMilestones(
  milestones: MilestoneState[],
  hpBefore: number,
  hpAfter: number,
  maxHp: number,
  reachedAt: string,
) {
  return milestones.map((milestone) => {
    const threshold = Math.round(maxHp * (milestone.percent / 100));
    if (!milestone.reachedAt && hpBefore > threshold && hpAfter <= threshold) {
      return { ...milestone, reachedAt };
    }
    return milestone;
  });
}

export function isMinionExpired(minion: MinionInstance, now = Date.now()) {
  return minion.status === "active" && minion.expiresAt <= now;
}

export function getVisibleMinionForStreamer(
  minions: MinionInstance[],
  streamerIdentity: string,
  now: number,
) {
  return [...minions]
    .filter(
      (minion) =>
        (minion.streamerId === streamerIdentity || minion.streamerSlug === streamerIdentity) &&
        (["intro", "active", "success", "failure", "curse"].includes(minion.status) ||
          (minion.displayUntil ?? 0) > now),
    )
    .sort((a, b) => b.spawnedAt - a.spawnedAt)[0] ?? null;
}

export function deriveBossPhase(currentHp: number, maxHp: number) {
  const phase = calculateBossPhase(currentHp, maxHp);
  return { phase: phase.id, phaseName: phase.name };
}
