# Kürbiskönig – Community Boss Event v0.4

Das Projekt besteht aus drei klar getrennten Teilen:

1. **GitHub Pages** veröffentlicht Website, Adminoberfläche und Overlay-Preview als statische React-Anwendung.
2. **Supabase** betreibt Datenbank, Auth, Realtime, Edge Functions, Twitch/EventSub und die serverautorititative Minion Engine.
3. **StreamElements** ist das einzige produktive Stream-Overlay und erkennt den freigeschalteten Twitch-Kanal automatisch.

Es gibt keine ChatGPT-Sites-, Bot-, OBS-Plugin-, Discord-/PXB-ComBot-, Economy- oder Reward-Abhängigkeit.

## Startpunkt für die Einrichtung

Die verständliche Rollen- und Ordnertrennung steht in [deployment/START_HIER.md](deployment/START_HIER.md). Mit

```bash
npm run package:deployment
```

entsteht neben dem Repository ein Ordner `KUERBISKOENIG_DEPLOYMENT_KIT` mit:

- `01_GITHUB_REPOSITORY`
- `02_SUPABASE_BACKEND`
- `03_STREAMELEMENTS_WIDGET`

## GitHub Pages

Der Web-Client ist vollständig statisch. Die drei Einstiege werden nach `github-pages-dist/` gebaut:

- `/` – öffentliche Eventseite
- `/admin/` – Supabase-geschütztes Adminpanel
- `/overlay/` – lokale/technische Overlay-Preview

Der Workflow [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) veröffentlicht bei jedem Push nach `main`. Im GitHub-Repository werden unter **Settings → Secrets and variables → Actions → Variables** nur folgende browseröffentliche Werte angelegt:

```text
EVENT_SLUG
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Keine geheimen Werte werden in GitHub Pages eingebaut. Die Adminseite selbst ist öffentlich abrufbar, aber Login, Rollenprüfung und Mutationen werden durch Supabase Auth, RLS und serverseitige Funktionen geschützt.

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Ohne lokale Umgebungswerte startet die Website absichtlich im Mockmodus. Für einen lokalen Supabase-Build `.env.production.local` nach [deployment/github-pages/README.md](deployment/github-pages/README.md) anlegen.

## Supabase

Das komplette Backend liegt unter `supabase/`:

- `migrations/` – Tabellen, Constraints, RLS, RPCs und Engine
- `functions/` – Admin, Twitch, EventSub und Minion-Endpunkte
- `scheduler/` – Twitch- und Minion-Zeitpläne
- `seed/` – getrenntes Test- und vorbereitetes Produktionsevent

Die genaue sichere Deploymentreihenfolge steht in [deployment/supabase/README.md](deployment/supabase/README.md).

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` werden in gehosteten Edge Functions automatisch bereitgestellt. Sie dürfen nicht als eigene Secrets angelegt werden. Eigene Secrets sind ausschließlich Twitch-Werte, EventSub Secret, Callback URL, Minion Pepper und der deaktivierte Passive-Tick-Schalter.

## StreamElements

Das produktive Widget liegt unter `streamelements-widget/`. Der Organisator hinterlegt einmalig die browseröffentliche Supabase URL, den Publishable Key und den festen Eventslug. Danach wird der Share-Link verteilt. Streamer konfigurieren keine ID, keinen Slug, keinen Bot und kein OAuth.

Chat läuft nativ über `onEventReceived`. Der Client meldet ausschließlich die Aktion; Damage, Deduplizierung, Zeitfenster und Auflösung entscheidet Supabase.

## Enthalten

- gemeinsamer globaler Boss mit atomaren Damage-Mutationen
- Zero-Configuration StreamElements Identity
- Twitch Live-State, Viewer Samples, Sessions, EventSub und Raids
- parallele streamerbezogene Minions
- `PARTICIPATION`, `VOTE`, `VISUAL_CHOICE` und `MEMORY`
- Ghost, Zombiehorde, Spinnenkönigin, Hexe, Fledermäuse, Sensenmann und Raid-Herold
- einheitlicher Command `!boss`
- sieben maximal 15 Sekunden lange Curse-Placeholder
- Realtime, Fallback-Refresh und serverzeitbasierte Recovery
- Admin-Debugger und Chat-Simulator

## Prüfung

```bash
npm test
```

Der Lauf prüft TypeScript, ESLint, Standalone-Widget, statischen Pages-Build, alle drei HTML-Einstiege, GitHub-Workflow, Supabase-/Twitch-/Minion-Verträge sowie Domainlogik.

## Dokumentation

- [GitHub Pages Setup](docs/GITHUB_PAGES_SETUP.md)
- [Supabase Setup für GitHub Pages](docs/SUPABASE_GITHUB_PAGES_SETUP.md)
- [Twitch Setup](docs/TWITCH_SETUP.md)
- [Streamer Setup](docs/STREAMER_SETUP.md)
- [Architektur](docs/ARCHITECTURE.md)
- [Minion Engine](docs/MINION_ENGINE.md)
- [Minion Game Design](docs/MINION_GAME_DESIGN.md)
- [v0.4 Abschlussbericht](V0_4_REPORT.md)
