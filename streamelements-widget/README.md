# StreamElements Custom Widget – Zero Configuration + Minion Engine v0.4

`widget.html`, `widget.css`, `widget.js` und `fields.json` werden in die vier Bereiche eines StreamElements Custom Widgets kopiert. Der Eventbetreiber hinterlegt vor dem Share-Link einmalig die browser-sichere Supabase-URL, den Publishable Key und den fest zu diesem Widget-Build gehörenden `WIDGET_EVENT_SLUG` in `widget.js`.

Teilnehmende Streamer konfigurieren keine Identitätswerte. Beim `onWidgetLoad` liest das Widget ausschließlich `obj.detail.channel.username`, normalisiert den Login mit `trim().toLowerCase()` und löst ihn innerhalb des fest eingebauten Events gegen einen bereits administrativ freigeschalteten Teilnehmer auf. `fields.json` enthält daher weder `streamerSlug` noch `eventSlug`, Twitch Login, IDs, Backendwerte oder Secrets.

Unbekannte und deaktivierte Kanäle werden niemals angelegt und erhalten keine Minions. Das Live-Overlay bleibt für sie standardmäßig vollständig unsichtbar. Draft/Testing zeigt einem erfolgreich erkannten Teilnehmer nur einen dezenten Pre-Launch-Status; bei `active` erscheint der Boss, bei Pause bleibt die Identität bestehen und das Widget setzt sich automatisch fort.

`DEBUG_IDENTITY`, `DEV_STREAMER_OVERRIDE` und `DEV_EVENT_OVERRIDE` sind ausschließlich lokale Entwicklungs-/Previewhilfen und müssen in jedem verteilten Share-Link deaktiviert beziehungsweise leer bleiben.

v0.4 verarbeitet native `onEventReceived`-Nachrichten mit `listener === "message"`. Das Widget filtert auf das automatisch aufgelöste Streamer-/Minion-Paar und sendet nur die Chataktion an `minion-action`; Damage, Success und Bossmutation bestimmt der Server. Es schreibt selbst keine Chatnachrichten und benötigt weder Bot noch OAuth.

Für Realtime lädt `widget.html` den browser-sicheren Supabase-Client. Stateänderungen führen zu einem konsistenten Re-Fetch, zusätzlich bleibt ein Fünf-Sekunden-Fallback aktiv. Countdown und Recovery nutzen persistierte Serverzeitpunkte. Globale Raid-Eligibility und die Raid-Herold-Queue bleiben ausschließlich bei Twitch EventSub/Supabase authoritative.
