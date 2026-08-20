import { useEffect, useRef, useState } from "react";
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
  const displayedHpRef = useRef(boss.currentHp);
  const previousHpRef = useRef(boss.currentHp);
  const [displayedHp, setDisplayedHp] = useState(boss.currentHp);
  const [isDamaged, setIsDamaged] = useState(false);

  useEffect(() => {
    const previousHp = previousHpRef.current;
    previousHpRef.current = boss.currentHp;
    let damageFrame = 0;
    if (boss.currentHp < previousHp) {
      damageFrame = window.requestAnimationFrame(() => setIsDamaged(true));
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (compact || reducedMotion) {
      const updateFrame = window.requestAnimationFrame(() => {
        displayedHpRef.current = boss.currentHp;
        setDisplayedHp(boss.currentHp);
      });
      const damageTimer = window.setTimeout(() => setIsDamaged(false), 350);
      return () => {
        window.cancelAnimationFrame(damageFrame);
        window.cancelAnimationFrame(updateFrame);
        window.clearTimeout(damageTimer);
      };
    }

    const startValue = displayedHpRef.current;
    const difference = boss.currentHp - startValue;
    const startTime = performance.now();
    let animationFrame = 0;
    const duration = 850;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + difference * eased);
      displayedHpRef.current = nextValue;
      setDisplayedHp(nextValue);
      if (progress < 1) animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    const damageTimer = window.setTimeout(() => setIsDamaged(false), 720);
    return () => {
      window.cancelAnimationFrame(damageFrame);
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(damageTimer);
    };
  }, [boss.currentHp, compact]);

  return (
    <div className={`boss-health${compact ? " boss-health--compact" : ""}${isDamaged ? " is-damaged" : ""}`}>
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
          <strong>{formatNumber(displayedHp)}</strong> / {formatNumber(boss.maxHp)} HP
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
