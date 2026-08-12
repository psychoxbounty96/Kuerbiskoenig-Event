"use client";

import { useEffect, useRef, useState } from "react";
import { BossAvatar } from "../components/BossAvatar";
import { BossHealth } from "../components/BossHealth";
import { DEFAULT_OVERLAY_STREAMER, REFRESH_INTERVAL_MS } from "../lib/config";
import { getVisibleMinionForStreamer } from "../lib/domain";
import { formatNumber } from "../lib/format";
import { stateProvider, useEventData } from "../lib/state-provider";
import {
  extractStreamElementsChannelUsername,
  getDevelopmentIdentityOverrides,
  getOverlayDisplayMode,
  resolveParticipantIdentity,
  handleStreamElementsChatMessage,
} from "../lib/streamelements-adapter";
import type { MinionInstance, OverlayIdentityResolution } from "../lib/types";

const MINION_ARTWORK_FOLDERS: Readonly<Record<string, string>> = {
  ghost: "ghost",
  zombie_horde: "zombie",
  spider_queen: "spider",
  witch: "witch",
  bat_swarm: "bats",
  reaper: "reaper",
  kings_herald: "herald",
};

function MinionArtwork({ minion }: { minion: MinionInstance }) {
  const folder = MINION_ARTWORK_FOLDERS[minion.typeId];
  if (!folder) return <span className="ghost-icon" aria-hidden="true">{minion.icon}</span>;
  return (
    <span className="minion-artwork" aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}assets/minions/${folder}/placeholder.jpg`} alt="" />
    </span>
  );
}

function RuntimeVisual({ minion, observing }: { minion: MinionInstance; observing: boolean }) {
  const config = minion.runtimeConfig;
  if (minion.typeId === "zombie_horde") {
    return <div className="minion-visual minion-visual--directions" aria-label="Angriffsrichtung">
      {(["links", "mitte", "rechts"] as const).map((direction) => <span key={direction} className={observing && config.visualTarget === direction ? "is-target" : ""}>{direction === "links" ? "←" : direction === "rechts" ? "→" : "↑"}<small>{direction}</small></span>)}
    </div>;
  }
  if (minion.typeId === "spider_queen") {
    const options = Array.isArray(config.options) ? config.options : [];
    return <div className="minion-visual minion-visual--choices" aria-label="Nummerierte Spinnen">
      {options.map((option) => <span key={String(option)} className={String(config.queenIndex) === String(option) ? "is-target" : ""}>🕷️<b>{String(option)}</b></span>)}
    </div>;
  }
  if (minion.typeId === "witch") {
    const labels = config.optionLabels && typeof config.optionLabels === "object" ? config.optionLabels as Record<string, unknown> : {};
    return <div className="minion-question"><strong>{String(config.question ?? "Halloween-Frage")}</strong>{["a", "b", "c"].map((key) => <span key={key}>{key.toUpperCase()} – {String(labels[key] ?? "")}</span>)}</div>;
  }
  if (minion.typeId === "bat_swarm" && observing) {
    const count = Math.max(0, Number(config.count ?? 0));
    return <div className="minion-visual minion-visual--bats" aria-label={`${count} Fledermäuse`}>{Array.from({ length: count }, (_, index) => <span key={index}>🦇</span>)}</div>;
  }
  if (minion.typeId === "reaper") {
    const sequence = Array.isArray(config.sequence) ? config.sequence : [];
    const labels = config.optionLabels && typeof config.optionLabels === "object" ? config.optionLabels as Record<string, unknown> : {};
    return observing
      ? <div className="minion-sequence">{sequence.map((item, index) => <span key={index}>{String(item)}</span>)}</div>
      : <div className="minion-question">{["a", "b", "c"].map((key) => <span key={key}>{key.toUpperCase()} – {String(labels[key] ?? "")}</span>)}</div>;
  }
  return null;
}

function CurseLayer({ minion, phase }: { minion: MinionInstance; phase: number }) {
  if (minion.status !== "curse" || !minion.failureCurseKey) return null;
  return <div className={`curse-layer curse-layer--${minion.failureCurseKey} curse-phase-${phase}`} aria-label={`Fluch: ${minion.failureCurseKey}`}>
    <div className="curse-vignette" />
    <span className="curse-particle curse-particle--one" />
    <span className="curse-particle curse-particle--two" />
    <span className="curse-particle curse-particle--three" />
  </div>;
}

export default function OverlayPage() {
  const { state, runtime } = useEventData();
  const initialOverrides = { channelUsername: DEFAULT_OVERLAY_STREAMER, eventSlug: state.event.slug };
  const [now, setNow] = useState(0);
  const [hit, setHit] = useState(false);
  const [channelUsername, setChannelUsername] = useState(initialOverrides.channelUsername);
  const [widgetEventSlug, setWidgetEventSlug] = useState(initialOverrides.eventSlug);
  const [identity, setIdentity] = useState<OverlayIdentityResolution>(() => resolveParticipantIdentity({
    channelUsername: initialOverrides.channelUsername,
    eventSlug: initialOverrides.eventSlug,
    currentEventId: state.event.id,
    currentEventSlug: state.event.slug,
    currentEventStatus: state.event.status,
    streamers: state.streamers,
  }));
  const [identityTick, setIdentityTick] = useState(0);
  const previousHp = useRef(state.boss.currentHp);
  const identityRevision = `${state.event.status}:${state.settings.eventPaused}:${state.streamers
    .map((streamer) => `${streamer.id}:${streamer.twitchLogin}:${streamer.enabled}`)
    .join("|")}`;
  const displayMode = getOverlayDisplayMode(
    identity.status,
    identity.eventStatus ?? state.event.status,
    state.settings.eventPaused,
  );
  const resolvedStreamerId = identity.status === "resolved" ? identity.streamerId ?? "" : "";
  const minion = displayMode === "live" && resolvedStreamerId
    ? getVisibleMinionForStreamer(state.minions, resolvedStreamerId, now)
    : null;

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      const development = getDevelopmentIdentityOverrides(
        window.location.search,
        DEFAULT_OVERLAY_STREAMER,
        state.event.slug,
      );
      setChannelUsername(development.channelUsername);
      setWidgetEventSlug(development.eventSlug);
    }, 0);
    const handleWidgetLoad = (event: Event) => {
      const automaticUsername = extractStreamElementsChannelUsername(event);
      if (automaticUsername) setChannelUsername(automaticUsername);
    };
    window.addEventListener("onWidgetLoad", handleWidgetLoad);
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    const identityRefresh = window.setInterval(() => setIdentityTick((value) => value + 1), REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(clock);
      window.clearInterval(identityRefresh);
      window.removeEventListener("onWidgetLoad", handleWidgetLoad);
    };
  }, [state.event.slug]);

  useEffect(() => {
    let cancelled = false;
    void stateProvider.resolveCurrentStreamer(channelUsername, widgetEventSlug).then((resolution) => {
      if (cancelled) return;
      setIdentity(resolution);
      if (resolution.status === "resolved" && resolution.eventStatus === "active" && state.event.status !== "active") {
        void stateProvider.refresh();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [channelUsername, widgetEventSlug, identityRevision, identityTick, state.event.status]);

  useEffect(() => {
    if (state.boss.currentHp < previousHp.current) {
      const startTimer = window.setTimeout(() => setHit(true), 0);
      const endTimer = window.setTimeout(() => setHit(false), 500);
      previousHp.current = state.boss.currentHp;
      return () => {
        window.clearTimeout(startTimer);
        window.clearTimeout(endTimer);
      };
    }
    previousHp.current = state.boss.currentHp;
  }, [state.boss.currentHp]);

  useEffect(() => {
    const handleChat = (event: Event) => {
      if (!minion || minion.status !== "active" || displayMode !== "live" || now < minion.acceptsAnswersAt || now >= minion.expiresAt) return;
      const action = handleStreamElementsChatMessage(event, identity);
      if (!action.handled) return;
      void stateProvider.submitMinionAction({
        eventId: action.eventId,
        streamerId: action.streamerId,
        minionEventId: minion.instanceId,
        participantId: action.userId,
        messageId: action.messageId,
        text: action.text,
      });
    };
    window.addEventListener("onEventReceived", handleChat);
    return () => window.removeEventListener("onEventReceived", handleChat);
  }, [displayMode, identity, minion, now]);

  useEffect(() => {
    if (minion?.status === "active" && minion.expiresAt <= now) {
      void stateProvider.observeExpiredMinion(minion.instanceId);
    }
  }, [minion, now]);

  if ((runtime.mode === "supabase" && !runtime.lastSyncedAt && identity.status === "loading") || displayMode === "hidden") {
    return <main className="overlay-page" data-identity-status={identity.status} aria-label="Overlay ausgeblendet" />;
  }

  if (displayMode === "prelaunch") {
    return (
      <main className="overlay-page" data-identity-status={identity.status} data-streamer={identity.streamerSlug ?? ""}>
        <section className="overlay-prelaunch">
          <small>KÜRBISKÖNIG EVENT</small>
          <strong>Overlay erfolgreich verbunden</strong>
          <span>{identity.streamerDisplayName} · Event startet bald</span>
        </section>
      </main>
    );
  }

  const secondsLeft = minion ? Math.max(0, Math.ceil((minion.expiresAt - now) / 1_000)) : 0;
  const observing = Boolean(minion && minion.status === "active" && now < minion.acceptsAnswersAt);

  return (
    <main
      className={`overlay-page phase-${state.boss.phase}`}
      data-identity-status={identity.status}
      data-streamer={identity.streamerSlug ?? ""}
      data-streamer-id={resolvedStreamerId}
    >
      <section className={`overlay-widget${hit ? " is-hit" : ""}`}>
        <BossAvatar phase={state.boss.phase} hit={hit} compact />
        <BossHealth boss={state.boss} compact />
        {displayMode === "paused" && <p className="overlay-pause">Event pausiert · Fortsetzung erfolgt automatisch</p>}
      </section>

      {minion && <CurseLayer minion={minion} phase={state.boss.phase} />}

      {minion && (
        <section className={`minion-event minion-event--${minion.status}`} aria-live="assertive">
          {minion.status === "intro" && (
            <>
              <MinionArtwork minion={minion} />
              <div>
                <small>MINION-ALARM · {minion.streamerName}</small>
                <h2>{minion.introTitle}</h2>
              </div>
            </>
          )}

          {minion.status === "active" && <>
            <MinionArtwork minion={minion} />
            <div className="minion-copy">
              <small>{minion.gameMode} · {minion.damageClass}</small>
              <h2>{observing ? "Gut aufpassen …" : minion.gameplayTitle}</h2>
              <RuntimeVisual minion={minion} observing={observing} />
              {!observing && <><p className="minion-command">{minion.instruction}</p><p className="minion-progress">{minion.participantCount} / {minion.requiredParticipants} Teilnehmer</p></>}
            </div>
            {!observing && <time aria-label={`${secondsLeft} Sekunden verbleibend`}>{Math.floor(secondsLeft / 60).toString().padStart(2, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</time>}
          </>}

          {minion.status === "success" && (
            <>
              <MinionArtwork minion={minion} />
              <div>
                <small>MINION BESIEGT · {minion.streamerName}</small>
                <h2>{minion.name} besiegt!</h2>
                <p>Der Kürbiskönig erleidet <strong>{formatNumber(minion.damageAwarded)} Schaden!</strong></p>
              </div>
            </>
          )}

          {(minion.status === "failure" || minion.status === "expired") && (
            <>
              <MinionArtwork minion={minion} />
              <div>
                <small>MINION ENTKOMMEN · {minion.streamerName}</small>
                <h2>{minion.name} war zu stark</h2>
                <p>Fluch: <strong>{minion.failureCurseKey?.replaceAll("_", " ") ?? "kein Fluch"}</strong></p>
              </div>
            </>
          )}

          {minion.status === "curse" && <><MinionArtwork minion={minion} /><div className="minion-curse-label"><small>FLUCH AKTIV</small><strong>{minion.failureCurseKey?.replaceAll("_", " ")}</strong></div></>}
        </section>
      )}
    </main>
  );
}
