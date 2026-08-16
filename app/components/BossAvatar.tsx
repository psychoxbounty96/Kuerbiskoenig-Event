import type { BossPhaseId } from "../lib/types";

export function BossAvatar({
  phase,
  hit = false,
  compact = false,
}: {
  phase: BossPhaseId;
  hit?: boolean;
  compact?: boolean;
}) {
  const assetUrl = `${import.meta.env.BASE_URL}assets/boss/pumpkin-king.png`;
  return (
    <div
      className={`boss-avatar${compact ? " boss-avatar--compact" : ""}${hit ? " is-hit" : ""}`}
      data-phase={phase}
      data-animation-state={hit ? "hit" : "idle"}
      aria-label="Kürbiskönig"
      role="img"
    >
      <span className="boss-avatar__aura" aria-hidden="true" />
      <img className="boss-avatar__image" src={assetUrl} alt="" aria-hidden="true" />
      <span className="boss-avatar__fallback" aria-hidden="true">🎃</span>
    </div>
  );
}
