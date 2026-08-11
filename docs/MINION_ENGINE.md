# Minion Engine v0.4

## State Machine

`scheduled → intro → active → success/failure → curse? → complete`

`cancelled` beendet ein Minion neutral; `expired` steht für einen expliziten technischen Ablauf. Normale Gameplay-Timeouts werden serverseitig als Success oder Failure ausgewertet. Participation-Spiele können beim Erreichen der Schwelle sofort erfolgreich enden; Vote-/Choice-/Memory-Spiele laufen bis `expires_at`.

## Chat Parsing

Akzeptiert werden exakt `!boss` oder `!boss <eine Antwort>`, case-insensitiv und whitespace-tolerant. `!bossabc` und zusätzliche Parameter matchen nicht. Participation erwartet keine Antwort; andere Modes validieren gegen die am Spawn eingefrorenen Optionen.

## Participant Handling

StreamElements liefert Twitch User ID, Display Name, Text und Message ID. Nur die User ID wird serverseitig mit einem geheimen Pepper zu einem event-/streamergebundenen HMAC-Key abgeleitet. Display Name und normaler Chattext werden nicht gespeichert. Ein Unique Constraint zählt pro Minion genau eine gültige Aktion. Ungültige Eingaben erzeugen keinen Participant und dürfen korrigiert werden.

Retention: beendete Teilnehmerzeilen werden nach 24 Stunden bereinigt; Rate-Limit-Buckets nach einer Stunde. Diese Daten sind ausschließlich minionbezogen und kein Zuschauerprofil.

## Game Modes

- `PARTICIPATION`: X eindeutige Nutzer; sofortiger Erfolg bei Schwelle
- `VOTE`: Mehrheit bei Mindestbeteiligung; Gleichstand ist Failure
- `VISUAL_CHOICE`: Vote-Mechanik mit visuellen Zielen
- `MEMORY`: Beobachtungsphase, danach Vote/Count

## Scheduling

`process_minion_tick` läuft regelmäßig serverseitig. Normale Spawns nutzen zufällige Phasenfenster und Definition-Weights. Der Scheduler prüft Event, Pause, Boss, Minions-Kill-Switch, Streamer Enabled/Live, bestehenden Runtime-State und Cooldown. Ein Raid-Herold stammt ausschließlich aus der eligible Raid Queue.

## Scaling Hooks

`stable_viewer_estimate` nutzt den Median der letzten drei gültigen Viewer Samples. `calculate_required_participants` ist eine konfigurierbare, abflachende Potenzkurve. Alle Runtimewerte werden beim Spawn eingefroren.

Damage wird nur aus `minion_damage_classes`, Viewer Estimate, Community-Faktor und den bestehenden serverseitigen Multiplikatoren berechnet. Alle v0.4-Werte sind als `provisional` markiert.

## Realtime und Recovery

`minion_events` ist Teil der bestehenden Supabase-Realtime-Publication. Das Widget hört auf Minion-, Boss-, Event- und Streameränderungen und lädt danach den konsistenten Public Snapshot. Ein Fünf-Sekunden-Fallback bleibt aktiv. Absolute Serverzeitpunkte rekonstruieren Intro, Observe, Active, Result und Curse nach Reload ohne Timerreset.

## Multi-Streamer

Concurrency ist auf `event + streamer` begrenzt. Ein Streamer kann ein Runtime-Minion besitzen; viele Streamer können gleichzeitig unterschiedliche Minions spielen. Teilnehmer-Unique-Constraints enthalten die Minion Event ID, sodass Aktionen nie einen anderen Stream beeinflussen.

## Admin Debugging und Mock

Der Admin Debugger kann alle sieben Definitionen pro Streamer spawnen, Success/Failure/Cancel/Expire erzwingen und eingefrorene Werte anzeigen. Der Chat-Simulator sendet Einzelaktionen oder fünf/zehn Fake-User über dieselbe Provider-Schnittstelle. Im Mockmodus werden State Machine, Damage, Curse und BroadcastChannel lokal simuliert.

## Trust Boundary

Siehe [ARCHITECTURE.md](ARCHITECTURE.md). Wichtig: StreamElements Chat ist Soft Trust; Bossmutationen sind weiterhin serverautoritativ. Keine Preise oder individuellen Rewards sind an Ergebnisse gekoppelt.
