/**
 * Importer regression (handoff section 10). The POC ran its importer in
 * Chromium and compared matrix cells with the built-in lists; those built-in
 * lists *are* the POC importer's output, so here the port's output is compared
 * with them directly, document for document, and then cell for cell.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { attackerList, attackUnit } from "~/domain/engine"
import { defaultOpts } from "~/domain/options"
import type { RuleBook, Target, Unit } from "~/domain/schema"
import { parseRosterSync, parseTextExport } from "~/.server/importer/roster"
import seed from "~/.server/seed/poc-seed.json"
import { COPHASTA, pocCophasta, pocPath } from "./helpers/poc"

const library = seed.rules as unknown as RuleBook
const targets = seed.targets as unknown as Array<Target>
const ctx = {
  library,
  factionArmyRules: seed.factionArmyRules,
  detachmentRules: seed.detachmentRules,
  detachmentUnitGrants: seed.detachmentUnitGrants
}
const fixture = (name: string) => readFileSync(pocPath("fixtures", name), "utf8")
type Reference = {
  units: Array<Unit>
  rules: RuleBook
  groups: unknown
  armyRules: Array<string>
  meta: { faction: string; detachments: Array<string>; mission: string }
}
const cophasta = pocCophasta()
/** The POC importer's output for a fixture: a built-in list from the seed, or Cophasta straight from the POC. */
const builtin = (id: string) => (id === COPHASTA ? cophasta : seed.lists.find((l) => l.id === id)!) as unknown as Reference

/** Drop null/undefined properties so "absent" and "null" compare equal. */
const tidy = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === null ? undefined : x)))

const cells = (units: Array<Unit>, rules: RuleBook) => {
  const out: Record<string, Array<number>> = {}
  for (const combine of [false, true]) {
    const opts = { ...defaultOpts(), combine }
    for (const u of attackerList(units, opts)) {
      out[`${combine ? "C" : "S"} ${u.id}`] = targets.map((t) => attackUnit(u, t, opts, { rules: { ...library, ...rules }, units }).roi)
    }
  }
  return out
}

describe("roster importer", () => {
  const cases = [
    ["burning-v2.ros", "burning-v2.txt", "builtin-burning-v2", 684],
    ["cophasta.ros", "cophasta.txt", COPHASTA, 532]
  ] as const

  for (const [ros, txt, id, expectedCells] of cases) {
    describe(ros, () => {
      const got = parseRosterSync(fixture(ros), fixture(txt), ctx)
      const want = builtin(id)

      it("produces the same units, groups and rules as the POC importer", () => {
        expect(tidy(got.units)).toEqual(tidy(want.units))
        expect(got.groups).toEqual(want.groups)
        expect(got.armyRules).toEqual(want.armyRules)
        expect(tidy(got.rules)).toEqual(tidy(want.rules))
        expect(got.meta.faction).toBe(want.meta.faction)
        expect(got.meta.detachments).toEqual(want.meta.detachments)
        expect(got.meta.mission).toBe(want.meta.mission)
      })

      it(`matches the built-in list in all ${expectedCells} matrix cells`, () => {
        const a = cells(got.units, got.rules)
        const b = cells(want.units, want.rules)
        expect(Object.keys(a)).toEqual(Object.keys(b))
        let n = 0
        for (const k of Object.keys(a)) {
          a[k].forEach((v, i) => {
            n++
            expect(Math.abs(v - b[k][i]), `${k} → ${targets[i].nm}`).toBeLessThan(0.05)
          })
        }
        expect(n).toBe(expectedCells)
      })

      it("imports without warnings", () => {
        expect(got.warnings).toEqual([])
      })
    })
  }

  it("v2 matches the hand-built v1 list on every unit they share (570 cells)", () => {
    const got = parseRosterSync(fixture("burning-v2.ros"), fixture("burning-v2.txt"), ctx)
    const v1 = builtin("builtin-burning-v1")
    const skip = ["Rangers A", "Rangers B", "Corsair Skyreavers C"]
    const nameKey = (s: string) => s.toLowerCase().replace(/^corsair /, "").replace(/ [ab]$/, "")
    let n = 0
    for (const combine of [false, true]) {
      const opts = { ...defaultOpts(), combine }
      const imp = attackerList(got.units, opts)
      const ref = attackerList(v1.units, opts)
      for (const a of imp) {
        if (skip.some((s) => a.nm.includes(s))) continue
        const b = ref.find((x) => x.nm + (x.sub ? " " + x.sub : "") === a.nm) ??
          ref.find((x) => x.nm === a.nm) ??
          ref.find((x) => nameKey(x.nm) === nameKey(a.nm) && x.models === a.models && !imp.some((y) => y !== a && y.nm === x.nm))
        expect(b, `no match for ${a.nm}`).toBeDefined()
        for (const t of targets) {
          const va = attackUnit(a, t, opts, { rules: { ...library, ...got.rules }, units: got.units }).roi
          const vb = attackUnit(b!, t, opts, { rules: library, units: v1.units }).roi
          n++
          expect(Math.abs(va - vb), `${combine ? "C" : "S"} ${a.nm} → ${t.nm}`).toBeLessThan(0.05)
        }
      }
    }
    expect(n).toBe(570)
  })

  it("reads the text export's header, sections and enhancements", () => {
    const t = parseTextExport(fixture("cophasta.txt"))
    expect(t.name).toBe("STRIKE FORCE COPHASTA")
    expect(t.faction).toBe("White Scars")
    expect(t.detachments).toEqual(["Spearpoint Task Force", "Assault Brethren"])
    expect(t.mission).toBe("Reconnaissance")
    expect(t.entries).toHaveLength(17)
    expect(t.entries.find((e) => e.nm === "Suboden Khan")?.tag).toBe("Warlord")
    expect(t.entries.find((e) => e.nm === "Chaplain on Bike")?.enh).toEqual({ nm: "Spearpoint Paragon", pts: 25 })
  })

  it("rejects files that are not rosters", () => {
    expect(() => parseRosterSync("<nope/>", "", ctx)).toThrow(/No <roster> found/)
    expect(() => parseRosterSync("not xml at all <", "", ctx)).toThrow(/valid roster XML/)
  })
})
