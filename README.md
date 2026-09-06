# PXB Community Event Engine

Eine eventunabhängige Engine für gemeinsame Twitch-Events. Supabase hält den autoritativen Zustand,
StreamElements stellt das Overlay bereit und versionierte Event-Packs liefern Inhalt und Gestaltung.
Die öffentliche Produktseite wird künftig als Astro-Oberfläche in `pxblabs.de` eingebunden.

> **Installationsstatus:** Supabase ist eine leere Engine-Installation. Es existieren keine Events,
> Streamer, Admin-Zuordnungen, Trackingdaten oder aktiven externen Integrationen. Das Pack
> `halloween-2026` liegt ausschließlich als noch nicht registrierte Inhaltsvorlage im Repository.

## Trennung der Bausteine

- `packages/event-engine`: reine Phasen-, Encounter-, Damage- und Animationslogik ohne Eventnamen.
- `packages/pack-schema`: validierter Vertrag für versionierte Event-Packs.
- `packages/astro-integration`: Headless-Client für Astro SSR und interaktive Realtime-Islands.
- `event-packs/<pack>/pack.json`: Boss, Phasen, Texte, Farben, Assets, Begegnungen, Effekte und Regeln.
- `streamelements-widget`: ein generischer Widget-Renderer; der Build bettet genau ein Pack und Eventziel ein.
- `supabase`: mandantenfähige Runtime, Twitch/EventSub, Realtime, sichere Mutationen und Pack-Registry.
- `app`: Admin und eine austauschbare Vorschauoberfläche; keine Voraussetzung für den Dauerbetrieb.

Ein Supabase-Event pinnt immer `pack_key` und `pack_version`. Dadurch können mehrere Events und
Designs gleichzeitig dieselbe Engine verwenden, ohne automatisch irgendein „aktives Event“ zu wählen.

## Häufige Befehle

```text
npm test
npm run validate:packs
npm run build:widget -- --pack halloween-2026
npm run build
```

Der Widget-Build liegt unter
`dist/streamelements/<pack-key>/<production|test>/` und enthält direkt einsetzbare Dateien für
HTML, CSS, JS und Fields. Statische Pack-Assets werden beim Build nach
`public/event-packs/<pack-key>/<version>/` synchronisiert. Sprite-Sheets können später im selben
Manifest an die Stelle statischer Bilder treten, ohne die Engine umzubauen.

Das Widget heißt unabhängig vom gewählten Inhalt **PXB Event Engine Widget**. Eventname, Farben,
Texte und Artwork werden erst beim Pack-Build eingebettet.

## Astro / pxblabs.de

`packages/astro-integration` liefert keine fertige Eventseite und kein Halloween-Design. Astro
entscheidet über Route, SEO, Navigation und Darstellung; der Adapter lädt ausschließlich den
öffentlichen, RLS-geschützten Eventzustand und hält ihn über Realtime plus Fallback aktuell.

## Sicherheit

Browser und Widget erhalten nur die Supabase-URL, einen Publishable Key, Packmetadaten und einen
festen Event-Slug. Service Role, Twitch-Secrets, EventSub-Secret und Participant Pepper bleiben in
Supabase. Pack-Manifeste dürfen keine Secrets oder ausführbaren privilegierten Code enthalten.

Interne Betreiber-, Wiederherstellungs- und Abschlussdokumentation wird absichtlich nicht in diesem
Repository geführt. Die kurze Teilnehmeranleitung steht in [docs/STREAMER_SETUP.md](docs/STREAMER_SETUP.md).
