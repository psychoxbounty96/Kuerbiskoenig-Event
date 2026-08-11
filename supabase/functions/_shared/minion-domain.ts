export function parseBossCommand(value: unknown) {
  if (typeof value !== "string") return { matched: false, answer: null, reason: "not_command" } as const;
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens[0].toLowerCase() !== "!boss") {
    return { matched: false, answer: null, reason: "not_command" } as const;
  }
  if (tokens.length > 2) return { matched: false, answer: null, reason: "too_many_arguments" } as const;
  return { matched: true, answer: tokens[1]?.toLowerCase() ?? null, reason: "ok" } as const;
}

export function hasForbiddenDamageField(body: Record<string, unknown>) {
  return ["damage", "rawDamage", "raw_damage", "damageAwarded", "damage_awarded"].some((key) => Object.hasOwn(body, key));
}

export function validateMinionActionPayload(body: Record<string, unknown>) {
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const streamerId = typeof body.streamerId === "string" ? body.streamerId.trim() : "";
  const minionEventId = typeof body.minionEventId === "string" ? body.minionEventId.trim() : "";
  const participantId = typeof body.participantId === "string" ? body.participantId.trim() : "";
  const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(eventId) || !uuid.test(streamerId) || !uuid.test(minionEventId)) throw new Error("invalid_scope_ids");
  if (!participantId || participantId.length > 128 || !messageId || messageId.length > 160 || !text || text.length > 80) {
    throw new Error("payload_limits_exceeded");
  }
  const command = parseBossCommand(text);
  if (!command.matched) throw new Error(command.reason);
  return { eventId, streamerId, minionEventId, participantId, messageId, answer: command.answer };
}
