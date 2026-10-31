/** How much of a target an activation clears: checked by hand, against the matrix's averages, and against a simulation. */
import { describe, expect, it } from "vitest"
import type { AttackChances, AttackRow } from "~/domain/attack"
import { clearMatrix, clearNotes, clearOf } from "~/domain/clear"
import { attackUnit } from "~/domain/engine"
import { matrix } from "~/domain/ledger"
import { defaultOpts } from "~/domain/options"
import type { Opts, RuleBook, Target, Unit, Weapon } from "~/domain/schema"
import seed from "~/.server/seed/poc-seed.json"

const rules = seed.rules as unknown as RuleBook
const targets = seed.targets as unknown as Array<Target>
const list = seed.lists.find((l) => l.id === "builtin-burning-v2")! as unknown as { units: Array<Unit>; rules: RuleBook; groups: Record<string, { nm: string; short: string }> }
const book = { ...rules, ...list.rules }

const weapon = (over: Partial<Weapon> = {}): Weapon => ({ nm: "Gun", t: "r", n: 1, A: 2, sk: 3, S: 5, AP: 0, D: 1, kw: {}, ...over })
const target = (over: Partial<Target> = {}): Target => ({ id: "t", nm: "Target", pts: 100, T: 4, Sv: 7, inv: 0, W: 1, N: 1, fnp: 0, dr: 0, kw: "INFANTRY", cls: "inf", ...over })
const unit = (w: Array<Weapon>): Unit => ({ id: "u", nm: "Unit", pts: 100, models: 1, kw: [], rules: [], w }) as unknown as Unit
const opts = (over: Partial<Opts> = {}): Opts => ({ ...defaultOpts(), ...over })

const rowsFor = (w: Array<Weapon>, t: Target, o = opts()) => attackUnit(unit(w), t, o, { rules: {}, units: [] }).rows
const clear = (w: Array<Weapon>, t: Target, o = opts()) => clearOf(rowsFor(w, t, o), t)

describe("clearing a target", () => {
  it("works out one small case by hand", () => {
    // two attacks, 3+ to hit, 3+ to wound, no save: each kills 4/9 of the time
    const c = clear([weapon()], target({ T: 4 }))
    expect(c.wipe).toBeCloseTo((1 - (5 / 9) ** 2) * 100, 8)
  })

  it("agrees with the matrix when there is nothing to waste", () => {
    // D1 into a huge pool of 1-wound models: every unsaved wound is one model
    const t = target({ N: 200, W: 1, Sv: 4 })
    const w = [weapon({ A: 6, kw: { sus: 1 } as Weapon["kw"] }), weapon({ nm: "Hammer", t: "m", A: 4, sk: 3, kw: { lethal: 1 } as Weapon["kw"] })]
    const res = attackUnit(unit(w), t, opts(), { rules: {}, units: [] })
    expect(clearOf(res.rows, t).models).toBeCloseTo(res.total, 8)
    // and a big model never loses damage to spill-over, whatever the damage roll
    const big = target({ N: 1, W: 60, Sv: 4 })
    const gun = [weapon({ A: 6, D: "D6+1", kw: { dev: 1 } as Weapon["kw"] })]
    const r = attackUnit(unit(gun), big, opts(), { rules: {}, units: [] })
    expect((clearOf(r.rows, big).cleared / 100) * 60).toBeCloseTo(r.total, 8)
  })

  it("loses what spills past a model, which an average can't see", () => {
    // ten D2 hits into W3 models: 20 damage, but each model takes two hits, so five die and not six
    const c = clear([weapon({ A: 10, sk: 2, S: 12, kw: { torrent: 1 } as Weapon["kw"], D: 2 })], target({ N: 10, W: 3, T: 4 }))
    const avgWounds = attackUnit(unit([weapon({ A: 10, sk: 2, S: 12, kw: { torrent: 1 } as Weapon["kw"], D: 2 })]), target({ N: 10, W: 3, T: 4 }), opts(), { rules: {}, units: [] }).total
    expect(avgWounds / 3).toBeGreaterThan(c.models)
  })

  // torrent hits every time and S12 into T2 wounds on a 2+, so each attack lands 5/6 of the time
  const sure = { torrent: 1 } as Weapon["kw"]
  const lands = 5 / 6

  it("lets a small weapon finish a model a big one damaged", () => {
    // D2 then D1 into one W3 model: it takes both landing, whichever goes first
    const t = target({ W: 3, T: 2 })
    const c = clear([weapon({ nm: "Small", A: 1, S: 12, D: 1, kw: sure }), weapon({ nm: "Big", A: 1, S: 12, D: 2, kw: sure })], t)
    expect(c.wipe).toBeCloseTo(100 * lands ** 2, 6)
  })

  it("counts a single model by its wounds, a squad by its models", () => {
    expect(clear([weapon({ A: 3, S: 12, kw: sure })], target({ N: 1, W: 6, T: 2 })).cleared).toBeCloseTo((100 * 3 * lands) / 6, 6)
    // one of two W3 models dies only if all three land, and two wounds on a model remove nothing
    expect(clear([weapon({ A: 3, S: 12, kw: sure })], target({ N: 2, W: 3, T: 2 })).cleared).toBeCloseTo(50 * lands ** 3, 6)
    expect(clear([weapon({ A: 2, S: 12, kw: sure })], target({ N: 2, W: 3, T: 2 })).cleared).toBeCloseTo(0, 6)
  })

  it("gives a target Feel No Pain, rolled for each point of damage", () => {
    // one D2 hit into a W2 model with a 4+: both points must get through
    expect(clear([weapon({ A: 1, S: 12, D: 2, kw: sure })], target({ W: 2, T: 2, fnp: 4 })).wipe).toBeCloseTo(100 * lands * 0.25, 6)
  })

  it("has every chance add up, and more guns never clear less", () => {
    const t = target({ N: 5, W: 3, T: 6, Sv: 2, inv: 4 })
    const few = clear([weapon({ A: 6, S: 6, AP: 2, D: 2 })], t)
    const many = clear([weapon({ A: 12, S: 6, AP: 2, D: 2 })], t)
    expect(many.wipe).toBeGreaterThan(few.wipe)
    expect(many.cleared).toBeGreaterThan(few.cleared)
    expect(many.cleared).toBeLessThanOrEqual(100)
  })

  it("rolls random attacks model by model", () => {
    // D3 attacks from one model into three W1 models: a wipe takes a 3 and all three landing
    const c = clear([weapon({ A: "D3", S: 12, kw: sure })], target({ N: 3, W: 1, T: 2 }))
    expect(c.wipe).toBeCloseTo((100 / 3) * lands ** 3, 6)
    expect(c.models).toBeCloseTo(2 * lands, 6)
  })
})

describe("the view, on the built-in list", () => {
  const ledger = { units: list.units, rules: book, groups: list.groups, targets, opts: { ...defaultOpts(), combine: true, flags: { ...defaultOpts().flags, charged: true } } }
  const m = matrix(ledger as never)
  const v = clearMatrix(m)
  const row = v.rows.find((r) => r.unit.nm === "Yriel + Voidscarred")!
  const cell = (id: string) => row.cells[v.targets.findIndex((t) => t.id === id)]

  for (const id of ["terminators", "assault-terminators", "cadians"]) {
    it(`matches a simulation of Yriel and his Voidscarred into ${id}`, () => {
      const t = v.targets.find((x) => x.id === id)!
      const res = m.rows.find((r) => r.unit === row.unit)!.cells[v.targets.indexOf(t)]
      const simulated = simulate(res.rows, t, 200_000)
      expect(Math.abs(cell(id).wipe - simulated.wipe)).toBeLessThan(0.6)
      expect(Math.abs(cell(id).cleared - simulated.cleared)).toBeLessThan(0.4)
    })
  }

  it("shows a wipe that dividing damage by wounds would overstate", () => {
    // more than the squad's wounds on average, and still under an even chance
    const k = v.targets.findIndex((t) => t.id === "assault-terminators")
    expect(m.rows.find((r) => r.unit === row.unit)!.cells[k].total).toBeGreaterThan(20)
    expect(cell("assault-terminators").wipe).toBeLessThan(50)
  })

  it("follows the phase, as the matrix does", () => {
    const shooting = clearMatrix(matrix({ ...ledger, opts: { ...ledger.opts, phase: "ranged" } } as never))
    const melee = clearMatrix(matrix({ ...ledger, opts: { ...ledger.opts, phase: "melee" } } as never))
    const k = v.targets.findIndex((t) => t.id === "terminators")
    const of = (x: typeof v) => x.rows.find((r) => r.unit.nm === row.unit.nm)!.cells[k]
    expect(of(shooting).cleared).toBeLessThan(of(v).cleared)
    expect(of(melee).cleared).toBeLessThan(of(v).cleared)
    expect(of(melee).cleared).toBeGreaterThan(of(shooting).cleared)
  })

  it("writes the findings", () => {
    const notes = clearNotes(v)
    expect(notes.map((n) => n.kind)).toContain("top")
    expect(notes.some((n) => n.kind === "gap" || n.kind === "covered")).toBe(true)
  })
})

/** The same attacks rolled at random, in the order `clearOf` uses. */
function simulate(rows: ReadonlyArray<AttackRow>, t: Target, trials: number) {
  const pick = (dist: ReadonlyArray<readonly [number, number]>) => {
    let r = Math.random()
    for (const [v, p] of dist) {
      if ((r -= p) < 0) return v
    }
    return dist[dist.length - 1][0]
  }
  const order = rows
    .filter((r) => !r.skipped && r.chances && r.dealt)
    .sort((a, b) => (a.w.t === b.w.t ? (b.dmg ?? 0) - (a.dmg ?? 0) : a.w.t === "r" ? -1 : 1))
  let wiped = 0
  let killed = 0
  for (let i = 0; i < trials; i++) {
    let left = t.N * t.W
    const strike = (d: number) => {
      const onModel = ((left - 1) % t.W) + 1
      left = d >= onModel ? left - onModel : left - d
    }
    const toSave = (c: AttackChances) => {
      if (left && Math.random() < c.unsaved) strike(pick(c.damage))
    }
    const toWound = (c: AttackChances) => {
      const r = Math.random()
      if (r < c.mortal) strike(pick(c.mortalDamage))
      else if (r < c.mortal + c.wound) toSave(c)
    }
    for (const row of order) {
      const c = row.chances!
      for (let m = 0; m < row.w.n; m++) {
        const attacks = pick(c.perModel)
        for (let a = 0; a < attacks && left; a++) {
          const r = Math.random()
          if (r < c.crit) {
            if (c.lethal) toSave(c)
            else toWound(c)
            for (let s = 0; s < c.sus && left; s++) toWound(c)
          } else if (r < c.crit + c.normal) toWound(c)
        }
      }
    }
    if (!left) wiped++
    killed += t.N - Math.ceil(left / t.W)
  }
  return { wipe: (wiped / trials) * 100, cleared: (killed / trials / t.N) * 100 }
}
