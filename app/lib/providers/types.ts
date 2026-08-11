import type {
  ActionResult,
  AdminSession,
  EventSettingsState,
  EventState,
  EventStatus,
  OverlayIdentityResolution,
  MinionActionInput,
  ProviderMode,
  ProviderSnapshot,
  StreamerInput,
} from "../types";

export type StateListener = (snapshot: ProviderSnapshot) => void;
export type AdminListener = (session: AdminSession) => void;

export interface AdminActionOptions {
  force?: boolean;
  reason?: string;
}

export interface DataProvider {
  readonly mode: ProviderMode;
  subscribe(listener: StateListener): () => void;
  subscribeAdmin(listener: AdminListener): () => void;
  getSnapshot(): ProviderSnapshot;
  getAdminSession(): AdminSession;
  getEventState(): EventState;
  getBossState(): EventState["boss"];
  getStreamerStats(): EventState["streamers"];
  resolveCurrentStreamer(channelUsername: string, eventSlug?: string): Promise<OverlayIdentityResolution>;
  refresh(): Promise<ActionResult>;
  signIn(email: string, password: string): Promise<ActionResult>;
  signOut(): Promise<ActionResult>;
  adminApplyDamage(amount: number, options?: AdminActionOptions): Promise<ActionResult>;
  adminSetBossHp(hp: number, options?: AdminActionOptions): Promise<ActionResult>;
  adminResetBoss(): Promise<ActionResult>;
  adminUpdateSettings(patch: Partial<EventSettingsState>): Promise<ActionResult>;
  adminSetEventStatus(status: Extract<EventStatus, "draft" | "testing" | "active">): Promise<ActionResult>;
  adminSpawnMinion(typeId: string, streamerId: string, options?: AdminActionOptions): Promise<ActionResult>;
  adminResolveMinion(instanceId: string, resolution: "success" | "failed" | "cancelled" | "expired"): Promise<ActionResult>;
  submitMinionAction(input: MinionActionInput): Promise<ActionResult>;
  adminUpsertStreamer(input: StreamerInput, streamerId?: string): Promise<ActionResult>;
  adminSetStreamerEnabled(streamerId: string, enabled: boolean): Promise<ActionResult>;
  adminResolveTwitchIds(streamerId?: string): Promise<ActionResult>;
  adminSyncTwitchStreams(streamerId?: string): Promise<ActionResult>;
  adminSyncEventSubSubscriptions(): Promise<ActionResult>;
  adminSimulateRaid(fromStreamerId: string, toStreamerId: string, viewerCount: number): Promise<ActionResult>;
  observeExpiredMinion(instanceId: string): Promise<void>;
}
