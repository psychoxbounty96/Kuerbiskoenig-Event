# Kürbiskönig Deployment – START HIER

Du brauchst drei Zielsysteme. Die Nummern entsprechen den Ordnern im erzeugten `KUERBISKOENIG_DEPLOYMENT_KIT`.

## 1. GitHub

Den vollständigen Inhalt von `01_GITHUB_REPOSITORY` in ein GitHub-Repository übertragen. GitHub enthält den gesamten Quellcode – einschließlich `supabase/` und `streamelements-widget/` – aber niemals echte Secrets.

Im Repository unter **Settings → Secrets and variables → Actions → Variables** genau diese drei öffentlichen Variablen anlegen:

```text
EVENT_SLUG                    halloween-2026
SUPABASE_URL                  https://DEIN_PROJEKT.supabase.co
SUPABASE_PUBLISHABLE_KEY      sb_publishable_...
```

Danach unter **Settings → Pages → Build and deployment → Source** den Eintrag **GitHub Actions** auswählen. Jeder Push auf `main` baut und veröffentlicht die statische Website automatisch.

## 2. Supabase

`02_SUPABASE_BACKEND` ist das Backendpaket. Die enthaltenen SQL-Dateien werden nicht einzeln im Dashboard hochgeladen. Stattdessen wird das GitHub-Projekt lokal mit Supabase verbunden und anschließend per CLI deployed. Die genaue Reihenfolge steht in `02_SUPABASE_BACKEND/README.md`.

Wichtig: `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` nicht als eigene Function Secrets anlegen. Supabase stellt beide automatisch bereit und reserviert das Präfix `SUPABASE_`.

## 3. StreamElements

In `03_STREAMELEMENTS_WIDGET` liegen die vier Custom-Widget-Bereiche. Der Organisator trägt einmalig Supabase URL, Publishable Key und Eventslug oben in `widget.js` ein und kopiert HTML, CSS, JS und Fields nach StreamElements. Der Streamer bekommt anschließend nur den Share-Link.

## Niemals veröffentlichen

- Twitch Client Secret
- Twitch EventSub Secret
- Supabase Secret-/Service-Role-Key
- Datenbankpasswort
- `MINION_PARTICIPANT_PEPPER`
- Supabase CLI Access Token

Die frühere ChatGPT-Sites-Version ist nicht Teil dieses Deploymentwegs. Der produktive Web-Client wird ausschließlich als statischer GitHub-Pages-Build veröffentlicht.
