/** The benchmark defenders every list is scored against. Editable; resettable to the calibrated set. */
import { Context, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"
import { Target } from "~/domain/schema"

const TargetJson = Schema.fromJsonString(Target)
const enc = Schema.encodeSync(TargetJson)
const Row = Schema.Struct({ data: TargetJson })

export class Targets extends Context.Service<Targets, {
  readonly all: Effect.Effect<Array<Target>>
  save(target: Target): Effect.Effect<void>
  /** Add a target at the end of the set, or replace the one with the same id. */
  add(target: Target): Effect.Effect<void>
  remove(id: string): Effect.Effect<void>
  /** Replace the whole set (used for seeding and "restore defaults"). */
  replaceAll(targets: ReadonlyArray<Target>): Effect.Effect<void>
  readonly count: Effect.Effect<number>
}>()("cogitator/repos/Targets") {
  static readonly layer = Layer.effect(
    Targets,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const find = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Row,
        execute: () => sql`SELECT data FROM targets ORDER BY position`
      })
      const all = find().pipe(Effect.map((rows) => rows.map((r) => r.data)), Effect.orDie, Effect.withSpan("Targets.all"))

      const save = Effect.fn("Targets.save")(function*(target: Target) {
        yield* sql`UPDATE targets SET data = ${enc(target)} WHERE id = ${target.id}`.pipe(Effect.orDie)
      })

      const add = Effect.fn("Targets.add")(function*(target: Target) {
        yield* sql`
          INSERT INTO targets (id, position, data)
          VALUES (${target.id}, (SELECT COALESCE(MAX(position), 0) + 1 FROM targets), ${enc(target)})
          ON CONFLICT (id) DO UPDATE SET data = excluded.data
        `.pipe(Effect.orDie)
      })

      const remove = Effect.fn("Targets.remove")(function*(id: string) {
        yield* sql`DELETE FROM targets WHERE id = ${id}`.pipe(Effect.orDie)
      })

      const replaceAll = Effect.fn("Targets.replaceAll")(function*(targets: ReadonlyArray<Target>) {
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`DELETE FROM targets`
          yield* Effect.forEach(
            targets,
            (t, i) => sql`INSERT INTO targets (id, position, data) VALUES (${t.id}, ${i}, ${enc(t)})`,
            { discard: true }
          )
        })).pipe(Effect.orDie)
      })

      const count = sql<{ n: number }>`SELECT COUNT(*) AS n FROM targets`.pipe(Effect.map((r) => r[0].n), Effect.orDie)

      return Targets.of({ all, save, add, remove, replaceAll, count })
    })
  )
}
