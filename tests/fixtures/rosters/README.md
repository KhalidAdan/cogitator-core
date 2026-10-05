# Roster fixtures

Real lists, exported from 40k.app as BattleScribe roster files and imported into the app on 2 October 2026. Copied here from the app's database, unchanged. Used by `tests/rosters.test.ts`.

| File | List | Faction |
|---|---|---|
| `the-citadel-moves.ros` | The Citadel Moves | Chaos Space Marines |
| `ten-thousand-and-no-more.ros` | Ten Thousand and No More | Adeptus Custodes |
| `strike-force-cophasta.ros` | Strike Force Cophasta, as re-entered after the Field Manual v1.5 update | White Scars |
| `the-wall-advances.ros` | The Wall Advances | Imperial Fists |
| `by-writ-of-the-lord-solar.ros` | By Writ of the Lord Solar! (added 4 October) | Astra Militarum |
| `the-fifteenth-grievance.ros` | The Fifteenth Grievance (added 5 October, straight from the download) | Thousand Sons |

None came with a text export, so they carry no points. The POC's own fixtures (`kill-ledger/fixtures`, including an older Cophasta) are separate; they are what the importer-parity tests compare against.

To add one: drop the `.ros` (and a `.txt` text export, if you have one) in this folder and add a row to `ROSTERS` in `tests/rosters.test.ts`. The first test fails until you do.
