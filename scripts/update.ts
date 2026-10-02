/**
 * Check for updates to the rules database, the same as the button on the
 * Database page: the Field Manual for every faction in use, then Wahapedia.
 *
 *   npm run update
 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { DbLive } from "../app/.server/db/Db.ts"
import { Lists } from "../app/.server/repos/Lists.ts"
import { Rules } from "../app/.server/repos/Rules.ts"
import { Settings } from "../app/.server/repos/Settings.ts"
import { checkForUpdates, sourceStatus } from "../app/.server/updates.ts"
import { Snapshots } from "../app/.server/wahapedia/Snapshots.ts"

const program = Effect.gen(function*() {
  const r = yield* checkForUpdates()
  for (const p of r.points) yield* p.status === "failed" ? Effect.logWarning(p.message) : Effect.log(`Points: ${p.message}`)
  yield* r.datasheets.status === "failed" ? Effect.logWarning(r.datasheets.message) : Effect.log(`Datasheets: ${r.datasheets.message}`)
  if (r.reworded.length) yield* Effect.log(`Reworded rules, now drafts: ${r.reworded.join(", ")}`)
  const s = yield* sourceStatus
  if (s.inStep === false) {
    const behind = s.agreement.filter((a) => a.differing > 0)
    yield* Effect.logWarning(
      `Wahapedia hasn't caught up with the Field Manual: ${behind.map((a) => `${a.faction} ${a.differing} units`).join(", ")} priced differently there.`
    )
  } else if (s.inStep) yield* Effect.log("The two sources are in step.")
})

program.pipe(
  Effect.provide(Layer.mergeAll(Lists.layer, Rules.layer, Settings.layer, Snapshots.layer).pipe(Layer.provideMerge(DbLive))),
  NodeRuntime.runMain
)
