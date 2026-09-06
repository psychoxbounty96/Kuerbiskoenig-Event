import type { BossPhaseId } from "../lib/types";
import { ACTIVE_EVENT_PACK, getPackAssetUrl } from "../lib/config";

export function BossAvatar({
  phase,
  hit = false,
  compact = false,
}: {
  phase: BossPhaseId;
  hit?: boolean;
  compact?: boolean;
}) {
  const assetUrl = getPackAssetUrl(ACTIVE_EVENT_PACK.boss.asset);
  return (
    <div
      className={`boss-avatar${compact ? " boss-avatar--compact" : ""}${hit ? " is-hit" : ""}`}
      data-phase={phase}
      data-animation-state={hit ? "hit" : "idle"}
      aria-label={ACTIVE_EVENT_PACK.boss.name}
      role="img"
    >
      <span className="boss-avatar__aura" aria-hidden="true" />
      {assetUrl && <img className="boss-avatar__image" src={assetUrl} alt="" aria-hidden="true" />}
      <span className="boss-avatar__fallback" aria-hidden="true">◆</span>
    </div>
  );
}
