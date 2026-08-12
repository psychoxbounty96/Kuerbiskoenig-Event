# Zero-Configuration Onboarding Report

## Ergebnis

Das Produktions-StreamElements-Widget benötigt keine manuelle Streamer- oder Eventzuordnung mehr. Die bisher sichtbaren Fields `streamerSlug` und `eventSlug` wurden entfernt. Der Teilnehmer übernimmt nur den Share-Link und bindet das Overlay in OBS ein.

## Automatische Kanalidentität

`onWidgetLoad` liest `obj.detail.channel.username`. Der Wert wird ausschließlich mit `trim()` und `toLowerCase()` normalisiert. Display Name und Twitch Login bleiben getrennte Felder. Twitch User ID ist für diese erste Zuordnung nicht erforderlich.

## Eventscoping und Lookup

Jede verteilte Widget-Version besitzt einen fest eingebauten `WIDGET_EVENT_SLUG`. Das Widget sucht niemals das „erste aktive Event“. Das öffentliche, unprivilegierte RPC `resolve_stream_elements_identity(eventSlug, twitchLogin)` prüft nur dieses Event und liefert einen klaren Identity-Status sowie bei Erfolg minimale Teilnehmerdaten zurück.

Ein Treffer erfordert denselben normalisierten `streamers.twitch_login` und einen bereits aktivierten Teilnehmer. Es findet kein `INSERT`, keine Einladung und kein automatisches Pairing statt.

## Unbekannte und deaktivierte Kanäle

Unbekannte Kanäle erhalten `not_registered`, deaktivierte Teilnehmer `disabled`. Beide Zustände blenden Boss, Minions und Eingaben im normalen Live-Output aus. Ein fehlender Kanalname oder mehrdeutige Daten führt zu `error` und ebenfalls zu einem sicheren, unsichtbaren Overlay. Technische Details erscheinen nur im Debuglog.

## Eventstart und Pause

Freigeschaltete Widgets zeigen in `draft`/`testing` einen dezenten Pre-Launch-Status. Der Adminbereich kann das Event zentral auf `active` setzen. Der regelmäßige 30-Sekunden-Refresh erkennt Aktivierung, Deaktivierung, Pause und Resume ohne neuen Share-Link oder erneuten Import. Streamerbezogene Minions werden ausschließlich per aufgelöster Streamer-ID ausgewählt.

## Development Fallback

`/overlay?streamer=…&event=…` bleibt als lokale Preview erhalten. Im Standalone-Widget existieren zusätzlich die eindeutig als Debug only markierten Konstanten `DEBUG_IDENTITY`, `DEV_STREAMER_OVERRIDE` und `DEV_EVENT_OVERRIDE`. Der Produktionswert ist deaktiviert; der normale Pfad verwendet immer StreamElements `channel.username`.

## Datenbankänderungen

Die Migration `202608110003_zero_config_onboarding.sql`:

- normalisiert bestehende Twitch Logins auf lowercase/trim,
- ergänzt einen Normalisierungs-Constraint und Trigger,
- erzwingt einen eindeutigen nichtleeren Twitch Login pro Event,
- bricht bei bereits vorhandenen normalisierten Duplikaten kontrolliert ab,
- ergänzt das eventgebundene Read-only-Identity-RPC für `anon`/`authenticated`,
- verändert keine bestehenden öffentlichen Schreibrechte.

Der Admin-Endpunkt normalisiert neue Logins ebenfalls, weist Duplikate verständlich zurück und löscht bei einer Loginänderung weiterhin die veraltete Twitch User ID.

## Sicherheit

Das Widget bleibt ein anonymer öffentlicher Read-only-Client. Ein erkannter Username gewährt weder Adminrechte noch Bossmutationen. Es werden keine StreamElements-Tokens verwendet, gespeichert oder an eigene Endpoints gesendet. Twitch-, EventSub- und Service-Role-Secrets bleiben serverseitig. Ein separater Bot oder der PXB ComBot ist keine Abhängigkeit.

## Tests

Geprüft werden exakte, case-insensitive und whitespace-normalisierte Auflösung, unbekannte/deaktivierte/falsche Events, Duplikate, fehlender Channel, Pre-Launch → Active, Pause → Resume, Chatadapter-Scoping, leere Widget Fields, `onWidgetLoad`-Vertrag, eventgebundenes RPC, Unique Constraint und fehlende automatische Registrierung. Der Abschlusslauf umfasst 34 erfolgreiche Tests sowie Typecheck, ESLint und Produktionsbuild.

## Offene Einschränkungen

Der Eventbetreiber muss je Eventversion weiterhin einmalig browser-sichere Supabase-Projektwerte und den festen Eventslug in den Widget-Build einsetzen. Das ist Share-Link-/Deploymentkonfiguration, keine Streamer-Konfiguration. Die reale Supabase-Migration und der StreamElements-Share-Link müssen mit den produktiven Projektwerten ausgerollt werden. SQL-/RLS-Verträge sind automatisiert geprüft; ein lokaler `supabase db lint` war ohne laufenden lokalen Postgres-Stack nicht möglich.

## Spätere Teilnehmeranleitung

1. StreamElements Share-Link öffnen.
2. Overlay übernehmen.
3. Overlay-Link als OBS-Browserquelle einfügen.
4. Fertig.

Bei „Kanal nicht freigeschaltet“ kontaktiert der Streamer die Eventorganisation.
