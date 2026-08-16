// Values between __...__ are replaced by `npm run build:widget`.
const WIDGET_CONFIG = Object.freeze({
  supabaseUrl: "https://xydyeibmbxoaeyxocyoa.supabase.co",
  publishableKey: "sb_publishable_QRpIf8Mog4awVvcQsFQI0Q_RuOMqNhj",
  eventSlug: "halloween-2026-test",
  assetBase: "https://psychoxbounty96.github.io/Kuerbiskoenig-Event/assets/minions",
  bossAsset: "https://psychoxbounty96.github.io/Kuerbiskoenig-Event/assets/boss/pumpkin-king.png",
  assetManifest: "https://psychoxbounty96.github.io/Kuerbiskoenig-Event/assets/widget-assets.json",
  buildVersion: "0.5.0",
  testControls: "true" === "true",
});

const FALLBACK_REFRESH_MS = 5_000;
const ACTIVE_TEST_TICK_MS = 2_000;
const IDLE_TEST_TICK_MS = 10_000;
const MINION_ARTWORK_FOLDERS = Object.freeze({
  ghost: "ghost",
  zombie_horde: "zombie",
  spider_queen: "spider",
  witch: "witch",
  bat_swarm: "bats",
  reaper: "reaper",
  kings_herald: "herald",
});
const BUTTON_ACTIONS = Object.freeze({
  testReloadState: "reload_state",
  testRunTick: "tick",
  testViewerSample: "create_test_viewer_sample",
  testPassiveTick: "test_passive_tick",
  testBossHit: "test_boss_hit",
  testBossBigHit: "test_boss_big_hit",
  testResetBoss: "reset_test_boss",
  testPhase1: "set_phase_1",
  testPhase2: "set_phase_2",
  testPhase3: "set_phase_3",
  testPhase4: "set_phase_4",
  testSpawnGhost: "spawn_ghost",
  testSpawnZombie: "spawn_zombie_horde",
  testSpawnSpider: "spawn_spider_queen",
  testSpawnWitch: "spawn_witch",
  testSpawnBats: "spawn_bat_swarm",
  testSpawnReaper: "spawn_reaper",
  testSpawnHerald: "spawn_kings_herald",
  testForceSuccess: "force_minion_success",
  testForceFailure: "force_minion_failure",
  testCancelMinion: "cancel_minion",
  testExpireMinion: "expire_minion",
  testRaid: "simulate_eligible_raid",
  testHeraldNow: "spawn_herald_now",
  testFog: "test_fog",
  testZombieHands: "test_zombie_hands",
  testSpiderWeb: "test_spider_web",
  testWitchDistortion: "test_witch_distortion",
  testBatAttack: "test_bat_attack",
  testDarkness: "test_darkness",
  testRoyalCurse: "test_royal_curse",
});

const IDENTITY_STATUSES = new Set(["resolved", "not_registered", "disabled", "event_unavailable", "error"]);
const OPEN_MINION_STATUSES = new Set(["intro", "active", "success", "failure", "curse"]);
let identity = createIdentity("loading");
let channelUsername = "";
let fieldData = {};
let lastSafeState = null;
let lastSyncAt = null;
let lastTestTickAt = 0;
let refreshTimer = null;
let clockTimer = null;
let testTickTimer = null;
let realtimeChannel = null;
let supabaseClient = null;
let refreshInFlight = false;
let refreshQueued = false;
let editorMode = false;
let realtimeStatus = "disconnected";
let supabaseStatus = "disconnected";
let localCurse = null;
let localCurseTimer = null;
let lastTestMessage = "";
let renderedMinionSignature = "";
let assetManifest = null;
let animationFrame = null;
let previousBossHp = null;
let previousBossPhase = null;
let bossTransitionTimer = null;
const actorStates = new Map();

function normalizeTwitchLogin(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function createIdentity(status, payload = {}) {
  return {
    status,
    channelUsername: payload.channel_username || null,
    eventId: payload.event_id || null,
    eventSlug: payload.event_slug || WIDGET_CONFIG.eventSlug,
    eventStatus: payload.event_status || null,
    streamerId: payload.streamer_id || null,
    streamerSlug: payload.streamer_slug || null,
    streamerDisplayName: payload.streamer_display_name || null,
    isTestAccount: Boolean(payload.is_test_account),
    testActionsAuthorized: Boolean(payload.test_actions_authorized),
  };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function milliseconds(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDebug(message, detail) {
  if (typeof console !== "undefined" && typeof console.debug === "function") {
    console.debug(`[Kürbiskönig] ${message}`, detail || "");
  }
}

function validAsset(asset) {
  if (!asset || !["static", "spritesheet", "css"].includes(asset.type)) return false;
  if (asset.type === "css") return true;
  if (typeof asset.url !== "string" || !asset.url.startsWith("https://")) return false;
  if (asset.type === "static") return true;
  const columns = Math.floor(number(asset.columns));
  const rows = Math.floor(number(asset.rows));
  const frameCount = Math.floor(number(asset.frameCount || columns * rows));
  return columns > 0 && rows > 0 && frameCount > 0;
}

async function loadAssetManifest() {
  try {
    const response = await fetch(WIDGET_CONFIG.assetManifest, { cache: "no-cache" });
    if (!response.ok) throw new Error(`asset_manifest_${response.status}`);
    const payload = await response.json();
    if (!payload || number(payload.version) < 1 || !validAsset(payload.boss)) throw new Error("asset_manifest_invalid");
    assetManifest = payload;
    const urls = [payload.boss, ...Object.values(payload.minions || {}), ...Object.values(payload.curses || {})]
      .flatMap((asset) => [asset?.url, asset?.fallbackUrl])
      .filter((url) => typeof url === "string" && url.startsWith("https://"));
    for (const url of new Set(urls)) {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    }
    safeDebug("Asset-Manifest geladen", { version: payload.version });
  } catch (error) {
    assetManifest = null;
    safeDebug("Asset-Manifest nicht verfügbar; HTTPS-Fallbacks bleiben aktiv.", error instanceof Error ? error.message : "unknown");
  }
}

function fallbackMinionAsset(key) {
  const folder = MINION_ARTWORK_FOLDERS[key];
  return folder ? `${WIDGET_CONFIG.assetBase}/${folder}/placeholder.jpg` : null;
}

function actorAsset(kind, key) {
  if (kind === "boss") {
    const boss = assetManifest?.boss;
    const resolved = boss ? { ...boss, clips: boss.clips || assetManifest?.clipProfiles?.[boss.profile] } : null;
    return validAsset(resolved) ? resolved : { type: "static", url: WIDGET_CONFIG.bossAsset };
  }
  const candidate = kind === "minion" ? assetManifest?.minions?.[key] : assetManifest?.curses?.[key];
  const resolved = candidate ? { ...candidate, clips: candidate.clips || assetManifest?.clipProfiles?.[candidate.profile] } : null;
  if (validAsset(resolved)) return resolved;
  if (kind === "minion") return { type: "static", url: fallbackMinionAsset(key) };
  return { type: "css" };
}

function actorFrame(asset, clipName, elapsedMs) {
  const columns = Math.max(1, Math.floor(number(asset.columns || 1)));
  const rows = Math.max(1, Math.floor(number(asset.rows || 1)));
  const totalFrames = Math.max(1, Math.floor(number(asset.frameCount || columns * rows)));
  const clip = asset.clips?.[clipName] || asset.clips?.idle || { startFrame: 0, frameCount: totalFrames, fps: 8, loop: true };
  const start = Math.min(totalFrames - 1, Math.max(0, Math.floor(number(clip.startFrame))));
  const count = Math.min(totalFrames - start, Math.max(1, Math.floor(number(clip.frameCount || 1))));
  const frameDuration = 1_000 / Math.min(60, Math.max(1, number(clip.fps || 8)));
  const rawOffset = fieldData.reducedMotion ? 0 : Math.floor(Math.max(0, elapsedMs) / frameDuration);
  const complete = !clip.loop && rawOffset >= count;
  const offset = clip.loop ? rawOffset % count : Math.min(count - 1, rawOffset);
  const frame = start + offset;
  return { column: frame % columns, row: Math.floor(frame / columns), columns, rows, complete, next: complete ? clip.next : null };
}

function showActorFallback(root, symbol) {
  if (!root) return;
  root.dataset.actorState = "fallback";
  const fallback = root.querySelector(".sprite-actor__fallback");
  if (fallback) fallback.textContent = symbol || "";
}

function setActor(id, kind, key, clipName, symbol) {
  const root = document.getElementById(id);
  if (!root) return;
  const asset = actorAsset(kind, key);
  const signature = `${kind}:${key}:${asset.type}:${asset.url || "css"}`;
  const previous = actorStates.get(id);
  const requestedClip = clipName || "idle";
  const next = previous?.signature === signature ? previous : {
    root, asset, signature, clip: requestedClip, startedAt: performance.now(), symbol: symbol || "", ready: false, loading: false,
  };
  next.root = root;
  next.asset = asset;
  next.symbol = symbol || "";
  if (next.clip !== requestedClip) {
    next.clip = requestedClip;
    next.startedAt = performance.now();
  }
  actorStates.set(id, next);
  root.dataset.actorKey = key || "none";
  root.dataset.actorClip = next.clip;
  root.style.setProperty("--actor-scale", String(Math.max(0.1, Math.min(4, number(asset.scale || 1)))));
  root.style.setProperty("--actor-anchor-x", `${Math.min(100, number(asset.anchor?.x ?? 50))}%`);
  root.style.setProperty("--actor-anchor-y", `${Math.min(100, number(asset.anchor?.y ?? 50))}%`);
  const image = root.querySelector(".sprite-actor__image");
  const sheet = root.querySelector(".sprite-actor__sheet");
  if (asset.type === "css") {
    root.dataset.actorState = "css";
    return;
  }
  if (!asset.url) {
    showActorFallback(root, symbol);
    return;
  }
  if (asset.type === "static") {
    if (sheet) sheet.hidden = true;
    if (image) {
      image.hidden = false;
      if (image.dataset.src !== asset.url) {
        root.dataset.actorState = "loading";
        image.dataset.src = asset.url;
        image.onload = () => { next.ready = true; root.dataset.actorState = "ready"; };
        image.onerror = () => {
          if (asset.fallbackUrl && image.dataset.src !== asset.fallbackUrl) {
            image.dataset.src = asset.fallbackUrl;
            image.src = asset.fallbackUrl;
            return;
          }
          image.hidden = true;
          showActorFallback(root, symbol);
        };
        image.src = asset.url;
      }
    }
    return;
  }
  if (image) image.hidden = true;
  if (sheet) {
    if (next.ready) {
      sheet.hidden = false;
      root.dataset.actorState = "ready";
    } else if (!next.loading) {
      next.loading = true;
      sheet.hidden = true;
      root.dataset.actorState = "loading";
      const probe = new Image();
      probe.onload = () => {
        if (actorStates.get(id) !== next) return;
        next.loading = false;
        next.ready = true;
        sheet.style.backgroundImage = `url("${asset.url}")`;
        sheet.style.backgroundSize = `${Math.max(1, number(asset.columns)) * 100}% ${Math.max(1, number(asset.rows)) * 100}%`;
        sheet.hidden = false;
        root.dataset.actorState = "ready";
      };
      probe.onerror = () => {
        if (actorStates.get(id) !== next) return;
        next.loading = false;
        if (asset.fallbackUrl && image) {
          image.hidden = false;
          image.onload = () => { root.dataset.actorState = "ready"; };
          image.onerror = () => showActorFallback(root, symbol);
          image.src = asset.fallbackUrl;
        } else showActorFallback(root, symbol);
      };
      probe.src = asset.url;
    }
  }
}

function animateActors(now) {
  for (const state of actorStates.values()) {
    if (state.asset.type !== "spritesheet") continue;
    const sheet = state.root.querySelector(".sprite-actor__sheet");
    if (!sheet) continue;
    const frame = actorFrame(state.asset, state.clip, now - state.startedAt);
    const x = frame.columns === 1 ? 0 : frame.column / (frame.columns - 1) * 100;
    const y = frame.rows === 1 ? 0 : frame.row / (frame.rows - 1) * 100;
    sheet.style.backgroundPosition = `${x}% ${y}%`;
    if (frame.complete && frame.next && frame.next !== state.clip) {
      state.clip = frame.next;
      state.startedAt = now;
      state.root.dataset.actorClip = frame.next;
    }
  }
  animationFrame = window.requestAnimationFrame(animateActors);
}

function startActorEngine() {
  if (document.hidden) return;
  if (animationFrame !== null) return;
  animationFrame = window.requestAnimationFrame(animateActors);
}

function stopActorEngine() {
  if (animationFrame === null) return;
  window.cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function setIdentity(next) {
  identity = next;
  document.getElementById("pumpkin-widget").dataset.identityStatus = next.status;
  updateDiagnostics();
}

function applyVisualFields() {
  const scale = Math.max(50, Math.min(150, number(fieldData.overlayScale || 100)));
  const alignment = ["left", "right"].includes(fieldData.alignment) ? fieldData.alignment : "left";
  const widget = document.getElementById("pumpkin-widget");
  widget.style.setProperty("--widget-scale", String(scale / 100));
  widget.dataset.alignment = alignment;
  widget.classList.toggle("reduced-motion", Boolean(fieldData.reducedMotion));
  setActor("boss-actor", "boss", "pumpkin_king", "idle", "🎃");
}

function diagnosticsVisible() {
  return editorMode && Boolean(fieldData.showDebugPanel);
}

function updateDiagnostics() {
  const panel = document.getElementById("debug-panel");
  if (!panel) return;
  panel.hidden = !diagnosticsVisible();
  if (panel.hidden) return;
  const active = currentMinion(lastSafeState);
  const values = {
    "debug-channel": channelUsername || "fehlt",
    "debug-streamer": identity.status === "resolved" ? `${identity.streamerDisplayName} (resolved)` : identity.status,
    "debug-event": `${identity.eventSlug || WIDGET_CONFIG.eventSlug}${identity.eventStatus ? ` · ${identity.eventStatus}` : ""}`,
    "debug-supabase": supabaseStatus,
    "debug-realtime": realtimeStatus === "subscribed" ? "connected" : `${realtimeStatus} · Fallback aktiv`,
    "debug-boss": lastSafeState?.boss?.id ? "loaded" : "not loaded",
    "debug-minion": active ? `${active.key} · ${active.status}` : "none",
    "debug-sync": lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString("de-DE") : "never",
    "debug-build": WIDGET_CONFIG.buildVersion,
    "debug-assets": assetManifest ? `manifest v${assetManifest.version}` : "HTTPS-Fallback",
    "debug-action": lastTestMessage || "none",
  };
  for (const [id, value] of Object.entries(values)) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }
}

function hideOverlay(status) {
  setIdentity({ ...identity, status });
  const widget = document.getElementById("pumpkin-widget");
  widget.hidden = !diagnosticsVisible();
  document.getElementById("identity-card").hidden = true;
  document.getElementById("boss-card").hidden = true;
  document.getElementById("minion-card").hidden = true;
  if (!localCurse) document.getElementById("curse-layer").hidden = true;
}

function showIdentityMessage(title, detail) {
  if (!diagnosticsVisible()) {
    hideOverlay(identity.status);
    return;
  }
  const widget = document.getElementById("pumpkin-widget");
  widget.hidden = false;
  document.getElementById("boss-card").hidden = true;
  document.getElementById("minion-card").hidden = true;
  document.getElementById("identity-card").hidden = false;
  document.getElementById("identity-title").textContent = title;
  document.getElementById("identity-detail").textContent = detail;
}

async function rpc(name, body) {
  const response = await fetch(`${WIDGET_CONFIG.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: WIDGET_CONFIG.publishableKey,
      Authorization: `Bearer ${WIDGET_CONFIG.publishableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`widget_rpc_${name}_failed_${response.status}`);
  supabaseStatus = "connected";
  return response.json();
}

async function resolveIdentity() {
  const normalized = normalizeTwitchLogin(channelUsername);
  if (!normalized) return createIdentity("error", { event_slug: WIDGET_CONFIG.eventSlug });
  const payload = await rpc("resolve_stream_elements_identity", {
    p_event_slug: WIDGET_CONFIG.eventSlug,
    p_twitch_login: normalized,
  });
  return createIdentity(IDENTITY_STATUSES.has(payload?.status) ? payload.status : "error", payload || {});
}

function renderPreLaunch() {
  showIdentityMessage("Overlay erfolgreich verbunden", `${identity.streamerDisplayName || identity.channelUsername} · Event startet bald`);
}

function currentMinion(state) {
  return (state?.minions || []).find((item) => item.streamer_id === identity.streamerId && OPEN_MINION_STATUSES.has(item.status)) || null;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setMinionActor(minion) {
  const clip = minion.status === "active"
    ? (Date.now() < milliseconds(minion.accepts_answers_at) ? "observe" : "active")
    : minion.status;
  setActor("minion-actor", "minion", minion.key, clip, minion.icon || "👻");
}

function renderVisual(minion, observing) {
  const config = minion.runtime_config || {};
  const box = element("div", "minion-visual");
  if (minion.key === "zombie_horde") {
    for (const direction of ["links", "mitte", "rechts"]) {
      const item = element("span", observing && config.visual_target === direction ? "is-target" : "", direction === "links" ? "←" : direction === "rechts" ? "→" : "↑");
      item.append(element("em", "", direction));
      box.append(item);
    }
    return box;
  }
  if (minion.key === "spider_queen") {
    for (const option of config.options || []) {
      const item = element("span", observing && String(config.queen_index) === String(option) ? "is-target" : "", "🕷️");
      item.append(element("b", "", String(option)));
      box.append(item);
    }
    return box;
  }
  if (minion.key === "bat_swarm" && observing) {
    box.classList.add("minion-visual--bats");
    for (let index = 0; index < number(config.count); index += 1) box.append(element("span", "", "🦇"));
    return box;
  }
  if (minion.key === "reaper" && observing) {
    for (const item of config.sequence || []) box.append(element("span", "", String(item)));
    return box;
  }
  if (minion.key === "witch" || minion.key === "reaper") {
    const question = element("div", "minion-question");
    if (config.question) question.append(element("strong", "", String(config.question)));
    for (const key of ["a", "b", "c"]) question.append(element("span", "", `${key.toUpperCase()} – ${String(config.option_labels?.[key] || "")}`));
    return question;
  }
  return null;
}

function renderCurse(minion) {
  const curseKey = localCurse?.key || (minion?.status === "curse" ? minion.failure_curse_key : null);
  const layer = document.getElementById("curse-layer");
  if (!curseKey) {
    layer.hidden = true;
    layer.className = "curse-layer";
    actorStates.delete("curse-actor");
    return;
  }
  layer.hidden = false;
  layer.className = `curse-layer curse-layer--${curseKey}`;
  const current = actorStates.get("curse-actor");
  const clip = current?.root?.dataset?.actorKey === curseKey ? current.clip : "enter";
  setActor("curse-actor", "curse", curseKey, clip, "");
}

function renderMinion(minion) {
  const card = document.getElementById("minion-card");
  if (!minion) {
    card.hidden = true;
    card.dataset.minion = "none";
    renderedMinionSignature = "";
    renderCurse(null);
    return;
  }
  renderCurse(minion);
  card.hidden = false;
  card.className = `minion-card minion-card--${minion.status}`;
  card.dataset.minion = minion.key;
  const now = Date.now();
  const observing = minion.status === "active" && now < milliseconds(minion.accepts_answers_at);
  setMinionActor(minion);
  const kicker = document.getElementById("minion-kicker");
  const title = document.getElementById("minion-title");
  const visualSlot = document.getElementById("minion-visual");
  const instruction = document.getElementById("minion-instruction");
  const progress = document.getElementById("minion-progress");
  const result = document.getElementById("minion-result");
  const timer = document.getElementById("minion-timer");
  const signature = [
    minion.id,
    minion.status,
    observing,
    number(minion.required_participants),
    number(minion.damage_awarded),
    JSON.stringify(minion.runtime_config || {}),
  ].join("|");
  if (signature === renderedMinionSignature) {
    if (progress) progress.textContent = `${number(minion.participant_count)} / ${number(minion.required_participants)} Teilnehmer`;
    if (timer && minion.status === "active" && !observing) {
      const left = Math.max(0, Math.ceil((milliseconds(minion.expires_at) - now) / 1000));
      timer.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    }
    return;
  }
  renderedMinionSignature = signature;
  visualSlot.replaceChildren();
  visualSlot.hidden = true;
  instruction.hidden = true;
  progress.hidden = true;
  result.hidden = true;
  timer.hidden = true;
  if (minion.status === "intro") {
    kicker.textContent = `MINION-ALARM · ${identity.streamerDisplayName}`;
    title.textContent = minion.intro_title || minion.name;
    return;
  }
  if (minion.status === "active") {
    kicker.textContent = `${minion.game_mode} · ${minion.damage_class}`;
    title.textContent = observing ? "Gut aufpassen …" : minion.gameplay_title || minion.name;
    const visual = renderVisual(minion, observing);
    if (visual) {
      visualSlot.className = visual.className;
      visualSlot.replaceChildren(...visual.childNodes);
      visualSlot.hidden = false;
    }
    if (!observing) {
      instruction.textContent = minion.instruction || "Schreibe !boss";
      instruction.hidden = false;
      progress.textContent = `${number(minion.participant_count)} / ${number(minion.required_participants)} Teilnehmer`;
      progress.hidden = false;
      const left = Math.max(0, Math.ceil((milliseconds(minion.expires_at) - now) / 1000));
      timer.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
      timer.hidden = false;
    }
    return;
  }
  if (minion.status === "success") {
    kicker.textContent = "MINION BESIEGT";
    title.textContent = `${minion.name} besiegt!`;
    result.textContent = `${number(minion.damage_awarded).toLocaleString("de-DE")} Boss-Schaden`;
    result.hidden = false;
    return;
  }
  if (minion.status === "failure") {
    kicker.textContent = "MINION ENTKOMMEN";
    title.textContent = `${minion.name} war zu stark`;
    result.textContent = `Fluch: ${String(minion.failure_curse_key || "").replaceAll("_", " ")}`;
    result.hidden = false;
    return;
  }
  if (minion.status === "curse") {
    kicker.textContent = "FLUCH AKTIV";
    title.textContent = String(minion.failure_curse_key || "").replaceAll("_", " ");
    return;
  }
  card.hidden = true;
}

function eventAllowsGameplay(state) {
  return state?.event?.status === "active" || (state?.event?.status === "testing" && identity.testActionsAuthorized);
}

function renderEvent(state) {
  if (!identity.streamerId || state?.event?.id !== identity.eventId) {
    hideOverlay("error");
    return;
  }
  const paused = state.event.status === "paused" || Boolean(state?.settings?.event_paused);
  if (!eventAllowsGameplay(state) && !paused) {
    renderPreLaunch();
    return;
  }
  const boss = state.boss || {};
  const maxHp = number(boss.max_hp);
  const currentHp = Math.min(maxHp, number(boss.current_hp));
  const percent = maxHp ? (currentHp / maxHp) * 100 : 0;
  const phase = Math.max(1, Math.min(4, Math.floor(number(boss.phase?.phase_number || boss.phase_number || boss.current_phase || 1))));
  let bossClip = `phase_${phase}`;
  if (currentHp <= 0) bossClip = "defeated";
  else if (previousBossHp !== null && currentHp < previousBossHp) bossClip = previousBossHp - currentHp >= maxHp * 0.02 ? "heavy_hit" : "hit";
  else if (previousBossPhase !== null && phase !== previousBossPhase) bossClip = "phase_change";
  setActor("boss-actor", "boss", "pumpkin_king", bossClip, "🎃");
  window.clearTimeout(bossTransitionTimer);
  if (["hit", "heavy_hit", "phase_change"].includes(bossClip)) {
    bossTransitionTimer = window.setTimeout(() => setActor("boss-actor", "boss", "pumpkin_king", `phase_${phase}`, "🎃"), 900);
  }
  previousBossHp = currentHp;
  previousBossPhase = phase;
  document.getElementById("boss-name").textContent = boss.name || "Kürbiskönig";
  document.getElementById("boss-hp").hidden = fieldData.showHpNumbers === false;
  document.getElementById("boss-hp").textContent = `${Math.floor(currentHp).toLocaleString("de-DE")} / ${Math.floor(maxHp).toLocaleString("de-DE")} HP`;
  document.getElementById("boss-percent").hidden = fieldData.showPercentage === false;
  document.getElementById("boss-percent").textContent = `${percent.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
  document.getElementById("health-fill").style.width = `${percent}%`;
  const eventState = document.getElementById("event-state");
  eventState.hidden = !paused;
  eventState.textContent = paused ? "Event pausiert · Fortsetzung erfolgt automatisch" : "";
  document.getElementById("pumpkin-widget").hidden = false;
  document.getElementById("identity-card").hidden = true;
  document.getElementById("boss-card").hidden = false;
  renderMinion(paused ? null : currentMinion(state));
  updateDiagnostics();
}

function setupRealtime() {
  if (!window.supabase?.createClient || !identity.eventId) {
    realtimeStatus = "unavailable";
    updateDiagnostics();
    return;
  }
  realtimeChannel?.unsubscribe?.();
  supabaseClient = supabaseClient || window.supabase.createClient(WIDGET_CONFIG.supabaseUrl, WIDGET_CONFIG.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const refresh = () => queueRefresh(false);
  realtimeStatus = "connecting";
  realtimeChannel = supabaseClient.channel(`se-widget:${identity.eventId}:${identity.streamerId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "minion_events", filter: `event_id=eq.${identity.eventId}` }, refresh)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bosses", filter: `event_id=eq.${identity.eventId}` }, refresh)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${identity.eventId}` }, refresh)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "event_settings", filter: `event_id=eq.${identity.eventId}` }, refresh)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "streamers", filter: `id=eq.${identity.streamerId}` }, refresh)
    .subscribe((status) => {
      realtimeStatus = status === "SUBSCRIBED" ? "subscribed" : String(status || "disconnected").toLowerCase();
      updateDiagnostics();
    });
}

async function refreshWidget(reconnectRealtime = false) {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }
  refreshInFlight = true;
  try {
    const resolved = await resolveIdentity();
    const changed = resolved.eventId !== identity.eventId || resolved.streamerId !== identity.streamerId;
    setIdentity(resolved);
    if (resolved.status !== "resolved") {
      lastSafeState = null;
      if (resolved.status === "not_registered" || resolved.status === "disabled") {
        showIdentityMessage("Dieser Kanal ist nicht freigeschaltet.", "Bitte Eventorganisation kontaktieren.");
      } else {
        hideOverlay(resolved.status);
      }
      return;
    }
    if (changed || reconnectRealtime || realtimeStatus !== "subscribed") setupRealtime();
    if (resolved.eventStatus === "draft") {
      lastSafeState = null;
      renderPreLaunch();
      return;
    }
    const state = await rpc("get_stream_elements_widget_state", {
      p_event_slug: WIDGET_CONFIG.eventSlug,
      p_twitch_login: channelUsername,
    });
    if (!state) throw new Error("widget_state_unavailable");
    lastSafeState = state;
    lastSyncAt = Date.now();
    supabaseStatus = "connected";
    renderEvent(state);
  } catch (error) {
    supabaseStatus = "fallback";
    safeDebug("Refresh fehlgeschlagen; letzter sicherer State bleibt aktiv.", error instanceof Error ? error.message : "unknown");
    if (identity.status === "resolved" && lastSafeState) renderEvent(lastSafeState);
    else showIdentityMessage("Verbindung wird wiederhergestellt", "Fallback aktiv");
  } finally {
    refreshInFlight = false;
    updateDiagnostics();
    if (refreshQueued) {
      refreshQueued = false;
      window.setTimeout(() => void refreshWidget(false), 0);
    }
  }
}

function queueRefresh(reconnectRealtime) {
  void refreshWidget(reconnectRealtime);
}

function parseBossCommand(value) {
  if (typeof value !== "string") return null;
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens[0].toLowerCase() !== "!boss" || tokens.length > 2) return null;
  return { answer: tokens[1]?.toLowerCase() || null };
}

function extractChatAction(event) {
  if (event?.detail?.listener !== "message") return null;
  const data = event?.detail?.event?.data || {};
  const userId = String(data.userId || data.user_id || data.tags?.["user-id"] || "").trim();
  const messageId = String(data.msgId || data.msg_id || data.tags?.id || `se-${userId}-${Date.now()}`).trim();
  const text = String(data.text || "");
  return userId && text ? { userId, messageId, text } : null;
}

async function handleStreamElementsChatMessage(event) {
  if (identity.status !== "resolved" || !lastSafeState || !eventAllowsGameplay(lastSafeState) || lastSafeState.settings?.event_paused) return;
  const minion = currentMinion(lastSafeState);
  if (!minion || minion.status !== "active" || Date.now() < milliseconds(minion.accepts_answers_at) || Date.now() >= milliseconds(minion.expires_at)) return;
  const action = extractChatAction(event);
  if (!action || !parseBossCommand(action.text)) return;
  const response = await fetch(`${WIDGET_CONFIG.supabaseUrl}/functions/v1/minion-action`, {
    method: "POST",
    headers: {
      apikey: WIDGET_CONFIG.publishableKey,
      Authorization: `Bearer ${WIDGET_CONFIG.publishableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventId: identity.eventId,
      streamerId: identity.streamerId,
      minionEventId: minion.id,
      participantId: action.userId,
      messageId: action.messageId,
      text: action.text,
    }),
  });
  if (response.ok) queueRefresh(false);
}

function showVisualCurse(visualCurse) {
  const durationMs = Math.min(15_000, Math.max(1_000, number(visualCurse?.durationMs)));
  localCurse = { key: String(visualCurse?.key || ""), endsAt: Date.now() + durationMs };
  window.clearTimeout(localCurseTimer);
  renderCurse(currentMinion(lastSafeState));
  localCurseTimer = window.setTimeout(() => {
    localCurse = null;
    renderCurse(currentMinion(lastSafeState));
  }, durationMs);
}

async function runTestAction(action) {
  if (!WIDGET_CONFIG.testControls || !identity.testActionsAuthorized || identity.status !== "resolved") return;
  const response = await fetch(`${WIDGET_CONFIG.supabaseUrl}/functions/v1/widget-test-action`, {
    method: "POST",
    headers: {
      apikey: WIDGET_CONFIG.publishableKey,
      Authorization: `Bearer ${WIDGET_CONFIG.publishableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      eventSlug: WIDGET_CONFIG.eventSlug,
      channelUsername,
      requestId: crypto.randomUUID(),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  lastTestMessage = response.ok ? `${action}: ok` : `${action}: ${payload.error || response.status}`;
  if (response.ok && payload?.data?.visualCurse) showVisualCurse(payload.data.visualCurse);
  updateDiagnostics();
  if (response.ok) queueRefresh(false);
}

function handleWidgetButton(event) {
  if (event?.detail?.listener !== "widget-button") return;
  const field = String(event?.detail?.event?.field || "");
  const action = BUTTON_ACTIONS[field];
  if (action) void runTestAction(action);
}

function testTickHeartbeat() {
  if (!WIDGET_CONFIG.testControls || !identity.testActionsAuthorized || identity.status !== "resolved") return;
  const hasRuntimeMinion = Boolean(currentMinion(lastSafeState));
  const interval = hasRuntimeMinion ? ACTIVE_TEST_TICK_MS : IDLE_TEST_TICK_MS;
  if (Date.now() - lastTestTickAt < interval) return;
  lastTestTickAt = Date.now();
  void runTestAction("tick");
}

async function detectEditorMode() {
  try {
    const status = await window.SE_API?.getOverlayStatus?.();
    editorMode = Boolean(status?.isEditorMode);
  } catch {
    editorMode = false;
  }
  if (diagnosticsVisible()) document.getElementById("pumpkin-widget").hidden = false;
  updateDiagnostics();
}

window.addEventListener("onWidgetLoad", async (event) => {
  fieldData = event?.detail?.fieldData || {};
  startActorEngine();
  applyVisualFields();
  void loadAssetManifest().then(() => {
    applyVisualFields();
    const active = currentMinion(lastSafeState);
    if (active) setMinionActor(active);
  });
  await detectEditorMode();
  channelUsername = normalizeTwitchLogin(event?.detail?.channel?.username);
  if (!channelUsername) {
    safeDebug("StreamElements channel.username fehlt.");
    showIdentityMessage("Kanal nicht erkannt", "StreamElements liefert keinen channel.username.");
    return;
  }
  queueRefresh(true);
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => queueRefresh(realtimeStatus !== "subscribed"), FALLBACK_REFRESH_MS);
  window.clearInterval(clockTimer);
  clockTimer = window.setInterval(() => {
    if (lastSafeState && identity.status === "resolved") renderEvent(lastSafeState);
  }, 250);
  window.clearInterval(testTickTimer);
  testTickTimer = window.setInterval(testTickHeartbeat, 1_000);
});

window.addEventListener("onEventReceived", (event) => {
  if (event.detail?.listener === "message") void handleStreamElementsChatMessage(event);
  if (event.detail?.listener === "widget-button") handleWidgetButton(event);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopActorEngine();
  else startActorEngine();
});
