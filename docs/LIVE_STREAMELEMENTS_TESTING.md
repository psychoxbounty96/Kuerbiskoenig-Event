# Echter StreamElements-Testbetrieb

Diese Anleitung ist der Operator-Testweg. Sie benötigt keinen lokalen Server, kein `npm run dev`, kein Docker, keinen Supabase-Emulator und keinen dauerhaft laufenden Betreiber-PC.

## Voraussetzungen

- Supabase-Migrationen einschließlich `202608120001_live_widget_readiness.sql` sind angewendet.
- `widget-test-action`, `minion-action` und die übrigen Edge Functions sind deployt.
- GitHub Pages ist unter `https://psychoxbounty96.github.io/Kuerbiskoenig-Event/` erreichbar.
- Das Testevent `halloween-2026-test` hat Status `testing`.
- Das Produktionsevent `halloween-2026` bleibt `draft`.
- Das StreamElements-Testpaket aus `dist/streamelements/test/` wurde importiert.

## 1. Testevent und Testkanal vorbereiten

1. Öffne das Adminpanel für das Testevent:
   `https://psychoxbounty96.github.io/Kuerbiskoenig-Event/admin/?event=halloween-2026-test`
2. Melde dich mit einem Supabase-Auth-Konto an, das für dieses Event in `event_admins` berechtigt ist.
3. Prüfe oben `TEST-EVENT`, den Eventslug und Status `testing`.
4. Lege den echten Twitch-Testkanal mit Display Name und exakt korrektem Twitch Login an.
5. Aktiviere `Als Testkonto markieren`. Das ist ein echtes Datenfeld, keine Namenskonvention.
6. Prüfe `Enabled` und löse optional die Twitch User ID auf. Die Widget-Identität benötigt die ID nicht; Twitch Sync, Sessions und echte Raids benötigen sie.
7. Testkonten erscheinen nicht in öffentlicher Teilnehmerliste, Rangliste oder Calibration-View. Manuelle Viewer Samples tragen `source = manual_test`.

## 2. Standalone Widget in StreamElements importieren

Erstelle in StreamElements ein Custom Widget und kopiere aus `dist/streamelements/test/`:

| StreamElements Tab | Datei |
| --- | --- |
| HTML | `html.html` |
| CSS | `css.css` |
| JS | `js.js` |
| FIELDS | `fields.json` |

Speichere das Widget. Es wird kein Streamer-, Event-, Supabase- oder Tokenfeld ausgefüllt. Das Paket gehört bereits fest zu `halloween-2026-test`.

Aktiviere im Editor das Feld `Editor diagnostics`. Erwartet:

```text
Channel: <dein-testlogin>
Streamer: <Display Name> (resolved)
Event: halloween-2026-test · testing
Supabase: connected
Realtime: connected
Boss: loaded
Minion: none
```

Fehlerbilder im Editor:

- `not_registered`: Twitch Login fehlt im Testevent oder ist falsch.
- `disabled`: Teilnehmer ist deaktiviert.
- `Supabase fallback`: letzter sicherer State bleibt aktiv; periodischer Re-Fetch läuft.
- `Boss not loaded`: Migration/Read-RPC oder Eventstatus prüfen.

Im normalen Live-Bild wird keine Diagnose gezeigt.

## 3. Boss und Realtime testen

1. `Reload Boss State` – Last Sync muss aktualisiert werden.
2. `Test Boss Hit (-1,000)` – HP sinken über Edge Function, DB und Realtime.
3. `Test Boss Big Hit (-25,000)` – größere HP-Animation prüfen.
4. `Phase I`, `Phase II`, `Phase III`, `Phase IV` nacheinander testen. Die Buttons setzen Testboss-HP auf einen Wert innerhalb der echten Phase; es gibt keinen Client-Phase-Override.
5. `Reset Test Boss` – Testlauf, Milestones und aktive Minions werden serverseitig zurückgesetzt.

Ein Button darf die Anzeige niemals nur lokal verändern. In der Diagnose soll zuerst die Serveraktion erfolgreich sein und danach ein neuer State eintreffen.

## 4. Minions und echten Twitch-Chat testen

1. `Spawn Ghost` drücken.
2. Intro und automatischen Wechsel zu Active beobachten. Das Testwidget ruft während des Tests die echte serverseitige Tick-Engine auf; ein lokaler Timer entscheidet keinen Status.
3. Im echten Twitch-Chat des Testkanals `!boss` senden.
4. Mit mehreren Twitch-Nutzern bis zur eingefrorenen Schwelle teilnehmen.
5. Prüfen: derselbe `userId` zählt nur einmal; ein anderer User zählt separat.
6. Bei Vote-/Choice-/Memory-Spielen eine ungültige Eingabe senden und danach korrekt korrigieren.
7. Prüfen: Success erzeugt serverseitig klassengebundenen Boss Damage; der Client sendet keinen Damagewert.
8. `Force Current Minion Failure` verwenden und Ergebnis plus anschließenden Fluch prüfen. Failure heilt den Boss nicht.
9. `Cancel Current Minion` und `Expire Current Minion` jeweils separat prüfen.

Danach dieselbe Abnahme für:

- `Spawn Ghost`
- `Spawn Zombie Horde`
- `Spawn Spider Queen`
- `Spawn Witch`
- `Spawn Bat Swarm`
- `Spawn Reaper`
- `Spawn Raid Herald`

`Spawn ...` verwendet immer `spawn_minion_v4`, Realtime und die normale Runtime-Tabelle. Es erzeugt keine lokale UI-Attrappe.

## 5. Flüche testen

Die sieben `Test ... (visual only)`-Buttons autorisieren zuerst den Testaccount serverseitig und spielen danach ausschließlich den visuellen Effekt ab. Sie ändern keine Minion- oder Produktivstatistik:

- Fog
- Zombie Hands
- Spider Web
- Witch Distortion
- Bat Attack
- Darkness
- Royal Curse

Der vollständige Backendpfad wird zusätzlich geprüft, indem das zugehörige Minion gespawnt und `Force Current Minion Failure` verwendet wird. Kein Effekt darf länger als 15 Sekunden laufen oder OBS, Audio, Chat, Szenen oder andere Overlays steuern.

## 6. Viewer und Raid testen

1. Wenn der Testkanal live ist, im Adminpanel `Sync Now` ausführen und Twitch Viewer Sample/Session prüfen.
2. Wenn er offline ist, `Create Test Viewer Sample` im Widget drücken. Der feste Testwert wird als `manual_test` gespeichert und von Calibration-Daten ausgeschlossen.
3. `Simulate Eligible Raid` drücken. Es entsteht ein echter `raid_events`-Datensatz mit `source = manual_test` und ein Queueeintrag.
4. 90–120 Sekunden warten. Der autorisierte Test-Tick verarbeitet dieselbe `minion_special_queue`; danach erscheint der Herold.
5. `Spawn Herald Now` ist nur der schnellere UI-/Gameplaytest.

Externe oder nicht eligible Raids erzeugen keinen Herold. Ein Raid verursacht nie direkt Boss Damage.

## 7. Recovery, Pause und Offline testen

1. Während eines Active-Minions die StreamElements Browser Source neu laden. Identität, Minion-State und Restzeit müssen aus Supabase rekonstruiert werden; kein neuer Spawn und kein Timerreset.
2. Während eines Curse neu laden. Der serverseitige Curse-State und `curse_ends_at` bleiben maßgeblich.
3. Realtime-Verbindung kurz unterbrechen oder die Source neu laden. `Fallback aktiv` darf erscheinen, letzter State bleibt sicher, periodischer Re-Fetch und Reconnect stellen die Verbindung wieder her.
4. Im Adminpanel Event pausieren. Aktives Minion wird cancelled, ohne Damage und ohne Curse. Beim Resume kehrt kein altes Minion zurück.
5. Teststream beenden und im Adminpanel `Sync Now` ausführen. Ein aktives Minion wird beim echten Offline-State cancelled.
6. Testaccount deaktivieren. Das Widget verliert die Teilnahmeberechtigung, verarbeitet keinen Chat und zeigt keine streamerbezogenen Minions.
7. Testaccount wieder aktivieren. Keine neue Widget-Einrichtung ist nötig.

## 8. Testmatrix

### Boss

- [ ] Boss HP geladen
- [ ] HP-Animation
- [ ] Phase I
- [ ] Phase II
- [ ] Phase III
- [ ] Phase IV
- [ ] Reset

### Minions

- [ ] Ghost
- [ ] Zombie Horde
- [ ] Spider Queen
- [ ] Witch
- [ ] Bat Swarm
- [ ] Reaper
- [ ] Herald

### Curses

- [ ] Fog
- [ ] Zombie Hands
- [ ] Spider Web
- [ ] Witch Distortion
- [ ] Bat Attack
- [ ] Darkness
- [ ] Royal Curse

### Chat

- [ ] echte `!boss`-Nachricht
- [ ] Duplicate User zählt einmal
- [ ] falsche Antwort
- [ ] Korrektur nach ungültiger Eingabe
- [ ] Timeout
- [ ] Success erzeugt serverseitigen Damage
- [ ] Failure erzeugt keinen Boss Heal

### Recovery und Guards

- [ ] Reload während Active
- [ ] Reload während Curse
- [ ] Realtime
- [ ] Fallback/Reconnect
- [ ] Offline Cancel
- [ ] Pause
- [ ] Resume
- [ ] Streamer Disable

### Raid

- [ ] Test Raid Record
- [ ] Herald Delay 90–120 Sekunden
- [ ] Herald Spawn aus Queue
- [ ] Spawn Herald Now

## 9. Was bewusst deaktiviert bleibt

Die produktiven Cronjobs bleiben bis zur separaten Freigabe aus:

- Twitch Sync: später typischerweise alle zwei Minuten
- Minion Tick: später wenige Sekunden bis eine Minute, abhängig vom finalen Betriebskonzept
- Passive Damage Tick: später 120 Sekunden; passiver Boss Damage ist weiterhin nicht freigegeben

Das autorisierte Testwidget hält nur das getrennte Testevent während der Abnahme am Laufen. Das Adminpanel, GitHub Pages und ein lokaler PC müssen danach nicht offen bleiben. Für den späteren Dauerbetrieb übernehmen Supabase Scheduler/Edge Functions diese Aufgaben.
