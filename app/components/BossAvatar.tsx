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
  return (
    <div
      className={`boss-avatar${compact ? " boss-avatar--compact" : ""}${hit ? " is-hit" : ""}`}
      data-phase={phase}
      data-animation-state={hit ? "hit" : "idle"}
      aria-label="Platzhaltergrafik des Kürbiskönigs"
      role="img"
    >
      <span className="crown" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="stem" aria-hidden="true" />
      <span className="pumpkin" aria-hidden="true">
        <span className="pumpkin-ridge ridge-left" />
        <span className="pumpkin-ridge ridge-right" />
        <span className="eye eye-left" />
        <span className="eye eye-right" />
        <span className="mouth" />
      </span>
      <span className="mantle" aria-hidden="true" />
      <span className="boss-placeholder-label">PLACEHOLDER</span>
    </div>
  );
}
