/** Datasheet browser over the current snapshot. The search is a plain GET form, so results are linkable. */
import { Effect, Option } from "effect"
import { Form, Link, useNavigation, useSubmit } from "react-router"
import { run } from "~/.server/runtime"
import { currentSnapshotId, factions, searchDatasheets } from "~/.server/wahapedia/queries"
import type { Route } from "./+types/database.datasheets"

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const q = url.searchParams.get("q") ?? ""
  const faction = url.searchParams.get("faction") || null
  return run(Effect.gen(function*() {
    const id = Option.getOrUndefined(yield* currentSnapshotId)
    if (id === undefined) return { q, faction, loaded: false, factions: [], results: [] }
    return {
      q,
      faction,
      loaded: true,
      factions: yield* factions(id),
      // an empty search with no faction would be all 1,700 datasheets; ask for one or the other
      results: q.trim() || faction ? yield* searchDatasheets(id, q, faction, 300) : []
    }
  }))
}

export const meta: Route.MetaFunction = () => [{ title: "Datasheets · Cogitator Core" }]

export default function Datasheets({ loaderData }: Route.ComponentProps) {
  const { q, faction, factions, results, loaded } = loaderData
  const submit = useSubmit()
  const navigation = useNavigation()
  const searching = navigation.state === "loading" && navigation.location.pathname === "/database/datasheets"
  return (
    <main>
      <div className="crumbs">
        <Link to="/database">Rules database</Link>
      </div>
      <div className="dhead">
        <div>
          <h2>Datasheets</h2>
          <div className="meta">Everything in the current Wahapedia snapshot. Open one to see its profile, or to add it as a benchmark target.</div>
        </div>
      </div>
      {loaded ? (
        <>
          <Form method="get" className="searchbar" onChange={(e) => submit(e.currentTarget, { replace: true })}>
            <label className="field">
              Name
              <input type="search" name="q" defaultValue={q} placeholder="fire dragons" autoComplete="off" />
            </label>
            <label className="field">
              Faction
              <select name="faction" defaultValue={faction ?? ""}>
                <option value="">Any faction</option>
                {factions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.datasheets})
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit">
              {searching ? "Searching…" : "Search"}
            </button>
          </Form>
          {results.length ? (
            <div className="tbl-scroll">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Datasheet</th>
                    <th className="l">Faction</th>
                    <th className="l">Role</th>
                    <th className="l">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link to={`/database/datasheets/${d.id}`} prefetch="intent">
                          <b>{d.name}</b>
                        </Link>
                      </td>
                      <td className="l">{d.faction}</td>
                      <td className="l">{d.role}</td>
                      <td className="l">
                        {d.source} {d.legacy ? <span className="pill">legacy</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">{q.trim() || faction ? "No datasheet matches that." : "Type a name or pick a faction."}</p>
          )}
        </>
      ) : (
        <p className="empty">
          No export has been loaded yet. <Link to="/database">Load one first</Link>.
        </p>
      )}
    </main>
  )
}
