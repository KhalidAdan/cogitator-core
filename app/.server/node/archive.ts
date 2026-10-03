/**
 * Node only (the local scripts and tests; the deployed app never imports from
 * `.server/node`). Keep each Field Manual page a new snapshot was read from
 * under `data/mfm/<faction>/`, so a parse can be checked against the page later.
 * `COGITATOR_MFM_DIR` moves it.
 */
import { NodeFileSystem } from "@effect/platform-node"
import { Config, DateTime, Effect, FileSystem } from "effect"
import { join } from "node:path"
import type { PageArchive } from "../mfm/refresh"

const PagesRoot = Config.String("COGITATOR_MFM_DIR").pipe(Config.withDefault("data/mfm"))

export const diskArchive: PageArchive = (slug, manual, html) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const dir = join(yield* Effect.orDie(PagesRoot), slug)
    const day = DateTime.formatIso(yield* DateTime.now).slice(0, 10)
    yield* fs.makeDirectory(dir, { recursive: true })
    yield* fs.writeFileString(join(dir, `${manual.version}_${day}.html`), html)
  }).pipe(Effect.ignore, Effect.provide(NodeFileSystem.layer))
