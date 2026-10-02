# The Wahapedia data export

What the export is, how the app uses it, and what the real files turned out to contain.

- Export page: https://wahapedia.ru/wh40k11ed/the-rules/data-export
- Specification: `Export Data Specs.xlsx` (v20260817b), kept beside each download
- Downloaded: the export stamped **2026-09-28 02:38:04** (GMT+3), in `data/wahapedia/2026-09-28_023804/`
- Credit: "powered by Wahapedia", with a link to the author's support page, is in the footer of every page, as the author asks

## Getting an update

From the app: **Database → Check Wahapedia for a newer export**. From a terminal:

```bash
npm run wahapedia:fetch
```

Either one reads `Last_update.csv` first. If the timestamp hasn't moved, nothing is downloaded. Otherwise it fetches the 21 files one at a time with a pause between them, stores them in a new folder named after the timestamp, loads them as a new snapshot, writes the change report, and re-links the rules library. A few times a year is plenty.

**If it can't reach the site, turn your VPN off.** With the VPN on, this machine's DNS can't resolve wahapedia.ru (lookups time out; other sites are fine). That's what stopped the first attempt last night.

If you'd rather download by hand, put the CSVs in a folder named like `data/wahapedia/2026-12-01_120000` and run `npm run wahapedia:load`.

## The format

The 11th edition export is 21 pipe-delimited CSV files, UTF-8 with a byte-order mark. The handoff asked to confirm the names and columns from the spec before writing the loader; they are confirmed, and recorded in `app/.server/wahapedia/tables.ts`.

Compared with the 10th edition layout the handoff listed, 11th edition adds:

- `Detachments.csv`, with detachment points and **force disposition** (Priority Assets, Reconnaissance…), and `Detachments_chapter_dp.csv` for Space Marine chapter overrides
- `is_support` on datasheets (Support rather than Leader)
- `detachment_id` on enhancements, stratagems and detachment abilities; `upgrade` and `support_leader` on enhancements

Three things about the files that aren't in the spec and that the loader has to cope with:

1. **Fields contain raw newlines.** The files are unquoted, and HTML fields such as ability descriptions span many lines. Reading line by line corrupts them. The parser splits on `|` and counts fields instead (decision D-15).
2. **There are no real keys.** Some files repeat rows exactly, wargear `line` is blank on datasheets shared between factions, and one ability id can appear under several factions. The change report compares rows under a key as a bag rather than assuming one row per key.
3. **Datasheets are duplicated across factions.** Prince Yriel exists once under Aeldari and once under Drukhari, with different ids. Matching a unit by name has to prefer the copy in the list's own faction, and to prefer current datasheets over Legends and Forge World ones.

| File | Rows | Loaded |
|---|---:|---|
| Datasheets | 1,660 | yes |
| Datasheets_wargear | 8,996 | yes |
| Datasheets_abilities | 6,935 | yes |
| Datasheets_keywords | 16,212 | yes |
| Datasheets_models | 1,767 | yes |
| Datasheets_models_cost | 6,269 | yes |
| Datasheets_options | 2,745 | yes |
| Datasheets_unit_composition | 2,107 | yes |
| Datasheets_enhancements | 11,409 | yes |
| Datasheets_detachment_abilities | 16,101 | yes |
| Datasheets_leader | 1,595 | yes |
| Abilities | 95 | yes |
| Enhancements | 1,024 | yes |
| Detachment_abilities | 350 | yes |
| Detachments | 329 | yes |
| Detachments_chapter_dp | 4 | yes |
| Factions | 25 | yes |
| Source | 66 | yes |
| Stratagems | 1,638 | kept on disk, not loaded |
| Datasheets_stratagems | 86,024 | kept on disk, not loaded |
| Last_update | 1 | read for the timestamp |

77,689 rows per snapshot. Loading takes about a second.

## What the real data showed

### Points are in the export, and they're tiered

This answers the handoff's first open question. `Datasheets_models_cost.csv` has a price per unit size, under headers:

```
Fire Dragons
  YOUR 1ST TO 2ND UNITS COST     5 models 120    10 models 240
  YOUR 3RD + UNIT COSTS          5 models 130    10 models 250
```

So in 11th edition the third copy of a unit costs more. The app reads the tier out of the header and works out which tier a unit falls in from its position among units of the same datasheet in the list.

Space Marine datasheets list several price blocks side by side with no label saying which is which (Bladeguard Veterans, 3 models: 80 in two blocks, 85 in a third). I believe these are per-chapter prices, but the export doesn't say. The app treats them as a set: a unit's price is fine if it matches any of them, and it only offers to overwrite points when there is exactly one candidate.

Some datasheets also have per-weapon costs (`per Multi-melta`, `+ 1 Invader ATV`). The app notes these and leaves them to you.

### The Aeldari list agrees with the database

*The Burning One and the Exile* (the imported v2, now the only built-in list), checked against the snapshot:

- All 20 units resolve to a datasheet.
- **Every weapon profile matches**: attacks, skill, strength, AP, damage and abilities, for every weapon in the list.
- Stats match.
- Four points values differ, all higher in the database:

| Unit | In the list | In the database |
|---|---:|---:|
| Fire Dragons (5) | 110 | 120 |
| Kharseth | 80 + 35 Archraider | 85 + 35 |
| Farseer | 60 | 65 |
| Shroud Runners (6) | 165 + 15 Assassins' Eye | 175 + 15 |

At database prices the list is 2,030 points, not 2,000.

**Resolved, 2 October:** the list is right. The Munitorum Field Manual on Warhammer Community is at v1.5 for Aeldari and marks each of these four as a points drop; the export carries v1.4. So the export lags the official points as well as the Space Marines codex.

### The Space Marines list does not

*Strike Force Cophasta* disagrees with the database in 87 places across all 17 units. The pattern is consistent:

| | Roster | Database |
|---|---|---|
| Marine Toughness | 5 (bikes 6) | 4 (bikes 5) |
| Bolt weapons | Strength 5, AP −1 | Strength 4, AP 0 or −1 |
| Outrider Squad, 3 models | 85 pts | 70 or 75 |
| Kor'sarro Khan | 80 pts | 55 |
| Weapons in the roster with no match | Anzuq, Relics of Battle, Ceramite Fists, Armoured Impact, Pyrecannon… | |
| Abilities | Full-throttle Assault, Deeds of Legend, Raise the Banner | Thunderous Impact, Deeds of Heroism, Astartes Banner |
| Detachments | Spearpoint Task Force, **Assault Brethren** | Spearpoint Task Force only |
| Army rule | Combat Doctrines | Oath of Moment (Combat Doctrines is a detachment rule there) |

The roster describes a newer set of Space Marines rules than the export holds. The export's source for the faction is "Space Marines, Faction Pack, edition 11, v1.2, 26 Aug 2026", and "Captain on Bike" only exists as a Legends datasheet. The benchmark targets point the same way: the Cogitator's Intercessor Squad is Toughness 5, which matches your roster, not the export.

My reading was that the Space Marines codex is out and Wahapedia hasn't loaded it yet. **Confirmed, 2 October:** the codex numbers were released on 30 September, two days after this export, and Wahapedia's live pages still show the old profiles. Either way the consequence is the same: **for Space Marines, the roster is currently the better source**, and the app must not overwrite it unasked (decision D-12).

When a newer export lands, the change report on the Database page should show exactly this: a few hundred Space Marines rows changing at once. That's the moment to re-run the check on Cophasta.

### Rules that have no official text in the export

52 of the 62 library rules link to official wording. The ten that don't:

- *Space Marines (9):* Assault Brethren, Deeds of Legend, Full-throttle Assault, Furious Assault, Imperium's Sword, Into the Fray, Shattered Defences, Spearpoint Task Force (the library's summary entry, which isn't a single named ability), Targeted Intercession. Same cause as above.
- *Aeldari (1):* Void Thieves. The export's Corsair Coterie has Relentless Raiders and Veterans of the Void, and nothing called Void Thieves. Possibly renamed or folded into another rule; worth a look at the detachment on Wahapedia.

The handoff flagged the Spearpoint Task Force, Wrath of the First Khan and Assault Brethren text as unverified. Wrath of the First Khan does link, and the two wordings differ: the library's paraphrase says the unit moves or falls back "if it was eligible to fight"; the export says it makes a Normal move of up to 6" if it *destroyed an enemy unit this phase* and isn't in Engagement Range. Neither changes damage, so no number moves, but one of them is out of date. Both are on the rule's page in the library.

A linked rule is not a checked rule. Linking is by name, so Combat Doctrines links to the export's detachment rule of that name, which is not the army rule your roster means. The library shows the official wording beside the paraphrase precisely so that mismatches like these two are visible; it doesn't judge them.

## How the app uses a snapshot

| Use | Where |
|---|---|
| Resolve a unit to its datasheet | `check.ts`: by normalised name, preferring the list's faction, then current over legacy datasheets |
| Compare points, weapons, stats, abilities | `check.ts`, shown on each list's Database check tab and in the import review |
| Show a unit's profile beside its datasheet's | `profileDiff` in `check.ts`, in the import review's expandable rows |
| Write database values over a unit | `applyCheck` in `check.ts`, on request: `applyProfiles` for weapons and stats, `applyPoints` for prices |
| Show official wording beside each library rule | `sync.ts` links rules by name and faction; the text is on the rule's page |
| Notice a reworded rule | `sync.ts`: a changed hash drops the rule to draft |
| Report what an update changed | `diff.ts`, stored with the snapshot, shown on the Database page |
| Browse datasheets, add one as a benchmark target | `/database/datasheets` |

## Limits to be aware of

- **Weapon matching is by name.** "Chainsword" finds "Astartes chainsword" and a plural finds its singular, but a renamed weapon shows as "not on the datasheet". There's no alias table yet; the roadmap suggested one, and the check page shows where it would be needed.
- **The check compares a unit against any of its datasheet's model profiles.** A unit whose roster profile matches the Exarch's line passes. It does not yet check each model group against its own profile.
- **Wargear options aren't validated.** The app doesn't check that a loadout is legal, only that each weapon carried exists on the datasheet with the same profile.
- **Abilities are compared by name only.** The check says which abilities are on the datasheet and not on the unit, and the reverse. It does not compare the roster's ability text with the database's.
