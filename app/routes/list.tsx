/**
 * One army list. This layout loads everything the views need (the list, the
 * rules that apply to it, the benchmark targets), owns the action that changes
 * the list's options, and hands its children a `Ledger` to compute from.
 *
 * Anyone with the link can open a list. Its owner's switches change the list;
 * anyone else's are kept in their browser (`cookies.ts`), so they can try
 * things without changing it for everyone.
 */
import { Effect } from "effect"
import { useMemo, useRef } from "react"
import { data, Link, Outlet, type ShouldRevalidateFunctionArgs, useFetchers, useMatches, useNavigate, useRouteLoaderData } from "react-router"
import { requireListEditor, viewerOf } from "~/.server/access"
import { clearViewerOpts, readViewerOpts, writeActiveList, writeViewerOpts } from "~/.server/cookies"
import { importContext } from "~/.server/importer/context"
import { keepPrices, parseRoster } from "~/.server/importer/roster"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Targets } from "~/.server/repos/Targets"
import { run } from "~/.server/runtime"
import { seedData } from "~/.server/seed/Seed"
import { pointsDrift } from "~/.server/wahapedia/check"
import { RuleDrawer } from "~/components/chips"
import { Controls, CopyText, PostButton, Tabs } from "~/components/controls"
import { f1, f2, type LedgerContext, plural } from "~/components/ledger"
import { listRuleBook, type NotInLibrary, notInLibrary, translateRequest } from "~/domain/book"
import { attackUnit } from "~/domain/engine"
import { applyIntent, bareDatasheetOpts, intentFromForm } from "~/domain/options"
import type { Opts } from "~/domain/schema"
import { canEditList, isOwner, listedFor, useViewer } from "~/viewer"
import type { Route } from "./+types/list"

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const viewer = viewerOf(context)
  const loaded = await run(Effect.gen(function*() {
    const lists = yield* Lists
    const list = yield* lists.get(params.listId)
    const [book, targets, all] = yield* Effect.all([(yield* Rules).book, (yield* Targets).all, lists.all])
    const hasRoster = (yield* lists.sources(list.id)).rosterXml !== null
    return { list, book, targets, all, hasRoster, drift: yield* pointsDrift(list) }
  }))
  const canEdit = canEditList(viewer, loaded.list)
  // the list's own address, for a request to an agent: the path up to the list, whichever tab this is
  const url = new URL(request.url)
  const listUrl = `${url.origin}${url.pathname.replace(/(\/lists\/[^/.]+).*$/, "$1")}`
  // someone else's list: the switches this browser has set on it, over the list's own
  const mine = canEdit ? null : await readViewerOpts(request, loaded.list.id)
  const { all, ...rest } = loaded
  return data(
    {
      ...rest,
      list: mine ? { ...loaded.list, opts: mine } : loaded.list,
      lists: all.filter((l) => listedFor(viewer, l) || l.id === loaded.list.id),
      canEdit,
      listUrl,
      calibration: calibrationCheck()
    },
    { headers: { "Set-Cookie": await writeActiveList(request, loaded.list.id) } }
  )
}

/**
 * The anchor number from the handoff, computed by the running build from the
 * seed data (not the database, so edits can't move it): Yriel at 95 points
 * into Warp Spiders, bare datasheets, must be Σ 3.98 → 88.0%. The handoff
 * measured it on the POC's hand-built list; the built-in list gives the same
 * rows (tests/engine-parity.test.ts checks both).
 */
function calibrationCheck() {
  const list = seedData.lists.find((l) => l.id === seedData.defaultListId)
  const yriel = list?.units.find((u) => u.id === "prince-yriel")
  const spiders = seedData.targets.find((t) => t.id === "warp-spiders")
  if (!list || !yriel || !spiders) return null
  const r = attackUnit({ ...yriel, pts: 95 }, spiders, bareDatasheetOpts(list.units), { rules: seedData.rules, units: list.units })
  return { total: r.total, roi: r.roi }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData()
  const listId = params.listId
  const viewer = viewerOf(context)
  const list = await run(Effect.flatMap(Lists, (lists) => lists.get(listId)))
  const canEdit = canEditList(viewer, list)

  if (form.get("intent") === "reset") {
    // someone else's list: forget this browser's switches
    if (!canEdit) return data({ ok: true, message: "Put back." }, { headers: { "Set-Cookie": await clearViewerOpts(request, listId) } })
    await run(Effect.gen(function*() {
      yield* (yield* Lists).reset(listId)
      // the benchmark targets are everyone's, so only the site's owner puts them back
      if (isOwner(viewer)) yield* (yield* Targets).replaceAll(seedData.targets)
    }))
    return { ok: true, message: isOwner(viewer) ? "Restored, with the default targets." : "Restored." }
  }
  if (form.get("intent") === "reread") {
    requireListEditor(context, request, list)
    // Parse the stored roster again with today's rules library: a rule added to the library since the
    // import is picked up, and anything edited by hand on this list is replaced by what the file says.
    // Prices are kept where the file has none (a roster file without its text export has no points).
    const stats = await run(Effect.gen(function*() {
      const lists = yield* Lists
      const source = yield* lists.sources(listId)
      if (source.rosterXml === null) return null
      const parsed = yield* parseRoster(source.rosterXml, source.textExport, yield* importContext)
      yield* lists.replaceContent(listId, { ...parsed, units: keepPrices(parsed.units, list.units) })
      return parsed.stats
    }))
    return {
      ok: true,
      message: stats
        ? `Read again: ${stats.known} of its rules are in the library${stats.todo ? `, and ${stats.todo} that read like they change damage aren’t` : ""}.`
        : "This list has no roster file to read."
    }
  }
  const intent = intentFromForm(form)
  if (!intent) throw data({ message: "That isn’t a change this list understands." }, { status: 400 })
  if (!canEdit) {
    const next = applyIntent((await readViewerOpts(request, listId)) ?? list.opts, intent, list.units)
    return data({ ok: true }, { headers: { "Set-Cookie": await writeViewerOpts(request, listId, next) } })
  }
  await run(Effect.flatMap(Lists, (lists) => lists.updateOpts(listId, (l) => applyIntent(l.opts, intent, l.units))))
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

/**
 * `value`, unless its content (`key`) is what it was last render, in which case
 * the object from then. Loader data arrives as new objects even when nothing in
 * it changed, and everything the views compute is memoised on identity.
 */
function useStable<T>(value: T, key: string): T {
  const held = useRef<{ key: string; value: T } | null>(null)
  if (!held.current || held.current.key !== key) held.current = { key, value }
  return held.current.value
}

export default function ListLayout({ loaderData, params }: Route.ComponentProps) {
  const { list, book, targets, lists, hasRoster, drift, calibration, canEdit, listUrl } = loaderData
  const owner = isOwner(useViewer())
  const signedIn = !!useRouteLoaderData<{ viewer: unknown }>("root")?.viewer
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

  // After an option change the server sends the list back with the options the page already shows. Keeping the
  // previous objects when their content is the same means that confirmation recomputes nothing.
  const stableList = useStable(list, useMemo(() => JSON.stringify({ ...list, opts: null }), [list]))
  const stableBook = useStable(book, useMemo(() => JSON.stringify(book), [book]))
  const stableTargets = useStable(targets, useMemo(() => JSON.stringify(targets), [targets]))

  const ledger = useMemo<LedgerContext>(
    () => ({
      list: stableList,
      units: stableList.units,
      rules: listRuleBook(stableBook, stableList.rules),
      targets: stableTargets,
      opts,
      groups: stableList.groups,
      action,
      canEdit
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `optsKey` stands in for `opts`, which is rebuilt every render
    [stableList, stableBook, stableTargets, optsKey, action, canEdit]
  )
  // the site's owner can have their agent translate what the library doesn't have (the MCP's save_rule)
  const missing = useMemo(() => (owner ? notInLibrary(ledger.units, ledger.rules).filter((x) => x.rule.todo) : []), [owner, ledger.units, ledger.rules])

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
            {signedIn ? <option value="__import">Import a list…</option> : null}
          </select>
        </div>
      </header>
      {canEdit ? null : (
        <p className="note drift">
          {signedIn ? "This list isn’t yours" : "You’re not signed in"}, so switches and modifiers you change are kept in this browser
          only; the list stays as its owner left it.
        </p>
      )}
      {drift && drift.units.length ? (
        <p className="note warn drift">
          The Field Manual ({drift.version}) prices {drift.units.length} of this list’s units differently
          {drift.total !== null ? `: ${drift.total} pts at current prices, against ${list.units.reduce((s, u) => s + u.pts, 0)} here` : ""}.{" "}
          <Link to={`${action}/check`}>Review and update on the Database check tab</Link>.
        </p>
      ) : null}
      {missing.length ? <NotModelled missing={missing} name={list.meta.name} url={listUrl} rulesTab={`${action}/rules`} /> : null}
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
          {canEdit ? (
            <PostButton
              action={action}
              fields={{ intent: "reset" }}
              className="linkbtn"
              busy="Restoring…"
              confirm="Restore this list’s units and options, and the default benchmark targets?"
            >
              Restore this list and the default targets
            </PostButton>
          ) : (
            <PostButton action={action} fields={{ intent: "reset" }} className="linkbtn">
              Put the switches back
            </PostButton>
          )}
          {canEdit && hasRoster ? (
            <>
              {" · "}
              <PostButton
                action={action}
                fields={{ intent: "reread" }}
                className="linkbtn"
                busy="Reading the roster file…"
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

/** For the site's owner: the rules here that read like they change damage and aren't modelled, and what to ask an agent. */
function NotModelled({ missing, name, url, rulesTab }: { missing: ReadonlyArray<NotInLibrary>; name: string; url: string; rulesTab: string }) {
  const n = missing.length
  const one = n === 1
  return (
    <div className="note warn drift">
      <b>
        {n} {plural(n, "rule")} here {one ? "reads" : "read"} like {one ? "it changes" : "they change"} damage but {one ? "isn’t" : "aren’t"} modelled
      </b>
      , so the matrix leaves {one ? "it" : "them"} out: {missing.map((x) => `${x.rule.nm} (${x.units.map((u) => u.nm).join(", ")})`).join("; ")}. The{" "}
      <Link to={rulesTab}>rules matrix</Link> has their text.
      <details>
        <summary>Have your connected agent translate {one ? "it" : "them"}</summary>
        <p>
          Paste this into an assistant connected to Cogitator Core’s MCP. It drafts each rule into the rules library, where you check the drafts, and
          every list with the rule scores with it at once. In Claude Code, the translate_rules prompt does the same.
        </p>
        <CopyText text={translateRequest({ name, url }, missing)} />
      </details>
    </div>
  )
}
