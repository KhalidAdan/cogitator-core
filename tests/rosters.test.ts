/**
 * Real rosters, as 40k.app exported them (tests/fixtures/rosters; see the
 * README there). The importer reads each one, every rule in them that changes
 * damage is translated, and the matrix scores every unit. Against the
 * Wahapedia export, every unit finds its datasheet, and the weapons that
 * don't are named here: a new export, a new codex or a matcher change shows
 * up as a change to these lists.
 */
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { layerAt } from "~/.server/db/Db"
import { parseRosterSync } from "~/.server/importer/roster"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { LIBRARY_RULES } from "~/.server/seed/library"
import { seed, seedData } from "~/.server/seed/Seed"
import { checkList } from "~/.server/wahapedia/check"
import { Snapshots } from "~/.server/wahapedia/Snapshots"
import { attackerList, attackUnit } from "~/domain/engine"
import { defaultOpts } from "~/domain/options"
import type { RuleBook } from "~/domain/schema"

/** The library a fresh database starts with. */
const library: RuleBook = { ...seedData.rules, ...Object.fromEntries(LIBRARY_RULES.map((r) => [r.id, r.rule])) }
const ctx = {
  library,
  factionArmyRules: seedData.factionArmyRules,
  detachmentRules: seedData.detachmentRules,
  detachmentUnitGrants: seedData.detachmentUnitGrants
}
const read = (file: string) => parseRosterSync(readFileSync(join("tests/fixtures/rosters", file), "utf8"), "", ctx)

const ROSTERS = [
  {
    file: "the-citadel-moves.ros",
    name: "The Citadel Moves",
    faction: "Chaos Space Marines",
    units: 14,
    models: 46,
    attached: 4,
    counted: ["architect-of-ruin", "daemonforge", "despoilers", "headlong-destruction", "master-of-mechanisms", "stabilisation-talons"],
    notOnDatasheet: []
  },
  {
    file: "ten-thousand-and-no-more.ros",
    name: "Ten Thousand and No More",
    faction: "Adeptus Custodes",
    units: 13,
    models: 30,
    attached: 4,
    counted: ["captain-general", "purity-of-execution", "stand-vigil"],
    // "Guardian spear - ranged" and "- melee" are the datasheet's one "Guardian spear"
    notOnDatasheet: []
  },
  {
    file: "strike-force-cophasta.ros",
    name: "Strike Force Cophasta",
    faction: "White Scars",
    units: 17,
    models: 46,
    attached: 5,
    counted: [
      "bladeguard",
      "catechism-of-fire",
      "deeds-of-legend",
      "for-the-khan",
      "full-throttle",
      "furious-assault",
      "hailstrike",
      "hunters-eye",
      "litany-of-hate",
      "shattered-defences",
      "spearpoint-paragon",
      "tactical-precision",
      "targeted-intercession",
      "thunderstrike",
      "trophy-taker"
    ],
    // The roster is on the Space Marines codex of 30 September; the export (28 September) predates it:
    // new wargear options, renamed close combat weapons and split bolt rifle profiles.
    notOnDatasheet: [
      "Kor’sarro Khan: Anzuq",
      "Bladeguard Ancient: Relics of Battle",
      "Bladeguard Veteran Squad: Master-crafted Power Sword",
      "Outrider Squad B: Plasma Pistol - Standard",
      "Outrider Squad B: Plasma Pistol - Supercharge",
      "Outrider Squad B: Thunder Hammer",
      "Hellblaster Squad: Ceramite Fists",
      "Outrider Squad A: Plasma Pistol - Standard",
      "Outrider Squad A: Plasma Pistol - Supercharge",
      "Outrider Squad A: Power Weapon",
      "Vanguard Veteran Squad with Jump Packs: Plasma pistol",
      "Vanguard Veteran Squad with Jump Packs: Thunder Hammer",
      "Storm Speeder Thunderstrike: Stormfury Missile Launcher",
      "Storm Speeder Thunderstrike: Thunderstrike Icarus Rocket Pod",
      "Storm Speeder Thunderstrike: Armoured Impact",
      "Storm Speeder Hailstrike: Ironhail Heavy Stubber Array",
      "Storm Speeder Hailstrike: Armoured Impact",
      "Land Speeder: Pyrecannon",
      "Land Speeder: Armoured Impact"
    ]
  },
  {
    file: "the-wall-advances.ros",
    name: "The Wall Advances",
    faction: "Imperial Fists",
    units: 11,
    models: 33,
    attached: 2,
    counted: [],
    notOnDatasheet: [
      "Eradicator Squad with heavy bolters B: Ceramite Fists",
      "Heavy Intercessor Squad: Ceramite Fists",
      "Intercessor Squad: Bolt Rifle - Focused Fire",
      "Intercessor Squad: Bolt Rifle - Saturation",
      "Intercessor Squad: Knives and Fists",
      "Eradicator Squad with heavy bolters A: Ceramite Fists",
      "Ballistus Dreadnought A: Storm Bolters",
      "Ballistus Dreadnought B: Storm Bolters"
    ]
  }
] as const

describe("real rosters", () => {
  it("has a case for every fixture", () => {
    const files = readdirSync("tests/fixtures/rosters").filter((f) => f.endsWith(".ros"))
    expect(files.sort()).toEqual(ROSTERS.map((r) => r.file).sort())
  })

  for (const r of ROSTERS) {
    describe(r.file, () => {
      const got = read(r.file)

      it(`reads ${r.units} units, ${r.models} models and ${r.attached} attached units`, () => {
        expect(got.meta.name).toBe(r.name)
        expect(got.meta.faction).toBe(r.faction)
        expect(got.units).toHaveLength(r.units)
        expect(got.stats.models).toBe(r.models)
        expect(Object.keys(got.groups)).toHaveLength(r.attached)
        // a roster file carries no points; the text export or the Field Manual supplies them
        expect(got.warnings).toEqual(["No text export, so every unit starts at 0 pts. Add points below before saving."])
      })

      it("counts the rules that change damage, and leaves none untranslated", () => {
        const rules = { ...library, ...got.rules }
        const ids = new Set(got.units.flatMap((u) => u.rules))
        expect([...ids].filter((id) => rules[id]?.dmg).sort()).toEqual([...r.counted])
        expect([...ids].filter((id) => rules[id]?.todo && !rules[id]?.dmg).map((id) => rules[id].nm)).toEqual([])
        expect(got.stats.todo).toBe(0)
      })

      it("scores every unit against every target, split and combined", () => {
        const targets = seedData.targets
        const rules = { ...library, ...got.rules }
        for (const combine of [false, true]) {
          const opts = { ...defaultOpts(), combine }
          for (const u of attackerList(got.units, opts)) {
            for (const t of targets) {
              const { total } = attackUnit(u, t, opts, { rules, units: got.units })
              expect(Number.isFinite(total) && total >= 0, `${u.nm} → ${t.nm}: ${total}`).toBe(true)
            }
          }
        }
      })
    })
  }
})

// ---------- against the downloaded Wahapedia export ----------

const ROOT = "data/wahapedia"
const folder = existsSync(ROOT)
  ? readdirSync(ROOT)
      .filter((n) => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(n))
      .sort()
      .at(-1)
  : undefined
const exportDir = folder ? join(ROOT, folder) : null

const Repos = Layer.mergeAll(Lists.layer, Rules.layer, Targets.layer, Settings.layer, Snapshots.layer)
const TestLayer = Layer.effectDiscard(seed).pipe(Layer.provideMerge(Repos), Layer.provideMerge(layerAt(":memory:")))

describe.skipIf(!exportDir)("real rosters against the downloaded export", () => {
  layer(TestLayer, { timeout: "120 seconds" })("snapshot", (it) => {
    it.effect("loads the export", () =>
      Effect.gen(function*() {
        expect((yield* (yield* Snapshots).loadDirectory(exportDir!)).status).toBe("loaded")
      }), 120_000)

    for (const r of ROSTERS) {
      it.effect(`${r.file}: every unit finds its datasheet; ${r.notOnDatasheet.length} weapons aren’t on theirs`, () =>
        Effect.gen(function*() {
          const got = read(r.file)
          const check = yield* checkList({ units: got.units, meta: got.meta, rules: got.rules }, library)
          expect(check.units.filter((u) => !u.datasheet).map((u) => u.unit)).toEqual([])
          const missing = check.units.flatMap((u) => u.weapons.filter((w) => w.status === "missing").map((w) => `${u.unit}: ${w.nm}`))
          expect(missing).toEqual([...r.notOnDatasheet])
        }))
    }
  })
})
