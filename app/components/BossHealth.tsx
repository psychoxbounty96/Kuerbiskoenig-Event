import { PHASES } from "../lib/config";
import { formatNumber, formatPercent } from "../lib/format";
import type { EventState } from "../lib/types";

export function BossHealth({
  boss,
  compact = false,
}: {
  boss: EventState["boss"];
  compact?: boolean;
}) {
  const percent = boss.maxHp > 0 ? (boss.currentHp / boss.maxHp) * 100 : 0;
  const phase = PHASES.find((item) => item.id === boss.phase) ?? PHASES[0];

  return (
    <div className={`boss-health${compact ? " boss-health--compact" : ""}`}>
      <div className="boss-health__header">
        <div>
          <span className="eyebrow">GLOBALER BOSS</span>
          <h2>{boss.name}</h2>
        </div>
        <strong>{formatPercent(boss.currentHp, boss.maxHp)} %</strong>
      </div>
      <div
        className="health-track"
        role="progressbar"
        aria-label={`${boss.name} Lebenspunkte`}
        aria-valuemin={0}
        aria-valuemax={boss.maxHp}
        aria-valuenow={boss.currentHp}
      >
        <span className="health-segments" aria-hidden="true" />
        <span
          className="health-fill"
          style={{ width: `${percent}%`, "--phase-color": phase.color } as React.CSSProperties}
        />
      </div>
      <div className="boss-health__numbers">
        <span>
          <strong>{formatNumber(boss.currentHp)}</strong> / {formatNumber(boss.maxHp)} HP
        </span>
        {!compact && (
          <span className="phase-inline" style={{ color: phase.color }}>
            Phase {phase.roman} · {phase.name}
          </span>
        )}
      </div>
    </div>
  );
}
