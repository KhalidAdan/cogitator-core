/**
 * Download the current Wahapedia export and load it as a new snapshot.
 *
 *   npm run wahapedia:fetch             # download if the export has changed, then load
 *   npm run wahapedia:fetch -- --force  # download and load regardless
 *   npm run wahapedia:fetch -- --download-only
 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { DbLive } from "../app/.server/db/Db.ts"
import { Rules } from "../app/.server/repos/Rules.ts"
import { reportHasChanges } from "../app/.server/wahapedia/diff.ts"
import { fetchExportLive } from "../app/.server/wahapedia/fetch.ts"
import { Snapshots } from "../app/.server/wahapedia/Snapshots.ts"
import { syncRules } from "../app/.server/wahapedia/sync.ts"

const args = process.argv.slice(2)
const force = args.includes("--force")
const downloadOnly = args.includes("--download-only")

const program = Effect.gen(function*() {
  const fetched = yield* fetchExportLive({ force })
  yield* Effect.log(
    fetched.status === "downloaded"
      ? `Downloaded the export of ${fetched.lastUpdate} into ${fetched.dir}.`
      : `Already have the export of ${fetched.lastUpdate} in ${fetched.dir}.`
  )
  if (downloadOnly) return
  const result = yield* (yield* Snapshots).loadDirectory(fetched.dir, { force })
  for (const w of result.warnings) yield* Effect.logWarning(w)
  if (result.status === "unchanged") {
    yield* Effect.log(`The database already holds this export as snapshot ${result.snapshot.id}.`)
  } else {
    yield* Effect.log(`Loaded snapshot ${result.snapshot.id}: ${result.snapshot.rows} rows.`)
    const r = result.report
    if (r && reportHasChanges(r)) {
      yield* Effect.log(
        `Since ${r.from?.lastUpdate}: ${r.totals.points} points changes, ${r.totals.weapons} weapon changes, ${r.totals.abilities} ability changes. See /database in the app.`
      )
    }
  }
  const sync = yield* syncRules
  yield* Effect.log(`Rules library: ${sync.linked.length} newly linked, ${sync.changed.length} changed, ${sync.unchanged} unchanged, ${sync.unlinked.length} without official text.`)
})

program.pipe(
  Effect.provide(Layer.mergeAll(Snapshots.layer, Rules.layer).pipe(Layer.provideMerge(DbLive))),
  NodeRuntime.runMain
)
