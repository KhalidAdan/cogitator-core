/**
 * The bridge between React Router and Effect.
 *
 * One `ManagedRuntime` holds the application layer (database, repositories,
 * seed). Loaders and actions describe what they need as an Effect and hand it
 * to `run`, which executes it and turns typed domain failures into the
 * responses React Router expects (a 404 for a missing list, and so on).
 */
import { Cause, Config, Effect, Exit, Layer, ManagedRuntime, Option, Schedule } from "effect"
import { data } from "react-router"
import { DbLive } from "./db/Db"
import { Imports } from "./repos/Imports"
import { Lists } from "./repos/Lists"
import { Rules } from "./repos/Rules"
import { Settings } from "./repos/Settings"
import { Targets } from "./repos/Targets"
import { SeedLive } from "./seed/Seed"
import { checkForUpdates } from "./updates"
import { exportFolders } from "./wahapedia/folders"
import { Snapshots } from "./wahapedia/Snapshots"
import { syncRules } from "./wahapedia/sync"

const Repos = Layer.mergeAll(Lists.layer, Rules.layer, Targets.layer, Settings.layer, Imports.layer, Snapshots.layer)

/**
 * First boot with an export already on disk: load it, so a fresh checkout has
 * a rules database without anyone running a script. Failure here is logged and
 * the app starts without one.
 */
const FirstSnapshot = Layer.effectDiscard(
  Effect.gen(function*() {
    const snapshots = yield* Snapshots
    if (Option.isSome(yield* snapshots.current)) return
    const folders = yield* exportFolders
    const latest = folders[folders.length - 1]
    if (!latest) return
    yield* Effect.logInfo(`No snapshot in the database yet; loading ${latest}`)
    yield* snapshots.loadDirectory(latest)
    yield* syncRules
  }).pipe(Effect.catch((e) => Effect.logWarning("Couldn’t load the Wahapedia export on first boot", e)))
)

/**
 * While the app is running, look for updates by itself: the Field Manual for
 * the factions in use, then the Wahapedia export. Once shortly after start-up
 * and every six hours after that; anything checked within the last twenty
 * hours is skipped, so restarting the server (which a dev session does
 * constantly) doesn't ask again. Set `COGITATOR_AUTO_UPDATE=off` to only ever
 * check by hand.
 */
const UpdateWatch = Layer.effectDiscard(
  Effect.gen(function*() {
    const auto = yield* Effect.orDie(Config.String("COGITATOR_AUTO_UPDATE").pipe(Config.withDefault("on")))
    if (/^(off|false|0|no)$/i.test(auto)) return
    const check = checkForUpdates({ olderThanHours: 20 }).pipe(
      Effect.tap((r) =>
        Effect.forEach(
          [...r.points.filter((p) => p.status === "new").map((p) => `Field Manual: ${p.message}`), ...(r.datasheets.status === "new" ? [r.datasheets.message] : [])],
          (line) => Effect.logInfo(line),
          { discard: true }
        )
      ),
      Effect.catchCause((cause) => Effect.logWarning("Checking for updates failed", cause))
    )
    yield* Effect.forkScoped(check.pipe(Effect.delay("5 seconds"), Effect.repeat(Schedule.spaced("6 hours"))))
  })
)

/** Everything the app's loaders and actions can ask for. */
export const AppLayer = Layer.mergeAll(FirstSnapshot, UpdateWatch).pipe(
  // seed first: linking rules to their official text needs the library in place
  Layer.provideMerge(SeedLive),
  Layer.provideMerge(Repos),
  Layer.provideMerge(DbLive)
)

export type AppServices = Layer.Success<typeof AppLayer>

// Vite re-evaluates server modules on change. Keep one runtime per process and
// replace it when this module reloads, so dev edits don't leak connections.
const slot = globalThis as unknown as { __cogitatorRuntime?: ManagedRuntime.ManagedRuntime<AppServices, never> }
if (slot.__cogitatorRuntime) void slot.__cogitatorRuntime.dispose()
export const runtime = (slot.__cogitatorRuntime = ManagedRuntime.make(AppLayer))

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
