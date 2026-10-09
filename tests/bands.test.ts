/** Coverage by toughness band: which band a target is in, what hurting one means, and the built-in list's coverage. */
import { describe, expect, it } from "vitest"
import { BANDS, bandNotes, bandOf, bandView, coversBand, pointsRemoved, punchLine, reach } from "~/domain/bands"
import type { AttackResult } from "~/domain/engine"
import { matrix } from "~/domain/ledger"
import { defaultOpts } from "~/domain/options"
import type { RuleBook, Target, Unit } from "~/domain/schema"
import seed from "~/.server/seed/poc-seed.json"

const rules = seed.rules as unknown as RuleBook
const targets = seed.targets as unknown as Array<Target>
const v2 = seed.lists.find((l) => l.id === "builtin-burning-v2")! as unknown as { units: Array<Unit>; rules: RuleBook; groups: Record<string, { nm: string; short: string }> }
const ledger = { units: v2.units, rules: { ...rules, ...v2.rules }, targets, opts: defaultOpts(), groups: v2.groups }
const names = (us: ReadonlyArray<Unit>) => us.map((u) => u.nm)
/** A matrix cell with just the numbers the band tests read. */
const cell = (total: number, t: Target, pts: number): AttackResult => {
  const pool = t.W * t.N
  return { rows: [], total, pts, ppw: t.pts / pool, roi: (total / pts) * (t.pts / pool) * 100, pool, capped: false, rules: [] }
}
const target = (id: string) => targets.find((t) => t.id === id)!

describe("toughness bands", () => {
  it("puts each Toughness in one band, everything up to T4 in the first", () => {
    expect([2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14].map((T) => bandOf({ T }).label)).toEqual(
      ["T3–4", "T3–4", "T3–4", "T5", "T6", "T7–9", "T7–9", "T10–11", "T10–11", "T12+", "T12+"]
    )
    // the benchmark set has every band, but only one target at T12 or more
    expect(BANDS.map((b) => targets.filter((t) => bandOf(t) === b).length)).toEqual([3, 3, 3, 4, 5, 1])
  })

  it("covers a band at half its targets or more", () => {
    expect([coversBand(1, 1), coversBand(1, 2), coversBand(1, 3), coversBand(2, 3), coversBand(2, 4), coversBand(2, 5), coversBand(3, 5)]).toEqual(
      [true, true, false, true, true, false, true]
    )
    expect(coversBand(0, 0)).toBe(false)
  })

  it("counts 80 points removed, or the whole unit when it’s worth less, and never overkill", () => {
    const raider = target("land-raider") // 245 pts, 16 wounds
    const cadians = target("cadians") // 70 pts, 10 wounds
    expect(punchLine(raider)).toBe(80)
    expect(punchLine(cadians)).toBe(70)
    // 5.2 wounds on a Land Raider is 79.6 points, which shows as 80 and counts
    expect(reach(cell(5.2, raider, 200), raider, "removes")).toBeGreaterThanOrEqual(1)
    expect(reach(cell(5.1, raider, 200), raider, "removes")).toBeLessThan(1)
    // wiping ten Cadians is all 70 of their points; dealing 30 wounds to them is still 70
    expect(reach(cell(10, cadians, 200), cadians, "removes")).toBe(1)
    expect(pointsRemoved(cell(30, cadians, 200))).toBe(70)
    expect(reach(cell(9, cadians, 200), cadians, "removes")).toBeLessThan(1)
    // the return test is the matrix's 65% line, judged by the whole number shown
    expect(reach(cell(6.5, cadians, 70), cadians, "return")).toBe(1)
    expect(reach(cell(6.4, cadians, 70), cadians, "return")).toBeLessThan(1)
  })

  it("finds the built-in list’s anti-tank in its three big attached units", () => {
    const v = bandView(matrix(ledger), "removes")
    expect(v.columns.map((c) => c.units.length)).toEqual([6, 5, 3, 3, 3, 3])
    const heavies = ["Fuegan + Fire Dragons", "Lhykhis + Warp Spiders", "Yriel + Voidscarred"]
    for (const c of v.columns.slice(2)) expect(names(c.units)).toEqual(heavies)
    // every unit's band count agrees with its hits
    for (const r of v.rows) r.cells.forEach((x, j) => expect(x.covers).toBe(coversBand(x.hits.filter(Boolean).length, v.columns[j].targets.length)))
    expect(bandNotes(v).map((n) => n.kind)).toEqual(["covered", "single"])
  })

  it("names a thin band and the unit closest to covering it", () => {
    const v = bandView(matrix(ledger), "return")
    expect(v.columns.map((c) => c.units.length)).toEqual([7, 2, 1, 2, 2, 2])
    const [thin, single] = bandNotes(v)
    expect(thin.kind === "thin" && [thin.band.label, names(thin.units), thin.closest?.unit.nm, thin.closest?.hit]).toEqual(
      ["T6", ["Yriel + Voidscarred"], "Corsair Skyreavers A", 0]
    )
    expect(single.kind === "single" && single.target.nm).toBe("Land Raider")
  })

  it("leaves a band with no targets unjudged", () => {
    const v = bandView(matrix({ ...ledger, targets: targets.filter((t) => t.T < 12) }), "removes")
    expect(v.columns[5].targets).toHaveLength(0)
    expect(v.columns[5].units).toHaveLength(0)
    expect(bandNotes(v).map((n) => n.kind)).toEqual(["covered", "empty"])
  })
})
