# Supabase Setup für GitHub Pages

Diese Anleitung ersetzt für das neue statische Deployment die ältere serverbasierte Setup-Reihenfolge.

## 1. Projekt verbinden

Im Root des GitHub-Repositories:

```powershell
npx supabase login
npx supabase link --project-ref DEINE_PROJECT_REF
```

## 2. Datenbank und Startdaten anwenden

Für ein neues leeres Supabase-Projekt:

```powershell
npx supabase db push --include-seed
```

Niemals `db reset` gegen das Produktivprojekt verwenden.

## 3. Edge Functions deployen

```powershell
npx supabase functions deploy admin-event-action
npx supabase functions deploy process-passive-tick
npx supabase functions deploy twitch-sync --no-verify-jwt
npx supabase functions deploy twitch-eventsub --no-verify-jwt
npx supabase functions deploy minion-action --no-verify-jwt
npx supabase functions deploy minion-tick --no-verify-jwt
```

## 4. Eigene Function Secrets

Unter **Edge Functions → Secrets** nur diese Werte anlegen:

```text
PASSIVE_TICK_ENABLED=false
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_EVENTSUB_SECRET=...
TWITCH_EVENTSUB_CALLBACK_URL=https://DEINE_PROJECT_REF.supabase.co/functions/v1/twitch-eventsub
MINION_PARTICIPANT_PEPPER=...
```

Nicht selbst anlegen:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
SUPABASE_PUBLISHABLE_KEYS
SUPABASE_SECRET_KEYS
```

Supabase stellt diese Werte gehosteten Edge Functions automatisch bereit. Das Präfix `SUPABASE_` ist reserviert.

## 5. Browser-Key

Unter **Settings → API Keys** den `sb_publishable_...` Key kopieren. Er wird als GitHub Repository Variable `SUPABASE_PUBLISHABLE_KEY` und einmalig im StreamElements Widget verwendet.

Niemals `sb_secret_...`, den Legacy Service-Role-Key, Twitch Secrets oder den Participant Pepper in GitHub Pages beziehungsweise StreamElements einbauen.

## 6. Admin zuweisen

Unter **Authentication → Users** ein Konto anlegen. Dessen UUID im SQL Editor zuweisen:

```sql
insert into public.event_admins (event_id, user_id, role)
select id, 'AUTH-USER-UUID'::uuid, 'owner'
from public.events
where slug = 'halloween-2026';
```

## 7. Scheduler

Cron, `pg_cron`, `pg_net` und Vault aktivieren. Anschließend die Vorlagen unter `supabase/scheduler/` mit serverseitig in Vault hinterlegten Werten konfigurieren.
