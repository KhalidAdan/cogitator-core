/**
 * First-run data: the POC's rules library, benchmark targets and the built-in
 * Aeldari list (see scripts/poc-export.mjs for where the JSON comes from).
 *
 * Seeding only ever adds what is missing. Rules you have edited, lists you
 * have changed and targets you have tuned are left alone; bump `VERSION` when
 * the seed file gains entries that existing databases should pick up.
 */
import { Effect, Layer, Option, Schema } from "effect"
import { Group, ListMeta, Opts, Rule, RuleStatus, Target, Unit } from "~/domain/schema"
import { Lists } from "../repos/Lists"
import { Rules } from "../repos/Rules"
import { ACTIVE_LIST, SEED_VERSION, Settings } from "../repos/Settings"
import { Targets } from "../repos/Targets"
import { LIBRARY_RULES } from "./library"
import raw from "./poc-seed.json"

const VERSION = 4

/** Built-in lists that used to be seeded and are removed from existing databases on upgrade. */
const RETIRED_LISTS = ["builtin-cophasta", "builtin-burning-v1"]

/** Built-in lists seeded under another name before: renamed on upgrade, unless you have renamed them yourself. */
const FORMER_NAMES: Record<string, string> = { "builtin-burning-v2": "The Burning One and the Exile v2" }

const SeedFile = Schema.Struct({
  rules: Schema.Record(Schema.String, Rule),
  ruleStatus: Schema.Record(Schema.String, RuleStatus),
  ruleFaction: Schema.Record(Schema.String, Schema.String),
  targets: Schema.Array(Target),
  opts: Opts,
  lists: Schema.Array(Schema.Struct({
    id: Schema.String,
    meta: ListMeta,
    groups: Schema.Record(Schema.String, Group),
    armyRules: Schema.Array(Schema.String),
    rules: Schema.Record(Schema.String, Rule),
    units: Schema.Array(Unit)
  })),
  defaultListId: Schema.String,
  factionArmyRules: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  detachmentRules: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  detachmentUnitGrants: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Struct({ name: Schema.String, rule: Schema.String }))
  ),
  bareDatasheetRulesOff: Schema.Array(Schema.String)
})

/** The seed file, validated. A malformed seed is a programming error, so this throws at import. */
export const seedData = Schema.decodeUnknownSync(SeedFile)(raw)

export const seed = Effect.gen(function*() {
  const settings = yield* Settings
  const current = Option.getOrElse(yield* settings.get(SEED_VERSION), () => "0")
  if (Number(current) >= VERSION) return

  const rules = yield* Rules
  const targets = yield* Targets
  const lists = yield* Lists

  const added = yield* rules.seed([
    ...Object.entries(seedData.rules).map(([id, rule]) => ({
      id,
      rule,
      status: seedData.ruleStatus[id] ?? ("note" as const),
      faction: seedData.ruleFaction[id] ?? null
    })),
    ...LIBRARY_RULES
  ])
  if ((yield* targets.count) === 0) yield* targets.replaceAll(seedData.targets)
  for (const l of seedData.lists) {
    if (!(yield* lists.exists(l.id))) {
      yield* lists.create({ ...l, builtin: true, opts: seedData.opts })
      continue
    }
    const former = FORMER_NAMES[l.id]
    if (former && (yield* lists.get(l.id).pipe(Effect.orDie)).meta.name === former) yield* lists.rename(l.id, l.meta.name)
  }
  for (const id of RETIRED_LISTS) {
    if (yield* lists.exists(id)) yield* lists.remove(id)
  }
  const active = Option.getOrUndefined(yield* settings.get(ACTIVE_LIST))
  if (!active || RETIRED_LISTS.includes(active)) yield* settings.set(ACTIVE_LIST, seedData.defaultListId)
  yield* settings.set(SEED_VERSION, String(VERSION))
  yield* Effect.logInfo(`Seeded the database: ${added} new rules, ${seedData.targets.length} targets, ${seedData.lists.length} built-in ${seedData.lists.length === 1 ? "list" : "lists"}`)
}).pipe(Effect.withSpan("seed"))

export const SeedLive = Layer.effectDiscard(seed)
