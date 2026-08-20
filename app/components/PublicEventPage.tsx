"use client";

import { getNextMilestone, PHASES } from "../lib/config";
import { formatNumber } from "../lib/format";
import { useEventData } from "../lib/state-provider";
import type { EventStatus, StreamerState } from "../lib/types";
import { BossAvatar } from "./BossAvatar";
import { BossHealth } from "./BossHealth";

const brandAssetUrl = `${import.meta.env.BASE_URL}assets/branding/kuerbiskoenig-logo-head.png`;

function RaidBrand({ footer = false }: { footer?: boolean }) {
  return (
    <a className={`raid-brand${footer ? " raid-brand--footer" : ""}`} href="#top" aria-label="Kürbiskönig Startseite">
      <span className="raid-brand__crest" aria-hidden="true"><img src={brandAssetUrl} alt="" /></span>
      <span className="raid-brand__wordmark"><strong>Kürbiskönig</strong><small>Community Raid 2026</small></span>
    </a>
  );
}

function eventStatusLabel(status: EventStatus, active: boolean) {
  if (status === "testing") return "Eventvorschau";
  if (active) return "Event läuft";
  if (status === "paused") return "Event pausiert";
  if (status === "finished") return "Boss besiegt";
  if (status === "archived") return "Event beendet";
  return "Vorbereitung";
}

function RaidAtmosphere() {
  return (
    <div className="raid-atmosphere" aria-hidden="true">
      <span className="raid-atmosphere__moon" />
      <span className="raid-atmosphere__horizon" />
      <span className="raid-atmosphere__fog raid-atmosphere__fog--one" />
      <span className="raid-atmosphere__fog raid-atmosphere__fog--two" />
      <span className="raid-atmosphere__embers" />
    </div>
  );
}

function StreamerAvatar({ streamer }: { streamer: StreamerState }) {
  return (
    <span className="raid-streamer-avatar" aria-hidden="true">
      <span>{streamer.displayName.slice(0, 1).toUpperCase()}</span>
      {streamer.avatarUrl && <img src={streamer.avatarUrl} alt="" loading="lazy" />}
    </span>
  );
}

function LiveStreamerCard({ streamer }: { streamer: StreamerState }) {
  return (
    <a className="live-fighter-card" href={streamer.twitchUrl} target="_blank" rel="noreferrer" aria-label={`${streamer.displayName} live auf Twitch öffnen`}>
      <span className="live-fighter-card__glow" aria-hidden="true" />
      <StreamerAvatar streamer={streamer} />
      <span className="live-fighter-card__identity">
        <em><i aria-hidden="true" /> Live im Raid</em><strong>{streamer.displayName}</strong><small>{streamer.communityName}</small>
      </span>
      <span className="live-fighter-card__stats">
        <span><small>Zuschauer</small><strong>{formatNumber(streamer.currentViewerCount)}</strong></span>
        <span><small>Raid-Schaden</small><strong>{formatNumber(streamer.damage)}</strong></span>
      </span>
      <span className="live-fighter-card__cta">Stream öffnen <b aria-hidden="true">↗</b></span>
    </a>
  );
}

function PartyCard({ streamer }: { streamer: StreamerState }) {
  return (
    <a className={`party-card${streamer.live ? " is-live" : ""}`} href={streamer.twitchUrl} target="_blank" rel="noreferrer" aria-label={`${streamer.displayName} auf Twitch öffnen`}>
      <StreamerAvatar streamer={streamer} />
      <span className="party-card__identity"><strong>{streamer.displayName}</strong><small>{streamer.communityName}</small></span>
      <span className="party-card__state">
        <em><i aria-hidden="true" />{streamer.live ? "Live" : "Offline"}</em>
        <small>{streamer.live ? `${formatNumber(streamer.currentViewerCount)} Zuschauer` : `${formatNumber(streamer.minionsDefeated)} Diener besiegt`}</small>
      </span>
      <span className="party-card__damage"><small>Beitrag</small><strong>{formatNumber(streamer.damage)}</strong></span>
    </a>
  );
}

export function PublicEventPage() {
  const { state, runtime } = useEventData();
  const phase = PHASES.find((item) => item.id === state.boss.phase) ?? PHASES[0];
  const milestone = getNextMilestone(state.boss.currentHp, state.boss.maxHp);
  const publicStreamers = state.streamers.filter((streamer) => streamer.enabled && streamer.gameplayEnabled && streamer.publicVisible && !streamer.isTestAccount);
  const liveStreamers = publicStreamers.filter((streamer) => streamer.live);
  const partyStreamers = [...publicStreamers].sort((a, b) => Number(b.live) - Number(a.live) || b.damage - a.damage);
  const isPrelaunch = !runtime.lastSyncedAt || state.event.status === "draft";

  if (isPrelaunch) {
    const isLoading = !runtime.lastSyncedAt && runtime.status === "loading";
    return (
      <main className="public-site public-site--raid public-site--prelaunch" data-phase="1">
        <RaidAtmosphere />
        <header className="raid-nav raid-nav--prelaunch">
          <RaidBrand />
          <span className="event-status"><i aria-hidden="true" />{isLoading ? "Wird geladen" : "Vorbereitung"}</span>
        </header>
        <section className="prelaunch-stage" id="top">
          <div className="prelaunch-stage__copy">
            <p className="overline">COMMUNITY RAID · OKTOBER 2026</p>
            <h1>Die Raid-Party <span>versammelt sich.</span></h1>
            <p>Der Kürbiskönig wartet bereits auf seinem Thron. Die vollständige Eventseite erwacht, sobald die Organisation den gemeinsamen Raid freigibt.</p>
            <div className="prelaunch-seal"><span aria-hidden="true">◆</span> Das Event startet bald <span aria-hidden="true">◆</span></div>
          </div>
          <div className="prelaunch-stage__boss" aria-label="Kürbiskönig Eventvorschau">
            <span className="raid-stage__runes" aria-hidden="true" /><span className="raid-stage__boss-glow" aria-hidden="true" />
            <BossAvatar phase={1} />
            <div className="raid-phase-banner"><span>Vor dem Start</span><strong>Der König wartet</strong></div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="public-site public-site--raid" data-phase={state.boss.phase}>
      <RaidAtmosphere />
      <header className="raid-nav">
        <RaidBrand />
        <nav aria-label="Hauptnavigation">
          <a href="#boss">Boss</a><a href="#party">Party</a><a href="#fortschritt">Fortschritt</a><a href="#event">Über das Event</a>
        </nav>
        <span className={`event-status${state.event.active ? " is-live" : ""}`}><i aria-hidden="true" /> {eventStatusLabel(state.event.status, state.event.active)}</span>
      </header>

      {runtime.status !== "ready" && <div className="raid-refresh-notice" role="status">Die Eventanzeige wird gerade aktualisiert …</div>}

      <section className="raid-stage" id="top">
        <span id="boss" className="anchor-target" aria-hidden="true" />
        <div className="raid-stage__copy">
          <p className="overline">GLOBALER COMMUNITY-RAID · OKTOBER 2026</p>
          <h1>Der Kürbiskönig <span>ist erwacht.</span></h1>
          <p className="hero-lead">Viele Communities. Ein mächtiger Gegner. Jeder Stream, jedes Minion und jede gemeinsame Aktion bringt die Raid-Party dem Thron ein Stück näher.</p>
          <div className="raid-stage__party-summary" aria-label="Aktueller Raidstatus"><span><strong>{publicStreamers.length}</strong> Communities</span><span><strong>{liveStreamers.length}</strong> gerade live</span></div>
        </div>
        <div className="raid-stage__boss" aria-label="Aktueller Bossstatus">
          <span className="raid-stage__runes" aria-hidden="true" /><span className="raid-stage__boss-glow" aria-hidden="true" />
          <BossAvatar phase={state.boss.phase} />
          <div className="raid-phase-banner"><span>Phase {phase.roman}</span><strong>{phase.name}</strong></div>
        </div>
        <div className="raid-stage__health"><BossHealth boss={state.boss} /></div>
      </section>

      <section className="raid-stats-section" aria-labelledby="raid-stats-title">
        <div className="section-kicker"><span aria-hidden="true">◆</span><small id="raid-stats-title">Der gemeinsame Kampf in Zahlen</small><span aria-hidden="true">◆</span></div>
        <div className="raid-stat-grid">
          <article><span aria-hidden="true">⚔</span><small>Verursachter Schaden</small><strong>{formatNumber(state.stats.globalDamage)}</strong><p>Gemeinsam am König verursacht</p></article>
          <article><span aria-hidden="true">♜</span><small>Raid-Party</small><strong>{formatNumber(state.stats.communities)}</strong><p>Vereinte Twitch-Communities</p></article>
          <article><span aria-hidden="true">☠</span><small>Besiegte Diener</small><strong>{formatNumber(state.stats.minionsDefeated)}</strong><p>Gemeinsam zurückgeschlagen</p></article>
          <article><span aria-hidden="true">✦</span><small>Chat-Kämpfer</small><strong>{formatNumber(state.stats.uniqueParticipants)}</strong><p>Einzigartige Beteiligte</p></article>
        </div>
      </section>

      {liveStreamers.length > 0 && (
        <section className="live-raid-section section-divider" id="live" aria-labelledby="live-raid-title">
          <div className="raid-section-heading"><div><p className="overline">JETZT IM KAMPF</p><h2 id="live-raid-title">Die Party kämpft gerade.</h2></div><p><strong>{liveStreamers.length}</strong> {liveStreamers.length === 1 ? "Community ist" : "Communities sind"} aktuell live. Schau vorbei und unterstütze den gemeinsamen Raid.</p></div>
          <div className="live-fighter-grid">{liveStreamers.map((streamer) => <LiveStreamerCard key={streamer.id} streamer={streamer} />)}</div>
          {liveStreamers.length > 1 && <p className="multistream-note"><span aria-hidden="true">✦</span> Mehrere Kämpfer sind gleichzeitig live – jede Community kämpft am selben globalen Boss.</p>}
        </section>
      )}

      <section className="raid-party-section section-divider" id="party" aria-labelledby="raid-party-title">
        <div className="raid-section-heading"><div><p className="overline">VEREINTE COMMUNITIES</p><h2 id="raid-party-title">Die Raid-Party versammelt sich.</h2></div><p>Keine Community kämpft allein. Jeder Beitrag fließt in denselben globalen Bossfortschritt.</p></div>
        {partyStreamers.length ? <div className="party-card-grid">{partyStreamers.map((streamer) => <PartyCard key={streamer.id} streamer={streamer} />)}</div> : <p className="raid-empty-state">Die ersten Communities werden gerade für den Raid vorbereitet.</p>}
      </section>

      <section className="raid-progress-section section-divider" id="fortschritt" aria-labelledby="raid-progress-title">
        <div className="raid-section-heading"><div><p className="overline">GLOBALER RAIDFORTSCHRITT</p><h2 id="raid-progress-title">Der Weg zum Thron.</h2></div><p>Jede überwundene Schwelle verändert den Kampf. Die Raid-Party drängt den Kürbiskönig Phase für Phase zurück.</p></div>
        <div className="raid-progress-layout">
          <article className="next-milestone-card"><small>Nächste Schwelle</small><span className="next-milestone-card__sigil" aria-hidden="true">◆</span><h3>{milestone.label}</h3><p>{"description" in milestone ? milestone.description : "Der letzte Weg zum Thron"}</p><strong>Noch {formatNumber(milestone.damageRemaining)} Schaden</strong></article>
          <ol className="raid-road">
            {state.milestones.map((item) => {
              const reached = Boolean(item.reachedAt);
              const current = !reached && item.percent === milestone.percent;
              return <li key={item.id} className={reached ? "is-reached" : current ? "is-current" : "is-locked"}><span className="raid-road__marker" aria-hidden="true">{reached ? "✓" : "◆"}</span><span><small>{reached ? "Bezwungen" : current ? "Aktuell" : `${item.percent} % Boss-HP`}</small><strong>{item.label}</strong><p>{item.description}</p></span></li>;
            })}
          </ol>
        </div>
      </section>

      <section className="raid-explainer section-divider" id="event" aria-labelledby="raid-explainer-title">
        <div className="raid-section-heading raid-section-heading--centered"><div><p className="overline">EIN BOSS · VIELE COMMUNITIES · EIN ZIEL</p><h2 id="raid-explainer-title">So wird der König gestürzt.</h2></div><p>Der gesamte Oktober wird zu einem gemeinsamen Raid – direkt in den Streams der teilnehmenden Communities.</p></div>
        <ol className="raid-steps">
          <li><span>01</span><div><strong>Zuschauen</strong><p>Aktive Communities tragen während ihrer Streams zum gemeinsamen Kampf bei.</p></div></li>
          <li><span>02</span><div><strong>Diener bezwingen</strong><p>Kurze <b>!boss</b>-Events fordern den Chat heraus und verursachen zusätzlichen Schaden.</p></div></li>
          <li><span>03</span><div><strong>Gemeinsam siegen</strong><p>Alle Streamer teilen sich denselben Boss – bis sein letzter Lebenspunkt fällt.</p></div></li>
        </ol>
        <div className="raid-callout"><span aria-hidden="true">♛</span><p>Wird die Raid-Party den Kürbiskönig bis Halloween vom Thron stoßen?</p></div>
      </section>

      <aside className="raid-fairness-note"><span aria-hidden="true">⚖</span><div><small>Gemeinsam fair</small><p>Die Regeln berücksichtigen unterschiedliche Communitygrößen, ohne kleine Streams abzuhängen. Raids schaffen besondere Chancen, verursachen aber keinen direkten Boss-Schaden.</p></div></aside>

      <footer className="raid-footer"><RaidBrand footer /><p>Ein gemeinsames Halloween-Event teilnehmender Twitch-Communities.</p><small>Event &amp; Technik · PXB Labs</small></footer>
    </main>
  );
}
