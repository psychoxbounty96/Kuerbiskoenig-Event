# Supabase Backend – genaue Reihenfolge

Alle Befehle werden im Root des vollständigen GitHub-Repositories ausgeführt, nicht in diesem Teilpaket.

## 1. Projekt verbinden

```powershell
npx supabase login
npx supabase link --project-ref DEINE_PROJECT_REF
```

## 2. Datenbank inklusive Startdaten anwenden

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

## 4. Nur eigene Function Secrets anlegen

Unter **Edge Functions → Secrets**:

```text
PASSIVE_TICK_ENABLED          false
TWITCH_CLIENT_ID              aus der Twitch Developer Console
TWITCH_CLIENT_SECRET          aus der Twitch Developer Console
TWITCH_EVENTSUB_SECRET        zufällige 10–100 Zeichen
TWITCH_EVENTSUB_CALLBACK_URL  https://DEIN_PROJEKT.supabase.co/functions/v1/twitch-eventsub
MINION_PARTICIPANT_PEPPER     mindestens 32 zufällige Zeichen
```

Nicht selbst anlegen:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
```

Diese Namen sind reserviert und werden von Supabase automatisch bereitgestellt.

## 5. Admin anlegen

Im Dashboard unter **Authentication → Users** einen Organisator-Benutzer anlegen. Dessen User UUID anschließend im SQL Editor dem gewünschten Event zuweisen:

```sql
insert into public.event_admins (event_id, user_id, role)
select id, 'DEINE_AUTH_USER_UUID'::uuid, 'owner'
from public.events
where slug = 'halloween-2026';
```

Erst danach Twitch IDs, Subscriptions und Scheduler über das Adminpanel konfigurieren.
