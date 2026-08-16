export interface DiscordLiveAnnouncementInput {
  displayName: string;
  twitchLogin: string;
  twitchUrl?: string | null;
  avatarUrl?: string | null;
  streamTitle?: string | null;
  gameName?: string | null;
  thumbnailUrl?: string | null;
  viewerCount?: number | null;
  startedAt: string;
}

function cleanText(value: string | null | undefined, maxLength: number) {
  return [...String(value ?? "")]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function httpsUrl(value: string | null | undefined) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function isDiscordIncomingWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && ["discord.com", "www.discord.com", "discordapp.com", "www.discordapp.com"].includes(url.hostname)
      && /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function buildDiscordLiveAnnouncement(input: DiscordLiveAnnouncementInput) {
  const displayName = cleanText(input.displayName, 80) || cleanText(input.twitchLogin, 25) || "Ein Eventstreamer";
  const twitchLogin = cleanText(input.twitchLogin, 25).toLowerCase();
  const twitchUrl = httpsUrl(input.twitchUrl) || `https://www.twitch.tv/${encodeURIComponent(twitchLogin)}`;
  const streamTitle = cleanText(input.streamTitle, 240);
  const gameName = cleanText(input.gameName, 80);
  const avatarUrl = httpsUrl(input.avatarUrl);
  const rawThumbnail = httpsUrl(input.thumbnailUrl);
  const thumbnailUrl = rawThumbnail
    .replace(/(?:\{width\}|%7Bwidth%7D)/gi, "1280")
    .replace(/(?:\{height\}|%7Bheight%7D)/gi, "720");
  const viewerCount = Math.max(0, Math.floor(Number(input.viewerCount) || 0));
  const fields = [];
  if (gameName) fields.push({ name: "Kategorie", value: gameName, inline: true });
  if (viewerCount > 0) fields.push({ name: "Zuschauer", value: String(viewerCount), inline: true });

  return {
    username: "Kürbiskönig Event",
    allowed_mentions: { parse: [] as string[] },
    embeds: [{
      title: `🔴 ${displayName} ist jetzt live!`,
      url: twitchUrl,
      description: streamTitle || "Die Community stellt sich dem Kürbiskönig.",
      color: 0xf97316,
      ...(avatarUrl ? { thumbnail: { url: avatarUrl } } : {}),
      ...(thumbnailUrl ? { image: { url: thumbnailUrl } } : {}),
      ...(fields.length ? { fields } : {}),
      footer: { text: "Kürbiskönig Community Boss Event" },
      timestamp: new Date(input.startedAt).toISOString(),
    }],
  };
}
