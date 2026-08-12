# Deployment-Status

Stand: 12. August 2026

## GitHub

- Repository: `psychoxbounty96/Kuerbiskoenig-Event`
- GitHub Pages: `https://psychoxbounty96.github.io/Kuerbiskoenig-Event/`
- Deployment-Quelle: GitHub Actions
- Repository-Variablen: `EVENT_SLUG`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- Website, Adminroute (`/admin/`) und Overlay-Preview (`/overlay/`) werden erfolgreich gebaut.

## Supabase

- Projekt-Ref: `xydyeibmbxoaeyxocyoa`
- Die Migrationen v0.2, v0.3, Zero-Config und v0.4 sind angewendet.
- Der Supabase-Migrationsverlauf wurde mit diesen vier bereits angewendeten Migrationen abgeglichen.
- Die sechs Edge Functions `admin-event-action`, `process-passive-tick`, `twitch-sync`, `twitch-eventsub`, `minion-action` und `minion-tick` sind deployt.
- Die benötigten benutzerdefinierten Edge-Function-Secrets sind hinterlegt. Secret-Werte werden nicht im Repository dokumentiert.

## Bewusst noch nicht aktiviert

- Das Produktionsevent `halloween-2026` bleibt im Status `draft`.
- Twitch- und Minion-Cronjobs bleiben bis zur gewünschten Test-/Startphase deaktiviert, um keine unnötigen Daueraufrufe zu erzeugen.
- Die Adminoberfläche benötigt ein Supabase-Auth-Konto, das zusätzlich in `event_admins` für das Event freigeschaltet ist.
- Das StreamElements Widget wird weiterhin separat über den vorgesehenen Share-Link verteilt.

## Betriebsregel

Das Produktionsevent, automatische Zeitpläne und echte Bossmutationen werden erst nach einem bewussten Start-/Testentscheid aktiviert. GitHub Pages bleibt dabei unverändert unter der oben genannten URL erreichbar.
