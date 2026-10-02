# The Munitorum Field Manual

Added 2 October 2026, after the v1.5 points update landed that morning and neither Wahapedia nor an older roster knew about it.

- Source: https://mfm.warhammer-community.com, Games Workshop's own points list, one page per faction (30 pages)
- What it has: unit points by size and tier, wargear costs, enhancement costs, detachment points, force dispositions, and which units a character can join
- What it doesn't have: profiles, abilities, rules text. Those still come from Wahapedia.

## What the app does with it

**Points are checked against the Field Manual first.** Wherever the app compares a list's points with "the database" (the Database check tab, the import review), it uses the Field Manual for the list's faction if it has been read, and falls back to Wahapedia's points if not. Profiles and stats are still checked against Wahapedia. The check page says which source each price came from.

**A list tells you when its points have drifted.** Every list page compares its units with the Field Manual when it loads. If any are priced differently, a notice appears under the list's name with the count and what the list would total at current prices, linking to the Database check tab.

**One click brings the points up to date.** "Update points from the Field Manual" on the Database check tab changes what units and enhancements cost and nothing else. It is separate from "Use Wahapedia's profiles too", because points and profiles can be current at different times.

**Imports take Field Manual points by default.** The import review has a box, ticked by default, that saves each unit at its current official price. A roster with no text export used to arrive with every unit at 0 points; now it arrives fully priced, enhancements included.

**It tells you when Wahapedia is behind.** Both sources carry points, so the app compares them: for each faction you follow, does Wahapedia's export have the prices the Field Manual has now? If not, the export predates the latest update and its datasheets may too. The Database page says so at the top, and a list's Database check tab says so above its profile differences.

## Keeping it current

There is one action, on the Database page: **Check for updates**. It reads the Field Manual for every faction you follow, then asks Wahapedia whether its export has changed and loads it if so. From a terminal:

```bash
npm run update
```

The app also does this by itself while it's running: shortly after start-up and every six hours, skipping anything checked in the last twenty. In practice that is once a day. Set `COGITATOR_AUTO_UPDATE=off` to turn it off.

"Factions you follow" means every faction that has a list, plus any you add under *History and tools* on the Database page.

The two halves can still be run separately from a terminal, for when one site is down or you want every faction's points at once:

```bash
npm run mfm:fetch -- --all
```

```bash
npm run wahapedia:fetch
```

## How a page is read

The Field Manual is a Next.js app. Fetching a page with a plain HTTP client returns HTML with the content out of order: every unit name first, then every price, with scripts that rearrange them in the browser. Stripping tags from that is useless.

The same content is also embedded in the page as React's serialised data, a list of JSON rows that reference each other. `app/.server/mfm/flight.ts` reads those rows and walks them from the root, which gives the page's text in the order a reader sees it. `parse.ts` then reads that text by its wording, not its markup:

```
FIRE DRAGONS  ▼
YOUR 1ST TO 2ND UNITS COST   5 models  ▼ (-10) 110 pts   10 models  240 pts
YOUR 3RD + UNIT COSTS        5 models  ▼ (-10) 120 pts   10 models  250 pts
```

A unit is a name followed by a "YOUR … COST" header. A detachment is a name followed by its detachment points. This means a restyle of the site won't break it, and a reword will: if the parser finds no unit prices it fails with a clear message rather than storing half a faction, and the Database page shows that faction's last check as failed.

## What is stored

One snapshot per faction per distinct set of prices (`mfm_snapshots`), with the parsed page as a JSON document, and the page itself saved under `data/mfm/<faction>/`. A fetch that finds the same prices stores nothing; it only records that it looked. The last six snapshots per faction are kept.

Each snapshot records what moved. Against a previous snapshot, that is a real comparison. For the first snapshot of a faction there is nothing to compare with, so the app uses the changes the page itself marks (the ▲ and ▼ figures), which describe the latest update.

## Verified

- All 30 faction pages parse (tried once each on 2 October, without storing the other 28). Aeldari v1.5 is 76 units and 15 detachments; Space Marines v1.5 is 87 and 22, with the chapter and sub-faction headings in the right places.
- *The Burning One and the Exile* (the imported v2, now the only built-in list) and your re-entered Strike Force Cophasta both agree with it on every price.
- Importing the old Cophasta roster reproduces the finding from that morning: nine units differ, 1,980 points at current prices against 1,990 in the file. "Update points" fixes all nine and leaves the profiles alone.
- `tests/mfm.test.ts`: 19 tests covering the data reader, the parser, version comparison and list pricing.

## Limits

- **It depends on the site's wording and on Next.js embedding its data.** Either can change without notice. The failure is loud, not silent.
- **Wargear costs are read but not applied.** A unit with per-weapon costs (a Wraithknight's heavy wraithcannons) gets a note to check by hand.
- **Legends units aren't included.** The page hides them behind a toggle and doesn't send them by default.
- **Only two factions have been checked against lists.** Every page parses, but only Aeldari and Space Marines prices have been compared with real lists. Two things turned up on other pages and are handled: a few units are priced by composition rather than model count (Crusader Squads, Gretchin, Wolf Guard Headtakers), and Imperial Agents lists some units twice at different prices, where the app accepts either.
- **This is a public web page, not a published data feed.** The app asks for it rarely and identifies itself. If Games Workshop objected or blocked it, the fallback is Wahapedia's points, which is where things stood before.
