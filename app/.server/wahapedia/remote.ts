/**
 * The Wahapedia export, read straight from wahapedia.ru. This is how the app
 * updates itself: on Cloudflare there is no disk to download to, and nothing
 * needs one, because `Snapshots.load` takes the files one at a time.
 *
 * A polite client: one file at a time with a pause between them, and the
 * export's timestamp is cheap to ask for first, so an unchanged export is never
 * downloaded at all.
 */
import { Effect, Schedule } from "effect"
import { HttpClient } from "effect/http"
import { type ExportSource, SnapshotError } from "./Snapshots"
import { WH_BASE_URL, WH_LAST_UPDATE_FILE } from "./tables"

export const USER_AGENT = "cogitator-core/0.1 (personal list analysis tool; uses the Wahapedia data export)"

export const unreachable = (what: string) => (cause: unknown) =>
  new SnapshotError({
    message:
      `Couldn’t download ${what} from wahapedia.ru (${cause instanceof Error ? cause.message : String(cause)}). ` +
      "If you are on a VPN, try without it: some VPN resolvers fail to look up wahapedia.ru."
  })

/** The timestamp in `Last_update.csv`, `yyyy-MM-dd HH:mm:ss`. */
export function stampOf(text: string): string | null {
  const stamp = text.replace(/^﻿/, "").split("\n")[1]?.replace(/\|\s*$/, "").trim()
  return stamp && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp) ? stamp : null
}

/** A source for `Snapshots.load` that reads from Wahapedia, and the timestamp of the export on offer. */
export const remoteExport = Effect.gen(function*() {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ schedule: Schedule.exponential("500 millis"), times: 3 })
  )
  const text = (file: string) =>
    client.get(`${WH_BASE_URL}/${file}.csv`, { headers: { "User-Agent": USER_AGENT } }).pipe(
      Effect.flatMap((r) => r.text),
      Effect.mapError(unreachable(`${file}.csv`))
    )

  let first = true
  const source: ExportSource = {
    label: WH_BASE_URL,
    read: (file) =>
      Effect.gen(function*() {
        if (!first) yield* Effect.sleep("400 millis")
        first = false
        return yield* text(file)
      })
  }

  const stamp = Effect.flatMap(text(WH_LAST_UPDATE_FILE), (t) => {
    const s = stampOf(t)
    return s ? Effect.succeed(s) : Effect.fail(new SnapshotError({ message: "Last_update.csv didn’t contain a timestamp; the export may have moved or changed format." }))
  })

  return { source, stamp }
})
