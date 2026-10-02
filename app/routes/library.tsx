/**
 * The rules library: every official rule the engine knows about, the effect
 * it has been translated to, and whether that translation has been checked.
 */
import { Effect } from "effect"
import { data, Form, Link, redirect, useFetcher, useSubmit } from "react-router"
import { Rules } from "~/.server/repos/Rules"
import { run } from "~/.server/runtime"
import { syncRules } from "~/.server/wahapedia/sync"
import { plural } from "~/components/ledger"
import { describeRule } from "~/domain/fx"
import type { RuleStatus } from "~/domain/schema"
import { norm, slug } from "~/domain/text"
import type { Route } from "./+types/library"

const FACTIONS: Record<string, string> = { AE: "Aeldari", SM: "Space Marines", CSM: "Chaos Space Marines", AC: "Adeptus Custodes" }

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const q = url.searchParams.get("q") ?? ""
  const status = url.searchParams.get("status") ?? ""
  const entries = await run(Effect.flatMap(Rules, (r) => r.all))
  const needle = norm(q)
  const counts: Record<string, number> = { verified: 0, draft: 0, note: 0, todo: 0 }
  for (const e of entries) counts[e.status]++
  return {
    q,
    status,
    counts,
    total: entries.length,
    rules: entries
      .filter((e) => (!status || e.status === status) && (!needle || norm(`${e.rule.nm} ${e.rule.src} ${e.rule.txt}`).includes(needle)))
      .map((e) => ({
        id: e.id,
        nm: e.rule.nm,
        src: e.rule.src,
        faction: e.faction ?? "",
        status: e.status,
        effect: describeRule(e.rule),
        dmg: e.rule.dmg,
        edited: e.edited,
        linked: e.wh !== null,
        // the official text moved under this translation (see wahapedia/sync)
        stale: e.status === "draft" && /^Official wording changed/m.test(e.notes)
      }))
  }
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const intent = form.get("intent")
  if (intent === "sync") {
    const r = await run(syncRules)
    return {
      message: r.snapshotId === null
        ? "No Wahapedia export is loaded, so there is no official text to link to."
        : `${r.linked.length} newly linked, ${r.changed.length} reworded (now drafts), ${r.unchanged} unchanged, ${r.unlinked.length} with no official text of that name.`
    }
  }
  if (intent === "create") {
    const nm = String(form.get("nm") ?? "").trim()
    if (!nm) return data({ message: "Give the rule a name." }, { status: 400 })
    const id = slug(nm)
    await run(Effect.gen(function*() {
      const rules = yield* Rules
      const exists = yield* rules.get(id).pipe(Effect.as(true), Effect.catchTag("RuleNotFound", () => Effect.succeed(false)))
      if (!exists) yield* rules.save(id, { rule: { nm, src: "Datasheet", dmg: false, txt: "" }, status: "draft" })
    }))
    return redirect(`/library/${id}`)
  }
  throw data({ message: "Unknown action." }, { status: 400 })
}

export const meta: Route.MetaFunction = () => [{ title: "Rules library · Cogitator Core" }]

const STATUS_LABEL: Record<RuleStatus, string> = { verified: "verified", draft: "draft", note: "noted", todo: "to do" }
const STATUS_CLASS: Record<RuleStatus, string> = { verified: "ok", draft: "gold", note: "", todo: "warn" }

export default function Library({ loaderData, actionData }: Route.ComponentProps) {
  const { rules, counts, total, q, status } = loaderData
  const submit = useSubmit()
  // a fetcher, so comparing doesn't navigate (and the filters in the URL stay put)
  const sync = useFetcher<{ message: string }>()
  const syncing = sync.state !== "idle"
  const message = sync.data?.message ?? (actionData && "message" in actionData ? actionData.message : null)
  const groups = new Map<string, typeof rules>()
  for (const r of rules) {
    const k = FACTIONS[r.faction] ?? (r.faction || "Other")
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return (
    <main>
      <div className="dhead">
        <div>
          <h2>Rules library</h2>
          <div className="meta">
            {total} rules. {counts.verified} have a checked effect in the engine, {counts.draft} {plural(counts.draft, "is a draft", "are drafts")} to
            review, {counts.note} don’t change damage.
          </div>
        </div>
      </div>

      <div className="searchbar">
        <Form method="get" onChange={(e) => submit(e.currentTarget, { replace: true })} style={{ display: "contents" }}>
          <label className="field">
            Search
            <input type="search" name="q" defaultValue={q} placeholder="name, source or text" autoComplete="off" />
          </label>
          <label className="field">
            Status
            <select name="status" defaultValue={status}>
              <option value="">Any status</option>
              <option value="verified">Verified ({counts.verified})</option>
              <option value="draft">Draft ({counts.draft})</option>
              <option value="note">Noted ({counts.note})</option>
              <option value="todo">To do ({counts.todo})</option>
            </select>
          </label>
        </Form>
        <sync.Form method="post" action="/library?index">
          <button className="btn" type="submit" name="intent" value="sync" disabled={syncing}>
            {syncing ? "Comparing…" : "Compare with the database"}
          </button>
        </sync.Form>
        <Form method="post" action="/library?index" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label className="field">
            New rule
            <input name="nm" placeholder="Rule name" />
          </label>
          <button className="btn" type="submit" name="intent" value="create">
            Add
          </button>
        </Form>
      </div>
      {message ? <p className="note">{message}</p> : null}
      <p className="hint">
        Each rule is the official wording restated as an effect the engine can apply. “Compare with the database” links every rule to its
        text in the current Wahapedia snapshot; a rule whose wording changes drops back to draft until you have looked at it.
      </p>

      {[...groups.entries()].map(([faction, list]) => (
        <section key={faction}>
          <h3 className="sh">
            {faction} <span>{list.length} {plural(list.length, "rule")}</span>
          </h3>
          <div className="tbl-scroll">
            <table className="dt">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th className="l">Source</th>
                  <th className="l">Status</th>
                  <th className="l">Effect in the engine</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={r.dmg ? "" : "skip"}>
                    <td>
                      <Link to={`/library/${encodeURIComponent(r.id)}`} prefetch="intent">
                        <span className="wn">{r.nm}</span>
                      </Link>
                      {r.edited ? <span className="wnotes">edited</span> : null}
                    </td>
                    <td className="l">{r.src}</td>
                    <td className="l">
                      <span className={`pill ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      {r.stale ? <span className="pill warn"> wording changed</span> : null}
                      {r.linked ? null : <span className="hint"> no official text</span>}
                    </td>
                    <td className="l">{r.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {rules.length === 0 ? <p className="empty">No rule matches that.</p> : null}
    </main>
  )
}
