# GitHub Pages Setup

## 1. Repository erstellen

Auf GitHub ein leeres Repository anlegen. Danach den vollständigen Projektinhalt beziehungsweise den Inhalt von `KUERBISKOENIG_DEPLOYMENT_KIT/01_GITHUB_REPOSITORY` übertragen.

GitHub enthält bewusst auch `supabase/` und `streamelements-widget/`, weil beides versionierter Quellcode ist. Echte `.env`-Dateien und Secrets bleiben durch `.gitignore` ausgeschlossen.

## 2. Öffentliche Repository Variables

Unter **Settings → Secrets and variables → Actions → Variables** anlegen:

| Name | Beispiel |
| --- | --- |
| `EVENT_SLUG` | `halloween-2026` |
| `SUPABASE_URL` | `https://abcdefgh.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |

Diese Werte sind keine Secrets. Sie landen im Browser. Supabase RLS und die serverseitigen Funktionen schützen die Daten.

## 3. Pages aktivieren

Unter **Settings → Pages → Build and deployment** als Source **GitHub Actions** auswählen.

Der vorhandene Workflow baut automatisch:

```text
deployment/github-pages/site
        ↓ Vite
github-pages-dist
        ↓ GitHub Pages Action
öffentliche Pages URL
```

Bei einem normalen Projekt-Repository wird der Repositoryname automatisch als Base Path verwendet. Ein Repository `meinname/kuerbiskoenig` läuft dadurch unter `https://meinname.github.io/kuerbiskoenig/`.

## 4. Routen

- `/` – Website
- `/admin/` – Adminoberfläche
- `/overlay/?streamer=...` – Development-Preview

GitHub Pages ist statisch. Alle echten Daten, Logins, Mutationen, Twitch-Aufrufe und Scheduler bleiben in Supabase.

## 5. Sicherheit

Niemals als GitHub Variable, Secret oder Quellcode eintragen:

- `SUPABASE_SERVICE_ROLE_KEY` oder `sb_secret_...`
- Twitch Client Secret
- Twitch EventSub Secret
- `MINION_PARTICIPANT_PEPPER`
- Datenbankpasswort

Die Admin-HTML-Seite ist öffentlich erreichbar. Ohne gültigen Supabase-Login und Eintrag in `event_admins` kann sie keine privilegierte Aktion ausführen.
