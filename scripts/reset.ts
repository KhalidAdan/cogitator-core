/**
 * Delete the database so the next start seeds it from scratch:
 *
 *   npm run db:reset
 *
 * Imported lists, rule edits and loaded snapshots are lost; the downloaded
 * Wahapedia exports under data/wahapedia are kept and reloaded on next start.
 * Stop the app first, or the file will be in use.
 */
import { NodeFileSystem, NodeRuntime } from "@effect/platform-node"
import { Effect, FileSystem } from "effect"
import { DbPath } from "../app/.server/db/Db.ts"

const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* DbPath
  for (const file of [path, `${path}-wal`, `${path}-shm`]) yield* fs.remove(file, { force: true })
  yield* Effect.log(`Removed ${path}. Start the app to recreate it.`)
})

program.pipe(Effect.provide(NodeFileSystem.layer), NodeRuntime.runMain)
