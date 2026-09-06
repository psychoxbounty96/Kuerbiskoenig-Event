"use client";

import { ACTIVE_EVENT_PACK } from "../lib/config";
import { formatNumber } from "../lib/format";
import { useEventData } from "../lib/state-provider";
import type { EventStatus, StreamerState } from "../lib/types";
import { BossAvatar } from "./BossAvatar";
import { BossHealth } from "./BossHealth";

function statusLabel(status: EventStatus, active: boolean) {
  if (status === "testing") return "Vorschau";
  if (active) return "Event läuft";
  if (status === "paused") return "Event pausiert";
  if (status === "finished") return "Boss besiegt";
  if (status === "archived") return "Event beendet";
  return "Vorbereitung";
}

function StreamerAvatar({ streamer }: { streamer: StreamerState }) {
  return <span className="raid-streamer-avatar" aria-hidden="true">
    <span>{streamer.displayName.slice(0, 1).toUpperCase()}</span>
    {streamer.avatarUrl && <img src={streamer.avatarUrl} alt="" loading="lazy" />}
  </span>;
}

function StreamerCard({ streamer }: { streamer: StreamerState }) {
  return <a className={`party-card${streamer.live ? " is-live" : ""}`} href={streamer.twitchUrl} target="_blank" rel="noreferrer">
    <StreamerAvatar streamer={streamer} />
    <span className="party-card__identity"><strong>{streamer.displayName}</strong><small>{streamer.communityName}</small></span>
    <span className="party-card__state"><em><i aria-hidden="true" />{streamer.live ? "Live" : "Offline"}</em><small>{streamer.live ? `${formatNumber(streamer.currentViewerCount)} Zuschauer` : `${formatNumber(streamer.minionsDefeated)} Begegnungen gewonnen`}</small></span>
    <span className="party-card__damage"><small>Beitrag</small><strong>{formatNumber(streamer.damage)}</strong></span>
  </a>;
}

export function PublicEventPage() {
  const { state, runtime } = useEventData();
  const website = ACTIVE_EVENT_PACK.website;
  const phase = state.phases.find((item) => item.id === state.boss.phase) ?? state.phases[0];
  const streamers = state.streamers
    .filter((item) => item.enabled && item.gameplayEnabled && item.publicVisible && !item.isTestAccount)
    .sort((a, b) => Number(b.live) - Number(a.live) || b.damage - a.damage);
  const live = streamers.filter((item) => item.live);
  const prelaunch = !runtime.lastSyncedAt || state.event.status === "draft";

  return <main
    className={`public-site public-site--raid${prelaunch ? " public-site--prelaunch" : ""} ${ACTIVE_EVENT_PACK.theme.className}`}
    data-pack={state.event.packKey}
    data-pack-version={state.event.packVersion}
    data-phase={state.boss.phase}
    style={{
      "--pack-primary": ACTIVE_EVENT_PACK.theme.colors.primary,
      "--pack-secondary": ACTIVE_EVENT_PACK.theme.colors.secondary,
      "--pack-accent": ACTIVE_EVENT_PACK.theme.colors.accent,
    } as React.CSSProperties}
  >
    <header className="raid-nav" id="top">
      <a className="raid-brand" href="#top"><span className="raid-brand__wordmark"><strong>{state.event.name || ACTIVE_EVENT_PACK.name}</strong><small>{ACTIVE_EVENT_PACK.description}</small></span></a>
      {!prelaunch && <nav aria-label="Hauptnavigation"><a href="#boss">Boss</a><a href="#party">Teilnehmende</a><a href="#event">Event</a></nav>}
      <span className={`event-status${state.event.active ? " is-live" : ""}`}><i aria-hidden="true" />{statusLabel(state.event.status, state.event.active)}</span>
    </header>

    {prelaunch ? <section className="prelaunch-stage">
      <div className="prelaunch-stage__copy">
        <p className="overline">COMMUNITY EVENT</p>
        <h1>{website?.headline ?? state.event.name}</h1>
        <p>{state.event.description || website?.shortDescription || ACTIVE_EVENT_PACK.description}</p>
        <div className="prelaunch-seal"><span aria-hidden="true">◆</span>{ACTIVE_EVENT_PACK.theme.labels.prelaunch ?? "Event startet bald"}<span aria-hidden="true">◆</span></div>
      </div>
      <div className="prelaunch-stage__boss"><BossAvatar phase={phase?.id ?? 1} /></div>
    </section> : <>
      {runtime.status !== "ready" && <div className="raid-refresh-notice" role="status">Die Eventanzeige wird aktualisiert …</div>}
      <section className="raid-stage" id="boss">
        <div className="raid-stage__copy">
          <p className="overline">GEMEINSAMES COMMUNITY EVENT</p>
          <h1>{website?.headline ?? state.event.name}</h1>
          <p className="hero-lead">{website?.shortDescription ?? state.event.description}</p>
          <div className="raid-stage__party-summary"><span><strong>{streamers.length}</strong> Communities</span><span><strong>{live.length}</strong> gerade live</span></div>
        </div>
        <div className="raid-stage__boss"><BossAvatar phase={state.boss.phase} /><div className="raid-phase-banner"><span>Phase {phase?.id ?? state.boss.phase}</span><strong>{phase?.name ?? state.boss.phaseName}</strong></div></div>
        <div className="raid-stage__health"><BossHealth boss={state.boss} phases={state.phases} /></div>
      </section>

      <section className="raid-stats-section">
        <div className="raid-stat-grid">
          <article><span aria-hidden="true">⚔</span><small>Gesamtschaden</small><strong>{formatNumber(state.stats.globalDamage)}</strong></article>
          <article><span aria-hidden="true">♜</span><small>Communities</small><strong>{formatNumber(state.stats.communities)}</strong></article>
          <article><span aria-hidden="true">☠</span><small>Siegreiche Begegnungen</small><strong>{formatNumber(state.stats.minionsDefeated)}</strong></article>
          <article><span aria-hidden="true">✦</span><small>Beteiligte</small><strong>{formatNumber(state.stats.uniqueParticipants)}</strong></article>
        </div>
      </section>

      <section className="raid-party-section section-divider" id="party">
        <div className="raid-section-heading"><div><p className="overline">TEILNEHMENDE COMMUNITIES</p><h2>Gemeinsam gegen {state.boss.name}.</h2></div><p>{website?.callToAction}</p></div>
        {streamers.length ? <div className="party-card-grid">{streamers.map((streamer) => <StreamerCard key={streamer.id} streamer={streamer} />)}</div> : <p className="raid-empty-state">Teilnehmende werden vorbereitet.</p>}
      </section>

      <section className="raid-explainer section-divider" id="event">
        <div className="raid-section-heading raid-section-heading--centered"><div><p className="overline">EIN EVENT · VIELE COMMUNITIES</p><h2>{state.event.name}</h2></div><p>{state.event.description || ACTIVE_EVENT_PACK.description}</p></div>
      </section>
    </>}
  </main>;
}
