/** A small key/value store for app-wide state (the list last opened, the seed version…). */
import { Context, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"

export class Settings extends Context.Service<Settings, {
  get(key: string): Effect.Effect<Option.Option<string>>
  set(key: string, value: string): Effect.Effect<void>
}>()("cogitator/repos/Settings") {
  static readonly layer = Layer.effect(
    Settings,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const get = Effect.fn("Settings.get")(function*(key: string) {
        const rows = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${key}`.pipe(Effect.orDie)
        return Option.fromNullishOr(rows[0]?.value)
      })

      const set = Effect.fn("Settings.set")(function*(key: string, value: string) {
        yield* sql`
          INSERT INTO settings (key, value) VALUES (${key}, ${value})
          ON CONFLICT (key) DO UPDATE SET value = excluded.value
        `.pipe(Effect.orDie)
      })

      return Settings.of({ get, set })
    })
  )
}

export const ACTIVE_LIST = "active_list"
export const SEED_VERSION = "seed_version"
/** When the app last looked for updates, and how the Wahapedia half of that went (JSON). */
export const UPDATES_CHECKED_AT = "updates_checked_at"
export const WAHAPEDIA_CHECK = "wahapedia_check"
