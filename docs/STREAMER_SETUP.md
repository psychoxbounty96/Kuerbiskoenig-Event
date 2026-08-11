# Streamer-Setup – Share-Link, OBS, fertig

Teilnehmende Streamer benötigen keine Twitch Developer App, keine OAuth-Anmeldung und keine technischen Eventwerte.

## Teilnehmeranleitung

1. Öffne den bereitgestellten StreamElements Share-Link.
2. Übernimm das Overlay in deinen StreamElements-Account.
3. Füge den Overlay-Link als Browserquelle in OBS ein.
4. Fertig.

Das Widget erkennt den Twitch-Kanal automatisch über StreamElements. Es müssen weder Streamer-ID, `streamerSlug`, Twitch Login, Twitch User ID, Event-ID, `eventSlug`, Supabase-Werte noch Tokens eingegeben werden.

Wenn im Editor „Kanal nicht freigeschaltet“ erscheint oder das Overlay im Live-Output unsichtbar bleibt, wende dich an die Eventorganisation. Der Share-Link registriert niemals automatisch neue Teilnehmer.

Vor dem offiziellen Start kann ein freigeschalteter Kanal „Overlay erfolgreich verbunden · Event startet bald“ sehen. Sobald die Organisation das Event aktiviert, startet das bereits eingebundene Widget automatisch. Pause und Fortsetzung benötigen ebenfalls keine Aktion des Streamers.

## Organisator-Workflow

Diese Schritte gehören ausschließlich zur Eventorganisation:

1. Streamer im Adminpanel mit Display Name und korrektem Twitch Login anlegen.
2. `Enabled` aktivieren; Twitch User ID, URL und Avatar sind für die erste Widget-Zuordnung optional.
3. Das eventgebundene StreamElements Widget testen und genau dessen Share-Link versenden.
4. Event zunächst als `draft`/`testing` vorbereiten und später zentral auf `active` setzen.

Der Twitch Login wird lowercase gespeichert und muss pro Event eindeutig sein. Es gibt keinen zusätzlichen Pairing-Code.

## Development / Debug only

Die Route `/overlay?streamer=knoobbi&event=halloween-2026-test` und die Konstanten `DEV_STREAMER_OVERRIDE`/`DEV_EVENT_OVERRIDE` dienen ausschließlich lokaler Entwicklung. Sie sind kein Teil des Teilnehmer-Onboardings und müssen im verteilten Widget deaktiviert bleiben.

Chat-Minispiele funktionieren automatisch über die nativen StreamElements Widget Events. Der Command lautet `!boss` und wird vollständig in der temporären Infobox erklärt. Streamer müssen keinen Command, Bot, OAuth-Zugriff oder Minionwert konfigurieren.

Development- und Admin-Simulatoren sind keine Teilnehmer-Schritte. Das Streamer-Onboarding bleibt trotz v0.4 unverändert: Share-Link importieren, OBS-Browserquelle hinzufügen, fertig.
