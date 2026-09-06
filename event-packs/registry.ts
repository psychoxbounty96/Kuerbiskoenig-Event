import halloween2026Json from "./halloween-2026/pack.json";
import { validateEventPack, type EventPackManifest } from "../packages/pack-schema/src";

const packs = [validateEventPack(halloween2026Json)] as EventPackManifest[];

export const EVENT_PACKS = Object.freeze(
  Object.fromEntries(packs.map((pack) => [pack.key, pack])) as Record<string, EventPackManifest>,
);

export function getEventPack(key: string) {
  const pack = EVENT_PACKS[key];
  if (!pack) throw new Error(`Unknown event pack: ${key}`);
  return pack;
}

export function findEventPackBySlug(eventSlug: string) {
  return packs.find((pack) => pack.events.some((event) => event.slug === eventSlug)) ?? null;
}
