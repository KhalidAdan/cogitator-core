/** The pure domain helpers: option intents, the matrix view model, weapon keywords, rule effects in words. */
import { describe, expect, it } from "vitest"
import { listRuleBook, notInLibrary, translateRequest } from "~/domain/book"
import { MOD0 } from "~/domain/engine"
import { describeFx, describeRule } from "~/domain/fx"
import { keywordsFromInput, keywordsToInput, keywordText, parseWeaponKeywords } from "~/domain/keywords"
import { availableMarks, effectiveOpts, findings, heat, isEfficient, matrix, ruleState } from "~/domain/ledger"
import { applyIntent, defaultOpts, intentFromForm } from "~/domain/options"
import type { RuleBook, Target, Unit } from "~/domain/schema"
import seed from "~/.server/seed/poc-seed.json"
import { pocCophasta } from "./helpers/poc"

const rules = seed.rules as unknown as RuleBook
const targets = seed.targets as unknown as Array<Target>
const list = (id: string) => seed.lists.find((l) => l.id === id)! as unknown as { units: Array<Unit>; rules: RuleBook; groups: Record<string, { nm: string; short: string }> }
const form = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe("option intents", () => {
  const units = list("builtin-burning-v2").units
  const apply = (fields: Record<string, string>, from = defaultOpts()) => applyIntent(from, intentFromForm(form(fields))!, units)

  it("sets the phase and ignores values it doesn’t know", () => {
    expect(apply({ intent: "set", key: "phase", value: "melee" }).phase).toBe("melee")
    expect(apply({ intent: "set", key: "phase", value: "sideways" }).phase).toBe("all")
    expect(apply({ intent: "set", key: "combine", value: "false" }).combine).toBe(false)
  })

  it("treats an unchecked checkbox (no value posted) as off", () => {
    expect(apply({ intent: "flag", key: "charged" }).flags.charged).toBe(false)
    expect(apply({ intent: "flag", key: "riven", value: "true" }).flags.riven).toBe(true)
    expect(apply({ intent: "set", key: "enh" }).enh).toBe(false)
  })

  it("keeps modifiers per scope, clamps them, and drops a scope once it is empty", () => {
    let o = apply({ intent: "mod", scope: "all", key: "hit", value: "5" })
    expect(o.mods.all).toEqual({ ...MOD0, hit: 1 })
    o = apply({ intent: "mod", scope: "fuegan", key: "rrWound", value: "full" }, o)
    expect(Object.keys(o.mods).sort()).toEqual(["all", "fuegan"])
    o = apply({ intent: "mod", scope: "all", key: "hit", value: "0" }, o)
    expect(Object.keys(o.mods)).toEqual(["fuegan"])
    expect(apply({ intent: "mod-clear", scope: "fuegan" }, o).mods).toEqual({})
  })

  it("switches a rule off for one owner and back on", () => {
    const off = apply({ intent: "rule-switch", key: "prince-yriel:piratical-hero" })
    expect(off.off).toEqual({ "prince-yriel:piratical-hero": true })
    expect(apply({ intent: "rule-switch", key: "prince-yriel:piratical-hero", on: "true" }, off).off).toEqual({})
  })

  it("applies the presets but keeps the phase and the attached-unit view", () => {
    const from = { ...defaultOpts(), phase: "ranged" as const, combine: false, flags: { charged: false, riven: true } }
    const bare = apply({ intent: "preset", value: "bare" }, from)
    expect(bare.phase).toBe("ranged")
    expect(bare.combine).toBe(false)
    expect(bare.off["prince-yriel:piratical-hero"]).toBe(true)
    expect(Object.keys(bare.off)).toHaveLength(units.length * 3)
    expect(apply({ intent: "preset", value: "table" }, bare)).toEqual({ ...defaultOpts(), phase: "ranged", combine: false })
  })

  it("takes Strength, Attacks and Damage in the modifier bar, within −1 to +2", () => {
    const i = intentFromForm(form({ intent: "mod", scope: "all", key: "d", value: "1" }))
    expect(i).toEqual({ intent: "mod", scope: "all", key: "d", value: "1" })
    const o = applyIntent(defaultOpts(), i!, [])
    expect(o.mods.all).toMatchObject({ d: 1 })
    expect(applyIntent(o, { intent: "mod", scope: "all", key: "s", value: "9" }, []).mods.all).toMatchObject({ s: 2, d: 1 })
  })

  it("takes an Order by its rule id, and nothing else", () => {
    const set = (value: string) => applyIntent(defaultOpts(), { intent: "mod", scope: "squad", key: "order", value }, []).mods.squad
    expect(set("take-aim")).toMatchObject({ order: "take-aim" })
    expect(set("<script>")?.order ?? "").toBe("")
  })

  it("rejects posts that aren’t intents", () => {
    expect(intentFromForm(form({ intent: "set", key: "units", value: "[]" }))).toBeNull()
    expect(intentFromForm(form({ intent: "mod", scope: "all", key: "nope", value: "1" }))).toBeNull()
    expect(intentFromForm(form({}))).toBeNull()
  })
})

describe("the matrix view model", () => {
  const v2 = list("builtin-burning-v2")
  const ledger = { units: v2.units, rules: { ...rules, ...v2.rules }, targets, opts: defaultOpts(), groups: v2.groups }

  it("orders targets infantry first and counts coverage at the 65% line", () => {
    const m = matrix(ledger)
    expect(m.targets).toHaveLength(19)
    expect(m.infantry).toBe(9)
    expect(m.targets.slice(0, 9).every((t) => t.cls === "inf")).toBe(true)
    expect(m.rows).toHaveLength(16)
    // counted by the whole number the cell shows, so a cell reading 65 counts
    m.targets.forEach((_, k) => expect(m.coverage[k]).toBe(m.rows.filter((r) => Math.round(r.cells[k].roi) >= 65).length))
    expect([isEfficient(64.49), isEfficient(64.5), isEfficient(65)]).toEqual([false, true, true])
    expect([heat(64.6).efficient, heat(64.4).efficient]).toEqual([true, false])
  })

  it("reproduces the handoff’s headline numbers for the v2 list", () => {
    const m = matrix(ledger)
    const yv = m.rows.find((r) => r.unit.id === "grp-D")!
    const at = (id: string) => Math.round(yv.cells[m.targets.findIndex((t) => t.id === id)].roi)
    // "Yriel + Voidscarred is the best answer to almost every elite target"
    expect([at("terminators"), at("intercessors"), at("canoptek-wraiths"), at("ctan")]).toEqual([107, 104, 64, 55])
    // "points-weighted average return 49.4%" and "1,085 of 2,000 pts in units averaging 50%+"
    const pts = m.rows.reduce((s, r) => s + r.unit.pts, 0)
    expect(pts).toBe(2000)
    expect((m.rows.reduce((s, r) => s + r.avg * r.unit.pts, 0) / pts).toFixed(1)).toBe("49.4")
    expect(m.rows.filter((r) => r.avg >= 50).reduce((s, r) => s + r.unit.pts, 0)).toBe(1085)
  })

  it("writes the three findings: the gap, the prime trigger, the enhancement tax", () => {
    const f = findings(ledger, matrix(ledger))
    expect(f.map((x) => x.kind)).toEqual(["gap", "prime", "enhancement"])
    const gap = f[0]
    // "Canoptek Wraiths, Mutalith and C'tan have no answer at 65%"
    expect(gap.kind === "gap" && gap.others).toBe(2)
  })

  it("only offers the target marks a unit in the list can set", () => {
    expect(availableMarks(v2.units, ledger.rules).map((m) => m.key).sort()).toEqual(["guide", "quarry", "riven", "spiritmark", "web"])
    const cophasta = pocCophasta() as unknown as ReturnType<typeof list>
    expect(availableMarks(cophasta.units, { ...rules, ...cophasta.rules }).map((m) => m.label).sort()).toEqual(["Hailstrike-marked", "Shattered"])
    // a mark left on from another list is forced off where nobody can set it
    const o = effectiveOpts({ units: cophasta.units, rules }, { ...defaultOpts(), flags: { riven: true, shattered: true } })
    expect(o.flags).toMatchObject({ riven: false, shattered: true })
  })

  it("gives every rule chip a state", () => {
    const o = defaultOpts()
    expect(ruleState(rules["piratical-hero"], "yriel", "piratical-hero", o)).toBe("on")
    expect(ruleState(rules["piratical-hero"], "yriel", "piratical-hero", { ...o, off: { "yriel:piratical-hero": true } })).toBe("off")
    expect(ruleState(rules["assassins-eye"], "x", "assassins-eye", o)).toBe("idle")
    expect(ruleState(rules["assassins-eye"], "x", "assassins-eye", { ...o, flags: { char: true } })).toBe("on")
    expect(ruleState(rules["fury-void"], "kharseth", "fury-void", o)).toBe("mark-off")
    expect(ruleState(rules["voidstone"], "x", "voidstone", o)).toBe("note")
  })
})

describe("weapon keywords", () => {
  it("parses roster and Wahapedia ability lists alike", () => {
    expect(parseWeaponKeywords("assault, melta 3")).toEqual({ melta: 3 })
    expect(parseWeaponKeywords("Anti-Infantry 2+, Psychic")).toEqual({ anti: ["INFANTRY", 2], psychic: 1 })
    expect(parseWeaponKeywords("LETHAL HITS: non-MONSTER/VEHICLE, Rapid Fire 1")).toEqual({
      lethal: 1,
      rf: 1,
      when: { lethal: { not: ["MONSTER", "VEHICLE"] } }
    })
    expect(parseWeaponKeywords("Blast 2, Cleave D3, close-quarters, c'tan power")).toEqual({ blast: 2, cleave: 2, pistol: 1, other: ["c'tan power"] })
    expect(parseWeaponKeywords("-")).toEqual({})
  })

  it("round-trips the compact form used in the loadout editor", () => {
    const kw = parseWeaponKeywords("Lethal Hits, Sustained Hits 1, Melta 2, Anti-Infantry 2+, Twin-linked")
    expect(keywordsToInput(kw)).toBe("lethal tl sus1 melta2 anti-infantry2")
    expect(keywordsFromInput(keywordsToInput(kw))).toEqual(kw)
    expect(keywordText({ kw })).toBe("Lethal Hits, Sustained 1, Twin-linked, Melta 2, Anti-infantry 2+")
  })

  it("keeps every Anti ability a weapon has, stored as a pair when there is one", () => {
    const kw = parseWeaponKeywords("anti-daemon 4+, anti-infantry 5+, devastating wounds, psychic")
    expect(kw.anti).toEqual({ DAEMON: 4, INFANTRY: 5 })
    expect(keywordText({ kw })).toBe("Devastating, Anti-daemon 4+, Anti-infantry 5+, Psychic")
    expect(keywordsToInput(kw)).toBe("dev psychic anti-daemon4 anti-infantry5")
    expect(keywordsFromInput(keywordsToInput(kw))).toEqual(kw)
    // the same keyword twice keeps the better roll
    expect(parseWeaponKeywords("Anti-Vehicle 4+, Anti-Vehicle 2+").anti).toEqual(["VEHICLE", 2])
    // lists saved before could name several keywords at one roll
    expect(keywordText({ kw: { anti: ["MONSTER/VEHICLE", 3] } })).toBe("Anti-monster 3+, Anti-vehicle 3+")
  })
})

describe("rule effects in words", () => {
  it("describes clauses and whole rules", () => {
    expect(describeFx({ phase: "ranged", vs: { only: ["MONSTER", "VEHICLE"] }, rrHit: "all", rrWound: "all", rrDmg: true })).toBe(
      "ranged, vs monster/vehicle: re-roll hits, re-roll wounds, re-roll damage"
    )
    expect(describeRule(rules["piratical-hero"])).toBe("+1 to hit, Sustained Hits 1")
    expect(describeRule(rules["voidstone"])).toBe("No effect on damage")
  })
})

describe("a list's rule book", () => {
  it("leaves the built-in list's rules as they are, so the calibration can't move", () => {
    const v2 = list("builtin-burning-v2")
    expect(listRuleBook(rules, v2.rules)).toEqual({ ...rules, ...v2.rules })
  })

  it("reads a rule the importer didn't know from the library, once the library has one of that name", () => {
    const own: RuleBook = {
      "imp-daring-recon": { nm: "Daring Recon", src: "Datasheet", dmg: false, txt: "From the roster.", imported: true, todo: true },
      // the number is the rule's own: "Scouts 7" is Scouts
      "imp-daring-recon-2": { nm: "Daring Recon 2", src: "Datasheet", dmg: false, txt: "", imported: true },
      "imp-made-up": { nm: "Made Up", src: "Datasheet", dmg: false, txt: "", imported: true },
      // an army rule is filed with the list by the importer, never read onto a unit
      "imp-born-soldiers": { nm: "Born Soldiers", src: "Army rule", dmg: false, txt: "", imported: true }
    }
    const recon = { nm: "Daring Recon", src: "Datasheet", dmg: true, txt: "Re-roll hit rolls of 1 when shooting.", fx: [{ phase: "ranged" as const, rrHit: "ones" as const }] }
    const library: RuleBook = { ...rules, "daring-recon": recon, "born-soldiers": { nm: "Born Soldiers", src: "Army rule", dmg: true, txt: "", fx: [{ hit: 1 }] } }
    const book = listRuleBook(library, own)
    expect(book["imp-daring-recon"]).toEqual({ ...recon, lib: "daring-recon" })
    expect(book["imp-daring-recon-2"].lib).toBe("daring-recon")
    expect(book["imp-made-up"]).toBe(own["imp-made-up"])
    expect(book["imp-born-soldiers"]).toBe(own["imp-born-soldiers"])
    expect(book["daring-recon"]).toBe(recon)
  })
})

describe("rules a list has that the library doesn't", () => {
  const unit = (id: string, rules: Array<string>) => ({ id, nm: id.toUpperCase(), pts: 10, models: 1, rules, w: [] }) as unknown as Unit
  const units = [unit("khârn", ["imp-legendary-killer", "piratical-hero"]), unit("berzerkers", ["imp-murderous-charge", "imp-legendary-killer"])]
  const own: RuleBook = {
    "imp-legendary-killer": { nm: "Legendary Killer", src: "Leader", dmg: false, txt: "", imported: true, todo: true },
    "imp-murderous-charge": { nm: "Murderous Charge", src: "Datasheet", dmg: false, txt: "", imported: true },
    // a rule from the roster that no unit has any more is nobody's to translate
    "imp-left-over": { nm: "Left Over", src: "Datasheet", dmg: false, txt: "", imported: true, todo: true }
  }

  it("names each with the units that have it, and leaves out what the library has", () => {
    const found = notInLibrary(units, listRuleBook(rules, own))
    expect(found.map((x) => [x.rule.nm, x.units.map((u) => u.id)])).toEqual([
      ["Legendary Killer", ["khârn", "berzerkers"]],
      ["Murderous Charge", ["berzerkers"]]
    ])
    // once the library has one of that name, it's no longer missing
    const library: RuleBook = { ...rules, "legendary-killer": { nm: "Legendary Killer", src: "Leader", dmg: true, txt: "", fx: [{ rrHit: "ones" }] } }
    expect(notInLibrary(units, listRuleBook(library, own)).map((x) => x.rule.nm)).toEqual(["Murderous Charge"])
  })

  it("asks an agent to translate them by name, at the list's address, and to check the rest", () => {
    const found = notInLibrary(units, listRuleBook(rules, own)).filter((x) => x.rule.todo)
    const text = translateRequest({ name: "The Red Sands Remember", url: "https://khld.dev/cogitator-core/lists/L1" }, found)
    expect(text).toBe(
      "My Cogitator Core list “The Red Sands Remember” (https://khld.dev/cogitator-core/lists/L1) has a rule the damage engine doesn't model yet: Legendary Killer. Read the list with get_list. Translate it with save_rule, which saves a draft to the rules library, and any other rule there that isn't in the library but does change damage. Check each one with explain_matchup, then tell me what you modelled and anything you weren't sure of."
    )
  })
})
