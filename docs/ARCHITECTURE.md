# Architektur v0.4

## Live-Widget Runtime

Der produktive StreamElements-Build ist ein eigenständiges Vier-Dateien-Paket. Er enthält keinen Modulimport, keine Node-/Vite-Laufzeit, keine lokale URL und kein Secret. Browseröffentliche Projekt-URL, Publishable Key, HTTPS-Assetbasis und der feste Eventslug werden mit `npm run build:widget` eingebettet.

```text
onWidgetLoad / onEventReceived
          │
          ▼
StreamElements Custom Widget
     │ REST/RPC      │ Realtime
     └──────────┬────┘
                ▼
           Supabase
      ┌─────────┴─────────┐
      ▼                   ▼
public read RPCs    server-authoritative
                    Edge Functions / RPCs
```

`get_stream_elements_widget_state(eventSlug, twitchLogin)` liefert nur den automatisch erkannten Streamer und dessen Minions, jedoch weiterhin den globalen Boss. Realtime ist ein Aktualisierungssignal; nach jeder Meldung wird der autoritative Snapshot neu gelesen. Bei Ausfall bleibt der letzte sichere State sichtbar, ein periodischer Re-Fetch läuft weiter und Realtime wird neu verbunden.

Lokale Mock-Komponenten dürfen für Unit Tests und Entwicklung bestehen bleiben. Sie sind weder Betreiber-Testweg noch Laufzeitabhängigkeit. Solange produktive Cronjobs bewusst deaktiviert sind, darf ausschließlich ein autorisiertes Testwidget im Event `testing` einen serverseitig validierten Tick-Heartbeat auslösen. Sämtliche Transitionen verwenden weiterhin die persistierten Serverzeitpunkte; das Produktionsevent besitzt diesen Testpfad nicht.

## Operator-Testautorisierung

Testkonten werden durch `streamers.is_test_account` explizit markiert. `widget-test-action` akzeptiert nur einen normalisierten Login, der im angeforderten Event aktiviert und als Testkonto markiert ist, und nur wenn dieses Event den Status `testing` besitzt. Das Event wird aus dem Testbuild fest vorgegeben; Streamer-ID, HP, Damage, Resolution und Success werden nicht vom Client akzeptiert.

Diese Grenze ist weiterhin eine bewusst enge Soft-Trust-Lösung, weil StreamElements ohne Bot/OAuth keinen kryptografischen Kanalbeweis liefert. Ihre Reichweite ist auf das getrennte Testevent begrenzt. Das Produktionsevent kann damit nicht mutiert werden. Normale Share-Links enthalten keine Testbutton-Felder und kompilieren Testcontrols aus.

Testkonten werden aus der öffentlichen Teilnehmerliste, öffentlichen Minion-Statistiken und der Calibration-View ausgeschlossen. Manuelle Viewer Samples tragen `source = manual_test`; die Calibration-View enthält ausschließlich Twitch-API-Samples normaler Konten.

## Systemgrenze

Das Projekt besteht ausschließlich aus StreamElements, Supabase, Twitch API/EventSub sowie GitHub/GitHub Pages für Sourcecode und statische Website. ChatGPT Sites, ein separater Twitch-/Discord-Bot, PXB ComBot, lokaler Client oder OBS-Plugin sind keine Abhängigkeit.

GitHub Pages liefert ausschließlich statische HTML-, CSS- und JavaScript-Dateien. Dauerhafte Daten, Authentifizierung, Realtime und privilegierte Mutationen liegen in Supabase. Der Web-Client kennt nur Projekt-URL, Publishable Key und Eventslug.

`MockDataProvider` und `SupabaseDataProvider` bleiben die einzige UI-Datengrenze. Website, Admin, lokale Preview und Widget teilen dasselbe Eventmodell; privilegierte Mutationen bleiben in Edge Functions und Security-Definer-RPCs.

## StreamElements Identity Resolution

```text
onWidgetLoad.detail.channel.username
       ↓ trim + lowercase
fester Eventslug des Widget-Builds
       ↓ resolve_stream_elements_identity
registrierter + aktivierter streamers.twitch_login
       ↓
resolvedEventId + resolvedStreamerId
```

Es wird nie das „erste aktive Event“ gesucht und nie automatisch ein Streamer angelegt. Unbekannte oder deaktivierte Kanäle bleiben im Live-Output unsichtbar. Twitch User ID ist für die Widget-Zuordnung nicht erforderlich. Der Username wählt nur eine öffentliche Konfiguration aus und gewährt weder Adminrechte noch direkte Bossmutation.

## Minion-Datenfluss

```text
minion-tick / Admin / eligible Raid
              ↓
      Spawn mit eingefrorenem Viewer Estimate
              ↓
scheduled → intro → active → success → complete
                         └→ failure → curse → complete
                         └→ cancelled / expired

StreamElements message
       ↓
lokaler exakter !boss-Parser
       ↓
minion-action: Payloadlimit + HMAC Participant Key
       ↓
submit_minion_action: Event/Streamer/Status/Zeit/Rate/Dedupe/Antwort
       ↓
Participation: Schwelle → sofortiger Success
Vote/Choice/Memory: Serverauswertung beim Ablauf
       ↓
resolve_minion_v4 → Damage Class → apply_boss_damage
```

## State Machine und Serverzeit

Alle absoluten Zeitpunkte werden persistiert: `spawned_at`, `intro_ends_at`, `gameplay_starts_at`, `accepts_answers_at`, `expires_at`, `result_ends_at`, `curse_ends_at` und `completed_at`. Das Overlay leitet seine Darstellung ausschließlich aus diesen Serverwerten und der aktuellen Zeit ab. Reload oder Reconnect erzeugt kein Minion und setzt keinen Timer zurück.

`minion-tick` treibt Transitionen und Scheduling. Realtime auf `minion_events`, Boss, Event und Streamer löst einen Re-Fetch des bestehenden Public-State-RPC aus. Ein periodischer Re-Fetch bleibt aktiv, falls Realtime kurz nicht verfügbar ist.

## Multi-Streamer Concurrency

Die Runtime ist immer `event_id + streamer_id`-gebunden. Pro Streamer gibt es höchstens ein laufendes Minion in `intro`, `active`, `success`, `failure` oder `curse`. Unterschiedliche Streamer dürfen gleichzeitig vollständig unabhängige Minions, Timer, Teilnehmer und Ergebnisse besitzen. Alle erfolgreichen Auflösungen verwenden denselben atomaren globalen Boss.

Ein globales Feld wie `event.activeMinion` existiert nicht.

## Viewer Estimate und Scaling Hooks

Beim Spawn wird der Median der letzten drei gültigen `viewer_samples` berechnet. Zwei Samples ergeben den Median/Mittelwert, ein Sample wird direkt genutzt, ohne Samples gilt ein Minimum-Fallback. Twitch-API-Ausfälle sind keine Nullsamples.

`viewer_estimate`, `required_participants`, `duration_seconds` und `damage_class` werden am Minion Event eingefroren. `calculate_required_participants` nutzt `min_participants + participation_factor × viewer_estimate^curve_exponent` mit Minimum/Maximum. Diese weiche Kurve ist eventkonfigurierbar und ausdrücklich vorläufig.

Damage Classes `STANDARD`, `HIGH`, `ELITE`, `SPECIAL` liegen in `minion_damage_classes`. Der Server kombiniert deren konfigurierbare Basis mit einem begrenzten, abflachenden Community-Faktor sowie bestehenden globalen/aktiven Multiplikatoren. Der Client kennt oder setzt keinen autoritativen Damagewert.

## Scheduling und Raids

Normale Phasenfenster:

- Phase I: 45–60 Minuten
- Phase II: 40–55 Minuten
- Phase III: 35–50 Minuten
- Phase IV: 30–45 Minuten

Der Scheduler verlangt Event `active`, Minions aktiviert, Boss lebend sowie aktivierten und live erkannten Streamer. Phase Pools und Gewichte stammen aus den Definitionen.

Ein eligible interner Raid erzeugt per DB-Trigger genau einen `kings_herald`-Queueeintrag. Er wird nach 90–120 Sekunden gestartet; der Raid selbst verursacht keinen Schaden. Ein Konflikt verschiebt das Special. Nach dem Herold gilt ein normaler Schutz-Cooldown. Externe Raids erzeugen keinen Herold.

## Trust Boundary

Chataktionen stammen bewusst aus dem unprivilegierten StreamElements Widget. Ohne Bot oder Streamer-OAuth kann das Backend die Herkunft nicht kryptografisch als Twitch Chat beweisen. Diese Soft-Trust-Grenze wird proportional abgesichert:

- aktives Event, aktivierter Streamer und passendes Minion prüfen
- produktiv nur bei Twitch `is_live`
- serverseitige absolute Zeitfenster
- exakter Parser und definitionbasierte Antwortvalidierung
- Twitch User ID nur minionbezogen als HMAC-SHA256-Key speichern
- eine gültige Aktion pro User/Minion; ungültige Eingaben werden nicht gespeichert
- Request-, Text-, ID- und Answer-Limits sowie Rate Limit
- eindeutige Participant- und Message-Constraints
- Damagewert und Success niemals vom Client übernehmen
- idempotenter Damage-Key `minion:<event-id>`
- Status- und Anomalie-Logging ohne normalen Chattext oder Secrets
- Teilnehmer-Cleanup nach beendeten Events; keine Zuschauerprofile

Da keine Preise oder individuellen Belohnungen existieren, wird hierfür kein unverhältnismäßiger Bot-/OAuth-Unterbau eingeführt.

## Cancel- und Sicherheitsregeln

Pause, deaktivierte Minions, Eventstatus außerhalb Active/Testing, Streamer Disable, Stream Offline und Bosskill canceln laufende Minions. Cancel verursacht weder Success, Failure Curse noch Damage. Ein Fehlschlag heilt den Boss nie.

Flüche laufen ausschließlich im Kürbiskönig-Widget, maximal 15 Sekunden. Sie steuern weder OBS noch Szenen, Audio, Chat, Browser Source oder andere Overlays und erzeugen keinen langen vollständigen Blackout.

## Datenmodell

- `minion_definitions`: generische Definition, Mode, Präsentation, Phase, Gewicht, Kurve und Damage Class
- `minion_events`: eingefrorene Runtime und sämtliche Serverzeitpunkte
- `minion_event_secrets`: nicht öffentliches korrektes Ergebnis
- `minion_participants`: HMAC-Key, Antwort, Message-ID und kurze Retention
- `curse_definitions`: Dauer, Intensität und harte visuelle Grenzen
- `minion_damage_classes`: eventkonfigurierbare, vorläufige Damagebasis
- `minion_questions`: kurze Hexenfragen
- `minion_spawn_schedules` / `minion_special_queue`: normale und Raid-Schedules
- `minion_system_log`: technische, chatsparsame Zustandslogs

Historische v0.2/v0.3-Tabellen und Twitch-Polling/EventSub-Recovery bleiben unverändert erhalten.
