# Kill Ledger: Handoff

**Status as of 2 October 2026.** A working single-file web app that scores Warhammer 40,000 (11th edition) army lists by points-for-points damage, published as a claude.ai artifact. This document is everything a new chat (or Claude Code) needs to keep building it without re-deriving decisions.

- **Live app:** https://claude.ai/artifact/M2DPgK9DxnmjcPaf9rUrrK
- **Source bundle:** `kill-ledger-source.zip` (this file is `HANDOFF.md` inside it)
- **Build:** `python3 build.py` → `dist/kill-ledger.html`
- **Tests:** `node tests/calibration.test.js` and `python3 tests/import.test.py` (both must pass)

---

## 1. What the app is

Kill Ledger answers one question for every unit in a list against every target in a benchmark set: *how many enemy points does this unit remove per point it costs?*

```
return % = (wounds dealt ÷ your points) × (their points ÷ their total wounds) × 100
```

- 100%+ means the unit pays for itself in one activation. 65% is the "efficient" line (borrowed from the Culling Cogitator, a YouTube-linked tool the user started from). 35–64% is chip damage.
- Example that anchors everything: Prince Yriel (95 pts) into Warp Spiders (105 pts, 5 wounds, so 21 pts/wound) deals 3.98 wounds → (3.98 ÷ 95) × 21 × 100 = **88.0%**. This number is a regression test.

### Views

| Route | View | What it shows |
|---|---|---|
| `#/` | Damage matrix | Units (rows) × 19 benchmark targets (columns), heat-coloured; Avg and Best columns; coverage row (units at 65%+ per target); three auto-written findings |
| `#/unit/<id>` and `#/unit/<id>/vs/<targetId>` | Unit dossier | Sorted matchup bars, the per-weapon attack table, the **Σ panel** (the formula with the real numbers), rules in play, loadout (editable) |
| `#/target/<id>` | Target page | Editable defensive profile; every attacker ranked against it |
| `#/rules` | Rules matrix | Every rule in the list as chips by unit and column (enhancement, abilities, wargear, shared from attached unit, marks); tap a chip for the rule card and its switch |
| `#/import` | Import | Roster file + optional text export → review table (points, enhancements, attachments, rule counts) → save; list management |

### Controls (top of every view)

- **Phase:** All / Shooting / Melee.
- **Attached units:** As one unit (default) / Split.
- **Modifier bar** (per scope: All units, an attached unit, or one datasheet): Applies to (both/ranged/melee), Hit ±1, Wound ±1 (both capped at net ±1), AP −2…+3, Sustained 1, Lethal, Re-roll hit (off/1s/full), Re-roll wound (off/1s/full), Cover, Half range, Rapid Fire 1–4.
- **Situation:** Charged this turn (on by default), Remained stationary, Target is on an objective, Target is a Character unit, Your unit is on an objective.
- **Target marks** (only shown when a unit in the list can set them): Riven, Webbed, Guided, Raiders' quarry, Spirit-marked, Shattered, Hailstrike-marked.
- **Accounting:** Count enhancement points (on), Stop at the unit's total wounds (off).
- **Presets:** Table defaults; Bare datasheets (turns off leader buffs and re-rolls, which is how the Cogitator scores).

### Who it's for

One experienced player who plays several factions, builds lists in **40k.app**, plays mostly on a phone, and wants numbers to settle list-building arguments. Preferences learned so far:
- Matrix views over prose. Numbers over opinions.
- **Stratagems are deliberately excluded** from all maths.
- Plays **Priority Assets** force disposition with Aeldari, so action-doing units have value the matrix can't see.
- Wants trusted, versioned rules data rather than trusting whatever a roster file says (see roadmap).

---

## 2. Current feature set

- Three **built-in lists**: *The Burning One and the Exile* (hand-built, the calibration reference), *The Burning One and the Exile v2* (from the Oct 2 roster and text export, opens by default), *Strike Force Cophasta* (White Scars).
- **Importer** for `.ros`/`.rosz` roster files (tested with 40k.app exports) plus the 40k.app text export for points, enhancement costs, detachments and wargear the roster omits. Saved lists live in browser `localStorage`.
- **Rules library** for Aeldari (Asuryani + Anhrathe) and Space Marines/White Scars, with a generic effect system (`fx`) so most new rules are data, not code.
- **11th-edition weapon keywords:** Close-Quarters, Blast X, Cleave X, One Shot, conditional keywords (`SUSTAINED HITS 1: non-MONSTER/VEHICLE`), slash Anti (`ANTI-MONSTER/VEHICLE 4+`).
- **Leader and support characters** (a bodyguard can carry one of each); shared rules flow both ways when they're written as unit-wide.
- Dark/light theme (auto, toggle), mobile-first layout, no horizontal page scroll at 390px.

---

## 3. Repository, build and publishing

```
kill-ledger/
  HANDOFF.md            this document
  build.py              concatenates src/ into dist/kill-ledger.html
  src/
    template.html       HTML shell + all CSS; placeholders /*DATA*/ /*ENGINE*/ /*APP*/
    data.js             rules library, hand-built list, benchmark targets, defaults
    extra_lists.js      generated JSON for the two imported built-in lists
    engine.js           damage maths (pure functions; also runs in Node)
    importer.js         roster + text-export parser (browser: needs DOMParser)
    app.js              state, persistence, routing, rendering, events
  tests/
    calibration.test.js engine vs Cogitator rows (Node)
    import.test.py      importer vs built-in lists, every cell (Playwright/Chromium)
  fixtures/
    burning-v2.ros, burning-v2.txt   current Aeldari list
    burning-v1.txt                   original Aeldari text export (its .ros was overwritten)
    cophasta.ros, cophasta.txt       White Scars list
  dist/kill-ledger.html  build output (what gets published)
```

- Every source file ends with `if (typeof module !== 'undefined') module.exports = …`; `build.py` strips that tail.
- Globals are shared across files in one `<script>`. **Load order matters:** data → extra_lists → engine → importer → app.
- `extra_lists.js` is generated by parsing a fixture in the browser (see "Regenerating a built-in list" in section 10) and dumping `{id, meta, groups, armyRules, rules, units}`.

### Publishing (claude.ai artifact)

- Publish `dist/kill-ledger.html` with the Artifact tool, `url` = the live link above, favicon ⚔️, so the existing artifact updates instead of a new one.
- **Content-security policy:** scripts only from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net/npm`, `cdn.tailwindcss.com`, `code.jquery.com`; styles/fonts only from Google Fonts. **No network requests to other sites** (the page cannot fetch Wahapedia). JSZip 3.10.1 is loaded from cdnjs for `.rosz`.
- `localStorage` works but is per device and per browser.
- **Runtime capabilities available to this user** (checked 2 Oct 2026, contract 0.2.66): `artifact`, `assets`, `comments`, `db`, `downloads`, `files`, `mcp`, `permissions`, `room`, `sample`, `user`. Declared at publish via `capabilities: {...}`; reached with `await claude.use("db")` etc. (resolves `null` when unavailable; always design for absence). Relevant ones:
  - **`db`**: persistent shared/per-person documents. Declare `{db:{}, user:{}}`. `data/users/<id>/…` is private to that person. Claude can read/write it from chat with the Artifact tool's `read_db`/`write_db`. Never hardcode seed data in the page; seed with `write_db` after publishing; handle an empty db.
  - **`sample`**: ask Claude from the page. `const sample = await claude.use("sample")`; `await sample.json(input, opts)` returns parsed JSON. First call asks for consent; the viewer pays; call on a click, never in a loop; hide the feature if `null` or `not_granted`.
  - **`assets`**: upload files up to 20 MiB to the artifact (writer-only), referenced by id. Candidate home for large data snapshots.
  - **`downloads`**: offer a generated file (e.g. a JSON backup of lists) with viewer confirmation.
  - Before writing capability code, call the Artifact tool's `capabilities` action again; the contract version may have moved.

### Design language (keep it)

- Aeldari palette: void indigo, spirit-stone jade, wraithbone; gold for 100%+. Tokens on `:root`, redefined for dark mode both under `prefers-color-scheme` (guarded `:root:not([data-theme="light"])`) and `:root[data-theme="dark"]`.
- Type: Cormorant Garamond (display, unit names, the Σ numbers), IBM Plex Sans Condensed (UI, tabular numerals), with fallbacks.
- Sentence case everywhere; no all-caps eyebrow labels; no middle-dot metadata strings; chips for rules (✓ counted, ○ idle, struck-through off, ◆ mark, grey noted, red-dashed "!" not modelled).
- Safe-area insets on `:root`, `viewport-fit=cover`. Wide tables scroll inside their own container; the page never scrolls sideways.

---

## 4. Data model

### Unit (attacker)

```js
{
  id: 'voidscarred',            // unique within the list; slug of the name for imports
  nm: 'Corsair Voidscarred',
  sub: 'with Kharseth',         // optional disambiguator (hand-built list only)
  pts: 155,                     // INCLUDES enhancement points
  enh: {id:'voidstone', nm:'Voidstone', pts:15},   // optional; id points into RULES
  grp: 'D', role: 'Leader'|'Support'|'Bodyguard'|null,
  cat: 'Characters'|'Battleline'|'Dedicated transport'|'Infantry'|'Mounted'|'Beasts and swarms'|'Vehicles and monsters'|'Other',
  models: 10,
  kw: ['ANHRATHE','PSYKER', …],  // uppercase keywords (imports)
  rules: ['raiders','faolchu', …],// rule ids (RULES keys), incl. the enhancement id
  w: [Weapon, …],
  stats: {T, Sv, W, M, Ld, OC, inv, invRangedOnly},   // imports only; not yet used
  warlord: true                  // imports only, from "- Warlord" in the text export
}
```

### Weapon (one row = all copies of the same profile on one group of models)

```js
{
  nm: 'Blaster', t: 'r'|'m', n: 2,          // n = number of copies (models carrying it)
  A: 1 | 'D6+3', sk: 3 /* 0 = N/A (torrent) */, S: 8, AP: 4 /* positive */, D: 'D6+1' | 2,
  kw: { … },                                 // see table
  alt: 'p0:searsong' | 'm3:melee',           // pick-one group; engine keeps the best per target
  off: 'Fires its other guns instead (pistol rule)',   // carried but not used
  _owner: 'yriel'                            // set only inside combined units
}
```

| `kw` key | Meaning | Engine effect |
|---|---|---|
| `torrent` | Torrent | auto-hit, no crits |
| `lethal` | Lethal Hits | crit hits auto-wound (always taken) |
| `sus: n` | Sustained Hits n | each crit hit adds n hits |
| `tl` | Twin-linked | re-roll failed wounds |
| `dev` | Devastating Wounds | crit wounds become mortal (no save) |
| `lance` | Lance | +1 to wound in melee when "Charged" is on |
| `blast: n` | Blast X | +X attacks per 5 models in target |
| `cleave: n` | Cleave X (melee) | +X attacks per 5 models in target |
| `melta: n` | Melta X | +X damage when Half range is on |
| `heavy` | Heavy | +1 to hit when Stationary is on |
| `rf: n` | Rapid Fire X | +X attacks when Half range is on |
| `anti: ['INFANTRY', 2]` | Anti-X N+ | crit wounds on N+ vs that keyword; `'MONSTER/VEHICLE'` means either |
| `pistol` | Pistol / Close-Quarters | importer turns it `off` if the model has other ranged weapons (not for Vehicles/Monsters) |
| `ic` | Ignores Cover | cover penalty skipped |
| `precision`, `psychic`, `hazardous`, `indirect`, `extra`, `oneshot` | display / bookkeeping | `extra` exempts a melee weapon from the one-weapon rule |
| `when: {sus:{not:['MONSTER','VEHICLE']}}` | conditional keyword | that key is removed when the target doesn't match |
| `other: [...]` | unknown keyword text | shown, ignored |

### Rule (library entry, `RULES[id]`)

```js
'full-throttle': {
  nm: 'Full-throttle Assault',
  src: 'Army rule'|'Detachment'|'Corsair Coterie'|…|'Enhancement'|'Leader'|'Datasheet'|'Wargear'|'Core'|'Received',
  dmg: true,                 // changes damage → modelled; false → shown as Noted
  def: true,                 // on by default
  scope: 'unit'|'self',      // 'unit' = shared across the attached unit (both directions)
  cond: 'charged', condNm: 'Charged this turn',   // shown as Idle while opts[cond] is false
  mark: 'riven',             // a target mark; its switch is opts[mark]
  global: true,              // a mark whose fx applies to every attacker in the list
  grants: {kw:'WRAITH CONSTRUCT', rule:'spirit-marked'},   // importer adds rule to matching units
  todo: true,                // imported rule whose text looks like it changes damage
  imported: true,
  txt: 'Paraphrase shown on the rule card',
  fx: Effect | [Effect, …]
}
```

**Effect (`fx`) vocabulary** (generic interpreter in `attackWeapon`):

| Field | Meaning |
|---|---|
| `phase: 'melee'|'ranged'` | only those attacks |
| `when: 'charged'` / `whenNot: 'charged'` | only when `opts[x]` is true / false (`charged`, `char`, `objective`, `selfObj`, `stationary`, …) |
| `vs: {only:[KW]} / {not:[KW]}` | target keyword filter |
| `weapon: 'thunder hammer'` / `weaponNot: …` | substring of the weapon name (member prefix stripped) |
| `hit`, `wound` | roll modifiers (summed with everything else, then capped ±1) |
| `s`, `ap`, `a`, `d` | characteristic changes: +S, +AP, +A per model, +D (before the W cap) |
| `rrHit`, `rrWound` | `'ones'` or `'all'` (strongest wins) |
| `grant: {sus:1, lethal:1, lance:1, ic:1, dev:1, cleave:1, tl:1}` | add weapon abilities (numbers take the max) |

Example (Full-throttle Assault):

```js
fx: [{phase:'melee', when:'charged', weapon:'thunder hammer', hit:1, grant:{sus:1}},
     {phase:'melee', when:'charged', weaponNot:'thunder hammer', d:1, grant:{sus:1}}]
```

**Legacy rules** handled by id in code, not by `fx` (listed in `LEGACY_FX`): `piratical-hero`, `psyguide`, `raiders`, `spirit-marked`, `reavers`, `assured`, `faolchu`, `assassins-eye`. Also hardcoded marks: `riven` (+1 S), `web` (crit hits on 5+), `guide` (+1 to hit). These are calibrated; migrate them to `fx` only with the tests passing before and after.

### Target (benchmark defender)

`{id, nm, pts, T, Sv, inv /*0 = none*/, W /*per model*/, N /*models*/, fnp /*0 = none*/, dr /*damage reduction*/, kw /*space-separated*/, cls:'inf'|'veh'}`. Single profile per unit (see Known issues).

### Options (`S.opts`)

```js
{ phase:'all', combine:true, enh:true, cap:false,
  charged:true, stationary:false, objective:false, char:false, selfObj:false,
  riven:false, web:false, guide:false, quarry:false, spiritmark:false, shattered:false, hailstrike:false,
  off: {'yriel:piratical-hero': true},      // per-owner rule switches
  mods: { all:{…}, 'grp-D':{…}, 'yriel':{…} } }   // modifier bar, per scope
```

Modifier scope object (`MOD0`): `{apply:'both', hit:0, wound:0, ap:0, sus:false, lethal:false, rrHit:'off', rrWound:'off', cover:false, half:false, rf:0}`. Scopes that apply to a weapon: `all`, the attacker's own id, `grp-<X>` for split members, the member id for weapons inside a combined unit. `cover` and `half` ignore "Applies to".

### List and storage

- List: `{id, builtin, meta:{name, faction, detachments, mission, sub}, groups:{A:{nm, short}}, armyRules:[ids], rules:{imported rules}, base:[units], units:[units]}`.
- `localStorage['kill-ledger:v3'] = {lists, listId, targets, opts}`; built-in lists persist only their `units` (edits). Older key `kill-ledger:burning-one:v2` is migrated. Theme is `kill-ledger:theme`.
- `applyList(id)` swaps the globals `LIST_META`, `GROUPS`, `ARMY_RULES`, and rebuilds `RULES = BASE_RULES + list.rules`.

---

## 5. Engine specification

`attackUnit(unit, target, opts, allUnits)` returns `{rows, total, pts, ppw, roi, pool, capped, rules}`. Each row comes from `attackWeapon(w, tgt, opts, has, mods, ruleList)`.

### Rule application
1. `effectiveRules(unit, allUnits)`: split unit → its own rules + other group members' rules with `scope:'unit'`. Combined unit → every member's rules, but each weapon only gets a rule if `scope==='unit'` or the weapon's `_owner` is the rule's owner.
2. `ruleActive`: mark rules follow `opts[mark]`; others are on unless `opts.off['owner:id']`.
3. Global marks with `fx` (`shattered`, `hailstrike`) apply to every attacker when on.
4. The app only passes marks that some unit in the current list can set (`effOpts` → `availableMarks`).
5. "Target is a Character unit" appends `CHARACTER` to the target's keywords for keyword checks.

### Per weapon, in order
1. **Conditional keywords:** drop any `kw[k]` whose `kw.when[k]` the target fails.
2. **Effects:** sum `fx` from applicable rules (skip `LEGACY_FX`), applying grants to `kw`.
3. **Attacks per model** = avg(A) + fx.a + Blast (floor(N/5)·X) + Cleave (melee, same) + Rapid Fire X (if Half range; X = max(weapon, modifier)). Total = per model × `n`. Average dice: `kD f + c` → k(f+1)/2 + c.
4. **Hit modifier** = modifier bar + fx + Piratical Hero + Psychic Guidance + Guide + Heavy(stationary), **clamped to ±1**.
5. **Cover** (11th: worsens BS by 1, a characteristic change, not a modifier) for ranged attacks unless Ignores Cover; torrent unaffected.
6. **Hit roll:** `need = clamp(BS − hitMod, 2, 6)`; crit on 6 (5 with Whispering Web). P(success) = (7 − min(need, crit))/6; P(crit) = (7 − crit)/6.
   - Re-roll 1s: p' = p + p/6, c' = c + c/6. Full re-roll (failures only): p' = p + (1−p)p, c' = c + (1−p)c.
   - Torrent: p = 1, c = 0.
7. **Hits:** normal = p − c. Hits to roll for wounds = normal + c·sus + (lethal ? 0 : c). Auto-wounds = lethal ? c : 0. Displayed "Hit" is the chance to hit; the Sustained bonus is shown separately (`susExtra = c·sus`).
8. **Wound:** S (+ fx.s + Riven) vs T table (2+ if S ≥ 2T, 3+ if S > T, 4+ if equal, 6+ if 2S ≤ T, else 5+). Wound modifier = bar + fx + Lance(melee, charged), **clamped ±1**; need clamped 2..6. Anti-X sets the crit-wound threshold N. Re-rolls (twin-linked, Assured Destruction, fx, bar) use the same formulas as hits.
9. **Devastating:** crit wounds become mortal wounds, skip saves, use damage without damage reduction.
10. **Save:** `sv = Sv + max(0, AP + apBonus)`; `need = min(sv, inv)`; fail = (need − 1)/6, or 1 if need ≥ 7.
11. **Damage:** exact distribution of D (+ melta at half range + fx.d), damage reduction (min 1) for normal wounds, **capped at target W per model** (no spill-over). Damage re-roll (Assured Destruction) uses the optimal single re-roll: E₂ = Σ p·max(x, E₁).
12. **Feel No Pain:** multiply by (fnp − 1)/6.
13. `dealt = attacks × (normalW·failSave·E[dmg] + mortalW·E[dmgMortal]) × fnp`.

### Per unit
- **Pick-one groups (`alt`):** keep the row with the highest `dealt` for this target; others shown as "not used". `p…` = weapon profiles (Searsong beam/lance, plasma standard/supercharge); `m…` = melee choices for a model group.
- `total` = Σ dealt (optionally capped at `pool = W×N`).
- `pts` = unit points, minus enhancement points if "Count enhancement points" is off.
- `roi = total / pts × (target.pts / pool) × 100`.

---

## 6. 11th-edition rules decisions

Confidence: **H** = confirmed from a rules source in this project; **M** = inferred from data or a secondary source; **L** = an assumption to confirm.

| Topic | What the app does | Conf. |
|---|---|---|
| Hit and wound roll modifiers | Net change capped at ±1 | H |
| AP and Strength changes | Characteristic changes, uncapped, stack | H |
| Cover | Ranged attacks worsen BS by 1 unless Ignores Cover or torrent | M |
| Conditional weapon abilities | `ABILITY: KEYWORD` applies only vs that keyword; `non-` inverts | H |
| Duplicate abilities | Not cumulative; numbers take the max | H |
| Blast X / Cleave X | +X attacks per full 5 models in the target | H (from rule examples) |
| Lethal Hits | Always takes the auto-wound (11th makes it optional; matters only with Devastating Wounds) | M |
| Close-Quarters (old Pistol) | A model fires either its close-quarters weapons or its other ranged weapons, not both; Vehicles/Monsters exempt | L |
| "This unit…" abilities on leaders, supports and bodyguards | Apply to the whole attached unit | L |
| Support characters | Attach alongside a leader ("Supported by" / "Support") | H (from roster data) |
| One Shot weapons | Counted (one activation) | design choice |
| Damaged X | Ignored (assume healthy); use −1 Hit in the modifier bar | design choice |
| Choice abilities (Bladeguard, Catechism of Fire) | Assume the offensive option / the target being shot | design choice |
| Assured Destruction | Shooting phase, ranged attacks vs Monster/Vehicle; re-roll hit, wound **and damage**; not melee | H |
| Combat Doctrines (Space Marines 11th) | Movement only; no damage | M |
| Spearpoint Task Force / Wrath of the First Khan / Assault Brethren | Library text written mid-project; treat as unverified until checked against the data export | L |
| Stratagems | Excluded on purpose | user decision |

---

## 7. Benchmark targets and calibration

The 19 targets mirror the Culling Cogitator's set. Their profiles were **back-solved** so that, with bare datasheets, the Yriel, Fuegan, Kharseth and Shroud Runners rows reproduce the Cogitator's published numbers for all 19 targets (rounded). Toughness assignments also match the Cogitator's toughness-filter counts (T3×2, T4×1, T5×3, T6×3, T7×1, T9×3, T10×2, T11×3, T12×1).

| Target | Pts | T | Sv | Inv | W | Models | FNP | DR | Keywords |
|---|---|---|---|---|---|---|---|---|---|
| Cadian Shock Troops | 70 | 3 | 5+ | – | 1 | 10 | – | – | INFANTRY |
| Warp Spiders | 105 | 3 | 3+ | 5+ | 1 | 5 | – | – | INFANTRY |
| Genestealers | 75 | 4 | 5+ | 5+ | 2 | 5 | – | – | INFANTRY |
| Boyz | 85 | 5 | 5+ | – | 1 | 10 | – | – | INFANTRY |
| Intercessor Squad | 95 | 5 | 3+ | – | 2 | 5 | – | – | INFANTRY |
| Strike Squad | 125 | 5 | 2+ | – | 2 | 5 | – | – | INFANTRY |
| Wraithblades | 140 | 6 | 2+ | – | 3 | 5 | – | – | INFANTRY |
| Terminator Squad | 195 | 6 | 2+ | 4+ | 3 | 5 | – | – | INFANTRY |
| Canoptek Wraiths | 95 | 6 | 3+ | 4+ | 4 | 3 | – | – | BEASTS |
| Scout Sentinels | 55 | 7 | 3+ | – | 7 | 1 | – | – | VEHICLE |
| Rhino | 70 | 9 | 3+ | – | 10 | 1 | – | – | VEHICLE |
| Doomsday Ark | 200 | 9 | 3+ | 4+ | 14 | 1 | – | – | VEHICLE FLY |
| Nemesis Dreadknight | 205 | 9 | 2+ | 4+ | 13 | 1 | – | – | VEHICLE |
| Predator Annihilator | 135 | 10 | 3+ | – | 11 | 1 | – | – | VEHICLE |
| Mutalith Vortex Beast | 170 | 10 | 4+ | 5+ | 13 | 1 | 5+ | – | MONSTER |
| Vindicator | 185 | 11 | 2+ | – | 11 | 1 | – | – | VEHICLE |
| Defiler | 300 | 11 | 3+ | 5+ | 18 | 1 | 6+ | – | VEHICLE |
| Transcendent C'tan | 340 | 11 | 3+ | 4+ | 16 | 1 | 5+ | −1 | MONSTER |
| Land Raider | 245 | 12 | 2+ | – | 16 | 1 | – | – | VEHICLE |

Simplifications the Cogitator also makes: Warp Spiders scored as 5 × W1 (the real Exarch has W2).

### Where we deliberately differ from the Cogitator

Verified line by line on Fuegan + Fire Dragons into Scout Sentinels (Cogitator 97.6%, ours 92.4%):

| Weapon | Cogitator | Ours | Reason |
|---|---|---|---|
| Fusion guns ×5 | 13.83 | 16.79 | They skip the damage re-roll from Assured Destruction |
| Searsong (beam) | 5.80 | 6.05 | A 6 on a re-rolled hit is still a crit for Sustained Hits |
| Fire Axe | 9.72 | 5.00 | They apply Assured Destruction to melee; the rule is ranged/shooting only |
| Close combat weapons | 0.45 | 0.37 | They use A1 and re-roll; datasheet is A2, no melee re-rolls |

The Cogitator also never applies leader propagation (e.g. Assured Destruction to Fuegan) or Piratical Hero/Reavers re-rolls; that's what the "Bare datasheets" preset reproduces.

---

## 8. Importer specification

Entry points: `IMP.parse(xmlText, exportText)` and `IMP.readFile(file)` (unzips `.rosz` via JSZip). Returns `{meta, units, groups, armyRules, rules, warnings, stats, gameSystem}`.

### What 40k.app `.ros` files contain (and don't)

- BattleScribe roster schema (`xmlns="http://www.battlescribe.net/schema/rosterSchema"`), `id="40kapp-export"`. **The header says "Warhammer 40,000 10th Edition" even though the data is 11th edition.** Trust the data, not the label.
- Top-level `<selection type="unit|model">`; models nested as `type="model"` with `number`; weapons as `type="upgrade"` children whose `number` is the **total** across that model group (e.g. `Blaster x2` under `w/ Blaster x2`).
- Profiles: `Unit` (M, T, SV, W, LD, OC), `Ranged Weapons` (Range, A, BS, S, AP, D, Keywords), `Melee Weapons` (WS instead of BS), `Abilities` (Description).
- Leader links as abilities: **`Attached to: <unit>`**, **`Led by: <leader>`**, **`Supported by: <support>`**; structural abilities `Leader`, `Support`, `Invulnerable Save` (text like `4+` or `5+ - *Against ranged attacks only*`). Enhancements as abilities named `Enhancement: <name>`.
- Categories = keywords (`Faction: …` ones dropped).
- **Missing:** points (no `<cost>`), detachment, wargear with no weapon profile (Faolchú, Mistshield, Channeller Stones, Forceshield, Aspect Shrine Token), army-rule text (`Battle Focus` = "-", `Combat Doctrines` = "-").
- **Special-weapon models keep their default melee weapons** (Voidscarred, Voidreavers and Skyreavers with blasters/fusion keep power swords/Corsair blades). The text export reads otherwise; trust the roster.
- Keywords may be uppercase and may be `-` placeholders.

### Parse steps

1. **Weapons per model group.** Collect upgrades under each model (and loose unit-level upgrades). Parse keywords (section 4 table), skill `N/A` → torrent.
2. **Pick-one profiles:** one upgrade with several weapon profiles, or sibling names sharing a `Base - profile` prefix → `alt = p<group>:<base>`.
3. **Pistol rule:** if the model group has any non-pistol ranged weapon (and the unit isn't a Vehicle/Monster), pistols get `off`.
4. **Melee:** drop weapons strictly dominated by another option (≥ in A, skill, S, AP, D and keyword superset); if more than one remains → `alt = m<group>:melee`. `Extra Attacks` weapons are exempt.
5. **Merge** identical model groups (Fire Dragon ×3 + ×1 → ×4) and identical non-alt rows with the same `off` state.
6. **Rules:** match each ability to the library by normalised name, then name minus a trailing number (`Damaged 4` → `Damaged`). Library army rules (`src:'Army rule'`) go to the list's army rules, not the unit. Unknown abilities become imported rules: `Core` (Scouts, Stealth, Deep Strike, Deadly Demise, …), `Leader` (text starts "While this model is leading a unit"), else `Datasheet`; `scope:'unit'` if the text mentions the unit; `todo:true` if it *looks offensive* (mentions hit/wound/S/AP/D/re-roll/abilities **and** "makes an attack"/"weapons equipped by", **and not** "an attack targets this unit").
7. **Text export** (optional): sections are unindented lines `NAME [N pts]`; units are indented `Name [N pts] (M models)` with an optional trailing `- Warlord`; deeper lines are `Enhancement: X (+N pts)` or loadout text. Header line 2 is `Faction · Detachment · Detachment`; `Mission: X`.
8. **Matching roster units to text entries:** unique exact name → attached-unit section via the unit's leader/bodyguard partner (needed because 40k.app writes three "Outrider Squad" entries) → name without trailing letter (+ model count), flagged as a warning.
9. **Points** from the matched entry (includes enhancement); enhancement cost from `(+N pts)`; wargear rules found by name in the loadout text (accent-insensitive, so Faolchú matches).
10. **Grants:** `spirit-mark` adds `spirit-marked` to `WRAITH CONSTRUCT` units; `DETACHMENT_UNIT_GRANTS` adds detachment-specific unit rules.
11. **Groups:** each bodyguard plus its leaders/supports, lettered in text-export order; `short` = names joined with ` + `.
12. **Army rules:** `FACTION_ARMY_RULES[faction]` + library army rules found on units + `DETACHMENT_RULES[detachment]`; unknown detachments produce a warning.
13. **Sorting and sections:** grouped units first (leader, support, bodyguard), then by category, then text-export order. All-caps list names are title-cased.

### Known importer edge cases
- Different names between sources (`Corsair Voidreavers` in text vs `Corsair Voidreavers B` in roster) are handled by section matching.
- Wargear names inside text-export loadouts are the only source for profile-less wargear today.
- `.rosz` relies on JSZip from cdnjs; plain `.ros` always works.

---

## 9. Lists the user has

| List | Faction | Notes |
|---|---|---|
| The Burning One and the Exile (v1, hand-built) | Aeldari: Corsair Coterie + Path of the Outcast, Priority Assets | Calibration reference. Its original `.ros` was overwritten by v2; only the text export survives (`fixtures/burning-v1.txt`) |
| The Burning One and the Exile v2 | same | Rangers B down to 5, no Ranger enhancements, + Corsair Skyreavers C (5). 2,000 pts. Yriel is Warlord |
| Strike Force Cophasta | White Scars: Spearpoint Task Force + Assault Brethren, Reconnaissance | 1,990 pts; Suboden is Warlord |

Earlier list (not built in): *The First Hand and the Last Prince* (Asurmen + Dire Avengers instead of Fuegan + Fire Dragons; Yriel with Archraider). Dire Avengers' abilities were never researched.

Headline findings already given to the user (useful for sanity checks):
- v2: 1,085 of 2,000 pts in units averaging 50%+; points-weighted average return 49.4% (v1: 1,010 and 47.8%).
- Yriel + Voidscarred is the best answer to almost every elite target (Terminators 107%, Intercessors 104%, Canoptek Wraiths 64%, C'tan 55%). Canoptek Wraiths, Mutalith and C'tan have no answer at 65%.
- Guide (+1 to hit) does nothing for Yriel + Voidscarred (Piratical Hero already +1) or Wraithblades (Psychic Guidance); it lifts each Skyreavers squad ~15 points of average return.
- Cophasta depends on charging: Chaplain + Outriders A 88% → 47% average without "Charged"; Hellblasters unaffected (62%); the Brutalis is the anti-tank (135% into a Vindicator, almost all melee).

---

## 10. Testing

| Test | What it checks | Expected |
|---|---|---|
| `node tests/calibration.test.js` | Bare-datasheet rows for Yriel (scored at 95 pts), Fuegan, Kharseth, Shroud Runners vs the Cogitator; Yriel into Warp Spiders | 4 × ok; Σ 3.98 → 88.0% |
| `python3 tests/import.test.py` | Parses each fixture roster + text export in Chromium and compares every matrix cell (split and combined) with the built-in lists | v2: 684 cells, Cophasta: 532 cells, v2 vs hand-built v1 (shared units): 570 cells; 0 differences |

Run both after any change to `engine.js`, `importer.js` or `data.js`. Playwright setup: `pip install playwright && playwright install chromium`.

Other manual checks used during development: no JS errors; `document.documentElement.scrollWidth === 390` at a 390px viewport on every view; screenshots of matrix, dossier, rules matrix in light and dark.

**Regenerating a built-in list** (pattern): load `dist/kill-ledger.html` in Playwright, run `IMP.parse(xml, txt)`, keep `{id, meta, groups, armyRules, rules, units}`, override `meta.name`/`meta.sub`, and write `src/extra_lists.js` as `const EXTRA_BUILTIN_LISTS = [ … ];`. Then rebuild and rerun tests.

---

## 11. Known issues and technical debt

1. **Rules live in code.** `BASE_RULES` in `data.js` plus `LEGACY_FX` branches in `engine.js`. Adding a faction means a code change and a republish. (Roadmap fixes this.)
2. **Lists live in `localStorage`.** They don't sync between devices; built-ins do because they're in code.
3. **Targets are single-profile.** No mixed toughness/wounds, no attached-leader targets, no Character targets in the benchmark set (so Assassins' Eye and Trophy Taker only show with the "Target is a Character" switch, which treats every target as containing one).
4. **No variance.** Expected values only; no kill probabilities.
5. **Hand-written rule text.** Every `txt` is a paraphrase written during the project; Spearpoint Task Force, Wrath of the First Khan and Assault Brethren especially need checking.
6. **Unverified 11th assumptions:** Close-Quarters handling, "This unit" scope, Lethal Hits always taken (section 6).
7. **Hardcoded marks** (`riven`, `web`, `guide`) and the `MARKS` list in `app.js` reference Aeldari unit ids for labels; the mark gating hides them for other factions.
8. **Combined units** don't have `members`' stats; defensive use of imported units isn't implemented (stats are parsed and stored, unused).
9. **The modifier bar's per-unit scopes** are keyed by unit id, so they're per list in practice but stored globally in `opts.mods`.
10. **Findings** use fixed heuristics (65% line, biggest enhancement cost) and English templates in code.

---

## 12. Roadmap: the trusted rules database

The user's decision: **don't trust user-supplied datasheets**. Build a versioned database of datasheets and rules from an authoritative feed, refreshed a few times a year (dataslates, errata), and make importing a matter of mapping a list onto it.

### Source: Wahapedia data export (not scraping)

- Wahapedia publishes an official **11th edition data export**: a set of CSV files linked by IDs covering datasheets, abilities and stratagems, with a specification spreadsheet describing every file. The author updates the files whenever the site changes.
- Page: https://wahapedia.ru/wh40k11ed/the-rules/data-export (the spec is the "here" link under **WHERE?**; it was `Export Data Specs.xlsx?v=20260817b` on 2 Oct 2026).
- Older editions' exports used `|`-delimited CSVs named like `Factions.csv`, `Datasheets.csv`, `Datasheets_abilities.csv`, `Datasheets_wargear.csv`, `Datasheets_models.csv`, `Datasheets_keywords.csv`, `Datasheets_options.csv`, `Datasheets_leader.csv`, `Datasheets_models_cost.csv`, `Detachment_abilities.csv`, `Enhancements.csv`, `Stratagems.csv`, `Abilities.csv`, `Source.csv`, `Last_update.csv`. **Confirm the 11th edition names and columns from the spec before writing the loader.**
- **Credit:** the author asks for "powered by Wahapedia" on tools that use the export. Add it to the footer with a link to the support page. Rebus Stats is an existing damage tool built on the same export (useful prior art).
- **Who downloads:** the user, a few times a year, on a computer (the sandbox has no internet, and the page can't fetch other sites). Agreed workflow: download all CSVs + the spec spreadsheet, zip, drop into the app.
- **IP note:** rules text is Games Workshop's. Fine for personal use. If the app is ever shared, keep verbatim text private to the user's copy (`data/users/<id>/…`) and share only stats, points and our translations.

### Target architecture

```
Wahapedia CSV zip ──▶ Snapshot loader (in browser) ──▶ DB: snapshot vN (factions, datasheets,
                                                         models, weapons, abilities, detachments,
                                                         enhancements, points, keywords)
                                                     └▶ Change report vs vN-1
Roster (.ros) / text export ──▶ Mapper ──▶ list = choices only (datasheet ids, model counts,
                                           chosen weapons, enhancements, detachment)
                                           + mismatch warnings (roster says X, DB says Y)
Translations DB (keyed by ability id + text hash) ──▶ engine fx
   ▲ drafted by: Claude in chat (read_db/write_db) | "Draft with Claude" (sample) | rule editor UI
```

### Phases

**Phase 1: snapshot loader.**
- UI: "Update database" on the import page; accepts a zip of CSVs (JSZip) or multiple files.
- Parse with the spec's column definitions; strip HTML from text fields; normalise names (diacritics, quotes, `➤` profile markers).
- Store per snapshot (with Wahapedia's `Last_update` value and a load date). Storage choice: `db` documents per datasheet (256 kB limit per document), or one JSON asset per faction via `assets` (20 MiB), with an index document in `db`. Prefer per-faction assets + `db` index; measure sizes first.
- Change report: per faction, added/removed datasheets; changed points; changed weapon profiles; changed ability text (by id + hash). Keep at least the previous snapshot.

**Phase 2: mapping importer.**
- Roster → for each top-level selection: find the datasheet by faction + normalised name (aliases table for known mismatches); model groups → model profiles; weapon names → datasheet wargear (profile variants by `➤`/`-`); enhancements and leaders by name.
- Use the roster only for **choices**; all stats, keywords, abilities and points come from the DB. Show a mismatch list (unknown units, weapons not on the datasheet, different stats).
- Detachments: dropdown populated from the DB when the roster/text doesn't name them (40k.app rosters never do).
- Points: from the DB if the export includes them; otherwise keep the text export.
- Keep the current `.ros`-only importer as a fallback.

**Phase 3: translations database.**
- Move `BASE_RULES` into `db`: `rules/<abilityId>` = `{name, faction, textHash, fx, status:'draft'|'verified'|'note'|'todo', notes, updatedBy, updatedAt}`.
- On each new snapshot, any ability whose text hash changed drops back to `draft` and appears in a review queue.
- Seed from today's `BASE_RULES` by matching names to ability ids (write with `write_db` after publishing).
- Convert `LEGACY_FX` rules to `fx` once the vocabulary covers them (needs: re-roll ones/all upgrade on condition, crit threshold, conditional lethal by mark).
- Rule editor UI: the modifier bar's controls + conditions + phase + keyword filter → saves an `fx` entry. "Draft with Claude" fills the form.

**Phase 4: Draft with Claude (`sample`).**
- Button on any untranslated/changed rule. Send: the rule text, the datasheet's weapon names, the `fx` schema, 3–5 worked examples from the library, and the instruction to return **only** JSON matching the schema (or `{"dmg": false, "reason": "…"}`).
- Validate the JSON against the schema in the page before showing it; never auto-verify. The user approves → `status:'verified'`.
- Prompt skeleton:

  ```
  You translate Warhammer 40,000 (11th edition) rules into a damage-engine effect.
  Return JSON only: {"dmg": boolean, "scope": "unit"|"self", "cond": string|null, "mark": string|null,
                     "fx": [Effect...], "summary": "one sentence"}.
  Effect fields: phase, when, whenNot, vs {only|not}, weapon, weaponNot, hit, wound, s, ap, a, d,
                 rrHit, rrWound, grant {sus, lethal, lance, ic, dev, cleave, tl}.
  Hit/wound modifiers are capped at ±1 by the engine; AP/S/A/D are characteristic changes.
  If the rule only moves models, scores points, or protects the unit, return dmg:false.
  Rule: <name>: <text>. Unit weapons: <list>.
  Examples: <3–5 library entries with their text and fx>.
  ```

**Phase 5: everything else the user has asked about or will want.**
- Lists and modifiers in `db` so they sync across devices; JSON backup via `downloads`.
- Opponent roster as targets (matchup matrix): requires multi-profile targets (per-model W/T/Sv, attached leaders, invulns that only apply to ranged attacks) and defensive rules.
- Character targets in the benchmark set.
- List comparison view (v1 vs v2 side by side, deltas per unit and per target).
- Points-weighted army summaries and "points in units averaging 50%+" in the UI (computed in chat so far).
- Optional: variance / kill-probability per matchup.

---

## 13. Open questions for the user

1. Does the 11th edition Wahapedia export include points? (Decides whether the text export stays.)
2. Should the database and translations be shareable with friends, or private only?
3. Confirm the three L-confidence rules: Close-Quarters vs other guns; "This unit" abilities spreading across attached units; Lethal Hits as optional when it carries Devastating Wounds.
4. Should "Charged this turn" stay on by default? It inflates melee lists' averages (Cophasta's Chaplain unit: 88% charged, 47% not).
5. Benchmark set: keep the Cogitator's 19 for comparability, or add 11th-edition staples and Character targets?

---

## 14. Glossary

- **Return / ROI:** enemy points removed per point spent, as a percentage.
- **65% line:** threshold for "efficient"; coverage counts units at or above it.
- **Attached unit:** a bodyguard plus its leader and/or support character. "As one unit" scores them together; "Split" scores each datasheet with shared rules still applied.
- **Mark:** an effect one of your units puts on an enemy unit (Riven, Guided, …) that other units then benefit from; a switch in the Situation panel.
- **Idle rule:** modelled, but its condition is off (e.g. Trophy Taker without "Target is a Character").
- **Not modelled:** an imported rule that reads like it changes damage but has no translation yet.
- **Bare datasheets:** preset that removes leader buffs and re-rolls to compare with the Cogitator.

## 15. References

- Live app: https://claude.ai/artifact/M2DPgK9DxnmjcPaf9rUrrK
- Wahapedia 11th edition data export: https://wahapedia.ru/wh40k11ed/the-rules/data-export
- 40k.app lists: Burning One https://www.40k.app/lists/T9Eje1fMXP, Cophasta https://www.40k.app/lists/clSMsdr28T
- 11th edition core abilities (Blast/Cleave examples, conditional abilities): https://www.40k.app/rules/24-core-abilities
