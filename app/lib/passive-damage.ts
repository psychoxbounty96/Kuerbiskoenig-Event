export type PassiveDamageMode = "disabled" | "dry_run" | "test" | "active";

export interface ViewerSampleInput {
  viewerCount: number;
  sampledAt?: number;
  valid?: boolean;
}

export interface PassiveDamageConfig {
  baseDamage: number;
  curveExponent: number;
  softCap: number;
  minDamage: number;
  maxDamage: number;
  underdogFactor: number;
}

export interface PassiveEligibilityInput {
  mode: PassiveDamageMode;
  eventStatus: string;
  eventPaused: boolean;
  damageEnabled: boolean;
  streamerEnabled: boolean;
  trackingEnabled: boolean;
  gameplayEnabled: boolean;
  includeInCalibration: boolean;
  isTestAccount: boolean;
  isLive: boolean;
  bossAlive: boolean;
  hasFreshSample: boolean;
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function stableViewerEstimate(samples: ViewerSampleInput[]) {
  const values = samples
    .filter((sample) => sample.valid !== false && Number.isFinite(sample.viewerCount) && sample.viewerCount >= 0)
    .slice(0, 3)
    .map((sample) => sample.viewerCount)
    .sort((left, right) => left - right);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? Math.round(values[middle]) : Math.round((values[middle - 1] + values[middle]) / 2);
}

export function calculatePassiveDamage(viewerEstimate: number, config: PassiveDamageConfig) {
  const viewers = finiteNonNegative(viewerEstimate);
  const baseDamage = finiteNonNegative(config.baseDamage);
  const exponent = Math.min(1.5, Math.max(0.05, finiteNonNegative(config.curveExponent)));
  const softCap = Math.max(1, finiteNonNegative(config.softCap));
  const underdog = Math.min(2, finiteNonNegative(config.underdogFactor));
  const minimum = Math.round(finiteNonNegative(config.minDamage));
  const maximum = Math.max(minimum, Math.round(finiteNonNegative(config.maxDamage)));
  const curve = Math.pow(viewers, exponent);
  const diminishing = Math.sqrt(softCap / (softCap + viewers));
  const underdogBoost = 1 + underdog * (softCap / (softCap + viewers));
  const unclamped = baseDamage * curve * diminishing * underdogBoost;
  return Math.max(minimum, Math.min(maximum, Math.round(finiteNonNegative(unclamped))));
}

export function passiveTickBucket(timestampMs: number, tickSeconds = 120) {
  const bucketMs = Math.max(10, Math.floor(tickSeconds)) * 1_000;
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

export function passiveEligibilityReason(input: PassiveEligibilityInput): string | null {
  if (input.mode === "disabled") return "passive_damage_disabled";
  if (!input.streamerEnabled || !input.trackingEnabled || !input.gameplayEnabled) return "streamer_not_eligible";
  if (input.eventPaused || input.eventStatus === "paused") return "event_paused";
  if (!input.bossAlive) return "boss_defeated";
  if (!input.isLive) return "streamer_offline";
  if (!input.hasFreshSample) return "no_fresh_viewer_sample";
  if (input.mode === "test" && (input.eventStatus !== "testing" || !input.isTestAccount)) return "test_scope_required";
  if (input.mode === "active" && (input.eventStatus !== "active" || input.isTestAccount || !input.includeInCalibration)) {
    return "production_scope_not_eligible";
  }
  if (input.mode === "dry_run" && !["testing", "active"].includes(input.eventStatus)) return "event_not_running";
  if (["test", "active"].includes(input.mode) && !input.damageEnabled) return "damage_disabled";
  return null;
}
