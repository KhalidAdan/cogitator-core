/**
 * The Effect layers end to end against an in-memory SQLite database:
 * migrations, seed, repositories.
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { attackUnit } from "~/domain/engine"
import { bareDatasheetOpts } from "~/domain/options"
import { layerAt } from "~/.server/db/Db"
import { saveRule } from "~/.server/library"
import { ListNotFound, Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { ACTIVE_LIST, SEED_VERSION, Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { LIBRARY_RULES } from "~/.server/seed/library"
import { seed, seedData } from "~/.server/seed/Seed"

const Repos = Layer.mergeAll(Lists.layer, Rules.layer, Targets.layer, Settings.layer)
const TestLayer = Layer.effectDiscard(seed).pipe(Layer.provideMerge(Repos), Layer.provideMerge(layerAt(":memory:")))
/** An empty database, for setting up what an older version left behind before seeding. */
const Unseeded = Repos.pipe(Layer.provideMerge(layerAt(":memory:")))

describe("database", () => {
  it.effect("seeds the library, targets and built-in lists, once", () =>
    Effect.gen(function*() {
      const lists = yield* Lists
      const rules = yield* Rules
      const targets = yield* Targets
      expect((yield* lists.all).map((l) => [l.id, l.name])).toEqual([["builtin-burning-v2", "The Burning One and the Exile"]])
      // the POC's library plus the rules translated since (seed/library.ts)
      expect(Object.keys(yield* rules.book)).toHaveLength(Object.keys(seedData.rules).length + LIBRARY_RULES.length)
      expect((yield* rules.get("despoilers")).status).toBe("draft")
      expect(yield* targets.all).toHaveLength(19)
      // running the seed again adds nothing
      yield* seed
      expect(yield* lists.all).toHaveLength(1)
      const summary = (yield* lists.all).find((l) => l.id === "builtin-burning-v2")!
      expect(summary.pts).toBe(2000)
      // 20 datasheets, 16 units on the table once the four leaders join their units
      expect([summary.units, summary.datasheets]).toEqual([16, 20])
    }).pipe(Effect.provide(TestLayer)))

  it.effect("round-trips a list through SQLite without changing the maths", () =>
    Effect.gen(function*() {
      const list = yield* (yield* Lists).get("builtin-burning-v2")
      const book = yield* (yield* Rules).book
      const targets = yield* (yield* Targets).all
      const yriel = { ...list.units.find((u) => u.id === "prince-yriel")!, pts: 95 }
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

  it.effect("upgrading retires v1, renames v2 and moves you off a list that is gone", () =>
    Effect.gen(function*() {
      const lists = yield* Lists
      const settings = yield* Settings
      // a database as seed version 3 left it: both Aeldari lists, v1 open
      const [v2] = seedData.lists
      yield* lists.create({ ...v2, id: "builtin-burning-v1", builtin: true, meta: { ...v2.meta, name: "The Burning One and the Exile" } })
      yield* lists.create({ ...v2, builtin: true, meta: { ...v2.meta, name: "The Burning One and the Exile v2" } })
      yield* settings.set(SEED_VERSION, "3")
      yield* settings.set(ACTIVE_LIST, "builtin-burning-v1")
      yield* seed
      expect((yield* lists.all).map((l) => [l.id, l.name])).toEqual([["builtin-burning-v2", "The Burning One and the Exile"]])
      expect(Option.getOrUndefined(yield* settings.get(ACTIVE_LIST))).toBe("builtin-burning-v2")
    }).pipe(Effect.provide(Unseeded)))

  it.effect("leaves a built-in list you renamed yourself alone", () =>
    Effect.gen(function*() {
      const lists = yield* Lists
      const settings = yield* Settings
      yield* lists.create({ ...seedData.lists[0], builtin: true, meta: { ...seedData.lists[0].meta, name: "Yriel’s Raiders" } })
      yield* settings.set(SEED_VERSION, "3")
      yield* seed
      expect((yield* lists.all).map((l) => l.name)).toEqual(["Yriel’s Raiders"])
    }).pipe(Effect.provide(Unseeded)))

  it.effect("fails with a typed error for a list that isn’t there", () =>
    Effect.gen(function*() {
      const error = yield* (yield* Lists).get("nope").pipe(Effect.flip)
      expect(error).toBeInstanceOf(ListNotFound)
      expect(error.id).toBe("nope")
    }).pipe(Effect.provide(TestLayer)))

  it.effect("brings seeded rules nobody edited up to date with the seed, and leaves edited ones", () =>
    Effect.gen(function*() {
      const rules = yield* Rules
      const settings = yield* Settings
      yield* seed
      // as an older seed left them: one rule never touched, one edited since
      const old = (id: string) => LIBRARY_RULES.find((r) => r.id === id)!
      const stale = { ...old("daring-recon"), rule: { ...old("daring-recon").rule, txt: "older wording" } }
      const edited = { ...old("stand-vigil"), rule: { ...old("stand-vigil").rule, txt: "older wording" } }
      yield* rules.remove("daring-recon")
      yield* rules.remove("stand-vigil")
      yield* rules.seed([stale, edited])
      yield* rules.save("stand-vigil", { rule: { ...edited.rule, txt: "my wording" }, status: "draft" })
      yield* settings.set(SEED_VERSION, "5")
      yield* seed
      expect((yield* rules.get("daring-recon")).rule.txt).toBe(old("daring-recon").rule.txt)
      expect((yield* rules.get("daring-recon")).edited).toBe(false)
      expect((yield* rules.get("stand-vigil")).rule.txt).toBe("my wording")
    }).pipe(Effect.provide(Unseeded)))

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

describe("saving a rule (the rule editor and the MCP's save_rule)", () => {
  it.effect("keeps what an edit leaves out, and clears what the form empties", () =>
    Effect.gen(function*() {
      const rules = yield* Rules
      const before = (yield* rules.get("daring-recon")).rule
      expect(before.fx).toEqual([{ phase: "ranged", rrHit: "ones" }])
      // an agent's edit: only the words
      yield* saveRule("daring-recon", { txt: "Re-roll hit rolls of 1 when shooting.", status: "draft" })
      const worded = yield* rules.get("daring-recon")
      expect(worded.rule).toEqual({ ...before, txt: "Re-roll hit rolls of 1 when shooting." })
      expect(worded.status).toBe("draft")
      // the form sends every field; an empty one clears it, but an empty name keeps the name
      const blank = { nm: "", src: "", txt: "", scope: "", cond: "", condNm: "", condTxt: "", mark: "", markNm: "", markTxt: "", notes: "", faction: "" }
      yield* saveRule("daring-recon", { ...blank, dmg: false, global: false, fx: [], status: "note" })
      const cleared = yield* rules.get("daring-recon")
      expect(cleared.rule).toEqual({ nm: "Daring Recon", src: before.src, txt: "", dmg: false })
      expect(cleared.status).toBe("note")
    }).pipe(Effect.provide(TestLayer)))

  it.effect("refuses a misspelt field with where it is, and saves nothing", () =>
    Effect.gen(function*() {
      const rules = yield* Rules
      const before = yield* rules.get("despoilers")
      const error = yield* Effect.flip(saveRule("despoilers", { fx: [{ phase: "melee" }, { wond: 1 }], status: "draft" }))
      expect(error._tag).toBe("SchemaError")
      expect(String(error.message)).toMatch(/\[1\]\["wond"\]/)
      expect((yield* rules.get("despoilers")).rule).toEqual(before.rule)
    }).pipe(Effect.provide(TestLayer)))

  it.effect("adds a rule only when asked to, and counts effects given without saying", () =>
    Effect.gen(function*() {
      const rules = yield* Rules
      expect((yield* Effect.flip(saveRule("blood-for-the-guns", { nm: "Blood for the Guns", status: "draft" })))._tag).toBe("RuleNotFound")
      const saved = yield* saveRule(
        "blood-for-the-guns",
        { nm: "Blood for the Guns", fx: { phase: "ranged", ap: 1 }, status: "draft", note: "Drafted by a test.", faction: "CSM" },
        { create: true }
      )
      expect(saved.created).toBe(true)
      const entry = yield* rules.get("blood-for-the-guns")
      // one clause on its own is a list of one; effects without `dmg` mean it changes damage
      expect(entry.rule).toEqual({ nm: "Blood for the Guns", src: "Datasheet", txt: "", dmg: true, fx: [{ phase: "ranged", ap: 1 }] })
      expect([entry.status, entry.faction, entry.notes]).toEqual(["draft", "CSM", "Drafted by a test."])
      // a later note goes on top
      yield* saveRule("blood-for-the-guns", { status: "draft", note: "Checked the AP." }, { create: true })
      expect((yield* rules.get("blood-for-the-guns")).notes).toBe("Checked the AP.\nDrafted by a test.")
    }).pipe(Effect.provide(TestLayer)))

  it.effect("gives a condition other rules wait for the label they use", () =>
    Effect.gen(function*() {
      const rules = yield* Rules
      yield* saveRule("daring-recon", { cond: "darkpact", status: "draft" })
      const r = (yield* rules.get("daring-recon")).rule
      expect([r.cond, r.condNm]).toEqual(["darkpact", "Made a Dark Pact this phase"])
      expect(r.condTxt).toMatch(/Despoilers/)
      // a built-in switch keeps its own label and needs no line of help
      yield* saveRule("daring-recon", { cond: "stationary", status: "draft" })
      const s = (yield* rules.get("daring-recon")).rule
      expect([s.cond, s.condNm, s.condTxt]).toEqual(["stationary", "Remained stationary", undefined])
    }).pipe(Effect.provide(TestLayer)))
})
