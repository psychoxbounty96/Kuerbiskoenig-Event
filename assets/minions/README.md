# Minion-Assets v0.4

Die Engine verwendet die gelieferten JPG-Motive als funktionierende Platzhalter. Beim lokalen Start und beim GitHub-Pages-Build kopiert `scripts/sync-minion-assets.mjs` jedes `placeholder.jpg` in den stabilen öffentlichen Pfad `/assets/minions/<ordner>/placeholder.jpg`.

| Engine-Key | Assetordner |
| --- | --- |
| `ghost` | `ghost` |
| `zombie_horde` | `zombie` |
| `spider_queen` | `spider` |
| `witch` | `witch` |
| `bat_swarm` | `bats` |
| `reaper` | `reaper` |
| `kings_herald` | `herald` |

Die Darstellung bleibt hinter einem Artwork-Adapter gekapselt. Spätere transparente PNGs oder Spritesheets können die JPGs ersetzen, ohne Spiel-, Chat- oder Serverlogik zu ändern.
