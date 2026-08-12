"use client";

import { getNextMilestone, PHASES } from "../lib/config";
import { formatNumber } from "../lib/format";
import { useEventData } from "../lib/state-provider";
import { BossAvatar } from "./BossAvatar";
import { BossHealth } from "./BossHealth";

export function PublicEventPage() {
  const { state, runtime } = useEventData();
  const phase = PHASES.find((item) => item.id === state.boss.phase) ?? PHASES[0];
  const milestone = getNextMilestone(state.boss.currentHp, state.boss.maxHp);
  const ranking = state.streamers.filter((streamer) => streamer.enabled).sort((a, b) => b.damage - a.damage);

  if (!runtime.lastSyncedAt) {
    const isLoading = runtime.status === "loading";

    return (
      <main className="public-site">
        <header className="site-header">
          <a className="brand" href="#top" aria-label="Kürbiskönig Startseite">
            <span className="brand-mark">K</span>
            <span>
              <strong>Kürbiskönig</strong>
              <small>Community Boss Event</small>
            </span>
          </a>
          <span className="event-status">
            <i aria-hidden="true" /> {isLoading ? "Eventdaten werden geladen" : "Event in Vorbereitung"}
          </span>
        </header>

        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="overline">KÜRBISKÖNIG · COMMUNITY BOSS EVENT</p>
            <h1>
              Das Event
              <span>startet bald.</span>
            </h1>
            <p className="hero-lead">
              {isLoading
                ? "Die öffentlichen Eventdaten werden gerade geladen."
                : "Die Organisation bereitet den Kürbiskönig noch vor. Der echte Bossfortschritt erscheint automatisch, sobald das Event freigegeben wurde."}
            </p>
          </div>
          <div className="hero-boss" aria-label="Kürbiskönig Eventvorschau">
            <div className="phase-orbit" aria-hidden="true" />
            <BossAvatar phase={1} />
            <div className="boss-titleplate">
              <span>VOR DEM START</span>
              <strong>Bereit</strong>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="public-site">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Kürbiskönig Startseite">
          <span className="brand-mark">K</span>
          <span>
            <strong>Kürbiskönig</strong>
            <small>Community Boss Event</small>
          </span>
        </a>
        <nav aria-label="Hauptnavigation">
          <a href="#fortschritt">Fortschritt</a>
          <a href="#communities">Communities</a>
          <a href="#event">Das Event</a>
        </nav>
        <span className={`event-status${state.event.active ? " is-live" : ""}`}>
          <i aria-hidden="true" /> {state.event.active ? "Event aktiv" : "Event pausiert"}
        </span>
      </header>

      {runtime.status !== "ready" && (
        <div className={`runtime-notice runtime-notice--${runtime.status}`} role="status">
          {runtime.status === "loading" ? "Eventdaten werden geladen …" : runtime.error || "Verbindung wird wiederhergestellt …"}
        </div>
      )}

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="overline">OKTOBER 2026 · GEMEINSAMER BOSSFORTSCHRITT</p>
          <h1>
            Mehrere Streams.
            <span>Ein gemeinsamer Gegner.</span>
          </h1>
          <p className="hero-lead">
            Mehrere Communities stellen sich demselben Kürbiskönig. Jede bestätigte Aktion zählt –
            bis zum letzten Lebenspunkt.
          </p>
          <a className="text-link" href="#event">
            So funktioniert das Event <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="hero-boss" aria-label="Aktueller Bossstatus">
          <div className="phase-orbit" aria-hidden="true" />
          <BossAvatar phase={state.boss.phase} />
          <div className="boss-titleplate">
            <span>Phase {phase.roman}</span>
            <strong>{phase.name}</strong>
          </div>
        </div>
      </section>

      <section className="progress-section" id="fortschritt">
        <BossHealth boss={state.boss} />
        <div className="milestone-line">
          <span className="milestone-glyph" aria-hidden="true">◆</span>
          <div>
            <small>NÄCHSTER MEILENSTEIN</small>
            <strong>{milestone.label}</strong>
          </div>
          <p>
            Noch <strong>{formatNumber(milestone.damageRemaining)} Schaden</strong>
          </p>
        </div>
      </section>

      <section className="stat-strip" aria-label="Globale Eventstatistik">
        <article>
          <small>Communities</small>
          <strong>{state.stats.communities}</strong>
        </article>
        <article>
          <small>Gesamtschaden</small>
          <strong>{formatNumber(state.stats.globalDamage)}</strong>
        </article>
        <article>
          <small>Minions besiegt</small>
          <strong>{formatNumber(state.stats.minionsDefeated)}</strong>
        </article>
        <article>
          <small>Teilnehmende</small>
          <strong>{formatNumber(state.stats.uniqueParticipants)}</strong>
        </article>
      </section>

      <section className="community-grid" id="communities">
        <div className="section-intro">
          <p className="overline">VEREINTE KRÄFTE</p>
          <h2>Jede Community hinterlässt ihre Spur.</h2>
          <p>
            Der globale Fortschritt bleibt das Ziel. Diese Übersicht zeigt, wie die
            teilnehmenden Communities gemeinsam dazu beitragen.
          </p>
        </div>

        <div className="ranking-panel">
          <div className="panel-heading">
            <div>
              <small>AKTUELLER STAND</small>
              <h3>Community-Rangliste</h3>
            </div>
            <span>{runtime.mode === "supabase" ? "Live · Supabase" : "Lokale Mockdaten"}</span>
          </div>
          <ol className="ranking-list">
            {ranking.slice(0, 5).map((streamer, index) => (
              <li key={streamer.id}>
                <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="community-name">
                  <strong>{streamer.communityName}</strong>
                  <small>{streamer.minionsDefeated} Minions besiegt</small>
                </span>
                <strong>{formatNumber(streamer.damage)}</strong>
              </li>
            ))}
          </ol>
        </div>

        <aside className="participants-panel">
          <div className="panel-heading">
            <div>
              <small>TEILNEHMENDE STREAMS</small>
              <h3>Heute im Kampf</h3>
            </div>
          </div>
          <ul className="participant-list">
            {state.streamers.filter((streamer) => streamer.enabled).map((streamer) => (
              <li key={streamer.id}>
                <a className="participant-avatar" href={streamer.twitchUrl} target="_blank" rel="noreferrer" aria-label={`${streamer.displayName} auf Twitch öffnen`}>
                  {streamer.displayName.slice(0, 1)}
                </a>
                <span>
                  <a href={streamer.twitchUrl} target="_blank" rel="noreferrer"><strong>{streamer.displayName}</strong></a>
                  <small>{streamer.live ? `${formatNumber(streamer.currentViewerCount)} Zuschauer` : streamer.communityName}</small>
                </span>
                {streamer.live ? <em title={streamer.liveSince ? `Live seit ${new Date(streamer.liveSince).toLocaleString("de-DE")}` : "Live"}>LIVE</em> : <i>Offline</i>}
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="event-explainer" id="event">
        <div>
          <p className="overline">EIN EVENT · EIN ZIEL</p>
          <h2>Was ist das Kürbiskönig Event?</h2>
        </div>
        <div className="explainer-copy">
          <p>
            Mehrere Streamer und ihre Communities kämpfen im Oktober gemeinsam gegen
            einen globalen Halloween-Boss. v0.4 ergänzt echte Live- und Zuschauerzahlen um
            kurze, streamerbezogene <strong>!boss</strong>-Minispiele, deren Erfolg dem gemeinsamen Boss schadet.
          </p>
          <p className="goal-callout">
            Alle arbeiten auf dasselbe Ziel hin: <strong>Den Kürbiskönig bis Halloween besiegen.</strong>
          </p>
        </div>
      </section>

      <section className="fairness-note">
        <span aria-hidden="true">⚖</span>
        <div>
          <small>GEMEINSAM FAIR</small>
          <p>
            Schwierigkeit und Minion-Schaden werden serverseitig mit einer abflachenden, vorläufigen Kurve skaliert.
            Passive Viewer-Damage und direkter Raid-Schaden bleiben weiterhin deaktiviert.
          </p>
        </div>
      </section>

      <footer>
        <div className="brand brand--footer">
          <span className="brand-mark">K</span>
          <span>
            <strong>Kürbiskönig</strong>
            <small>Community Boss Event</small>
          </span>
        </div>
        <p>Prototype v0.4 · {runtime.mode === "supabase" ? "Supabase + Twitch + Minion Engine" : "sicherer Mockbetrieb"}</p>
      </footer>
    </main>
  );
}
