/**
 * The Wahapedia pipeline: CSV dialect, snapshot loading, the change report,
 * the list check and the rules sync.
 *
 * The unit tests run on synthetic rows. The integration tests load the real
 * export from data/wahapedia (the newest dated folder) into an in-memory
 * database, and are skipped when no export has been downloaded.
 */
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { layerAt } from "~/.server/db/Db"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { seed } from "~/.server/seed/Seed"
import { applyCheck, applyProfiles, checkList, checkUnit, profileDiff, tierRange } from "~/.server/wahapedia/check"
import { parseExportCsvSync } from "~/.server/wahapedia/csv"
import { buildReport, diffTable, reportHasChanges } from "~/.server/wahapedia/diff"
import { costLines, currentSnapshotId, type Datasheet, datasheets, searchDatasheets, type WargearProfile } from "~/.server/wahapedia/queries"
import { Snapshots } from "~/.server/wahapedia/Snapshots"
import { syncRules } from "~/.server/wahapedia/sync"
import { WH_ALL_FILES, WH_TABLES, whTableByFile } from "~/.server/wahapedia/tables"
import { loadDirectory } from "~/.server/node/directory"
import type { Unit, Weapon } from "~/domain/schema"
import { stripHtml, textHash } from "~/domain/text"

describe("export CSV dialect", () => {
  it("splits on fields, not lines, so HTML with newlines stays in its column", () => {
    const text = "﻿id|name|description|\n1|Scouts|<div>\n\tline two\n</div>|\n2|Stealth||\n"
    const csv = parseExportCsvSync("Abilities", text)
    expect(csv.columns).toEqual(["id", "name", "description"])
    expect(csv.rows).toEqual([
      ["1", "Scouts", "<div>\n\tline two\n</div>"],
      ["2", "Stealth", ""]
    ])
  })

  it("reads the single-column timestamp file", () => {
    expect(parseExportCsvSync("Last_update", "﻿last_update|\n2026-09-28 02:38:04|\n").rows).toEqual([["2026-09-28 02:38:04"]])
  })

  it("refuses a file whose records don’t line up", () => {
    expect(() => parseExportCsvSync("X", "a|b|\n1|2|3|\n")).toThrow(/divide evenly|misaligned/)
    expect(() => parseExportCsvSync("X", "a,b\n1,2\n")).toThrow(/Wahapedia export/)
  })
})

describe("text helpers", () => {
  it("turns site HTML into readable text", () => {
    expect(stripHtml('Each time a <span class="kwb">MONSTER</span> is hit:<br><ul><li>Re-roll hits.</li><li>Re-roll wounds.</li></ul>')).toBe(
      "Each time a MONSTER is hit:\n\n• Re-roll hits.\n• Re-roll wounds."
    )
  })
  it("hashes text without caring about whitespace or case", () => {
    expect(textHash("Add 1 to  the Hit roll.")).toBe(textHash("add 1 to the hit roll."))
    expect(textHash("Add 1 to the Hit roll.")).not.toBe(textHash("Add 1 to the Wound roll."))
  })
})

describe("points tiers", () => {
  it("reads the unit-count range out of a tier header", () => {
    expect(tierRange("YOUR 1ST TO 2ND UNITS COST")).toEqual([1, 2])
    expect(tierRange("YOUR 3RD + UNIT COSTS")).toEqual([3, Infinity])
    expect(tierRange("YOUR 1ST UNIT COSTS")).toEqual([1, 1])
    expect(tierRange("")).toEqual([1, Infinity])
  })
  it("folds tier headers into the priced lines and drops repeated blocks", () => {
    const rows = [
      { line: "1", description: "YOUR 1ST TO 2ND UNITS COST", cost: "" },
      { line: "2", description: "5 models", cost: "120" },
      { line: "3", description: "YOUR 3RD + UNIT COSTS", cost: "" },
      { line: "4", description: "5 models", cost: " 130" },
      { line: "5", description: "YOUR 1ST TO 2ND UNITS COST", cost: "" },
      { line: "6", description: "5 models", cost: "120" }
    ]
    expect(costLines(rows)).toEqual([
      { tier: "YOUR 1ST TO 2ND UNITS COST", description: "5 models", cost: 120 },
      { tier: "YOUR 3RD + UNIT COSTS", description: "5 models", cost: 130 }
    ])
  })
})

describe("change report", () => {
  const sheet = { id: "d1", name: "Fire Dragons", faction_id: "AE" }
  const base = {
    Factions: [{ id: "AE", name: "Aeldari", link: "" }],
    Datasheets: [sheet, { id: "d2", name: "Old Unit", faction_id: "AE" }],
    Datasheets_models_cost: [
      { datasheet_id: "d1", line: "1", description: "YOUR 1ST TO 2ND UNITS COST", cost: "" },
      { datasheet_id: "d1", line: "2", description: "5 models", cost: "110" }
    ],
    Datasheets_wargear: [
      { datasheet_id: "d1", line: "1", line_in_wargear: "1", dice: "", name: "Dragon fusion gun", description: "assault, melta 3", range: "12", type: "Ranged", A: "1", BS_WS: "3", S: "9", AP: "-4", D: "D6" }
    ],
    Datasheets_abilities: [
      { datasheet_id: "d1", line: "1", ability_id: "", model: "", name: "Assured Destruction", description: "Re-roll the <b>Hit</b> roll.", type: "Datasheet", parameter: "" }
    ]
  }
  const next = {
    ...base,
    Datasheets: [sheet, { id: "d3", name: "New Unit", faction_id: "AE" }],
    Datasheets_models_cost: [base.Datasheets_models_cost[0], { ...base.Datasheets_models_cost[1], cost: "120" }],
    Datasheets_wargear: [{ ...base.Datasheets_wargear[0], S: "10", description: "assault, melta 4" }],
    Datasheets_abilities: [{ ...base.Datasheets_abilities[0], description: "Re-roll the Hit roll and the Wound roll." }]
  }

  it("reports nothing when nothing changed, markup included", () => {
    const reworded = { ...base, Datasheets_abilities: [{ ...base.Datasheets_abilities[0], description: "Re-roll the <i>Hit</i> roll." }] }
    const r = buildReport(base, reworded, { id: 1, lastUpdate: "a" }, { lastUpdate: "b" })
    expect(r.abilities).toEqual([])
    expect(reportHasChanges(buildReport(base, base, { id: 1, lastUpdate: "a" }, { lastUpdate: "a" }))).toBe(false)
  })

  it("summarises points, weapon, ability and datasheet changes", () => {
    const r = buildReport(base, next, { id: 1, lastUpdate: "a" }, { lastUpdate: "b" })
    expect(reportHasChanges(r)).toBe(true)
    expect(r.points).toEqual([
      { datasheetId: "d1", datasheet: "Fire Dragons", faction: "Aeldari", line: "5 models (your 1st to 2nd units cost)", from: "110", to: "120" }
    ])
    expect(r.weapons).toHaveLength(1)
    expect(r.weapons[0].changes).toEqual({ S: ["9", "10"], description: ["assault, melta 3", "assault, melta 4"] })
    expect(r.abilities).toEqual([{ datasheetId: "d1", datasheet: "Fire Dragons", faction: "Aeldari", ability: "Assured Destruction", kind: "changed" }])
    expect(r.datasheets.added.map((d) => d.datasheet)).toEqual(["New Unit"])
    expect(r.datasheets.removed.map((d) => d.datasheet)).toEqual(["Old Unit"])
  })

  it("treats repeated keys as a bag of rows", () => {
    const t = whTableByFile("Datasheets_keywords")!
    const row = (keyword: string, f = "false") => ({ datasheet_id: "d1", keyword, model: "", is_faction_keyword: f })
    const d = diffTable(t, [row("Infantry"), row("Infantry"), row("Aeldari")], [row("Infantry"), row("Aeldari", "true"), row("Grenades")])
    expect(d.added.map((r) => r.keyword)).toEqual(["Grenades"])
    expect(d.changed.map(([a, b]) => [a.is_faction_keyword, b.is_faction_keyword])).toEqual([["false", "true"]])
    expect(d.removed).toEqual([])
  })
})

describe("profile differences", () => {
  const wargear = (name: string, type: "Ranged" | "Melee", S: string, AP: string, abilities = ""): WargearProfile => ({
    name,
    abilities,
    range: type === "Melee" ? "Melee" : "24",
    type,
    A: "2",
    skill: "3",
    S,
    AP,
    D: "1"
  })
  const sheet = (over: Partial<Datasheet>): Datasheet => ({
    id: "d1",
    name: "Legionaries",
    factionId: "CSM",
    faction: "Chaos Space Marines",
    role: "",
    source: "",
    legacy: false,
    virtual: false,
    link: "",
    isSupport: false,
    loadout: "",
    damaged: "",
    models: [{ name: "LEGIONARY", M: '6"', T: "4", Sv: "3", inv: "-", invNote: "", W: "2", Ld: "6+", OC: "2" }],
    wargear: [],
    abilities: [],
    keywords: [],
    factionKeywords: [],
    costs: [],
    composition: [],
    options: [],
    leads: [],
    ledBy: [],
    ...over
  })
  const weapon = (nm: string, t: "r" | "m", S: number, AP: number): Weapon => ({ nm, t, n: 5, A: 2, sk: 3, S, AP, D: 1, kw: {} })
  const unit = (w: Array<Weapon>, T = 4): Unit => ({
    id: "u",
    nm: "Legionaries",
    pts: 90,
    models: 5,
    rules: [],
    w,
    stats: { T, Sv: 3, W: 2, M: '6"', Ld: "6+", OC: "2", inv: 0 }
  })
  const ctx = { candidates: 1, position: 1, rules: {}, enhancements: [], factionId: null, detachmentNames: [], attachedTo: null, manual: null }

  it("matches a roster’s “- ranged” and “- melee” rows to the datasheet’s one name for both", () => {
    const spear = sheet({ wargear: [wargear("Guardian spear", "Melee", "7", "-2"), wargear("Guardian spear", "Ranged", "4", "-1")] })
    const u = unit([weapon("Guardian spear - Ranged", "r", 4, 1), weapon("Guardian spear - melee", "m", 7, 2)])
    const c = checkUnit(u, spear, ctx)
    expect(c.weapons.map((w) => [w.status, w.matchedAs])).toEqual([["ok", undefined], ["ok", undefined]])
    expect(profileDiff(u, c)).toEqual({ stats: null, weapons: [], leader: null, applicable: false })
    // a datasheet that does name its profiles that way still matches as written
    const split = sheet({ wargear: [wargear("Plasma pistol – standard", "Ranged", "7", "-2"), wargear("Plasma pistol – supercharge", "Ranged", "8", "-3")] })
    expect(checkUnit(unit([weapon("Plasma pistol - supercharge", "r", 8, 3)]), split, ctx).weapons[0].status).toBe("ok")
  })

  it("lays both sides out in full and marks the cells that disagree", () => {
    const u = unit([weapon("Boltgun", "r", 5, 1), weapon("Close combat weapon", "m", 4, 0), weapon("Balefire tome", "r", 6, 1)], 5)
    const c = checkUnit(u, sheet({ wargear: [wargear("Boltgun", "Ranged", "4", "0"), wargear("Close combat weapon", "Melee", "4", "0")] }), ctx)
    const d = profileDiff(u, c)
    expect(d.stats).toEqual({
      list: { T: "5", Sv: "3+", W: "2", inv: "none" },
      db: { T: "4", Sv: "3+", W: "2", inv: "none" },
      changed: ["T"]
    })
    // the weapon that agrees is left out; the one the datasheet doesn't have is shown with nothing to compare it with
    expect(d.weapons).toEqual([
      {
        nm: "Boltgun",
        melee: false,
        matchedAs: null,
        list: { A: "2", skill: "3+", S: "5", AP: "-1", D: "1", abilities: "" },
        db: { A: "2", skill: "3+", S: "4", AP: "0", D: "1", abilities: "" },
        changed: ["S", "AP"]
      },
      { nm: "Balefire tome", melee: false, matchedAs: null, list: { A: "2", skill: "3+", S: "6", AP: "-1", D: "1", abilities: "" }, db: null, changed: [] }
    ])
    expect(d.applicable).toBe(true)
    // what the row's pill counts: the stat line and the two weapons (the price is counted apart)
    expect(c.issues - c.pointsIssues).toBe(3)
  })

  it("has nothing to take from Wahapedia when the only difference is a weapon it doesn’t list", () => {
    const u = unit([weapon("Balefire tome", "r", 6, 1)])
    const d = profileDiff(u, checkUnit(u, sheet({ wargear: [wargear("Boltgun", "Ranged", "4", "0")] }), ctx))
    expect(d.weapons).toHaveLength(1)
    expect(d.applicable).toBe(false)
  })

  it("takes Wahapedia’s profile for a unit without touching its points", () => {
    const u = unit([weapon("Boltgun", "r", 5, 1), weapon("Balefire tome", "r", 6, 1)], 5)
    const priced = sheet({ wargear: [wargear("Boltgun", "Ranged", "4", "0")], costs: [{ tier: "", description: "5 models", cost: 75 }] })
    const c = checkUnit(u, priced, ctx)
    const profiled = applyProfiles(u, c)
    expect(profiled.pts).toBe(90)
    expect(profiled.datasheetId).toBe("d1")
    expect(profiled.stats?.T).toBe(4)
    expect(profiled.w.map((w) => [w.nm, w.n, w.S, w.AP])).toEqual([["Boltgun", 5, 4, 0], ["Balefire tome", 5, 6, 1]])
    // …where applying the whole check also brings the price up to date
    expect(applyCheck(u, c).pts).toBe(75)
    expect(applyCheck(u, c).w).toEqual(profiled.w)
  })
})

// ---------- integration: the real export ----------

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

describe.skipIf(!exportDir)("with the downloaded export", () => {
  it("has every file the spec lists", () => {
    for (const f of WH_ALL_FILES) expect(existsSync(join(exportDir!, `${f}.csv`)), f).toBe(true)
  })

  it("parses every table with the columns the registry expects", () => {
    for (const t of WH_TABLES) {
      const csv = parseExportCsvSync(t.file, readFileSync(join(exportDir!, `${t.file}.csv`), "utf8"))
      expect(t.columns.filter((c) => !csv.columns.includes(c)), `${t.file}: missing columns`).toEqual([])
      expect(csv.rows.length, t.file).toBeGreaterThan(0)
    }
  })

  // one database, loaded once, shared by the tests below
  layer(TestLayer, { timeout: "120 seconds" })("snapshot", (it) => {
    it.effect("loads the export, and loading it again is a no-op", () =>
      Effect.gen(function*() {
        const snapshots = yield* Snapshots
        const first = yield* loadDirectory(exportDir!)
        expect(first.status).toBe("loaded")
        expect(first.report).toBeNull()
        expect(first.snapshot.rows).toBeGreaterThan(50_000)
        const again = yield* loadDirectory(exportDir!)
        expect(again.status).toBe("unchanged")
        expect(yield* snapshots.all).toHaveLength(1)
      }), 120_000)

    it.effect("reports a points change between two snapshots", () =>
      Effect.gen(function*() {
        // a copy of the export with one price moved and a later timestamp
        const copy = mkdtempSync(join(tmpdir(), "cogitator-export-"))
        for (const f of WH_ALL_FILES) writeFileSync(join(copy, `${f}.csv`), readFileSync(join(exportDir!, `${f}.csv`)))
        const costs = readFileSync(join(copy, "Datasheets_models_cost.csv"), "utf8")
        const edited = costs.replace(/\n000004193\|2\|1 model\|95\|/, "\n000004193|2|1 model|105|")
        expect(edited).not.toBe(costs)
        writeFileSync(join(copy, "Datasheets_models_cost.csv"), edited)
        writeFileSync(join(copy, "Last_update.csv"), "﻿last_update|\n2099-01-01 00:00:00|\n")

        const snapshots = yield* Snapshots
        const result = yield* loadDirectory(copy)
        expect(result.status).toBe("loaded")
        expect(result.report?.points).toEqual([
          { datasheetId: "000004193", datasheet: "Prince Yriel", faction: "Aeldari", line: "1 model", from: "95", to: "105" }
        ])
        expect(result.report?.tables.filter((t) => t.added + t.removed + t.changed > 0).map((t) => t.file)).toEqual(["Datasheets_models_cost"])
        expect(Option.isSome(yield* snapshots.report(result.snapshot.id))).toBe(true)
        // put the real export back as the current snapshot for the tests that follow
        yield* loadDirectory(exportDir!, { force: true })
      }), 120_000)

    it.effect("resolves datasheets with profiles, weapons, abilities and tiered points", () =>
      Effect.gen(function*() {
        const id = Option.getOrThrow(yield* currentSnapshotId)
        const found = yield* searchDatasheets(id, "fire dragons", "AE")
        expect(found.map((d) => d.name)).toEqual(["Fire Dragons"])
        const sheet = (yield* datasheets(id, [found[0].id])).get(found[0].id)!
        expect(sheet.models.map((m) => m.name)).toEqual(["FIRE DRAGON", "FIRE DRAGON EXARCH"])
        expect(sheet.wargear.find((w) => w.name === "Dragon fusion gun")).toMatchObject({ A: "1", skill: "3", S: "9", AP: "-4", D: "D6", abilities: "assault, melta 3" })
        expect(sheet.abilities.find((a) => a.name === "Assured Destruction")?.text).toMatch(/re-roll the Hit roll/)
        expect(sheet.costs.map((c) => c.tier)).toContain("YOUR 3RD + UNIT COSTS")
        expect(sheet.keywords).toContain("Aspect Warriors")
        expect(sheet.factionKeywords).toContain("Asuryani")
      }))

    it.effect("checks the Aeldari list: every unit resolves and the weapon profiles agree", () =>
      Effect.gen(function*() {
        const list = yield* (yield* Lists).get("builtin-burning-v2")
        const check = yield* checkList(list, yield* (yield* Rules).book)
        expect(check.factionId).toBe("AE")
        expect(check.totals.unmatched).toBe(0)
        const by = (id: string) => check.units.find((u) => u.unitId === id)!
        // shared datasheets resolve to the Aeldari copy, not the Drukhari one
        expect(by("prince-yriel").datasheet?.faction).toBe("Aeldari")
        expect(by("prince-yriel").candidates).toBe(2)
        expect(by("prince-yriel").points).toMatchObject({ list: 95, ok: true, expected: 95 })
        expect(by("corsair-voidscarred").enhancement).toMatchObject({ list: 15, db: 15, ok: true, detachment: "Corsair Coterie" })
        expect(by("corsair-voidscarred").points).toMatchObject({ list: 140, ok: true })
        // every weapon in the list exists on its datasheet with the same profile
        const weapons = check.units.flatMap((u) => u.weapons.map((w) => ({ unit: u.unit, ...w })))
        expect(weapons.filter((w) => w.status !== "ok").map((w) => `${w.unit}: ${w.nm} ${JSON.stringify(w.changes)}`)).toEqual([])
        expect(check.detachments.map((d) => d.found?.forceDisposition)).toEqual(["Reconnaissance", "Priority Assets"])
      }))

    it.effect("applies database values to a unit without touching what it couldn’t match", () =>
      Effect.gen(function*() {
        const list = yield* (yield* Lists).get("builtin-burning-v2")
        const check = yield* checkList(list, yield* (yield* Rules).book)
        const unit = list.units.find((u) => u.id === "fire-dragons")!
        const c = check.units.find((u) => u.unitId === "fire-dragons")!
        const applied = applyCheck(unit, c)
        expect(applied.datasheetId).toBe(c.datasheet!.id)
        expect(applied.pts).toBe(c.points!.expected ?? unit.pts)
        expect(applied.w.map((w) => [w.nm, w.n])).toEqual(unit.w.map((w) => [w.nm, w.n]))
      }))

    it.effect("links library rules to their official text, then notices nothing has changed", () =>
      Effect.gen(function*() {
        const first = yield* syncRules
        expect(first.linked.length).toBeGreaterThan(30)
        expect(first.linked).toContain("assured")
        expect(first.linked).toContain("voidstone")
        const entry = yield* (yield* Rules).get("piratical-hero")
        expect(entry.wh?.kind).toBe("datasheet-ability")
        expect(entry.wh?.text).toMatch(/SUSTAINED HITS 1/)
        const second = yield* syncRules
        expect(second.linked).toEqual([])
        expect(second.changed).toEqual([])
        expect(second.unchanged).toBe(first.linked.length)
      }))
  })
})
