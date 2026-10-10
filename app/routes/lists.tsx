/**
 * Your lists: open one, delete an imported one, or import another. A roster
 * file dropped anywhere on the page is sent to the import page's "read" action,
 * which redirects to its review, exactly as choosing the file there would.
 *
 * Signed in, you see your own lists and the built-in one; signed out, just the
 * built-in one. Other people's lists open by their link.
 */
import { Effect } from "effect"
import { useEffect, useRef, useState } from "react"
import { data, Link, useFetcher } from "react-router"
import { requireListEditor, viewerOf } from "~/.server/access"
import { Lists } from "~/.server/repos/Lists"
import { run } from "~/.server/runtime"
import { canEditList, listedFor } from "~/viewer"
import type { Route } from "./+types/lists"

export async function loader({ context }: Route.LoaderArgs) {
  const viewer = viewerOf(context)
  const all = await run(Effect.flatMap(Lists, (l) => l.all))
  return {
    signedIn: !!viewer,
    lists: all.filter((l) => listedFor(viewer, l)).map((l) => ({ ...l, canEdit: canEditList(viewer, l) }))
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData()
  const id = String(form.get("id") ?? "")
  if (form.get("intent") !== "delete" || !id) throw data({ message: "Unknown action." }, { status: 400 })
  const list = await run(Effect.flatMap(Lists, (l) => l.get(id)))
  requireListEditor(context, request, list)
  // the built-in list is the calibration reference; it can be reset but not removed
  if (!list.builtin) await run(Effect.flatMap(Lists, (l) => l.remove(id)))
  return { ok: true }
}

export const meta: Route.MetaFunction = () => [{ title: "Lists · Cogitator Core" }]

const ROSTER_FILE = /\.(rosz?|xml|zip)$/i
const TEXT_EXPORT = /\.txt$/i

/**
 * Whether files are being dragged over the window, calling `onDrop` with them
 * when they land anywhere on it. Drags of anything but files (text, links) are
 * left to the browser.
 */
function useWindowDrop(onDrop: (files: Array<File>) => void, enabled = true) {
  const [over, setOver] = useState(false)
  const latest = useRef(onDrop)
  latest.current = onDrop
  useEffect(() => {
    if (!enabled) return
    // dragenter and dragleave fire for every element crossed, so count them
    let depth = 0
    const files = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")
    const enter = (e: DragEvent) => {
      if (!files(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!files(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const dragover = (e: DragEvent) => {
      if (!files(e)) return
      // without this the browser opens the file instead of dropping it
      e.preventDefault()
      e.dataTransfer!.dropEffect = "copy"
    }
    const drop = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      latest.current(Array.from(e.dataTransfer!.files))
    }
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragleave", leave)
    window.addEventListener("dragover", dragover)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("dragover", dragover)
      window.removeEventListener("drop", drop)
    }
  }, [enabled])
  return over
}

export default function ListsIndex({ loaderData }: Route.ComponentProps) {
  const { signedIn } = loaderData
  const fetcher = useFetcher()
  const deleting = fetcher.formData?.get("id")
  // the import page's action answers an unreadable file with { error }, and a readable one with a redirect to its review
  const importer = useFetcher<{ error?: string }>()
  const [dropped, setDropped] = useState<{ name: string; problem: string | null } | null>(null)
  const reading = importer.state !== "idle"

  const over = useWindowDrop(async (files) => {
    const roster = files.find((f) => ROSTER_FILE.test(f.name))
    const text = files.find((f) => TEXT_EXPORT.test(f.name))
    if (!roster) {
      setDropped({
        name: files[0]?.name ?? "",
        problem: text
          ? "That’s a text export on its own. Drop it together with its roster file (.ros or .rosz), or paste it on the import page."
          : `“${files[0]?.name ?? "That"}” isn’t a roster file. Drop a .ros or .rosz file from 40k.app, NewRecruit or BattleScribe.`
      })
      return
    }
    setDropped({ name: roster.name, problem: null })
    const form = new FormData()
    form.set("intent", "read")
    form.set("roster", roster)
    form.set("text", text ? await text.text() : "")
    importer.submit(form, { method: "post", action: "/lists/import", encType: "multipart/form-data" })
  }, signedIn)

  const problem = dropped?.problem ?? (!reading && importer.data?.error ? importer.data.error : null)
  return (
    <main>
      {over ? (
        <div className="dropveil" aria-hidden="true">
          <div>
            <b>Drop to import</b>
            <span>A .ros or .rosz roster. Drop its text export (.txt) with it to bring the points and enhancements.</span>
          </div>
        </div>
      ) : null}
      <div className="dhead">
        <div>
          <h2>{signedIn ? "Your lists" : "Lists"}</h2>
          <div className="meta">
            {signedIn
              ? "Your imported lists, and the built-in list, the calibration reference. Anyone with a list’s link can open it; only you can change yours."
              : "The built-in list, to try. Lists shared with you open by their link. Accounts are made by the site’s owner; sign in to import your own."}
          </div>
        </div>
        {signedIn ? (
          <Link className="btn primary" to="/lists/import">
            Import a list
          </Link>
        ) : (
          <Link className="btn" to="/sign-in?back=/lists">
            Sign in
          </Link>
        )}
      </div>
      <div aria-live="polite">
        {reading && dropped ? <p className="note">Reading {dropped.name}…</p> : null}
        {problem ? <p className="note warn">{problem}</p> : null}
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
                    <td>
                      {l.units}
                      {l.datasheets !== l.units ? <span className="hint"> of {l.datasheets}</span> : null}
                    </td>
                    <td>{l.pts}</td>
                    <td className="l">
                      <Link className="btn" to={`/lists/${l.id}`}>
                        Open
                      </Link>{" "}
                      {l.builtin || !l.canEdit ? null : (
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
        {signedIn ? <p className="hint">Or drop a roster file anywhere on this page to import it.</p> : null}
      </section>
    </main>
  )
}
