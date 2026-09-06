import type { EventPackMilestone, EventPackPhase } from "../../pack-schema/src";

export function calculatePhase(phases: readonly EventPackPhase[], currentHp: number, maxHp: number) {
  if (!phases.length) throw new Error("At least one boss phase is required.");
  const percent = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
  return phases.find((phase) => (
    percent <= phase.maxPercent && (phase.minPercent === 0 ? percent >= 0 : percent > phase.minPercent)
  )) ?? phases[phases.length - 1];
}

export function getPhaseTargetHp(phases: readonly EventPackPhase[], phaseId: number, maxHp: number) {
  const phase = phases.find((candidate) => candidate.id === phaseId);
  if (!phase) throw new Error(`Unknown phase: ${phaseId}`);
  return Math.round(Math.max(0, maxHp) * (phase.maxPercent / 100));
}

export function getNextMilestone(
  milestones: readonly EventPackMilestone[],
  currentHp: number,
  maxHp: number,
  finalLabel = "Boss besiegen",
) {
  const percent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0;
  const milestone = [...milestones].sort((left, right) => right.percent - left.percent)
    .find((item) => item.percent < percent);
  if (!milestone) return { label: finalLabel, damageRemaining: Math.max(0, currentHp), percent: 0 };
  return {
    ...milestone,
    damageRemaining: Math.max(0, currentHp - Math.round(maxHp * (milestone.percent / 100))),
  };
}

export function phaseIntensity(phases: readonly EventPackPhase[], phaseId: number, fallback = 1) {
  return phases.find((phase) => phase.id === phaseId)?.intensity ?? fallback;
}
