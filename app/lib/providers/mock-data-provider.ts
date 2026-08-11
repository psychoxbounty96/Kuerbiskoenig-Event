import {
  BROADCAST_CHANNEL,
  calculateBossPhase,
  MAX_LOG_ENTRIES,
  MINION_TYPES,
  RESOLUTION_DISPLAY_MS,
  STORAGE_KEY,
} from "../config";
import {
  canApplyDamage,
  clampBossHp,
  computeConfiguredDamage,
  markCrossedMilestones,
} from "../domain";
import {
  createMinionInstance,
  calculateRaidSpecialDelaySeconds,
  evaluateVote,
  getCurseDefinition,
  isOpenMinionStatus,
  parseBossCommand,
  provisionalMinionDamage,
  validateMinionAnswer,
} from "../minion-engine";
import { formatNumber } from "../format";
import { INITIAL_EVENT_STATE } from "../mock-state";
import { normalizeTwitchLogin, resolveParticipantIdentity } from "../streamelements-adapter";
import type {
  ActionResult,
  AdminSession,
  EventLogEntry,
  EventSettingsState,
  EventState,
  EventStatus,
  MinionActionInput,
  MinionInstance,
  OverlayIdentityResolution,
  ProviderSnapshot,
  StreamerInput,
} from "../types";
import type { AdminActionOptions, AdminListener, DataProvider, StateListener } from "./types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function toSlug(value: string) {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || `streamer-${Date.now()}`;
}

function addLog(state: EventState, entry: Omit<EventLogEntry, "id" | "timestamp">) {
  state.log = [
    { id: createId("log"), timestamp: new Date().toISOString(), ...entry },
    ...state.log,
  ].slice(0, MAX_LOG_ENTRIES);
}

function deriveState(state: EventState) {
  const upgradingFromV2 = !state.version || state.version < 3;
  state.version = 4;
  state.twitch ??= clone(INITIAL_EVENT_STATE.twitch);
  state.streamers = state.streamers.map((streamer) => {
    const initial = INITIAL_EVENT_STATE.streamers.find((item) => item.id === streamer.id);
    return {
      ...streamer,
      live: upgradingFromV2 ? initial?.live ?? false : streamer.live,
      twitchUserId: streamer.twitchUserId ?? initial?.twitchUserId ?? null,
      liveSince: streamer.liveSince ?? initial?.liveSince ?? null,
      currentStreamId: streamer.currentStreamId ?? initial?.currentStreamId ?? null,
      currentViewerCount: streamer.currentViewerCount ?? initial?.currentViewerCount ?? 0,
      lastTwitchSyncAt: streamer.lastTwitchSyncAt ?? initial?.lastTwitchSyncAt ?? null,
      lastSeenLiveAt: streamer.lastSeenLiveAt ?? initial?.lastSeenLiveAt ?? null,
      latestSession: streamer.latestSession ?? initial?.latestSession ?? null,
    };
  });
  state.boss.currentHp = clampBossHp(state.boss.currentHp, state.boss.maxHp);
  const phase = calculateBossPhase(state.boss.currentHp, state.boss.maxHp);
  state.boss.phase = phase.id;
  state.boss.phaseName = phase.name;
  const unpausedStatus = state.event.status === "paused"
    ? (state.event.isTest ? "testing" : "active")
    : state.event.status;
  state.event.status = state.settings.eventPaused ? "paused" : unpausedStatus;
  state.event.active = state.event.status === "active" && !state.settings.eventPaused;
  state.event.isTest = unpausedStatus === "draft" || unpausedStatus === "testing";
  state.stats.communities = state.streamers.filter((streamer) => streamer.enabled).length;
  state.updatedAt = new Date().toISOString();
  return state;
}

export class MockDataProvider implements DataProvider {
  readonly mode = "mock" as const;
  private state = clone(INITIAL_EVENT_STATE);
  private listeners = new Set<StateListener>();
  private adminListeners = new Set<AdminListener>();
  private channel: BroadcastChannel | null = null;
  private initialized = false;
  private expiryTimer: number | null = null;
  private participants = new Map<string, Map<string, string | null>>();
  private adminSession: AdminSession = {
    authenticated: true,
    userId: "local-mock-admin",
    email: "mock-admin@local.test",
    role: "owner",
    loading: false,
    error: null,
  };
  private runtime: ProviderSnapshot["runtime"] = {
    mode: "mock",
    status: "ready",
    realtime: "disabled",
    error: null,
    lastSyncedAt: INITIAL_EVENT_STATE.updatedAt,
  };

  private initialize() {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) this.state = deriveState(JSON.parse(stored) as EventState);
    } catch {
      this.state = clone(INITIAL_EVENT_STATE);
    }

    if ("BroadcastChannel" in window) {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL);
      this.channel.addEventListener("message", (event: MessageEvent<EventState>) => {
        this.state = deriveState(clone(event.data));
        this.runtime.lastSyncedAt = new Date().toISOString();
        this.notify();
      });
    }

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        this.state = deriveState(JSON.parse(event.newValue) as EventState);
        this.notify();
      } catch {
        // Keep the last valid in-memory snapshot.
      }
    });

    this.expiryTimer = window.setInterval(() => this.advanceMinionEngine(), 500);
  }

  private notify() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private notifyAdmin() {
    const session = clone(this.adminSession);
    this.adminListeners.forEach((listener) => listener(session));
  }

  private commit(mutator: (draft: EventState) => void) {
    this.initialize();
    const next = clone(this.state);
    mutator(next);
    this.state = deriveState(next);
    this.runtime.lastSyncedAt = new Date().toISOString();

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        // In-memory mode remains functional when storage is blocked.
      }
    }

    this.channel?.postMessage(this.state);
    this.notify();
  }

  private advanceMinionEngine() {
    const now = Date.now();
    const needsAdvance = this.state.minions.some((minion) =>
      (minion.status === "scheduled" && minion.spawnedAt <= now) ||
      (minion.status === "intro" && minion.introEndsAt <= now) ||
      (minion.status === "active" && minion.expiresAt <= now) ||
      (["success", "failure"].includes(minion.status) && (minion.resultEndsAt ?? Infinity) <= now) ||
      (minion.status === "curse" && (minion.curseEndsAt ?? Infinity) <= now),
    );
    if (!needsAdvance) return;
    this.commit((draft) => {
      for (const minion of draft.minions) {
        if (minion.status === "scheduled" && minion.spawnedAt <= now) {
          const conflicting = draft.minions.some((candidate) => candidate.instanceId !== minion.instanceId &&
            candidate.streamerId === minion.streamerId && isOpenMinionStatus(candidate.status));
          if (conflicting) {
            const delay = 5_000;
            minion.spawnedAt += delay;
            minion.introEndsAt += delay;
            minion.gameplayStartsAt += delay;
            minion.acceptsAnswersAt += delay;
            minion.expiresAt += delay;
            continue;
          }
          minion.status = "intro";
          addLog(draft, { type: "minion", actor: "minion-engine", message: `${minion.name} bei ${minion.streamerName} gestartet` });
        }
        if (minion.status === "intro" && minion.introEndsAt <= now) {
          minion.status = "active";
          addLog(draft, { type: "minion", actor: "minion-engine", message: `${minion.name}: Gameplay gestartet` });
        }
        if (minion.status === "active" && minion.expiresAt <= now) {
          const votes = [...(this.participants.get(minion.instanceId)?.values() ?? [])]
            .filter((answer): answer is string => Boolean(answer));
          const success = minion.gameMode === "PARTICIPATION"
            ? minion.participantCount >= minion.requiredParticipants
            : evaluateVote({
              answers: votes,
              requiredParticipants: minion.requiredParticipants,
              correctAnswer: String(minion.runtimeConfig.correctAnswer ?? ""),
            }).success;
          this.resolveMinionDraft(draft, minion, success ? "success" : "failure", now, "minion-engine");
        }
        if ((minion.status === "success" || minion.status === "failure") && (minion.resultEndsAt ?? Infinity) <= now) {
          const curse = minion.status === "failure" ? getCurseDefinition(minion.failureCurseKey) : null;
          if (curse) {
            minion.status = "curse";
            minion.curseEndsAt = now + Math.min(15_000, curse.durationMs);
            addLog(draft, { type: "minion", actor: "curse-engine", message: `${curse.name} bei ${minion.streamerName} gestartet` });
          } else {
            minion.status = "complete";
            minion.completedAt = now;
            minion.displayUntil = now;
          }
        }
        if (minion.status === "curse" && (minion.curseEndsAt ?? Infinity) <= now) {
          minion.status = "complete";
          minion.completedAt = now;
          minion.displayUntil = now;
        }
      }
    });
  }

  private resolveMinionDraft(
    draft: EventState,
    minion: MinionInstance,
    resolution: "success" | "failure" | "cancelled" | "expired",
    now: number,
    actor: string,
  ) {
    if (!["scheduled", "intro", "active"].includes(minion.status)) return 0;
    minion.status = resolution;
    minion.resolvedAt = now;
    minion.resultEndsAt = now + RESOLUTION_DISPLAY_MS;
    minion.displayUntil = now + RESOLUTION_DISPLAY_MS + 15_000;
    let awarded = 0;
    if (resolution === "success" && draft.boss.currentHp > 0) {
      const permission = canApplyDamage(draft.settings);
      const before = draft.boss.currentHp;
      awarded = permission.allowed
        ? Math.min(computeConfiguredDamage(provisionalMinionDamage(minion), draft.settings), before)
        : 0;
      minion.damageAwarded = awarded;
      draft.boss.currentHp = before - awarded;
      draft.stats.globalDamage += awarded;
      draft.stats.minionsDefeated += 1;
      const streamer = draft.streamers.find((item) => item.id === minion.streamerId);
      if (streamer) {
        streamer.damage += awarded;
        streamer.minionsDefeated += 1;
      }
      draft.milestones = markCrossedMilestones(draft.milestones, before, draft.boss.currentHp, draft.boss.maxHp, new Date(now).toISOString());
      if (draft.boss.currentHp <= 0) {
        for (const other of draft.minions) {
          if (other.instanceId !== minion.instanceId && isOpenMinionStatus(other.status)) {
            other.status = "cancelled";
            other.resolvedAt = now;
            other.displayUntil = now + RESOLUTION_DISPLAY_MS;
          }
        }
      }
    } else if (resolution === "failure") {
      draft.stats.minionsEscaped += 1;
    }
    addLog(draft, { type: "minion", actor, message: `${minion.name} bei ${minion.streamerName}: ${resolution}` });
    if (awarded > 0) addLog(draft, { type: "damage", actor: "minion-engine", message: `${formatNumber(awarded)} Minion-Schaden angewandt` });
    return awarded;
  }

  subscribe(listener: StateListener) {
    this.initialize();
    if (!this.expiryTimer && typeof window !== "undefined") {
      this.expiryTimer = window.setInterval(() => this.advanceMinionEngine(), 500);
    }
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.expiryTimer && typeof window !== "undefined") {
        window.clearInterval(this.expiryTimer);
        this.expiryTimer = null;
      }
    };
  }

  subscribeAdmin(listener: AdminListener) {
    this.initialize();
    this.adminListeners.add(listener);
    listener(this.getAdminSession());
    return () => {
      this.adminListeners.delete(listener);
    };
  }

  getSnapshot(): ProviderSnapshot {
    return { state: clone(this.state), runtime: clone(this.runtime) };
  }

  getAdminSession() {
    return clone(this.adminSession);
  }

  getEventState() {
    return clone(this.state);
  }

  getBossState() {
    return clone(this.state.boss);
  }

  getStreamerStats() {
    return clone(this.state.streamers);
  }

  async resolveCurrentStreamer(channelUsername: string, eventSlug = this.state.event.slug): Promise<OverlayIdentityResolution> {
    this.initialize();
    return resolveParticipantIdentity({
      channelUsername,
      eventSlug,
      currentEventId: this.state.event.id,
      currentEventSlug: this.state.event.slug,
      currentEventStatus: this.state.event.status,
      streamers: this.state.streamers,
    });
  }

  async refresh(): Promise<ActionResult> {
    this.initialize();
    this.advanceMinionEngine();
    this.notify();
    return { ok: true, message: "Lokaler State aktualisiert." };
  }

  async signIn(): Promise<ActionResult> {
    this.adminSession = { ...this.adminSession, authenticated: true, error: null };
    this.notifyAdmin();
    return { ok: true, message: "Mock-Admin ist aktiv." };
  }

  async signOut(): Promise<ActionResult> {
    return { ok: true, message: "Der Mockmodus bleibt lokal autorisiert." };
  }

  async adminApplyDamage(amount: number, options: AdminActionOptions = {}): Promise<ActionResult> {
    const normalized = Math.max(0, Math.round(amount));
    if (!normalized) return { ok: false, message: "Der Schadenswert muss größer als 0 sein." };
    const permission = canApplyDamage(this.state.settings, options.force);
    if (!permission.allowed) return { ok: false, message: permission.reason ?? "Schaden abgelehnt." };

    let applied = 0;
    this.commit((draft) => {
      const before = draft.boss.currentHp;
      const configuredDamage = computeConfiguredDamage(normalized, draft.settings);
      applied = Math.min(configuredDamage, before);
      draft.boss.currentHp = before - applied;
      draft.stats.globalDamage += applied;
      draft.milestones = markCrossedMilestones(
        draft.milestones,
        before,
        draft.boss.currentHp,
        draft.boss.maxHp,
        new Date().toISOString(),
      );
      addLog(draft, {
        type: "damage",
        actor: this.adminSession.email,
        message: `${draft.boss.name} erleidet ${formatNumber(applied)} Schaden (Admin)`,
      });
      if (draft.boss.currentHp <= 0) {
        for (const minion of draft.minions) {
          if (isOpenMinionStatus(minion.status)) {
            minion.status = "cancelled";
            minion.resolvedAt = Date.now();
            minion.displayUntil = Date.now() + RESOLUTION_DISPLAY_MS;
          }
        }
      }
    });
    return { ok: true, message: `${formatNumber(applied)} Schaden angewandt.` };
  }

  async adminSetBossHp(hp: number): Promise<ActionResult> {
    if (!Number.isFinite(hp) || hp < 0 || hp > this.state.boss.maxHp) {
      return { ok: false, message: `HP müssen zwischen 0 und ${formatNumber(this.state.boss.maxHp)} liegen.` };
    }
    this.commit((draft) => {
      const before = draft.boss.currentHp;
      const after = clampBossHp(hp, draft.boss.maxHp);
      draft.boss.currentHp = after;
      draft.milestones = markCrossedMilestones(
        draft.milestones,
        before,
        after,
        draft.boss.maxHp,
        new Date().toISOString(),
      );
      addLog(draft, {
        type: "admin",
        actor: this.adminSession.email,
        message: `Boss-HP manuell auf ${formatNumber(after)} gesetzt`,
      });
      if (after <= 0) {
        for (const minion of draft.minions) {
          if (isOpenMinionStatus(minion.status)) {
            minion.status = "cancelled";
            minion.resolvedAt = Date.now();
            minion.displayUntil = Date.now() + RESOLUTION_DISPLAY_MS;
          }
        }
      }
    });
    return { ok: true, message: "Boss-HP aktualisiert." };
  }

  async adminResetBoss(): Promise<ActionResult> {
    this.commit((draft) => {
      draft.boss.currentHp = draft.boss.maxHp;
      draft.stats.globalDamage = 0;
      draft.stats.minionsDefeated = 0;
      draft.stats.minionsEscaped = 0;
      draft.stats.uniqueParticipants = 0;
      draft.streamers = draft.streamers.map((streamer) => ({ ...streamer, damage: 0, minionsDefeated: 0 }));
      draft.minions = draft.minions.map((minion) =>
        isOpenMinionStatus(minion.status)
          ? { ...minion, status: "cancelled", resolvedAt: Date.now(), displayUntil: Date.now() + RESOLUTION_DISPLAY_MS }
          : minion,
      );
      draft.milestones = draft.milestones.map((milestone) => ({ ...milestone, reachedAt: null }));
      addLog(draft, { type: "admin", actor: this.adminSession.email, message: "Boss und Meilensteine zurückgesetzt" });
    });
    return { ok: true, message: "Boss vollständig zurückgesetzt." };
  }

  async adminUpdateSettings(patch: Partial<EventSettingsState>): Promise<ActionResult> {
    const multipliers = [
      patch.globalDamageMultiplier,
      patch.passiveDamageMultiplier,
      patch.activeDamageMultiplier,
    ].filter((value): value is number => value !== undefined);
    if (multipliers.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
      return { ok: false, message: "Multiplikatoren müssen zwischen 0 und 100 liegen." };
    }
    this.commit((draft) => {
      draft.settings = { ...draft.settings, ...patch };
      if (patch.eventPaused === true || patch.minionsEnabled === false) {
        const now = Date.now();
        for (const minion of draft.minions) {
          if (isOpenMinionStatus(minion.status)) {
            minion.status = "cancelled";
            minion.resolvedAt = now;
            minion.displayUntil = now + RESOLUTION_DISPLAY_MS;
          }
        }
      }
      addLog(draft, { type: "admin", actor: this.adminSession.email, message: "Event-Einstellungen aktualisiert" });
    });
    return { ok: true, message: "Event-Einstellungen gespeichert." };
  }

  async adminSetEventStatus(status: Extract<EventStatus, "draft" | "testing" | "active">): Promise<ActionResult> {
    this.commit((draft) => {
      draft.event.status = status;
      draft.event.isTest = status !== "active";
      if (status === "active") draft.settings.eventPaused = false;
      addLog(draft, { type: "admin", actor: this.adminSession.email, message: `Eventstatus auf ${status} gesetzt` });
    });
    return { ok: true, message: status === "active" ? "Event zentral aktiviert." : `Eventstatus: ${status}.` };
  }

  async adminSpawnMinion(
    typeId: string,
    streamerId: string,
    options: AdminActionOptions = {},
  ): Promise<ActionResult> {
    const type = MINION_TYPES[typeId as keyof typeof MINION_TYPES];
    const streamer = this.state.streamers.find((item) => item.id === streamerId && item.enabled);
    if (!type || !streamer) return { ok: false, message: "Minion oder Streamer ist ungültig." };
    if (!options.force && this.state.settings.eventPaused) return { ok: false, message: "Das Event ist pausiert." };
    if (!options.force && !this.state.settings.minionsEnabled) return { ok: false, message: "Minions sind deaktiviert." };
    if (!options.force && !streamer.live) return { ok: false, message: `${streamer.displayName} ist derzeit offline.` };
    if (this.state.boss.currentHp <= 0) return { ok: false, message: "Der Boss ist bereits besiegt." };
    const duplicate = this.state.minions.some(
      (minion) => minion.streamerId === streamerId && isOpenMinionStatus(minion.status),
    );
    if (duplicate) return { ok: false, message: `Bei ${streamer.displayName} läuft bereits ein Minion.` };

    const now = Date.now();
    this.commit((draft) => {
      draft.minions.unshift(createMinionInstance({
        typeId: type.id,
        instanceId: createId(type.id),
        streamer,
        viewerSamples: streamer.latestSession
          ? [streamer.latestSession.averageViewers, streamer.latestSession.latestViewers, streamer.currentViewerCount]
          : [streamer.currentViewerCount],
        phase: draft.boss.phase,
        now,
        triggerSource: "admin",
      }));
      addLog(draft, { type: "minion", actor: this.adminSession.email, message: `${type.name} bei ${streamer.displayName} gespawnt` });
    });
    return { ok: true, message: `${type.name} für ${streamer.displayName} gespawnt.` };
  }

  async adminResolveMinion(
    instanceId: string,
    resolution: "success" | "failed" | "cancelled" | "expired",
  ): Promise<ActionResult> {
    const current = this.state.minions.find((minion) => minion.instanceId === instanceId);
    if (!current) return { ok: false, message: "Minion nicht gefunden." };
    if (!["scheduled", "intro", "active"].includes(current.status)) return { ok: false, message: `Minion wurde bereits als ${current.status} aufgelöst.` };

    let awarded = 0;
    this.commit((draft) => {
      const minion = draft.minions.find((item) => item.instanceId === instanceId);
      if (!minion || !["scheduled", "intro", "active"].includes(minion.status)) return;
      const now = Date.now();
      awarded = this.resolveMinionDraft(draft, minion, resolution === "failed" ? "failure" : resolution, now, this.adminSession.email ?? "admin");
    });
    return {
      ok: true,
      message: resolution === "success" ? `Erfolg: ${formatNumber(awarded)} Schaden.` : `Minion als ${resolution} aufgelöst.`,
    };
  }

  async submitMinionAction(input: MinionActionInput): Promise<ActionResult> {
    this.advanceMinionEngine();
    if (input.eventId !== this.state.event.id || this.state.settings.eventPaused || !this.state.settings.minionsEnabled) {
      return { ok: false, message: "Event oder Minion-Engine ist nicht aktiv." };
    }
    const streamer = this.state.streamers.find((item) => item.id === input.streamerId && item.enabled);
    const minion = this.state.minions.find((item) => item.instanceId === input.minionEventId && item.streamerId === input.streamerId);
    if (!streamer || !minion || minion.status !== "active") return { ok: false, message: "Kein aktives Minion für diesen Streamer." };
    const now = Date.now();
    if (now < minion.acceptsAnswersAt || now >= minion.expiresAt) return { ok: false, message: "Das Antwortfenster ist nicht geöffnet." };
    const definition = MINION_TYPES[minion.typeId as keyof typeof MINION_TYPES];
    const parsed = parseBossCommand(input.text);
    if (!definition || !parsed.matched || !validateMinionAnswer(definition, parsed.answer, minion.runtimeConfig)) {
      return { ok: false, message: "Ungültige Eingabe; eine korrigierte Nachricht darf erneut gesendet werden." };
    }
    const key = input.participantId.trim();
    if (!key || key.length > 128 || input.text.length > 80) return { ok: false, message: "Chataktion abgelehnt." };
    const participants = this.participants.get(minion.instanceId) ?? new Map<string, string | null>();
    if (participants.has(key)) {
      this.commit((draft) => addLog(draft, { type: "minion", actor: "minion-engine", message: `${minion.name}: doppelte Teilnahme ignoriert` }));
      return { ok: true, message: "Teilnahme wurde bereits gezählt.", data: { accepted: false, duplicate: true } };
    }
    participants.set(key, parsed.answer);
    this.participants.set(minion.instanceId, participants);
    let success = false;
    this.commit((draft) => {
      const target = draft.minions.find((item) => item.instanceId === minion.instanceId);
      if (!target || target.status !== "active") return;
      target.participantCount = participants.size;
      addLog(draft, { type: "minion", actor: "minion-engine", message: `${target.name}: Teilnahme akzeptiert (${target.participantCount}/${target.requiredParticipants})` });
      if (target.gameMode === "PARTICIPATION" && target.participantCount >= target.requiredParticipants) {
        success = true;
        this.resolveMinionDraft(draft, target, "success", now, "minion-engine");
      }
    });
    return { ok: true, message: success ? "Minion erfolgreich besiegt." : "Teilnahme gezählt.", data: { accepted: true, success } };
  }

  async adminUpsertStreamer(input: StreamerInput, streamerId?: string): Promise<ActionResult> {
    const twitchLogin = normalizeTwitchLogin(input.twitchLogin);
    if (!input.displayName.trim() || !twitchLogin) {
      return { ok: false, message: "Display Name und Twitch Login sind erforderlich." };
    }
    const duplicate = this.state.streamers.find(
      (streamer) => streamer.id !== streamerId && normalizeTwitchLogin(streamer.twitchLogin) === twitchLogin,
    );
    if (duplicate) return { ok: false, message: "Dieser Twitch Login ist im Event bereits vergeben." };
    this.commit((draft) => {
      const existing = streamerId ? draft.streamers.find((streamer) => streamer.id === streamerId) : null;
      if (existing) {
        Object.assign(existing, {
          ...input,
          displayName: input.displayName.trim(),
          communityName: input.communityName.trim() || `${input.displayName.trim()} Community`,
          twitchLogin,
          twitchUrl: input.twitchUrl.trim() || `https://twitch.tv/${twitchLogin}`,
          slug: input.slug ? toSlug(input.slug) : existing.slug,
          avatarUrl: input.avatarUrl || null,
        });
      } else {
        draft.streamers.push({
          id: createId("streamer"),
          slug: toSlug(input.slug || input.displayName),
          displayName: input.displayName.trim(),
          communityName: input.communityName.trim() || `${input.displayName.trim()} Community`,
          twitchLogin,
          twitchUserId: null,
          twitchUrl: input.twitchUrl.trim() || `https://twitch.tv/${twitchLogin}`,
          avatarUrl: input.avatarUrl || null,
          enabled: input.enabled,
          damage: 0,
          minionsDefeated: 0,
          live: false,
          liveSince: null,
          currentStreamId: null,
          currentViewerCount: 0,
          lastTwitchSyncAt: null,
          lastSeenLiveAt: null,
          latestSession: null,
          sortOrder: draft.streamers.length + 1,
        });
      }
      addLog(draft, { type: "admin", actor: this.adminSession.email, message: `Streamer ${existing ? "bearbeitet" : "angelegt"}: ${input.displayName}` });
    });
    return { ok: true, message: "Streamer gespeichert." };
  }

  async adminSetStreamerEnabled(streamerId: string, enabled: boolean): Promise<ActionResult> {
    const streamer = this.state.streamers.find((item) => item.id === streamerId);
    if (!streamer) return { ok: false, message: "Streamer nicht gefunden." };
    this.commit((draft) => {
      const item = draft.streamers.find((entry) => entry.id === streamerId);
      if (item) item.enabled = enabled;
      if (!enabled) {
        const now = Date.now();
        for (const minion of draft.minions) {
          if (minion.streamerId === streamerId && isOpenMinionStatus(minion.status)) {
            minion.status = "cancelled";
            minion.resolvedAt = now;
            minion.displayUntil = now + RESOLUTION_DISPLAY_MS;
          }
        }
      }
      addLog(draft, { type: "admin", actor: this.adminSession.email, message: `${streamer.displayName} ${enabled ? "aktiviert" : "deaktiviert"}` });
    });
    return { ok: true, message: `${streamer.displayName} ${enabled ? "aktiviert" : "deaktiviert"}.` };
  }

  async adminResolveTwitchIds(streamerId?: string): Promise<ActionResult> {
    const targets = this.state.streamers.filter((streamer) => !streamerId || streamer.id === streamerId);
    if (!targets.length) return { ok: false, message: "Streamer nicht gefunden." };
    this.commit((draft) => {
      for (const target of targets) {
        const streamer = draft.streamers.find((item) => item.id === target.id);
        if (!streamer?.twitchLogin) continue;
        streamer.twitchUserId = `mock-${streamer.twitchLogin}`;
        addLog(draft, { type: "twitch", actor: "mock-twitch", message: `Twitch-ID für ${streamer.displayName} aufgelöst` });
      }
    });
    return { ok: true, message: `${targets.length} Twitch-ID(s) im Mockbetrieb aufgelöst.` };
  }

  async adminSyncTwitchStreams(streamerId?: string): Promise<ActionResult> {
    const now = new Date().toISOString();
    const targets = this.state.streamers.filter(
      (streamer) => streamer.enabled && streamer.twitchUserId && (!streamerId || streamer.id === streamerId),
    );
    if (!targets.length) return { ok: false, message: "Keine aktivierten Streamer mit Twitch-ID gefunden." };
    this.commit((draft) => {
      for (const target of targets) {
        const streamer = draft.streamers.find((item) => item.id === target.id);
        if (!streamer) continue;
        streamer.lastTwitchSyncAt = now;
        if (streamer.live) {
          streamer.lastSeenLiveAt = now;
          if (streamer.latestSession) {
            const nextCount = streamer.latestSession.sampleCount + 1;
            streamer.latestSession.averageViewers = Number(
              ((streamer.latestSession.averageViewers * streamer.latestSession.sampleCount + streamer.currentViewerCount) / nextCount).toFixed(2),
            );
            streamer.latestSession.peakViewers = Math.max(streamer.latestSession.peakViewers, streamer.currentViewerCount);
            streamer.latestSession.latestViewers = streamer.currentViewerCount;
            streamer.latestSession.sampleCount = nextCount;
          }
          addLog(draft, { type: "twitch", actor: "mock-twitch", message: `Viewer-Sample für ${streamer.displayName}: ${streamer.currentViewerCount}` });
        }
      }
      draft.twitch.health = {
        ...draft.twitch.health,
        status: "healthy",
        reason: "Mock-Twitch-Sync erfolgreich; kein Boss-Schaden ausgelöst.",
        lastSyncAt: now,
        lastSuccessAt: now,
        lastError: null,
      };
    });
    return { ok: true, message: `${targets.length} Stream(s) synchronisiert; Boss-HP unverändert.` };
  }

  async adminSyncEventSubSubscriptions(): Promise<ActionResult> {
    const now = new Date().toISOString();
    const resolved = this.state.streamers.filter((streamer) => streamer.enabled && streamer.twitchUserId).length;
    this.commit((draft) => {
      draft.twitch.subscriptions = { online: resolved, offline: resolved, raid: resolved * 2, pending: 0, revokedOrError: 0 };
      draft.twitch.health = {
        ...draft.twitch.health,
        status: "healthy",
        reason: "Mock-EventSub-Subscriptions synchronisiert.",
        webhookConfigured: true,
        lastSubscriptionSyncAt: now,
      };
      addLog(draft, { type: "twitch", actor: "mock-twitch", message: "EventSub-Subscriptions synchronisiert" });
    });
    return { ok: true, message: `${resolved * 4} Mock-Subscriptions synchronisiert.` };
  }

  async adminSimulateRaid(fromStreamerId: string, toStreamerId: string, viewerCount: number): Promise<ActionResult> {
    const from = this.state.streamers.find((streamer) => streamer.id === fromStreamerId && streamer.enabled);
    const to = this.state.streamers.find((streamer) => streamer.id === toStreamerId && streamer.enabled);
    if (!from?.twitchUserId || !to?.twitchUserId || from.id === to.id) {
      return { ok: false, message: "Raid benötigt zwei verschiedene, aktivierte Streamer mit Twitch-ID." };
    }
    const viewers = Math.max(0, Math.floor(viewerCount));
    const raidId = createId("raid");
    this.commit((draft) => {
      draft.twitch.recentRaids.unshift({
        id: raidId,
        fromStreamerId: from.id,
        toStreamerId: to.id,
        fromTwitchUserId: from.twitchUserId!,
        toTwitchUserId: to.twitchUserId!,
        viewerCount: viewers,
        occurredAt: new Date().toISOString(),
        eligible: true,
        source: "manual_test",
      });
      draft.twitch.recentRaids = draft.twitch.recentRaids.slice(0, 10);
      const scheduledFor = Date.now() + calculateRaidSpecialDelaySeconds() * 1_000;
      draft.minions.unshift(createMinionInstance({
        typeId: "kings_herald",
        instanceId: createId("kings-herald"),
        streamer: to,
        viewerSamples: [to.currentViewerCount, Math.max(to.currentViewerCount, viewers)],
        phase: draft.boss.phase,
        now: Date.now(),
        scheduledFor,
        triggerSource: "raid",
        triggerReference: raidId,
      }));
      addLog(draft, { type: "twitch", actor: this.adminSession.email, message: `Test-Raid ${from.displayName} → ${to.displayName} (${viewers}) gespeichert – ohne Bonus` });
    });
    return { ok: true, message: "Test-Raid gespeichert; Herold in 90–120 Sekunden geplant. Kein direkter Raid-Schaden." };
  }

  async observeExpiredMinion(instanceId: string) {
    const minion = this.state.minions.find((item) => item.instanceId === instanceId);
    if (!minion || minion.status !== "active" || minion.expiresAt > Date.now()) return;
    this.advanceMinionEngine();
  }
}
