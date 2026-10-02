/** Where downloaded exports live on disk: one folder per export timestamp. */
import { NodeFileSystem } from "@effect/platform-node"
import { Config, Effect, FileSystem } from "effect"
import { join } from "node:path"
import { SnapshotError } from "./Snapshots"

/** `COGITATOR_WAHAPEDIA_DIR` overrides the folder downloads are kept in. */
export const ExportRoot = Config.String("COGITATOR_WAHAPEDIA_DIR").pipe(Config.withDefault("data/wahapedia"))

/** `2026-09-28 02:38:04` → `2026-09-28_023804`. */
export const folderForStamp = (lastUpdate: string) => lastUpdate.trim().replace(" ", "_").replace(/:/g, "")

const isExportFolder = (name: string) => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(name)

/** Every export folder on disk, oldest first (they sort by name). */
export const exportFolders = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const root = yield* Effect.orDie(ExportRoot)
  const names = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed((): Array<string> => []))
  return names.filter(isExportFolder).sort().map((n) => join(root, n))
}).pipe(Effect.provide(NodeFileSystem.layer))

/** The most recent export folder. */
export const latestExportFolder = Effect.gen(function*() {
  const folders = yield* exportFolders
  const latest = folders[folders.length - 1]
  if (!latest) return yield* new SnapshotError({ message: "No Wahapedia export has been downloaded yet. Run “npm run wahapedia:fetch” first." })
  return latest
})
