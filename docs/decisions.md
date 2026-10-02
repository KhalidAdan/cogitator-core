# Decisions made overnight

Each entry says what I chose, why, and what the alternative was, so you can overrule any of them quickly. They're roughly in the order they came up. "Handoff" means `kill-ledger/HANDOFF.md`.

Ones I'd most like you to look at: **D-12** (database values are applied on request, not automatically), **D-7** (rules moved from code to data), **D-9** (a POC bug I fixed rather than ported), **D-16** (data kept out of git).

---

## Stack

### D-1. React Router 7.18, not 8
You asked for React Router 7. npm's `latest` is now 8.4, so I installed the `version-7` tag (7.18.4) deliberately. Every v8 future flag is on (`v8_middleware`, `v8_splitRouteModules`, `v8_viteEnvironmentApi`, `v8_passThroughRequests`, `v8_trailingSlashAwareDataRequests`), so the app already behaves the way 8 will and the upgrade should be a version bump.

*Alternative:* go straight to 8. I didn't, because you named 7.

### D-2. Effect 4, with SQLite through `node:sqlite`
`effect` is at 4.0 and `@effect/sql-sqlite-node` 4.0 uses Node's built-in `node:sqlite`, so there is no native module to compile on Windows. Node prints an "experimental" warning for SQLite on start; it's harmless. Requires Node 24 (you have 24.4).

*Alternative:* `better-sqlite3`. More battle-tested, but a native build step, and the Effect driver no longer uses it.

### D-3. TypeScript 6, not 7
React Router 7's dev package declares a peer range of TypeScript 5 or 6. TypeScript 7 (the native port) is `latest` on npm but outside that range, so I pinned 6.

### D-4. npm, plain CSS, self-hosted fonts
npm because it's what's installed (no pnpm or bun on this machine). The stylesheet is the POC's CSS moved into `app/styles/app.css` almost verbatim, plus about forty lines for the new pages; I did not introduce Tailwind or a component library, because the design language was already settled and the handoff says to keep it. Fonts come from `@fontsource` packages instead of Google Fonts, so the app makes no third-party requests and works offline.

### D-5. Where Effect is used, and where it isn't
"Effect for everything that makes sense" came out as:

- **Yes:** the database (SqlClient, migrations), every repository as a service, the seed, the roster importer's entry points, the whole Wahapedia pipeline (HTTP client with retries, file system, CSV parsing, snapshot loading), all validation at boundaries (Schema), configuration (Config), the scripts (NodeRuntime), typed errors that turn into HTTP statuses, logging, and the tests of all of the above (`@effect/vitest`).
- **No:** the damage engine and the view-model code in `app/domain`. They are pure functions over plain data, they run in the browser for optimistic recalculation, and they sit in a hot loop (units × targets × weapons). Wrapping them in Effect would add weight to the client bundle and nothing else. They import only *types* from the schema module, so no Effect code reaches the browser: the production client bundle contains none.

### D-6. Server code lives in `app/.server/`
React Router refuses to bundle anything under a `.server` directory into the client. That turns "the database never leaks into the browser" from a convention into a build error.

---

## Porting the POC

### D-7. Every rule is data now; `LEGACY_FX` is gone
The POC handled eight rules by name inside the engine (Piratical Hero, Psychic Guidance, Piratical Raiders, Spirit Mark, Reavers of the Void, Assured Destruction, Faolchú, Assassins' Eye) and three marks from hardcoded option flags (Riven, Webbed, Guided). The handoff said to migrate these "only with the tests passing before and after".

I migrated all eleven. The effect vocabulary gained two fields to make that possible:

- `rrDmg: true` — re-roll the damage roll (Assured Destruction)
- `critHit: 5` — critical hits on an unmodified 5+ (Whispering Web)

The licence for doing this is `tests/engine-parity.test.ts`, which loads the *original* `engine.js` in a VM and compares it with the TypeScript engine on every cell of every built-in list under 39 option scenarios: 72,618 cells, equal to nine decimal places. So adding a faction is now a matter of adding rows in the rules library, which was known issue 1.

*Alternative:* port the by-name branches as they were. Safer on paper, but it would have carried the handoff's biggest piece of technical debt into the new codebase, and the parity test makes the migration provably safe.

### D-8. Target marks are data too
The POC's `MARKS` table in `app.js` hardcoded labels and Aeldari unit ids. Now the rule that sets a mark carries its own switch label and hint (`markNm`, `markTxt`), and the controls list whatever marks the current list's units can set. Known issue 7.

### D-9. Fixed: a list-wide mark was applied twice to the unit that sets it
In the POC, a mark like Shattered Defences reached the Thunderstrike both as its own rule and as a list-wide mark, so with the mark on it got +2 AP against vehicles instead of +1. I apply list-wide marks once. This is the single place the port's numbers differ from the POC's, it only shows with that mark switched on, and there is a test that documents it. If the double application was somehow intended, it's a small change back in `attackUnit`.

### D-10. Option keys are grouped
The POC kept situation switches and marks as loose keys on the options object (`opts.charged`, `opts.riven`). They're now under `opts.flags`. Everything else about options, including the modifier bar's per-scope structure, is unchanged.

### D-11. Field names kept as they were
`nm`, `pts`, `w`, `kw`, `sk` and the rest are terse, but the handoff, the seed data, the fixtures and the calibration tests all use them. Renaming would have made the port impossible to check against the original for no functional gain.

---

## The trusted database

### D-12. Database values are applied when you ask, not automatically
Your stated principle is "don't trust user-supplied datasheets". I implemented the machinery for it (every unit resolves to a datasheet; points, profiles and stats are compared; one click overwrites the list with the database's values) but the default is to **report, not replace**.

The reason is what the real data showed: the export's Space Marines are older than your roster (see [wahapedia.md](wahapedia.md#what-the-real-data-showed)). If imports silently took the database's values, Strike Force Cophasta would lose a point of Toughness across the board and several of its weapons. Until the export catches up with the codex, the roster is the better source for that faction, and the app can't tell which case it's in.

So: the import review shows how many values disagree and has a checkbox, off by default, to use the database's (since D-34 it also shows the differences themselves, and lets you choose per unit). Every list has a Database check tab with the differences per unit and a button per unit or for the whole list. "Restore this list" undoes it.

*To flip the default:* the checkbox in `app/routes/lists.import.tsx`. I'd wait until a faction's check comes back clean.

### D-13. Lists store resolved units, not just choices
The roadmap's phase 2 describes a list as "choices only", with stats looked up from the database at read time. I kept the POC's shape: a unit document with its weapon profiles in it, plus a `datasheetId` once it has been matched. Reasons: it keeps the engine and both parity tests unchanged; it means a list still works when the database has no match (see D-12); and "apply database values" plus "re-read the roster file" give you the same outcome on demand. Moving to choices-only is possible later, and worth it once the database is trustworthy for every faction you play.

### D-14. Stratagem files are downloaded but not loaded
`Stratagems.csv` and `Datasheets_stratagems.csv` are 88,000 rows, more than everything else combined, and stratagems are deliberately outside the maths. They're kept on disk with the rest of the export and skipped by the loader.

### D-15. The export is parsed by fields, not lines
The CSVs are pipe-delimited and unquoted, and HTML fields contain raw newlines (`Abilities.csv` has rules that span a dozen lines). Splitting on lines corrupts them. The parser splits the whole file on `|` and cuts it into records of the header's width, then checks every record starts on a new line, which catches any misalignment. No CSV library handles this dialect, so it's 40 lines of our own, with tests.

### D-16. `data/` is not in git
The SQLite file and the downloaded exports are git-ignored. The exports contain Games Workshop's rules text; the handoff's IP note says to keep that out of anything shared. The cost is that old exports aren't versioned by git. They are kept on disk (one folder per export timestamp) and the last three are kept in the database, which is what the change report needs.

*Alternative:* commit the exports to keep history. Fine for a private repo, a problem the day it's pushed anywhere public.

### D-17. Three snapshots are kept
Each snapshot is about 78,000 rows and 10 MB. The loader keeps the newest three and drops older ones. Change `KEEP` in `Snapshots.ts` if you want more.

### D-18. Rules are linked to official text by name and faction
The export has no stable id for most abilities: datasheet abilities are inline rows with a name and a description. So a library rule is matched to its official wording by normalised name, the kind of rule its source implies, and faction. 52 of the 62 seeded rules link this way. The ten that don't are listed in [wahapedia.md](wahapedia.md); nine are Space Marines rules that aren't in the export.

A rule whose official wording changes between snapshots drops from verified to draft and gets a note. Wording is compared after stripping HTML, so a markup-only change doesn't trigger it.

### D-19. Points with several prices are a set, not a number
11th edition prices some units by how many you take, and Space Marine datasheets list more than one price block. The check treats a unit's price as correct if it matches any price the database lists for that model count, and only offers to overwrite points when the database has exactly one price for the unit's position in the list.

---

## The app

### D-20. Options are stored per list, in the database
The POC kept one global options object in `localStorage`. Options are now a column on the list, so each list remembers its own phase, switches and modifiers, and they follow you to another device. This also fixes known issue 9 (modifier scopes are keyed by unit id, which only makes sense per list).

The benchmark targets are still global, shared by all lists, as in the POC.

### D-21. The matrix is computed in the component, from loader data
The loader returns the list, the rules and the targets; the engine runs during render, on the server for the first paint and in the browser after that. Changing an option posts an *intent* to the list's action, and while that's in flight the layout applies the same intent to the options it has, so the numbers move immediately rather than after the round trip. The server and the browser use the same pure function (`applyIntent`), so they can't disagree.

*Alternative:* compute the matrix in the loader and send numbers. Simpler, but every toggle would wait for the network, which is exactly wrong on a phone.

### D-22. UI state that deserves a URL is in the URL
The open rule card (`?rule=`), the selected matchup on a dossier (`?vs=`), the loadout editor (`?edit=1`), the shown snapshot, the datasheet and library searches are all search params. They survive reload, work with the back button, and need no client state. The exception is which scope the modifier bar is editing, which is throwaway and stays in component state.

### D-23. Import is two steps with the upload kept server-side
Uploading a roster stores it as a pending import and redirects to a review page at `?pending=<id>`. Saving re-parses the stored file and applies the edits from the review form. The alternative, sending the parsed result back through hidden form fields, would have meant trusting a document the browser hands back. Abandoned uploads are deleted after two days.

The roster XML and text export are stored with the list. That's what makes "Re-read the roster file" possible: add a rule to the library, re-read, and the list picks it up.

### D-24. Built-in lists can be reset but not deleted
They are the calibration reference. Imported lists can be deleted. (Since D-35 there is one.)

### D-25. A live calibration check stays in the footer
As in the POC, every list page shows Yriel into Warp Spiders computed by the running build. It uses the seed data rather than the database, so editing a rule or a target can't move it; if that number is ever not 3.98 → 88.0%, the engine itself has changed.

### D-26. Named "Cogitator Core"; the list header still says "Kill ledger"
The app and the repo are Cogitator Core, as you called it. I kept "Kill ledger" as the small label above the list name, since that's the name of the tool inside the app. Trivial to change in `app/routes/list.tsx`.

### D-27. Strike Force Cophasta is no longer a built-in list (2 October, your call)
Nine of its prices disagree with the Field Manual and you're correcting the list, so it was removed from the app: it isn't seeded any more, and an existing database drops it on the next start (seed version 2). It will come back as an ordinary import.

What stays: the Space Marines rules in the library, so the re-imported list scores straight away; the fixture roster in `kill-ledger/fixtures/`; and the tests, which still check the engine and importer against the POC's copy of the list because it's the only reference that exercises those rules. The findings about it elsewhere in these docs describe the list as it was.

### D-28. Unit points and enhancement points are entered separately (2 October)
A unit's stored points include its enhancement, as in the POC. The import review and the loadout editor used to show that total in one box, which invited typing the Field Manual's unit cost and losing the enhancement. Both forms now take the unit's own cost and the enhancement's cost separately and add them on save. What is stored hasn't changed.

### D-29. Points come from the Field Manual first (2 October)
The Munitorum Field Manual is Games Workshop's own points list and it changed two days before Wahapedia would have told us. So points are now checked against it wherever it has been read for a list's faction, with Wahapedia's points as the fallback. Profiles, stats and abilities still come from Wahapedia. Details in [field-manual.md](field-manual.md).

This narrows D-12 rather than reversing it. D-12 said database values are applied on request because the database could be staler than the roster. That is still true of Wahapedia's profiles. It is not true of Field Manual points, which are the official current prices, so:

- **Imports take Field Manual points by default** (a ticked box in the review). Untick it to keep the file's numbers.
- **Existing lists are never changed on their own.** A list whose points have drifted shows a notice and a button; nothing is rewritten until you press it.
- **Updating points and taking Wahapedia's profiles are separate buttons**, because the two sources go stale at different times.

### D-30. The app checks for updates by itself, once a day
While it's running, the app looks for updates: the Field Manual pages for the factions you follow, then Wahapedia's export. After start-up and every six hours, skipping anything looked at in the last twenty. That is the "proactive" part; without it the notice on a list would only ever be as fresh as the last time you pressed the button. It makes outbound requests you didn't click for, so it is deliberately small (your factions only, a page a second, a truthful user agent; Wahapedia is asked only for its 39-byte timestamp unless that has moved) and can be turned off with `COGITATOR_AUTO_UPDATE=off`.

*Alternative:* only ever check on a button press. Simpler, and it would have missed this morning's update just the same.

### D-31. The Field Manual is read from the page's embedded data, by its wording
There is no data feed, only a web app. Rather than drive a browser or pick at CSS class names, the reader takes the React data the page embeds, recovers the text in reading order, and parses it by what it says ("a name followed by YOUR … COST"). A restyle won't break that; a reword will, and when it does the parser refuses the page instead of storing half of it.

### D-32. One "Check for updates", one status (2 October, your call)
The Database page first had a fetch button per source and a table of snapshots, which is how the app is built rather than what anyone wants from it. It now has:

- **one action**, "Check for updates", which reads the Field Manual for every faction you follow and then Wahapedia, in that order;
- **one status**: what is loaded from each source, and whether they agree. They are compared on the thing both carry, prices. If Wahapedia's export has older prices than the Field Manual, it predates the latest update, and the page says so plainly, including that datasheets may be behind too. The same warning appears on a list's Database check tab;
- everything else (following a faction with no list, the history of exports, rebuilding from disk) under a closed "History and tools".

The per-source terminal commands stay, as tools. `npm run update` is the equivalent of the button.

### D-33. Nine rules translated for Chaos Space Marines and Adeptus Custodes (2 October, your call)
Your two new rosters had nine rules flagged "not modelled". They are now in the library (`app/.server/seed/library.ts`, seeded like the POC's rules, so a fresh database has them too):

| Rule | Faction | Effect in the engine |
|---|---|---|
| Despoilers | CSM | after a Dark Pact: re-roll hits (whole attached unit) |
| Daemonforge | CSM | after a Dark Pact: re-roll wound rolls of 1 |
| Stabilisation Talons | CSM | ranged: ignore penalties to hit and to BS |
| Master of Mechanisms | CSM | a mark: +1 to hit for Vehicles |
| Headlong Destruction | CSM | against the closest enemy: +1 AP (whole attached unit) |
| Architect of Ruin | CSM | a mark ("hated foe"): Kravek Morne re-rolls wounds |
| Stand Vigil | AC | re-roll wound 1s; the whole roll on an objective |
| Captain-General | AC | led unit ignores penalties to hit and to BS/WS |
| Purity of Execution | AC | ranged vs Psykers: Devastating Wounds and Precision |

Each roster's wording matched Wahapedia's text exactly. They are seeded as **drafts**: the maths uses them, but the status says nobody has reviewed the translation.

Three things had to grow to express them:

- **Two effect fields.** `ignoreHitPenalty` (penalties to the hit roll and to BS/WS are ignored; bonuses still count) and `attacker` (the effect only reaches attackers with a keyword, for a buff one unit hands to another).
- **Situation switches come from the rules.** "Made a Dark Pact this phase" and "Target is the closest enemy unit" are new conditions. Rather than hardcode two more switches, a rule now carries its own condition's label and hint, and a list shows a switch for every condition its rules wait for. The rule editor can define one.
- **A mark can sit on one of your own units.** Master of Mechanisms buffs a friendly Vehicle, not an enemy. It uses the same switch mechanism as target marks, so the group in the controls is now just "Marks".

Judgment calls in the translations:

- *Master of Mechanisms* buffs one Vehicle. The matrix scores each unit on its own row, so with the switch on, every Vehicle is shown as if it were the one chosen.
- *Dark Pacts itself is not translated.* The switch drives Despoilers and Daemonforge only; the pact's own Lethal Hits or Sustained Hits 1 is a choice between two abilities, which the effect vocabulary can't express, so it is left to the modifier bar and the switch's hint says so. Nor is the Leadership test and its mortal wounds.
- *Purity of Execution* does nothing against the default targets, none of which is a Psyker.
- *Stand Vigil* reads "an objective marker you control" as the existing "Your unit is on an objective" switch.

### D-34. The import review shows each profile difference, and takes Wahapedia's unit by unit (2 October, your call)

The review used to say "3 profile differences" and offer one all-or-nothing checkbox, so the only way to see what differed was to save the list and open its Database check tab. Now the count is a button: the unit's row opens to the roster's profile and Wahapedia's, one above the other, with the cells that disagree marked on both.

- **Side by side, not before and after.** Neither row is struck through or shown as the correction. Wahapedia can lag a codex (D-12), so which is right is your call, and the page says so when Wahapedia is still on old prices for the faction.
- **Unit by unit.** Each opened row has its own "Use Wahapedia's profile for this unit". The checkbox at the top is now "all of them" and shows a half-tick when only some are chosen.
- **Profiles and points are separate choices.** Taking Wahapedia's profile used to rewrite the unit's points as well, even with "Use the Field Manual's points" unticked. It no longer does (`applyProfiles`, next to `applyPoints`; `applyCheck` is both). So that a roster with no points still arrives priced when the Field Manual hasn't been read for its faction, the points boxes are now pre-filled from Wahapedia in that case.
- **A matcher fix the view exposed.** Rosters split a two-profile weapon by type ("Guardian spear - ranged"); the datasheet has one name for both rows. These were reported as "not on the datasheet" and are now matched, which surfaced a real difference on the Custodes spears.

The panel leaves out ability differences, which the Database check tab still lists; they are about rules, which the review's Rules column covers.

### D-35. One built-in list; your rosters are test fixtures (2 October, your call)

*The Burning One and the Exile* is now the only built-in list: the imported v2, under the list's own name. The POC's hand-built v1 is gone from the app. On upgrade, an existing database drops v1, renames v2 (unless you've renamed it yourself) and moves you to it if v1 was open.

- **The id stays `builtin-burning-v2`**, so its URL, your saved options and the active-list setting carry over. Only the name changed.
- **Calibration moved with it.** v2 reproduces all four Culling Cogitator rows and the 88.0% anchor exactly, so the footer's live check now runs on it. The tests check the calibration on both v1 and v2, reading v1 straight from the POC, as they already did for Cophasta. Engine parity still covers all three POC lists, so nothing lost coverage.
- **Your four rosters are fixtures** (`tests/fixtures/rosters`, with a README): The Citadel Moves, Ten Thousand and No More, Strike Force Cophasta as re-entered, and The Wall Advances. `tests/rosters.test.ts` checks each one reads correctly, has no untranslated damage rules and scores every unit. Against the Wahapedia export, it checks that every unit finds its datasheet and names the weapons that don't. All 27 such weapons are in the two Space Marines lists and are real gaps: the 30 September codex added wargear options (plasma pistols and thunder hammers on Outriders), renamed close combat weapons (Ceramite Fists, Armoured Impact) and split the bolt rifle's profiles, none of which the 28 September export has. When Wahapedia catches up, that test will fail and the lists can be emptied.

### D-36. Drop a roster anywhere on the Lists page (2 October, your call)

Dragging a file over /lists dims the page and says "Drop to import". The dropped roster goes to the import page's own "read" action, so there is one import path, not two. A readable file lands on its review; an unreadable one shows the reason on the Lists page. Drop the text export (.txt) together with the roster to bring its points. A text export on its own, or any other kind of file, gets a sentence saying what to drop instead. Dragging text or links is left to the browser. Only the Lists page has this; the import page keeps its file picker.

---

## Things I chose not to do

- **No authentication.** One user, local. If you put it on Tailscale, Tailscale is the access control.
- **No "Draft with Claude".** Needs an API key and a cost decision that's yours.
- **No commit.** `git init` and a `.gitignore`, and the first commit left to you.
- **No changes to `kill-ledger/`.** It's the oracle for the tests.
