/**
 * Load a folder of Wahapedia export CSVs into the database as a new snapshot.
 *
 *   npm run wahapedia:load                      # newest folder under data/wahapedia
 *   npm run wahapedia:load -- data/wahapedia/2026-09-28_023804
 *   npm run wahapedia:load -- --force           # reload even if nothing changed
 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { DbLive } from "../app/.server/db/Db.ts"
import { reportHasChanges } from "../app/.server/wahapedia/diff.ts"
import { latestExportFolder } from "../app/.server/wahapedia/folders.ts"
import { Snapshots } from "../app/.server/wahapedia/Snapshots.ts"

const args = process.argv.slice(2)
const force = args.includes("--force")
const dirArg = args.find((a) => !a.startsWith("--"))

const program = Effect.gen(function*() {
  const dir = dirArg ?? (yield* latestExportFolder)
  const snapshots = yield* Snapshots
  const result = yield* snapshots.loadDirectory(dir, { force })
  for (const w of result.warnings) yield* Effect.logWarning(w)
  if (result.status === "unchanged") {
    yield* Effect.log(`Nothing new: ${dir} is identical to snapshot ${result.snapshot.id} (${result.snapshot.lastUpdate}).`)
    return
  }
  yield* Effect.log(`Snapshot ${result.snapshot.id} loaded from ${dir}: export of ${result.snapshot.lastUpdate}, ${result.snapshot.rows} rows.`)
  const r = result.report
  if (!r) yield* Effect.log("First snapshot, so there is nothing to compare it with.")
  else if (!reportHasChanges(r)) yield* Effect.log("No differences from the previous snapshot.")
  else {
    yield* Effect.log(
      `Against ${r.from?.lastUpdate}: ${r.totals.points} points changes, ${r.totals.weapons} weapon changes, ` +
        `${r.totals.abilities} ability changes, ${r.totals.datasheetsAdded} datasheets added, ${r.totals.datasheetsRemoved} removed. ` +
        "Open /database in the app for the full report."
    )
  }
})

program.pipe(
  Effect.provide(Snapshots.layer.pipe(Layer.provideMerge(DbLive))),
  NodeRuntime.runMain
)
