# v0.3 Abschlussbericht

## Ergebnis

Die v0.1-/v0.2-Oberflächen und die bestehende Supabase-Damage-Architektur wurden additiv um eine Twitch Awareness Layer ergänzt. Twitch-Logins, Live-State, aggregierte Viewerzahlen, 120-Sekunden-Samples, Stream-Sessions, EventSub und Raids besitzen nun eine persistente, serverseitige Datenbasis.

## Server und Datenbank

- zentraler App-Token-Client mit Ablaufbehandlung, 401-Retry und 100er-Batches
- getrennte Runtime-, Sample-, Session-, Raid-, Message-, Subscription-, Health- und Logtabellen
- Polling-Recovery für verpasste EventSub-Online-/Offline-Zustände
- Session-Rekonstruktion über Twitch Stream ID und `started_at`
- Average/Peak/Sample Count/Duration bei laufender und beendeter Session
- keine personenbezogenen Zuschauerfelder
- RLS und entzogene Client-Schreibrechte für alle v0.3-Tabellen

## EventSub

Der Webhook liest den Body exakt einmal als Text und verifiziert vor `JSON.parse` HMAC, Message-ID und frischen Timestamp. Verarbeitet werden ausschließlich `stream.online`, `stream.offline`, `channel.raid`, Challenge und Revocation. Die Message-ID-Tabelle verhindert doppelte Session-/Raidwirkungen und erlaubt einen erneuten Versuch nach internem Fehler.

Der Subscription-Sync arbeitet global pro Twitch App/Callback, erstellt fehlende Online-/Offline-/Raid-Subscriptions, entfernt verwaltete Duplikate und räumt deaktivierte Streamer auf. From- und To-Raidbedingungen bleiben getrennt.

## UI und StreamElements

Die Website kann beliebig viele parallele Live-Streamer mit Viewerzahl verlinken. Das Adminpanel zeigt Twitch-ID, Live-State, Viewer, Start, Sync, Stream ID, Sessionstatistik, Health, Webhook- und Subscriptionstatus. Eine Raid-Simulation erzeugt `manual_test`, aber weder Schaden noch Bonus.

Der Zero-Configuration-Patch entfernt `eventSlug` und `streamerSlug` aus den sichtbaren Widget Fields. `onWidgetLoad` liest nun `channel.username`, löst den normalisierten Login innerhalb des fest gebundenen Events auf und filtert Minions über die aufgelöste Streamer-ID. Der Chatadapter ist dokumentiert und absichtlich deaktiviert; EventSub bleibt für globale Raids authoritative.

## Passive Damage Safety

v0.3 enthält keine Damage-Kurve. `calculatePassiveDamagePreview` liefert nur `null`; `viewer_samples.passive_damage_preview` muss per SQL-Constraint `NULL` bleiben. Die v0.3-Migration und Twitch-Funktionen rufen `apply_boss_damage` nicht auf. Twitch API Error, Viewer 0, Stream Online/Offline und Raid können daher keine Boss-HP verändern.

## Testabdeckung

Automatisiert geprüft werden Client Credentials, gültige/ungültige Resolution, fehlende Credentials, Multi-Live-Plan, Offline-Recovery, Viewer-Normalisierung und Idempotency-Bucket, interne/externe Raids, getrennte Raid-Subscriptions, HMAC/Freshness, Widget-Identität sowie SQL-/Edge-Security-Verträge. Der Produktionsbuild rendert Website, Overlay und Admin.

Der ursprüngliche v0.3-Abschlusslauf bestand 23 Tests. Der nachgelagerte Zero-Configuration-Patch ergänzt eigene Domain-, SQL- und Widget-Vertragstests; sein aktuelles Ergebnis ist in `ZERO_CONFIG_ONBOARDING_REPORT.md` dokumentiert.

## Betriebsgrenzen

Ohne echte Twitch-/Supabase-Credentials kann das Repository nur den vollständigen Mock- und Contract-Test ausführen. Vor Produktivbetrieb sind Migration und Functions in einem Supabase-Projekt zu deployen, Challenge/Notification mit Twitch zu verifizieren und der Cronjob über Vault zu aktivieren. `process-passive-tick` bleibt deaktiviert.

## Future Work

Reale Samples zuerst sammeln und analysieren. Passive Damage, Balancing, Chat-Minions, Raid-Bonus/Elite-Minion, Discord, Giveaways, Economy, Achievements und individuelles Viewer-Tracking benötigen jeweils einen separaten Auftrag und sind nicht Teil von v0.3.
