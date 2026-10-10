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

### D-37. Speed: under 100 ms for everything but imports and updates (2 October, your call)

The second-long load in your capture was the **dev server**, not the app: the server answered in 12 ms, and the rest was the browser loading Vite's unbundled development build (a 3 MB development copy of React, ~30 modules fetched one after another, the hot-reload runtime). A production build doesn't do that. `npm run preview` builds and serves one at http://localhost:3000. Use it to judge speed; `npm run dev` will always feel slower.

Measured on the production build (medians of 7, server time; toggles in the browser):

| | Before | After |
|---|---|---|
| Matrix page, full load | 65 ms | 38–50 ms |
| Database check tab | 145–222 ms | 18–29 ms |
| Database page | 52–57 ms | 10–18 ms |
| Import review | 187–218 ms | 35–40 ms |
| Datasheet browser | 16 ms | 4–6 ms |
| Toggling a switch: new numbers on screen | 30–100 ms | 20–44 ms |
| Toggling a switch: settled | 90–230 ms | 46–122 ms |

Lists, the library, and moving between a list's tabs were already 4–21 ms and are unchanged; tab moves don't touch the server at all.

What changed:

- **Read caches for data that can't change** (`app/.server/memo.ts`). A Wahapedia snapshot never changes once loaded and a stored Field Manual page never changes, and their ids are never reused. So everything read from them is kept in memory, per database connection: datasheets, enhancements, detachments, shared abilities, the name index, decoded Field Manual pages, and the agreement between the two sources. A new export or a new page has a new id and simply misses. The check went from 74 ms to 6 ms; the agreement from 45 ms to 3 ms.
- **Warm at start-up.** The server fills those caches in the background right after it starts, so the first visit is as quick as the rest.
- **The engine keeps what doesn't depend on the target.** Which rules reach a unit, which list-wide marks exist, and which marks the list can't set were worked out again for each of the ~380 cells; now once per unit or per list. The matrix went from 22 ms to 12 ms and the findings from 8 ms to 4.5 ms. The numbers are unchanged: the 72,618-cell parity test against the POC still passes.
- **A toggle computes the matrix once, not twice.** The page shows the new numbers before the server answers. When the server's copy of the list arrives, it was being treated as new data and everything was recomputed, to the same result. The list layout now keeps the previous objects when the content is the same.
- **Header links prefetch on hover**, as the list tabs already did.

Not done: skipping the server round trip after a toggle entirely. It would save a background request nobody sees, and needs the page to track settled changes by hand.

### D-38. Hosted on Cloudflare Workers Paid, in one Durable Object (2 October, your call)

You wanted khld.dev on Cloudflare with this as its first site, always on. The free plan was ruled out by its 10 ms CPU limit per request, which several pages exceed every time (the matrix, the database check, reading a roster), and by its 100,000 rows written a day, which one Wahapedia load uses up. The free-plan alternative was a rewrite that moves the heavy work into the browser and builds the reference data in a GitHub Action. You chose the $5 Workers Paid plan instead, which runs the app as it is.

- **One Durable Object runs the app**: its SQLite storage is the database, it renders the pages, and its alarm runs the scheduled update. This is the closest match to the app's design (one process, one SQLite file, in-memory caches, a background schedule), so only the database driver, the disk access and the schedule changed. See [cloudflare.md](cloudflare.md).
- **Served at khld.dev/cogitator-core** through routes, leaving the rest of the domain for other sites.
- **Public, no login**, at first and at your request (accounts followed in D-39). The update button has a ten-minute cooldown so it can't be used to hammer Wahapedia or Games Workshop.
- **Wrangler builds and deploys; `cf` manages the account.** `cf migrate` converted the project, but `cf build` can't yet build a React Router app (the details are in cloudflare.md), so the migration was reverted.
- **Local development runs in Cloudflare's runtime** (workerd, through Cloudflare's Vite plugin), with its own local database. Your old `data/cogitator.db` is no longer used by the app. The tests still run in Node.
- **Removed:** the Node server (`npm start`), the scripts that only fed the old local database (`update`, `wahapedia:load`, `db:migrate`, `db:reset`), and "Rebuild the datasheets from the last download" on the Database page (there's no disk to rebuild from). `wahapedia:fetch` and `mfm:fetch` stay, to download the data the integration tests read.

### D-39. Accounts: you and the friends you add (2 October, your call)

better-auth, email and password, and **no sign-up**: everyone uses the site as before, and accounts exist only for you and the friends you add by hand.

| Who | Can |
|---|---|
| Anyone | Open any list by its link, and try its switches and modifiers (kept in their browser, in a cookie, never on the list). Browse the library, the database and datasheets. |
| A friend | Import lists, which are theirs, and change them. |
| You (the owner) | Everything: check for updates and follow factions, edit the rules library and benchmark targets, manage accounts, and own the built-in list and any list from before accounts. |

- **The first account** is made at `/setup`, which works only while there is no owner and only with the `SETUP_CODE` secret, so nobody else can claim the site after a deploy. After that, the **Accounts** page (owner only) adds friends, sets a new password (there's no email, so you pass it on), and removes accounts, whose lists become yours.
- **better-auth runs on the app's own database.** Its four tables are migration `0005_accounts`. Its queries go through Effect's `SqlClient` via a small Kysely dialect (`app/.server/auth/dialect.ts`), so there's one connection and the same code runs in the Node tests. It's only called server-side from loaders and actions; its HTTP endpoints aren't mounted.
- **Enforced on the server**: every action checks (`app/.server/access.ts`); pages also hide what won't work. React Router's built-in check already refuses forms posted from other sites.
- **Sessions** last 30 days. The session cookie is scoped to `/cogitator-core` (khld.dev will host other sites). There's no cached copy of the session in a cookie, so a removed account or a new password takes effect at once. Sign-in is throttled after 8 failures per address or email in 15 minutes.
- **"Last opened list"** moved from a site-wide setting to a per-browser cookie, now that more than one person uses the site.

### D-40. Two rules translated for Astra Militarum (4 October, your call)
*By Writ of the Lord Solar!* had two rules flagged "not modelled". Both are in the library now, as drafts, and the roster is a test fixture:

| Rule | Who has it | Effect in the engine |
|---|---|---|
| Daring Recon | Scout Sentinels | a mark ("Spotted by the Scout Sentinels"): every unit's ranged attacks re-roll hit rolls of 1 against it |
| Rearm, Reload, Fire | Field Ordnance Battery, Heavy Mortar Team | under an Order and stationary: Sustained Hits 1 on Heavy weapons |

What had to grow:

- **An effect can be limited to weapons with an ability** (`weaponKw`, e.g. `"heavy"`), in the rule editor too.
- **A rule waiting for a situation is idle in the maths while its switch is off.** The switch was already shown that way, but only the rule's own clauses did the waiting. Every rule so far gated all its clauses on its condition, so nothing else changes. Rearm, Reload, Fire waits for "Under an Order" (a new switch) and its clause for "Remained stationary".
- **Re-reading a roster file keeps the list's prices** where the file has none. A roster file without its text export has no points, so re-reading one used to put every unit at 0 pts.

Judgment calls:

- *Daring Recon* reaches every unit in the list. It says Astra Militarum models, but the importer drops faction keywords, and every unit in an Astra Militarum list is one. Only Shooting-phase attacks, so ranged.
- *Rearm, Reload, Fire* has two wordings: the battery's gives its Heavy weapons Sustained Hits 1; the Heavy Mortar Team's gives all its ranged weapons, and its only one is the Heavy mortar. One translation covers both.
- *The Orders themselves aren't modelled* (open question 14). *Since D-45 they are, and "Under an Order" is set per unit by the Order you give it, not by a switch.*

### D-41. The engine reads every effect through one vocabulary (4 October, your call)

Before Orders, the engine got a cleanup. `attackWeapon` was one 240-line function that collected effects, merged the modifier bar's settings with the rules' by hand (they spelled the same things differently), did the dice, and wrote the notes as it went. Each new effect field touched five places.

- **One vocabulary** (`app/domain/fx.ts`): a table with one entry per effect field, holding its test (for *when* fields) or how it adds to the attack, its words and its editor help. The rule editor's description and help, and the engine, are all read from it.
- **Everything is a clause.** The modifier bar becomes one clause, translated once from its own settings. Heavy, Lance and Twin-linked are clauses too, checked after the rules (which can grant them). So they all combine by the same rules.
- **The attack sequence** (`app/domain/attack.ts`) is resolve, then small functions for attacks, hit, wound, save and damage with no text in them, then the notes written in one place.
- **Not Effect.** `Effect.fn` would have added about 13 µs to each of the roughly 1,400 weapon scorings in a matrix and bought nothing: none of this can fail, waits on anything, or needs a service.

The rebuilt engine was compared with a copy of the old one on 225,000 cells (eight lists, 50 option settings, 20 targets, split and combined): every number, every note and every skip reason is the same. It is also faster, because what doesn't depend on the target is now worked out once per matrix row: a full matrix takes about 3 ms instead of 5.

### D-42. Anti-X: every one a weapon has, and rules can grant it (4 October, your call)

A weapon could only hold one Anti ability, so the 33 Wahapedia weapons with two (Concussion Maul: Anti-Monster 3+, Anti-Vehicle 3+) kept only the last one read. Rules couldn't grant Anti at all, though 26 abilities, stratagems and enhancements in the export do, often two at different rolls ("[ANTI-INFANTRY 2+] and [ANTI-MONSTER 5+]").

- **Several per weapon.** A weapon with one Anti ability still stores it as the `["INFANTRY", 2]` pair every saved list and the seed use, so nothing needed migrating; one with several stores a map, `{ "MONSTER": 3, "VEHICLE": 3 }`. Against a target, the best roll among the keywords it has counts. The dossier shows each one, and the loadout editor takes them as words (`anti-monster3 anti-vehicle3`).
- **A rule can grant it**, with the new `anti` effect field: `{ "phase": "ranged", "anti": { "INFANTRY": 2, "MONSTER": 5 } }`. Where the weapon already has the keyword, the better roll wins.

No screen control was added for it: a stratagem or ability that hands it out is written as a rule, and switched on like one.

### D-43. The rule editor builds effects from menus (4 October, your call)

The effect used to be JSON typed into a box, so writing one meant knowing the vocabulary by heart. Now each field in the vocabulary (fx.ts) also says what kind of input it takes and its starting value, and the rule editor builds each clause from that:

- **Each clause** lists its conditions (When) and what it does (Does). "Add a condition…" and "Add an effect…" offer the fields it doesn't have yet. Each field gets the input its kind calls for: a menu (ranged or melee, re-roll 1s or all), a switch or mark picked from the ones that exist (or another key typed in), keyword lists, a number, ability checkboxes, or keyword-and-roll rows for Anti-X.
- **It reads back in words** as you edit it ("melee: Lance").
- **The JSON is still there**, under "As JSON". It's what the form saves, so saving and validation didn't change, and editing it by hand rebuilds the clauses.
- **Empty fields aren't saved**: a weapon name not typed yet, or a keyword filter with no keywords, which would otherwise match no target at all.

A field added to the vocabulary gets its input here without touching the editor.

### D-44. Strength, Attacks and Damage in the modifier bar (4 October, your call)

The modifier bar gained **Strength**, **Attacks** and **Damage**, each −1 to +2, for stratagems like Ruthless Killers (+1 Damage for a Corsair Voidscarred unit). Like the rest of the bar they can be set for all units, one datasheet or an attached unit, and limited to ranged or melee. They're characteristic changes, so they aren't capped and they stack with rules; a target's damage reduction still applies. The bar becomes an effect clause in the engine (D-41), so they combine with rules exactly as a rule's `s`, `a` and `d` do. Options saved before they existed still load.

### D-45. Astra Militarum Orders, unit by unit (4 October, your call)

Orders are modelled. **Pick a unit in the modifier bar and give it an Order**; the bar shows an Order menu only on lists that can issue them.

- **The Orders are library rules** (source "Order"), so they can be read and edited like any other. Take Aim! improves BS by 1 at range, Fix Bayonets! WS by 1 in melee, First Rank, Fire! Second Rank, Fire! gives Rapid Fire weapons +1 Attack. Move! Move! Move!, Take Cover! and Duty and Honour! don't change damage dealt, but the unit is still under an Order.
- **Voice of Command names the Orders** a list can issue (a new `orders` field on a rule), so a detachment rule that adds an Order only has to name it too.
- **A new effect field, `skill`**, improves BS or WS. It's a characteristic change, so it adds to a +1 to hit rather than being capped with it.
- **"Under an Order" is per unit.** Rules that wait for an Order, like Rearm, Reload, Fire, wake for the unit that has one; the list-wide "Under an Order" switch from D-40 is gone. The most specific Order counts: a datasheet's over its attached unit's over all units'.
- **The app doesn't police who can receive which Order**, how many an Officer can issue, or whether one is within 6". That's left to you, as marks are.
- **Seeded rules nobody has edited now follow the seed**, so corrected wording (Rearm, Reload, Fire's, here) reaches the live site. Rules you've edited are left alone.

### D-46. AI agents use the app through an MCP endpoint (4 October, your call)

You asked for the app to be usable by agents. The `cf` CLI had little to offer: khld.dev already lets every AI bot in (bot protection, AI crawler blocking and training/search/user-agent blocking are all off), Markdown for Agents needs a Pro plan and only converts origin responses (every page here comes from the Worker), and AI Search with NLWeb would only index crawled pages, not the scores the app computes under switches and modifiers. So the app now has its own **MCP endpoint at `https://khld.dev/cogitator-core/mcp`**, which Claude, ChatGPT and coding agents can add as a connector.

- **Six read-only tools:** `list_lists`, `get_list` (units, weapons, rules, and the switches, marks and Orders a list can use), `score_list` (the matrix, under any switches, modifiers, Orders and rule switches), `explain_matchup` (one unit against one target, weapon by weapon), `list_targets`, and `search_rules`.
- **It sees what a signed-out visitor sees**: the built-in list by name, any other list by its link or id. Nothing an agent sets is saved. No sign-in, so no OAuth; writing to lists through it would need one.
- **The same engine and view model as the pages**, so its numbers are the page's numbers; options are applied the way the controls apply a click.
- **Served by the Durable Object before React Router** (no cookies, no form checks, open CORS), with a small hand-written MCP layer: stateless Streamable HTTP, JSON responses, the four methods a tools server needs. The official SDK would have brought an HTTP framework and a JSON Schema compiler that generates code, which Workers forbid. The tests drive the endpoint with the SDK's own client, so they're known to agree.
- **Agents' guesses are forgiven**: units and targets can be named by id, name, or a part of the name only one has, and a wrong one is answered with the valid choices.

*Since D-47 the endpoint requires sign-in.*

---

### D-47. Agents sign in with your accounts; every request goes in a usage log (4 October, your call)

You wanted the people you've given accounts to use the MCP endpoint, to know who uses your compute, and tools only you can call. The endpoint now **requires sign-in** (D-46's anonymous access is gone; the website stays public), through OAuth with the accounts you already make by hand.

**How a friend connects.** They add `https://khld.dev/cogitator-core/mcp` as a connector. Their app gets a 401 pointing at the discovery documents, registers itself, and opens the site's sign-in page ("Claude wants to use Cogitator Core with your account"), then a consent page ("Allow Claude?"), and gets a signed access token for the endpoint. Consent is asked once per app.

- **better-auth is the OAuth server**: `@better-auth/mcp` with its JWT plugin, on the same database (migration `0006_oauth`, its SQL written by better-auth's own generator). Clients can register themselves (RFC 7591, as Claude and ChatGPT do) or identify themselves by URL (Client ID Metadata Documents, `@better-auth/cimd`, with a fetch made for Workers). Registering grants nothing: a client still needs one of your accounts and that person's consent.
- **Only the OAuth endpoints and discovery documents are on the web**; the rest of better-auth stays server-side. Discovery sits at the domain's root with the app's path after it, so three narrow Worker routes (`khld.dev/.well-known/oauth-authorization-server/*`, `…/oauth-protected-resource/*`, `…/openid-configuration/*`) send just those to the app.
- **Every MCP call is checked**: the token's signature, issuer, audience and expiry (in-process, against the signing keys), that the account still exists, and that the person hasn't disconnected the app. So removing someone, changing their password or disconnecting their app cuts them off at once, not when the hour-long token lapses.
- **A friend gets the six read tools**, and `list_lists` now names their own lists. **You get three more**, listed only to you and refused to anyone else: `usage_report`, `check_for_updates` (the Database page's button, with its ten-minute cooldown, now one shared function) and `manage_accounts` (accounts, their connected apps, disconnecting).
- **The usage log covers the whole site**, at your suggestion, not just MCP, so abuse shows up too. Every request the app answers (pages, page data, form posts, OAuth, MCP) is one row in `usage`: time, kind, account if any, a visitor id, country, app, method, path (no query, which carries OAuth codes), MCP tool, status and size. IP addresses aren't stored: a visitor is a keyed hash of the address, so one place's traffic can be grouped without keeping where it came from. Rows are kept 90 days, pruned by the scheduled update. Each request also writes the same as one JSON log line, which Cloudflare's Workers Logs pairs with that request's exact CPU and wall time (7 days); the report itself is counts, as you chose. Requests the zone's rate-limit rule blocks never reach the app, so Cloudflare's security events cover those.
- **Two things found on the way.** The sign-in and consent steps have to go through better-auth's HTTP handler, because the authorization they carry on with reads the whole request; and their redirects are full-page loads at absolute addresses, or React Router would read `/cogitator-core/consent` as inside the app and give it the base path twice. The second only showed in the browser, which is why the flow was also run end to end on the dev server.

The tests sign clients in the way Claude does (register, authorize, sign in, consent, token) and then use the official MCP SDK's client with the token: discovery, the 401 challenge, consent once per app, a friend's tools against the owner's, the usage report, disconnecting at once, and a removed account shut out.

---

### D-48. Weapons a model gave up are dropped on import (5 October, from "The Fifteenth Grievance")

You said the Thousand Sons list was still badly wrong after its points were fixed. Its prices were right by then, but its guns weren't. **40k.app's roster files keep the weapon a model gave up for an option.** The Rubric Marine with a soulreaper cannon still carries the inferno boltgun the cannon replaced, so every squad shot nine boltguns instead of eight. The same was true in most of your other lists: Kasrkin with plasma guns kept their hot-shot lasguns, Eradicators with multi-meltas kept their melta rifles, and Boyz with big shootas kept their shootas.

- **Wahapedia's wargear options say what replaces what.** For example: "1 Rubric Marine's inferno boltgun can be replaced with 1 soulreaper cannon". They also tell a swap from an addition, such as "can be equipped with 1 Astartes grenade launcher". `wahapedia/swaps.ts` reads every datasheet's options from the current export.
- **Only a model that took an option loses anything.** 40k.app names such a model after what it took ("Rubric Marine w/ Soulreaper cannon"). The importer drops a weapon only when the datasheet says the taken weapon replaces it. A model with two weapons by default, or with one it was given as well, keeps both. A unit whose name isn't in the export tries a shorter one: "Eradicator Squad with melta rifles" uses "Eradicator Squad".
- **"Read the file again" picks this up**, as well as new imports, so a saved list is fixed without importing it again. Prices are kept.

Found while checking the same lists:

- **Thousand Sons rules** from the list are now in the library: Bringers of Change, Malefic Maelstrom, Empyric Guidance, Marked by Fate (a target mark) and Lord of the Rubricae. The roster calls the army rule, Cabal of Sorcerers, "-" (no text), so it stays out.
- **A price that includes wargear is right.** The Field Manual charges some wargear on top: 5 per storm shield, 10 for a heavy laser destroyer. A Terminator Assault Squad at 195 (170 plus five storm shields) was flagged as wrong. "Update points" would then have set it to 170. A price that is the unit's cost plus some of its wargear now counts as right, and updating keeps it.
- **"Heretic Astartes" is Chaos Space Marines.** 40k.app writes the faction that way, which matched no Field Manual page. The Citadel Moves was checked against Wahapedia's older prices, and its "Update points" would have lowered eight correct prices.
- **The 65% line counts what the cells show.** A cell reading 65 was really 64.7% and wasn't counted, so "Units at 65% or better" read like "better than 65%". The colour bands and the counts now use the whole number shown.

The tests read The Fifteenth Grievance (now a fixture) with Wahapedia's options and check the squads have eight boltguns and the Kasrkin five lasguns. They also check that a list whose options only add weapons comes out unchanged.

---

### D-49. Coverage by toughness band (8 October, from a coaching video)

You liked the check from the Culling Cogitator's author: a list wants at least two units that really hurt each toughness band. The bands are T3–4, T5, T6, T7–9, T10–11 and T12+, the points where common weapons start wounding more or less easily. It's a new list tab, **Toughness bands**. It's built from the matrix the page already computes, so it runs nothing new and follows the phase, attached units, modifiers and switches like everything else.

- **Two meanings of "hurts", with a switch between them.** *Removes 80+ pts* is the video's test: one activation takes 80 of the target's points off the table. *Returns 65%+* is the matrix's efficient line. They give different answers. Big units pass the first and cheap ones the second, so neither is hidden. The video's test is the default.
- **80 points, or the whole unit when it's worth less.** Ten Cadians are 70 points and Genestealers 75, so nothing could ever pass the plain 80-point test against them. Wiping the unit counts instead. Overkill never counts, whatever the matrix's wound cap is set to.
- **A unit covers a band when it hurts at least half the band's targets.** The video used two targets per band and didn't say whether a unit had to hurt one or both. Half generalises "either of two" to our bands of three, four and five targets.
- **The benchmarks stay as they are.** The 19 targets fill every band, but T12+ has only the Land Raider, and the page says so. A second one is a few clicks in the datasheet browser. I didn't add one to the seed, because the seed only reaches a fresh database.

On the built-in list with the table defaults, the 80-point test passes every band, but from T6 up only Fuegan, Lhykhis and Yriel with their units count. On returns, T6 has only Yriel + Voidscarred.

---

### D-50. Rules are translated through the MCP, not "Draft with Claude" (10 October, your call)

The roadmap's phase 4 was a button that sent a rule to the Anthropic API and filled in the rule editor with what came back. That needed a key on the site and someone to pay for it. The MCP endpoint does the same job better. Your own agent does the drafting, on your Claude account. It can look at the list, the units and their weapons, save a draft, check it with `explain_matchup`, and fix it.

- **`save_rule` is the rule editor's save.** The form's action and the tool both call `saveRule()` (`.server/library.ts`), so they can't disagree on what a valid rule is. The effect is decoded strictly, so a misspelt field comes back with where it is. The form sends every field; an agent sends only what it changes, and the rest is kept.
- **It saves drafts only.** A draft counts in the maths as soon as it's saved, so you lose nothing by verifying it yourself on the rule's page. The rule's notes say which app drafted it and for whom, with whatever the agent wasn't sure of. Saving over a verified rule makes it a draft again.
- **The site's owner only**, as with the rule editor. It's the MCP's first tool that writes, and it says so in its annotations, so clients can ask before using it.
- **The vocabulary is in the tool's description,** generated from `domain/fx.ts`, the same table the rule editor's help comes from. A field added there reaches the agent too.
- **The `translate_rules` prompt** is the roadmap's drafting prompt, run on your data. Pick it in your client (a slash command in Claude Code) with a list. It gives your agent:
  - the list's rules the library doesn't have, with their text, and the units that have each, with their weapons and keywords;
  - the library drafts the list uses;
  - the conditions and marks already in use;
  - five verified rules as worked examples, picked to cover as much of the vocabulary as they can.

  Rules the importer read as no effect on damage are there too, with their text except for core rules, because that judgement is a word list. On the Astra Militarum test roster it misses Called Shots, which re-rolls a hit, a wound and a damage roll.
- **Lists match the library by name.** A rule the importer didn't know stays with the list under its own id. Before, a translation reached it only when the roster was read again, which also replaces hand edits. Now, once the library has a rule of that name, the library's translation is used for it (`domain/book.ts`), matching the name the way the importer does. Army rules are left to the importer, since it files them with the list rather than a unit. The built-in list's rules come out the same, which a test checks, so the calibration can't move.
- **`get_list` shows the rules that aren't in the library,** with their text where they read like they change damage.

The rule card's "Open in the rules library" now goes to the library rule a list's rule stands for. "Give it an effect in the rules library", on a rule nobody has translated, opens the library searched for its name. Before, both links went to the list's own id, which isn't a page.

---

## Things I chose not to do

- **No authentication.** One user, local. If you put it on Tailscale, Tailscale is the access control.
- **No "Draft with Claude".** Needs an API key and a cost decision that's yours. (Dropped for good on 10 October; D-50 does the job through the MCP.)
- **No commit.** `git init` and a `.gitignore`, and the first commit left to you.
- **No changes to `kill-ledger/`.** It's the oracle for the tests.
