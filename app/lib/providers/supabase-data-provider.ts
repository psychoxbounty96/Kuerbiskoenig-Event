import {
  createClient,
  FunctionsHttpError,
  type RealtimeChannel,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { calculateBossPhase, EVENT_SLUG, MINION_TYPES, REFRESH_INTERVAL_MS, RESOLUTION_DISPLAY_MS } from "../config";
import { INITIAL_EVENT_STATE } from "../mock-state";
import { normalizeTwitchLogin } from "../streamelements-adapter";
import type {
  ActionResult,
  AdminRole,
  AdminSession,
  EventSettingsState,
  EventState,
  EventStatus,
  MinionActionInput,
  OverlayIdentityResolution,
  ProviderSnapshot,
  StreamerInput,
} from "../types";
import type { AdminActionOptions, AdminListener, DataProvider, StateListener } from "./types";

type JsonRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function toMillis(value: unknown, fallback = 0) {
  const parsed = Date.parse(asString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapIdentityResolution(value: unknown, channelUsername: string, eventSlug: string): OverlayIdentityResolution {
  const payload = asRecord(value);
  const statuses = new Set(["resolved", "not_registered", "disabled", "event_unavailable", "error"]);
  const status = asString(payload.status);
  const eventStatus = asString(payload.event_status) as EventStatus;
  return {
    status: statuses.has(status) ? status as OverlayIdentityResolution["status"] : "error",
    channelUsername: normalizeTwitchLogin(payload.channel_username ?? channelUsername) || null,
    eventId: asString(payload.event_id) || null,
    eventSlug: asString(payload.event_slug, eventSlug) || null,
    eventStatus: ["draft", "testing", "active", "paused", "finished", "archived"].includes(eventStatus) ? eventStatus : null,
    streamerId: asString(payload.streamer_id) || null,
    streamerSlug: asString(payload.streamer_slug) || null,
    streamerDisplayName: asString(payload.streamer_display_name) || null,
    isTestAccount: asBoolean(payload.is_test_account),
    testActionsAuthorized: asBoolean(payload.test_actions_authorized),
  };
}

function mapPublicSnapshot(payloadValue: unknown): EventState {
  const payload = asRecord(payloadValue);
  const event = asRecord(payload.event);
  const boss = asRecord(payload.boss);
  const settings = asRecord(payload.settings);
  const stats = asRecord(payload.stats);
  const currentHp = asNumber(boss.current_hp, INITIAL_EVENT_STATE.boss.currentHp);
  const maxHp = asNumber(boss.max_hp, INITIAL_EVENT_STATE.boss.maxHp);
  const derivedPhase = calculateBossPhase(currentHp, maxHp);
  const serverPhase = asRecord(boss.phase);
  const eventStatus = asString(event.status, "testing") as EventState["event"]["status"];
  const twitch = asRecord(payload.twitch);
  const health = asRecord(twitch.health);
  const subscriptions = asRecord(twitch.subscriptions);
  const healthLastSuccess = asString(health.last_success_at) || null;
  const rawHealthStatus = asString(health.status, "warning") as EventState["twitch"]["health"]["status"];
  const syncIsStale = rawHealthStatus === "healthy" && (!healthLastSuccess || Date.now() - toMillis(healthLastSuccess) > 5 * 60_000);

  const streamers = asArray(payload.streamers).map((streamer, index) => {
    const session = asRecord(streamer.session);
    const hasSession = Boolean(asString(session.id));
    return {
    id: asString(streamer.id),
    slug: asString(streamer.slug),
    displayName: asString(streamer.display_name),
    communityName: asString(streamer.community_name),
    twitchLogin: asString(streamer.twitch_login),
    twitchUserId: asString(streamer.twitch_user_id) || null,
    twitchUrl: asString(streamer.twitch_url),
    avatarUrl: asString(streamer.avatar_url) || null,
    enabled: asBoolean(streamer.enabled, true),
    isTestAccount: asBoolean(streamer.is_test_account),
    damage: asNumber(streamer.damage),
    minionsDefeated: asNumber(streamer.minions_defeated),
    live: asBoolean(streamer.is_live),
    liveSince: asString(streamer.live_since) || null,
    currentStreamId: asString(streamer.current_stream_id) || null,
    currentViewerCount: Math.max(0, asNumber(streamer.current_viewer_count)),
    lastTwitchSyncAt: asString(streamer.last_twitch_sync_at) || null,
    lastSeenLiveAt: asString(streamer.last_seen_live_at) || null,
    latestSession: hasSession ? {
      id: asString(session.id),
      streamId: asString(session.stream_id),
      startedAt: asString(session.started_at),
      endedAt: asString(session.ended_at) || null,
      status: asString(session.status, "ended") as "live" | "ended",
      averageViewers: Math.max(0, asNumber(session.average_viewers)),
      peakViewers: Math.max(0, asNumber(session.peak_viewers)),
      latestViewers: Math.max(0, asNumber(session.latest_viewers)),
      sampleCount: Math.max(0, asNumber(session.sample_count)),
      durationSeconds: Math.max(0, asNumber(session.duration_seconds)),
    } : null,
    sortOrder: asNumber(streamer.sort_order, index + 1),
    };
  });

  const minions = asArray(payload.minions).map((minion) => {
    const resolvedAt = toMillis(minion.resolved_at);
    const expiresAt = toMillis(minion.expires_at);
    const rawStatus = asString(minion.status, "active") === "failed" ? "failure" : asString(minion.status, "active");
    const definition = MINION_TYPES[asString(minion.key, "ghost") as keyof typeof MINION_TYPES] ?? MINION_TYPES.ghost;
    return {
      instanceId: asString(minion.id),
      definitionId: asString(minion.definition_id),
      typeId: asString(minion.key, "ghost"),
      name: asString(minion.name, definition.name),
      icon: asString(minion.icon, definition.icon),
      command: asString(minion.command, "!boss"),
      gameMode: asString(minion.game_mode, definition.gameMode) as EventState["minions"][number]["gameMode"],
      damageClass: asString(minion.damage_class, definition.damageClass) as EventState["minions"][number]["damageClass"],
      failureCurseKey: asString(minion.failure_curse_key) || null,
      introTitle: asString(minion.intro_title, definition.introTitle),
      gameplayTitle: asString(minion.gameplay_title, definition.gameplayTitle),
      instruction: asString(minion.instruction, definition.instruction),
      streamerId: asString(minion.streamer_id),
      streamerSlug: asString(minion.streamer_slug),
      streamerName: asString(minion.streamer_name),
      status: rawStatus as EventState["minions"][number]["status"],
      viewerEstimate: Math.max(0, asNumber(minion.viewer_estimate)),
      requiredParticipants: Math.max(1, asNumber(minion.required_participants, 1)),
      participantCount: Math.max(0, asNumber(minion.participant_count)),
      durationSeconds: Math.max(1, asNumber(minion.duration_seconds, definition.duration)),
      runtimeConfig: asRecord(minion.runtime_config),
      spawnedAt: toMillis(minion.spawned_at),
      introEndsAt: toMillis(minion.intro_ends_at, toMillis(minion.spawned_at)),
      gameplayStartsAt: toMillis(minion.gameplay_starts_at, toMillis(minion.spawned_at)),
      acceptsAnswersAt: toMillis(minion.accepts_answers_at, toMillis(minion.gameplay_starts_at, toMillis(minion.spawned_at))),
      expiresAt,
      resolvedAt: resolvedAt || undefined,
      resultEndsAt: toMillis(minion.result_ends_at) || undefined,
      curseEndsAt: toMillis(minion.curse_ends_at) || undefined,
      completedAt: toMillis(minion.completed_at) || undefined,
      damageAwarded: Math.max(0, asNumber(minion.damage_awarded)),
      triggerSource: asString(minion.trigger_source, "admin") as EventState["minions"][number]["triggerSource"],
      triggerReference: asString(minion.trigger_reference) || null,
      displayUntil: toMillis(minion.display_until) || (resolvedAt ? resolvedAt + RESOLUTION_DISPLAY_MS : undefined),
    };
  });

  return {
    version: asNumber(payload.version, 4),
    updatedAt: asString(payload.updated_at, new Date().toISOString()),
    event: {
      id: asString(event.id),
      slug: asString(event.slug, EVENT_SLUG),
      name: asString(event.name, INITIAL_EVENT_STATE.event.name),
      description: asString(event.description),
      status: eventStatus,
      active: eventStatus === "active" && !asBoolean(settings.event_paused),
      isTest: eventStatus === "draft" || eventStatus === "testing" || asString(event.slug).endsWith("-test"),
    },
    boss: {
      id: asString(boss.id),
      name: asString(boss.name, "Kürbiskönig"),
      maxHp,
      currentHp,
      phase: asNumber(serverPhase.phase_number, derivedPhase.id) as EventState["boss"]["phase"],
      phaseName: asString(serverPhase.name, derivedPhase.name),
    },
    settings: {
      eventPaused: asBoolean(settings.event_paused),
      damageEnabled: asBoolean(settings.damage_enabled, true),
      minionsEnabled: asBoolean(settings.minions_enabled, true),
      globalDamageMultiplier: asNumber(settings.global_damage_multiplier, 1),
      passiveDamageMultiplier: asNumber(settings.passive_damage_multiplier, 1),
      activeDamageMultiplier: asNumber(settings.active_damage_multiplier, 1),
      passiveTickSeconds: asNumber(settings.passive_tick_seconds, 120),
    },
    stats: {
      globalDamage: asNumber(stats.total_damage),
      minionsDefeated: asNumber(stats.total_minions_defeated),
      minionsEscaped: asNumber(stats.total_minions_failed),
      communities: asNumber(stats.active_streamer_count, streamers.length),
      uniqueParticipants: asNumber(stats.unique_participants),
    },
    streamers,
    minions,
    milestones: asArray(payload.milestones).map((milestone, index) => ({
      id: asString(milestone.id),
      label: asString(milestone.name),
      percent: asNumber(milestone.hp_percent),
      description: asString(milestone.description),
      reachedAt: asString(milestone.reached_at) || null,
      sortOrder: asNumber(milestone.sort_order, index + 1),
    })),
    twitch: twitch.health ? {
      health: {
        status: syncIsStale ? "warning" : rawHealthStatus,
        reason: syncIsStale ? "Letzter erfolgreicher Twitch-Sync ist älter als fünf Minuten." : asString(health.reason, "Twitch-Integration noch nicht synchronisiert."),
        webhookConfigured: asBoolean(health.webhook_configured),
        lastSyncAt: asString(health.last_sync_at) || null,
        lastSuccessAt: healthLastSuccess,
        lastErrorAt: asString(health.last_error_at) || null,
        lastError: asString(health.last_error) || null,
        lastWebhookAt: asString(health.last_webhook_at) || null,
        lastInvalidSignatureAt: asString(health.last_invalid_signature_at) || null,
        lastSubscriptionSyncAt: asString(health.last_subscription_sync_at) || null,
      },
      subscriptions: {
        online: asNumber(subscriptions.online),
        offline: asNumber(subscriptions.offline),
        raid: asNumber(subscriptions.raid),
        pending: asNumber(subscriptions.pending),
        revokedOrError: asNumber(subscriptions.revoked_or_error),
      },
      recentRaids: asArray(twitch.recent_raids).map((raid) => ({
        id: asString(raid.id),
        fromStreamerId: asString(raid.from_streamer_id) || null,
        toStreamerId: asString(raid.to_streamer_id) || null,
        fromTwitchUserId: asString(raid.from_twitch_user_id),
        toTwitchUserId: asString(raid.to_twitch_user_id),
        viewerCount: Math.max(0, asNumber(raid.viewer_count)),
        occurredAt: asString(raid.occurred_at),
        eligible: asBoolean(raid.eligible),
        source: asString(raid.source, "twitch_eventsub") as "twitch_eventsub" | "manual_test",
      })),
      passiveDamagePreview: null,
    } : clone(INITIAL_EVENT_STATE.twitch),
    log: asArray(payload.log).map((entry) => ({
      id: asString(entry.id),
      timestamp: asString(entry.timestamp),
      type: asString(entry.type, "system") as EventState["log"][number]["type"],
      message: asString(entry.message),
      actor: null,
    })),
  };
}

export class SupabaseDataProvider implements DataProvider {
  readonly mode = "supabase" as const;
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<StateListener>();
  private adminListeners = new Set<AdminListener>();
  private initialized = false;
  private refreshTimer: number | null = null;
  private refreshDebounce: number | null = null;
  private state = clone(INITIAL_EVENT_STATE);
  private runtime: ProviderSnapshot["runtime"] = {
    mode: "supabase",
    status: "loading",
    realtime: "connecting",
    error: null,
    lastSyncedAt: null,
  };
  private adminSession: AdminSession = {
    authenticated: false,
    userId: null,
    email: null,
    role: null,
    loading: true,
    error: null,
  };

  private getConfiguration() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const publishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    return { url, publishableKey };
  }

  private ensureClient() {
    if (this.client) return this.client;
    const { url, publishableKey } = this.getConfiguration();
    if (!url || !publishableKey) {
      throw new Error("Supabase ist ausgewählt, aber URL oder öffentlicher Client-Key fehlt.");
    }
    this.client = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return this.client;
  }

  private async initialize() {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    try {
      const client = this.ensureClient();
      client.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => void this.syncAdminSession(session), 0);
      });
      const { data } = await client.auth.getSession();
      await this.syncAdminSession(data.session);
      await this.refresh();
      this.setupRealtime();
      this.refreshTimer = window.setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    } catch (error) {
      this.runtime.status = "error";
      this.runtime.realtime = "disconnected";
      this.runtime.error = error instanceof Error ? error.message : "Supabase konnte nicht initialisiert werden.";
      this.adminSession = { ...this.adminSession, loading: false, error: this.runtime.error };
      this.notify();
      this.notifyAdmin();
    }
  }

  private setupRealtime() {
    const client = this.ensureClient();
    const scheduleRefresh = () => {
      if (this.refreshDebounce) window.clearTimeout(this.refreshDebounce);
      this.refreshDebounce = window.setTimeout(() => void this.refresh(), 180);
    };

    this.channel = client.channel(`event-state:${EVENT_SLUG}`);
    for (const table of ["events", "bosses", "milestones", "minion_events", "streamers", "streamer_runtime"]) {
      this.channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh);
    }
    this.channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        this.runtime.realtime = "connected";
        if (this.runtime.status !== "error") this.runtime.status = "ready";
        this.runtime.error = null;
        void this.refresh();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.runtime.realtime = "disconnected";
        this.runtime.status = "degraded";
        this.runtime.error = "Realtime-Verbindung unterbrochen. Der 30-Sekunden-Refresh bleibt aktiv.";
      }
      this.notify();
    });
  }

  private notify() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private notifyAdmin() {
    const session = this.getAdminSession();
    this.adminListeners.forEach((listener) => listener(session));
  }

  private async syncAdminSession(session: Session | null) {
    if (!session) {
      this.adminSession = { authenticated: false, userId: null, email: null, role: null, loading: false, error: null };
      this.notifyAdmin();
      return;
    }

    this.adminSession = {
      authenticated: false,
      userId: session.user.id,
      email: session.user.email ?? null,
      role: null,
      loading: true,
      error: null,
    };
    this.notifyAdmin();
    const result = await this.executeAction<{ role: AdminRole }>("get_context", {}, true);
    this.adminSession = {
      ...this.adminSession,
      authenticated: result.ok,
      role: result.ok ? result.data?.role ?? null : null,
      loading: false,
      error: result.ok ? null : result.message,
    };
    this.notifyAdmin();
  }

  private async extractFunctionError(error: unknown) {
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: string; message?: string };
        return body.error || body.message || error.message;
      } catch {
        return error.message;
      }
    }
    return error instanceof Error ? error.message : "Serveraktion fehlgeschlagen.";
  }

  private async executeAction<T = unknown>(
    action: string,
    payload: JsonRecord,
    allowUnauthenticatedSession = false,
  ): Promise<ActionResult<T>> {
    try {
      const client = this.ensureClient();
      if (!allowUnauthenticatedSession && !this.adminSession.authenticated) {
        return { ok: false, message: "Nicht autorisiert. Bitte als Eventadmin anmelden." };
      }
      const { data, error } = await client.functions.invoke("admin-event-action", {
        body: { action, eventSlug: EVENT_SLUG, ...payload },
      });
      if (error) return { ok: false, message: await this.extractFunctionError(error) };
      if (data?.ok === false) return { ok: false, message: data.error || "Serveraktion abgelehnt." };
      return { ok: true, message: data?.message || "Aktion ausgeführt.", data: data?.data as T };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Serveraktion fehlgeschlagen." };
    }
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    void this.initialize();
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeAdmin(listener: AdminListener) {
    this.adminListeners.add(listener);
    listener(this.getAdminSession());
    void this.initialize();
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

  async resolveCurrentStreamer(channelUsername: string, eventSlug = EVENT_SLUG): Promise<OverlayIdentityResolution> {
    const normalized = normalizeTwitchLogin(channelUsername);
    if (!normalized) return mapIdentityResolution({ status: "error" }, "", eventSlug);
    try {
      const client = this.ensureClient();
      const { data, error } = await client.rpc("resolve_stream_elements_identity", {
        p_event_slug: eventSlug,
        p_twitch_login: normalized,
      });
      if (error) throw error;
      return mapIdentityResolution(data, normalized, eventSlug);
    } catch {
      return mapIdentityResolution({ status: "error" }, normalized, eventSlug);
    }
  }

  async refresh(): Promise<ActionResult> {
    try {
      const client = this.ensureClient();
      const { data, error } = await client.rpc("get_public_event_state", { p_event_slug: EVENT_SLUG });
      if (error) throw error;
      if (!data) throw new Error(`Event „${EVENT_SLUG}“ wurde nicht gefunden.`);
      this.state = mapPublicSnapshot(data);
      this.runtime.status = this.runtime.realtime === "disconnected" ? "degraded" : "ready";
      this.runtime.error = this.runtime.status === "degraded" ? this.runtime.error : null;
      this.runtime.lastSyncedAt = new Date().toISOString();
      this.notify();
      return { ok: true, message: "Supabase-State synchronisiert." };
    } catch (error) {
      this.runtime.status = this.runtime.lastSyncedAt ? "degraded" : "error";
      this.runtime.error = error instanceof Error ? error.message : "Supabase-State konnte nicht geladen werden.";
      this.notify();
      return { ok: false, message: this.runtime.error };
    }
  }

  async signIn(email: string, password: string): Promise<ActionResult> {
    try {
      const client = this.ensureClient();
      this.adminSession = { ...this.adminSession, loading: true, error: null };
      this.notifyAdmin();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await this.syncAdminSession(data.session);
      if (this.adminSession.authenticated) await this.refresh();
      return this.adminSession.authenticated
        ? { ok: true, message: "Als Eventadmin angemeldet." }
        : { ok: false, message: this.adminSession.error || "Dieses Konto ist kein Eventadmin." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.";
      this.adminSession = { ...this.adminSession, loading: false, error: message };
      this.notifyAdmin();
      return { ok: false, message };
    }
  }

  async signOut(): Promise<ActionResult> {
    try {
      const client = this.ensureClient();
      const { error } = await client.auth.signOut();
      if (error) throw error;
      this.adminSession = { authenticated: false, userId: null, email: null, role: null, loading: false, error: null };
      this.notifyAdmin();
      await this.refresh();
      return { ok: true, message: "Abgemeldet." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Abmeldung fehlgeschlagen." };
    }
  }

  async adminApplyDamage(amount: number, options: AdminActionOptions = {}) {
    const result = await this.executeAction("apply_damage", { amount, force: options.force ?? false, reason: options.reason ?? null, idempotencyKey: crypto.randomUUID() });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminSetBossHp(hp: number, options: AdminActionOptions = {}) {
    const result = await this.executeAction("set_boss_hp", { hp, reason: options.reason ?? null });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminResetBoss() {
    const result = await this.executeAction("reset_boss", {});
    if (result.ok) await this.refresh();
    return result;
  }

  async adminUpdateSettings(patch: Partial<EventSettingsState>) {
    const result = await this.executeAction("update_settings", { settings: patch });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminSetEventStatus(status: Extract<EventStatus, "draft" | "testing" | "active">) {
    const result = await this.executeAction("set_event_status", { status });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminSpawnMinion(typeId: string, streamerId: string, options: AdminActionOptions = {}) {
    const result = await this.executeAction("spawn_minion", { typeId, streamerId, force: options.force ?? false });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminResolveMinion(instanceId: string, resolution: "success" | "failed" | "cancelled" | "expired") {
    const result = await this.executeAction("resolve_minion", { instanceId, resolution });
    if (result.ok) await this.refresh();
    return result;
  }

  async submitMinionAction(input: MinionActionInput) {
    try {
      const client = this.ensureClient();
      const { data, error } = await client.functions.invoke("minion-action", {
        body: {
          eventId: input.eventId,
          streamerId: input.streamerId,
          minionEventId: input.minionEventId,
          participantId: input.participantId,
          messageId: input.messageId,
          text: input.text,
        },
      });
      if (error) return { ok: false, message: await this.extractFunctionError(error) };
      if (data?.ok === false) return { ok: false, message: data.error || "Chataktion abgelehnt." };
      window.setTimeout(() => void this.refresh(), 0);
      return { ok: true, message: data?.message || "Teilnahme gezählt.", data: data?.data };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Chataktion fehlgeschlagen." };
    }
  }

  async adminUpsertStreamer(input: StreamerInput, streamerId?: string) {
    const result = await this.executeAction("upsert_streamer", { streamerId: streamerId ?? null, streamer: input });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminSetStreamerEnabled(streamerId: string, enabled: boolean) {
    const result = await this.executeAction("set_streamer_enabled", { streamerId, enabled });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminResolveTwitchIds(streamerId?: string) {
    const result = await this.executeAction(streamerId ? "resolve_twitch_id" : "resolve_twitch_ids", {
      streamerId: streamerId ?? null,
    });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminSyncTwitchStreams(streamerId?: string) {
    const result = await this.executeAction("sync_twitch_streams", { streamerId: streamerId ?? null });
    if (result.ok) await this.refresh();
    return result;
  }

  async adminSyncEventSubSubscriptions() {
    const result = await this.executeAction("sync_eventsub_subscriptions", {});
    if (result.ok) await this.refresh();
    return result;
  }

  async adminSimulateRaid(fromStreamerId: string, toStreamerId: string, viewerCount: number) {
    const result = await this.executeAction("simulate_raid", { fromStreamerId, toStreamerId, viewerCount });
    if (result.ok) await this.refresh();
    return result;
  }

  async observeExpiredMinion() {
    // The public client only hides elapsed minions. Server RPCs reject late success.
  }
}
