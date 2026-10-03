/**
 * Download the current Wahapedia export into data/wahapedia/<timestamp>/, where
 * the integration tests read it. (The app itself reads the export straight from
 * Wahapedia when it updates; nothing here touches it.)
 *
 *   npm run wahapedia:fetch             # download if the export has changed
 *   npm run wahapedia:fetch -- --force  # download regardless
 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { fetchExportLive } from "../app/.server/node/fetch.ts"

const force = process.argv.slice(2).includes("--force")

const program = Effect.gen(function*() {
  const fetched = yield* fetchExportLive({ force })
  yield* Effect.log(
    fetched.status === "downloaded"
      ? `Downloaded the export of ${fetched.lastUpdate} into ${fetched.dir}.`
      : `Already have the export of ${fetched.lastUpdate} in ${fetched.dir}.`
  )
})

program.pipe(NodeRuntime.runMain)
