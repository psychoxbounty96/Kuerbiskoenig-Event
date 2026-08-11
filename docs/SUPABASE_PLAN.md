# Supabase-Core v0.2

## Implementierter Datenbestand

Die Migration `supabase/migrations/202608110001_v0_2_core.sql` erzeugt:

- `events`, `bosses`, `boss_phases`, `milestones`
- `streamers`, `damage_events`
- `minion_definitions`, `minion_events`
- `event_settings`, `event_admins`, `admin_audit_log`

Alle Tabellen haben RLS. `anon` und `authenticated` erhalten ausschließlich explizite Leserechte auf die öffentlichen Tabellen. Es existiert keine öffentliche Insert-/Update-/Delete-Policy. Die schreibenden `SECURITY DEFINER`-Funktionen sind für `public`, `anon` und `authenticated` widerrufen und nur `service_role` erteilt.

## RPCs

- `get_public_event_state(slug)` – secretsfreier Snapshot; für angemeldete Eventadmins inklusive deaktivierter Streamer.
- `apply_boss_damage(...)` – atomare und idempotente Damage-Buchung.
- `admin_set_boss_hp(...)`, `admin_reset_boss(...)` – kontrollierte Test-/Adminpfade.
- `spawn_minion(...)`, `resolve_minion(...)`, `expire_stale_minions(...)` – streamergebundener Minion-Lebenszyklus.
- `touch_event(...)` – löst einen öffentlichen Realtime-Refresh nach Settings-/Stammdatenänderungen aus.

## Edge Functions

`admin-event-action` verifiziert den Bearer Token erneut, prüft `event_admins`, sperrt Viewer für Mutationen, dispatcht ausschließlich bekannte Aktionen und protokolliert erfolgreiche Änderungen. Owner ist für vollständigen Bossreset und Streamerlöschung erforderlich.

`process-passive-tick` ist mit JWT-Prüfung konfiguriert, zusätzlich durch den Service-Key geschützt und über `PASSIVE_TICK_ENABLED=false` ausgeschaltet. Es räumt bei expliziter Aktivierung nur abgelaufene Minions auf. Passive Damage-Logik bleibt außerhalb von v0.2.

Ohne Scheduler markiert der Provider zeitlich abgelaufene Instanzen sofort lokal als `expired`; Spawn- und Resolve-RPC bereinigen beziehungsweise blockieren sie serverseitig. Für v0.3 ist ein Supabase-Cron-Aufruf von `expire_stale_minions` die bevorzugte autoritative Timeout-Lösung.

## Realtime-Entscheidung

Für den Prototyp wird Postgres Changes auf `events`, `bosses`, `milestones`, `minion_events` und `streamers` verwendet. Das ist direkt reproduzierbar. Für größere Last ist ein Wechsel auf private Broadcast-Channels vorgesehen; die Provider-Schnittstelle bleibt dabei stabil.

## Nächste Produktionshärtung

- Rate Limits und strengere Action-spezifische Schemas
- private Broadcast-Channels für größere Zuschauerzahlen
- Monitoring, Alarmierung und Backup-/Restore-Probe
- Integrationstests gegen ein echtes lokales Supabase-Postgres
- erst danach Twitch-Ingest, Scheduler und balancierte Fairnesskurve
