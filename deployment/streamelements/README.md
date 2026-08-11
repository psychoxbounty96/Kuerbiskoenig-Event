# StreamElements Übergabe

Verwendet werden ausschließlich die Dateien aus `streamelements-widget/`:

- `widget.html` → HTML
- `widget.css` → CSS
- `widget.js` → JS
- `fields.json` → Fields

Vor dem Share-Link trägt der Organisator oben in `widget.js` ein:

```javascript
const SUPABASE_URL = "https://DEIN_PROJEKT.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_...";
const WIDGET_EVENT_SLUG = "halloween-2026";
```

Diese drei Werte sind browseröffentlich. Twitch Secrets, Supabase Secret-/Service-Role-Key und Participant Pepper dürfen niemals in das Widget.

Danach Share-Link erstellen. Der Streamer importiert ihn und fügt den Overlay-Link in OBS ein; die Kanalzuordnung geschieht automatisch über `onWidgetLoad → channel.username`.
