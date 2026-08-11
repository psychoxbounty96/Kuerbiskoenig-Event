# Supabase Setup v0.4

## 1. Voraussetzungen

- Supabase-Projekt und Supabase CLI
- Node.js 22.13+
- Docker nur für den optionalen lokalen Supabase-Stack
- zentral verwaltete Twitch Developer Application

## 2. Datenbank reproduzieren

```bash
supabase start
supabase db reset
```

`db reset` spielt v0.2-Core, v0.3-Twitch-Migration, Zero-Configuration-Patch, v0.4-Minion-Engine und den getrennten Test-/Produktionsseed ein. Historische Tabellen sind RLS-geschützt; öffentliche Clients lesen Live-State über den Snapshot und lösen die StreamElements-Identität ausschließlich über das minimale Read-only-RPC auf.

## 3. Edge Functions und Secrets

```bash
supabase login
supabase link --project-ref DEIN_PROJECT_REF
supabase db push
supabase functions deploy admin-event-action
supabase functions deploy process-passive-tick
supabase functions deploy twitch-sync --no-verify-jwt
supabase functions deploy twitch-eventsub --no-verify-jwt
supabase functions deploy minion-action --no-verify-jwt
supabase functions deploy minion-tick --no-verify-jwt

supabase secrets set SUPABASE_URL=https://DEIN_PROJECT.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=DEIN_SERVICE_ROLE_KEY
supabase secrets set PASSIVE_TICK_ENABLED=false
supabase secrets set TWITCH_CLIENT_ID=DEINE_CLIENT_ID
supabase secrets set TWITCH_CLIENT_SECRET=DEIN_CLIENT_SECRET
supabase secrets set TWITCH_EVENTSUB_SECRET=EIN_ZUFAELLIGES_SECRET
supabase secrets set TWITCH_EVENTSUB_CALLBACK_URL=https://DEIN_PROJECT.supabase.co/functions/v1/twitch-eventsub
supabase secrets set MINION_PARTICIPANT_PEPPER=MINDESTENS_32_ZUFAELLIGE_ZEICHEN
```

`db push` muss auch `202608110004_v0_4_minion_engine.sql` anwenden. Die Zero-Config-Migration normalisiert Twitch Logins; v0.4 ergänzt private Chatteilnahmen, Runtime, Scheduler, Damage Classes und Flüche ohne öffentliche Schreibrechte.

`twitch-sync` deaktiviert die Plattform-JWT-Prüfung nur, um den Service-Role-Bearer selbst zeitkonstant prüfen zu können. `twitch-eventsub` benötigt ebenfalls `verify_jwt=false`, weil Twitch kein Supabase-JWT sendet; dort sind HMAC, Timestamp und Message-ID die Authentifizierungsgrenze.

## 4. Admin und Web-App

Einen Auth-Benutzer einmalig einem Event zuweisen:

```sql
insert into public.event_admins (event_id, user_id, role)
select id, 'AUTH-USER-UUID'::uuid, 'owner'
from public.events
where slug = 'halloween-2026-test';
```

Browserwerte in `.env.local`:

```dotenv
NEXT_PUBLIC_DATA_PROVIDER=supabase
NEXT_PUBLIC_EVENT_SLUG=halloween-2026-test
NEXT_PUBLIC_SUPABASE_URL=https://DEIN_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=DEIN_PUBLISHABLE_KEY
```

Optional ausschließlich für die lokale `/overlay`-Preview: `NEXT_PUBLIC_STREAMER_SLUG=knoobbi`. Das produktive StreamElements-Widget verwendet diese Variable nicht.

Keine Variable mit `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET` oder `SUPABASE_SERVICE_ROLE_KEY` darf ein `NEXT_PUBLIC_`-Präfix erhalten.

## 5. Scheduler

Im Supabase Dashboard Cron, `pg_cron`, `pg_net` und Vault aktivieren. Danach das geprüfte Beispiel [120-second-twitch-sync.sql.example](../supabase/scheduler/120-second-twitch-sync.sql.example) mit den eigenen Platzhaltern ausführen. Der Job ruft alle zwei Minuten `twitch-sync` auf; lokal bleibt derselbe Endpoint manuell testbar.

## 6. Sicherheits- und Funktionstest

1. Direkte Inserts mit Publishable Key müssen an Grants/RLS scheitern.
2. Ein nicht zugewiesenes Auth-Konto muss `not_an_event_admin` erhalten.
3. IDs auflösen und einen Live-/Offline-Sync im Admin ausführen.
4. Bei absichtlich falschen Twitch-Credentials darf kein Runtime-State auf Offline kippen und kein Sample entstehen.
5. Zwei parallele Streams müssen zwei Sessions/Samples erzeugen.
6. EventSub Challenge, gültige Notification, Revocation, ungültige HMAC und gleiche Message-ID zweimal testen.
7. Raid-Test speichern; Boss-HP davor/danach vergleichen – sie müssen identisch bleiben.
8. Test- und Produktionsevent getrennt auswerten.

Die vollständige Twitch-Reihenfolge steht in [TWITCH_SETUP.md](TWITCH_SETUP.md).

## 7. v0.4 Minion Engine

Nach den v0.2-/v0.3-/Zero-Config-Migrationen `202608110004_v0_4_minion_engine.sql` anwenden. Anschließend ein zufälliges `MINION_PARTICIPANT_PEPPER` mit mindestens 32 Zeichen als Supabase Secret setzen und `minion-action` sowie `minion-tick` deployen.

Den Scheduler aus `supabase/scheduler/10-second-minion-tick.sql.example` erst nach Hinterlegung von `project_url` und `service_role_key` in Vault aktivieren. `minion-action` ist der anonyme Soft-Trust-Chat-Eingang; das interne RPC und sämtliche Damage-/Resolve-Funktionen bleiben auf `service_role` beschränkt.

Vor Produktion mit einem isolierten Testevent prüfen: Admin-Spawn, reale `!boss`-Message, Duplicate User/Message, Timeout-Vote, Pause/Offline-Cancel, Curse-Ende und eligible Raid → 90–120 Sekunden → Herold. Der StreamElements-Client darf zu keinem Zeitpunkt Service Role oder Participant Pepper enthalten.
