import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

export interface PublicEventClientOptions {
  supabaseUrl: string;
  publishableKey: string;
  eventSlug: string;
  refreshIntervalMs?: number;
}

export interface PublicEventSnapshot {
  version: number;
  updated_at: string;
  event: Record<string, unknown>;
  boss: Record<string, unknown>;
  phases?: Array<Record<string, unknown>>;
  settings: Record<string, unknown>;
  stats: Record<string, unknown>;
  streamers: Array<Record<string, unknown>>;
  minions: Array<Record<string, unknown>>;
  milestones: Array<Record<string, unknown>>;
}

function validSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export class PublicEventClient {
  private readonly supabase: SupabaseClient;
  private readonly eventSlug: string;
  private readonly refreshIntervalMs: number;
  private channel: RealtimeChannel | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(snapshot: PublicEventSnapshot | null) => void>();
  private snapshot: PublicEventSnapshot | null = null;

  constructor(options: PublicEventClientOptions) {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(options.supabaseUrl)) throw new Error("Invalid Supabase URL.");
    if (!options.publishableKey || /service.?role|sb_secret_/i.test(options.publishableKey)) throw new Error("A browser-safe Supabase publishable key is required.");
    if (!validSlug(options.eventSlug)) throw new Error("Invalid event slug.");
    this.supabase = createClient(options.supabaseUrl, options.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    this.eventSlug = options.eventSlug;
    this.refreshIntervalMs = Math.max(5_000, options.refreshIntervalMs ?? 30_000);
  }

  getSnapshot() {
    return this.snapshot;
  }

  async load() {
    const { data, error } = await this.supabase.rpc("get_public_event_state", { p_event_slug: this.eventSlug });
    if (error) throw error;
    this.snapshot = data as PublicEventSnapshot | null;
    for (const listener of this.listeners) listener(this.snapshot);
    return this.snapshot;
  }

  subscribe(listener: (snapshot: PublicEventSnapshot | null) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    if (!this.channel) this.connect();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.disconnect();
    };
  }

  private connect() {
    const refresh = () => void this.load().catch(() => undefined);
    this.channel = this.supabase.channel(`public-event:${this.eventSlug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "bosses" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "streamer_runtime" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "minion_events" }, refresh)
      .subscribe();
    this.refreshTimer = setInterval(refresh, this.refreshIntervalMs);
  }

  disconnect() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (this.channel) void this.supabase.removeChannel(this.channel);
    this.channel = null;
  }
}

export function createPublicEventClient(options: PublicEventClientOptions) {
  return new PublicEventClient(options);
}

export async function loadPublicEventForAstro(options: PublicEventClientOptions) {
  const client = createPublicEventClient(options);
  try {
    return await client.load();
  } finally {
    client.disconnect();
  }
}
