/**
 * The effect vocabulary (app/domain/fx.ts) and how clauses from different
 * places combine in one attack (app/domain/attack.ts).
 */
import { describe, expect, it } from "vitest"
import { attackUnit, MOD0 } from "~/domain/engine"
import { Schema } from "effect"
import { CLAUSE, describeFx, FX_HELP, tidyClause } from "~/domain/fx"
import { defaultOpts } from "~/domain/options"
import { Fx, type Mod, Opts, type RuleBook, type Target, type Unit, type Weapon } from "~/domain/schema"

const gun = (over: Partial<Weapon> = {}): Weapon => ({ nm: "Gun", t: "r", n: 1, A: 6, sk: 4, S: 4, AP: 0, D: 1, kw: {}, ...over })
const blade = (over: Partial<Weapon> = {}): Weapon => ({ nm: "Blade", t: "m", n: 1, A: 6, sk: 4, S: 4, AP: 0, D: 1, kw: {}, ...over })
const unit = (over: Partial<Unit> = {}): Unit => ({ id: "u", nm: "Unit", pts: 100, models: 1, kw: ["INFANTRY"], rules: [], w: [gun(), blade()], ...over })
const target: Target = { id: "t", nm: "Target", pts: 100, T: 4, Sv: 7, inv: 0, W: 1, N: 10, fnp: 0, dr: 0, kw: "INFANTRY", cls: "inf" }
const opts = (over: { flags?: Record<string, boolean>; bar?: Partial<Mod> } = {}): Opts => ({
  ...defaultOpts(),
  combine: false,
  flags: { charged: false, ...over.flags },
  mods: over.bar ? { all: { ...MOD0, ...over.bar } } : {}
})
const row = (u: Unit, o: Opts, rules: RuleBook = {}, weapon = "Gun") => attackUnit(u, target, o, { rules, units: [u] }).rows.find((r) => r.w.nm === weapon)!

describe("the vocabulary", () => {
  it("says what a clause does, filters first, in the table's order", () => {
    expect(describeFx({ hit: 1, phase: "ranged", rrWound: "ones", vs: { only: ["VEHICLE"], not: ["TITANIC"] }, grant: { sus: 1, lethal: 1 } })).toBe(
      "ranged, vs vehicle, not vs titanic: +1 to hit, re-roll wound rolls of 1, Sustained Hits 1, Lethal Hits"
    )
    expect(describeFx({ weaponKw: "heavy", grant: { sus: 1 } })).toBe("heavy weapons: Sustained Hits 1")
    expect(describeFx({ when: "charged" })).toBe("when “charged”: nothing")
  })

  it("has help beside the editor for every field", () => {
    const labels = FX_HELP.map(([label]) => label).join(", ")
    for (const k of Object.keys(CLAUSE)) expect(labels, k).toMatch(new RegExp(`\\b${k}\\b`))
  })
})

describe("the rule editor's clauses", () => {
  it("gives every field a label and a starting value the schema accepts", () => {
    for (const [k, f] of Object.entries(CLAUSE)) {
      expect(f.label, k).toBeTruthy()
      const clause = tidyClause({ [k]: f.blank })
      expect(() => Schema.decodeUnknownSync(Fx, { onExcessProperty: "error" })(clause), k).not.toThrow()
    }
  })

  it("saves a clause with its fields in order and nothing empty", () => {
    expect(JSON.stringify(tidyClause({ grant: { lance: 1 }, weapon: "", phase: "melee", vs: { only: [], not: ["TITANIC"] }, anti: {} }))).toBe(
      '{"phase":"melee","vs":{"not":["TITANIC"]},"grant":{"lance":1}}'
    )
    // an empty keyword filter would match no target at all, so it is left out rather than saved
    expect(tidyClause({ vs: { only: [] }, hit: 1 })).toEqual({ hit: 1 })
  })
})

describe("clauses from different places combine by the same rules", () => {
  const rules: RuleBook = {
    aim: { nm: "Aim", src: "Datasheet", dmg: true, txt: "", fx: [{ hit: 1, rrHit: "ones", ap: 1 }] },
    lance: { nm: "Lances", src: "Datasheet", dmg: true, txt: "", fx: [{ grant: { lance: 1 } }] }
  }

  it("caps the modifier bar and a rule together at +1 to hit", () => {
    const u = unit({ rules: ["aim"] })
    // BS 4+ improved to 3+, not 2+
    expect(row(u, opts({ bar: { hit: 1 } }), rules).hitChance).toBeCloseTo((4 / 6) * (7 / 6))
  })

  it("keeps the strongest re-roll, whichever place it comes from", () => {
    const u = unit({ rules: ["aim"] })
    // the rule's +1 to hit makes it 3+: a full re-roll beats its re-roll of 1s, and its 1s beat the bar's
    expect(row(u, opts({ bar: { rrHit: "full" } }), rules).hitChance).toBeCloseTo(4 / 6 + (2 / 6) * (4 / 6))
    expect(row(u, opts({ bar: { rrHit: "1s" } }), rules).hitChance).toBeCloseTo((4 / 6) * (7 / 6))
  })

  it("notes the bar once, and what the rules changed separately", () => {
    const notes = row(unit({ rules: ["aim"] }), opts({ bar: { ap: 1 } }), rules).notes
    expect(notes).toEqual(["Modifier: +1 AP", "Aim", "+1 AP"])
  })

  it("adds the bar's Strength, Attacks and Damage, and notes them with the bar", () => {
    // S4 into T4 on 4+; +1 S makes it 3+. Six attacks; +1 A makes seven. D1 into W2; +1 D kills a model per wound
    const two = { ...target, W: 2 }
    const base = attackUnit(unit(), two, opts(), { rules: {}, units: [] }).rows[0]
    const buffed = attackUnit(unit(), two, opts({ bar: { s: 1, a: 1, d: 1 } }), { rules: {}, units: [] }).rows[0]
    expect(base.wound).toBeCloseTo(3 / 6)
    expect(buffed.wound).toBeCloseTo(4 / 6)
    expect(buffed.attacks).toBe(base.attacks! + 1)
    expect(buffed.dmg).toBeCloseTo(2 * base.dmg!)
    expect(buffed.notes).toEqual(["Modifier: +1 S, +1 A, +1 D"])
    // and only for the attacks it applies to
    const melee = attackUnit(unit(), two, opts({ bar: { d: 1, apply: "melee" } }), { rules: {}, units: [] }).rows
    expect(melee[0].dmg).toBeCloseTo(base.dmg!)
    expect(melee[1].dmg).toBeCloseTo(2 * base.dmg!)
  })

  it("reads options saved before the bar had Strength, Attacks and Damage", () => {
    const { s: _s, a: _a, d: _d, ...old } = { ...MOD0, hit: 1 }
    const decoded = Schema.decodeUnknownSync(Opts)({ ...defaultOpts(), mods: { all: old } })
    expect(row(unit(), decoded).hitChance).toBeCloseTo(4 / 6)
  })

  it("treats Heavy and Lance as clauses: only stationary at range, only on the charge in melee", () => {
    const heavy = unit({ w: [gun({ kw: { heavy: 1 } })] })
    expect(row(heavy, opts()).hitChance).toBeCloseTo(3 / 6)
    expect(row(heavy, opts({ flags: { stationary: true } })).hitChance).toBeCloseTo(4 / 6)
    expect(row(heavy, opts({ flags: { stationary: true } })).notes).toContain("Heavy")
    const lance = unit({ w: [blade({ kw: { lance: 1 } })] })
    expect(row(lance, opts(), {}, "Blade").wound).toBeCloseTo(3 / 6)
    expect(row(lance, opts({ flags: { charged: true } }), {}, "Blade").wound).toBeCloseTo(4 / 6)
  })

  it("wounds critically on the best Anti roll the target has the keyword for", () => {
    const vs = (kw: string, anti: Weapon["kw"]["anti"]) =>
      attackUnit(unit({ w: [gun({ S: 1, kw: { anti } })] }), { ...target, T: 8, kw }, opts(), { rules: {}, units: [] }).rows[0]
    // S1 into T8 wounds on 6+, so the wound chance is the critical roll's
    expect(vs("INFANTRY DAEMON", { DAEMON: 4, INFANTRY: 5 }).wound).toBeCloseTo(3 / 6)
    expect(vs("INFANTRY", { DAEMON: 4, INFANTRY: 5 }).wound).toBeCloseTo(2 / 6)
    expect(vs("INFANTRY", { DAEMON: 4, INFANTRY: 5 }).notes).toContain("Anti-infantry 5+")
    expect(vs("VEHICLE", ["MONSTER/VEHICLE", 3]).wound).toBeCloseTo(4 / 6)
    expect(vs("MOUNTED", ["MONSTER/VEHICLE", 3]).wound).toBeCloseTo(1 / 6)
  })

  it("lets a rule grant Anti abilities, keeping the better roll", () => {
    const rules: RuleBook = { hunt: { nm: "Hunters", src: "Stratagem", dmg: true, txt: "", fx: [{ phase: "ranged", anti: { INFANTRY: 2, MONSTER: 5 } }] } }
    expect(describeFx(rules.hunt.fx![0])).toBe("ranged: Anti-infantry 2+, Anti-monster 5+")
    // S1 into T8 wounds on 6+, so the wound chance is the critical roll's
    const score = (w: Array<Weapon>, kw: string) =>
      attackUnit(unit({ rules: ["hunt"], w }), { ...target, T: 8, kw }, opts(), { rules, units: [] }).rows
    const [shot, swing] = score([gun({ S: 1 }), blade({ S: 1 })], "INFANTRY")
    expect(shot.wound).toBeCloseTo(5 / 6)
    expect(shot.notes).toEqual(["Hunters", "Anti-infantry 2+"])
    // only ranged weapons gain it
    expect(swing.wound).toBeCloseTo(1 / 6)
    // a weapon's own better roll stands, and its other keywords stay
    const [own] = score([gun({ S: 1, kw: { anti: ["MONSTER", 2] } })], "MONSTER")
    expect(own.wound).toBeCloseTo(5 / 6)
    const [both] = score([gun({ S: 1, kw: { anti: ["VEHICLE", 4] } })], "VEHICLE")
    expect(both.wound).toBeCloseTo(3 / 6)
  })

  it("applies a core ability a rule granted", () => {
    const u = unit({ rules: ["lance"] })
    const charged = row(u, opts({ flags: { charged: true } }), rules, "Blade")
    expect(charged.wound).toBeCloseTo(4 / 6)
    expect(charged.notes).toEqual(["Lances", "Lance"])
  })
})
