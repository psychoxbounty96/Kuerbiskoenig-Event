# Astro integration

This package is the headless boundary between an Astro website such as `pxblabs.de` and the event
engine. It deliberately ships no event design. Astro owns routing, SEO, product navigation and the
visual page; the adapter only loads the public, RLS-protected event projection.

Server-rendered Astro pages can call `loadPublicEventForAstro()` in frontmatter. Interactive islands
can create `PublicEventClient`, subscribe to Realtime updates and retain the periodic refresh fallback.
Only the Supabase URL, the browser-safe publishable key and an explicit event slug are accepted.

```astro
---
import { loadPublicEventForAstro } from "@pxb/event-engine-astro";

const state = await loadPublicEventForAstro({
  supabaseUrl: import.meta.env.PUBLIC_EVENT_SUPABASE_URL,
  publishableKey: import.meta.env.PUBLIC_EVENT_SUPABASE_KEY,
  eventSlug: Astro.params.eventSlug ?? "",
});
if (!state) return Astro.redirect("/events");
---

<section data-event={state.event.slug}>
  <h1>{state.event.name}</h1>
  <p>{state.boss.current_hp} / {state.boss.max_hp}</p>
</section>
```

Never expose a service-role key to Astro client code.
