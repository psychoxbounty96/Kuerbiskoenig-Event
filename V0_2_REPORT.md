# v0.2 Abschlussbericht

## Ergebnis

Der v0.1-Vertical-Slice wurde ohne Verlust der drei Oberflächen um einen optionalen Supabase-Produktionskern erweitert. Der Standarddeploy bleibt Mock-fähig, solange keine Supabase-Konfiguration gesetzt ist.

## Erhaltene v0.1-Funktionen

Öffentliche Bossseite, globale HP-Leiste, automatische Phasen, Meilensteine, Rangliste, Stream-Overlay, Geist-Proof-of-Concept, Admin-Damage-Presets, direkter HP-/Phasentest, lokaler Eventstate und Tab-Synchronisierung bleiben erhalten. Das Design wurde nur um kleine Status-, Auth- und Verwaltungsbereiche erweitert.

## Datenbank und Servergrenze

Elf RLS-geschützte Tabellen trennen Event-/Bossstate, konfigurierbare Phasen, Meilensteine, Streamer, Damage-Audit, Miniondefinitionen/-instanzen, Settings, Adminmitgliedschaften und Auditlog. `apply_boss_damage` ist die einzige zentrale Damage-Engine. Weitere RPCs setzen/resetten HP und verwalten den Minion-Lebenszyklus. `admin-event-action` prüft Supabase Auth und Eventrolle, bevor sie diese Service-Role-RPCs aufruft.

## Realtime und Provider

`NEXT_PUBLIC_DATA_PROVIDER=mock|supabase` schaltet die gemeinsame Provider-Schnittstelle um. Im Supabase-Modus lädt `get_public_event_state` den Snapshot. Postgres Changes stößt Aktualisierungen an; zusätzlich erfolgt alle 30 Sekunden ein Refetch. Bei Ausfall bleibt der letzte bekannte State sichtbar, während das Overlay beim Erstladen transparent bleibt.

## Testevent und Bedienung

Der Seed erstellt `halloween-2026-test` als sichtbares Testevent und `halloween-2026` getrennt als pausiertes Draft-Event. Das Adminpanel kennzeichnet die aktive Instanz. Der komplette Setup- und Rollenablauf steht in `docs/SUPABASE_SETUP.md`; der Mockmodus benötigt weiterhin keine externe Infrastruktur.

## Abnahmepunkte

| Bereich | Status | Nachweis |
|---|---|---|
| Provider-Umschaltung | umgesetzt | `MockDataProvider`, `SupabaseDataProvider`, `.env.example` |
| Schema und Seeds | umgesetzt | eine versionierte Migration, deterministischer Testseed, getrenntes Draft-Event |
| Auth und Rollen | umgesetzt | Supabase Auth + `event_admins`, Owner/Operator/Viewer |
| RLS | umgesetzt | alle elf Tabellen aktiviert; keine Browser-Schreibgrants |
| Atomarer Damage | umgesetzt | Row Lock, doppelter Idempotenzcheck, Unique Constraint, Clamping, Meilensteine |
| Adminaktionen | umgesetzt | Edge Function für Boss, Settings, Minions und Streamer Create/Edit/Enable/Disable |
| Parallel-Minions | umgesetzt | streamergebundener partieller Unique Index und Overlayfilter |
| Realtime/Fallback | umgesetzt | Postgres Changes + 30-Sekunden-Refresh |
| Test/Prod-Trennung | umgesetzt | `halloween-2026-test` und pausiertes `halloween-2026` |
| Dokumentation/Tests | umgesetzt | Setup, Architektur, Roadmap, Domain-/Contract-/Render-Tests |

## Sicherheitsnotizen

Die endgültige Damagezahl wird in SQL berechnet. Der Client übermittelt Rohschaden und Optionen, aber weder neue Boss-HP noch eine vertrauenswürdige Endsumme. Adminaktionen erfordern JWT und Eventmitgliedschaft. Service-Role-Zugriff bleibt in Edge Functions. Abgelaufene Minions können clientseitig nicht nachträglich erfolgreich gemacht werden.

## Offene Produktionsarbeit

Vor einem realen Publikum sind Lasttest, Monitoring, Rate Limits, Backup-/Restore-Probe und echte lokale Supabase-Integrationstests erforderlich. Twitch, aktive/passive Community-Aktionen und Fairnessbalancing sind absichtlich noch nicht aktiviert.

## Migration und Deployment

Da v0.2 eine neue, noch nicht produktiv angewendete Basismigration liefert, wird sie mit `supabase db push` oder lokal mit `supabase db reset` eingespielt. Vor einem bestehenden Fremdschema ist ein Review statt blindem Reset erforderlich. Edge Functions und Secrets werden separat deployed. Die Website bleibt ohne Service-Secret buildbar; der aktuelle öffentliche Preview-Deploy verwendet deshalb weiter den Mockprovider.

## Tests und bekannte Grenzen

`npm test` umfasst Typprüfung, Lint, Produktionsbuild, SSR-Smoke-Tests, Domain-Grenztests und statische Sicherheitsverträge für Migration/Edge Function. Eine echte PostgreSQL-Concurrency-Probe konnte ohne laufenden Docker-/Supabase-Stack nicht automatisiert ausgeführt werden; der SQL-Vertrag wird über `FOR UPDATE`, doppelten Idempotenzcheck und Unique Constraint abgesichert und muss in v0.3 zusätzlich gegen eine echte lokale Datenbank lastgetestet werden.

## Empfehlung für v0.3

Zuerst Action-Schemas, Rate Limits, private Broadcast-Channels und Datenbank-Integrationstests ergänzen. Danach Monitoring/Recovery erproben. Erst auf dieser Basis sollten Twitch-Ingest und experimentelles Balancing aktiviert werden.
