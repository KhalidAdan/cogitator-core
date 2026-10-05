/**
 * The Munitorum Field Manual reader: getting text out of the page's embedded
 * data, parsing it into points, comparing versions, and pricing lists from it.
 *
 * The unit tests are synthetic. The integration tests use the faction pages
 * the app saved under data/mfm when it last fetched them, and skip themselves
 * if there are none.
 */
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { layerAt } from "~/.server/db/Db"
import { fieldManualSlug } from "~/.server/mfm/factions"
import { flightPayload, flightRows, flightTokens, pageTokens } from "~/.server/mfm/flight"
import { type FieldManual, parseFieldManualTokens } from "~/.server/mfm/parse"
import { diffManuals, latestManual, manualHash, manualStatuses, markedChanges, saveManual } from "~/.server/mfm/store"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { seed } from "~/.server/seed/Seed"
import { applyPoints, checkList, manualUnitFor, modelCount, pointsDrift } from "~/.server/wahapedia/check"
import type { Unit } from "~/domain/schema"
import { pocCophasta } from "./helpers/poc"

/** A page as Next.js streams it: the payload split across script tags, as JS string literals. */
const page = (payload: string) => {
  const cut = Math.floor(payload.length / 2)
  const push = (s: string) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`
  return `<html><body><div hidden id="S:1">out of order</div>${push(payload.slice(0, cut))}${push(payload.slice(cut))}</body></html>`
}

describe("reading a page's embedded data", () => {
  const payload = [
    `1:I[1234,["chunk.js"],"Component"]`,
    `:HL["/style.css","style"]`,
    `0:{"P":null,"f":[["$","main",null,{"children":[["$","h1",null,{"children":"AELDARI"}],"$L2","$L3",["$","p",null,{"children":["a ","$$5 note"]}]]}]]}`,
    `2:["$","div",null,{"className":"card","children":[["$","span",null,{"children":"FARSEER"}],"$L4"]}]`,
    `4:["$","span",null,{"children":"60 pts"}]`,
    // a text row is length-prefixed in bytes (’ is three) and isn't followed by a newline
    `3:T9,Kor’sar5:"never referenced"`
  ].join("\n") + "\n"

  it("joins the chunks and splits them into rows, skipping what isn't content", () => {
    const rows = flightRows(flightPayload(page(payload)))
    expect([...rows.keys()].sort()).toEqual(["0", "2", "3", "4", "5"])
    // a text row is measured in bytes: ’ is three of them
    expect(rows.get("3")).toBe("Kor’sar")
  })

  it("returns the text in reading order, following references once", () => {
    expect(flightTokens(flightRows(payload))).toEqual(["AELDARI", "FARSEER", "60 pts", "Kor’sar", "a", "$5 note"])
    expect(pageTokens(page(payload))).toEqual(["AELDARI", "FARSEER", "60 pts", "Kor’sar", "a", "$5 note"])
  })

  it("gives nothing for a page with no payload", () => {
    expect(pageTokens("<html><body>hello</body></html>")).toEqual([])
  })
})

describe("parsing the Field Manual's text", () => {
  const tokens = [
    "__PAGE__", "SPACE MARINES", "v1.5", "Welcome to the Munitorum Field Manual", "UNITS", "A unit’s points cost can vary", "Show Legends",
    "UNITS",
    "AGGRESSOR SQUAD", "▲", "YOUR UNIT COSTS", "3 models", "▲ (+10) 90 pts", "6 models", "▲ (+15) 180 pts", "UPDATED", "REQUISITION THRESHOLDS REMOVED",
    "LIBRARIAN", "YOUR UNIT COSTS", "1 model", "75 pts", "LEADER", "INTERCESSOR SQUAD, HELLBLASTER SQUAD", "UPDATED", "BODYGUARD UNITS UPDATED", "REQUISITION THRESHOLDS REMOVED",
    "TERMINATOR SQUAD", "▲", "YOUR 1ST TO 2ND UNITS COST", "5 models", "▲ (+30) 190 pts", "10 models", "380 pts",
    "YOUR 3RD + UNIT COSTS", "5 models", "230 pts", "10 models", "420 pts", "WARGEAR OPTIONS", "per Cyclone Missile Launcher", "10 pts",
    "PHANTOM TITAN", "YOUR UNIT COSTS", "1 model", "2,100 pts",
    "WHITE SCARS",
    "KOR’SARRO KHAN", "▲", "YOUR UNIT COSTS", "1 model", "▲ (+25) 80 pts", "LEADER", "BLADEGUARD VETERAN SQUAD",
    "DETACHMENTS",
    "ASSAULT BRETHREN", "1DP", "TAKE AND HOLD", "UNIQUE: DOCTRINES", "ENHANCEMENTS", "Furious Assault (Upgrade)", "10 pts", "Imperium’s Sword", "▼ (-5) 20 pts",
    "WARHOST", "2DP", "▼", "RECONNAISSANCE", "PRIORITY ASSETS", "ENHANCEMENTS", "Phoenix Gem", "35 pts", "UPDATED", "FORCE DISPOSITION(S) CHANGED",
    "Warhammer 40,000: Munitorum Field Manual"
  ]
  const m = parseFieldManualTokens(tokens)
  const unit = (name: string) => m.units.find((u) => u.name === name)!

  it("finds the faction, the version and every unit", () => {
    expect(m.faction).toBe("SPACE MARINES")
    expect(m.version).toBe("v1.5")
    expect(m.units.map((u) => u.name)).toEqual(["AGGRESSOR SQUAD", "LIBRARIAN", "TERMINATOR SQUAD", "PHANTOM TITAN", "KOR’SARRO KHAN"])
  })

  it("reads prices, the changes marked on them, and thousands separators", () => {
    expect(unit("AGGRESSOR SQUAD").costs).toEqual([
      { tier: "", description: "3 models", cost: 90, delta: 10 },
      { tier: "", description: "6 models", cost: 180, delta: 15 }
    ])
    expect(unit("PHANTOM TITAN").costs[0].cost).toBe(2100)
  })

  it("keeps tiers apart and wargear costs separate", () => {
    const t = unit("TERMINATOR SQUAD")
    expect(t.costs.map((c) => [c.tier, c.description, c.cost])).toEqual([
      ["YOUR 1ST TO 2ND UNITS COST", "5 models", 190],
      ["YOUR 1ST TO 2ND UNITS COST", "10 models", 380],
      ["YOUR 3RD + UNIT COSTS", "5 models", 230],
      ["YOUR 3RD + UNIT COSTS", "10 models", 420]
    ])
    expect(t.wargear).toEqual([{ tier: "", description: "per Cyclone Missile Launcher", cost: 10, delta: null }])
  })

  it("tells a change note from the heading of the next group of units", () => {
    expect(unit("AGGRESSOR SQUAD").notes).toEqual(["REQUISITION THRESHOLDS REMOVED"])
    expect(unit("LIBRARIAN").notes).toEqual(["BODYGUARD UNITS UPDATED", "REQUISITION THRESHOLDS REMOVED"])
    expect(unit("LIBRARIAN").attach).toEqual({ kind: "LEADER", units: ["INTERCESSOR SQUAD", "HELLBLASTER SQUAD"] })
    expect(unit("TERMINATOR SQUAD").section).toBe("")
    expect(unit("KOR’SARRO KHAN").section).toBe("WHITE SCARS")
  })

  it("reads detachments: points, force dispositions, unique tag, enhancements", () => {
    expect(m.detachments).toEqual([
      {
        name: "ASSAULT BRETHREN",
        dp: 1,
        dispositions: ["TAKE AND HOLD"],
        unique: "DOCTRINES",
        enhancements: [
          { name: "Furious Assault (Upgrade)", cost: 10, delta: null },
          { name: "Imperium’s Sword", cost: 20, delta: -5 }
        ],
        notes: []
      },
      {
        name: "WARHOST",
        dp: 2,
        dispositions: ["RECONNAISSANCE", "PRIORITY ASSETS"],
        unique: null,
        enhancements: [{ name: "Phoenix Gem", cost: 35, delta: null }],
        notes: ["FORCE DISPOSITION(S) CHANGED"]
      }
    ])
  })

  it("fails loudly on a page it doesn't recognise", () => {
    expect(() => parseFieldManualTokens(["Warhammer 40,000", "v1.5", "FACTIONS", "AELDARI", "ORKS"])).toThrow(/any unit prices/)
    expect(() => parseFieldManualTokens([])).toThrow(/any unit prices/)
  })

  it("compares two versions, and reads a page's own change markers", () => {
    const next: FieldManual = {
      ...m,
      version: "v1.6",
      units: m.units
        .filter((u) => u.name !== "PHANTOM TITAN")
        .map((u) => (u.name === "LIBRARIAN" ? { ...u, costs: [{ ...u.costs[0], cost: 80, delta: 5 }] } : u)),
      detachments: m.detachments.map((d) => (d.name === "WARHOST" ? { ...d, dp: 3 } : d))
    }
    expect(diffManuals(m, next)).toEqual([
      { kind: "unit", name: "LIBRARIAN", line: "1 model", from: 75, to: 80 },
      { kind: "unit", name: "PHANTOM TITAN", line: "1 model", from: 2100, to: null },
      { kind: "detachment", name: "WARHOST", line: "detachment points", from: 2, to: 3 }
    ])
    expect(markedChanges(m)).toContainEqual({ kind: "unit", name: "TERMINATOR SQUAD", line: "5 models (1st to 2nd units)", from: 160, to: 190 })
    expect(markedChanges(m)).toContainEqual({ kind: "enhancement", name: "Imperium’s Sword", in: "ASSAULT BRETHREN", line: "enhancement", from: 25, to: 20 })
  })

  it("treats a page as unchanged when only its change markers differ", () => {
    const unmarked: FieldManual = { ...m, units: m.units.map((u) => ({ ...u, notes: [], costs: u.costs.map((c) => ({ ...c, delta: null })) })) }
    expect(manualHash(unmarked)).toBe(manualHash(m))
    expect(manualHash({ ...m, version: "v1.6" })).not.toBe(manualHash(m))
  })
})

describe("matching a list's unit to its price", () => {
  it("counts models from the line, however the page words it", () => {
    expect(modelCount("5 models")).toBe(5)
    expect(modelCount("1 model")).toBe(1)
    expect(modelCount("11 Gretchin")).toBe(11)
    expect(modelCount("1 Sword Brother, 4 Neophytes, 5 Initiates")).toBe(10)
    expect(modelCount("3 Wolf Guard Headtakers, 3 Hunting Wolves")).toBe(6)
    expect(modelCount("per Storm Shield")).toBeNull()
    expect(modelCount("+ 1 Invader ATV")).toBeNull()
  })

  it("offers every price when a page lists a unit twice", () => {
    const cost = (n: number) => ({ tier: "", description: "1 model", cost: n, delta: null })
    const manual: FieldManual = {
      faction: "IMPERIAL AGENTS",
      version: "v1.5",
      units: [
        { name: "CALLIDUS ASSASSIN", section: "", costs: [cost(100)], wargear: [], attach: null, notes: [] },
        { name: "CALLIDUS ASSASSIN", section: "ASSIGNED AGENTS", costs: [cost(120)], wargear: [], attach: null, notes: [] }
      ],
      detachments: []
    }
    const unit = { id: "callidus-assassin", nm: "Callidus Assassin B", pts: 120, models: 1, rules: [], w: [] } as Unit
    expect(manualUnitFor(manual, unit)?.costs.map((c) => c.cost)).toEqual([100, 120])
    expect(manualUnitFor(manual, { ...unit, nm: "Vindicare Assassin" })).toBeNull()
  })
})

describe("which page prices a faction", () => {
  it("maps list factions to Field Manual pages", () => {
    expect(fieldManualSlug("Asuryani")).toBe("aeldari")
    expect(fieldManualSlug("White Scars")).toBe("space-marines")
    expect(fieldManualSlug("Blood Angels")).toBe("blood-angels")
    expect(fieldManualSlug("T’au Empire")).toBe("tau-empire")
    expect(fieldManualSlug("Emperor’s Children")).toBe("emperors-children")
    expect(fieldManualSlug("Squats")).toBeNull()
    expect(fieldManualSlug("")).toBeNull()
  })
})

// ---------- integration: the pages the app has saved ----------

const saved = (slug: string) => {
  const dir = join("data/mfm", slug)
  const file = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".html")).sort().at(-1) : undefined
  return file ? readFileSync(join(dir, file), "utf8") : null
}
const aeldariPage = saved("aeldari")
const marinesPage = saved("space-marines")

const Repos = Layer.mergeAll(Lists.layer, Rules.layer, Targets.layer, Settings.layer)
const TestLayer = Layer.effectDiscard(seed).pipe(Layer.provideMerge(Repos), Layer.provideMerge(layerAt(":memory:")))

describe.skipIf(!aeldariPage || !marinesPage)("with the saved Field Manual pages", () => {
  const aeldari = () => parseFieldManualTokens(pageTokens(aeldariPage!))
  const marines = () => parseFieldManualTokens(pageTokens(marinesPage!))

  it("parses whole factions", () => {
    const a = aeldari()
    expect(a.faction).toBe("AELDARI")
    expect(a.version).toMatch(/^v\d/)
    expect(a.units.length).toBeGreaterThan(60)
    expect(a.detachments.length).toBeGreaterThan(10)
    expect(new Set(a.units.map((u) => u.name)).size).toBe(a.units.length)
    expect([...new Set(a.units.map((u) => u.section))]).toEqual(["", "HARLEQUINS", "YNNARI"])
    const m = marines()
    expect(m.faction).toBe("SPACE MARINES")
    expect(m.units.length).toBeGreaterThan(80)
    expect(m.units.find((u) => u.name === "KOR’SARRO KHAN")?.section).toBe("WHITE SCARS")
    // every unit is priced by model count, and no change note was mistaken for a heading
    for (const f of [a, m]) {
      expect(f.units.filter((u) => !u.costs.some((c) => /^\d+ models?$/.test(c.description))).map((u) => u.name)).toEqual([])
      expect(f.units.map((u) => u.section).filter((s) => /UPDATED|REMOVED|CHANGED/.test(s))).toEqual([])
    }
  })

  layer(TestLayer)("pricing lists", (it) => {
    it.effect("stores a page once, and again only when its prices move", () =>
      Effect.gen(function*() {
        const a = aeldari()
        const first = yield* saveManual("aeldari", a)
        expect(first?.changesFrom).toBe("page")
        expect(yield* saveManual("aeldari", a)).toBeNull()
        const bumped: FieldManual = { ...a, units: a.units.map((u) => (u.name === "FARSEER" ? { ...u, costs: [{ ...u.costs[0], cost: u.costs[0].cost + 5 }] } : u)) }
        const second = yield* saveManual("aeldari", bumped)
        expect(second?.changesFrom).toBe("previous")
        expect(second?.changes.map((c) => c.name)).toEqual(["FARSEER"])
        // put the real prices back for the tests below
        yield* saveManual("aeldari", a)
        yield* saveManual("space-marines", marines())
        const statuses = yield* manualStatuses
        expect(statuses.map((s) => [s.slug, s.snapshots])).toEqual([["aeldari", 3], ["space-marines", 1]])
        expect(Option.getOrThrow(yield* latestManual("aeldari")).manual.units.find((u) => u.name === "FARSEER")?.costs[0].cost).toBe(a.units.find((u) => u.name === "FARSEER")!.costs[0].cost)
      }))

    it.effect("prices a list from the Field Manual with no Wahapedia export loaded", () =>
      Effect.gen(function*() {
        const list = yield* (yield* Lists).get("builtin-burning-v2")
        const check = yield* checkList(list, yield* (yield* Rules).book)
        expect(check.snapshot).toBeNull()
        expect(check.manual?.slug).toBe("aeldari")
        expect(check.units).toHaveLength(list.units.length)
        expect(check.units.every((u) => u.points?.source === "field-manual")).toBe(true)
        // tiers: the three Skyreavers units are the 1st, 2nd and 3rd of their kind
        expect(check.units.filter((u) => u.unit.startsWith("Corsair Skyreavers")).map((u) => u.points?.expected)).toEqual([140, 75, 75])
      }))

    it.effect("applies Field Manual points and leaves everything else about a unit alone", () =>
      Effect.gen(function*() {
        const cophasta = pocCophasta()
        const list = { units: cophasta.units as Array<Unit>, meta: { name: cophasta.meta.name, faction: cophasta.meta.faction, detachments: cophasta.meta.detachments }, rules: {} }
        const before = yield* pointsDrift(list)
        expect(before?.slug).toBe("space-marines")
        const check = yield* checkList(list, {})
        const updated = list.units.map((u) => applyPoints(u, check.units.find((c) => c.unitId === u.id)!))
        const after = yield* pointsDrift({ ...list, units: updated })
        expect(after?.units).toEqual([])
        expect(after?.total).toBe(updated.reduce((s, u) => s + u.pts, 0))
        updated.forEach((u, i) => {
          expect(u.w).toEqual(list.units[i].w)
          expect(u.stats).toEqual(list.units[i].stats)
          expect(u.rules).toEqual(list.units[i].rules)
        })
        // enhancements are priced from the list's own detachments
        const chaplain = updated.find((u) => u.id === "chaplain-on-bike")!
        expect(chaplain.enh?.pts).toBe(check.units.find((c) => c.unitId === "chaplain-on-bike")!.enhancement!.db)
        expect(chaplain.pts).toBe(check.units.find((c) => c.unitId === "chaplain-on-bike")!.points!.expected! + chaplain.enh!.pts)
      }))

    it.effect("counts a price that includes wargear as right, and keeps it when applying points", () =>
      Effect.gen(function*() {
        const unit = (id: string, nm: string, pts: number, models: number): Unit => ({ id, nm, pts, models, kw: [], rules: [], w: [] })
        const units = [
          // 170 for five, plus five storm shields at 5 each
          unit("tas", "Terminator Assault Squad", 195, 5),
          // 260, plus a heavy laser destroyer at 10
          unit("rex", "Repulsor Executioner", 270, 1),
          // no number of storm shields makes 172
          unit("odd", "Terminator Assault Squad", 172, 5)
        ]
        const list = { units, meta: { name: "Wargear", faction: "Imperial Fists" }, rules: {} }
        const check = yield* checkList(list, {})
        const of = (id: string) => check.units.find((c) => c.unitId === id)!
        expect([of("tas").points?.ok, of("rex").points?.ok, of("odd").points?.ok]).toEqual([true, true, false])
        expect(of("tas").points?.note).toBe("170 pts plus 25 pts of wargear.")
        expect(units.map((u) => applyPoints(u, of(u.id)).pts)).toEqual([195, 270, 170])
        expect((yield* pointsDrift(list))?.units.map((u) => u.unitId)).toEqual(["odd"])
      }))

    it.effect("reports no drift for a faction whose page hasn't been read", () =>
      Effect.gen(function*() {
        expect(yield* pointsDrift({ units: [], meta: { name: "x", faction: "Orks" } })).toBeNull()
      }))
  })
})
