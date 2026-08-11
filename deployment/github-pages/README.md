# GitHub Pages

Dieser Ordner enthält die drei statischen HTML-Einstiege für Website, Admin und lokale Overlay-Preview. `vite.config.ts` bündelt sie in `github-pages-dist/`.

## Repository Variables

```text
EVENT_SLUG
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Das sind absichtlich GitHub **Variables**, keine Secrets: URL und Publishable Key landen technisch im Browserbundle. RLS und serverseitige Edge Functions bilden die Sicherheitsgrenze.

Die Workflow-Datei `.github/workflows/deploy-pages.yml` baut auf jedem Push nach `main` und deployed anschließend über GitHub Actions. Für ein Repository `name/projekt` setzt Vite automatisch den Base Path `/projekt/`; bei `name.github.io` bleibt er `/`.

Lokale Mockvorschau:

```bash
npm install
npm run dev
```

Lokaler Supabase-Build: `.env.production.local` mit den folgenden Werten anlegen und `npm run build` ausführen:

```dotenv
VITE_DATA_PROVIDER=supabase
VITE_EVENT_SLUG=halloween-2026
VITE_SUPABASE_URL=https://DEIN_PROJEKT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_BASE_PATH=/DEIN_REPOSITORY/
```
