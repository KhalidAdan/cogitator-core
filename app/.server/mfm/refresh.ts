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
 *
 * Nothing here touches the disk, so it runs the same on Cloudflare and in Node.
 * Keeping a copy of each page a snapshot was built from is optional (`archive`);
 * the local scripts pass one that writes to `data/mfm`.
 */
import { DateTime, Effect, Schedule } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Lists } from "../repos/Lists"
import { fieldManualSlug, mfmUrl } from "./factions"
import { type FieldManual, parseFieldManual } from "./parse"
import { lastChecked, type ManualSnapshot, manualStatuses, recordCheck, saveManual } from "./store"

/** Somewhere to keep the page a new snapshot was read from. */
export type PageArchive = (slug: string, manual: FieldManual, html: string) => Effect.Effect<void>

export interface RefreshResult {
  readonly slug: string
  readonly status: "new" | "unchanged" | "failed" | "skipped"
  readonly faction: string
  readonly version: string
  readonly message: string
  /** Number of prices that moved, when a new snapshot was stored. */
  readonly changes: number
}

// The site serves its app shell to anything, but answers plain clients more reliably with a browser-like agent.
const USER_AGENT = "Mozilla/5.0 (compatible; cogitator-core/0.1; personal list analysis tool)"

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Fetch and store one faction page. Never fails: a problem becomes a `failed` result and a recorded check. */
export const refreshFaction = Effect.fn("mfm.refreshFaction")(function*(slug: string, archive?: PageArchive) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ schedule: Schedule.exponential("500 millis"), times: 2 })
  )
  const attempt = Effect.gen(function*() {
    const html = yield* client.get(mfmUrl(slug), { headers: { "User-Agent": USER_AGENT } }).pipe(Effect.flatMap((r) => r.text))
    const manual = yield* parseFieldManual(html)
    const stored: ManualSnapshot | null = yield* saveManual(slug, manual)
    if (stored && archive) yield* archive(slug, manual, html)
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
export interface RefreshOptions {
  readonly olderThanHours?: number
  readonly archive?: PageArchive
}

export const refreshMany = Effect.fn("mfm.refreshMany")(
  function*(slugs: ReadonlyArray<string>, options?: RefreshOptions) {
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
      results.push(yield* refreshFaction(slug, options?.archive))
    }
    return results
  }
)

/** `refreshMany` with its HTTP client supplied (the platform's `fetch`). */
export const refreshManyLive = (slugs: ReadonlyArray<string>, options?: RefreshOptions) =>
  refreshMany(slugs, options).pipe(Effect.provide(FetchHttpClient.layer))
