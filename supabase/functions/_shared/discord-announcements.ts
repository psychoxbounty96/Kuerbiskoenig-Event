import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  buildDiscordLiveAnnouncement,
  isDiscordIncomingWebhookUrl,
  type DiscordLiveAnnouncementInput,
} from "./discord-domain.ts";

type ServiceClient = SupabaseClient;

function safeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message.slice(0, 500);
  }
  return "Discord-Ankündigung fehlgeschlagen.";
}

async function logAnnouncement(
  service: ServiceClient,
  eventId: string,
  streamerId: string,
  eventType: string,
  message: string,
  level: "info" | "warning" | "error" = "info",
) {
  const { error } = await service.from("twitch_system_log").insert({
    event_id: eventId,
    streamer_id: streamerId,
    event_type: eventType,
    level,
    message,
    metadata: { integration: "discord_webhook" },
  });
  if (error) console.error("Discord announcement log could not be stored", error.message);
}

export async function maybeSendDiscordLiveAnnouncement(
  service: ServiceClient,
  input: {
    eventId: string;
    streamerId: string;
    streamId: string;
    stream: Partial<DiscordLiveAnnouncementInput>;
  },
) {
  const enabled = (Deno.env.get("DISCORD_ANNOUNCEMENTS_ENABLED") ?? "").toLowerCase() === "true";
  const webhookUrl = Deno.env.get("DISCORD_ANNOUNCEMENT_WEBHOOK_URL") ?? "";
  const expectedGuildId = Deno.env.get("DISCORD_ANNOUNCEMENT_GUILD_ID") ?? "";
  const expectedChannelId = Deno.env.get("DISCORD_ANNOUNCEMENT_CHANNEL_ID") ?? "";
  if (!enabled || !webhookUrl || !expectedGuildId || !expectedChannelId) return { status: "disabled" as const };
  if (!isDiscordIncomingWebhookUrl(webhookUrl)) return { status: "invalid_configuration" as const };

  const { data: streamer, error: streamerError } = await service.from("streamers")
    .select("display_name,twitch_login,twitch_url,avatar_url")
    .eq("event_id", input.eventId)
    .eq("id", input.streamerId)
    .maybeSingle();
  if (streamerError) {
    console.error("Discord streamer lookup failed", streamerError.message);
    return { status: "failed" as const };
  }
  if (!streamer) return { status: "ineligible" as const };

  const { data: claim, error: claimError } = await service.rpc("claim_discord_stream_announcement", {
    p_event_id: input.eventId,
    p_streamer_id: input.streamerId,
    p_twitch_stream_id: input.streamId,
    p_guild_id: expectedGuildId,
    p_channel_id: expectedChannelId,
  });
  if (claimError) {
    console.error("Discord announcement claim failed", claimError.message);
    return { status: "failed" as const };
  }
  const announcementId = typeof claim?.announcementId === "string" ? claim.announcementId : "";
  if (!announcementId) return { status: "already_handled_or_ineligible" as const };

  try {
    const webhookResponse = await fetch(webhookUrl, { method: "GET" });
    const webhook = (await webhookResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (!webhookResponse.ok) throw new Error(`Discord Webhook konnte nicht geprüft werden (${webhookResponse.status}).`);
    if (String(webhook.guild_id ?? "") !== expectedGuildId || String(webhook.channel_id ?? "") !== expectedChannelId) {
      throw new Error("Discord Webhook zeigt nicht auf den konfigurierten Server und Kanal.");
    }

    const payload = buildDiscordLiveAnnouncement({
      displayName: String(streamer.display_name ?? ""),
      twitchLogin: String(streamer.twitch_login ?? ""),
      twitchUrl: String(streamer.twitch_url ?? ""),
      avatarUrl: String(streamer.avatar_url ?? ""),
      streamTitle: input.stream.streamTitle,
      gameName: input.stream.gameName,
      thumbnailUrl: input.stream.thumbnailUrl,
      viewerCount: input.stream.viewerCount,
      startedAt: String(input.stream.startedAt ?? new Date().toISOString()),
    });
    const executeUrl = new URL(webhookUrl);
    executeUrl.searchParams.set("wait", "true");
    const response = await fetch(executeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const message = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof message.id !== "string") {
      throw new Error(`Discord Webhook antwortete mit Status ${response.status}.`);
    }
    if (String(message.channel_id ?? "") !== expectedChannelId) {
      throw new Error("Discord bestätigte einen unerwarteten Zielkanal.");
    }
    const { error: finishError } = await service.rpc("finish_discord_stream_announcement", {
      p_announcement_id: announcementId,
      p_status: "sent",
      p_discord_message_id: message.id,
      p_error: null,
    });
    if (finishError) throw finishError;
    await logAnnouncement(service, input.eventId, input.streamerId, "discord_live_announcement_sent", "Discord-Live-Ankündigung gesendet.");
    return { status: "sent" as const };
  } catch (error) {
    const detail = safeError(error);
    await service.rpc("finish_discord_stream_announcement", {
      p_announcement_id: announcementId,
      p_status: "failed",
      p_discord_message_id: null,
      p_error: detail,
    });
    await logAnnouncement(service, input.eventId, input.streamerId, "discord_live_announcement_failed", detail, "error");
    return { status: "failed" as const, error: detail };
  }
}
