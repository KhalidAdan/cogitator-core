/**
 * Schema migrations, keyed `<id>_<name>` and run once each, in id order, when
 * the database layer is built (so `npm run dev` on a fresh checkout just works).
 *
 * Shape of the store:
 * - `lists` + `list_units`: an army list. Units are JSON documents (the shape
 *   the engine consumes) with the as-imported copy kept alongside for "reset".
 * - `rules`: the translations library — official rule → engine effect (`fx`),
 *   with a review status. Seeded from the POC, edited in the app.
 * - `targets`: the benchmark defenders.
 * - `settings`: small key/value store (active list…).
 * - `mfm_*`: points from the Munitorum Field Manual, per faction and version.
 * - `wh_*`: versioned snapshots of the Wahapedia data export. Every row carries
 *   its `snapshot_id`; columns are the export's own, stored as text.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { q, WH_TABLES } from "../wahapedia/tables"

const createWahapediaTables = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  for (const t of WH_TABLES) {
    const cols = t.columns.map((c) => `${q(c)} TEXT NOT NULL DEFAULT ''`).join(", ")
    yield* sql.unsafe(
      `CREATE TABLE ${t.table} (snapshot_id INTEGER NOT NULL, row_num INTEGER NOT NULL, ${cols}, PRIMARY KEY (snapshot_id, row_num))`
    )
    yield* sql.unsafe(`CREATE INDEX ${t.table}_key ON ${t.table} (snapshot_id, ${t.key.map(q).join(", ")})`)
  }
  // lookups the mapper makes by name
  yield* sql.unsafe(`CREATE INDEX wh_datasheets_name ON wh_datasheets (snapshot_id, name)`)
  yield* sql.unsafe(`CREATE INDEX wh_enhancements_name ON wh_enhancements (snapshot_id, name)`)
})

export const migrations = {
  "0001_core": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        builtin INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        meta TEXT NOT NULL,
        groups TEXT NOT NULL,
        army_rules TEXT NOT NULL,
        rules TEXT NOT NULL,
        opts TEXT NOT NULL,
        roster_xml TEXT,
        text_export TEXT,
        game_system TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    yield* sql`
      CREATE TABLE list_units (
        list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        datasheet_id TEXT,
        data TEXT NOT NULL,
        base TEXT NOT NULL,
        PRIMARY KEY (list_id, unit_id)
      )
    `
    yield* sql`
      CREATE TABLE rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        faction TEXT,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        seed TEXT,
        wh_kind TEXT,
        wh_text TEXT,
        wh_hash TEXT,
        wh_snapshot_id INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )
    `
    yield* sql`CREATE TABLE targets (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL)`
    yield* sql`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  }),
  "0002_wahapedia": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE wh_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last_update TEXT NOT NULL,
        loaded_at TEXT NOT NULL,
        source TEXT NOT NULL,
        files TEXT NOT NULL,
        report TEXT
      )
    `
    yield* createWahapediaTables
  }),
  // an uploaded roster waiting to be reviewed and saved as a list
  "0003_pending_imports": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE pending_imports (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        roster_xml TEXT NOT NULL,
        text_export TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `
  }),
  // points from the Munitorum Field Manual: one row per faction per distinct set of prices
  "0004_field_manual": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE mfm_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL,
        faction TEXT NOT NULL,
        version TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        hash TEXT NOT NULL,
        data TEXT NOT NULL,
        changes TEXT NOT NULL,
        changes_from TEXT NOT NULL
      )
    `
    yield* sql`CREATE INDEX mfm_snapshots_slug ON mfm_snapshots (slug, id)`
    yield* sql`CREATE TABLE mfm_checks (slug TEXT PRIMARY KEY, checked_at TEXT NOT NULL, ok INTEGER NOT NULL, message TEXT NOT NULL)`
  })
}
