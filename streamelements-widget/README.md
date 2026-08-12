# StreamElements Custom Widget – Live Build

Der Betreiber nutzt nicht die Quelldateien direkt. Der eindeutige Buildpfad ist:

```bash
npm run build:widget
```

Danach liegen zwei eigenständige Pakete bereit:

- `dist/streamelements/production/` gehört fest zu `halloween-2026` und enthält nur visuelle Felder.
- `dist/streamelements/test/` gehört fest zu `halloween-2026-test` und enthält die Operator-Testbuttons.

In StreamElements wird jeweils kopiert:

| StreamElements Tab | Builddatei |
| --- | --- |
| HTML | `html.html` |
| CSS | `css.css` |
| JS | `js.js` |
| FIELDS | `fields.json` |

Die Dateien haben keine unresolved Imports, keinen Node-/Vite-Runtimebedarf und keine lokalen URLs. Der browser-sichere Supabase Publishable Key, die Projekt-URL, der feste Eventslug und die HTTPS-Assetbasis werden beim Build eingebettet. Service Role, Twitch Secrets, EventSub Secret, Minion Pepper und Admin-Credentials sind niemals enthalten.

Boss- und Minion-Grafiken werden über feste GitHub-Pages-HTTPS-URLs geladen. Das Bossbild erscheint im permanenten kompakten HUD. Ein aktives Minion öffnet eine deutlich größere, mittig platzierte Encounter Stage. Die Artwork-Nodes werden wiederverwendet, damit der 250-ms-Countdown keine Bilder neu lädt oder sichtbar flackern lässt. Flüche sind immer auf den gesamten Viewport bezogen und nicht auf die HUD-Abmessungen begrenzt.

## Kanalidentität

`onWidgetLoad` liest `event.detail.channel.username`, normalisiert mit `trim().toLowerCase()` und löst ausschließlich innerhalb des fest eingebauten Events einen bereits aktivierten `streamers.twitch_login` auf. Es gibt keine sichtbaren Felder für Streamer-ID, Login, Eventslug oder Supabase-Konfiguration und keine automatische Registrierung.

## Live-Runtime

Das Widget lädt den event- und streamerbegrenzten State über `get_stream_elements_widget_state`, hört Supabase Realtime und führt bei jeder Änderung einen konsistenten Re-Fetch aus. Ein Fünf-Sekunden-Fallback behält den letzten sicheren State, synchronisiert periodisch neu und baut Realtime erneut auf. Chataktionen kommen ausschließlich über `onEventReceived` mit `listener === "message"` und gehen an `minion-action`.

Das Testpaket verarbeitet die von StreamElements dokumentierten `widget-button`-Events. Jeder Button ruft `widget-test-action` auf. Die Funktion autorisiert serverseitig `is_test_account = true` plus Eventstatus `testing`; der Client bestimmt niemals HP, Damage oder Success. Das Produktionspaket enthält keine Button Fields und deaktiviert den Testcode zusätzlich beim Build.

Die vollständige Operator-Anleitung steht in [LIVE_STREAMELEMENTS_TESTING.md](../docs/LIVE_STREAMELEMENTS_TESTING.md).
