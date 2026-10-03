/**
 * Memo tables for data that can't change under its key. A Wahapedia snapshot
 * never changes once loaded (a new export is a new snapshot, and snapshot ids
 * are never reused), and neither does a stored Field Manual page, so whatever
 * is read or derived from one can be kept instead of read again.
 *
 * Tables are kept per database connection, so tests that each open their own
 * in-memory database never see each other's entries. Each table keeps its most
 * recent entries only.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

const tables = new WeakMap<object, Map<string, Map<string, unknown>>>()

/**
 * `compute`'s result for `key`, from the table if it is there. `limit` bounds
 * the table; the oldest entry goes first.
 */
export const memo = <A, E, R>(table: string, key: string | number, compute: Effect.Effect<A, E, R>, limit = 8) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    let byTable = tables.get(sql)
    if (!byTable) tables.set(sql, (byTable = new Map()))
    let t = byTable.get(table)
    if (!t) byTable.set(table, (t = new Map()))
    const k = String(key)
    if (t.has(k)) return t.get(k) as A
    const value = yield* compute
    t.set(k, value)
    if (t.size > limit) t.delete(t.keys().next().value!)
    return value
  })

/**
 * The entries of `table` already held for these keys, and the keys that aren't,
 * for queries that fetch many things by id and want to ask only for the missing ones.
 */
export const memoMany = <A>(table: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    let byTable = tables.get(sql)
    if (!byTable) tables.set(sql, (byTable = new Map()))
    let t = byTable.get(table)
    if (!t) byTable.set(table, (t = new Map()))
    const store = t as Map<string, A>
    return {
      get: (key: string) => store.get(key),
      set: (key: string, value: A) => void store.set(key, value),
      size: () => store.size,
      clearIfOver: (n: number) => {
        if (store.size > n) store.clear()
      }
    }
  })
