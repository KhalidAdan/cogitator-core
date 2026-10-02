/**
 * The SQLite layer: a `SqlClient` on `node:sqlite` with migrations applied.
 * Everything that touches the database depends on `SqlClient` and is given
 * this layer at the edge (the app runtime, a script, a test).
 */
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Config, Effect, Layer } from "effect"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { migrations } from "./migrations"

/** `COGITATOR_DB` overrides where the database file lives. */
export const DbPath = Config.String("COGITATOR_DB").pipe(Config.withDefault("data/cogitator.db"))

const MigratorLayer = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) })

/** A migrated database at `filename` (`":memory:"` for tests). */
export const layerAt = (filename: string) => {
  if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true })
  return MigratorLayer.pipe(Layer.provideMerge(SqliteClient.layer({ filename })), Layer.orDie)
}

/** The app's database, located by config. */
export const DbLive = Layer.unwrap(Effect.map(DbPath, layerAt)).pipe(Layer.orDie)
