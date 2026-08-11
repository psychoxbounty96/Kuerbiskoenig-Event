# v0.4 Abschlussbericht

## Ergebnis

Die vorhandene v0.1–v0.3.1-Architektur wurde additiv um eine generische, streamerbezogene Minion-/Chat-Minigame-Engine erweitert. Twitch Awareness, Zero-Configuration Identity, atomare Bossmutationen, Realtime und StreamElements als einziges Overlay-System bleiben erhalten. Es wurde keine Bot-, OAuth-, OBS-Plugin-, Economy- oder Reward-Abhängigkeit eingeführt.

## Engine und Game Modes

Implementiert sind die persistente State Machine `scheduled / intro / active / success / failure / curse / complete / cancelled / expired`, serverzeitbasierte Zeitpunkte, Reload-Recovery sowie `PARTICIPATION`, `VOTE`, `VISUAL_CHOICE` und `MEMORY`. Pro Streamer läuft höchstens ein Runtime-Minion; mehrere Streamer können gleichzeitig unabhängig spielen.

Der zentrale `!boss`-Parser ist case-insensitiv, whitespace-tolerant und lehnt Prefix- sowie Mehrfachparameter-Matches ab. Ein Twitch User zählt pro Minion genau einmal. Ungültige Eingaben werden nicht gespeichert und dürfen korrigiert werden.

## Minions und Curse System

Definitionen existieren für Ghost, Zombiehorde, Spinnenkönigin, Hexe, Fledermausschwarm, Sensenmann und Raid-Herold. Alle liegen auf derselben Engine. Der Herold wird nur durch einen eligible internen Raid geplant, startet nach 90–120 Sekunden und verursacht erst bei erspieltem Erfolg Damage.

Geisternebel, Zombiehände, Spinnenbefall, Hexenfluch, Fledermausangriff, Dunkelheit und Königlicher Fluch sind als funktionale CSS-Placeholder umgesetzt. Dauer und Deckkraft sind begrenzt; kein Effekt steuert OBS, Audio, Szene, Chat oder andere Overlayelemente.

## Datenbankänderungen

Migration `202608110004_v0_4_minion_engine.sql` erweitert Definition und Runtime und ergänzt Curse Definitions, Damage Classes, Questions, private Event Secrets, HMAC-Participants, Rate Buckets, Systemlogs, normale Spawn Schedules und Raid Special Queue.

Viewer Estimate nutzt den Median der letzten drei gültigen Samples. Schwierigkeit, Dauer und Damage Class werden beim Spawn eingefroren. Damage Classes und Scalingwerte sind in der Datenbank konfigurierbar und als vorläufig markiert.

DB-Trigger canceln Minions bei Pause, deaktivierter Engine, Streamer Disable, Stream Offline oder Bosskill. Failure erzeugt niemals Bossheilung. Event/Streamer/Minion-/Participant-Scoping verhindert einen globalen `activeMinion`.

## Edge Functions

- `minion-action`: öffentlicher, unprivilegierter Chat-Eingang mit Payloadgrenzen, verbotenem Client-Damage, HMAC-SHA256-Participant-Key und ausschließlich service-role-internem RPC
- `minion-tick`: service-role-geschützter Scheduler für State Transitions, normale Spawns, Raid Queue und Cleanup
- `admin-event-action`: nutzt v0.4 Spawn/Resolve für den Debugger

`MINION_PARTICIPANT_PEPPER` bleibt serverseitig. Keine Twitch-/Supabase-/StreamElements-Secrets wurden ins Widget verschoben.

## StreamElements

`onWidgetLoad` löst weiterhin automatisch `channel.username` auf. `onEventReceived` verarbeitet jetzt native Message Events, extrahiert Twitch User ID, Message ID und Text und sendet nur die Aktion für das exakt aufgelöste Streamer-/Minion-Paar. Das Widget sendet keine Chatnachrichten.

Intro, Observe, Gameplay, Progress, Result und Curse sind responsiv für 1080p/1440p. Realtime lädt relevante Stateänderungen, ein Fünf-Sekunden-Fallback schützt gegen kurze Unterbrechungen, und ein lokaler Clock-Render verwendet stets persistierte Serverzeitpunkte.

## Trust und Security

Chat aus StreamElements ist bewusst eine Soft-Trust-Grenze. Serverprüfungen umfassen Eventstatus, Pause, Streamer Enabled/Live, Minionzuordnung, Status, Zeitfenster, definitionbasierte Antwort, HMAC-Deduplizierung, Message-ID, Rate Limit und Payloadlimit. Damage und Success werden nie aus einem Clientwert übernommen. Normale Chattexte, Display Names und langfristige Zuschaueridentitäten werden nicht gespeichert.

## Admin und Mock

Der Admin Debugger spawnt alle sieben Minions pro Streamer, zeigt Viewer Estimate, Ziel/Ist, State, Timer, Damage Class, Curse und Trigger und bietet Force Success, Failure, Cancel und Expire. Der Chat-Simulator unterstützt einzelne Testuser sowie +5/+10 Fake-User.

Der MockDataProvider simuliert State Machine, frozen difficulty, Participation, Vote-Timing, Damage, Curse, Raid-Delay, BroadcastChannel und mehrere Streams ohne Twitch/Supabase.

## Tests

Ergänzt wurden Domain- und Contract-Tests für Chatparser, Antwortvalidierung, gültige/duplizierte/korrigierbare Teilnehmer, Participation-Schwellen, Vote-Mehrheit/Tie/Minimum, stabile Viewer Samples, weiche Kurve, State-/Clock-Recovery, Multi-Streamer-Scoping, Raid-Delay, private Participants, Server-Damage, Rate Limits, Cancel Guards, Realtime/Fallback und Widget-Security.

Der vollständige `npm test`-Lauf ist erfolgreich: TypeScript-Check, ESLint, Syntaxprüfung des Standalone-Widgets, Produktionsbuild sowie 48 Domain-, Rendering- und Contract-Tests sind grün. Der Produktions-Dependency-Audit meldet 0 bekannte Schwachstellen. `git diff --check` und der Secret-Placeholder-Scan sind ebenfalls sauber.

Eine echte Datenbankmigration benötigt weiterhin ein verbundenes Supabase-Testprojekt. `supabase db lint` konnte lokal nicht ausgeführt werden, weil weder der lokale Postgres-Dienst auf Port 54322 noch Docker verfügbar war; Migration, RPC-Grenzen, RLS, Grants und Seed-Konflikte werden deshalb zusätzlich durch statische Contract-Tests geprüft. Der dokumentierte Live-Test nach Deployment bleibt erforderlich.

## Live-/Mock-Testanleitung

Mock: `npm run dev`, `/admin` öffnen, Event aktivieren, Streamer wählen, Minion spawnen, nach Intro Chataktionen simulieren und `/overlay?streamer=knoobbi` parallel beobachten.

Live: Migration anwenden, Pepper setzen, beide Functions deployen, 10-Sekunden-Scheduler aktivieren, aktiven Live-Streamer wählen und zunächst mit Admin-Spawn plus realem Twitch Chat testen. Danach eligible internen Raid und 90–120-Sekunden-Queue prüfen.

## Einschränkungen und v0.5

Artworks bleiben Placeholder. Damage-Class-, Participation-, Cooldown- und Schedulerwerte sind absichtlich vorläufig. Vor v0.5 sollten reale Viewer-/Participation-/Success-Daten ausgewertet, isolierte Supabase-Integrationstests und Lasttests durchgeführt und erst danach finale Balancingwerte bzw. Sprites freigegeben werden.

Nicht implementiert wurden passive Damage Engine, finale Boss-HP, Bots, Discord/PXB ComBot, Chatantworten, Giveaways, Items, Inventory, Economy, XP oder Achievements.
