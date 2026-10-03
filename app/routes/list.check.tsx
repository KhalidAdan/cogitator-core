/**
 * Database check: this list, unit by unit, against the rules database.
 * Points are checked against the Munitorum Field Manual when it has been
 * fetched for the faction (it is the official source and changes first), and
 * profiles, stats and abilities against the Wahapedia snapshot. Shows where
 * the list disagrees, and brings it up to date on request: points alone, or
 * profiles as well.
 */
import { Effect } from "effect"
import { data, Link, useFetcher } from "react-router"
import { requireListEditor } from "~/.server/access"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { fieldManualSlug } from "~/.server/mfm/factions"
import { run } from "~/.server/runtime"
import { sourceStatus } from "~/.server/updates"
import { applyCheck, applyPoints, checkList, type UnitCheck } from "~/.server/wahapedia/check"
import { plural, useLedger } from "~/components/ledger"
import type { Route } from "./+types/list.check"

export const handle = { controls: false }

export async function loader({ params }: Route.LoaderArgs) {
  return run(Effect.gen(function*() {
    const list = yield* (yield* Lists).get(params.listId)
    // is Wahapedia behind the Field Manual for this list's faction? Then profile differences below may be its lag
    const slug = fieldManualSlug(list.meta.faction)
    const behind = (yield* sourceStatus).agreement.find((a) => a.slug === slug && a.differing > 0) ?? null
    return { check: yield* checkList(list, yield* (yield* Rules).book), behind }
  }))
}

/**
 * Bring units up to date. `apply-points` changes only what a unit and its
 * enhancement cost; `apply` also writes the database's weapon profiles and
 * stats over the list's. Either can be limited to one unit.
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  requireListEditor(context, request, await run(Effect.flatMap(Lists, (l) => l.get(params.listId))))
  const form = await request.formData()
  const intent = form.get("intent")
  const only = form.get("unit")
  if (intent !== "apply" && intent !== "apply-points") throw data({ message: "Unknown action." }, { status: 400 })
  const applied = await run(Effect.gen(function*() {
    const lists = yield* Lists
    const list = yield* lists.get(params.listId)
    const check = yield* checkList(list, yield* (yield* Rules).book)
    let n = 0
    for (const c of check.units) {
      if (typeof only === "string" && only && c.unitId !== only) continue
      const unit = list.units.find((u) => u.id === c.unitId)
      if (!unit) continue
      const next = intent === "apply" ? applyCheck(unit, c) : applyPoints(unit, c)
      if (JSON.stringify(next) === JSON.stringify(unit)) continue
      yield* lists.saveUnit(list.id, next)
      n++
    }
    return n
  }))
  return { applied, what: intent === "apply" ? ("values" as const) : ("points" as const) }
}

const day = (iso: string) => iso.slice(0, 10)

export default function CheckView({ loaderData, params }: Route.ComponentProps) {
  const { check, behind } = loaderData
  const { canEdit } = useLedger()
  const fetcher = useFetcher<typeof action>()
  const busy = fetcher.state !== "idle"
  const doing = busy ? String(fetcher.formData?.get("intent")) : null
  if (!check.snapshot && !check.manual) {
    return (
      <p className="empty">
        Neither the Field Manual nor a Wahapedia export has been loaded yet, so there is nothing to check against.{" "}
        <Link to="/database">Load them</Link>.
      </p>
    )
  }
  const { totals } = check
  const profileIssues = totals.issues - totals.pointsIssues
  const pointsUnits = check.units.filter((u) => u.pointsIssues > 0).length
  const fromManual = check.units.some((u) => u.points?.source === "field-manual")
  return (
    <>
      <div className="legend">
        <div className="eq">This list against the rules database</div>
        <p className="lede">
          {check.manual ? (
            <>
              Points are checked against the Field Manual, {check.manual.faction.toLowerCase()} {check.manual.version}, read on{" "}
              {day(check.manual.fetchedAt)}.{" "}
            </>
          ) : (
            <>
              The Field Manual hasn’t been read for this faction, so points are checked against Wahapedia.{" "}
              <Link to="/database">Read it</Link>.{" "}
            </>
          )}
          {check.snapshot
            ? `Profiles, stats and abilities are checked against Wahapedia snapshot #${check.snapshot.id}; ${totals.matched} of ${check.units.length} units resolve to a datasheet.`
            : "No Wahapedia export is loaded, so profiles aren’t checked."}
        </p>
        <p className="lede">
          {totals.pointsIssues
            ? `${pointsUnits} ${plural(pointsUnits, "unit")} ${pointsUnits === 1 ? "is" : "are"} priced differently from the ${fromManual ? "Field Manual" : "database"}.`
            : "Every price agrees."}{" "}
          The list totals {totals.pointsList} pts
          {totals.pointsDb !== null && totals.pointsDb !== totals.pointsList ? `; at current prices it would be ${totals.pointsDb}` : ""}.{" "}
          {check.snapshot ? (profileIssues ? `${profileIssues} profile or stat ${plural(profileIssues, "difference")} from Wahapedia.` : "Profiles and stats all agree.") : ""}
        </p>
      </div>

      {behind ? (
        <p className="note warn">
          <b>Wahapedia hasn’t caught up with the latest points for this faction</b> ({behind.differing} {plural(behind.differing, "unit")} still
          at old prices there), so its datasheets may be behind too. Where the profiles below differ, your list may be the one that’s
          current. <Link to="/database">See the rules database</Link>.
        </p>
      ) : null}

      {check.detachments.length ? (
        <div className="armyrules">
          <h3>Detachments</h3>
          <div className="armygrid">
            {check.detachments.map((d) => (
              <div className="armyrule" key={d.name}>
                <span className={`pill ${d.found ? "ok" : "warn"}`}>{d.name}</span>
                <span>
                  {d.found
                    ? [d.found.forceDisposition, d.found.dp ? `${d.found.dp} detachment ${plural(+d.found.dp, "point")}` : "", d.found.abilities.map((a) => a.name).join(", ")]
                        .filter(Boolean)
                        .join(" · ")
                    : "not in the Wahapedia export for this faction"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="presets" hidden={!canEdit}>
        {totals.pointsIssues ? (
          <fetcher.Form method="post">
            <button className="btn primary" type="submit" name="intent" value="apply-points" disabled={busy}>
              {doing === "apply-points" ? "Updating…" : `Update points from the ${fromManual ? "Field Manual" : "database"}`}
            </button>
          </fetcher.Form>
        ) : null}
        {profileIssues ? (
          <fetcher.Form
            method="post"
            onSubmit={(e) => {
              if (!window.confirm("Overwrite this list’s weapon profiles and stats with Wahapedia’s, wherever they differ, and update its points? “Restore this list” undoes it.")) {
                e.preventDefault()
              }
            }}
          >
            <button className="btn" type="submit" name="intent" value="apply" disabled={busy}>
              {doing === "apply" ? "Applying…" : "Use Wahapedia’s profiles too"}
            </button>
          </fetcher.Form>
        ) : null}
      </div>
      {fetcher.data ? (
        <p className="note">
          {fetcher.data.applied
            ? `Updated ${fetcher.data.what === "points" ? "the points of" : ""} ${fetcher.data.applied} ${plural(fetcher.data.applied, "unit")}. The matrix has been recalculated.`
            : "Nothing needed changing."}
        </p>
      ) : null}
      <p className="hint">
        Updating points changes only what units and enhancements cost. Profiles are a separate step because Wahapedia can lag a new codex;
        when it does, the list’s own profiles are the ones to keep.
      </p>

      <div className="mx-scroll" style={{ marginTop: 12 }}>
        <table className="rx">
          <thead>
            <tr>
              <th className="rowh">Unit</th>
              <th>Datasheet</th>
              <th>Points</th>
              <th>Profiles and stats</th>
              <th>Abilities</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {check.units.map((u) => (
              <UnitRow key={u.unitId} u={u} listId={params.listId} hasSnapshot={!!check.snapshot} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const tierWords = (tier: string) => tier.toLowerCase().replace(/^your /, "").replace(/ units? costs?$/, "")

function UnitRow({ u, listId, hasSnapshot, canEdit }: { u: UnitCheck; listId: string; hasSnapshot: boolean; canEdit: boolean }) {
  const fetcher = useFetcher()
  const sheet = u.datasheet
  const weapons = u.weapons.filter((w) => w.status !== "ok")
  const stats = Object.entries(u.stats)
  const profileIssues = u.issues - u.pointsIssues - (sheet ? 0 : 1)
  const source = (s: "field-manual" | "wahapedia") => (s === "field-manual" ? "Field Manual" : "Wahapedia")
  return (
    <tr>
      <td className="rowh">
        <Link to={`../units/${u.unitId}`}>
          <span className="un">{u.unit}</span>
          <span className="um">{u.issues ? `${u.issues} ${plural(u.issues, "difference")}` : "agrees"}</span>
        </Link>
      </td>
      <td>
        {sheet ? (
          <>
            <Link to={`/database/datasheets/${sheet.id}`}>{sheet.name}</Link>
            <div className="none">
              {sheet.faction}
              {sheet.legacy ? `, ${sheet.source}` : ""}
              {u.candidates > 1 ? `, 1 of ${u.candidates} with this name` : ""}
            </div>
          </>
        ) : hasSnapshot ? (
          <span className="pill warn">no datasheet with this name</span>
        ) : (
          <span className="none">—</span>
        )}
      </td>
      <td>
        {u.points ? (
          u.points.ok ? (
            <span className="pill ok">{u.points.list} pts</span>
          ) : (
            <>
              <span className="pill warn">{u.points.list} pts in the list</span>
              <div className="none">
                {u.points.options.length
                  ? `${source(u.points.source)}: ${u.points.options.map((o) => `${o.cost}${o.tier ? ` (${tierWords(o.tier)})` : ""}`).join(", ")}`
                  : u.points.note}
              </div>
            </>
          )
        ) : (
          <span className="none">no price found</span>
        )}
        {u.points?.ok && u.points.note ? <div className="none">{u.points.note}</div> : null}
        {u.enhancement ? (
          <div className="none">
            {u.enhancement.name.replace(/ \(upgrade\)/i, "")}:{" "}
            {u.enhancement.ok
              ? `${u.enhancement.list} pts`
              : u.enhancement.db === null
                ? `${u.enhancement.list} pts, not priced in ${source(u.enhancement.source)}`
                : `${u.enhancement.list} pts in the list, ${u.enhancement.db} in the ${source(u.enhancement.source)}`}
          </div>
        ) : null}
      </td>
      <td>
        {sheet && !weapons.length && !stats.length ? <span className="pill ok">match</span> : null}
        {stats.length ? (
          <div>
            <b>Unit</b> <span className="none">{stats.map(([k, [a, b]]) => `${k} ${a} → ${b}`).join(", ")}</span>
          </div>
        ) : null}
        {weapons.map((w) => (
          <div key={w.index}>
            <b>{w.nm}</b>{" "}
            <span className="none">
              {w.status === "missing"
                ? "not on the datasheet"
                : Object.entries(w.changes)
                    .map(([k, [a, b]]) => `${k} ${a} → ${b}`)
                    .join(", ")}
              {w.matchedAs ? ` (as “${w.matchedAs}”)` : ""}
            </span>
          </div>
        ))}
        {u.leader ? <div className="none">{u.leader}</div> : null}
      </td>
      <td>
        {u.abilities.notOnUnit.length ? <div className="none">On the datasheet, not on this unit: {u.abilities.notOnUnit.join(", ")}</div> : null}
        {u.abilities.notInDatabase.length ? <div className="none">On this unit, not on the datasheet: {u.abilities.notInDatabase.join(", ")}</div> : null}
        {sheet && !u.abilities.notOnUnit.length && !u.abilities.notInDatabase.length ? <span className="pill ok">match</span> : null}
      </td>
      <td>
        <fetcher.Form method="post" action={`/lists/${listId}/check`} style={{ display: "flex", flexDirection: "column", gap: 6 }} hidden={!canEdit}>
          <input type="hidden" name="unit" value={u.unitId} />
          {u.pointsIssues ? (
            <button className="btn" type="submit" name="intent" value="apply-points" disabled={fetcher.state !== "idle"}>
              Update points
            </button>
          ) : null}
          {sheet && profileIssues > 0 ? (
            <button className="btn ghost" type="submit" name="intent" value="apply" disabled={fetcher.state !== "idle"} style={{ marginLeft: 0 }}>
              Use Wahapedia’s profile
            </button>
          ) : null}
        </fetcher.Form>
      </td>
    </tr>
  )
}
