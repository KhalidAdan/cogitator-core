/**
 * One army list. This layout loads everything the views need (the list, the
 * rules that apply to it, the benchmark targets), owns the action that changes
 * the list's options, and hands its children a `Ledger` to compute from.
 */
import { Effect } from "effect"
import { useMemo } from "react"
import { data, Link, Outlet, type ShouldRevalidateFunctionArgs, useFetchers, useMatches, useNavigate } from "react-router"
import { parseRoster } from "~/.server/importer/roster"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { ACTIVE_LIST, Settings } from "~/.server/repos/Settings"
import { Targets } from "~/.server/repos/Targets"
import { run } from "~/.server/runtime"
import { seedData } from "~/.server/seed/Seed"
import { pointsDrift } from "~/.server/wahapedia/check"
import { RuleDrawer } from "~/components/chips"
import { Controls, PostButton, Tabs } from "~/components/controls"
import { f1, f2, type LedgerContext } from "~/components/ledger"
import { attackUnit } from "~/domain/engine"
import { applyIntent, bareDatasheetOpts, intentFromForm } from "~/domain/options"
import type { Opts } from "~/domain/schema"
import type { Route } from "./+types/list"

export async function loader({ params }: Route.LoaderArgs) {
  return run(Effect.gen(function*() {
    const lists = yield* Lists
    const list = yield* lists.get(params.listId)
    const [book, targets, all] = yield* Effect.all([(yield* Rules).book, (yield* Targets).all, lists.all])
    yield* (yield* Settings).set(ACTIVE_LIST, list.id)
    const hasRoster = (yield* lists.sources(list.id)).rosterXml !== null
    return { list, book, targets, lists: all, hasRoster, drift: yield* pointsDrift(list), calibration: calibrationCheck() }
  }))
}

/**
 * The anchor number from the handoff, computed by the running build from the
 * seed data (not the database, so edits can't move it): Yriel at 95 points
 * into Warp Spiders, bare datasheets, must be Σ 3.98 → 88.0%.
 */
function calibrationCheck() {
  const v1 = seedData.lists.find((l) => l.id === "builtin-burning-v1")
  const yriel = v1?.units.find((u) => u.id === "yriel")
  const spiders = seedData.targets.find((t) => t.id === "warp-spiders")
  if (!v1 || !yriel || !spiders) return null
  const r = attackUnit({ ...yriel, pts: 95 }, spiders, bareDatasheetOpts(v1.units), { rules: seedData.rules, units: v1.units })
  return { total: r.total, roi: r.roi }
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData()
  const listId = params.listId
  if (form.get("intent") === "reset") {
    await run(Effect.gen(function*() {
      yield* (yield* Lists).reset(listId)
      yield* (yield* Targets).replaceAll(seedData.targets)
    }))
    return { ok: true }
  }
  if (form.get("intent") === "reread") {
    // Parse the stored roster again with today's rules library: a rule added to the library since the
    // import is picked up, and anything edited by hand on this list is replaced by what the file says.
    await run(Effect.gen(function*() {
      const lists = yield* Lists
      const source = yield* lists.sources(listId)
      if (source.rosterXml === null) return
      const parsed = yield* parseRoster(source.rosterXml, source.textExport, {
        library: yield* (yield* Rules).book,
        factionArmyRules: seedData.factionArmyRules,
        detachmentRules: seedData.detachmentRules,
        detachmentUnitGrants: seedData.detachmentUnitGrants
      })
      yield* lists.replaceContent(listId, parsed)
    }))
    return { ok: true }
  }
  const intent = intentFromForm(form)
  if (!intent) throw data({ message: "That isn’t a change this list understands." }, { status: 400 })
  await run(Effect.flatMap(Lists, (lists) => lists.updateOpts(listId, (list) => applyIntent(list.opts, intent, list.units))))
  return { ok: true }
}

/**
 * The list's data only changes through an action, so moving between its views
 * (or opening a rule card, which is a search param) needs no reload.
 */
export function shouldRevalidate({ formMethod, currentParams, nextParams, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate
  return currentParams.listId !== nextParams.listId
}

export const meta: Route.MetaFunction = ({ data }) => [{ title: data ? `${data.list.meta.name} · Cogitator Core` : "Cogitator Core" }]

export const handle = { controls: true }

export default function ListLayout({ loaderData, params }: Route.ComponentProps) {
  const { list, book, targets, lists, hasRoster, drift, calibration } = loaderData
  const action = `/lists/${params.listId}`
  const navigate = useNavigate()
  const matches = useMatches()
  const showControls = matches.every((m) => (m.handle as { controls?: boolean } | undefined)?.controls !== false)

  // Optimistic options: replay every option change still in flight on top of what the loader returned.
  const fetchers = useFetchers()
  let opts: Opts = list.opts
  for (const f of fetchers) {
    if (!f.formData || f.formAction !== action) continue
    const intent = intentFromForm(f.formData)
    if (intent) opts = applyIntent(opts, intent, list.units)
  }
  const optsKey = JSON.stringify(opts)

  const ledger = useMemo<LedgerContext>(
    () => ({ list, units: list.units, rules: { ...book, ...list.rules }, targets, opts, groups: list.groups, action }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `optsKey` stands in for `opts`, which is rebuilt every render
    [list, book, targets, optsKey, action]
  )

  return (
    <>
      <header className="mast">
        <div>
          <div className="tool">Kill ledger</div>
          <h1>
            <Link to={action}>{list.meta.name}</Link>
          </h1>
          <div className="sub">{list.meta.sub}</div>
        </div>
        <div className="mastctl">
          <select
            id="listpick"
            aria-label="Choose a list"
            value={list.id}
            onChange={(e) => navigate(e.target.value === "__import" ? "/lists/import" : `/lists/${e.target.value}`)}
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.builtin ? " (built-in)" : ""}
              </option>
            ))}
            <option value="__import">Import a list…</option>
          </select>
        </div>
      </header>
      {drift && drift.units.length ? (
        <p className="note warn drift">
          The Field Manual ({drift.version}) prices {drift.units.length} of this list’s units differently
          {drift.total !== null ? `: ${drift.total} pts at current prices, against ${list.units.reduce((s, u) => s + u.pts, 0)} here` : ""}.{" "}
          <Link to={`${action}/check`}>Review and update on the Database check tab</Link>.
        </p>
      ) : null}
      <section id="controls">
        <Tabs listId={list.id} />
        {showControls ? <Controls ledger={ledger} /> : null}
      </section>
      <main id="view">
        <Outlet context={ledger} />
      </main>
      <footer className="foot">
        <p>
          Calibration: with bare datasheets, the Yriel, Fuegan, Kharseth and Shroud Runners rows reproduce the Culling Cogitator’s numbers
          against all 19 targets.{" "}
          {calibration ? (
            <>
              Live check, Yriel into Warp Spiders:{" "}
              <span className="check">
                Σ {f2(calibration.total)} → {f1(calibration.roi)}%
              </span>
              .{" "}
            </>
          ) : null}
          Expected values only. Stratagems are left out on purpose.
        </p>
        <div className="footact">
          <PostButton
            action={action}
            fields={{ intent: "reset" }}
            className="linkbtn"
            confirm="Restore this list’s units and options, and the default benchmark targets?"
          >
            Restore this list and the default targets
          </PostButton>
          {hasRoster ? (
            <>
              {" · "}
              <PostButton
                action={action}
                fields={{ intent: "reread" }}
                className="linkbtn"
                confirm="Read the roster file again with the current rules library? Profile and points edits made on this list will be replaced by what the file says."
              >
                Re-read the roster file
              </PostButton>
            </>
          ) : null}
          {" · "}
          <a className="linkbtn" href={`${action}/export.json`}>
            Download as JSON
          </a>
        </div>
      </footer>
      <RuleDrawer ledger={ledger} />
    </>
  )
}
