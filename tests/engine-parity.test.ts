/**
 * Holds the TypeScript engine to the POC's numbers.
 *
 * 1. Calibration (handoff section 7 / 10): with bare datasheets, four rows
 *    reproduce the Culling Cogitator for all 19 targets, and Yriel into Warp
 *    Spiders is Σ 3.98 → 88.0%. Measured on the POC's hand-built list, and
 *    held on the list the app ships, whose footer shows the live number.
 * 2. Parity: every cell of the built-in list and of the POC's two other lists,
 *    split and combined, under a spread of option scenarios, equals the POC
 *    engine's value. This is what licenses moving the POC's by-name rule
 *    branches into data.
 */
import { describe, expect, it } from "vitest"
import { attackerList, attackUnit, MOD0 } from "~/domain/engine"
import { bareDatasheetOpts, defaultOpts } from "~/domain/options"
import type { Mod, Opts, RuleBook, Target, Unit } from "~/domain/schema"
import seed from "~/.server/seed/poc-seed.json"
import { COPHASTA, loadPoc, pocBurningV1, pocCophasta, pocLists, toPocOpts } from "./helpers/poc"

const rules = seed.rules as unknown as RuleBook
const targets = seed.targets as unknown as Array<Target>
type TestList = { id: string; units: Array<Unit>; rules: RuleBook }
// the list the app ships, plus the POC's hand-built Aeldari list and its Space Marines list (see tests/helpers/poc.ts)
const builtin = seed.lists[0] as unknown as TestList
const lists = [builtin, pocBurningV1(), pocCophasta()] as unknown as Array<TestList>
const v1 = lists[1]

describe("calibration against the Culling Cogitator", () => {
  const EXPECT: Record<string, Array<number>> = {
    yriel: [44, 88, 56, 48, 81, 84, 81, 90, 55, 68, 47, 61, 66, 83, 49, 89, 78, 38, 75],
    fuegan: [34, 67, 48, 32, 65, 70, 52, 48, 29, 54, 37, 40, 44, 42, 22, 48, 34, 17, 44],
    kharseth: [34, 57, 34, 41, 31, 27, 23, 32, 5, 6, 5, 9, 7, 9, 8, 8, 10, 7, 7],
    "shroud-runners": [68, 105, 73, 58, 38, 27, 15, 21, 23, 23, 17, 35, 20, 19, 19, 14, 21, 18, 13]
  }

  // [list, its id for Yriel]: the importer names him by his datasheet, the hand-built list didn't
  for (const [list, yrielId] of [[v1, "yriel"], [builtin, "prince-yriel"]] as const) {
    describe(list.id, () => {
      const bare = bareDatasheetOpts(list.units)
      const ctx = { rules, units: list.units }
      // the Cogitator scored Yriel without Archraider
      const unit = (id: string): Unit => {
        const u = list.units.find((x) => x.id === (id === "yriel" ? yrielId : id))!
        return id === "yriel" ? { ...u, pts: 95 } : u
      }

      for (const [id, want] of Object.entries(EXPECT)) {
        it(`${id} reproduces the published row`, () => {
          const got = targets.map((t) => Math.round(attackUnit(unit(id), t, bare, ctx).roi))
          expect(got).toEqual(want)
        })
      }

      it("Yriel at 95 pts into Warp Spiders is Σ 3.98 → 88.0%", () => {
        const r = attackUnit(unit("yriel"), targets.find((t) => t.id === "warp-spiders")!, bare, ctx)
        expect(r.total.toFixed(2)).toBe("3.98")
        expect(r.roi.toFixed(1)).toBe("88.0")
      })
    })
  }
})

describe("parity with the POC engine", () => {
  const poc = loadPoc()
  const pocL = pocLists(poc)
  // The POC applied list-wide marks twice to the unit that sets them (once as
  // its own rule, once as a mark). This port applies them once; to compare like
  // with like the oracle gets units with those rules removed from their own list.
  const pocGlobalMarks = new Set(
    Object.entries(poc.BASE_RULES)
      .filter(([, r]) => r.mark && r.global && r.fx)
      .map(([id]) => id)
  )
  const stripGlobalMarks = (units: Array<any>) =>
    units.map((u) => ({ ...u, rules: (u.rules || []).filter((id: string) => !pocGlobalMarks.has(id)) }))

  const mod = (m: Partial<Mod>): Mod => ({ ...MOD0, ...m })
  const base = defaultOpts()
  const withFlags = (f: Record<string, boolean>): Opts => ({ ...base, flags: { ...base.flags, ...f } })
  const allMods = (m: Partial<Mod>): Opts => ({ ...base, mods: { all: mod(m) } })
  const ALL_MARKS = { riven: true, web: true, guide: true, quarry: true, spiritmark: true, shattered: true, hailstrike: true }

  const scenarios = (units: Array<Unit>): Record<string, Opts> => {
    const first = units[0]
    const grouped = units.find((u) => u.grp)
    return {
      default: base,
      "not charged": withFlags({ charged: false }),
      stationary: withFlags({ stationary: true }),
      "target on objective": withFlags({ objective: true }),
      "target is a character": withFlags({ char: true }),
      "unit on objective": withFlags({ selfObj: true }),
      riven: withFlags({ riven: true }),
      webbed: withFlags({ web: true }),
      guided: withFlags({ guide: true }),
      quarry: withFlags({ quarry: true }),
      "spirit-marked": withFlags({ spiritmark: true }),
      shattered: withFlags({ shattered: true }),
      "hailstrike-marked": withFlags({ hailstrike: true }),
      "every mark and situation": withFlags({ ...ALL_MARKS, stationary: true, objective: true, char: true, selfObj: true }),
      "shooting only": { ...base, phase: "ranged" },
      "melee only": { ...base, phase: "melee" },
      "enhancement points excluded": { ...base, enh: false },
      "overkill capped": { ...base, cap: true },
      "bare datasheets": bareDatasheetOpts(units, { phase: "all", combine: true }),
      cover: allMods({ cover: true }),
      "half range": allMods({ half: true }),
      "cover, half range, hailstrike": { ...allMods({ cover: true, half: true }), flags: { ...base.flags, hailstrike: true } },
      "+1 hit": allMods({ hit: 1 }),
      "-1 hit": allMods({ hit: -1 }),
      "+1 wound": allMods({ wound: 1 }),
      "-1 wound": allMods({ wound: -1 }),
      "+2 AP": allMods({ ap: 2 }),
      "-1 AP": allMods({ ap: -1 }),
      "sustained and lethal": allMods({ sus: true, lethal: true }),
      "re-roll hit 1s": allMods({ rrHit: "1s" }),
      "full re-roll hits": allMods({ rrHit: "full" }),
      "re-roll wound 1s": allMods({ rrWound: "1s" }),
      "full re-roll wounds": allMods({ rrWound: "full" }),
      "rapid fire 2 at half range": allMods({ rf: 2, half: true }),
      "rapid fire 2, not in range": allMods({ rf: 2 }),
      "+1 hit, ranged only": allMods({ hit: 1, apply: "ranged" }),
      "+1 wound, melee only": allMods({ wound: 1, apply: "melee" }),
      "one datasheet modified": { ...base, mods: { [first.id]: mod({ hit: -1, ap: 1, rrWound: "full" }) } },
      "one attached unit modified": grouped
        ? { ...base, mods: { ["grp-" + grouped.grp]: mod({ sus: true, wound: 1 }), [grouped.id]: mod({ cover: true }) } }
        : base
    }
  }

  for (const list of lists) {
    it(`${list.id}: every cell matches under every scenario`, () => {
      const ref = pocL[list.id]
      poc.setRules({ ...poc.BASE_RULES, ...ref.rules })
      const refUnits = stripGlobalMarks(ref.units)
      const ctx = { rules: { ...rules, ...list.rules }, units: list.units }
      let cells = 0
      const diffs: Array<string> = []
      for (const [name, o] of Object.entries(scenarios(list.units))) {
        for (const combine of [false, true]) {
          const opts: Opts = { ...o, combine }
          const mine = attackerList(list.units, opts)
          const theirs = poc.attackerList(refUnits, toPocOpts(opts))
          expect(mine.map((u) => u.id)).toEqual(theirs.map((u: any) => u.id))
          mine.forEach((u, i) => {
            for (const t of targets) {
              const a = attackUnit(u, t, opts, ctx)
              const b = poc.attackUnit(theirs[i], t, toPocOpts(opts), refUnits)
              cells++
              if (Math.abs(a.roi - b.roi) > 1e-9 || Math.abs(a.total - b.total) > 1e-9) {
                diffs.push(`${name} / ${combine ? "combined" : "split"} / ${u.nm} → ${t.nm}: ${b.roi.toFixed(3)} (POC) vs ${a.roi.toFixed(3)}`)
              }
            }
          })
        }
      }
      expect(diffs.slice(0, 20)).toEqual([])
      expect(cells).toBeGreaterThan(10_000)
    })
  }

  it("applies a list-wide mark once to the unit that sets it (the POC counted it twice)", () => {
    const list = lists.find((l) => l.id === COPHASTA)!
    const ref = pocL[list.id]
    poc.setRules({ ...poc.BASE_RULES, ...ref.rules })
    const opts: Opts = { ...withFlags({ shattered: true }), combine: false, phase: "ranged" }
    const u = list.units.find((x) => x.rules.includes("shattered-defences"))!
    const t = targets.find((x) => x.id === "land-raider")!
    const mine = attackUnit(u, t, opts, { rules: { ...rules, ...list.rules }, units: list.units })
    const pocTwice = poc.attackUnit(ref.units.find((x: any) => x.id === u.id), t, toPocOpts(opts), ref.units)
    expect(mine.roi).toBeLessThan(pocTwice.roi)
  })
})
