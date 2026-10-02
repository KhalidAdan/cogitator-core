/**
 * Download the Wahapedia data export.
 *
 * The export is a set of static CSV files that the site's author regenerates
 * whenever the site changes; `Last_update.csv` says when. Each download goes
 * into its own folder named after that timestamp, so every snapshot in the
 * database can be traced back to the exact files it was built from.
 *
 * Be a polite client: the files are fetched one at a time with a pause between
 * them, and nothing is downloaded if the timestamp hasn't moved.
 */
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Schedule } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { join } from "node:path"
import { ExportRoot, folderForStamp } from "./folders"
import { SnapshotError } from "./Snapshots"
import { WH_ALL_FILES, WH_BASE_URL, WH_EXPORT_PAGE, WH_LAST_UPDATE_FILE } from "./tables"

export interface FetchResult {
  readonly status: "downloaded" | "up-to-date"
  readonly dir: string
  readonly lastUpdate: string
  readonly files: number
}

const USER_AGENT = "cogitator-core/0.1 (personal list analysis tool; uses the Wahapedia data export)"

const unreachable = (what: string) => (cause: unknown) =>
  new SnapshotError({
    message:
      `Couldn’t download ${what} from wahapedia.ru (${cause instanceof Error ? cause.message : String(cause)}). ` +
      "If you are on a VPN, try without it: some VPN resolvers fail to look up wahapedia.ru."
  })

export const fetchExport = Effect.fn("wahapedia.fetchExport")(function*(options?: { readonly force?: boolean }) {
  const fs = yield* FileSystem.FileSystem
  const root = yield* Effect.orDie(ExportRoot)
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ schedule: Schedule.exponential("500 millis"), times: 3 })
  )
  const download = (url: string, what: string) =>
    client.get(url, { headers: { "User-Agent": USER_AGENT } }).pipe(
      Effect.flatMap((r) => r.arrayBuffer),
      Effect.map((b) => new Uint8Array(b)),
      Effect.mapError(unreachable(what))
    )

  const stampBytes = yield* download(`${WH_BASE_URL}/${WH_LAST_UPDATE_FILE}.csv`, "the export timestamp")
  const lastUpdate = new TextDecoder().decode(stampBytes).replace(/^﻿/, "").split("\n")[1]?.replace(/\|\s*$/, "").trim()
  if (!lastUpdate || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(lastUpdate)) {
    return yield* new SnapshotError({ message: "Last_update.csv didn’t contain a timestamp; the export may have moved or changed format." })
  }

  const dir = join(root, folderForStamp(lastUpdate))
  const complete = yield* Effect.forEach(WH_ALL_FILES, (f) => fs.exists(join(dir, `${f}.csv`))).pipe(
    Effect.map((all) => all.every(Boolean)),
    Effect.orElseSucceed(() => false)
  )
  if (complete && !options?.force) {
    return { status: "up-to-date", dir, lastUpdate, files: WH_ALL_FILES.length } satisfies FetchResult
  }

  // download into a scratch folder and rename, so a failed run never leaves a half-filled export behind
  const partial = `${dir}.partial`
  const io = <A>(effect: Effect.Effect<A, unknown>) => effect.pipe(Effect.mapError((e) => new SnapshotError({ message: `Couldn’t write the export to ${dir}: ${String(e)}` })))
  yield* io(fs.remove(partial, { recursive: true, force: true }))
  yield* io(fs.makeDirectory(partial, { recursive: true }))
  yield* io(fs.writeFile(join(partial, `${WH_LAST_UPDATE_FILE}.csv`), stampBytes))
  for (const file of WH_ALL_FILES) {
    if (file === WH_LAST_UPDATE_FILE) continue
    const bytes = yield* download(`${WH_BASE_URL}/${file}.csv`, `${file}.csv`)
    yield* io(fs.writeFile(join(partial, `${file}.csv`), bytes))
    yield* Effect.logInfo(`Downloaded ${file}.csv (${Math.round(bytes.length / 1024)} kB)`)
    yield* Effect.sleep("400 millis")
  }

  // the specification spreadsheet is worth keeping next to the data it describes; losing it is not an error
  yield* Effect.gen(function*() {
    const page = new TextDecoder().decode(yield* download(WH_EXPORT_PAGE, "the export page"))
    const href = page.match(/href="([^"]*Export%20Data%20Specs\.xlsx[^"]*)"/)?.[1]
    if (!href) return
    const spec = yield* download(new URL(href, WH_EXPORT_PAGE).toString(), "the specification")
    yield* fs.writeFile(join(partial, "Export Data Specs.xlsx"), spec)
  }).pipe(Effect.ignore)

  yield* io(fs.remove(dir, { recursive: true, force: true }))
  yield* io(fs.rename(partial, dir))
  return { status: "downloaded", dir, lastUpdate, files: WH_ALL_FILES.length } satisfies FetchResult
})

/** `fetchExport` with its HTTP client and file system supplied. */
export const fetchExportLive = (options?: { readonly force?: boolean }) =>
  fetchExport(options).pipe(Effect.provide(FetchHttpClient.layer), Effect.provide(NodeFileSystem.layer))
