/**
 * The Effect layers end to end against an in-memory SQLite database:
 * migrations, seed, repositories.
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { attackUnit } from "~/domain/engine"
import { bareDatasheetOpts } from "~/domain/options"
import { layerAt } from "~/.server/db/Db"
import { ListNotFound, Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { LIBRARY_RULES } from "~/.server/seed/library"
import { seed, seedData } from "~/.server/seed/Seed"

const Repos = Layer.mergeAll(Lists.layer, Rules.layer, Targets.layer, Settings.layer)
const TestLayer = Layer.effectDiscard(seed).pipe(Layer.provideMerge(Repos), Layer.provideMerge(layerAt(":memory:")))

describe("database", () => {
  it.effect("seeds the library, targets and built-in lists, once", () =>
    Effect.gen(function*() {
      const lists = yield* Lists
      const rules = yield* Rules
      const targets = yield* Targets
      expect((yield* lists.all).map((l) => l.id).sort()).toEqual(["builtin-burning-v1", "builtin-burning-v2"])
      // the POC's library plus the rules translated since (seed/library.ts)
      expect(Object.keys(yield* rules.book)).toHaveLength(Object.keys(seedData.rules).length + LIBRARY_RULES.length)
      expect((yield* rules.get("despoilers")).status).toBe("draft")
      expect(yield* targets.all).toHaveLength(19)
      // running the seed again adds nothing
      yield* seed
      expect(yield* lists.all).toHaveLength(2)
      const summary = (yield* lists.all).find((l) => l.id === "builtin-burning-v2")!
      expect(summary.pts).toBe(2000)
      expect(summary.units).toBe(20)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("round-trips a list through SQLite without changing the maths", () =>
    Effect.gen(function*() {
      const list = yield* (yield* Lists).get("builtin-burning-v1")
      const book = yield* (yield* Rules).book
      const targets = yield* (yield* Targets).all
      const yriel = { ...list.units.find((u) => u.id === "yriel")!, pts: 95 }
      const r = attackUnit(yriel, targets.find((t) => t.id === "warp-spiders")!, bareDatasheetOpts(list.units), { rules: book, units: list.units })
      expect(r.total.toFixed(2)).toBe("3.98")
      expect(r.roi.toFixed(1)).toBe("88.0")
    }).pipe(Effect.provide(TestLayer)))

  it.effect("stores options and unit edits, and resets them", () =>
    Effect.gen(function*() {
      const lists = yield* Lists
      const id = "builtin-burning-v2"
      const before = yield* lists.get(id)
      yield* lists.setOpts(id, { ...before.opts, phase: "melee", flags: { charged: false, riven: true } })
      const fuegan = before.units.find((u) => u.id === "fuegan")!
      yield* lists.saveUnit(id, { ...fuegan, pts: 999 })
      const edited = yield* lists.get(id)
      expect(edited.opts.phase).toBe("melee")
      expect(edited.opts.flags).toEqual({ charged: false, riven: true })
      expect(edited.units.find((u) => u.id === "fuegan")!.pts).toBe(999)
      expect(edited.units.map((u) => u.id)).toEqual(before.units.map((u) => u.id))
      yield* lists.reset(id)
      const after = yield* lists.get(id)
      expect(after.units).toEqual(before.units)
      expect(after.opts.phase).toBe("all")
    }).pipe(Effect.provide(TestLayer)))

  it.effect("fails with a typed error for a list that isn’t there", () =>
    Effect.gen(function*() {
      const error = yield* (yield* Lists).get("nope").pipe(Effect.flip)
      expect(error).toBeInstanceOf(ListNotFound)
      expect(error.id).toBe("nope")
    }).pipe(Effect.provide(TestLayer)))

  it.effect("keeps rule edits separate from the seed, and can undo them", () =>
    Effect.gen(function*() {
      const rules = yield* Rules
      const entry = yield* rules.get("thunderstrike")
      expect(entry.status).toBe("verified")
      expect(entry.edited).toBe(false)
      yield* rules.save("thunderstrike", { rule: { ...entry.rule, fx: [{ phase: "ranged", wound: 1 }] }, status: "draft", notes: "testing" })
      const edited = yield* rules.get("thunderstrike")
      expect(edited.edited).toBe(true)
      expect(edited.status).toBe("draft")
      expect(edited.notes).toBe("testing")
      yield* rules.resetToSeed("thunderstrike")
      expect((yield* rules.get("thunderstrike")).rule).toEqual(entry.rule)
    }).pipe(Effect.provide(TestLayer)))
})
