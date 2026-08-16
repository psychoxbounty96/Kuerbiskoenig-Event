"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { DAMAGE_PRESETS, getPhaseTargetHp, MINION_TYPES, PHASES } from "../lib/config";
import { formatLogTime, formatNumber, formatPercent } from "../lib/format";
import { stateProvider, useAdminSession, useEventData } from "../lib/state-provider";
import type { ActionResult, StreamerInput, StreamerState } from "../lib/types";
import { isOpenMinionStatus } from "../lib/minion-engine";

const ASSET_MANIFEST_URL = `${import.meta.env.BASE_URL}assets/widget-assets.json`;

function readNumber(value: FormDataEntryValue | null) {
  return Number(String(value ?? "").replace(/\./g, "").replace(",", "."));
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" }) : "–";
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} h`;
}

function StreamerEditor({
  streamer,
  disabled,
  onResult,
}: {
  streamer: StreamerState;
  disabled: boolean;
  onResult: (operation: Promise<ActionResult>) => void;
}) {
  const [editing, setEditing] = useState(false);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onResult(stateProvider.adminUpsertStreamer({
      slug: streamer.slug,
      displayName: String(form.get("displayName")),
      communityName: String(form.get("communityName")),
      twitchLogin: String(form.get("twitchLogin")),
      twitchUrl: String(form.get("twitchUrl")),
      avatarUrl: String(form.get("avatarUrl")) || null,
      enabled: streamer.enabled,
      isTestAccount: form.get("isTestAccount") === "on",
      trackingEnabled: form.get("trackingEnabled") === "on",
      gameplayEnabled: form.get("gameplayEnabled") === "on",
      publicVisible: form.get("publicVisible") === "on",
      includeInCalibration: form.get("includeInCalibration") === "on",
    }, streamer.id).then((result) => {
      if (result.ok) setEditing(false);
      return result;
    }));
  }

  if (editing) {
    return (
      <form className="streamer-edit-form" onSubmit={save}>
        <input name="displayName" defaultValue={streamer.displayName} aria-label="Anzeigename" required />
        <input name="communityName" defaultValue={streamer.communityName} aria-label="Community" />
        <input name="twitchLogin" defaultValue={streamer.twitchLogin} aria-label="Twitch Login" required />
        <input name="twitchUrl" defaultValue={streamer.twitchUrl} aria-label="Twitch URL" />
        <input name="avatarUrl" defaultValue={streamer.avatarUrl ?? ""} aria-label="Avatar URL" />
        <label className="check-row"><input name="isTestAccount" type="checkbox" defaultChecked={Boolean(streamer.isTestAccount)} /> Testkonto (nicht öffentlich auswerten)</label>
        <label className="check-row"><input name="trackingEnabled" type="checkbox" defaultChecked={streamer.trackingEnabled} /> Twitch-Tracking (Live, Viewer, Sessions)</label>
        <label className="check-row"><input name="gameplayEnabled" type="checkbox" defaultChecked={streamer.gameplayEnabled} /> Event-Gameplay und Widget erlauben</label>
        <label className="check-row"><input name="publicVisible" type="checkbox" defaultChecked={streamer.publicVisible} /> Öffentlich anzeigen</label>
        <label className="check-row"><input name="includeInCalibration" type="checkbox" defaultChecked={streamer.includeInCalibration} /> In Kalibrierung einbeziehen</label>
        <div className="inline-actions">
          <button type="submit" disabled={disabled}>Speichern</button>
          <button type="button" onClick={() => setEditing(false)}>Abbrechen</button>
        </div>
      </form>
    );
  }

  return (
    <article className={`streamer-row${streamer.enabled ? "" : " is-disabled"}`}>
      <div>
        <strong>{streamer.displayName}</strong>
        <small>{streamer.communityName} · @{streamer.twitchLogin}{streamer.isTestAccount ? " · TESTKONTO" : ""}</small>
        <small>Tracking {streamer.trackingEnabled ? "AN" : "AUS"} · Gameplay {streamer.gameplayEnabled ? "AN" : "AUS"} · Öffentlich {streamer.publicVisible ? "JA" : "NEIN"} · Kalibrierung {streamer.includeInCalibration ? "JA" : "NEIN"}</small>
      </div>
      <div className="inline-actions">
        <button type="button" disabled={disabled} onClick={() => setEditing(true)}>Bearbeiten</button>
        <button type="button" disabled={disabled} onClick={() => onResult(stateProvider.adminSetStreamerEnabled(streamer.id, !streamer.enabled))}>
          {streamer.enabled ? "Deaktivieren" : "Aktivieren"}
        </button>
      </div>
    </article>
  );
}

export default function AdminPage() {
  const { state, runtime } = useEventData();
  const session = useAdminSession();
  const [hpInput, setHpInput] = useState(String(state.boss.currentHp));
  const [selectedStreamer, setSelectedStreamer] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ActionResult | null>(null);
  const [now, setNow] = useState(0);
  const [assetHealth, setAssetHealth] = useState({ status: "loading", version: "–", loaded: 0, total: 0, detail: "Manifest wird geprüft …" });
  const enabledStreamers = useMemo(() => state.streamers.filter((streamer) => streamer.enabled && streamer.gameplayEnabled), [state.streamers]);
  const streamerId = selectedStreamer || enabledStreamers[0]?.id || "";
  const canMutate = session.authenticated && session.role !== "viewer" && !busy;
  const debugMinion = state.minions.find((minion) => minion.streamerId === streamerId && isOpenMinionStatus(minion.status));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function inspectAssets() {
      try {
        const response = await fetch(ASSET_MANIFEST_URL, { cache: "no-cache", signal: controller.signal });
        if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
        const manifest = await response.json() as { version?: number; boss?: { url?: string }; minions?: Record<string, { url?: string }> };
        const urls = [manifest.boss?.url, ...Object.values(manifest.minions ?? {}).map((asset) => asset.url)]
          .filter((url): url is string => Boolean(url));
        const checks = await Promise.all(urls.map(async (url) => {
          try {
            const asset = await fetch(url, { method: "HEAD", cache: "no-cache", signal: controller.signal });
            return asset.ok;
          } catch { return false; }
        }));
        const loaded = checks.filter(Boolean).length;
        setAssetHealth({
          status: loaded === urls.length && urls.length === 8 ? "healthy" : "warning",
          version: String(manifest.version ?? "–"), loaded, total: urls.length,
          detail: loaded === urls.length ? "Boss und sieben Minion-Artworks erreichbar." : `${urls.length - loaded} Asset(s) nicht erreichbar. Widget-Fallback bleibt aktiv.`,
        });
      } catch (error) {
        if (!controller.signal.aborted) setAssetHealth({ status: "error", version: "–", loaded: 0, total: 0, detail: error instanceof Error ? error.message : "Assetprüfung fehlgeschlagen" });
      }
    }
    void inspectAssets();
    return () => controller.abort();
  }, []);

  async function run(operation: Promise<ActionResult>) {
    setBusy(true);
    try {
      setFeedback(await operation);
    } finally {
      setBusy(false);
    }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(stateProvider.signIn(String(form.get("email")), String(form.get("password"))));
  }

  function submitHp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(stateProvider.adminSetBossHp(readNumber(new FormData(event.currentTarget).get("hp"))));
  }

  function submitDamage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = readNumber(new FormData(event.currentTarget).get("damage"));
    void run(stateProvider.adminApplyDamage(amount, { force, reason: "Custom Admin Damage" }));
  }

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(stateProvider.adminUpdateSettings({
      globalDamageMultiplier: Number(form.get("globalMultiplier")),
      passiveDamageMultiplier: Number(form.get("passiveMultiplier")),
      activeDamageMultiplier: Number(form.get("activeMultiplier")),
      passiveTickSeconds: Number(form.get("passiveTickSeconds")),
      twitchTrackingEnabled: form.get("twitchTrackingEnabled") === "on",
      passiveDamageEnabled: form.get("passiveDamageEnabled") === "on",
      passiveDamageMode: String(form.get("passiveDamageMode")) as typeof state.settings.passiveDamageMode,
      passiveBaseDamage: Number(form.get("passiveBaseDamage")),
      passiveCurveExponent: Number(form.get("passiveCurveExponent")),
      passiveSoftCap: Number(form.get("passiveSoftCap")),
      passiveMinDamage: Number(form.get("passiveMinDamage")),
      passiveMaxDamage: Number(form.get("passiveMaxDamage")),
      passiveUnderdogFactor: Number(form.get("passiveUnderdogFactor")),
    }));
  }

  function createStreamer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const input: StreamerInput = {
      displayName: String(form.get("displayName")),
      communityName: String(form.get("communityName")),
      twitchLogin: String(form.get("twitchLogin")),
      twitchUrl: String(form.get("twitchUrl")),
      avatarUrl: null,
      enabled: true,
      isTestAccount: form.get("isTestAccount") === "on",
      trackingEnabled: form.get("trackingEnabled") === "on",
      gameplayEnabled: form.get("gameplayEnabled") === "on",
      publicVisible: form.get("publicVisible") === "on",
      includeInCalibration: form.get("includeInCalibration") === "on",
    };
    void run(stateProvider.adminUpsertStreamer(input).then((result) => {
      if (result.ok) element.reset();
      return result;
    }));
  }

  function simulateRaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(stateProvider.adminSimulateRaid(
      String(form.get("fromStreamerId")),
      String(form.get("toStreamerId")),
      readNumber(form.get("viewerCount")),
    ));
  }

  function simulateChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!debugMinion) {
      setFeedback({ ok: false, message: "Für den gewählten Streamer läuft kein Minion." });
      return;
    }
    void run(stateProvider.submitMinionAction({
      eventId: state.event.id,
      streamerId,
      minionEventId: debugMinion.instanceId,
      participantId: String(form.get("userId")),
      messageId: `admin-sim-${crypto.randomUUID()}`,
      text: String(form.get("message")),
    }));
  }

  async function simulateFakeUsers(amount: number) {
    if (!debugMinion) return { ok: false, message: "Kein laufendes Minion." } as ActionResult;
    const defaultAnswer = debugMinion.gameMode === "PARTICIPATION"
      ? "!boss"
      : `!boss ${String(debugMinion.runtimeConfig.options && Array.isArray(debugMinion.runtimeConfig.options) ? debugMinion.runtimeConfig.options[0] : "a")}`;
    const results = [];
    for (let index = 0; index < amount; index += 1) {
      results.push(await stateProvider.submitMinionAction({
        eventId: state.event.id,
        streamerId,
        minionEventId: debugMinion.instanceId,
        participantId: `fake-user-${Date.now()}-${index}`,
        messageId: `fake-message-${crypto.randomUUID()}`,
        text: defaultAnswer,
      }));
    }
    const accepted = results.filter((result) => result.ok).length;
    return { ok: accepted > 0, message: `${accepted}/${amount} Fake-Chataktionen verarbeitet.` };
  }

  if (runtime.mode === "supabase" && session.loading && !session.authenticated) {
    return (
      <main className="admin-page admin-login-page">
        <section className="admin-panel admin-login-panel" aria-live="polite">
          <p className="overline">SUPABASE AUTH · GESCHÜTZTER BEREICH</p>
          <h1>Admin-Sitzung wird geprüft …</h1>
          <p>Eine vorhandene Anmeldung wird sicher wiederhergestellt.</p>
        </section>
      </main>
    );
  }

  if (runtime.mode === "supabase" && !session.authenticated) {
    return (
      <main className="admin-page admin-login-page">
        <section className="admin-panel admin-login-panel">
          <p className="overline">SUPABASE AUTH · GESCHÜTZTER BEREICH</p>
          <h1>Eventsteuerung</h1>
          <p>Melde dich mit einem Konto an, das in <code>event_admins</code> für dieses Event freigeschaltet ist.</p>
          <form className="admin-login-form" onSubmit={login}>
            <label htmlFor="admin-email">E-Mail</label>
            <input id="admin-email" name="email" type="email" autoComplete="username" required />
            <label htmlFor="admin-password">Passwort</label>
            <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
            <button type="submit" disabled={session.loading || busy}>Anmelden</button>
          </form>
          {(session.error || feedback) && <p className="admin-feedback is-error">{session.error || feedback?.message}</p>}
          <a className="text-link" href="../">← Zur öffentlichen Seite</a>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="overline">{state.event.isTest ? "TEST-EVENT" : "PRODUKTIONS-EVENT"} · {runtime.mode.toUpperCase()}</p>
          <h1>Eventsteuerung</h1>
          <p>{state.event.name} · Rolle: {session.role ?? "–"}</p>
        </div>
        <div className="admin-links">
          <a href="/" target="_blank" rel="noreferrer">Website öffnen ↗</a>
          <a href={`/overlay?streamer=${enabledStreamers[0]?.slug ?? ""}`} target="_blank" rel="noreferrer">Overlay öffnen ↗</a>
          {runtime.mode === "supabase" && <button type="button" onClick={() => void run(stateProvider.signOut())}>Abmelden</button>}
        </div>
      </header>

      <section className="admin-statusbar">
        <span className={state.event.active ? "is-live" : ""}><i /> Eventstatus: {state.event.status}</span>
        <span>Phase {state.boss.phase} · {state.boss.phaseName}</span>
        <span>Provider: {runtime.mode} · Realtime: {runtime.realtime}</span>
        {state.event.isTest && <span className="test-badge">Keine Produktionsdaten</span>}
      </section>

      {feedback && <p className={`admin-feedback${feedback.ok ? " is-success" : " is-error"}`}>{feedback.message}</p>}
      {runtime.error && <p className="admin-feedback is-error">{runtime.error}</p>}

      <div className="admin-grid">
        <section className="admin-panel admin-panel--wide">
          <div className="panel-heading">
            <div><small>BOSS-STEUERUNG</small><h2>{state.boss.name}</h2></div>
            <strong className="admin-hp-percent">{formatPercent(state.boss.currentHp, state.boss.maxHp)} %</strong>
          </div>
          <div className="admin-hp-readout"><strong>{formatNumber(state.boss.currentHp)}</strong><span>/ {formatNumber(state.boss.maxHp)} HP</span></div>

          <div className="admin-action-block">
            <span>SCHADEN ANWENDEN</span>
            <div className="button-grid">
              {DAMAGE_PRESETS.map((amount) => (
                <button key={amount} type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminApplyDamage(amount, { force }))}>
                  −{formatNumber(amount)} HP
                </button>
              ))}
            </div>
            <label className="check-row"><input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} /> Safety-Kill-Switch bewusst übersteuern</label>
          </div>

          <form className="admin-form" onSubmit={submitDamage}>
            <label htmlFor="custom-damage">Custom Damage</label>
            <div><input id="custom-damage" name="damage" inputMode="numeric" placeholder="z. B. 2500" /><button type="submit" disabled={!canMutate}>Anwenden</button></div>
          </form>

          <form className="admin-form" onSubmit={submitHp}>
            <label htmlFor="set-hp">HP direkt setzen</label>
            <div><input id="set-hp" name="hp" inputMode="numeric" value={hpInput} onChange={(event) => setHpInput(event.target.value)} /><button type="submit" disabled={!canMutate}>Set HP</button></div>
          </form>

          <div className="admin-action-row">
            <label htmlFor="phase-select">Phasengrenze testen</label>
            <select id="phase-select" value={state.boss.phase} disabled={!canMutate} onChange={(event) => void run(stateProvider.adminSetBossHp(getPhaseTargetHp(Number(event.target.value) as 1 | 2 | 3 | 4, state.boss.maxHp)))}>
              {PHASES.map((phase) => <option key={phase.id} value={phase.id}>Phase {phase.roman} – {phase.name}</option>)}
            </select>
          </div>

          <div className="admin-danger-row">
            <button type="button" disabled={!canMutate || session.role !== "owner"} onClick={() => {
              if (window.confirm("Boss und Meilensteine vollständig zurücksetzen? Aktive Minions werden abgebrochen.")) void run(stateProvider.adminResetBoss());
            }}>Reset Boss</button>
            <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminUpdateSettings({ eventPaused: !state.settings.eventPaused }))}>
              Event {state.settings.eventPaused ? "fortsetzen" : "pausieren"}
            </button>
          </div>

          <div className="admin-action-row">
            <span>Zentrale Eventfreigabe</span>
            <div className="inline-actions">
              <button type="button" disabled={!canMutate || state.event.status === "draft"} onClick={() => void run(stateProvider.adminSetEventStatus("draft"))}>Vorbereitung</button>
              <button type="button" disabled={!canMutate || state.event.status === "testing"} onClick={() => void run(stateProvider.adminSetEventStatus("testing"))}>Testbetrieb</button>
              <button type="button" className="button-primary" disabled={!canMutate || state.event.status === "active"} onClick={() => void run(stateProvider.adminSetEventStatus("active"))}>Event aktivieren</button>
            </div>
          </div>
        </section>

        <section className="admin-panel">
          <div className="panel-heading"><div><small>KILL-SWITCHES & MULTIPLIKATOREN</small><h2>Event-Engine</h2></div></div>
          <div className="toggle-grid">
            <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminUpdateSettings({ damageEnabled: !state.settings.damageEnabled }))}>Damage: {state.settings.damageEnabled ? "AN" : "AUS"}</button>
            <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminUpdateSettings({ minionsEnabled: !state.settings.minionsEnabled }))}>Minions: {state.settings.minionsEnabled ? "AN" : "AUS"}</button>
            <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminUpdateSettings({ twitchTrackingEnabled: !state.settings.twitchTrackingEnabled }))}>Twitch-Tracking: {state.settings.twitchTrackingEnabled ? "AN" : "AUS"}</button>
          </div>
          <form className="settings-form" onSubmit={submitSettings}>
            <label>Global<input name="globalMultiplier" type="number" min="0" max="100" step="0.01" defaultValue={state.settings.globalDamageMultiplier} /></label>
            <label>Aktiv<input name="activeMultiplier" type="number" min="0" max="100" step="0.01" defaultValue={state.settings.activeDamageMultiplier} /></label>
            <label>Passiv<input name="passiveMultiplier" type="number" min="0" max="100" step="0.01" defaultValue={state.settings.passiveDamageMultiplier} /></label>
            <label>Tick (Sek.)<input name="passiveTickSeconds" type="number" min="10" max="86400" defaultValue={state.settings.passiveTickSeconds} /></label>
            <label>Passiv-Modus<select name="passiveDamageMode" defaultValue={state.settings.passiveDamageMode}><option value="disabled">Deaktiviert</option><option value="dry_run">Dry Run</option><option value="test">Testevent</option><option value="active">Produktion aktiv</option></select></label>
            <label>Basis<input name="passiveBaseDamage" type="number" min="0" max="1000000" step="0.01" defaultValue={state.settings.passiveBaseDamage} /></label>
            <label>Kurve<input name="passiveCurveExponent" type="number" min="0.1" max="2" step="0.01" defaultValue={state.settings.passiveCurveExponent} /></label>
            <label>Soft Cap<input name="passiveSoftCap" type="number" min="1" max="1000000" step="1" defaultValue={state.settings.passiveSoftCap} /></label>
            <label>Min. Damage<input name="passiveMinDamage" type="number" min="0" step="1" defaultValue={state.settings.passiveMinDamage} /></label>
            <label>Max. Damage<input name="passiveMaxDamage" type="number" min="0" step="1" defaultValue={state.settings.passiveMaxDamage} /></label>
            <label>Underdog<input name="passiveUnderdogFactor" type="number" min="0" max="5" step="0.01" defaultValue={state.settings.passiveUnderdogFactor} /></label>
            <label className="check-row"><input name="twitchTrackingEnabled" type="checkbox" defaultChecked={state.settings.twitchTrackingEnabled} /> Twitch-Tracking global</label>
            <label className="check-row"><input name="passiveDamageEnabled" type="checkbox" defaultChecked={state.settings.passiveDamageEnabled} /> Passive Engine freigeben</label>
            <button type="submit" disabled={!canMutate}>Einstellungen speichern</button>
          </form>
          <p className="admin-hint">Balancingwerte sind vorläufig. „Dry Run“ schreibt ausschließlich Vorschauen. „Testevent“ kann nur Testkonten in einem Event mit Status testing beschädigen. Produktion bleibt bis zur bewussten Freigabe deaktiviert.</p>
        </section>

        <section className="admin-panel admin-panel--full minion-debugger">
          <div className="panel-heading"><div><small>MINION ENGINE v0.4 · DEBUG / ADMIN</small><h2>Minion Debugger</h2></div><span>pro Streamer unabhängig</span></div>
          <div className="minion-spawn-form">
            <select value={streamerId} onChange={(event) => setSelectedStreamer(event.target.value)} aria-label="Streamer auswählen">
              {enabledStreamers.map((streamer) => <option key={streamer.id} value={streamer.id}>{streamer.displayName}</option>)}
            </select>
            <div className="minion-spawn-buttons">
              {Object.values(MINION_TYPES).map((definition) => <button key={definition.id} type="button" disabled={!canMutate || !streamerId} onClick={() => void run(stateProvider.adminSpawnMinion(definition.id, streamerId, { force: true }))}>
                {definition.icon} {definition.name}
              </button>)}
            </div>
          </div>
          <div className="active-minions">
            {state.minions.filter((minion) => isOpenMinionStatus(minion.status)).length === 0 && <p className="admin-hint">Keine laufenden oder geplanten Minions.</p>}
            {state.minions.filter((minion) => isOpenMinionStatus(minion.status)).map((minion) => (
              <article key={minion.instanceId}>
                <div>
                  <strong>{minion.icon} {minion.name} · {minion.streamerName}</strong>
                  <small>{minion.status} · Viewer {minion.viewerEstimate} · Ziel {minion.requiredParticipants} · Ist {minion.participantCount} · {minion.damageClass} · {minion.failureCurseKey}</small>
                  <small>Timer: {Math.max(0, Math.ceil((minion.expiresAt - now) / 1_000))} Sek. · Trigger {minion.triggerSource}</small>
                </div>
                <div className="inline-actions">
                  <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminResolveMinion(minion.instanceId, "success"))}>Erfolg</button>
                  <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminResolveMinion(minion.instanceId, "failed"))}>Fehlversuch</button>
                  <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminResolveMinion(minion.instanceId, "cancelled"))}>Abbruch</button>
                  <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminResolveMinion(minion.instanceId, "expired"))}>Expire</button>
                </div>
              </article>
            ))}
          </div>
          <form className="chat-simulator" onSubmit={simulateChat}>
            <div><small>LOKALER CHAT-SIMULATOR</small><h3>StreamElements Message testen</h3></div>
            <label>User ID<input name="userId" defaultValue="test-user-1" required /></label>
            <label>Name<input name="displayName" defaultValue="TestUser" /></label>
            <label>Message<input name="message" defaultValue="!boss" required /></label>
            <button type="submit" disabled={!canMutate || !debugMinion}>Senden</button>
            <button type="button" disabled={!canMutate || !debugMinion} onClick={() => void run(simulateFakeUsers(5))}>+5 Fake-User</button>
            <button type="button" disabled={!canMutate || !debugMinion} onClick={() => void run(simulateFakeUsers(10))}>+10 Fake-User</button>
          </form>
          <p className="admin-hint">Debugaktionen nutzen dieselbe State Machine. Der Client übermittelt niemals einen Schadenswert; Erfolg wird serverseitig aus der Damage Class berechnet.</p>
        </section>

        <section className="admin-panel admin-panel--full twitch-admin-panel" id="twitch-status">
          <div className="panel-heading">
            <div><small>TWITCH AWARENESS v0.3</small><h2>Twitch Status</h2></div>
            <span className={`twitch-health twitch-health--${state.twitch.health.status}`}>{state.twitch.health.status}</span>
          </div>
          <p className="admin-hint">{state.twitch.health.reason} Viewer-Samples sind die messbare Grundlage für Kalibrierung; Raids verursachen weiterhin keinen direkten Schaden.</p>
          <div className="twitch-global-actions">
            <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminResolveTwitchIds())}>Resolve All IDs</button>
            <button type="button" disabled={!canMutate || !state.settings.twitchTrackingEnabled} onClick={() => void run(stateProvider.adminSyncTwitchStreams())}>Sync All Streams</button>
            <button type="button" disabled={!canMutate || session.role === "operator"} onClick={() => void run(stateProvider.adminSyncEventSubSubscriptions())}>Sync EventSub Subscriptions</button>
          </div>
          <div className="twitch-health-grid">
            <article><small>Webhook</small><strong>{state.twitch.health.webhookConfigured ? "configured" : "not configured"}</strong><span>Zuletzt: {formatDateTime(state.twitch.health.lastWebhookAt)}</span></article>
            <article><small>Stream Sync</small><strong>{formatDateTime(state.twitch.health.lastSyncAt)}</strong><span>Erfolg: {formatDateTime(state.twitch.health.lastSuccessAt)}</span></article>
            <article><small>stream.online / offline</small><strong>{state.twitch.subscriptions.online} / {state.twitch.subscriptions.offline}</strong><span>{state.twitch.subscriptions.pending} pending</span></article>
            <article><small>channel.raid</small><strong>{state.twitch.subscriptions.raid}</strong><span>{state.twitch.subscriptions.revokedOrError} revoked / error</span></article>
          </div>

          <div className="twitch-streamer-list" role="list" aria-label="Twitch-Status pro Streamer">
            {state.streamers.map((streamer) => (
              <article key={streamer.id} className={!streamer.enabled ? "is-disabled" : ""} role="listitem">
                <div className="twitch-streamer-heading">
                  <span className={streamer.live ? "twitch-live-dot is-live" : "twitch-live-dot"} aria-hidden="true" />
                  <div><strong>{streamer.displayName}</strong><small>{streamer.twitchLogin || "Kein Login"} · ID {streamer.twitchUserId ?? "nicht aufgelöst"}</small></div>
                  <em>{streamer.live ? `LIVE · ${formatNumber(streamer.currentViewerCount)} Zuschauer` : "Offline"}</em>
                </div>
                <dl>
                  <div><dt>Live since</dt><dd>{formatDateTime(streamer.liveSince)}</dd></div>
                  <div><dt>Last sync</dt><dd>{formatDateTime(streamer.lastTwitchSyncAt)}</dd></div>
                  <div><dt>Stream ID</dt><dd>{streamer.currentStreamId ?? "–"}</dd></div>
                </dl>
                {streamer.latestSession ? (
                  <p className="twitch-session-summary">
                    Laufzeit {formatDuration(streamer.latestSession.durationSeconds)} · Latest {formatNumber(streamer.latestSession.latestViewers)} ·
                    Ø {streamer.latestSession.averageViewers.toLocaleString("de-DE")} · Peak {formatNumber(streamer.latestSession.peakViewers)} ·
                    Samples {formatNumber(streamer.latestSession.sampleCount)}
                  </p>
                ) : <p className="admin-hint">Noch keine Stream-Session vorhanden.</p>}
                <div className="inline-actions">
                  <button type="button" disabled={!canMutate} onClick={() => void run(stateProvider.adminResolveTwitchIds(streamer.id))}>Resolve Twitch ID</button>
                  <button type="button" disabled={!canMutate || !streamer.enabled || !streamer.trackingEnabled || !streamer.twitchUserId} onClick={() => void run(stateProvider.adminSyncTwitchStreams(streamer.id))}>Sync Now</button>
                </div>
              </article>
            ))}
          </div>

          <form className="raid-simulator" onSubmit={simulateRaid}>
            <div><small>TECHNISCHER TEST</small><h3>Simulate Raid</h3></div>
            <label>From<select name="fromStreamerId" defaultValue={enabledStreamers[0]?.id}>{enabledStreamers.map((streamer) => <option key={streamer.id} value={streamer.id}>{streamer.displayName}</option>)}</select></label>
            <label>To<select name="toStreamerId" defaultValue={enabledStreamers[1]?.id ?? enabledStreamers[0]?.id}>{enabledStreamers.map((streamer) => <option key={streamer.id} value={streamer.id}>{streamer.displayName}</option>)}</select></label>
            <label>Viewers<input name="viewerCount" type="number" min="0" step="1" defaultValue="25" required /></label>
            <button type="submit" disabled={!canMutate || enabledStreamers.length < 2}>Testevent speichern</button>
          </form>
          {state.twitch.recentRaids.length > 0 && (
            <ol className="raid-event-list">
              {state.twitch.recentRaids.map((raid) => {
                const from = state.streamers.find((streamer) => streamer.id === raid.fromStreamerId)?.displayName ?? raid.fromTwitchUserId;
                const to = state.streamers.find((streamer) => streamer.id === raid.toStreamerId)?.displayName ?? raid.toTwitchUserId;
                return <li key={raid.id}><time>{formatDateTime(raid.occurredAt)}</time><strong>{from} → {to}</strong><span>{raid.viewerCount} Viewer · {raid.eligible ? "eligible" : "external"} · {raid.source}</span></li>;
              })}
            </ol>
          )}
        </section>

        <section className="admin-panel admin-panel--full" id="passive-damage">
          <div className="panel-heading"><div><small>PASSIVE DAMAGE · KALIBRIERUNG</small><h2>Viewer-Ticks & Betriebsstatus</h2></div><span>Config v{state.settings.passiveConfigurationVersion}</span></div>
          <div className="twitch-global-actions">
            <button type="button" disabled={!canMutate || !state.settings.passiveDamageEnabled || state.settings.passiveDamageMode === "disabled"} onClick={() => void run(stateProvider.adminRunPassiveTick())}>Passiven Tick jetzt ausführen</button>
          </div>
          <div className="twitch-health-grid">
            <article><small>Modus</small><strong>{state.settings.passiveDamageMode}</strong><span>{state.settings.passiveDamageEnabled ? "Engine freigegeben" : "Kill-Switch aus"}</span></article>
            <article><small>Letzter Tick</small><strong>{state.passiveDamage.status}</strong><span>{formatDateTime(state.passiveDamage.processedAt)}</span></article>
            <article><small>Viewer / Samples</small><strong>{state.passiveDamage.viewerEstimate ?? "–"} / {state.passiveDamage.sampleCount}</strong><span>{state.passiveDamage.skipReason ?? "kein Fehler"}</span></article>
            <article><small>Vorschau / angewandt</small><strong>{formatNumber(state.passiveDamage.configuredDamage)} / {formatNumber(state.passiveDamage.appliedDamage)}</strong><span>serverseitig berechnet</span></article>
          </div>
          <div className="twitch-health-grid">
            <article><small>Kalibrierung</small><strong>{state.calibration.includedStreamers} Streamer · {state.calibration.totalSamples} Samples</strong><span>Dry Run/h {formatNumber(state.calibration.projectedPassiveDamagePerHour)} · Max. gleichzeitig {state.calibration.maxConcurrentStreamers}</span></article>
            <article><small>Minion-Bilanz</small><strong>{state.calibration.minionsDefeated} / {state.calibration.minionsSpawned} besiegt</strong><span>{state.calibration.minionsFailed} fehlgeschlagen</span></article>
            {state.jobs.map((job) => <article key={job.key}><small>{job.key}</small><strong>{job.status}</strong><span>Erfolg: {formatDateTime(job.lastSuccessAt)}{job.lastError ? ` · ${job.lastError}` : ""}</span></article>)}
          </div>
          <div className="twitch-streamer-list" role="list" aria-label="Kalibrierungsdaten pro Streamer">
            {state.calibration.streamers.map((entry) => <article key={entry.streamerId} className={!entry.included || entry.isTestAccount ? "is-disabled" : ""} role="listitem">
              <div className="twitch-streamer-heading"><div><strong>{entry.displayName}</strong><small>{entry.isTestAccount ? "Testkonto" : entry.included ? "Kalibrierung aktiv" : "Kalibrierung ausgeschlossen"}</small></div><em>{entry.sampleCount} Samples</em></div>
              <p className="twitch-session-summary">Ø {entry.averageViewers.toLocaleString("de-DE")} · Median {entry.medianViewers.toLocaleString("de-DE")} · Peak {formatNumber(entry.peakViewers)} · Streams {entry.streams} ({entry.streamsPerWeek.toLocaleString("de-DE")} / Woche) · Live {formatDuration(entry.totalLiveSeconds)} · Dry Run {formatNumber(entry.dryRunDamage)} ({formatNumber(entry.passiveDamagePerHour)} / h) · Passiv {formatNumber(entry.appliedPassiveDamage)} · Minions {entry.minionsDefeated}/{entry.minionsSpawned}</p>
            </article>)}
          </div>
          <p className="admin-hint">Nur explizit eingeschlossene echte Twitch-Samples fließen in die Kalibrierung. Testkonten und manual_test-Samples bleiben ausgeschlossen.</p>
        </section>

        <section className="admin-panel admin-panel--full" id="widget-assets">
          <div className="panel-heading"><div><small>ASSETS & WIDGET</small><h2>Live-Asset-Diagnose</h2></div><span className={`twitch-health twitch-health--${assetHealth.status}`}>{assetHealth.status}</span></div>
          <div className="twitch-health-grid">
            <article><small>Widget Build</small><strong>v0.5.0</strong><span>Standalone HTML / CSS / JS / Fields</span></article>
            <article><small>Asset-Manifest</small><strong>v{assetHealth.version}</strong><span>{ASSET_MANIFEST_URL}</span></article>
            <article><small>HTTPS Assets</small><strong>{assetHealth.loaded} / {assetHealth.total}</strong><span>{assetHealth.detail}</span></article>
          </div>
          <p className="admin-hint">Die Runtime lädt ausschließlich stabile HTTPS-URLs. Bei einem Ladefehler bleibt das Overlay aktiv und fällt auf statisches Artwork oder Symbol-UI zurück.</p>
        </section>

        <section className="admin-panel admin-panel--full">
          <div className="panel-heading"><div><small>STREAMER-VERWALTUNG</small><h2>Teilnehmende Kanäle</h2></div><span>{state.streamers.length} Einträge</span></div>
          <div className="streamer-list">
            {state.streamers.map((streamer) => <StreamerEditor key={streamer.id} streamer={streamer} disabled={!canMutate} onResult={(operation) => void run(operation)} />)}
          </div>
          <form className="streamer-create-form" onSubmit={createStreamer}>
            <h3>Streamer hinzufügen</h3>
            <input name="displayName" placeholder="Anzeigename" required />
            <input name="communityName" placeholder="Community (optional)" />
            <input name="twitchLogin" placeholder="Twitch Login" required />
            <input name="twitchUrl" type="url" placeholder="https://twitch.tv/..." />
            <label className="check-row"><input name="isTestAccount" type="checkbox" /> Als Testkonto markieren</label>
            <label className="check-row"><input name="trackingEnabled" type="checkbox" defaultChecked /> Twitch-Tracking aktivieren</label>
            <label className="check-row"><input name="gameplayEnabled" type="checkbox" defaultChecked /> Gameplay/Widget aktivieren</label>
            <label className="check-row"><input name="publicVisible" type="checkbox" defaultChecked /> Öffentlich anzeigen</label>
            <label className="check-row"><input name="includeInCalibration" type="checkbox" defaultChecked /> In Kalibrierung aufnehmen</label>
            <button type="submit" disabled={!canMutate}>Hinzufügen</button>
          </form>
        </section>

        <section className="admin-panel admin-log-panel admin-panel--full">
          <div className="panel-heading"><div><small>AUDIT-VORSCHAU</small><h2>Letzte Aktionen</h2></div><span>{state.log.length} Einträge</span></div>
          <ol className="event-log">
            {state.log.map((entry) => <li key={entry.id}><time>{formatLogTime(entry.timestamp)}</time><i data-type={entry.type} /><span>{entry.message}</span></li>)}
          </ol>
        </section>
      </div>
    </main>
  );
}
