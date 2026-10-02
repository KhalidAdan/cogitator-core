/**
 * The status behind the Database page: do the Field Manual and Wahapedia
 * agree? Runs against the downloaded export and the saved Field Manual page,
 * and skips itself if either is missing.
 */
import { describe, expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { layerAt } from "~/.server/db/Db"
import { pageTokens } from "~/.server/mfm/flight"
import { type FieldManual, parseFieldManualTokens } from "~/.server/mfm/parse"
import { saveManual } from "~/.server/mfm/store"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { seed } from "~/.server/seed/Seed"
import { sourceStatus } from "~/.server/updates"
import { Snapshots } from "~/.server/wahapedia/Snapshots"

const newest = (dir: string, test: (name: string) => boolean) => (existsSync(dir) ? readdirSync(dir).filter(test).sort().at(-1) : undefined)
const exportFolder = newest("data/wahapedia", (n) => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(n))
const page = newest("data/mfm/aeldari", (n) => n.endsWith(".html"))

const Repos = Layer.mergeAll(Lists.layer, Rules.layer, Targets.layer, Settings.layer, Snapshots.layer)
const TestLayer = Layer.effectDiscard(seed).pipe(Layer.provideMerge(Repos), Layer.provideMerge(layerAt(":memory:")))

describe.skipIf(!exportFolder || !page)("whether the two sources agree", () => {
  const manual = () => parseFieldManualTokens(pageTokens(readFileSync(join("data/mfm/aeldari", page!), "utf8")))

  layer(TestLayer, { timeout: "120 seconds" })("status", (it) => {
    it.effect("can't judge until both are loaded", () =>
      Effect.gen(function*() {
        const none = yield* sourceStatus
        expect(none.inStep).toBeNull()
        expect(none.datasheets).toBeNull()
        expect(none.points).toEqual([])
        yield* (yield* Snapshots).loadDirectory(join("data/wahapedia", exportFolder!))
        const half = yield* sourceStatus
        expect(half.datasheets?.manualVersion).toMatch(/^v\d/)
        expect(half.inStep).toBeNull()
      }), 120_000)

    it.effect("agrees when Wahapedia has the Field Manual's prices", () =>
      Effect.gen(function*() {
        // a manual made of units whose price Wahapedia's export already has
        const full = manual()
        const unchanged: FieldManual = { ...full, units: full.units.filter((u) => u.costs.every((c) => c.delta === null) && ["PRINCE YRIEL", "FUEGAN", "WRAITHBLADES"].includes(u.name)) }
        expect(unchanged.units).toHaveLength(3)
        yield* saveManual("aeldari", unchanged)
        const s = yield* sourceStatus
        expect(s.agreement).toEqual([{ slug: "aeldari", faction: "AELDARI", version: full.version, compared: 3, differing: 0, examples: [] }])
        expect(s.inStep).toBe(true)
      }))

    it.effect("says so when Wahapedia is behind, and by how much", () =>
      Effect.gen(function*() {
        const full = manual()
        yield* saveManual("aeldari", full)
        const s = yield* sourceStatus
        const a = s.agreement[0]
        expect(s.inStep).toBe(false)
        expect(a.compared).toBeGreaterThan(60)
        // every unit Wahapedia prices differently is one the page marks as changed in this version
        const marked = new Set(full.units.filter((u) => u.costs.some((c) => c.delta !== null)).map((u) => u.name))
        expect(a.differing).toBeGreaterThan(0)
        expect(a.differing).toBeLessThanOrEqual(marked.size)
        for (const e of a.examples) expect(marked.has(e.unit)).toBe(true)
        // and Wahapedia's stale price is the Field Manual's price before the change
        const example = a.examples[0]
        const line = full.units.find((u) => u.name === example.unit)!.costs.find((c) => c.description === example.line && c.cost === example.manual)!
        expect(example.wahapedia).toContain(line.cost - line.delta!)
      }))
  })
})
