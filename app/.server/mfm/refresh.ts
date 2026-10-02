/**
 * Check the Munitorum Field Manual for new points.
 *
 * Games Workshop publishes points on https://mfm.warhammer-community.com, one
 * page per faction, and updates them without notice (the v1.5 update landed on
 * the morning of 2 October 2026, two days after Wahapedia's export). This
 * fetches a faction's page, parses it, and stores a new snapshot when the
 * prices have moved.
 *
 * It asks for one page per faction, a second apart, and only for factions that
 * have a list in the app unless told otherwise.
 */
import { NodeFileSystem } from "@effect/platform-node"
import { Config, DateTime, Effect, FileSystem, Schedule } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { join } from "node:path"
import { Lists } from "../repos/Lists"
import { fieldManualSlug, mfmUrl } from "./factions"
import { parseFieldManual } from "./parse"
import { lastChecked, type ManualSnapshot, manualStatuses, recordCheck, saveManual } from "./store"

export interface RefreshResult {
  readonly slug: string
  readonly status: "new" | "unchanged" | "failed" | "skipped"
  readonly faction: string
  readonly version: string
  readonly message: string
  /** Number of prices that moved, when a new snapshot was stored. */
  readonly changes: number
}

/** `COGITATOR_MFM_DIR` overrides where fetched pages are kept. */
const PagesRoot = Config.String("COGITATOR_MFM_DIR").pipe(Config.withDefault("data/mfm"))

// The site serves its app shell to anything, but answers plain clients more reliably with a browser-like agent.
const USER_AGENT = "Mozilla/5.0 (compatible; cogitator-core/0.1; personal list analysis tool)"

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Fetch and store one faction page. Never fails: a problem becomes a `failed` result and a recorded check. */
export const refreshFaction = Effect.fn("mfm.refreshFaction")(function*(slug: string) {
  const fs = yield* FileSystem.FileSystem
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ schedule: Schedule.exponential("500 millis"), times: 2 })
  )
  const attempt = Effect.gen(function*() {
    const html = yield* client.get(mfmUrl(slug), { headers: { "User-Agent": USER_AGENT } }).pipe(Effect.flatMap((r) => r.text))
    const manual = yield* parseFieldManual(html)
    const stored: ManualSnapshot | null = yield* saveManual(slug, manual)
    if (stored) {
      // keep the page a snapshot was built from, next to the database
      const dir = join(yield* Effect.orDie(PagesRoot), slug)
      const day = DateTime.formatIso(yield* DateTime.now).slice(0, 10)
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(
        Effect.andThen(fs.writeFileString(join(dir, `${manual.version}_${day}.html`), html)),
        Effect.ignore
      )
    }
    const message = stored
      ? `${manual.faction} ${manual.version}: ${stored.changes.length} price${stored.changes.length === 1 ? "" : "s"} changed.`
      : `${manual.faction} ${manual.version}: no change.`
    yield* recordCheck(slug, true, message)
    return {
      slug,
      status: stored ? "new" : "unchanged",
      faction: manual.faction,
      version: manual.version,
      message,
      changes: stored?.changes.length ?? 0
    } satisfies RefreshResult
  })
  return yield* attempt.pipe(
    Effect.catch((e) =>
      Effect.gen(function*() {
        const message = `Couldn’t read the Field Manual page for ${slug}: ${describe(e)}`
        yield* recordCheck(slug, false, message)
        yield* Effect.logWarning(message)
        return { slug, status: "failed", faction: slug, version: "", message, changes: 0 } satisfies RefreshResult
      })
    )
  )
})

/** The faction pages worth watching: one per faction that has a list, plus any already stored. */
export const slugsInUse = Effect.gen(function*() {
  const lists = yield* (yield* Lists).all
  const fromLists = lists.map((l) => fieldManualSlug(l.faction)).filter((s): s is NonNullable<typeof s> => s !== null)
  const stored = (yield* manualStatuses).map((s) => s.slug)
  return [...new Set<string>([...fromLists, ...stored])].sort()
})

/**
 * Check several faction pages, politely. With `olderThan`, pages checked more
 * recently than that many hours ago are skipped, which is what lets the app
 * check on start-up without asking again every time the server restarts.
 */
export const refreshMany = Effect.fn("mfm.refreshMany")(
  function*(slugs: ReadonlyArray<string>, options?: { readonly olderThanHours?: number }) {
    const results: Array<RefreshResult> = []
    const now = DateTime.toEpochMillis(yield* DateTime.now)
    let first = true
    for (const slug of slugs) {
      if (options?.olderThanHours !== undefined) {
        const at = yield* lastChecked(slug)
        if (at !== null && now - at < options.olderThanHours * 3_600_000) {
          results.push({ slug, status: "skipped", faction: slug, version: "", message: "Checked recently.", changes: 0 })
          continue
        }
      }
      if (!first) yield* Effect.sleep("1 second")
      first = false
      results.push(yield* refreshFaction(slug))
    }
    return results
  }
)

/** `refreshMany` with its HTTP client and file system supplied. */
export const refreshManyLive = (slugs: ReadonlyArray<string>, options?: { readonly olderThanHours?: number }) =>
  refreshMany(slugs, options).pipe(Effect.provide(FetchHttpClient.layer), Effect.provide(NodeFileSystem.layer))
