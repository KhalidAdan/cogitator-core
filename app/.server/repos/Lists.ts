/**
 * Army lists. A list row holds the metadata, its imported rules and its
 * options; each unit is its own row with the current document and the
 * as-imported one (`base`) so edits can be undone.
 */
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"
import { defaultOpts } from "~/domain/options"
import { ArmyList, Group, ListMeta, Opts, Rule, Unit } from "~/domain/schema"

export class ListNotFound extends Schema.TaggedError<ListNotFound>()("ListNotFound", {
  id: Schema.String
}) {}

export class ListSummary extends Schema.Class<ListSummary>("ListSummary")({
  id: Schema.String,
  name: Schema.String,
  builtin: Schema.Boolean,
  units: Schema.Number,
  pts: Schema.Number,
  faction: Schema.String,
  ownerId: Schema.NullOr(Schema.String)
}) {}

/** What the importer (or the seed) hands over to be stored. */
export interface NewList {
  readonly id?: string
  readonly builtin?: boolean
  readonly meta: ListMeta
  readonly groups: Readonly<Record<string, Group>>
  readonly armyRules: ReadonlyArray<string>
  readonly rules: Readonly<Record<string, Rule>>
  readonly units: ReadonlyArray<Unit>
  readonly opts?: Opts
  readonly rosterXml?: string | null
  readonly textExport?: string | null
  readonly gameSystem?: string | null
  /** The account importing it; none for the built-in list. */
  readonly ownerId?: string | null
}

const json = <S extends Schema.Constraint>(schema: S) => Schema.fromJsonString(schema)
const ListRow = Schema.Struct({
  id: Schema.String,
  builtin: Schema.Number,
  meta: json(ListMeta),
  groups: json(Schema.Record(Schema.String, Group)),
  army_rules: json(Schema.Array(Schema.String)),
  rules: json(Schema.Record(Schema.String, Rule)),
  opts: json(Opts),
  owner_id: Schema.NullOr(Schema.String)
})
const UnitRow = Schema.Struct({ data: json(Unit) })
const SummaryRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  builtin: Schema.Number,
  meta: json(ListMeta),
  units: Schema.Number,
  pts: Schema.Number,
  owner_id: Schema.NullOr(Schema.String)
})

const encUnit = Schema.encodeSync(json(Unit))
const encOpts = Schema.encodeSync(json(Opts))
const encMeta = Schema.encodeSync(json(ListMeta))
const encRules = Schema.encodeSync(json(Schema.Record(Schema.String, Rule)))
const encGroups = Schema.encodeSync(json(Schema.Record(Schema.String, Group)))

export class Lists extends Context.Service<Lists, {
  readonly all: Effect.Effect<Array<ListSummary>>
  get(id: string): Effect.Effect<ArmyList, ListNotFound>
  /** The roster file and text export a list was imported from, when kept. */
  sources(id: string): Effect.Effect<{ rosterXml: string | null; textExport: string | null }, ListNotFound>
  create(list: NewList): Effect.Effect<string>
  setOpts(id: string, opts: Opts): Effect.Effect<void>
  /** Read, change and store a list's options as one step, so quick successive toggles can't overwrite each other. */
  updateOpts(id: string, f: (list: ArmyList) => Opts): Effect.Effect<Opts, ListNotFound>
  saveUnit(listId: string, unit: Unit): Effect.Effect<void>
  /** Replace every unit (and make that the new baseline). */
  replaceUnits(listId: string, units: ReadonlyArray<Unit>): Effect.Effect<void>
  /** Replace what was read from the roster (units, rules, groups, army rules), keeping the name and options. */
  replaceContent(id: string, content: Pick<NewList, "units" | "rules" | "groups" | "armyRules">): Effect.Effect<void>
  /** Units back to as-imported, options back to table defaults. */
  reset(id: string): Effect.Effect<void>
  rename(id: string, name: string): Effect.Effect<void>
  remove(id: string): Effect.Effect<void>
  exists(id: string): Effect.Effect<boolean>
  /** Give an account's lists to the site's owner (no owner), when the account is removed. */
  releaseOwner(ownerId: string): Effect.Effect<void>
}>()("cogitator/repos/Lists") {
  static readonly layer = Layer.effect(
    Lists,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const now = Effect.map(DateTime.now, DateTime.formatIso)

      const findList = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: ListRow,
        execute: (id) => sql`SELECT id, builtin, meta, groups, army_rules, rules, opts, owner_id FROM lists WHERE id = ${id}`
      })
      const findUnits = SqlSchema.findAll({
        Request: Schema.String,
        Result: UnitRow,
        execute: (id) => sql`SELECT data FROM list_units WHERE list_id = ${id} ORDER BY position`
      })
      const summaries = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SummaryRow,
        execute: () =>
          sql`
            SELECT l.id, l.name, l.builtin, l.meta, l.owner_id,
                   COUNT(u.unit_id) AS units,
                   COALESCE(SUM(json_extract(u.data, '$.pts')), 0) AS pts
            FROM lists l LEFT JOIN list_units u ON u.list_id = l.id
            GROUP BY l.id
            ORDER BY l.builtin DESC, l.position, l.created_at
          `
      })

      const all = summaries().pipe(
        Effect.map((rows) =>
          rows.map((r) =>
            new ListSummary({
              id: r.id,
              name: r.name,
              builtin: r.builtin !== 0,
              units: r.units,
              pts: r.pts,
              faction: r.meta.faction ?? "",
              ownerId: r.owner_id
            })
          )
        ),
        Effect.orDie,
        Effect.withSpan("Lists.all")
      )

      const get = Effect.fn("Lists.get")(function*(id: string) {
        const row = yield* findList(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new ListNotFound({ id })
        const units = yield* findUnits(id).pipe(Effect.orDie)
        const l = row.value
        return {
          id: l.id,
          builtin: l.builtin !== 0,
          meta: l.meta,
          groups: l.groups,
          armyRules: l.army_rules,
          rules: l.rules,
          units: units.map((u) => u.data),
          opts: l.opts,
          ownerId: l.owner_id
        } satisfies ArmyList
      })

      const exists = (id: string) =>
        sql<{ n: number }>`SELECT COUNT(*) AS n FROM lists WHERE id = ${id}`.pipe(
          Effect.map((r) => r[0].n > 0),
          Effect.orDie
        )

      const sources = Effect.fn("Lists.sources")(function*(id: string) {
        const rows = yield* sql<{ roster_xml: string | null; text_export: string | null }>`
          SELECT roster_xml, text_export FROM lists WHERE id = ${id}
        `.pipe(Effect.orDie)
        if (rows.length === 0) return yield* new ListNotFound({ id })
        return { rosterXml: rows[0].roster_xml, textExport: rows[0].text_export }
      })

      const insertUnits = (listId: string, units: ReadonlyArray<Unit>) =>
        Effect.forEach(units, (u, i) => {
          const data = encUnit(u)
          return sql`
            INSERT INTO list_units (list_id, unit_id, position, datasheet_id, data, base)
            VALUES (${listId}, ${u.id}, ${i}, ${u.datasheetId ?? null}, ${data}, ${data})
          `
        }, { discard: true })

      const create = Effect.fn("Lists.create")(function*(list: NewList) {
        const ts = yield* now
        const id = list.id ?? `L${Date.parse(ts).toString(36)}${Math.random().toString(36).slice(2, 6)}`
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`DELETE FROM list_units WHERE list_id = ${id}`
          yield* sql`DELETE FROM lists WHERE id = ${id}`
          const position = yield* sql<{ n: number }>`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM lists`
          yield* sql`
            INSERT INTO lists (id, name, builtin, position, meta, groups, army_rules, rules, opts, roster_xml, text_export, game_system, owner_id, created_at, updated_at)
            VALUES (${id}, ${list.meta.name}, ${list.builtin ? 1 : 0}, ${position[0].n}, ${encMeta(list.meta)},
                    ${encGroups(list.groups)}, ${JSON.stringify(list.armyRules)}, ${encRules(list.rules)},
                    ${encOpts(list.opts ?? defaultOpts())}, ${list.rosterXml ?? null}, ${list.textExport ?? null},
                    ${list.gameSystem ?? null}, ${list.ownerId ?? null}, ${ts}, ${ts})
          `
          yield* insertUnits(id, list.units)
        })).pipe(Effect.orDie)
        return id
      })

      const touch = (id: string) => Effect.flatMap(now, (ts) => sql`UPDATE lists SET updated_at = ${ts} WHERE id = ${id}`)

      const setOpts = Effect.fn("Lists.setOpts")(function*(id: string, opts: Opts) {
        yield* sql`UPDATE lists SET opts = ${encOpts(opts)} WHERE id = ${id}`.pipe(Effect.orDie)
      })

      const updateOpts = Effect.fn("Lists.updateOpts")(function*(id: string, f: (list: ArmyList) => Opts) {
        return yield* sql.withTransaction(Effect.gen(function*() {
          const next = f(yield* get(id))
          yield* sql`UPDATE lists SET opts = ${encOpts(next)} WHERE id = ${id}`.pipe(Effect.orDie)
          return next
        })).pipe(Effect.catchTag("SqlError", Effect.die))
      })

      const saveUnit = Effect.fn("Lists.saveUnit")(function*(listId: string, unit: Unit) {
        yield* sql`
          UPDATE list_units SET data = ${encUnit(unit)}, datasheet_id = ${unit.datasheetId ?? null}
          WHERE list_id = ${listId} AND unit_id = ${unit.id}
        `.pipe(Effect.andThen(touch(listId)), Effect.orDie)
      })

      const replaceUnits = Effect.fn("Lists.replaceUnits")(function*(listId: string, units: ReadonlyArray<Unit>) {
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`DELETE FROM list_units WHERE list_id = ${listId}`
          yield* insertUnits(listId, units)
          yield* touch(listId)
        })).pipe(Effect.orDie)
      })

      const replaceContent = Effect.fn("Lists.replaceContent")(
        function*(id: string, content: Pick<NewList, "units" | "rules" | "groups" | "armyRules">) {
          yield* sql.withTransaction(Effect.gen(function*() {
            yield* sql`
              UPDATE lists SET groups = ${encGroups(content.groups)}, army_rules = ${JSON.stringify(content.armyRules)}, rules = ${encRules(content.rules)}
              WHERE id = ${id}
            `
            yield* sql`DELETE FROM list_units WHERE list_id = ${id}`
            yield* insertUnits(id, content.units)
            yield* touch(id)
          })).pipe(Effect.orDie)
        }
      )

      const reset = Effect.fn("Lists.reset")(function*(id: string) {
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`UPDATE list_units SET data = base WHERE list_id = ${id}`
          yield* sql`UPDATE lists SET opts = ${encOpts(defaultOpts())} WHERE id = ${id}`
          yield* touch(id)
        })).pipe(Effect.orDie)
      })

      const rename = Effect.fn("Lists.rename")(function*(id: string, name: string) {
        yield* sql`
          UPDATE lists SET name = ${name}, meta = json_set(meta, '$.name', ${name}) WHERE id = ${id}
        `.pipe(Effect.andThen(touch(id)), Effect.orDie)
      })

      const remove = Effect.fn("Lists.remove")(function*(id: string) {
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`DELETE FROM list_units WHERE list_id = ${id}`
          yield* sql`DELETE FROM lists WHERE id = ${id}`
        })).pipe(Effect.orDie)
      })

      const releaseOwner = Effect.fn("Lists.releaseOwner")(function*(ownerId: string) {
        yield* sql`UPDATE lists SET owner_id = NULL WHERE owner_id = ${ownerId}`.pipe(Effect.orDie)
        yield* sql`DELETE FROM pending_imports WHERE owner_id = ${ownerId}`.pipe(Effect.orDie)
      })

      return Lists.of({
        all,
        get,
        sources,
        create,
        setOpts,
        updateOpts,
        saveUnit,
        replaceUnits,
        replaceContent,
        reset,
        rename,
        remove,
        exists,
        releaseOwner
      })
    })
  )
}
