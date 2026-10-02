/**
 * Versioned snapshots of the Wahapedia data export.
 *
 * `loadDirectory` reads a folder of export CSVs, checks every file against the
 * spec, stores the rows under a new snapshot id and writes a change report
 * against the previous snapshot. The newest snapshot is "current"; a few older
 * ones are kept so a dataslate can be compared with what came before.
 */
import { NodeFileSystem } from "@effect/platform-node"
import { Context, DateTime, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { parseExportCsv } from "./csv"
import { buildReport, type ChangeReport, type Row, type TableRows } from "./diff"
import { q, WH_LAST_UPDATE_FILE, WH_TABLES, type WhTable } from "./tables"

export class SnapshotError extends Schema.TaggedError<SnapshotError>()("SnapshotError", {
  message: Schema.String
}) {}

export interface SnapshotFile {
  readonly file: string
  readonly rows: number
  readonly sha256: string
}

export interface SnapshotInfo {
  readonly id: number
  /** Wahapedia's own timestamp for the export (GMT+3), `yyyy-MM-dd HH:mm:ss`. */
  readonly lastUpdate: string
  readonly loadedAt: string
  readonly source: string
  readonly files: ReadonlyArray<SnapshotFile>
  readonly rows: number
  /** False for the first snapshot ever loaded: there was nothing to compare it with. */
  readonly hasReport: boolean
}

export interface LoadResult {
  readonly status: "loaded" | "unchanged"
  readonly snapshot: SnapshotInfo
  readonly report: ChangeReport | null
  readonly warnings: ReadonlyArray<string>
}

/** Older snapshots beyond this many are dropped after a load. */
const KEEP = 3
const CHUNK = 200

// the byte-order mark is not content: a file saved with or without one is the same export
const sha256 = (s: string) => createHash("sha256").update(s.replace(/^﻿/, "")).digest("hex")

const toInfo = (r: { id: number; last_update: string; loaded_at: string; source: string; files: string; has_report: number }): SnapshotInfo => {
  const files = JSON.parse(r.files) as Array<SnapshotFile>
  return {
    id: r.id,
    lastUpdate: r.last_update,
    loadedAt: r.loaded_at,
    source: r.source,
    files,
    rows: files.reduce((s, f) => s + f.rows, 0),
    hasReport: r.has_report !== 0
  }
}

export class Snapshots extends Context.Service<Snapshots, {
  readonly current: Effect.Effect<Option.Option<SnapshotInfo>>
  readonly all: Effect.Effect<Array<SnapshotInfo>>
  report(id: number): Effect.Effect<Option.Option<ChangeReport>>
  /** Load a folder of export CSVs as a new snapshot. A folder identical to the current snapshot is a no-op unless forced. */
  loadDirectory(dir: string, options?: { readonly force?: boolean }): Effect.Effect<LoadResult, SnapshotError>
}>()("cogitator/wahapedia/Snapshots") {
  static readonly layer = Layer.effect(
    Snapshots,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem

      type SnapshotRow = { id: number; last_update: string; loaded_at: string; source: string; files: string; has_report: number }
      const all = sql<SnapshotRow>`
        SELECT id, last_update, loaded_at, source, files, report IS NOT NULL AS has_report FROM wh_snapshots ORDER BY id DESC
      `.pipe(
        Effect.map((rows) => rows.map(toInfo)),
        Effect.orDie,
        Effect.withSpan("Snapshots.all")
      )
      const current = Effect.map(all, (list) => Option.fromNullishOr(list[0]))

      const report = Effect.fn("Snapshots.report")(function*(id: number) {
        const rows = yield* sql<{ report: string | null }>`SELECT report FROM wh_snapshots WHERE id = ${id}`.pipe(Effect.orDie)
        const raw = rows[0]?.report
        return raw ? Option.some(JSON.parse(raw) as ChangeReport) : Option.none<ChangeReport>()
      })

      const readTable = (t: WhTable, snapshotId: number) =>
        sql.unsafe<Record<string, string>>(
          `SELECT ${t.columns.map(q).join(", ")} FROM ${t.table} WHERE snapshot_id = ? ORDER BY row_num`,
          [snapshotId]
        )

      const insertTable = (t: WhTable, snapshotId: number, rows: ReadonlyArray<Row>) =>
        Effect.gen(function*() {
          const cols = ["snapshot_id", "row_num", ...t.columns.map(q)].join(", ")
          const one = `(${new Array(t.columns.length + 2).fill("?").join(", ")})`
          for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK)
            const params: Array<unknown> = []
            chunk.forEach((r, j) => {
              params.push(snapshotId, i + j)
              for (const c of t.columns) params.push(r[c] ?? "")
            })
            yield* sql.unsafe(`INSERT INTO ${t.table} (${cols}) VALUES ${chunk.map(() => one).join(", ")}`, params)
          }
        })

      const dropSnapshot = (id: number) =>
        Effect.gen(function*() {
          for (const t of WH_TABLES) yield* sql.unsafe(`DELETE FROM ${t.table} WHERE snapshot_id = ?`, [id])
          yield* sql`DELETE FROM wh_snapshots WHERE id = ${id}`
        })

      const loadDirectory = Effect.fn("Snapshots.loadDirectory")(
        function*(dir: string, options?: { readonly force?: boolean }) {
          const warnings: Array<string> = []
          const read = (file: string) =>
            fs.readFileString(join(dir, `${file}.csv`)).pipe(
              Effect.mapError(() => new SnapshotError({ message: `${file}.csv is missing from ${dir}.` }))
            )
          const parse = (file: string, text: string) =>
            parseExportCsv(file, text).pipe(Effect.mapError((e) => new SnapshotError({ message: `${e.file}.csv: ${e.message}` })))

          // 1. the export's own timestamp
          const stamp = yield* read(WH_LAST_UPDATE_FILE).pipe(Effect.flatMap((text) => parse(WH_LAST_UPDATE_FILE, text)))
          const lastUpdate = stamp.rows[0]?.[0]?.trim()
          if (!lastUpdate) return yield* new SnapshotError({ message: "Last_update.csv has no timestamp in it." })

          // 2. every table, checked against the spec
          const next: Record<string, Array<Row>> = {}
          const files: Array<SnapshotFile> = []
          for (const t of WH_TABLES) {
            const text = yield* read(t.file)
            const csv = yield* parse(t.file, text)
            const missing = t.columns.filter((c) => !csv.columns.includes(c))
            if (missing.length) {
              return yield* new SnapshotError({
                message: `${t.file}.csv no longer has the column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}. The export format has changed; update app/.server/wahapedia/tables.ts from the spec.`
              })
            }
            const extra = csv.columns.filter((c) => !t.columns.includes(c))
            if (extra.length) warnings.push(`${t.file}.csv has new column${extra.length > 1 ? "s" : ""} (${extra.join(", ")}) that this app ignores.`)
            const index = t.columns.map((c) => csv.columns.indexOf(c))
            next[t.file] = csv.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[index[i]]])))
            files.push({ file: t.file, rows: csv.rows.length, sha256: sha256(text) })
          }

          // 3. nothing new?
          const previous = Option.getOrUndefined(yield* current)
          if (previous && !options?.force && previous.lastUpdate === lastUpdate) {
            const before = new Map(previous.files.map((f) => [f.file, f.sha256]))
            if (files.every((f) => before.get(f.file) === f.sha256)) {
              return { status: "unchanged", snapshot: previous, report: null, warnings } satisfies LoadResult
            }
          }

          // 4. store it, with the change report against what was current
          const loadedAt = DateTime.formatIso(yield* DateTime.now)
          const snapshot = yield* sql.withTransaction(Effect.gen(function*() {
            let changes: ChangeReport | null = null
            if (previous) {
              const prev: Record<string, ReadonlyArray<Row>> = {}
              for (const t of WH_TABLES) prev[t.file] = yield* readTable(t, previous.id)
              changes = buildReport(prev as TableRows, next, { id: previous.id, lastUpdate: previous.lastUpdate }, { lastUpdate })
            }
            yield* sql`
              INSERT INTO wh_snapshots (last_update, loaded_at, source, files, report)
              VALUES (${lastUpdate}, ${loadedAt}, ${dir}, ${JSON.stringify(files)}, ${changes ? JSON.stringify(changes) : null})
            `
            const id = (yield* sql<{ id: number }>`SELECT MAX(id) AS id FROM wh_snapshots`)[0].id
            for (const t of WH_TABLES) yield* insertTable(t, id, next[t.file])
            const stale = yield* sql<{ id: number }>`SELECT id FROM wh_snapshots ORDER BY id DESC LIMIT -1 OFFSET ${KEEP}`
            for (const s of stale) yield* dropSnapshot(s.id)
            const row = { id, last_update: lastUpdate, loaded_at: loadedAt, source: dir, files: JSON.stringify(files), has_report: changes ? 1 : 0 }
            return { info: toInfo(row), changes }
          })).pipe(Effect.orDie)

          yield* Effect.logInfo(`Loaded Wahapedia snapshot ${snapshot.info.id} (${lastUpdate}): ${snapshot.info.rows} rows`)
          return { status: "loaded", snapshot: snapshot.info, report: snapshot.changes, warnings } satisfies LoadResult
        }
      )

      return Snapshots.of({ current, all, report, loadDirectory })
    })
  ).pipe(Layer.provide(NodeFileSystem.layer))
}
