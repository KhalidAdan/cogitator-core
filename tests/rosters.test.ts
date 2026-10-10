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
import { importContext } from "~/.server/importer/context"
import { keepPrices, NO_TEXT_EXPORT, parseRosterSync } from "~/.server/importer/roster"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { LIBRARY_RULES } from "~/.server/seed/library"
import { seed, seedData } from "~/.server/seed/Seed"
import { checkList } from "~/.server/wahapedia/check"
import { Snapshots } from "~/.server/wahapedia/Snapshots"
import { parseSwap, type Swap } from "~/.server/wahapedia/swaps"
import { loadDirectory } from "~/.server/node/directory"
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
    file: "by-writ-of-the-lord-solar.ros",
    name: "By Writ of the Lord Solar!",
    faction: "Astra Militarum",
    units: 18,
    models: 69,
    attached: 3,
    counted: ["daring-recon", "rearm-reload-fire"],
    notOnDatasheet: []
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
  },
  {
    file: "the-fifteenth-grievance.ros",
    name: "The Fifteenth Grievance",
    faction: "Thousand Sons",
    units: 10,
    models: 57,
    attached: 4,
    counted: ["bringers-of-change", "empyric-guidance", "lord-of-the-rubricae", "malefic-maelstrom", "marked-by-fate"],
    notOnDatasheet: []
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
        // on the table, an attached unit is one unit, as it is one row of the matrix
        expect(got.stats.onTable).toBe(attackerList(got.units, { combine: true }).length)
        expect(got.stats.onTable).toBeLessThan(r.units)
        expect(Object.keys(got.groups)).toHaveLength(r.attached)
        // a roster file carries no points or profile-less wargear; the warning says what's missing and why
        expect(got.warnings).toEqual([NO_TEXT_EXPORT])
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

describe("re-reading a roster file", () => {
  it("keeps the prices the list was saved with, since the file has none", () => {
    const first = read("by-writ-of-the-lord-solar.ros")
    // as saved from the import review, priced from the Field Manual
    const saved = first.units.map((u, i) => ({ ...u, pts: 50 + i, ...(u.enh ? { enh: { ...u.enh, pts: 15 } } : {}) }))
    const again = keepPrices(read("by-writ-of-the-lord-solar.ros").units, saved)
    expect(again.map((u) => u.pts)).toEqual(saved.map((u) => u.pts))
    expect(again.filter((u) => u.enh).map((u) => u.enh!.pts)).toEqual(saved.filter((u) => u.enh).map(() => 15))
    // a unit the file prices itself, or one the list didn't have, is left as the file says
    expect(keepPrices([{ ...first.units[0], pts: 70 }], saved)[0].pts).toBe(70)
    expect(keepPrices([{ ...first.units[0], id: "new-unit" }], saved)[0].pts).toBe(0)
  })
})

// ---------- wargear swaps ----------

describe("wargear swaps", () => {
  it("read what an option line replaces, and with what", () => {
    expect(parseSwap("1 Rubric Marine’s inferno boltgun can be replaced with 1 soulreaper cannon.")).toEqual({
      from: ["inferno boltgun"],
      to: [["soulreaper cannon"]]
    })
    expect(
      parseSwap(
        "Up to 4 Kasrkin Troopers can each have their hot-shot lasgun replaced with one of the following:*<ul style=\"list-style-type:circle\"><li>1 flamer</li><li>1 plasma gun</li></ul>"
      )
    ).toEqual({ from: ["hot shot lasgun"], to: [["flamer"], ["plasma gun"]] })
    expect(parseSwap("1 Kasrkin Trooper’s hot-shot lasgun can be replaced with 1 hot-shot laspistol and 1 melta mine.")?.to).toEqual([
      ["hot shot laspistol", "melta mine"]
    ])
    expect(
      parseSwap("For every 5 models in this unit, 1 Corsair Voidreaver’s power sword or shuriken rifle can be replaced with one of the following:<ul><li>1 blaster</li></ul>")
        ?.from
    ).toEqual(["power sword", "shuriken rifle"])
    // an addition replaces nothing
    expect(parseSwap("For every 5 models in this unit, 1 model equipped with a bolt rifle can be equipped with 1 Astartes grenade launcher.")).toBeNull()
    expect(parseSwap("1 Kasrkin Trooper equipped with a hot-shot lasgun can be equipped with 1 vox-caster (that model’s hot-shot lasgun cannot be replaced).")).toBeNull()
  })

  it("drop the weapon a model gave up, and only from the model that took the option", () => {
    const swaps: Array<Swap> = [
      parseSwap("1 Rubric Marine’s inferno boltgun can be replaced with 1 soulreaper cannon.")!,
      parseSwap("The Aspiring Sorcerer’s inferno bolt pistol can be replaced with 1 warpflame pistol.")!
    ]
    const xml = readFileSync("tests/fixtures/rosters/the-fifteenth-grievance.ros", "utf8")
    const guns = (c: typeof ctx & { swaps?: (n: string) => ReadonlyArray<Swap> }) =>
      parseRosterSync(xml, "", c).units.find((u) => u.nm === "Rubric Marines A")!.w.filter((w) => w.t === "r").map((w) => `${w.nm}×${w.n}`)
    // 40k.app gives the Soulreaper cannon marine his inferno boltgun as well: nine for a ten-man squad
    expect(guns(ctx)).toContain("Inferno boltgun×9")
    expect(guns({ ...ctx, swaps: (n) => (n === "Rubric Marines A" ? swaps : []) })).toEqual([
      "Malefic Curse×1",
      "Inferno boltgun×8",
      "Soulreaper cannon×1",
      "Inferno bolt pistol×1"
    ])
  })
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
        expect((yield* loadDirectory(exportDir!)).status).toBe("loaded")
      }), 120_000)

    it.effect("wargear swaps from the export: replaced weapons go, added ones stay", () =>
      Effect.gen(function*() {
        const live = yield* importContext
        const guns = (file: string, unit: string) =>
          parseRosterSync(readFileSync(join("tests/fixtures/rosters", file), "utf8"), "", live)
            .units.find((u) => u.nm === unit)!
            .w.filter((w) => w.t === "r" && !w.off)
            .map((w) => `${w.nm}×${w.n}`)
            .sort()
        expect(guns("the-fifteenth-grievance.ros", "Rubric Marines B")).toEqual(["Inferno boltgun×8", "Malefic Curse×1", "Soulreaper cannon×1"])
        // two plasma guns, a marksman rifle, and a laspistol with a melta mine each replace a hot-shot lasgun
        expect(guns("by-writ-of-the-lord-solar.ros", "Kasrkin")).toContain("Hot-shot lasgun×5")
        // nothing to drop in a list whose options all add, or that has none
        const plain = parseRosterSync(readFileSync("tests/fixtures/rosters/strike-force-cophasta.ros", "utf8"), "", ctx)
        const again = parseRosterSync(readFileSync("tests/fixtures/rosters/strike-force-cophasta.ros", "utf8"), "", live)
        expect(again.units.map((u) => u.w)).toEqual(plain.units.map((u) => u.w))
      }))

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
