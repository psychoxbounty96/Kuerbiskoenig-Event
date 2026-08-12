# Live Widget Readiness Report

## Ergebnis

Der Betreiber-Testpfad ist auf die reale Zielarchitektur ausgerichtet: StreamElements Custom Widget, Supabase, Twitch und GitHub/GitHub Pages. Lokaler Mockserver, localhost, lokale Overlay-Route, Docker und ein laufender Betreiber-PC sind keine Voraussetzungen mehr.

## Mock-Abhängigkeiten

`MockDataProvider`, lokale Preview und Simulatoren dürfen intern für Unit Tests und Entwicklung bestehen bleiben. Sie erscheinen nicht mehr in der Betreiber- oder Streameranleitung und gelten nicht als Live-Nachweis. Das StreamElements-Paket enthält keinen BroadcastChannel-, JSON-Mock- oder localhost-Pfad.

## Finaler StreamElements Build

`npm run build:widget` erzeugt:

- `dist/streamelements/production/` für `halloween-2026`
- `dist/streamelements/test/` für `halloween-2026-test`

Zuordnung der Tabs:

- HTML: `html.html`
- CSS: `css.css`
- JS: `js.js`
- FIELDS: `fields.json`

Beide Pakete sind standalone und werden auf unresolved Imports, Node APIs, lokale URLs, Platzhalter und Secretnamen geprüft. Assets werden über die stabile GitHub-Pages-HTTPS-Basis geladen; bei Fehler fällt die Miniongrafik auf das Icon zurück.

## Testevent und Testaccounts

Die Migration ergänzt `streamers.is_test_account` als explizites Flag und `widget_test_action_log` für idempotente, ratebegrenzte Operator-Aktionen. Der Seed erzeugt reproduzierbar Testevent, Boss, vier Phasen, Milestones, Settings, sieben Minion-/Curse-Definitionen, Damage Classes und Hexenfrage.

Öffentliche Teilnehmer-/Minionstatistiken schließen Testkonten aus. `viewer_samples_calibration` enthält nur `twitch_api`-Samples normaler Konten. Manuelle Testwerte bleiben `source = manual_test`.

## StreamElements Testbuttons

Das Testpaket enthält Gruppen für General, Boss, Minions, Curses und Debug. Bosshits, Phasen, Reset, alle sieben Spawns, Resolve/Cancel/Expire, Raid-Simulation, Herald und Viewer Sample laufen über `widget-test-action`. Visual-only Curses werden erst nach serverseitiger Autorisierung abgespielt und verändern keine Statistik.

Normale Produktions-FIELDS enthalten keine Testbuttons. Die Edge Function verlangt zusätzlich serverseitig einen aktivierten Testaccount und Eventstatus `testing`. Clientwerte für HP, Damage, Success, Resolution, Streamer-ID oder Event-ID werden abgelehnt.

## Supabase, Realtime und Fallback

Das Widget löst `onWidgetLoad.detail.channel.username` gegen den festen Eventslug auf und liest danach `get_stream_elements_widget_state`. Dieser Snapshot enthält globalen Boss-State, aber nur den aufgelösten Streamer und dessen Minions. Realtime signalisiert Änderungen an Boss, Event, Streamer und Minions; der Client liest anschließend den konsistenten Snapshot neu.

Bei Ausfall bleibt der letzte sichere State erhalten. Ein Fünf-Sekunden-Re-Fetch und automatischer Channel-Reconnect bleiben aktiv. Countdown, Intro, Result und Curse verwenden Serverzeitpunkte. Das autorisierte Testwidget ruft bei deaktiviertem Produktions-Cron dieselbe SQL-Tick-Engine auf, sodass echte Testabläufe ohne lokalen Server funktionieren.

## Echter Chat

`onEventReceived` mit `listener === "message"` extrahiert echte StreamElements/Twitch User- und Message-IDs. `!boss` geht an `minion-action`; HMAC-Dedupe, Scope, Zeitfenster, Antwort, Rate Limit, Success und Damage bleiben serverseitig.

## Security

- kein Service Role oder `sb_secret_...` im Widget/GitHub-Pages-Code
- keine Twitch-/EventSub-Secrets oder Minion Pepper im Client
- unbekannte/deaktivierte Kanäle erhalten keinen Action-Pfad
- Testaktionen sind auf `testing` + `is_test_account` begrenzt
- Produktionsbuild deaktiviert Testcontrols zusätzlich statisch
- direkte Boss-/Minionmutation aus dem Widget bleibt unmöglich
- Testevent und Produktionsevent sind getrennt

Die StreamElements-Kanalidentität bleibt ohne Bot/OAuth eine dokumentierte Soft-Trust-Grenze. Weil Testmutationen ausschließlich das isolierte Testevent betreffen und keine Preise existieren, wird kein Bot oder Streamer-OAuth eingeführt.

## Tests

Ergänzt wurden Contracts für beide Standalone-Builds, FIELDS-Trennung, StreamElements Lifecycle, Realtime/Fallback, Testaccount-Scoping, Calibration-Filter und serverseitige Testautorität. Der vollständige Lauf erfolgt mit `npm test`.

## Reale Abnahme

Die Schrittfolge und vollständige Matrix stehen in [docs/LIVE_STREAMELEMENTS_TESTING.md](docs/LIVE_STREAMELEMENTS_TESTING.md). Ein echter Test-Twitch-Kanal muss im Testevent angelegt und markiert werden, bevor der StreamElements-Testshare-Link abgenommen werden kann.

## Bekannte Einschränkungen

- Die endgültige StreamElements Share-Link-Erstellung bleibt eine manuelle Aktion im StreamElements-Account des Betreibers.
- Die echte Chat-/OBS-Abnahme benötigt einen vom Betreiber kontrollierten Twitch-Testkanal.
- Die Soft-Trust-Kanalidentität ist absichtlich kein Auth-Ersatz und gewährt keine Produktionsrechte.
- Placeholder-Artworks bleiben bestehen; fehlende Bilder fallen sicher auf Icons zurück.
- Damage-Klassen und Fairnesskurve sind weiterhin vorläufig.

## Weiterhin deaktivierte Cronjobs

Twitch Sync, produktiver Minion Tick und Passive Damage Tick werden nicht ungefragt aktiviert. Vor Produktionsstart müssen Schedule, Secrets, EventSub-Subscriptions, Twitch IDs und echte Last-/Recovery-Tests bewusst freigegeben werden. Passiver Boss Damage bleibt außerhalb dieses Patches.
