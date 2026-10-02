/**
 * The rules database: is it current, and do its two sources agree?
 *
 * One action, "Check for updates", reads the Field Manual for every faction in
 * use and then the Wahapedia export. One status says what is loaded and whether
 * Wahapedia has caught up with the Field Manual. Everything else (history, the
 * individual tools) is tucked away below.
 */
import { Effect, Option } from "effect"
import { data, Link, useFetcher } from "react-router"
import { isMfmSlug, MFM_SLUGS, mfmUrl } from "~/.server/mfm/factions"
import { refreshManyLive } from "~/.server/mfm/refresh"
import { type ManualChange, manualStatuses } from "~/.server/mfm/store"
import { run } from "~/.server/runtime"
import { checkForUpdates, type SourceStatus, sourceStatus } from "~/.server/updates"
import type { ChangeKind, ChangeReport, FieldChanges } from "~/.server/wahapedia/diff"
import { exportFolders } from "~/.server/wahapedia/folders"
import { Snapshots } from "~/.server/wahapedia/Snapshots"
import { syncRules } from "~/.server/wahapedia/sync"
import { plural } from "~/components/ledger"
import type { Route } from "./+types/database"

export async function loader({ request }: Route.LoaderArgs) {
  const wanted = Number(new URL(request.url).searchParams.get("snapshot")) || null
  return run(Effect.gen(function*() {
    const snapshots = yield* Snapshots
    const all = yield* snapshots.all
    const shown = all.find((s) => s.id === wanted) ?? all.find((s) => s.hasReport) ?? all[0] ?? null
    const manuals = yield* manualStatuses
    return {
      status: yield* sourceStatus,
      snapshots: all,
      shown,
      report: shown ? Option.getOrNull(yield* snapshots.report(shown.id)) : null,
      canReload: (yield* exportFolders).length > 0,
      manuals: manuals.filter((m) => m.latest).map((m) => ({ ...m, url: mfmUrl(m.slug) })),
      untracked: MFM_SLUGS.filter((s) => !manuals.some((m) => m.slug === s && m.latest))
    }
  }))
}

const sentence = (parts: ReadonlyArray<string | null | false | undefined>) => parts.filter(Boolean).join(" ")

/**
 * `update` is the one a person uses. `track` adds a faction that no list uses
 * yet, and `reload` rebuilds the datasheets from the files already on disk;
 * both live under "History and tools".
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const intent = form.get("intent")

  if (intent === "update") {
    const r = await run(checkForUpdates())
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
  }

  if (intent === "track") {
    const slug = String(form.get("slug") ?? "")
    if (!isMfmSlug(slug)) throw data({ message: "That isn’t a Field Manual faction page." }, { status: 400 })
    const [r] = await run(refreshManyLive([slug]))
    return { ok: r.status !== "failed", message: r.message }
  }

  if (intent === "reload") {
    return run(Effect.gen(function*() {
      const folders = yield* exportFolders
      const latest = folders[folders.length - 1]
      if (!latest) return { ok: false, message: "There is no downloaded export on disk to reload." }
      const result = yield* (yield* Snapshots).loadDirectory(latest, { force: true })
      yield* syncRules
      return { ok: true, message: sentence([`Reloaded snapshot ${result.snapshot.id} from ${latest}.`, ...result.warnings]) }
    }).pipe(Effect.catchTag("SnapshotError", (e) => Effect.succeed({ ok: false, message: e.message }))))
  }

  throw data({ message: "Unknown action." }, { status: 400 })
}

export const meta: Route.MetaFunction = () => [{ title: "Database · Cogitator Core" }]

export default function Database({ loaderData }: Route.ComponentProps) {
  const { status, snapshots, shown, report, canReload, manuals, untracked } = loaderData
  // a fetcher: checking can take a minute when there is a new export to download, and it shouldn't be a navigation
  const fetcher = useFetcher<typeof action>()
  const busy = fetcher.state !== "idle"
  const working = busy ? String(fetcher.formData?.get("intent")) : null
  const versions = [...new Set(status.points.map((p) => p.version))]

  return (
    <main>
      <div className="dhead">
        <div>
          <h2>Rules database</h2>
          <div className="meta">
            What your lists are checked against: points from Games Workshop’s Munitorum Field Manual, and datasheets, weapon profiles and
            rules text from Wahapedia.
          </div>
        </div>
      </div>

      <div className="cards sources">
        <div className="card">
          <small>Points</small>
          <div className="big">{versions.length ? `Field Manual ${versions.join(", ")}` : "none yet"}</div>
          <small>{status.points.length ? status.points.map((p) => titleCase(p.faction)).join(", ") : "Check for updates to load them."}</small>
        </div>
        <div className="card">
          <small>Datasheets and rules</small>
          <div className="big">{status.datasheets ? `Wahapedia, ${longDate(status.datasheets.lastUpdate)}` : "none yet"}</div>
          <small>
            {status.datasheets
              ? `${status.datasheets.rows.toLocaleString("en")} rows${status.datasheets.manualVersion ? `, built on Field Manual ${status.datasheets.manualVersion}` : ""}`
              : "Check for updates to load them."}
          </small>
        </div>
      </div>

      <Agreement status={status} />

      <fetcher.Form method="post" action="/database?index" className="presets" style={{ alignItems: "center" }}>
        <button className="btn primary" type="submit" name="intent" value="update" disabled={busy}>
          {working === "update" ? "Checking the Field Manual and Wahapedia…" : "Check for updates"}
        </button>
        <Link className="btn" to="/database/datasheets">
          Browse datasheets
        </Link>
        <span className="hint">
          Last checked {when(status.checkedAt)}. The app also checks once a day while it’s running.
        </span>
      </fetcher.Form>
      {fetcher.data && working === null ? <p className={`note ${fetcher.data.ok ? "" : "warn"}`}>{fetcher.data.message}</p> : null}
      {status.datasheets && !status.datasheets.ok ? <p className="note warn">Last attempt to reach Wahapedia: {status.datasheets.message}</p> : null}
      {status.points.filter((p) => !p.ok).map((p) => (
        <p className="note warn" key={p.slug}>
          {p.message}
        </p>
      ))}

      {manuals.length ? (
        <>
          <h3 className="sh">
            Latest points changes <span>by faction</span>
          </h3>
          <div className="tbl-scroll">
            <table className="dt">
              <thead>
                <tr>
                  <th>Faction</th>
                  <th className="l">Field Manual</th>
                  <th className="l">What moved</th>
                  <th className="l">Wahapedia</th>
                </tr>
              </thead>
              <tbody>
                {manuals.map((m) => {
                  const a = status.agreement.find((x) => x.slug === m.slug)
                  return (
                    <tr key={m.slug}>
                      <td>
                        <a href={m.url} rel="noreferrer">
                          <b>{titleCase(m.latest!.faction)}</b>
                        </a>
                      </td>
                      <td className="l">
                        {m.latest!.version} <span className="none">stored {longDate(m.latest!.fetchedAt)}</span>
                      </td>
                      <td className="l">
                        <ManualChanges changes={m.latest!.changes} />
                      </td>
                      <td className="l">
                        {!a ? (
                          <span className="none">—</span>
                        ) : a.differing === 0 ? (
                          <span className="pill ok">same prices</span>
                        ) : (
                          <span className="pill warn">
                            behind on {a.differing} {plural(a.differing, "unit")}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {report ? (
        <>
          <h3 className="sh" id="changes">
            Latest datasheet changes <span>{report.from ? `Wahapedia’s export of ${report.to.lastUpdate.slice(0, 10)} against ${report.from.lastUpdate.slice(0, 10)}` : ""}</span>
          </h3>
          <Report report={report} />
        </>
      ) : status.datasheets ? (
        <>
          <h3 className="sh">Latest datasheet changes</h3>
          <p className="hint">
            Only one Wahapedia export has been loaded so far. When a newer one arrives, what it changed (weapon profiles, stats, rule
            wording, datasheets added and removed) is listed here.
          </p>
        </>
      ) : null}

      <details className="assume" style={{ marginTop: 26 }}>
        <summary>History and tools</summary>
        <div style={{ paddingTop: 12 }}>
          <h3 className="sh">
            Follow another faction <span>points are checked for every faction that has a list; add one here to follow it without a list</span>
          </h3>
          {untracked.length ? (
            <fetcher.Form method="post" action="/database?index" className="presets">
              <input type="hidden" name="intent" value="track" />
              <select name="slug" aria-label="Faction" defaultValue={untracked[0]} className="pick">
                {untracked.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/-/g, " ")}
                  </option>
                ))}
              </select>
              <button className="btn" type="submit" disabled={busy}>
                {working === "track" ? "Reading its page…" : "Follow this faction"}
              </button>
            </fetcher.Form>
          ) : (
            <p className="hint">Every faction is already followed.</p>
          )}

          <h3 className="sh">
            Wahapedia exports loaded <span>lists are checked against the newest; older ones are kept to compare with</span>
          </h3>
          {snapshots.length ? (
            <div className="tbl-scroll">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Snapshot</th>
                    <th className="l">Export of</th>
                    <th className="l">Loaded</th>
                    <th>Rows</th>
                    <th className="l">Compared with the one before</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s, i) => (
                    <tr key={s.id}>
                      <td>
                        <b>#{s.id}</b> {i === 0 ? <span className="pill ok">in use</span> : null}
                      </td>
                      <td className="l">{s.lastUpdate}</td>
                      <td className="l">{when(s.loadedAt)}</td>
                      <td>{s.rows.toLocaleString("en")}</td>
                      <td className="l">
                        {!s.hasReport ? (
                          <span className="none">the first one loaded, so nothing to compare with</span>
                        ) : shown?.id === s.id ? (
                          <b>shown above</b>
                        ) : (
                          <Link to={`?snapshot=${s.id}#changes`} preventScrollReset>
                            see what changed
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint">None yet.</p>
          )}
          <fetcher.Form method="post" action="/database?index" className="presets" style={{ paddingTop: 12 }}>
            <button className="btn" type="submit" name="intent" value="reload" disabled={busy || !canReload}>
              {working === "reload" ? "Reloading…" : "Rebuild the datasheets from the last download"}
            </button>
          </fetcher.Form>
          <p className="hint">
            Rebuilding re-reads the export files already on disk; use it if the database was reset. From a terminal, <code>npm run update</code>{" "}
            does the same as “Check for updates”.
          </p>
        </div>
      </details>
    </main>
  )
}

/** The headline: are the two sources in step? */
function Agreement({ status }: { status: SourceStatus }) {
  if (!status.datasheets && !status.points.length) {
    return <p className="note">Nothing is loaded yet. “Check for updates” fetches both sources.</p>
  }
  if (status.inStep === null) {
    return (
      <p className="note">
        {status.datasheets
          ? "Points haven’t been fetched yet, so lists are priced from Wahapedia for now."
          : "Datasheets haven’t been fetched yet, so points are checked but profiles aren’t."}{" "}
        “Check for updates” fetches what’s missing.
      </p>
    )
  }
  if (status.inStep) {
    return (
      <p className="note">
        <b>The two sources are in step.</b> Wahapedia’s export has the same prices as the Field Manual for every faction you follow.
      </p>
    )
  }
  const behind = status.agreement.filter((a) => a.differing > 0)
  const built = status.datasheets?.manualVersion
  const now = [...new Set(behind.map((a) => a.version))].join(", ")
  const where =
    behind.length === 1
      ? `${behind[0].differing} ${titleCase(behind[0].faction)} ${plural(behind[0].differing, "unit is", "units are")} still at old prices there`
      : behind.length === status.agreement.length
        ? `it still has old prices in all ${behind.length} factions you follow`
        : `it still has old prices in ${behind.length} of the ${status.agreement.length} factions you follow`
  return (
    <div className="note warn">
      <b>Wahapedia hasn’t caught up with the latest points.</b> Its export of {longDate(status.datasheets!.lastUpdate)}
      {built ? ` was built on Field Manual ${built}` : " predates the current Field Manual"}; the Field Manual is now {now}, and {where}.
      <div style={{ marginTop: 6 }}>
        Your lists are priced from the Field Manual, so their points are right. Datasheets may be behind too: anything released since that
        export (a new codex, say) won’t be in it, so where a list’s profiles differ from Wahapedia’s, the list may be the one that’s current.
      </div>
    </div>
  )
}

/** `SPACE MARINES` → `Space Marines`. */
const titleCase = (name: string) =>
  name.toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase()).replace(/ (Of|The|And) /g, (w) => w.toLowerCase())

/** Timestamps are stored and shown in UTC, so the server and the browser render the same text. */
const when = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "never")

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `2026-09-28 02:38:04` or an ISO timestamp → `28 Sep 2026`. */
const longDate = (stamp: string) => `${+stamp.slice(8, 10)} ${MONTHS[+stamp.slice(5, 7) - 1]} ${stamp.slice(0, 4)}`

function ManualChanges({ changes }: { changes: ReadonlyArray<ManualChange> }) {
  if (!changes.length) return <span className="none">no prices moved</span>
  const direction = (c: ManualChange) => (c.from === null ? "new" : c.to === null ? "gone" : c.to > c.from ? "up" : "down")
  return (
    <details>
      <summary>
        {changes.length} {plural(changes.length, "price")} moved
      </summary>
      <table className="dt" style={{ minWidth: 0, marginTop: 6 }}>
        <tbody>
          {changes.map((c, i) => (
            <tr key={i}>
              <td>
                {c.name}
                {c.in ? <span className="hint"> {c.in}</span> : null}
              </td>
              <td className="l">{c.line}</td>
              <td className="was">{c.from ?? "–"}</td>
              <td className="now">{c.to ?? "–"}</td>
              <td className="l">
                <span className={`pill ${direction(c) === "down" ? "ok" : direction(c) === "up" ? "warn" : "gold"}`}>{direction(c)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

const KIND: Record<ChangeKind, string> = { added: "new", removed: "gone", changed: "changed" }
const kindClass = (k: ChangeKind) => (k === "changed" ? "gold" : k === "added" ? "ok" : "warn")

function Changes({ changes }: { changes: FieldChanges }) {
  const entries = Object.entries(changes)
  if (!entries.length) return null
  return (
    <>
      {entries.map(([k, [a, b]], i) => (
        <span key={k}>
          {i ? "; " : ""}
          {k === "description" ? "abilities" : k === "text" ? "wording" : k}
          {a || b ? `: ${a || "–"} → ${b || "–"}` : ""}
        </span>
      ))}
    </>
  )
}

function Report({ report: r }: { report: ChangeReport }) {
  const touched = r.tables.filter((t) => t.added + t.removed + t.changed > 0)
  if (!touched.length) return <p className="empty">Nothing differs from the previous snapshot.</p>
  const more = (shown: number, key: string) =>
    r.totals[key] > shown ? <p className="hint">Showing the first {shown} of {r.totals[key]}.</p> : null
  return (
    <>
      <div className="cards">
        {[
          ["points", "points changes"],
          ["weapons", "weapon profile changes"],
          ["abilities", "datasheet ability changes"],
          ["enhancements", "enhancement changes"],
          ["datasheetsAdded", "datasheets added"],
          ["datasheetsRemoved", "datasheets removed"]
        ].map(([k, label]) => (
          <div className="card" key={k}>
            <div className="big">{r.totals[k] ?? 0}</div>
            <small>{label}</small>
          </div>
        ))}
      </div>

      {r.points.length ? (
        <>
          <h3 className="sh">Points</h3>
          <div className="tbl-scroll">
            <table className="dt">
              <thead>
                <tr>
                  <th>Datasheet</th>
                  <th className="l">Faction</th>
                  <th className="l">For</th>
                  <th>Was</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                {r.points.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <Link to={`/database/datasheets/${p.datasheetId}`}>{p.datasheet}</Link>
                    </td>
                    <td className="l">{p.faction}</td>
                    <td className="l">{p.line}</td>
                    <td className="was">{p.from}</td>
                    <td className="now">{p.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more(r.points.length, "points")}
        </>
      ) : null}

      {r.weapons.length ? (
        <>
          <h3 className="sh">Weapon profiles</h3>
          <div className="tbl-scroll">
            <table className="dt">
              <thead>
                <tr>
                  <th>Datasheet</th>
                  <th className="l">Weapon</th>
                  <th className="l" />
                  <th className="l">Change</th>
                </tr>
              </thead>
              <tbody>
                {r.weapons.map((w, i) => (
                  <tr key={i}>
                    <td>
                      <Link to={`/database/datasheets/${w.datasheetId}`}>{w.datasheet}</Link>
                      <span className="hint"> {w.faction}</span>
                    </td>
                    <td className="l">{w.weapon}</td>
                    <td className="l">
                      <span className={`pill ${kindClass(w.kind)}`}>{KIND[w.kind]}</span>
                    </td>
                    <td className="l">
                      <Changes changes={w.changes} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more(r.weapons.length, "weapons")}
        </>
      ) : null}

      {r.models.length ? (
        <>
          <h3 className="sh">Model profiles</h3>
          <div className="tbl-scroll">
            <table className="dt">
              <tbody>
                {r.models.map((m, i) => (
                  <tr key={i}>
                    <td>
                      <Link to={`/database/datasheets/${m.datasheetId}`}>{m.datasheet}</Link>
                      <span className="hint"> {m.faction}</span>
                    </td>
                    <td className="l">{m.model}</td>
                    <td className="l">
                      <span className={`pill ${kindClass(m.kind)}`}>{KIND[m.kind]}</span>
                    </td>
                    <td className="l">
                      <Changes changes={m.changes} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {r.abilities.length || r.sharedAbilities.length || r.detachmentAbilities.length || r.enhancements.length ? (
        <>
          <h3 className="sh">
            Rules text <span>reworded, added or removed</span>
          </h3>
          <div className="tbl-scroll">
            <table className="dt">
              <tbody>
                {r.abilities.map((a, i) => (
                  <tr key={`a${i}`}>
                    <td>{a.ability}</td>
                    <td className="l">
                      <span className={`pill ${kindClass(a.kind)}`}>{KIND[a.kind]}</span>
                    </td>
                    <td className="l">
                      ability on <Link to={`/database/datasheets/${a.datasheetId}`}>{a.datasheet}</Link>, {a.faction}
                    </td>
                  </tr>
                ))}
                {r.enhancements.map((e, i) => (
                  <tr key={`e${i}`}>
                    <td>{e.name}</td>
                    <td className="l">
                      <span className={`pill ${kindClass(e.kind)}`}>{KIND[e.kind]}</span>
                    </td>
                    <td className="l">
                      enhancement, {e.detachment || e.faction}
                      {Object.keys(e.changes).length ? (
                        <>
                          {" "}
                          (<Changes changes={e.changes} />)
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {r.detachmentAbilities.map((d, i) => (
                  <tr key={`d${i}`}>
                    <td>{d.name}</td>
                    <td className="l">
                      <span className={`pill ${kindClass(d.kind)}`}>{KIND[d.kind]}</span>
                    </td>
                    <td className="l">
                      detachment rule, {d.detachment}, {d.faction}
                    </td>
                  </tr>
                ))}
                {r.sharedAbilities.map((s, i) => (
                  <tr key={`s${i}`}>
                    <td>{s.name}</td>
                    <td className="l">
                      <span className={`pill ${kindClass(s.kind)}`}>{KIND[s.kind]}</span>
                    </td>
                    <td className="l">shared ability, {s.faction || "all factions"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more(r.abilities.length, "abilities")}
        </>
      ) : null}

      {r.datasheets.added.length || r.datasheets.removed.length ? (
        <>
          <h3 className="sh">Datasheets</h3>
          <div className="chips">
            {r.datasheets.added.map((d) => (
              <Link key={d.datasheetId} className="chip on" to={`/database/datasheets/${d.datasheetId}`}>
                {d.datasheet} ({d.faction})
              </Link>
            ))}
            {r.datasheets.removed.map((d) => (
              <span key={d.datasheetId} className="chip off demo">
                {d.datasheet} ({d.faction})
              </span>
            ))}
          </div>
        </>
      ) : null}

      <h3 className="sh">
        By file <span>rows added, removed and changed</span>
      </h3>
      <div className="tbl-scroll">
        <table className="dt">
          <thead>
            <tr>
              <th>File</th>
              <th>Added</th>
              <th>Removed</th>
              <th>Changed</th>
            </tr>
          </thead>
          <tbody>
            {touched.map((t) => (
              <tr key={t.file}>
                <td>
                  {t.label} <span className="hint">{t.file}.csv</span>
                </td>
                <td>{t.added}</td>
                <td>{t.removed}</td>
                <td>{t.changed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
