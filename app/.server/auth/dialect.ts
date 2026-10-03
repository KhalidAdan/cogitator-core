/**
 * A Kysely dialect that hands each query to a function. better-auth speaks
 * Kysely; the app's database is Effect's `SqlClient` (the Durable Object's
 * SQLite on Cloudflare, `node:sqlite` in the tests). Running better-auth's
 * queries through the same client keeps one connection, one set of
 * migrations, and the same code in both places.
 *
 * better-auth is configured without transactions (`transaction: false`), so
 * none are offered here: a Durable Object can't run `BEGIN` as SQL anyway.
 */
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler
} from "kysely"

/** Run one statement with positional (`?`) parameters and return its rows. */
export type Execute = (sql: string, params: ReadonlyArray<unknown>) => Promise<ReadonlyArray<Record<string, unknown>>>

/** SQLite binds strings, numbers and nulls; better-auth also passes dates and booleans. */
const bindable = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v)

class Connection implements DatabaseConnection {
  constructor(private readonly execute: Execute) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const rows = await this.execute(query.sql, query.parameters.map(bindable))
    return { rows: rows as Array<R> }
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("Streaming queries aren't supported.")
  }
}

class ExecuteDriver implements Driver {
  constructor(private readonly execute: Execute) {}
  async init() {}
  async acquireConnection() {
    return new Connection(this.execute)
  }
  async beginTransaction(): Promise<void> {
    throw new Error("Transactions aren't supported; better-auth is configured with `transaction: false`.")
  }
  async commitTransaction() {}
  async rollbackTransaction() {}
  async releaseConnection() {}
  async destroy() {}
}

export class ExecuteDialect implements Dialect {
  constructor(private readonly execute: Execute) {}
  createAdapter() {
    return new SqliteAdapter()
  }
  createDriver() {
    return new ExecuteDriver(this.execute)
  }
  createIntrospector(db: Kysely<unknown>) {
    return new SqliteIntrospector(db)
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler()
  }
}
