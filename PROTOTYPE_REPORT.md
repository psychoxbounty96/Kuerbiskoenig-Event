# Prototype Report v0.1

## Umgesetzt

- responsive öffentliche Eventseite mit Bossfokus, HP, Prozent, Phase, Meilenstein, globalen Statistiken, Rangliste, Teilnehmerliste und Fairnesshinweis
- kompaktes transparentes Overlay mit weicher HP-Animation und dezentem Hit-Effekt
- lokales Adminpanel mit fünf Damage-Presets, Reset, direkter HP-Eingabe, Phasentest und Eventstatus
- datengetriebenes Geist-Minionevent mit 60-Sekunden-Countdown, Erfolg, Fehlschlag und 5.000 Schaden bei Erfolg
- automatische vierstufige Phasenberechnung aus Boss-HP
- gemeinsamer LocalStateProvider mit localStorage, BroadcastChannel und Storage-Fallback
- begrenztes lokales Eventlog
- vorbereitete `calculatePassiveDamage`-Schnittstelle ohne finale Balancingwerte
- vollständige Architektur-, Supabase-, Roadmap- und Streamer-Setup-Dokumentation

## Start und Tests

Nach `npm install` startet `npm run dev` den Prototyp. Die Routen `/`, `/overlay` und `/admin` in getrennten Tabs öffnen. Schaden, Phase und Geist-Event lassen sich im Adminpanel auslösen. `npm test` führt Produktions-Build und Routen-Smoke-Test aus.

## Mockbestandteile

Bossstate, Streamerdaten, Rangliste, Teilnehmerzahlen, Damage-Aktionen, Minionevents, Logging und Echtzeitsynchronisierung sind lokal. Es gibt keine Verbindung zu Supabase, Twitch oder Discord.

## Bekannte Einschränkungen

- State ist pro Browserprofil und Origin lokal; verschiedene Geräte teilen ihn nicht.
- Das Adminpanel ist im Prototyp nicht authentifiziert und darf nicht als Produktionsadmin veröffentlicht werden.
- Overlay nutzt eine CSS-Platzhalterfigur; finale Sprites und Sounds fehlen bewusst.
- Ein reales StreamElements-Custom-Widget-Paket ist für die spätere Onboarding-Version vorgesehen.
- Der Minion-Countdown wird von offenen Clients beobachtet; in Produktion muss der Server Ablauf und Auflösung autoritativ bestimmen.

## Schritte zu Supabase

Schema und RLS anlegen, Provider implementieren, Realtime abonnieren, Edge Functions für Damage/Minions bauen, atomare HP-Updates und Idempotenz absichern, Adminrollen und Auditansicht einführen.

## Schritte zu Twitch

OAuth und Tokenablage serverseitig umsetzen, EventSub-Signaturen prüfen, Live-/Viewer-Daten ingestieren, Chatkommandos normalisieren, Raid-Events idempotent verarbeiten und Streamer-Onboarding testen.

## Technische Risiken

- Race Conditions bei gleichzeitigem Schaden
- doppelte Webhook-/Retry-Ereignisse
- Bigint-Serialisierung und Rundungsfehler
- Missbrauch offen erreichbarer Mutationsendpunkte
- schwankende Viewerzahlen und unfaire Kurvenparameter
- Realtime-Reconnects und veraltete Overlay-Snapshots

## Empfehlung für v0.2

Zuerst einen minimalen Supabase-Pfad für ausschließlich lesenden Bossstate plus eine einzige atomare `apply-damage`-Edge-Function bauen. Danach Realtime und Adminauthentifizierung ergänzen. Twitch und finale Balancingformeln sollten erst auf dieser verifizierten Servergrenze aufsetzen.
