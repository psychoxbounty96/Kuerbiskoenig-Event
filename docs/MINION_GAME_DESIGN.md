# Minion Game Design – Halloween v1

Alle Spiele verwenden `!boss`, eine circa dreisekündige Introbox, hohen Kontrast, Icon plus Text und einen serverzeitbasierten Countdown.

| Name | Key | Phase | Mode | Dauer | Erfolg | Damage | Failure Curse |
|---|---|---:|---|---:|---|---|---|
| Rastloser Geist | `ghost` | I | Participation | 40 s | erforderliche eindeutige Fänger | Standard | Geisternebel |
| Zombiehorde | `zombie_horde` | I | Visual Choice | 25 s + Observe | Mindestbeteiligung, eindeutige richtige Mehrheit; Tie = Failure | Standard | Zombiehände |
| Spinnenkönigin | `spider_queen` | I | Visual Choice | 25 s | Mindestbeteiligung, richtige Spinne 1–4/6 | Standard | Spinnenbefall |
| Die Hexe | `witch` | II | Vote | 35 s | Mindestbeteiligung, richtige A/B/C-Mehrheit | High | Hexenfluch |
| Fledermausschwarm | `bat_swarm` | II | Memory/Count | 5 s Observe + 20 s | Mindestbeteiligung, richtige Anzahl 4–12 | Standard | Fledermausangriff |
| Der Sensenmann | `reaper` | III | Memory | 4 s Observe + 25 s | Mindestbeteiligung, richtige Sequenz A/B/C | High | Dunkelheit |
| Herold des Königs | `kings_herald` | eligible Raid | Participation | 45 s | erforderliche eindeutige Kämpfer | Elite | Königlicher Fluch |

## Präsentation

### Geist

Intro „Ein Geist ist erschienen!“, danach „Fangt den Geist!“ und `!boss`. Die Fortschrittszahl zeigt Teilnehmer/Ziel. Erfolg löst sofort auf.

### Zombiehorde

Die Beobachtungsphase markiert links, Mitte oder rechts. Danach verschwinden die Markierung und die Frage erscheint. Eingaben: `!boss links`, `!boss mitte`, `!boss rechts`.

### Spinnenkönigin

Vier bis sechs nummerierte Spinnen, eine mit klarer Kronenmarkierung. Eingabe beispielsweise `!boss 4`. Keine kaum erkennbaren visuellen Unterschiede.

### Hexe

Kurze Halloween-Frage mit A/B/C. Fragen stammen aus `minion_questions`, benötigen kein Spezialwissen und bleiben kompakt.

### Fledermausschwarm

Vier bis zwölf klar getrennte Fledermaus-Placeholder während Observe; danach Eingabe der Zahl. Finale Assets dürfen keine unfairen Overlaps erzeugen.

### Sensenmann

Kurze Symbolsequenz, anschließend drei klar lesbare Optionen. Das Minion ist seltener gewichtet.

### Herold

Eligible interner Raid → 90–120 Sekunden Begrüßungszeit → „Verstärkung ist eingetroffen!“ → Participation-Spiel. Der Raid selbst gibt keinen Damage.

## Flüche

Alle Effekte liegen nur im Widget und enden nach 10–12 Sekunden, spätestens nach 15 Sekunden. Nebel bleibt unter circa 30 % Deckkraft; Hände/Netze/Fledermäuse lassen die Mitte überwiegend frei; Distortion bleibt sanft; Dunkelheit ist eine Vignette statt eines langen Blackouts; der königliche Fluch ergänzt Rand-Schatten und Augen.

Phase I–IV skaliert die visuelle Intensität ungefähr mit `0.7 / 0.85 / 1.0 / 1.1`, nie die harte Dauer- oder Sichtbarkeitsgrenze.
