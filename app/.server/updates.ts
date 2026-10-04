/**
 * Keeping the rules database current, as one thing.
 *
 * The database has two sources that update on their own schedules: points
 * from the Munitorum Field Manual, and datasheets and rules text from
 * Wahapedia. A person using the app doesn't want to manage them separately;
 * they want to press "check for updates" and be told if the two are out of
 * step. This module is that: one update that does both, in order, and one
 * status that says whether they agree.
 */
import { DateTime, Effect, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { norm, titleCase } from "~/domain/text"
import { memo } from "./memo"
import { type PageArchive, type RefreshResult, refreshManyLive, slugsInUse } from "./mfm/refresh"
import { latestManual, type ManualStatus, manualStatuses } from "./mfm/store"
import { Settings, UPDATES_CHECKED_AT, WAHAPEDIA_CHECK } from "./repos/Settings"
import { modelCount, tierRange } from "./wahapedia/check"
import { reportHasChanges } from "./wahapedia/diff"
import { allDatasheets, costsFor, currentSnapshotId, exportManualVersion } from "./wahapedia/queries"
import { remoteExport } from "./wahapedia/remote"
import { Snapshots } from "./wahapedia/Snapshots"
import { syncRules } from "./wahapedia/sync"

// ---------- one update ----------

export interface UpdateResult {
  readonly points: ReadonlyArray<RefreshResult>
  readonly datasheets: {
    readonly status: "new" | "unchanged" | "failed" | "skipped"
    readonly message: string
  }
  /** Library rules whose official wording changed with the new export. */
  readonly reworded: ReadonlyArray<string>
}

const hoursSince = (iso: string | null, now: number) => (iso ? (now - Date.parse(iso)) / 3_600_000 : Infinity)

/**
 * A check by hand makes a few dozen requests to Wahapedia and Games Workshop.
 * One every ten minutes is plenty for a person and keeps it from being used to
 * hammer them.
 */
export const COOLDOWN_MINUTES = 10

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many)
const sentence = (parts: ReadonlyArray<string | null | false | undefined>) => parts.filter(Boolean).join(" ")

/**
 * "Check for updates" by hand, for the site's owner: the Database page's button
 * and the owner's MCP tool. Within the cooldown it only says when to try again.
 */
export const updateByHand = Effect.gen(function*() {
  const last = Option.getOrUndefined(yield* (yield* Settings).get(UPDATES_CHECKED_AT))
  const minutes = last ? (Date.now() - Date.parse(last)) / 60_000 : Infinity
  if (minutes < COOLDOWN_MINUTES) {
    const wait = Math.ceil(COOLDOWN_MINUTES - minutes)
    return { ok: true, message: `Both sources were checked a few minutes ago. Try again in ${wait} ${plural(wait, "minute")}.` }
  }
  const r = yield* checkForUpdates()
  const moved = r.points.filter((p) => p.status === "new")
  const failed = r.points.filter((p) => p.status === "failed")
  return {
    ok: failed.length === 0 && r.datasheets.status !== "failed",
    message: sentence([
      moved.length
        ? `New points: ${moved.map((p) => `${titleCase(p.faction)} ${p.version} (${p.changes} ${plural(p.changes, "price")} moved)`).join(", ")}.`
        : r.points.length
          ? "No new points."
          : "No factions to check for points yet; import a list first.",
      ...failed.map((p) => p.message),
      r.datasheets.message,
      r.reworded.length
        ? `${r.reworded.length} library ${plural(r.reworded.length, "rule was", "rules were")} reworded and went back to draft: ${r.reworded.join(", ")}.`
        : null
    ])
  }
}).pipe(Effect.withSpan("updates.updateByHand"))

/**
 * Look for updates to both sources: the Field Manual for every faction that
 * has a list, then the Wahapedia export, read straight from Wahapedia. Never
 * fails; whatever went wrong is in the result. With `olderThanHours`, anything
 * checked more recently is left alone, which is how the scheduled check skips
 * what was just checked by hand. `archive` keeps the Field Manual pages read
 * (the local scripts keep them on disk; the app keeps none).
 */
export const checkForUpdates = Effect.fn("updates.checkForUpdates")(function*(
  options?: { readonly olderThanHours?: number; readonly archive?: PageArchive }
) {
  const settings = yield* Settings
  const now = yield* DateTime.now
  const nowMs = DateTime.toEpochMillis(now)

  // 1. points
  const points = yield* refreshManyLive(yield* slugsInUse, options)

  // 2. datasheets and rules
  const previous = Option.getOrUndefined(yield* settings.get(WAHAPEDIA_CHECK))
  const lastAt = previous ? ((JSON.parse(previous) as { at?: string }).at ?? null) : null
  let datasheets: UpdateResult["datasheets"]
  let reworded: ReadonlyArray<string> = []
  if (options?.olderThanHours !== undefined && hoursSince(lastAt, nowMs) < options.olderThanHours) {
    datasheets = { status: "skipped", message: "Checked recently." }
  } else {
    datasheets = yield* Effect.gen(function*() {
      const snapshots = yield* Snapshots
      const remote = yield* remoteExport
      // the timestamp is one small file; the rest is only downloaded when it has moved
      const stamp = yield* remote.stamp
      const current = Option.getOrUndefined(yield* snapshots.current)
      if (current?.lastUpdate === stamp) {
        return { status: "unchanged" as const, message: `Wahapedia’s export hasn’t changed since ${stamp.slice(0, 10)}.` }
      }
      const loaded = yield* snapshots.load(remote.source)
      const sync = yield* syncRules
      reworded = sync.changed.map((c) => c.name)
      if (loaded.status === "unchanged") {
        return { status: "unchanged" as const, message: `Wahapedia’s export hasn’t changed since ${stamp.slice(0, 10)}.` }
      }
      const r = loaded.report
      const what = r && reportHasChanges(r)
        ? `${r.totals.points} points lines, ${r.totals.weapons} weapon profiles and ${r.totals.abilities} abilities changed.`
        : ""
      return { status: "new" as const, message: `Loaded Wahapedia’s export of ${stamp.slice(0, 10)}. ${what}`.trim() }
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.catchTag("SnapshotError", (e) => Effect.succeed({ status: "failed" as const, message: e.message }))
    )
    yield* settings.set(WAHAPEDIA_CHECK, JSON.stringify({ at: DateTime.formatIso(now), ok: datasheets.status !== "failed", message: datasheets.message }))
  }

  if (points.some((p) => p.status !== "skipped") || datasheets.status !== "skipped") {
    yield* settings.set(UPDATES_CHECKED_AT, DateTime.formatIso(now))
  }
  return { points, datasheets, reworded } satisfies UpdateResult
})

// ---------- one status ----------

export interface FactionAgreement {
  readonly slug: string
  readonly faction: string
  readonly version: string
  /** Units in both sources. */
  readonly compared: number
  /** Units Wahapedia prices differently from the Field Manual. */
  readonly differing: number
  readonly examples: ReadonlyArray<{ readonly unit: string; readonly line: string; readonly manual: number; readonly wahapedia: ReadonlyArray<number> }>
}

export interface SourceStatus {
  readonly points: ReadonlyArray<{
    readonly slug: string
    readonly faction: string
    readonly version: string
    readonly storedAt: string
    readonly ok: boolean
    readonly message: string
  }>
  readonly datasheets: {
    readonly snapshotId: number
    readonly lastUpdate: string
    readonly loadedAt: string
    readonly rows: number
    /** The Field Manual version the export says it was built from. */
    readonly manualVersion: string | null
    readonly ok: boolean
    readonly message: string
  } | null
  /** Per faction, whether Wahapedia's prices are the Field Manual's. Empty until both sources are loaded. */
  readonly agreement: ReadonlyArray<FactionAgreement>
  /** `true` when Wahapedia has caught up with the Field Manual for every faction in use; `null` when it can't be judged yet. */
  readonly inStep: boolean | null
  readonly checkedAt: string | null
}

/** Field Manual page → the Wahapedia faction whose datasheets it prices. Chapters with their own page are Space Marines there. */
const WAHAPEDIA_FACTION: Record<string, string> = {
  "black-templars": "space marines",
  "blood-angels": "space marines",
  "dark-angels": "space marines",
  "space-wolves": "space marines",
  deathwatch: "space marines"
}

/**
 * Where the two sources stand, and whether they agree. Agreement is judged on
 * the thing they both carry: for each faction in use, does Wahapedia's export
 * have the prices the Field Manual has now? If not, the export predates the
 * latest update, and its profiles may too.
 */
export const sourceStatus = Effect.gen(function*() {
  const settings = yield* Settings
  const statuses = yield* manualStatuses
  const inUse = new Set(yield* slugsInUse)
  const snapshots = yield* (yield* Snapshots).all
  const current = snapshots[0] ?? null
  const snapshotId = Option.getOrUndefined(yield* currentSnapshotId)
  const lastCheck = Option.getOrUndefined(yield* settings.get(WAHAPEDIA_CHECK))
  const wahapediaCheck = lastCheck ? (JSON.parse(lastCheck) as { ok?: boolean; message?: string }) : null

  const compared = statuses.filter((st) => st.latest && inUse.has(st.slug))
  // the comparison only changes when a new export or a new Field Manual page is stored
  const agreement = snapshotId === undefined
    ? []
    : yield* memo("agreement", `${snapshotId}|${compared.map((st) => `${st.slug}:${st.latest!.id}`).join(",")}`, agreementWith(snapshotId, compared), 4)

  return {
    points: statuses
      .filter((s) => s.latest)
      .map((s) => ({ slug: s.slug, faction: s.latest!.faction, version: s.latest!.version, storedAt: s.latest!.fetchedAt, ok: s.ok, message: s.message })),
    datasheets: current && snapshotId !== undefined
      ? {
          snapshotId: current.id,
          lastUpdate: current.lastUpdate,
          loadedAt: current.loadedAt,
          rows: current.rows,
          manualVersion: yield* exportManualVersion(snapshotId),
          ok: wahapediaCheck?.ok ?? true,
          message: wahapediaCheck?.ok === false ? (wahapediaCheck.message ?? "") : ""
        }
      : null,
    agreement,
    inStep: agreement.length ? agreement.every((a) => a.differing === 0) : null,
    checkedAt: Option.getOrNull(yield* settings.get(UPDATES_CHECKED_AT))
  } satisfies SourceStatus
})

/** For each faction page, how many of its units Wahapedia's export prices differently. */
const agreementWith = (snapshotId: number, statuses: ReadonlyArray<ManualStatus>) =>
  Effect.gen(function*() {
    const agreement: Array<FactionAgreement> = []
    const sheets = yield* allDatasheets(snapshotId)
    for (const st of statuses) {
      const manual = Option.getOrUndefined(yield* latestManual(st.slug))?.manual
      if (!manual) continue
      const factionName = WAHAPEDIA_FACTION[st.slug] ?? norm(manual.faction)
      const candidates = sheets.filter((d) => !d.legacy && !d.virtual && norm(d.faction) === factionName)
      const byName = new Map(candidates.map((d) => [norm(d.name), d.id]))
      const matched = manual.units.flatMap((u) => {
        const id = byName.get(norm(u.name))
        return id ? [{ u, id }] : []
      })
      const costs = yield* costsFor(snapshotId, matched.map((m) => m.id))
      let differing = 0
      const examples: Array<FactionAgreement["examples"][number]> = []
      for (const { u, id } of matched) {
        const theirs = costs.get(id) ?? []
        let off = false
        for (const c of u.costs) {
          const n = modelCount(c.description)
          const [lo, hi] = tierRange(c.tier)
          // the same unit size in the same tier; Wahapedia may list several prices for it
          const same = theirs.filter((t) => modelCount(t.description) === n && tierRange(t.tier)[0] === lo && tierRange(t.tier)[1] === hi).map((t) => t.cost)
          if (same.length && !same.includes(c.cost)) {
            off = true
            if (examples.length < 5) examples.push({ unit: u.name, line: c.description, manual: c.cost, wahapedia: [...new Set(same)] })
          }
        }
        if (off) differing++
      }
      agreement.push({ slug: st.slug, faction: manual.faction, version: manual.version, compared: matched.length, differing, examples })
    }
    return agreement
  })
