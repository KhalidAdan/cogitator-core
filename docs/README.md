# Cogitator Core: overnight report

Written 2 October 2026, for you to read when you're back. Start here; the other files in this folder go deeper.

| File | What's in it |
|---|---|
| **README.md** (this) | What got built, how to run it, what I checked, what needs your call |
| [decisions.md](decisions.md) | Every decision I made on my own, with the reasoning and the alternative |
| [architecture.md](architecture.md) | How the code is laid out, where Effect and React Router each do their job, the database schema |
| [wahapedia.md](wahapedia.md) | The data export: what's in it, how it's loaded, what I learned from the real files |
| [field-manual.md](field-manual.md) | Points from Games Workshop's Munitorum Field Manual (added 2 October): what it does and how the page is read |
| [open-questions.md](open-questions.md) | The handoff's open questions (two are now answered) plus new ones |

> **Since this was written (2 October):** you confirmed the Space Marines codex numbers came out on 30 September, after Wahapedia's export, and the Field Manual settled the Aeldari points in your list's favour. Strike Force Cophasta has been removed as a built-in list while you correct it; where this report mentions it, it describes the list as it was. The app now reads points from the Field Manual directly and checks for updates daily (see [field-manual.md](field-manual.md)). See [open-questions.md](open-questions.md) items 6, 7 and 13 and decision D-27.

## The short version

The POC is ported. Cogitator Core is a React Router 7 (framework mode) app on SQLite, with Effect 4 running everything server-side. It does everything the POC did, to the same numbers, and it has the first three phases of the roadmap's trusted rules database working against real Wahapedia data.

Run it:

```bash
npm run dev
```

Then open http://localhost:5173. The first start creates `data/cogitator.db`, seeds it, and loads the Wahapedia export that's already downloaded. Nothing else to set up.

```bash
npm test
```

55 tests, all passing. `npm run typecheck` and `npm run build` are clean too.

## Three things you should know first

**1. Wahapedia's Space Marines data is older than your White Scars roster.** This is the most important finding of the night. The Aeldari list agrees with the export almost exactly: every one of its weapon profiles matches, and only four points values differ. Strike Force Cophasta does not: 87 values disagree across all 17 units. The roster has Toughness 5 marines, Strength 5 bolt weapons, and weapons and abilities (Anzuq, Relics of Battle, Armoured Impact, Full-throttle Assault, the Assault Brethren detachment) that aren't in the export at all. The export's Space Marines source is "Faction Pack, edition 11, v1.2, 26 Aug 2026", which reads like pre-codex rules. So the database is not yet trustworthy for Space Marines, and because of that **nothing is overwritten automatically**: the app reports the differences and applies the database's values only when you click. Details in [wahapedia.md](wahapedia.md#what-the-real-data-showed); the decision is D-12.

**2. wahapedia.ru doesn't resolve while your VPN is on.** That's what blocked the download at the start of the night. With the VPN off it works, from the app's Database page or `npm run wahapedia:fetch`. The error message now says so.

**3. The export includes points.** That answers the handoff's first open question. They're tiered in 11th edition ("your 1st to 2nd units cost…", "your 3rd+ unit costs…"), and the app understands the tiers. The text export is still needed for now, because rosters don't say which enhancement costs what or which detachments you took.

## What's in the app

Everything from the POC, same views, same design:

- **Damage matrix** with heat colours, averages, best matchup, coverage row and the three findings
- **Unit dossier**: matchup bars, per-weapon attack table, the Σ panel, rules in play, editable loadout
- **Target page**: editable defensive profile, every attacker ranked
- **Rules matrix** with chips and the rule card
- **Controls**: phase, attached units, the modifier bar per scope, situation, target marks, accounting, presets
- **Import** from `.ros` / `.rosz` plus the optional text export, with a review step
- Dark and light theme, mobile-first, no sideways page scroll at 390px

New, from the roadmap:

- **Rules database** (`/database`): versioned Wahapedia snapshots in SQLite, a "check for a newer export" button, and a change report between snapshots (points, weapon profiles, model stats, rule wording, datasheets added and removed). Roadmap phase 1.
- **Database check** (a tab on every list): each unit resolved to its datasheet, with points, weapon profiles, stats and abilities compared, and a button to take the database's values per unit or for the whole list. Also runs during import. Roadmap phase 2, as a check-and-apply rather than a silent replacement (see finding 1).
- **Rules library** (`/library`): the POC's hand-written rules are now rows in the database with an editor. Each rule is linked to its official Wahapedia wording, shown beside your paraphrase. When a new snapshot rewords a rule, it drops back to draft. Roadmap phase 3.
- **Rules are all data now.** The POC's eight by-name engine branches (`LEGACY_FX`) and three hardcoded marks are gone; they're expressed in the effect vocabulary, which grew two fields to cover them. A 30,000-cell comparison against the POC's engine proves nothing moved.
- **Datasheet browser**, with "add as a benchmark target" on any datasheet.
- **Lists in the database** rather than the browser, so they're the same on every device that reaches the app. JSON download per list.

## What I verified, and how

| Claim | Evidence |
|---|---|
| The engine port gives the POC's numbers | `tests/engine-parity.test.ts`: the four Cogitator calibration rows, Yriel into Warp Spiders at Σ 3.98 → 88.0%, and all 72,618 cells of the built-in list and the POC's two other lists under 39 option scenarios, split and combined, equal to the original `engine.js` to nine decimal places |
| The importer port gives the POC's output | `tests/importer-parity.test.ts`: both fixture rosters produce the same units, groups and rules as the POC's importer, document for document; 684, 532 and 570 matrix cells with zero differences (the handoff's own numbers) |
| The handoff's headline findings still hold | `tests/domain.test.ts`: Yriel + Voidscarred at 107 / 104 / 64 / 55 into Terminators, Intercessors, Wraiths, C'tan; 49.4% points-weighted average; 1,085 points in units averaging 50%+ |
| The database layer works | `tests/db.test.ts`: migrations, seed, round trips, typed errors, on in-memory SQLite |
| The Wahapedia pipeline works on the real export | `tests/wahapedia.test.ts`: all 21 files parse against the spec; a snapshot loads; an edited copy produces exactly the expected change report; the Aeldari list checks clean on weapons; rules link to official text |
| The download works | Ran one full forced download from wahapedia.ru (21 CSVs and the spec) through the app's own fetch code |
| The app runs | Every route returns 200 on a fresh database in dev, and the production build serves. Posted to every action against the running app and read the result back: option changes, reset, loadout edit, target edit, import (upload, review, save, delete), "use the database" for one unit, rule save with three kinds of bad input and one good, rule reset |
| It behaves in a browser | Drove the rules matrix: a chip opens the card, the card's switch flips nine chips to idle and back, closing clears the URL. Looked at every page in dark theme (matrix, dossier, rules matrix, target, database check, lists, import and its review step, library, rule editor, database, a datasheet), the dossier in light theme, and the matrix at phone width |
| It fits a phone | `scrollWidth` is exactly 390 on all eleven views at a 390px viewport |

## What I did not verify

Said plainly, so you know where to look first:

- **`.rosz` import.** It's implemented (unzip, then the same path as `.ros`) but there is no `.rosz` fixture, so it has never run on a real file.
- **The change report with real changes on it.** I looked at every page, but the database page has only ever rendered "nothing to compare with". Its tables of points, weapon and wording changes are covered by tests on the data, not by anyone seeing them.
- **Light theme and phone width were each seen on one view.** The CSS is the POC's, so I expect them to hold, but that's an expectation.
- **A real second snapshot.** The change report was tested against a copy of the export with one price edited. Wahapedia hasn't published a new export since I downloaded this one, so the first genuine diff will be yours.
- **Typing in the browser.** The forms were exercised by posting to them, which proves the server side. Nobody has typed into the loadout editor, target editor or rule editor in a real browser.

## Not built

- "Draft with Claude" (roadmap phase 4). It needs an API key and a decision about cost; the rule editor is where it would plug in, and the effect schema it has to produce is in place.
- Opponent roster as targets, list comparison, variance (roadmap phase 5). Targets are still single-profile.
- Deployment. It runs locally. You have Tailscale, so `npm run build && npm start` on this machine would reach your phone; that's a suggestion, not something I set up.
- Nothing is committed. I ran `git init` and wrote a `.gitignore` (which excludes `data/`), and left the first commit to you.

## Housekeeping

- The POC is untouched in `kill-ledger/`. The tests use it as their oracle, so keep it until you're confident in the port.
- Downloaded export: `data/wahapedia/2026-09-28_023804/` (the export Wahapedia stamped 28 Sep 2026 02:38 GMT+3), about 8 MB, with the spec spreadsheet beside it.
- I pinned React Router to 7 as you asked (7.18.4). Version 8 is the current release; all the v8 future flags are switched on, so the upgrade should be small when you want it.
