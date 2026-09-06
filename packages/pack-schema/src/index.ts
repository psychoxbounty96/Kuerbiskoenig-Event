export type EventPackGameMode = "PARTICIPATION" | "VOTE" | "VISUAL_CHOICE" | "MEMORY";
export type EventPackDamageClass = string;

export interface EventPackQuestion {
  question: string;
  answers: Record<string, string>;
  correctAnswer: string;
  difficulty?: number;
}

export interface EventPackPhase {
  id: number;
  name: string;
  minPercent: number;
  maxPercent: number;
  color: string;
  spawnWindowMinutes: [number, number];
  intensity: number;
}

export interface EventPackMilestone {
  percent: number;
  label: string;
  description: string;
}

export interface EventPackAnimationAsset {
  type: "static" | "spritesheet" | "css";
  source?: string;
  fallbackSource?: string;
  frameWidth?: number;
  frameHeight?: number;
  columns?: number;
  rows?: number;
  frameCount?: number;
  scale?: number;
  anchor?: { x: number; y: number };
  clips?: Record<string, { startFrame: number; frameCount: number; fps: number; loop: boolean; next?: string | null }>;
}

export type EventPackAsset = string | EventPackAnimationAsset;

export type RuntimeGenerator =
  | { type: "none" }
  | { type: "random-choice"; options: string[]; visualTarget?: boolean; tieStrategy?: "failure" }
  | { type: "random-number"; minimum: number; maximum: number }
  | { type: "random-option-count"; minimumOptions: number; maximumOptions: number }
  | { type: "question-pool"; questions: EventPackQuestion[] }
  | {
      type: "fixed-sequence";
      sequence: string[];
      options: string[];
      optionLabels: Record<string, string>;
      correctAnswer: string;
      tieStrategy?: "failure";
    };

export interface EventPackMinion {
  key: string;
  name: string;
  icon: string;
  gameMode: EventPackGameMode;
  phaseMinimum: number;
  weight: number;
  introDurationMs: number;
  durationSeconds: number;
  observeSeconds: number;
  damageClass: EventPackDamageClass;
  failureEffectKey: string | null;
  command: string;
  minimumParticipants: number;
  maximumParticipants: number;
  participationFactor: number;
  curveExponent: number;
  introTitle: string;
  gameplayTitle: string;
  instruction: string;
  presentation: string;
  runtime: RuntimeGenerator;
  asset: EventPackAsset;
}

export interface EventPackEffect {
  key: string;
  name: string;
  durationMs: number;
  intensity: number;
  presentation: string;
  asset?: EventPackAsset | null;
  config?: Record<string, unknown>;
}

export interface EventPackManifest {
  schemaVersion: 1;
  key: string;
  version: string;
  locale: string;
  name: string;
  description: string;
  engine: { minimumVersion: string };
  events: Array<{ slug: string; variant: "production" | "test"; testControls: boolean }>;
  theme: {
    className: string;
    colors: Record<string, string>;
    labels: Record<string, string>;
  };
  boss: {
    name: string;
    defaultMaxHp: number;
    asset: EventPackAsset;
    phases: EventPackPhase[];
    milestones: EventPackMilestone[];
  };
  damageClasses: Record<string, { baseDamage: number; provisional: boolean }>;
  minions: EventPackMinion[];
  effects: EventPackEffect[];
  scheduling: {
    raidSpecialMinionKey: string | null;
    raidDelaySeconds: [number, number];
    raidCooldownSeconds: [number, number];
  };
  integrations?: {
    discord?: { senderName: string; footer: string; defaultLiveDescription: string; color: number };
  };
  website?: {
    headline: string;
    shortDescription: string;
    callToAction: string;
  };
}

const KEY_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid event pack: ${message}`);
}

function unique(values: string[], label: string) {
  assert(new Set(values).size === values.length, `${label} must be unique`);
}

function containsSecretMaterial(value: unknown, path = "pack"): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (/(secret|service.?role|access.?token|refresh.?token|private.?key|password)/i.test(key)) return childPath;
    if (typeof child === "string" && /(sb_secret_|BEGIN (?:RSA |EC )?PRIVATE KEY)/i.test(child)) return childPath;
    const nested = containsSecretMaterial(child, childPath);
    if (nested) return nested;
  }
  return null;
}

export function validateEventPack(value: unknown): EventPackManifest {
  assert(Boolean(value) && typeof value === "object", "manifest must be an object");
  const pack = value as EventPackManifest;
  assert(pack.schemaVersion === 1, "unsupported schemaVersion");
  assert(KEY_PATTERN.test(pack.key), "key must be URL-safe");
  assert(VERSION_PATTERN.test(pack.version), "version must use semantic versioning");
  assert(Boolean(pack.name?.trim()), "name is required");
  assert(Array.isArray(pack.events) && pack.events.length > 0, "at least one event target is required");
  unique(pack.events.map((event) => event.slug), "event slugs");
  assert(Array.isArray(pack.boss?.phases) && pack.boss.phases.length > 0, "at least one phase is required");
  unique(pack.boss.phases.map((phase) => String(phase.id)), "phase ids");
  for (const [index, phase] of pack.boss.phases.entries()) {
    assert(Number.isInteger(phase.id) && phase.id > 0 && phase.id <= 32767, "phase ids must be positive small integers");
    assert(phase.minPercent >= 0 && phase.maxPercent <= 100 && phase.minPercent < phase.maxPercent, `invalid phase ${phase.id} boundaries`);
    assert(phase.spawnWindowMinutes[0] > 0 && phase.spawnWindowMinutes[1] >= phase.spawnWindowMinutes[0], `invalid phase ${phase.id} spawn window`);
    if (index === 0) assert(phase.maxPercent === 100, "first phase must start at 100 percent");
    if (index > 0) assert(pack.boss.phases[index - 1].minPercent === phase.maxPercent, `phase ${phase.id} must continue the previous boundary`);
    if (index === pack.boss.phases.length - 1) assert(phase.minPercent === 0, "last phase must end at zero percent");
  }
  unique(pack.minions.map((minion) => minion.key), "minion keys");
  unique(pack.effects.map((effect) => effect.key), "effect keys");
  const effectKeys = new Set(pack.effects.map((effect) => effect.key));
  const minionKeys = new Set(pack.minions.map((minion) => minion.key));
  const phaseIds = new Set(pack.boss.phases.map((phase) => phase.id));
  const damageClassKeys = new Set(Object.keys(pack.damageClasses ?? {}));
  unique([...damageClassKeys], "damage class keys");
  assert(damageClassKeys.size > 0, "at least one damage class is required");
  for (const key of damageClassKeys) assert(KEY_PATTERN.test(key.toLowerCase()), `invalid damage class ${key}`);
  for (const minion of pack.minions) {
    assert(KEY_PATTERN.test(minion.key), `invalid minion key ${minion.key}`);
    assert(phaseIds.has(minion.phaseMinimum), `unknown minimum phase ${minion.phaseMinimum} for ${minion.key}`);
    assert(!minion.failureEffectKey || effectKeys.has(minion.failureEffectKey), `unknown effect ${minion.failureEffectKey}`);
    assert(damageClassKeys.has(minion.damageClass), `unknown damage class ${minion.damageClass}`);
    assert(minion.minimumParticipants > 0 && minion.maximumParticipants >= minion.minimumParticipants, `invalid participant bounds for ${minion.key}`);
    assert(minion.durationSeconds > 0 && minion.introDurationMs >= 0, `invalid timing for ${minion.key}`);
    if (minion.runtime.type === "question-pool") {
      assert(Array.isArray(minion.runtime.questions) && minion.runtime.questions.length > 0, `question pool is empty for ${minion.key}`);
      for (const question of minion.runtime.questions) {
        assert(Boolean(question.question?.trim()), `question text is missing for ${minion.key}`);
        assert(Object.keys(question.answers ?? {}).length >= 2, `question answers are missing for ${minion.key}`);
        assert(Boolean(question.answers?.[question.correctAnswer]), `question correct answer is invalid for ${minion.key}`);
      }
    }
  }
  assert(!pack.scheduling.raidSpecialMinionKey || minionKeys.has(pack.scheduling.raidSpecialMinionKey), "raid special references an unknown minion");
  const secretPath = containsSecretMaterial(pack);
  assert(!secretPath, `secret-like field is not allowed at ${secretPath}`);
  return pack;
}
