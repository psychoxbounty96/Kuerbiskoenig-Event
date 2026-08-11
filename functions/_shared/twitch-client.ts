export interface TwitchClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  viewer_count: number;
  started_at: string;
  type: string;
}

export interface TwitchEventSubSubscription {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: Record<string, string>;
  transport: { method: string; callback?: string };
  created_at: string;
}

type FetchLike = typeof fetch;

export class TwitchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "TwitchApiError";
  }
}

function chunks<T>(items: T[], size = 100) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function cleanUnique(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export class TwitchClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: TwitchClientConfig,
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private ensureCredentials() {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new TwitchApiError("Twitch-Credentials fehlen.", 503, "credentials_missing");
    }
  }

  private async getAppAccessToken(force = false) {
    this.ensureCredentials();
    if (!force && this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "client_credentials",
    });
    const response = await this.fetcher("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof payload.access_token !== "string") {
      throw new TwitchApiError("Twitch App Access Token konnte nicht bezogen werden.", response.status, "token_request_failed");
    }
    const expiresIn = Math.max(60, Number(payload.expires_in) || 0);
    this.token = { value: payload.access_token, expiresAt: this.now() + expiresIn * 1_000 };
    return this.token.value;
  }

  private async helix<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await this.getAppAccessToken();
    const response = await this.fetcher(`https://api.twitch.tv/helix${path}`, {
      ...init,
      headers: {
        "Client-Id": this.config.clientId,
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 401 && retry) {
      this.token = null;
      await this.getAppAccessToken(true);
      return this.helix<T>(path, init, false);
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const detail = typeof payload.message === "string" ? payload.message : "Twitch API nicht erreichbar.";
      throw new TwitchApiError(detail, response.status, "helix_request_failed");
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async resolveUsersByLogin(logins: string[]) {
    const users: TwitchUser[] = [];
    for (const batch of chunks(cleanUnique(logins))) {
      const query = new URLSearchParams();
      batch.forEach((login) => query.append("login", login));
      const payload = await this.helix<{ data: TwitchUser[] }>(`/users?${query}`);
      users.push(...payload.data);
    }
    return users;
  }

  async getStreamsByUserIds(userIds: string[]) {
    const streams: TwitchStream[] = [];
    for (const batch of chunks([...new Set(userIds.map((value) => value.trim()).filter(Boolean))])) {
      const query = new URLSearchParams({ first: "100" });
      batch.forEach((id) => query.append("user_id", id));
      const payload = await this.helix<{ data: TwitchStream[] }>(`/streams?${query}`);
      streams.push(...payload.data);
    }
    return streams;
  }

  async listEventSubSubscriptions() {
    const subscriptions: TwitchEventSubSubscription[] = [];
    let cursor = "";
    do {
      const query = new URLSearchParams({ first: "100" });
      if (cursor) query.set("after", cursor);
      const payload = await this.helix<{
        data: TwitchEventSubSubscription[];
        pagination?: { cursor?: string };
      }>(`/eventsub/subscriptions?${query}`);
      subscriptions.push(...payload.data);
      cursor = payload.pagination?.cursor ?? "";
    } while (cursor);
    return subscriptions;
  }

  async createEventSubSubscription(input: {
    type: "stream.online" | "stream.offline" | "channel.raid";
    condition: Record<string, string>;
    callback: string;
    secret: string;
  }) {
    return this.helix<{ data: TwitchEventSubSubscription[] }>("/eventsub/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        type: input.type,
        version: "1",
        condition: input.condition,
        transport: { method: "webhook", callback: input.callback, secret: input.secret },
      }),
    });
  }

  async deleteEventSubSubscription(id: string) {
    const query = new URLSearchParams({ id });
    await this.helix<void>(`/eventsub/subscriptions?${query}`, { method: "DELETE" });
  }
}
