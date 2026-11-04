/**
 * Real rosters, as 40k.app exported them (tests/fixtures/rosters; see the
 * README there). The importer reads each one, every rule in them that changes
 * damage is translated, and the matrix scores every unit. Against the
 * Wahapedia export, every unit finds its datasheet, and the weapons that
 * don't are named here: a new export, a new codex or a matcher change shows
 * up as a change to these lists.
 */
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { layerAt } from "~/.server/db/Db"
import { givenWeapon, importContext } from "~/.server/importer/context"
import { detachmentGrants, GIVES_A_WEAPON, type ImportContext, keepPrices, looksOffensive, NO_TEXT_EXPORT, parseRosterSync } from "~/.server/importer/roster"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { LIBRARY_RULES } from "~/.server/seed/library"
import { seed, seedData } from "~/.server/seed/Seed"
import { checkList } from "~/.server/wahapedia/check"
import { ENHANCEMENT_WEAPONS } from "~/.server/wahapedia/enhancement-weapons"
import { currentSnapshotId, enhancements } from "~/.server/wahapedia/queries"
import { Snapshots } from "~/.server/wahapedia/Snapshots"
import { parseSwap, type Swap } from "~/.server/wahapedia/swaps"
import type { Twin } from "~/.server/wahapedia/twins"
import { loadDirectory } from "~/.server/node/directory"
import { attackerList, attackUnit } from "~/domain/engine"
import { defaultOpts } from "~/domain/options"
import type { RuleBook, Unit } from "~/domain/schema"
import { norm } from "~/domain/text"

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
    counted: ["bolter-discipline"],
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

// ---------- weapons that are ranged and melee under one name ----------

describe("twin weapons", () => {
  const xml = readFileSync("tests/fixtures/rosters/ten-thousand-and-no-more.ros", "utf8")
  const twinOf = (name: string): Twin => {
    const profile = { A: 8, sk: 2, S: 10, AP: 2, D: 3, kw: {} }
    return { name, r: profile, m: profile }
  }
  const on = (unit: string, twin: Twin) => ({
    ...ctx,
    twin: (u: string, _faction: string, weapon: string) => (u === unit && weapon.toLowerCase().startsWith(twin.name.toLowerCase()) ? twin : undefined)
  })
  const rows = (c: ImportContext, unit: string) => parseRosterSync(xml, "", c).units.find((u) => u.nm === unit)!.w.map((w) => `${w.t}:${w.nm}×${w.n}`)

  it("add the melee row a roster left out, and say so", () => {
    const c = on("Contemptor-Galatus Dreadnought", twinOf("Galatus warblade"))
    expect(rows(ctx, "Contemptor-Galatus Dreadnought")).toEqual(["r:Galatus warblade×1"])
    expect(rows(c, "Contemptor-Galatus Dreadnought")).toEqual(["r:Galatus warblade×1", "m:Galatus warblade×1"])
    expect(parseRosterSync(xml, "", c).warnings).toContain("Contemptor-Galatus Dreadnought: the roster file leaves out its melee Galatus warblade, so that profile comes from Wahapedia.")
  })

  it("add the ranged row the same way, one for each model with the weapon", () => {
    expect(rows(on("Prosecutors", twinOf("Close combat weapon")), "Prosecutors")).toEqual(["r:Boltgun×4", "r:Close combat weapon×4", "m:Close combat weapon×4"])
  })

  it("leave a weapon alone when the roster has both rows", () => {
    const c = on("Custodian Guard A", twinOf("Guardian spear"))
    expect(rows(c, "Custodian Guard A")).toEqual(rows(ctx, "Custodian Guard A"))
    expect(parseRosterSync(xml, "", c).warnings).toEqual([NO_TEXT_EXPORT])
  })
})

// ---------- weapons an enhancement gives ----------

const GOBSHOT = "Warboss model only. This model has the following weapon:"
const gun = (name: string, A: number) =>
  `<profile name="${name}" typeName="Ranged Weapons"><characteristics><characteristic name="Range">24"</characteristic><characteristic name="A">${A}</characteristic>` +
  `<characteristic name="BS">5+</characteristic><characteristic name="S">5</characteristic><characteristic name="AP">0</characteristic><characteristic name="D">1</characteristic>` +
  `<characteristic name="Keywords">LETHAL HITS: non-MONSTER/VEHICLE</characteristic></characteristics></profile>`
/** A Deffkilla Wartrike as 40k.app writes one: the enhancement as an ability, then its own gun. `extra`: more selections. */
const wartrike = (enhancement: string, text: string, extra = "") => `<roster name="Brakes Iz' for Grots"><forces><force catalogueName="Orks"><selections>
  <selection name="Deffkilla Wartrike A" type="model" number="1"><profiles>
    <profile name="Deffkilla Wartrike" typeName="Unit"><characteristics><characteristic name="M">12"</characteristic><characteristic name="T">6</characteristic>
      <characteristic name="SV">4+</characteristic><characteristic name="W">8</characteristic><characteristic name="LD">7+</characteristic><characteristic name="OC">2</characteristic></characteristics></profile>
    <profile name="Enhancement: ${enhancement}" typeName="Abilities"><characteristics><characteristic name="Description">${text}</characteristic></characteristics></profile>
  </profiles><selections>
    <selection name="Boomstikks" type="upgrade" number="1"><profiles>${gun("Boomstikks", 6)}</profiles></selection>${extra}
  </selections></selection></selections></force></forces></roster>`

describe("weapons an enhancement gives", () => {
  const withWeapons = { ...ctx, enhancementWeapon: givenWeapon }
  const rows = (xml: string, c: ImportContext, unit: string) => parseRosterSync(xml, "", c).units.find((u) => u.nm === unit)!.w.map((w) => `${w.t}:${w.nm}×${w.n}`)

  it("give the bearer the weapon the roster file leaves out, and say so", () => {
    const xml = wartrike("Da Gobshot Thunderbuss", GOBSHOT)
    expect(rows(xml, ctx, "Deffkilla Wartrike A")).toEqual(["r:Boomstikks×1"])
    const got = parseRosterSync(xml, "", withWeapons)
    expect(rows(xml, withWeapons, "Deffkilla Wartrike A")).toEqual(["r:Boomstikks×1", "r:Da Gobshot Thunderbuss×1"])
    // 24", A6, BS4+, S7, AP-2, D2, Lethal Hits against anything but a Monster or Vehicle, Rapid Fire 6
    expect(got.units[0].w[1]).toMatchObject({ A: 6, sk: 4, S: 7, AP: 2, D: 2, kw: { lethal: 1, rf: 6, when: { lethal: { not: ["MONSTER", "VEHICLE"] } } } })
    expect(got.units[0].enh?.nm).toBe("Da Gobshot Thunderbuss")
    expect(got.warnings).toEqual([
      "Deffkilla Wartrike A: the roster file has Da Gobshot Thunderbuss but leaves out the weapon it gives, so that profile comes from Wahapedia.",
      NO_TEXT_EXPORT
    ])
  })

  it("make a melee weapon one of the bearer's choices, so it fights with the better one", () => {
    // Strike Force Cophasta's Bladeguard Ancient took Imperium's Sword; 40k.app gave him his Relics of Battle and no sword
    const cophasta = readFileSync("tests/fixtures/rosters/strike-force-cophasta.ros", "utf8")
    expect(rows(cophasta, ctx, "Bladeguard Ancient")).toEqual(["r:Heavy Bolt Pistol×1", "m:Relics of Battle×1"])
    // the sword (A6, WS2+, S7, AP-3, D3) is better in every number, so the relics drop out as they would for any weapon it beats
    expect(rows(cophasta, withWeapons, "Bladeguard Ancient")).toEqual(["r:Heavy Bolt Pistol×1", "m:Imperium's Sword×1"])
  })

  it("leave the weapon alone when the roster file has it", () => {
    const xml = wartrike("Da Gobshot Thunderbuss", GOBSHOT, `<selection name="Da Gobshot Thunderbuss" type="upgrade" number="1"><profiles>${gun("Da Gobshot Thunderbuss", 6)}</profiles></selection>`)
    expect(rows(xml, withWeapons, "Deffkilla Wartrike A")).toEqual(rows(xml, ctx, "Deffkilla Wartrike A"))
    expect(parseRosterSync(xml, "", withWeapons).warnings).toEqual([NO_TEXT_EXPORT])
  })

  it("say so when the app has no profile for the weapon, and nothing for an enhancement that gives none", () => {
    const unknown = wartrike("Da Shiny Choppa", "Warboss model only. This model has the following weapon.")
    expect(rows(unknown, withWeapons, "Deffkilla Wartrike A")).toEqual(["r:Boomstikks×1"])
    expect(parseRosterSync(unknown, "", withWeapons).warnings).toEqual([
      "Deffkilla Wartrike A: the roster file has Da Shiny Choppa but leaves out the weapon it gives, and the app has no profile for it yet, so it isn’t counted.",
      NO_TEXT_EXPORT
    ])
    const blitzboss = wartrike("Blitzboss", "Warboss model only. A transport unit (excluding Walker units) this unit is embarked within has: +2&quot; M. 5+ InSv.")
    expect(parseRosterSync(blitzboss, "", withWeapons).warnings).toEqual([NO_TEXT_EXPORT])
  })

  it("know every profile kept for one", () => {
    expect(ENHANCEMENT_WEAPONS.map((e) => e.enhancement)).toEqual([
      "Da Gobshot Thunderbuss",
      "Da Krunch",
      "'Eadbanger",
      "Auriferous Orb",
      "Emperor's Light",
      "The Thief of Secrets",
      "Imperium's Sword"
    ])
    for (const e of ENHANCEMENT_WEAPONS) {
      const w = givenWeapon(e.enhancement)!
      // every keyword is one the engine reads, but the Orb's Blinding Light, which comes after it has shot
      expect(w.kw.other ?? [], e.enhancement).toEqual(e.enhancement === "Auriferous Orb" ? ["BLINDING LIGHT"] : [])
    }
    // Anti 2+ against anything that isn't a Monster or Vehicle
    expect(givenWeapon("Auriferous Orb")!.kw.anti).toEqual({ INFANTRY: 2, MOUNTED: 2, BEASTS: 2, SWARM: 2 })
    expect(givenWeapon("Emperor’s Light")).toMatchObject({ t: "m", A: 3, sk: 2, S: 5, AP: 2, D: 2, kw: { extra: 1 } })
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
        // nothing to drop in a list whose options all add, or that has none (its Bladeguard Ancient's Imperium's Sword is added either way)
        const plain = parseRosterSync(readFileSync("tests/fixtures/rosters/strike-force-cophasta.ros", "utf8"), "", { ...ctx, enhancementWeapon: givenWeapon })
        const again = parseRosterSync(readFileSync("tests/fixtures/rosters/strike-force-cophasta.ros", "utf8"), "", live)
        expect(again.units.map((u) => u.w)).toEqual(plain.units.map((u) => u.w))
      }))

    it.effect("twin weapons from the export: the row a roster left out comes from the datasheet", () =>
      Effect.gen(function*() {
        const live = yield* importContext
        const list = parseRosterSync(readFileSync("tests/fixtures/rosters/ten-thousand-and-no-more.ros", "utf8"), "", live)
        const melee = (units: ReadonlyArray<Unit>, unit: string) => units.find((u) => u.nm === unit)!.w.filter((w) => w.t === "m").map((w) => `${w.nm}×${w.n} A${w.A}`)
        expect(melee(list.units, "Contemptor-Galatus Dreadnought")).toEqual(["Galatus warblade×1 A8"])
        expect(melee(list.units, "Venatari Custodians A")).toEqual(["Venatari lance×3 A5"])
        // split by type in the file, so it has both already
        expect(list.units.find((u) => u.nm === "Custodian Guard A")!.w.map((w) => w.nm)).toEqual(["Guardian spear - ranged", "Guardian spear - melee"])
        // Space Wolves are on Wahapedia's Space Marines datasheets
        const arjac = `<roster name="Arjac"><forces><force catalogueName="Space Wolves"><selections><selection name="Arjac Rockfist" type="model" number="1"><selections>
          <selection name="Foehammer" type="upgrade" number="1"><profiles><profile name="Foehammer" typeName="Ranged Weapons"><characteristics>
          <characteristic name="A">1</characteristic><characteristic name="BS">2+</characteristic><characteristic name="S">10</characteristic><characteristic name="AP">-2</characteristic><characteristic name="D">3</characteristic>
          </characteristics></profile></profiles></selection></selections></selection></selections></force></forces></roster>`
        expect(melee(parseRosterSync(arjac, "", live).units, "Arjac Rockfist")).toEqual(["Foehammer×1 A5"])
      }))

    it.effect("weapons enhancements give: every one in the export has a profile but Orksbane, and the check page counts it", () =>
      Effect.gen(function*() {
        const snapshot = Option.getOrThrow(yield* currentSnapshotId)
        const giving = (yield* enhancements(snapshot)).filter((e) => GIVES_A_WEAPON.test(e.text))
        const kept = new Map(ENHANCEMENT_WEAPONS.map((e) => [norm(e.enhancement), e]))
        // Orksbane (Vengeful Hosts) was gone from Wahapedia by 4 November, so there was no profile to copy
        expect(giving.filter((e) => !kept.has(norm(e.name))).map((e) => `${e.factionId}: ${e.name}`)).toEqual(["SM: Orksbane"])
        for (const e of giving) {
          const k = kept.get(norm(e.name))
          if (k) expect([k.faction, k.detachment], e.name).toEqual([e.factionId, e.detachment])
        }
        // importing and "read the file again" both read rosters with `importContext`
        const live = yield* importContext
        const trike = parseRosterSync(wartrike("Da Gobshot Thunderbuss", GOBSHOT), "", live).units[0]
        expect(trike.w.map((w) => w.nm)).toEqual(["Boomstikks", "Da Gobshot Thunderbuss"])
        // the sword is on no datasheet, so the check compares it with the enhancement's profile
        const list = parseRosterSync(readFileSync("tests/fixtures/rosters/strike-force-cophasta.ros", "utf8"), "", live)
        const check = yield* checkList({ units: list.units, meta: list.meta, rules: list.rules }, library)
        expect(check.units.find((u) => u.unit === "Bladeguard Ancient")!.weapons.find((w) => w.nm === "Imperium's Sword")?.status).toBe("ok")
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

describe("reading whether a rule changes damage", () => {
  it("knows a characteristic written short, a weapon list with an exception, and attacks that have a bonus", () => {
    // The Red Sands Remember (World Eaters) and The Wall Advances (Imperial Fists), 10 October: all three were read as no effect
    expect(looksOffensive("If this unit made a charge move this turn, this unit’s melee attacks have +1 S.")).toBe(true)
    expect(looksOffensive("WORLD EATERS model only. Add 1 to the Attacks and Damage characteristics of melee weapons (excluding Extra Attacks weapons) equipped by the bearer.")).toBe(true)
    expect(
      looksOffensive("In your Shooting phase, if any of the following apply, this unit’s ranged attacks have +1 to hit rolls:This unit is within range of an objective.")
    ).toBe(true)
  })

  it("still leaves out rules about attacks against the unit, and rules with no attacks in them", () => {
    expect(looksOffensive("Each time an attack is allocated to a model in this unit, subtract 1 from the Damage characteristic of that attack.")).toBe(false)
    expect(looksOffensive("Once per battle, when an attack is allocated to this model, you change the Damage characteristic of that attack to 0.")).toBe(false)
    expect(looksOffensive("At the end of your Command phase, if this unit is within range of an objective marker you control, that objective marker remains under your control.")).toBe(false)
    expect(looksOffensive("While this model is leading a unit, add 1 to Advance and Charge rolls made for that unit.")).toBe(false)
  })
})

describe("rules a detachment hands to units", () => {
  const u = (id: string, nm: string, kw: Array<string>, rules: Array<string> = []) => ({ id, nm, kw, rules })
  const grants = {
    "mob-handed-brutality": [
      { kw: "INFANTRY", rule: "mob-handed-brutality" },
      { name: "boyz", rule: "mob-handed-brutality-boyz" }
    ],
    "spearpoint-tf": [{ name: "suboden khan", rule: "wrath-first-khan" }]
  }

  it("go by keyword, or to the units of one datasheet by name, A/B letter or not", () => {
    const units = [
      u("boyz-a", "Boyz A", ["INFANTRY", "MOB"]),
      u("boyz", "Boyz", ["INFANTRY", "MOB"], ["mob-handed-brutality"]),
      u("stormboyz", "Stormboyz", ["INFANTRY"]),
      u("snagga", "Beast Snagga Boyz", ["INFANTRY", "MOB"]),
      u("trukk", "Trukk", ["VEHICLE"]),
      u("suboden", "Suboden Khan", ["MOUNTED"])
    ]
    expect(detachmentGrants(units, ["mob-handed-brutality"], grants)).toEqual({
      "boyz-a": ["mob-handed-brutality", "mob-handed-brutality-boyz"],
      // already has the first
      boyz: ["mob-handed-brutality-boyz"],
      stormboyz: ["mob-handed-brutality"],
      snagga: ["mob-handed-brutality"]
    })
    expect(detachmentGrants(units, ["spearpoint-tf"], grants)).toEqual({ suboden: ["wrath-first-khan"] })
    expect(detachmentGrants(units, [], grants)).toEqual({})
  })
})
