/**
 * Hunter profiles. Some 11th edition weapons have a profile that can only target units with the keywords it names
 * ("HUNTER: MONSTER/VEHICLE"); before picking targets, the weapon picks one of its eligible profiles. 40k.app writes
 * the pair as "Melta Rifle" and "Melta Rifle - Hunter", Wahapedia as "… - Standard" and "… - Hunter", and neither
 * the roster file nor Wahapedia's export says which keywords.
 */
import { describe, expect, it } from "vitest"
import { parseRosterSync } from "~/.server/importer/roster"
import { seedData } from "~/.server/seed/Seed"
import { attackerList, attackUnit, combineUnits } from "~/domain/engine"
import { isHunterProfile, keywordText, profileBase, splitHunter } from "~/domain/keywords"
import { defaultOpts } from "~/domain/options"
import type { Opts, RuleBook, Target, Unit, Weapon } from "~/domain/schema"

const ctx = { library: {}, factionArmyRules: {}, detachmentRules: {}, detachmentUnitGrants: {} }

const profile = (name: string, melee: boolean, c: { A: string; sk: string; S: string; AP: string; D: string; kw?: string }) => `
  <profile name="${name}" typeName="${melee ? "Melee" : "Ranged"} Weapons"><characteristics>
    <characteristic name="Range">${melee ? "Melee" : "18&quot;"}</characteristic>
    <characteristic name="A">${c.A}</characteristic>
    <characteristic name="${melee ? "WS" : "BS"}">${c.sk}</characteristic>
    <characteristic name="S">${c.S}</characteristic>
    <characteristic name="AP">${c.AP}</characteristic>
    <characteristic name="D">${c.D}</characteristic>
    <characteristic name="Keywords">${c.kw ?? "-"}</characteristic>
  </characteristics></profile>`
const weapon = (name: string, n: number, profiles: string) => `<selection name="${name}" type="upgrade" number="${n}"><profiles>${profiles}</profiles></selection>`
const roster = (units: string) => `<?xml version="1.0" encoding="UTF-8"?>
<roster name="Hunters" xmlns="http://www.battlescribe.net/schema/rosterSchema"><forces><force name="Army Roster" catalogueName="Blood Angels"><selections>${units}</selections></force></forces></roster>`
const unitXml = (name: string, models: number, weapons: string, keyword = "Infantry") => `
<selection name="${name}" type="unit" number="1">
  <selections><selection name="${name.replace(/ Squad.*/, "")}" type="model" number="${models}">
    <profiles><profile name="${name}" typeName="Unit"><characteristics>
      <characteristic name="M">5&quot;</characteristic><characteristic name="T">6</characteristic><characteristic name="SV">3+</characteristic>
      <characteristic name="W">3</characteristic><characteristic name="LD">6+</characteristic><characteristic name="OC">1</characteristic>
    </characteristics></profile></profiles>
    <selections>${weapons}</selections>
  </selection></selections>
  <categories><category name="${keyword}"/></categories>
</selection>`

const RIFLE = { A: "1", sk: "3+", S: "10", AP: "-3", D: "D3+2", kw: "MELTA 2" }
const HUNTER = { A: "1", sk: "2+", S: "12", AP: "-3", D: "D3+2", kw: "MELTA 2" }
const eradicators = (rifle = "Melta Rifle", hunter = "Melta Rifle - Hunter", rifleKw = RIFLE.kw) =>
  unitXml(
    "Eradicator Squad with melta rifles",
    3,
    weapon(rifle, 3, profile(rifle, false, { ...RIFLE, kw: rifleKw })) +
      weapon(hunter, 3, profile(hunter, false, HUNTER)) +
      weapon("Bolt Pistol", 3, profile("Bolt Pistol", false, { A: "1", sk: "3+", S: "5", AP: "-1", D: "1", kw: "PISTOL" })) +
      weapon("Ceramite Fists", 3, profile("Ceramite Fists", true, { A: "3", sk: "3+", S: "5", AP: "0", D: "1" }))
  )
// not pistols here, so the pistol rule doesn't put them away beside the other gun
const STANDARD = { A: "1", sk: "2+", S: "7", AP: "-2", D: "1" }
const SUPERCHARGE = { A: "1", sk: "2+", S: "8", AP: "-3", D: "2", kw: "HAZARDOUS" }
const captain = unitXml(
  "Captain",
  1,
  weapon("Plasma Pistol", 1, profile("Plasma Pistol - Standard", false, STANDARD) + profile("Plasma Pistol - Supercharge", false, SUPERCHARGE)) +
    weapon("Fury - Witchfire", 1, profile("Fury - Witchfire", false, { A: "3", sk: "2+", S: "5", AP: "-1", D: "2", kw: "PSYCHIC" })) +
    weapon("Fury - Focused Witchfire", 1, profile("Fury - Focused Witchfire", false, { A: "3", sk: "2+", S: "6", AP: "-2", D: "3", kw: "PSYCHIC, HAZARDOUS" })) +
    weapon("Power Fist", 1, profile("Power Fist", true, { A: "5", sk: "2+", S: "8", AP: "-2", D: "2" }))
)

const read = (units: string) => parseRosterSync(roster(units), "", ctx).units
const named = (u: Unit, nm: string) => u.w.find((w) => w.nm === nm)!

/** Total Obliteration, as the library has it: re-roll the damage roll. */
const rules: RuleBook = { "total-obliteration": { nm: "Total Obliteration", src: "Datasheet", dmg: true, txt: "", fx: [{ rrDmg: true }] } }
const charged: Opts = { ...defaultOpts(), flags: { ...defaultOpts().flags, charged: true } }
const target = (id: string): Target => seedData.targets.find((t) => t.id === id)!
const score = (u: Unit, id: string, book: RuleBook = rules) => attackUnit(u, target(id), charged, { rules: book, units: [u] })
const used = (u: Unit, id: string) => score(u, id).rows.filter((r) => !r.skipped).map((r) => r.w.nm)

describe("names", () => {
  it("knows a Hunter profile by its name, and the weapon it belongs to", () => {
    for (const nm of ["Melta Rifle - Hunter", "Melta Rifle (Hunter)", "Melta rifle – hunter", "Hunter"]) expect(isHunterProfile(nm), nm).toBe(true)
    for (const nm of ["Melta Rifle", "Hunter-killer Missile", "Headhunter", "Tank Hunter Shell"]) expect(isHunterProfile(nm), nm).toBe(false)
    expect(profileBase("Melta Rifle - Hunter")).toBe("Melta Rifle")
    expect(profileBase("Melta Rifle (Hunter)")).toBe("Melta Rifle")
    expect(profileBase("Plasma Pistol - Supercharge")).toBe("Plasma Pistol")
    expect(profileBase("Melta Rifle")).toBeNull()
    expect(profileBase("Neuro Disruptor (Felarch)")).toBeNull()
  })

  it("reads the keywords a Hunter line names, and leaves the abilities", () => {
    expect(splitHunter("MELTA 2, HUNTER: MONSTER/VEHICLE")).toEqual({ rest: "MELTA 2", targets: ["MONSTER", "VEHICLE"] })
    expect(splitHunter("Hunter: Titanic")).toEqual({ rest: "", targets: ["TITANIC"] })
    expect(splitHunter("SUSTAINED HITS 1: non-MONSTER/VEHICLE, ONE SHOT")).toEqual({ rest: "SUSTAINED HITS 1: non-MONSTER/VEHICLE, ONE SHOT", targets: null })
  })
})

describe("the importer", () => {
  it("reads a weapon and its Hunter profile as one weapon that picks a profile", () => {
    const [u] = read(eradicators())
    const rifle = named(u, "Melta Rifle")
    const hunter = named(u, "Melta Rifle - Hunter")
    expect(rifle.alt).toBe("p0:melta-rifle")
    expect(hunter.alt).toBe(rifle.alt)
    expect(rifle.vs).toBeUndefined()
    expect(hunter.vs).toEqual({ only: ["MONSTER", "VEHICLE"] })
    expect(keywordText(hunter)).toBe("Melta 2, Monster or Vehicle units only, pick one profile")
    // nothing else on the unit is part of the choice
    expect(u.w.filter((w) => w.alt).map((w) => w.nm)).toEqual(["Melta Rifle", "Melta Rifle - Hunter"])
    expect(u.w.every((w) => !("hunter" in w))).toBe(true)
  })

  it("reads the pair whichever way it is written", () => {
    for (const [rifle, hunter] of [["Melta Rifle", "Melta Rifle (Hunter)"], ["Melta Rifle - Standard", "Melta Rifle - Hunter"], ["Melta rifle", "Melta Rifle - Hunter"]]) {
      const [u] = read(eradicators(rifle, hunter))
      expect(named(u, rifle).alt, hunter).toBe("p0:melta-rifle")
      expect(named(u, hunter).alt, hunter).toBe("p0:melta-rifle")
      expect(named(u, hunter).vs, hunter).toEqual({ only: ["MONSTER", "VEHICLE"] })
    }
    // both profiles under the one selection
    const [multi] = read(unitXml("Eradicator Squad", 3, weapon("Melta Rifle", 3, profile("Melta Rifle", false, RIFLE) + profile("Melta Rifle - Hunter", false, HUNTER))))
    expect(multi.w.map((w) => [w.alt, w.vs?.only?.join("/")])).toEqual([["p0:melta-rifle", undefined], ["p0:melta-rifle", "MONSTER/VEHICLE"]])
  })

  it("takes the keywords from the file when it names them, on either row", () => {
    const [u] = read(eradicators("Melta Rifle", "Melta Rifle - Hunter", "MELTA 2, HUNTER: TITANIC/TOWERING"))
    expect(named(u, "Melta Rifle - Hunter").vs).toEqual({ only: ["TITANIC", "TOWERING"] })
    expect(named(u, "Melta Rifle").vs).toBeUndefined()
    expect(named(u, "Melta Rifle").kw).toEqual({ melta: 2 })
  })

  it("leaves a melee weapon of the same name out of a ranged weapon's profiles", () => {
    const [u] = read(unitXml("Nob", 1, weapon("Smasha", 1, profile("Smasha", true, RIFLE)) + weapon("Smasha - Hunter", 1, profile("Smasha - Hunter", false, HUNTER))))
    expect(named(u, "Smasha").alt).toBeUndefined()
    expect(named(u, "Smasha - Hunter").vs).toEqual({ only: ["MONSTER", "VEHICLE"] })
  })

  it("reads “Weapon - A” and “Weapon - B” pairs as it always has", () => {
    const [u] = read(captain)
    expect(u.w.map((w) => [w.nm, w.alt ?? null, w.vs ?? null])).toEqual([
      ["Plasma Pistol - Standard", "p0:plasma-pistol", null],
      ["Plasma Pistol - Supercharge", "p0:plasma-pistol", null],
      ["Fury - Witchfire", "p0:fury", null],
      ["Fury - Focused Witchfire", "p0:fury", null],
      ["Power Fist", null, null]
    ])
  })
})

describe("the engine", () => {
  const erad = (): Unit => ({ ...read(eradicators())[0], pts: 100, rules: ["total-obliteration"] })

  it("leaves a Hunter profile out against a unit without its keywords", () => {
    for (const id of ["intercessors", "cadians", "terminators"]) {
      const hunter = score(erad(), id).rows.find((r) => r.w.nm === "Melta Rifle - Hunter")!
      expect(hunter.skipped, id).toBe("Can only target Monster or Vehicle units")
      expect(hunter.dealt ?? 0, id).toBe(0)
      expect(used(erad(), id), id).toEqual(["Melta Rifle", "Ceramite Fists"])
    }
  })

  it("fires one profile against a unit with them: the better one", () => {
    for (const id of ["land-raider", "rhino", "ctan", "dreadknight"]) {
      expect(used(erad(), id), id).toEqual(["Melta Rifle - Hunter", "Ceramite Fists"])
      const rows = score(erad(), id).rows
      expect(rows.find((r) => r.w.nm === "Melta Rifle")!.skipped, id).toBe("The other profile does more damage here")
      expect(rows.find((r) => r.w.nm === "Melta Rifle - Hunter")!.attacks, id).toBe(3)
    }
  })

  it("scores the Eradicators as the datasheet plays", () => {
    const roi = (id: string) => Math.round(score(erad(), id).roi)
    expect({ "land-raider": roi("land-raider"), rhino: roi("rhino"), intercessors: roi("intercessors"), ctan: roi("ctan") }).toEqual({
      "land-raider": 58,
      rhino: 47,
      intercessors: 36,
      ctan: 44
    })
  })

  it("keeps the restriction on a profile that isn't part of a choice, and inside an attached unit", () => {
    const only: Weapon = { nm: "Gun - Hunter", t: "r", n: 1, A: 1, sk: 3, S: 10, AP: 3, D: 3, kw: {}, vs: { only: ["MONSTER", "VEHICLE"] } }
    const u: Unit = { id: "u", nm: "Unit", pts: 100, models: 1, kw: ["INFANTRY"], rules: [], w: [only] }
    expect(score(u, "intercessors", {}).total).toBe(0)
    expect(score(u, "rhino", {}).total).toBeGreaterThan(0)
    const leader: Unit = { ...u, id: "l", nm: "Leader", grp: "A" }
    const joined = combineUnits("A", [leader, { ...erad(), grp: "A" }])
    expect(attackerList([leader, { ...erad(), grp: "A" }], { combine: true })).toHaveLength(1)
    const rows = (id: string) => attackUnit(joined, target(id), charged, { rules, units: [leader, erad()] }).rows.filter((r) => !r.skipped).map((r) => r.w.nm)
    expect(rows("intercessors")).toEqual(["Eradicator Squad with melta rifles: Melta Rifle", "Eradicator Squad with melta rifles: Ceramite Fists"])
    expect(rows("rhino")).toEqual(["Leader: Gun - Hunter", "Eradicator Squad with melta rifles: Melta Rifle - Hunter", "Eradicator Squad with melta rifles: Ceramite Fists"])
  })

  it("scores “Weapon - A” and “Weapon - B” pairs as it always has: the better profile against each target", () => {
    const [cap] = read(captain)
    const u: Unit = { ...cap, pts: 100 }
    for (const t of seedData.targets) {
      const r = attackUnit(u, t, charged, { rules: {}, units: [u] })
      for (const base of ["Plasma Pistol", "Fury"]) {
        const pair = r.rows.filter((x) => x.w.nm.startsWith(base))
        expect(pair.filter((x) => !x.skipped), `${base} into ${t.nm}`).toHaveLength(1)
        // each profile alone, with nothing to choose between
        const alone = pair.map((x) => attackUnit({ ...u, w: [{ ...x.w, alt: undefined }] }, t, charged, { rules: {}, units: [u] }).total)
        expect(pair.find((x) => !x.skipped)!.dealt, `${base} into ${t.nm}`).toBeCloseTo(Math.max(...alone))
      }
    }
  })
})
