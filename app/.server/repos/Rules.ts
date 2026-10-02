/**
 * The translations library: each official rule, restated as an engine effect.
 *
 * Seeded from the POC's hand-written library, then owned by the database, so
 * adding or correcting a rule is an edit in the app rather than a code change.
 * Each rule can be linked to its Wahapedia text; when a new snapshot changes
 * that text the rule drops back to `draft` for review (see wahapedia/sync).
 */
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"
import { Rule, type RuleBook, RuleStatus } from "~/domain/schema"

export class RuleNotFound extends Schema.TaggedError<RuleNotFound>()("RuleNotFound", {
  id: Schema.String
}) {}

const json = <S extends Schema.Constraint>(schema: S) => Schema.fromJsonString(schema)
const RuleJson = json(Rule)
const encRule = Schema.encodeSync(RuleJson)

const Row = Schema.Struct({
  id: Schema.String,
  faction: Schema.NullOr(Schema.String),
  status: RuleStatus,
  data: RuleJson,
  seed: Schema.NullOr(Schema.String),
  raw: Schema.String,
  wh_kind: Schema.NullOr(Schema.String),
  wh_text: Schema.NullOr(Schema.String),
  wh_hash: Schema.NullOr(Schema.String),
  wh_snapshot_id: Schema.NullOr(Schema.Number),
  notes: Schema.String,
  updated_at: Schema.String
})

export interface RuleEntry {
  readonly id: string
  readonly rule: Rule
  readonly status: RuleStatus
  readonly faction: string | null
  readonly notes: string
  /** Changed in the app since it was seeded. */
  readonly edited: boolean
  readonly seeded: boolean
  /** The official text this translation was last checked against. */
  readonly wh: { readonly kind: string; readonly text: string; readonly hash: string; readonly snapshotId: number | null } | null
  readonly updatedAt: string
}

export interface RuleSeed {
  readonly id: string
  readonly rule: Rule
  readonly status: RuleStatus
  readonly faction?: string | null
}

const toEntry = (r: typeof Row.Type): RuleEntry => ({
  id: r.id,
  rule: r.data,
  status: r.status,
  faction: r.faction,
  notes: r.notes,
  edited: r.seed !== null && r.seed !== r.raw,
  seeded: r.seed !== null,
  wh: r.wh_hash !== null ? { kind: r.wh_kind ?? "", text: r.wh_text ?? "", hash: r.wh_hash, snapshotId: r.wh_snapshot_id } : null,
  updatedAt: r.updated_at
})

export class Rules extends Context.Service<Rules, {
  /** Every library rule, keyed by id: what the engine is handed. */
  readonly book: Effect.Effect<RuleBook>
  readonly all: Effect.Effect<Array<RuleEntry>>
  get(id: string): Effect.Effect<RuleEntry, RuleNotFound>
  save(id: string, input: { rule: Rule; status: RuleStatus; notes?: string; faction?: string | null }): Effect.Effect<void>
  /** Change the review status; `note` is added to the top of the rule's notes. */
  setStatus(id: string, status: RuleStatus, note?: string): Effect.Effect<void>
  resetToSeed(id: string): Effect.Effect<void, RuleNotFound>
  remove(id: string): Effect.Effect<void>
  /** Insert seeds that are not in the library yet; never overwrites. */
  seed(entries: ReadonlyArray<RuleSeed>): Effect.Effect<number>
  link(id: string, wh: { kind: string; text: string; hash: string; snapshotId: number }): Effect.Effect<void>
}>()("cogitator/repos/Rules") {
  static readonly layer = Layer.effect(
    Rules,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const now = Effect.map(DateTime.now, DateTime.formatIso)
      const select = sql.literal(
        "SELECT id, faction, status, data, seed, data AS raw, wh_kind, wh_text, wh_hash, wh_snapshot_id, notes, updated_at FROM rules"
      )

      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Row,
        execute: () => sql`${select} ORDER BY faction, name`
      })
      const findOne = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Row,
        execute: (id) => sql`${select} WHERE id = ${id}`
      })

      const all = findAll().pipe(Effect.map((rows) => rows.map(toEntry)), Effect.orDie, Effect.withSpan("Rules.all"))
      const book = all.pipe(Effect.map((entries): RuleBook => Object.fromEntries(entries.map((e) => [e.id, e.rule]))))

      const get = Effect.fn("Rules.get")(function*(id: string) {
        const row = yield* findOne(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new RuleNotFound({ id })
        return toEntry(row.value)
      })

      const save = Effect.fn("Rules.save")(
        function*(id: string, input: { rule: Rule; status: RuleStatus; notes?: string; faction?: string | null }) {
          const ts = yield* now
          const data = encRule(input.rule)
          yield* sql`
            INSERT INTO rules (id, name, faction, status, data, seed, notes, updated_at)
            VALUES (${id}, ${input.rule.nm}, ${input.faction ?? null}, ${input.status}, ${data}, NULL, ${input.notes ?? ""}, ${ts})
            ON CONFLICT (id) DO UPDATE SET
              name = excluded.name, status = excluded.status, data = excluded.data,
              notes = COALESCE(${input.notes ?? null}, rules.notes),
              faction = COALESCE(${input.faction ?? null}, rules.faction),
              updated_at = excluded.updated_at
          `.pipe(Effect.orDie)
        }
      )

      const setStatus = Effect.fn("Rules.setStatus")(function*(id: string, status: RuleStatus, note?: string) {
        const ts = yield* now
        yield* sql`
          UPDATE rules SET status = ${status}, updated_at = ${ts},
            notes = CASE WHEN ${note ?? ""} = '' THEN notes WHEN notes = '' THEN ${note ?? ""} ELSE ${note ?? ""} || char(10) || notes END
          WHERE id = ${id}
        `.pipe(Effect.orDie)
      })

      const resetToSeed = Effect.fn("Rules.resetToSeed")(function*(id: string) {
        const ts = yield* now
        const entry = yield* get(id)
        if (!entry.seeded) return
        yield* sql`UPDATE rules SET data = seed, updated_at = ${ts} WHERE id = ${id}`.pipe(Effect.orDie)
      })

      const remove = Effect.fn("Rules.remove")(function*(id: string) {
        yield* sql`DELETE FROM rules WHERE id = ${id}`.pipe(Effect.orDie)
      })

      const seed = Effect.fn("Rules.seed")(function*(entries: ReadonlyArray<RuleSeed>) {
        const ts = yield* now
        const have = new Set((yield* sql<{ id: string }>`SELECT id FROM rules`.pipe(Effect.orDie)).map((r) => r.id))
        const missing = entries.filter((e) => !have.has(e.id))
        yield* sql.withTransaction(
          Effect.forEach(missing, (e) => {
            const data = encRule(e.rule)
            return sql`
              INSERT INTO rules (id, name, faction, status, data, seed, notes, updated_at)
              VALUES (${e.id}, ${e.rule.nm}, ${e.faction ?? null}, ${e.status}, ${data}, ${data}, '', ${ts})
            `
          }, { discard: true })
        ).pipe(Effect.orDie)
        return missing.length
      })

      const link = Effect.fn("Rules.link")(
        function*(id: string, wh: { kind: string; text: string; hash: string; snapshotId: number }) {
          yield* sql`
            UPDATE rules SET wh_kind = ${wh.kind}, wh_text = ${wh.text}, wh_hash = ${wh.hash}, wh_snapshot_id = ${wh.snapshotId}
            WHERE id = ${id}
          `.pipe(Effect.orDie)
        }
      )

      return Rules.of({ book, all, get, save, setStatus, resetToSeed, remove, seed, link })
    })
  )
}
