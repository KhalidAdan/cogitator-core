/**
 * Check the Munitorum Field Manual for new points.
 *
 *   npm run mfm:fetch                       # the factions your lists use
 *   npm run mfm:fetch -- aeldari orks       # particular faction pages
 *   npm run mfm:fetch -- --all              # every faction (30 pages, a second apart)
 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { DbLive } from "../app/.server/db/Db.ts"
import { isMfmSlug, MFM_SLUGS } from "../app/.server/mfm/factions.ts"
import { refreshManyLive, slugsInUse } from "../app/.server/mfm/refresh.ts"
import { latestManual } from "../app/.server/mfm/store.ts"
import { Lists } from "../app/.server/repos/Lists.ts"

const args = process.argv.slice(2)
const named = args.filter((a) => !a.startsWith("--"))

const program = Effect.gen(function*() {
  const unknown = named.filter((s) => !isMfmSlug(s))
  if (unknown.length) {
    yield* Effect.logError(`Not a Field Manual faction page: ${unknown.join(", ")}. Known pages: ${MFM_SLUGS.join(", ")}`)
    return
  }
  const slugs = args.includes("--all") ? [...MFM_SLUGS] : named.length ? named : yield* slugsInUse
  if (!slugs.length) {
    yield* Effect.log("No lists yet, so there is no faction to check. Name one: npm run mfm:fetch -- aeldari")
    return
  }
  for (const r of yield* refreshManyLive(slugs)) {
    yield* r.status === "failed" ? Effect.logWarning(r.message) : Effect.log(r.message)
    if (r.status !== "new") continue
    const snapshot = yield* latestManual(r.slug)
    if (snapshot._tag === "None") continue
    for (const c of snapshot.value.changes.slice(0, 40)) {
      yield* Effect.log(`  ${c.name}${c.in ? ` (${c.in})` : ""}, ${c.line}: ${c.from ?? "–"} → ${c.to ?? "–"}`)
    }
    if (snapshot.value.changes.length > 40) yield* Effect.log(`  …and ${snapshot.value.changes.length - 40} more. See /database in the app.`)
  }
})

program.pipe(Effect.provide(Lists.layer.pipe(Layer.provideMerge(DbLive))), NodeRuntime.runMain)
