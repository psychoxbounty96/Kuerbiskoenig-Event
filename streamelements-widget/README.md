# PXB Event Engine Widget

This directory is the event-independent StreamElements renderer. Do not paste these source files
directly into StreamElements. Build a concrete, versioned event pack first:

```text
npm run build:widget -- --pack <pack-key>
```

Each target under `dist/streamelements/<pack-key>/<variant>/` contains the four standalone files
for StreamElements: `html.html`, `css.css`, `js.js` and `fields.json`.

The overlay name in StreamElements should be **PXB Event Engine Widget — <Event name>**. The widget
contains no service-role key, Twitch secret or administrator credential. Channel identity comes
from `onWidgetLoad`; event identity is pinned by the selected pack target.
