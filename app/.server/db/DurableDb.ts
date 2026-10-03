/**
 * The app's database on Cloudflare: the SQLite storage of the Durable Object
 * that serves every request (`workers/app.ts`), with the same migrations as the
 * Node database in `Db.ts`, which the tests and local scripts use.
 *
 * Transactions go through the object's storage API, so `sql.withTransaction`
 * behaves as it does on Node.
 */
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-do"
import { Layer } from "effect"
import { migrations } from "./migrations"

type Storage = Parameters<typeof SqliteClient.layer>[0]["storage"]

/** A migrated database in this Durable Object's storage. */
export const durableDb = (storage: NonNullable<Storage>) =>
  SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) }).pipe(
    Layer.provideMerge(SqliteClient.layer({ storage })),
    Layer.orDie
  )
