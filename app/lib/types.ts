export type BossPhaseId = 1 | 2 | 3 | 4;
export type ProviderMode = "mock" | "supabase";
export type ProviderStatus = "loading" | "ready" | "degraded" | "error";
export type EventStatus = "draft" | "testing" | "active" | "paused" | "finished" | "archived";
export type MinionStatus =
  | "scheduled"
  | "intro"
  | "active"
  | "success"
  | "failure"
  | "curse"
  | "complete"
  | "cancelled"
  | "expired";
export type MinionGameMode = "PARTICIPATION" | "VOTE" | "VISUAL_CHOICE" | "MEMORY";
export type MinionDamageClass = "STANDARD" | "HIGH" | "ELITE" | "SPECIAL";
export type MinionTriggerSource = "scheduler" | "raid" | "admin" | "manual_test";
export type AdminRole = "owner" | "admin" | "operator" | "viewer";
export type TwitchHealthStatus = "healthy" | "warning" | "error";
export type PassiveDamageMode = "disabled" | "dry_run" | "test" | "active";
export type OverlayIdentityStatus =
  | "loading"
  | "resolved"
  | "not_registered"
  | "disabled"
  | "event_unavailable"
  | "error";

export interface OverlayIdentityResolution {
  status: OverlayIdentityStatus;
  channelUsername: string | null;
  eventId: string | null;
  eventSlug: string | null;
  eventStatus: EventStatus | null;
  streamerId: string | null;
  streamerSlug: string | null;
  streamerDisplayName: string | null;
  isTestAccount: boolean;
  testActionsAuthorized: boolean;
}

export interface StreamSessionState {
  id: string;
  streamId: string;
  startedAt: string;
  endedAt: string | null;
  status: "live" | "ended";
  averageViewers: number;
  peakViewers: number;
  latestViewers: number;
  sampleCount: number;
  durationSeconds: number;
}

export interface StreamerState {
  id: string;
  slug: string;
  displayName: string;
  communityName: string;
  twitchLogin: string;
  twitchUserId: string | null;
  twitchUrl: string;
  avatarUrl: string | null;
  enabled: boolean;
  isTestAccount?: boolean;
  trackingEnabled: boolean;
  gameplayEnabled: boolean;
  publicVisible: boolean;
  includeInCalibration: boolean;
  damage: number;
  minionsDefeated: number;
  live: boolean;
  liveSince: string | null;
  currentStreamId: string | null;
  currentViewerCount: number;
  lastTwitchSyncAt: string | null;
  lastSeenLiveAt: string | null;
  latestSession: StreamSessionState | null;
  sortOrder: number;
}

export interface StreamerInput {
  slug?: string;
  displayName: string;
  communityName: string;
  twitchLogin: string;
  twitchUrl: string;
  avatarUrl?: string | null;
  enabled: boolean;
  isTestAccount?: boolean;
  trackingEnabled?: boolean;
  gameplayEnabled?: boolean;
  publicVisible?: boolean;
  includeInCalibration?: boolean;
}

export interface MinionInstance {
  instanceId: string;
  definitionId: string;
  typeId: string;
  name: string;
  icon: string;
  command: string;
  gameMode: MinionGameMode;
  damageClass: MinionDamageClass;
  failureCurseKey: string | null;
  introTitle: string;
  gameplayTitle: string;
  instruction: string;
  streamerId: string;
  streamerSlug: string;
  streamerName: string;
  status: MinionStatus;
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
  resolvedAt?: number;
  resultEndsAt?: number;
  curseEndsAt?: number;
  completedAt?: number;
  damageAwarded: number;
  triggerSource: MinionTriggerSource;
  triggerReference?: string | null;
  displayUntil?: number;
}

export interface MinionActionInput {
  eventId: string;
  streamerId: string;
  minionEventId: string;
  participantId: string;
  messageId: string;
  text: string;
}

export interface MilestoneState {
  id: string;
  label: string;
  percent: number;
  description: string;
  reachedAt: string | null;
  sortOrder: number;
}

export interface EventSettingsState {
  eventPaused: boolean;
  damageEnabled: boolean;
  minionsEnabled: boolean;
  globalDamageMultiplier: number;
  passiveDamageMultiplier: number;
  activeDamageMultiplier: number;
  passiveTickSeconds: number;
  twitchTrackingEnabled: boolean;
  passiveDamageEnabled: boolean;
  passiveDamageMode: PassiveDamageMode;
  passiveBaseDamage: number;
  passiveCurveExponent: number;
  passiveSoftCap: number;
  passiveMinDamage: number;
  passiveMaxDamage: number;
  passiveUnderdogFactor: number;
  passiveConfigurationVersion: number;
}

export interface PassiveDamageTickState {
  id: string | null;
  streamerId: string | null;
  bucketStartedAt: string | null;
  mode: PassiveDamageMode;
  viewerEstimate: number | null;
  sampleCount: number;
  configuredDamage: number;
  appliedDamage: number;
  status: "none" | "pending" | "preview" | "applied" | "skipped";
  skipReason: string | null;
  configurationVersion: number;
  processedAt: string | null;
}

export interface EventJobStatusState {
  key: "twitch_sync" | "minion_tick" | "passive_damage_tick" | "eventsub_sync";
  status: "idle" | "running" | "healthy" | "warning" | "error";
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  nextExpectedAt: string | null;
}

export interface CalibrationStreamerState {
  streamerId: string;
  displayName: string;
  included: boolean;
  isTestAccount: boolean;
  sampleCount: number;
  averageViewers: number;
  medianViewers: number;
  peakViewers: number;
  streams: number;
  streamsPerWeek: number;
  averageStreamSeconds: number;
  totalLiveSeconds: number;
  dryRunDamage: number;
  passiveDamagePerHour: number;
  appliedPassiveDamage: number;
  minionsSpawned: number;
  minionsDefeated: number;
  minionsFailed: number;
  minionSuccessRates: Record<string, { spawned: number; defeated: number; successRate: number }>;
}

export interface CalibrationState {
  streamers: CalibrationStreamerState[];
  includedStreamers: number;
  totalSamples: number;
  projectedPassiveDamage: number;
  projectedPassiveDamagePerHour: number;
  maxConcurrentStreamers: number;
  minionsSpawned: number;
  minionsDefeated: number;
  minionsFailed: number;
}

export interface EventLogEntry {
  id: string;
  timestamp: string;
  type: "damage" | "minion" | "system" | "admin" | "twitch";
  message: string;
  actor?: string | null;
}

export interface RaidEventState {
  id: string;
  fromStreamerId: string | null;
  toStreamerId: string | null;
  fromTwitchUserId: string;
  toTwitchUserId: string;
  viewerCount: number;
  occurredAt: string;
  eligible: boolean;
  source: "twitch_eventsub" | "manual_test";
}

export interface TwitchIntegrationState {
  health: {
    status: TwitchHealthStatus;
    reason: string;
    webhookConfigured: boolean;
    lastSyncAt: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
    lastWebhookAt: string | null;
    lastInvalidSignatureAt: string | null;
    lastSubscriptionSyncAt: string | null;
  };
  subscriptions: {
    online: number;
    offline: number;
    raid: number;
    pending: number;
    revokedOrError: number;
  };
  recentRaids: RaidEventState[];
  passiveDamagePreview: null;
}

export interface EventState {
  version: number;
  updatedAt: string;
  event: {
    id: string;
    slug: string;
    name: string;
    description: string;
    status: EventStatus;
    active: boolean;
    isTest: boolean;
  };
  boss: {
    id: string;
    name: string;
    maxHp: number;
    currentHp: number;
    phase: BossPhaseId;
    phaseName: string;
  };
  settings: EventSettingsState;
  stats: {
    globalDamage: number;
    minionsDefeated: number;
    minionsEscaped: number;
    communities: number;
    uniqueParticipants: number;
  };
  streamers: StreamerState[];
  minions: MinionInstance[];
  milestones: MilestoneState[];
  twitch: TwitchIntegrationState;
  passiveDamage: PassiveDamageTickState;
  jobs: EventJobStatusState[];
  calibration: CalibrationState;
  log: EventLogEntry[];
}

export interface ProviderRuntime {
  mode: ProviderMode;
  status: ProviderStatus;
  realtime: "disabled" | "connecting" | "connected" | "disconnected";
  error: string | null;
  lastSyncedAt: string | null;
}

export interface ProviderSnapshot {
  state: EventState;
  runtime: ProviderRuntime;
}

export interface AdminSession {
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  role: AdminRole | null;
  loading: boolean;
  error: string | null;
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  message: string;
  data?: T;
}
