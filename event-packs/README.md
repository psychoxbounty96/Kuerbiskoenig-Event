# Event packs

Event packs contain declarative content and presentation metadata. They never contain credentials,
privileged JavaScript or direct database mutations. The engine validates a pack before it can be
built or seeded.

Each event instance in Supabase pins a `pack_key` and `pack_version`. Runtime state stays in the
database; a pack is the versioned definition used to create and render that state.

A pack owns:

- event targets and whether they expose test controls;
- theme, public copy, boss, any number of phases and milestones;
- named damage classes, encounters and safe visual effects;
- question pools and declarative runtime generators;
- static or sprite-sheet asset descriptors;
- scheduling and integration presentation metadata.

It never owns Supabase credentials, Twitch credentials, participant records or live runtime state.
Create a new directory with a `pack.json`, add it to `event-packs/registry.ts`, then run
`npm run validate:packs`. `npm run pack:register -- --pack <key>` can register the release from a
trusted operator environment. Adding `--event-id <uuid>` applies it to an inactive event; adding
`--reset-boss` also starts a fresh boss run. Never expose the required service-role key to a browser.

Pack versions are immutable release identities in normal operation. Publish a new version rather
than silently changing the presentation or rules of a running event.
