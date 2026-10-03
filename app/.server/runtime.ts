/**
 * The bridge between React Router and Effect.
 *
 * One `ManagedRuntime` holds the application layer (database, repositories,
 * seed). Loaders and actions describe what they need as an Effect and hand it
 * to `run`, which executes it and turns typed domain failures into the
 * responses React Router expects (a 404 for a missing list, and so on).
 *
 * The runtime is installed by whoever owns the database: on Cloudflare, the
 * Durable Object that serves every request (`workers/app.ts`) installs it over
 * its own SQLite storage when it starts.
 */
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect"
import { SqlClient } from "effect/sql"
import { data } from "react-router"
import type { Execute } from "./auth/dialect"
import { Imports } from "./repos/Imports"
import { Lists } from "./repos/Lists"
import { Rules } from "./repos/Rules"
import { Settings } from "./repos/Settings"
import { Targets } from "./repos/Targets"
import { SeedLive } from "./seed/Seed"
import { checkForUpdates, sourceStatus } from "./updates"
import { checkList, pointsDrift } from "./wahapedia/check"
import { Snapshots } from "./wahapedia/Snapshots"

const Repos = Layer.mergeAll(Lists.layer, Rules.layer, Targets.layer, Settings.layer, Imports.layer, Snapshots.layer)

/**
 * Fill the read caches (see `memo.ts`) in the background right after start-up,
 * by doing once what the slowest pages do: compare the two sources, and check
 * every list. The first visit to the Database page or a list's check tab is
 * then as quick as every later one. Failures are only logged; a page that
 * finds the cache empty just reads the database itself.
 */
const Warmup = Layer.effectDiscard(
  Effect.forkScoped(
    Effect.gen(function*() {
      const started = Date.now()
      yield* sourceStatus
      const lists = yield* Lists
      const book = yield* (yield* Rules).book
      for (const summary of yield* lists.all) {
        const list = yield* lists.get(summary.id)
        yield* checkList(list, book)
        yield* pointsDrift(list)
      }
      yield* Effect.logDebug(`Read caches warm in ${Date.now() - started} ms`)
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("Warming the read caches failed", cause)))
  )
)

/** Everything the app's loaders and actions can ask for, over a migrated database. */
export const appLayer = (db: Layer.Layer<SqlClient.SqlClient>) =>
  Warmup.pipe(
    // seed first: the warm-up and every request expect the library and the built-in list in place
    Layer.provideMerge(SeedLive),
    Layer.provideMerge(Repos),
    Layer.provideMerge(db)
  )

export type AppServices = Layer.Success<ReturnType<typeof appLayer>>

/**
 * The scheduled update: the same check as the "Check for updates" button,
 * skipping whatever was checked in the last twenty hours. The Durable Object's
 * alarm runs it every six hours; it never fails, it logs.
 */
export const scheduledUpdate = checkForUpdates({ olderThanHours: 20 }).pipe(
  Effect.tap((r) =>
    Effect.forEach(
      [...r.points.filter((p) => p.status === "new").map((p) => `Field Manual: ${p.message}`), ...(r.datasheets.status === "new" ? [r.datasheets.message] : [])],
      (line) => Effect.logInfo(line),
      { discard: true }
    )
  ),
  Effect.asVoid,
  Effect.catchCause((cause) => Effect.logWarning("Checking for updates failed", cause))
)

let runtime: ManagedRuntime.ManagedRuntime<AppServices, never> | undefined

/**
 * Open the app over a database: run the migrations and the seed, start the
 * warm-up, and make `run` use it. Resolves once the app can take requests.
 */
export async function installRuntime(layer: ReturnType<typeof appLayer>): Promise<void> {
  const previous = runtime
  runtime = ManagedRuntime.make(layer)
  await runtime.runPromise(Effect.void)
  if (previous) await previous.dispose()
}

/** better-auth's queries, run on the app's database (see auth/dialect.ts). */
export const executeSql: Execute = (statement, params) =>
  run(Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe<Record<string, unknown>>(statement, [...params])))

/** Domain failures that map straight onto an HTTP status. */
const STATUS: Record<string, number> = {
  ListNotFound: 404,
  RuleNotFound: 404,
  UnitNotFound: 404,
  TargetNotFound: 404,
  InvalidInput: 400,
  RosterParseError: 422,
  SnapshotError: 422,
  FieldManualParseError: 502
}

/**
 * Run an Effect for a loader or action. A failure whose `_tag` is in `STATUS`
 * is thrown as a React Router `data()` response so the nearest ErrorBoundary
 * renders it; anything else is a genuine bug and rejects as-is.
 */
export async function run<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  if (!runtime) throw new Error("The app's database isn't open: requests reach the app through its Durable Object, which opens it.")
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isSome(failure)) {
    const e = failure.value as { _tag?: string; message?: string }
    const status = e._tag ? STATUS[e._tag] : undefined
    if (status) throw data({ tag: e._tag, message: e.message || e._tag }, { status })
  }
  throw Cause.squash(exit.cause)
}
