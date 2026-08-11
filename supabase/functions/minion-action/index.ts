import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasForbiddenDamageField, validateMinionActionPayload } from "../_shared/minion-domain.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PARTICIPANT_PEPPER = Deno.env.get("MINION_PARTICIPANT_PEPPER") ?? "";
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function participantKey(eventId: string, streamerId: string, participantId: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(PARTICIPANT_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${eventId}:${streamerId}:${participantId}`));
  return toHex(new Uint8Array(signature));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || PARTICIPANT_PEPPER.length < 32) {
    return json({ ok: false, error: "minion_action_not_configured" }, 503);
  }
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > 2048) return json({ ok: false, error: "payload_too_large" }, 413);
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ ok: false, error: "payload_too_large" }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (hasForbiddenDamageField(body)) return json({ ok: false, error: "client_damage_forbidden" }, 400);
    const payload = validateMinionActionPayload(body);
    const hashedParticipant = await participantKey(payload.eventId, payload.streamerId, payload.participantId);
    const { data, error } = await service.rpc("submit_minion_action", {
      p_event_id: payload.eventId,
      p_streamer_id: payload.streamerId,
      p_minion_event_id: payload.minionEventId,
      p_participant_key: hashedParticipant,
      p_message_id: payload.messageId,
      p_answer: payload.answer,
    });
    if (error) throw error;
    return json({ ok: true, message: data?.accepted ? "Teilnahme gezählt." : "Teilnahme bereits gezählt.", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "minion_action_failed";
    return json({ ok: false, error: message }, 400);
  }
});
