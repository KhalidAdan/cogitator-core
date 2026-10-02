/** Your lists: open one, delete an imported one, or import another. */
import { Effect } from "effect"
import { data, Link, useFetcher } from "react-router"
import { Lists } from "~/.server/repos/Lists"
import { run } from "~/.server/runtime"
import type { Route } from "./+types/lists"

export async function loader() {
  return { lists: await run(Effect.flatMap(Lists, (l) => l.all)) }
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const id = String(form.get("id") ?? "")
  if (form.get("intent") !== "delete" || !id) throw data({ message: "Unknown action." }, { status: 400 })
  await run(Effect.gen(function*() {
    const lists = yield* Lists
    const list = yield* lists.get(id)
    // built-in lists are the calibration reference; they can be reset but not removed
    if (!list.builtin) yield* lists.remove(id)
  }))
  return { ok: true }
}

export const meta: Route.MetaFunction = () => [{ title: "Lists · Cogitator Core" }]

export default function ListsIndex({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher()
  const deleting = fetcher.formData?.get("id")
  return (
    <main>
      <div className="dhead">
        <div>
          <h2>Your lists</h2>
          <div className="meta">Built-in lists are the calibration reference. Imported lists are stored in this app’s database.</div>
        </div>
        <Link className="btn primary" to="/lists/import">
          Import a list
        </Link>
      </div>
      <section className="mylists">
        <div className="tbl-scroll">
          <table className="dt">
            <thead>
              <tr>
                <th>List</th>
                <th className="l">Faction</th>
                <th>Units</th>
                <th>Points</th>
                <th className="l" />
              </tr>
            </thead>
            <tbody>
              {loaderData.lists
                .filter((l) => l.id !== deleting)
                .map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link to={`/lists/${l.id}`} prefetch="intent">
                        <b>{l.name}</b>
                      </Link>
                      {l.builtin ? <span className="hint"> built-in</span> : null}
                    </td>
                    <td className="l">{l.faction}</td>
                    <td>{l.units}</td>
                    <td>{l.pts}</td>
                    <td className="l">
                      <Link className="btn" to={`/lists/${l.id}`}>
                        Open
                      </Link>{" "}
                      {l.builtin ? null : (
                        <fetcher.Form
                          method="post"
                          style={{ display: "inline" }}
                          onSubmit={(e) => {
                            if (!window.confirm(`Delete “${l.name}”?`)) e.preventDefault()
                          }}
                        >
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={l.id} />
                          <button className="btn ghost danger" type="submit">
                            Delete
                          </button>
                        </fetcher.Form>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
