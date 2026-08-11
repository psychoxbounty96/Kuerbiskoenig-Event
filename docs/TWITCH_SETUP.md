# Twitch Setup v0.3

Die Integration nutzt für öffentliche User-/Streamdaten einen serverseitigen App Access Token über den Client-Credentials-Flow. Teilnehmende Streamer müssen weder eine App anlegen noch einen individuellen OAuth-Flow durchführen.

## 1. Twitch Developer Application erstellen

Im [Twitch Developer Console](https://dev.twitch.tv/console/apps) eine zentrale App für das Event registrieren. Twitch beschreibt die Registrierung in der offiziellen [App Registration](https://dev.twitch.tv/docs/authentication/register-app/). Als OAuth Redirect URL eine eigene HTTPS-URL der Eventdomain hinterlegen; v0.3 startet dort keinen User-OAuth-Flow.

## 2. EventSub Callback URL festlegen

Die Webhook-Callback-URL lautet:

```text
https://DEIN_PROJECT.supabase.co/functions/v1/twitch-eventsub
```

Sie muss öffentlich per HTTPS erreichbar sein. Sie ist nicht identisch mit einem Browser-Secret und darf dokumentiert werden.

## 3. Client ID hinterlegen

```bash
supabase secrets set TWITCH_CLIENT_ID=DEINE_CLIENT_ID
```

## 4. Client Secret sicher hinterlegen

```bash
supabase secrets set TWITCH_CLIENT_SECRET=DEIN_CLIENT_SECRET
```

Der Client Credentials Flow ist in [Getting OAuth Access Tokens](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/) beschrieben. Das Backend cached den App Access Token nur im Speicher, berücksichtigt den Ablauf und erneuert ihn nach einem 401 einmalig. Secret und Token werden nie geloggt oder an Website/Widget übertragen.

## 5. EventSub Secret erzeugen

Ein zufälliges ASCII-Secret mit 10 bis 100 Zeichen erzeugen, beispielsweise lokal mit `openssl rand -hex 32`, und setzen:

```bash
supabase secrets set TWITCH_EVENTSUB_SECRET=ZUFÄLLIGES_SECRET
supabase secrets set TWITCH_EVENTSUB_CALLBACK_URL=https://DEIN_PROJECT.supabase.co/functions/v1/twitch-eventsub
```

## 6. Edge Functions deployen

```bash
supabase functions deploy admin-event-action
supabase functions deploy twitch-sync --no-verify-jwt
supabase functions deploy twitch-eventsub --no-verify-jwt
```

Der Webhook folgt Twitchs [Webhook Handling](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/): exakter Raw Body, HMAC-SHA256 über Message-ID + Timestamp + Body, zeitkonstanter Vergleich, Replayfenster, Challenge, Notifications und Revocations.

## 7. Twitch IDs auflösen

Im Adminbereich „Resolve All IDs“ oder pro Streamer „Resolve Twitch ID“ ausführen. `Get Users` verarbeitet bis zu 100 Logins je Request. Nicht gefundene Logins bleiben unaufgelöst und werden als Warning geloggt.

Die StreamElements-Widget-Zuordnung funktioniert bereits vorher über den normalisierten Twitch Login. Die Twitch User ID wird weiterhin nur für API, EventSub, Viewer-Sync, Sessions und Raids benötigt.

## 8. EventSub Subscriptions synchronisieren

Im Adminbereich „Sync EventSub Subscriptions“ ausführen. Für jede eindeutige aktivierte Twitch-ID werden sichergestellt:

- eine `stream.online`-Subscription
- eine `stream.offline`-Subscription
- eine `channel.raid`-Subscription mit `from_broadcaster_user_id`
- eine `channel.raid`-Subscription mit `to_broadcaster_user_id`

Twitch verlangt für Raids genau eine der beiden Bedingungen. Die Synchronisierung listet bestehende Subscriptions, vermeidet Duplikate und löscht vom Callback verwaltete Einträge deaktivierter Streamer. Sie wird nicht bei Seitenaufrufen ausgeführt. Siehe [EventSub Subscription Types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/) und [Managing Subscriptions](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/).

## 9. Twitch Sync manuell testen

Im Adminbereich „Sync All Streams“ verwenden. Alternativ serverseitig:

```bash
curl -X POST "https://DEIN_PROJECT.supabase.co/functions/v1/twitch-sync" \
  -H "Authorization: Bearer DEIN_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

`Get Streams` bündelt bis zu 100 User IDs. Nur ein erfolgreicher vollständiger API-Lauf darf Streamer als offline markieren. Siehe [Twitch API – Get Streams](https://dev.twitch.tv/docs/api/reference#get-streams).

## 10. Zwei-Minuten-Scheduler aktivieren

Supabase Cron/`pg_cron`, `pg_net` und Vault aktivieren und [120-second-twitch-sync.sql.example](../supabase/scheduler/120-second-twitch-sync.sql.example) ausführen. Der Job schreibt je Stream/120-Sekunden-Bucket höchstens ein Sample. Ein Retry erzeugt dank Idempotency-Key kein Duplikat. Supabase dokumentiert das Muster unter [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

## 11. Website Live-State prüfen

In GitHub die Repository Variables `EVENT_SLUG`, `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY` setzen und den Pages-Workflow ausführen. Auf `/` müssen mehrere aktive Streamer gleichzeitig `LIVE` und ihre aggregierte Zuschauerzahl zeigen. Deaktivierte Streamer dürfen nicht erscheinen.

## 12. Admin Health prüfen

Im Bereich „Twitch Status“ kontrollieren:

- Health `healthy`, `warning` oder `error` mit Begründung
- letzter Stream-Sync und letzter erfolgreicher Sync
- Webhook configured / last webhook received
- Online-/Offline-/Raid-Subscriptionzahlen
- Pending sowie revoked/error
- aktuelle Session mit Latest, Average, Peak, Sample Count und Laufzeit

## Fehlerbilder

- `credentials_missing`: Client ID oder Secret fehlt.
- Nutzer nicht gefunden: Login prüfen und erneut auflösen.
- Twitch API nicht erreichbar: State bleibt unverändert; nächster Tick versucht erneut.
- `last sync too old`: Scheduler/Vault/Function Logs prüfen.
- EventSub revoked: Ursache im Subscriptionstatus prüfen, danach Subscription-Sync ausführen.
- `invalid_signature`: Callback Secret und Twitch-App-Umgebung prüfen; Nachricht wurde nicht verarbeitet.

Keine Twitch- oder Supabase-Secrets in StreamElements, GitHub Pages, öffentliche JavaScript-Dateien oder Screenshots kopieren.
