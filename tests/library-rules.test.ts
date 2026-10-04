/**
 * The rules added to the library since the POC's set (app/.server/seed/library.ts):
 * each one does what its wording says, and only then.
 */
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { LIBRARY_RULES } from "~/.server/seed/library"
import { attackerList, attackUnit, MOD0 } from "~/domain/engine"
import { describeRule } from "~/domain/fx"
import { availableMarks, effectiveOpts, ruleState, situations } from "~/domain/ledger"
import { defaultOpts } from "~/domain/options"
import { Fx, type Opts, Rule, type RuleBook, type Target, type Unit, type Weapon } from "~/domain/schema"

const rules: RuleBook = Object.fromEntries(LIBRARY_RULES.map((r) => [r.id, r.rule]))

const gun = (over: Partial<Weapon> = {}): Weapon => ({ nm: "Gun", t: "r", n: 5, A: 2, sk: 3, S: 5, AP: 1, D: 1, kw: {}, ...over })
const blade = (over: Partial<Weapon> = {}): Weapon => ({ nm: "Blade", t: "m", n: 5, A: 3, sk: 3, S: 5, AP: 1, D: 1, kw: {}, ...over })
const unit = (id: string, over: Partial<Unit> = {}): Unit => ({ id, nm: id, pts: 100, models: 5, kw: ["INFANTRY"], rules: [], w: [gun(), blade()], ...over })
const target = (over: Partial<Target> = {}): Target => ({ id: "t", nm: "Target", pts: 100, T: 4, Sv: 3, inv: 0, W: 2, N: 5, fnp: 0, dr: 0, kw: "INFANTRY", cls: "inf", ...over })

const opts = (flags: Record<string, boolean> = {}, mods: Opts["mods"] = {}): Opts => ({ ...defaultOpts(), combine: false, flags: { charged: true, ...flags }, mods })
const run = (u: Unit, all: Array<Unit>, o: Opts, t = target()) => attackUnit(u, t, o, { rules, units: all })
const row = (u: Unit, all: Array<Unit>, o: Opts, weapon: string, t = target()) => run(u, all, o, t).rows.find((r) => r.w.nm.endsWith(weapon))!
const allUnits = (mod: Partial<typeof MOD0>) => ({ all: { ...MOD0, ...mod } })

describe("the library's own rules", () => {
  it("are well-formed: every rule and every effect clause decodes strictly", () => {
    const strict = { onExcessProperty: "error" as const }
    for (const r of LIBRARY_RULES) {
      expect(() => Schema.decodeUnknownSync(Rule, strict)(r.rule), r.id).not.toThrow()
      for (const e of r.rule.fx ?? []) expect(() => Schema.decodeUnknownSync(Fx, strict)(e), r.id).not.toThrow()
      expect(r.rule.dmg && describeRule(r.rule), r.id).not.toMatch(/nothing|no effect/i)
    }
    expect(new Set(LIBRARY_RULES.map((r) => r.id)).size).toBe(LIBRARY_RULES.length)
  })
})

describe("Chaos Space Marines", () => {
  it("Despoilers: full hit re-rolls, but only after a Dark Pact, and the leader shares them", () => {
    const lord = unit("lord", { grp: "A", role: "Leader", models: 1 })
    const terminators = unit("terminators", { grp: "A", role: "Bodyguard", rules: ["despoilers"] })
    const all = [lord, terminators]
    expect(row(terminators, all, opts(), "Gun").hitChance).toBeCloseTo(4 / 6)
    expect(row(terminators, all, opts({ darkpact: true }), "Gun").hitChance).toBeCloseTo(4 / 6 + (2 / 6) * (4 / 6))
    expect(row(lord, all, opts({ darkpact: true }), "Blade").hitChance).toBeCloseTo(4 / 6 + (2 / 6) * (4 / 6))
    expect(ruleState(rules.despoilers, "terminators", "despoilers", opts())).toBe("idle")
    expect(ruleState(rules.despoilers, "terminators", "despoilers", opts({ darkpact: true }))).toBe("on")
  })

  it("Daemonforge: re-roll wound rolls of 1 after a Dark Pact", () => {
    const defiler = unit("defiler", { rules: ["daemonforge"], kw: ["VEHICLE"] })
    const before = row(defiler, [defiler], opts(), "Gun")
    const after = row(defiler, [defiler], opts({ darkpact: true }), "Gun")
    expect(after.wound! / before.wound!).toBeCloseTo(7 / 6)
    expect(after.hitChance).toBeCloseTo(before.hitChance!)
  })

  it("Stabilisation Talons: ranged attacks ignore −1 to hit and cover, keep a +1, and melee is untouched", () => {
    const havocs = unit("havocs", { rules: ["stabilisation-talons"] })
    const plain = unit("plain")
    const clean = row(havocs, [havocs], opts(), "Gun")
    const penalised = opts({}, allUnits({ hit: -1, cover: true }))
    expect(row(havocs, [havocs], penalised, "Gun").dealt).toBeCloseTo(clean.dealt!)
    expect(row(plain, [plain], penalised, "Gun").dealt).toBeLessThan(clean.dealt!)
    // the penalty still applies in melee, and a bonus still counts at range
    expect(row(havocs, [havocs], penalised, "Blade").hitChance).toBeCloseTo(3 / 6)
    expect(row(havocs, [havocs], opts({}, allUnits({ hit: 1 })), "Gun").hitChance).toBeCloseTo(5 / 6)
    // it is only named in the notes when it did something
    expect(clean.notes).not.toContain("Stabilisation Talons")
    expect(row(havocs, [havocs], penalised, "Gun").notes?.join(" ")).toMatch(/Stabilisation Talons: ignores/)
  })

  it("Master of Mechanisms: +1 to hit for Vehicles only, while the Warpsmith's mark is on", () => {
    const warpsmith = unit("warpsmith", { rules: ["master-of-mechanisms"], models: 1 })
    const vindicator = unit("vindicator", { kw: ["VEHICLE"] })
    const legionaries = unit("legionaries")
    const all = [warpsmith, vindicator, legionaries]
    const on = opts({ mechanisms: true })
    expect(row(vindicator, all, opts(), "Gun").hitChance).toBeCloseTo(4 / 6)
    expect(row(vindicator, all, on, "Gun").hitChance).toBeCloseTo(5 / 6)
    expect(row(legionaries, all, on, "Gun").hitChance).toBeCloseTo(4 / 6)
    expect(row(warpsmith, all, on, "Gun").hitChance).toBeCloseTo(4 / 6)
    expect(availableMarks(all, rules)).toEqual([
      { key: "mechanisms", label: "Tended by the Warpsmith", hint: "Master of Mechanisms: +1 to hit for the Vehicle he chose.", by: "warpsmith" }
    ])
    // in a list without a Warpsmith the mark can't be set, so it is forced off
    expect(effectiveOpts({ units: [vindicator], rules }, on).flags.mechanisms).toBe(false)
  })

  it("Headlong Destruction: +1 AP against the closest enemy, for the whole attached unit", () => {
    const morne = unit("morne", { grp: "D", role: "Leader", models: 1, rules: ["headlong-destruction"] })
    const terminators = unit("terminators", { grp: "D", role: "Bodyguard" })
    const all = [morne, terminators]
    const far = row(terminators, all, opts(), "Gun")
    const near = row(terminators, all, opts({ closest: true }), "Gun")
    // AP 1 → 2 against a 3+ save: fail chance 3/6 → 4/6
    expect(far.fail).toBeCloseTo(3 / 6)
    expect(near.fail).toBeCloseTo(4 / 6)
    expect(row(morne, all, opts({ closest: true }), "Blade").fail).toBeCloseTo(4 / 6)
  })

  it("Architect of Ruin: only Morne's own attacks re-roll wounds against his hated foe", () => {
    const morne = unit("morne", { grp: "D", role: "Leader", models: 1, rules: ["architect-of-ruin"] })
    const terminators = unit("terminators", { grp: "D", role: "Bodyguard" })
    const all = [morne, terminators]
    const combined = attackerList(all, { combine: true })[0]
    const off = run(combined, all, { ...opts(), combine: true })
    const on = run(combined, all, { ...opts({ hatedfoe: true }), combine: true })
    const wound = (r: typeof on, name: string) => r.rows.find((x) => x.w.nm === name)!.wound!
    expect(wound(on, "morne: Blade")).toBeGreaterThan(wound(off, "morne: Blade"))
    expect(wound(on, "terminators: Blade")).toBeCloseTo(wound(off, "terminators: Blade"))
  })

  it("adds its conditions to the situation switches of a list that has them", () => {
    const withRules = [unit("terminators", { rules: ["despoilers"] }), unit("morne", { rules: ["headlong-destruction"] }), unit("defiler", { rules: ["daemonforge"] })]
    const keys = situations(withRules, rules).map((s) => s.key)
    expect(keys).toEqual(["charged", "stationary", "objective", "char", "selfObj", "darkpact", "closest"])
    expect(situations([unit("plain")], rules).map((s) => s.key)).toEqual(["charged", "stationary", "objective", "char", "selfObj"])
  })
})

describe("Adeptus Custodes", () => {
  it("Stand Vigil: re-roll wound rolls of 1, or the whole roll on an objective", () => {
    const guard = unit("guard", { rules: ["stand-vigil"] })
    const plain = unit("plain")
    const base = row(plain, [plain], opts(), "Blade").wound!
    const ones = row(guard, [guard], opts(), "Blade").wound!
    const all = row(guard, [guard], opts({ selfObj: true }), "Blade").wound!
    // S5 into T4 wounds on 3+
    expect(base).toBeCloseTo(4 / 6)
    expect(ones).toBeCloseTo((4 / 6) * (7 / 6))
    expect(all).toBeCloseTo(4 / 6 + (2 / 6) * (4 / 6))
  })

  it("Captain-General: the led unit ignores penalties to hit in melee and at range", () => {
    const trajann = unit("trajann", { grp: "C", role: "Leader", models: 1, rules: ["captain-general"] })
    const wardens = unit("wardens", { grp: "C", role: "Bodyguard" })
    const others = unit("others")
    const all = [trajann, wardens, others]
    const penalised = opts({}, allUnits({ hit: -1, cover: true }))
    expect(row(wardens, all, penalised, "Blade").hitChance).toBeCloseTo(4 / 6)
    expect(row(wardens, all, penalised, "Gun").hitChance).toBeCloseTo(4 / 6)
    expect(row(others, all, penalised, "Blade").hitChance).toBeCloseTo(3 / 6)
    expect(row(others, all, penalised, "Gun").hitChance).toBeCloseTo(2 / 6)
  })

  it("Purity of Execution: Devastating Wounds at range, against Psykers only", () => {
    const prosecutors = unit("prosecutors", { rules: ["purity-of-execution"] })
    const psyker = target({ kw: "INFANTRY PSYKER", Sv: 2 })
    const vsPsyker = row(prosecutors, [prosecutors], opts(), "Gun", psyker)
    const vsOther = row(prosecutors, [prosecutors], opts(), "Gun", target({ Sv: 2 }))
    expect(vsPsyker.notes).toContain("Devastating")
    expect(vsPsyker.dealt).toBeGreaterThan(vsOther.dealt!)
    expect(row(prosecutors, [prosecutors], opts(), "Blade", psyker).notes).not.toContain("Devastating")
  })
})

describe("Astra Militarum", () => {
  it("Daring Recon: every unit's ranged attacks re-roll hit rolls of 1 against the spotted unit, and melee doesn't", () => {
    const sentinels = unit("sentinels", { rules: ["daring-recon"], models: 1, kw: ["VEHICLE"] })
    const tank = unit("tank", { kw: ["VEHICLE"] })
    const all = [sentinels, tank]
    const on = opts({ recon: true })
    // BS 3+: 4/6 to hit, and re-rolling the 1s adds 1/6 × 4/6
    expect(row(tank, all, opts(), "Gun").hitChance).toBeCloseTo(4 / 6)
    expect(row(tank, all, on, "Gun").hitChance).toBeCloseTo((4 / 6) * (7 / 6))
    expect(row(sentinels, all, on, "Gun").hitChance).toBeCloseTo((4 / 6) * (7 / 6))
    expect(row(tank, all, on, "Blade").hitChance).toBeCloseTo(4 / 6)
    expect(availableMarks(all, rules).map((m) => m.key)).toEqual(["recon"])
  })

  it("Rearm, Reload, Fire: Sustained Hits 1 on Heavy weapons, only under an Order and stationary", () => {
    const gunline = [gun({ nm: "Bombast field gun", kw: { heavy: 1, blast: 1 } }), gun({ nm: "Lasgun", kw: { rf: 1 } })]
    const battery = unit("battery", { rules: ["rearm-reload-fire"], w: gunline })
    const all = [battery]
    const sus = (flags: Record<string, boolean>, weapon: string) => row(battery, all, opts(flags), weapon).susExtra ?? 0
    expect(sus({ order: true, stationary: true }, "Bombast field gun")).toBeGreaterThan(0)
    expect(sus({ order: true, stationary: true }, "Lasgun")).toBe(0)
    expect(sus({ stationary: true }, "Bombast field gun")).toBe(0)
    expect(sus({ order: true }, "Bombast field gun")).toBe(0)
    expect(ruleState(rules["rearm-reload-fire"], "battery", "rearm-reload-fire", opts())).toBe("idle")
    expect(ruleState(rules["rearm-reload-fire"], "battery", "rearm-reload-fire", opts({ order: true }))).toBe("on")
    expect(situations(all, rules).map((s) => s.key)).toContain("order")
  })
})
