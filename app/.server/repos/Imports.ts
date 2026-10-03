/**
 * Uploaded rosters waiting to be reviewed. Keeping the upload server-side
 * means the review page can be reloaded or linked to, and saving re-parses the
 * original file rather than trusting anything the browser sends back.
 */
import { Context, DateTime, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"

export interface PendingImport {
  readonly id: string
  readonly fileName: string
  readonly rosterXml: string
  readonly textExport: string
  /** The account that uploaded it; only they can review or save it. */
  readonly ownerId: string | null
}

export class Imports extends Context.Service<Imports, {
  add(input: Omit<PendingImport, "id">): Effect.Effect<string>
  get(id: string): Effect.Effect<Option.Option<PendingImport>>
  remove(id: string): Effect.Effect<void>
}>()("cogitator/repos/Imports") {
  static readonly layer = Layer.effect(
    Imports,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const add = Effect.fn("Imports.add")(function*(input: Omit<PendingImport, "id">) {
        const now = yield* DateTime.now
        const id = `${DateTime.toEpochMillis(now).toString(36)}${Math.random().toString(36).slice(2, 8)}`
        // abandoned uploads don't need to live long
        const cutoff = DateTime.formatIso(DateTime.subtract(now, { days: 2 }))
        yield* sql`DELETE FROM pending_imports WHERE created_at < ${cutoff}`.pipe(Effect.orDie)
        yield* sql`
          INSERT INTO pending_imports (id, file_name, roster_xml, text_export, owner_id, created_at)
          VALUES (${id}, ${input.fileName}, ${input.rosterXml}, ${input.textExport}, ${input.ownerId}, ${DateTime.formatIso(now)})
        `.pipe(Effect.orDie)
        return id
      })

      const get = Effect.fn("Imports.get")(function*(id: string) {
        const rows = yield* sql<{ id: string; file_name: string; roster_xml: string; text_export: string; owner_id: string | null }>`
          SELECT id, file_name, roster_xml, text_export, owner_id FROM pending_imports WHERE id = ${id}
        `.pipe(Effect.orDie)
        return Option.fromNullishOr(rows[0]).pipe(
          Option.map((r): PendingImport => ({
            id: r.id,
            fileName: r.file_name,
            rosterXml: r.roster_xml,
            textExport: r.text_export,
            ownerId: r.owner_id
          }))
        )
      })

      const remove = Effect.fn("Imports.remove")(function*(id: string) {
        yield* sql`DELETE FROM pending_imports WHERE id = ${id}`.pipe(Effect.orDie)
      })

      return Imports.of({ add, get, remove })
    })
  )
}
