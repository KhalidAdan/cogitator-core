/**
 * Node only (the local scripts and tests). A downloaded export folder as a
 * source for `Snapshots.load`.
 */
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem } from "effect"
import { join } from "node:path"
import { type ExportSource, SnapshotError, Snapshots } from "../wahapedia/Snapshots"

export const directorySource = (dir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return {
      label: dir,
      read: (file) =>
        fs.readFileString(join(dir, `${file}.csv`)).pipe(
          Effect.mapError(() => new SnapshotError({ message: `${file}.csv is missing from ${dir}.` }))
        )
    } satisfies ExportSource
  }).pipe(Effect.provide(NodeFileSystem.layer))

/** Load a folder of export CSVs as a new snapshot. */
export const loadDirectory = Effect.fn("loadDirectory")(function*(dir: string, options?: { readonly force?: boolean }) {
  const source = yield* directorySource(dir)
  return yield* (yield* Snapshots).load(source, options)
})
