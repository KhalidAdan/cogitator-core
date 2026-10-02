/**
 * Create or upgrade the database without starting the app:
 *
 *   npm run db:migrate
 *
 * (The app does the same thing on start-up; this is for scripts and CI.)
 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { DbLive, DbPath } from "../app/.server/db/Db.ts"

const program = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const applied = yield* sql<{ migration_id: number; name: string }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`
  yield* Effect.log(`${yield* DbPath} is at migration ${applied.map((m) => `${m.migration_id}_${m.name}`).join(", ")}.`)
})

program.pipe(Effect.provide(DbLive), NodeRuntime.runMain)
