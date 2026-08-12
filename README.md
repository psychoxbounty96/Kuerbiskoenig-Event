# Kürbiskönig – Community Boss Event v0.4

Das reale System läuft vollständig über vier vorhandene Dienste:

- StreamElements ist das einzige Stream-Overlay und empfängt den echten Twitch-Chat.
- Supabase betreibt Datenbank, Auth, Realtime, Edge Functions, Twitch/EventSub und die serverautoritative Boss-/Minion-Engine.
- GitHub enthält Sourcecode, Migrationen und die Widget-Builds.
- GitHub Pages veröffentlicht Eventseite und Adminoberfläche.

Es gibt keine Abhängigkeit von ChatGPT Pages, einem Betreiber-PC, lokalem Server, Twitch-/Discord-Bot, PXB ComBot, OBS-Plugin, Streamer.bot, Economy oder Reward-System.

## Produktiver und Operator-Betrieb

Der Betreiber testet den realen Pfad direkt in StreamElements gegen das Supabase-Produktivprojekt. Dafür existiert ein getrenntes Event `halloween-2026-test`; das Produktionsevent `halloween-2026` bleibt bis zur bewussten Aktivierung unberührt.

```text
Testkanal im Testevent freischalten
→ StreamElements Testwidget importieren
→ automatische Kanalauflösung
→ Supabase State + Realtime
→ echte Widget Buttons / echter Twitch Chat !boss
```

Die vollständige Anleitung und Testmatrix stehen in [LIVE_STREAMELEMENTS_TESTING.md](docs/LIVE_STREAMELEMENTS_TESTING.md). Dafür werden kein `npm run dev`, kein `localhost`, kein Docker und kein lokaler Supabase-Emulator benötigt.

## Standalone StreamElements Build

```bash
npm run build:widget
```

Der Befehl erzeugt:

- `dist/streamelements/production/` für `halloween-2026`, ohne Testbutton-Felder
- `dist/streamelements/test/` für `halloween-2026-test`, mit Operator-Testbuttons

Jedes Paket enthält `html.html`, `css.css`, `js.js`, `fields.json` und `manifest.json`. Die vier ersten Dateien werden in die gleichnamigen Bereiche eines StreamElements Custom Widgets kopiert. Es gibt keine unresolved Imports, lokale URLs oder Node-/Vite-Runtime im Ergebnis.

Der Browser darf ausschließlich diese öffentlichen Werte kennen:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
fester Eventslug des Builds
öffentliche HTTPS-Assetbasis
```

Niemals im Widget oder in GitHub Pages: Service Role, `sb_secret_...`, Twitch Client Secret, EventSub Secret, `MINION_PARTICIPANT_PEPPER` oder Admin-Credentials.

## Zero-Configuration Streamer-Setup

Ein normaler Teilnehmer öffnet den StreamElements Share-Link, übernimmt das Overlay und fügt es als OBS-Browserquelle ein. `onWidgetLoad` liest `channel.username`, normalisiert ihn und löst ausschließlich im fest eingebauten Event einen bereits aktivierten `streamers.twitch_login` auf. Kein Streamer gibt ID, Login, Eventslug, Supabase-Wert, Token oder Command-Konfiguration ein.

Siehe [STREAMER_SETUP.md](docs/STREAMER_SETUP.md).

## Supabase

Das Backend liegt vollständig unter `supabase/`:

- `migrations/`: Tabellen, Constraints, RLS, öffentliche Read-RPCs und Engine
- `functions/`: Admin, Twitch/EventSub, Minion-Action, Minion-Tick und autorisierte Widget-Testaktionen
- `seed/`: reproduzierbares Test- und vorbereitetes Produktionsevent
- `scheduler/`: spätere Cron-Konfiguration

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase gehosteten Edge Functions automatisch bereit. Deshalb können und sollen sie nicht als eigene Function Secrets angelegt werden. Eigene Secrets sind nur die in der Setup-Dokumentation genannten Twitch-/EventSub-Werte, der Minion Pepper und kontrollierte Scheduler-Schalter.

## GitHub Pages

Der statische Build veröffentlicht:

- `/` – öffentliche Eventseite
- `/admin/` – Supabase-geschütztes Adminpanel
- `/overlay/` – ausschließlich technische Entwickler-Preview, kein Betreiber-Testweg

Die Adminseite und öffentliche Seite müssen für den Eventbetrieb nicht offen sein. Der Workflow [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) nutzt nur die browseröffentlichen Repository Variables `EVENT_SLUG`, `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY`.

## Developer Tools

Lokale Mock-/Preview-Komponenten dürfen für Unit Tests oder Entwicklungsarbeit bestehen bleiben. Sie sind kein Nachweis für Live-Bereitschaft und kein Schritt in der Betreiber- oder Streameranleitung.

```bash
npm install
npm test
```

Der Testlauf prüft TypeScript, ESLint, beide Standalone-Widget-Builds, keine lokalen/privilegierten Werte im Widget, GitHub Pages, Supabase-/Twitch-/Minion-Verträge und Domainlogik.

## Dokumentation

- [Realer StreamElements Testbetrieb](docs/LIVE_STREAMELEMENTS_TESTING.md)
- [GitHub Pages Setup](docs/GITHUB_PAGES_SETUP.md)
- [Supabase Setup für GitHub Pages](docs/SUPABASE_GITHUB_PAGES_SETUP.md)
- [Twitch Setup](docs/TWITCH_SETUP.md)
- [Streamer Setup](docs/STREAMER_SETUP.md)
- [Architektur](docs/ARCHITECTURE.md)
- [Minion Engine](docs/MINION_ENGINE.md)
- [Minion Game Design](docs/MINION_GAME_DESIGN.md)
- [Live-Widget Abschlussbericht](LIVE_WIDGET_READINESS_REPORT.md)
