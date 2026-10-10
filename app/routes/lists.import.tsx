/**
 * Import a list: upload a roster (and optionally the 40k.app text export),
 * review what was read, then save it.
 *
 * The upload is stored as a pending import and the review lives at
 * `?pending=<id>`, so the page can be reloaded. Saving re-parses the stored
 * file, applies the edits from the review form, and creates the list.
 *
 * Where a unit's profile disagrees with its Wahapedia datasheet, its row opens
 * to show the two side by side, and the unit can be set to take Wahapedia's.
 */
import { Effect, Option } from "effect"
import { Fragment, useState } from "react"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { parseRoster, readRosterFile } from "~/.server/importer/roster"
import { requireViewer } from "~/.server/access"
import { importContext } from "~/.server/importer/context"
import { fieldManualSlug } from "~/.server/mfm/factions"
import { refreshManyLive } from "~/.server/mfm/refresh"
import { Imports } from "~/.server/repos/Imports"
import { Lists } from "~/.server/repos/Lists"
import { run } from "~/.server/runtime"
import { sourceStatus } from "~/.server/updates"
import { applyPoints, applyProfiles, checkList, type ProfileCells, type ProfileDiff, profileDiff, type StatCells } from "~/.server/wahapedia/check"
import { DemoChip } from "~/components/chips"
import { plural } from "~/components/ledger"
import { listRuleBook, notInLibrary } from "~/domain/book"
import type { Rule, Unit } from "~/domain/schema"
import { isOwner } from "~/viewer"
import type { Route } from "./+types/lists.import"

/** Parse a pending import and check it against the database. Someone else's upload is as good as missing. */
const preview = (pendingId: string, ownerId: string) =>
  Effect.gen(function*() {
    const pending = Option.getOrUndefined(yield* (yield* Imports).get(pendingId))
    if (!pending || pending.ownerId !== ownerId) return null
    const ctx = yield* importContext
    const library = ctx.library
    const parsed = yield* parseRoster(pending.rosterXml, pending.textExport, ctx)
    const check = yield* checkList({ units: parsed.units, meta: parsed.meta, rules: parsed.rules }, library)
    return { pending, parsed, check, library }
  })

/**
 * Preview for the review page, which also wants to know whether Wahapedia is behind the Field Manual for this faction.
 *
 * A faction no list uses yet has no Field Manual stored, so its prices would be Wahapedia's, which can be a version
 * behind. The owner's review reads the faction's page first (at most once an hour); anyone else's is told, and the
 * daily check reads it once the list is saved.
 */
const review = (pendingId: string, ownerId: string, canRead: boolean) =>
  Effect.gen(function*() {
    let p = yield* preview(pendingId, ownerId)
    if (!p) return null
    const unread = p.check.manual ? null : fieldManualSlug(p.parsed.meta.faction)
    if (unread && canRead) {
      const [r] = yield* refreshManyLive([unread], { olderThanHours: 1 })
      if (r?.status === "new") p = (yield* preview(pendingId, ownerId)) ?? p
    }
    const slug = p.check.manual?.slug
    const behind = slug ? ((yield* sourceStatus).agreement.find((a) => a.slug === slug && a.differing > 0) ?? null) : null
    return { ...p, behind }
  })

export async function loader({ request, context }: Route.LoaderArgs) {
  // importing makes a list, and a list needs an owner
  const viewer = requireViewer(context, request)
  const pendingId = new URL(request.url).searchParams.get("pending")
  if (!pendingId) return { review: null, expired: false }
  const p = await run(review(pendingId, viewer.id, isOwner(viewer)))
  if (!p) return { review: null, expired: true }
  const { parsed, check, library, behind } = p
  const ruleOf = (id: string): Rule | undefined => parsed.rules[id] ?? library[id]
  const units = parsed.units.map((u) => {
    const rules = u.rules.map(ruleOf).filter((r): r is Rule => !!r)
    const c = check.units.find((x) => x.unitId === u.id)
    const diff = c?.datasheet ? profileDiff(u, c) : null
    const own = u.pts - (u.enh?.pts ?? 0)
    return {
      id: u.id,
      nm: u.nm,
      models: u.models,
      // Shown and edited as the unit's own cost; the enhancement is a separate field and is added on save.
      // A roster with no text export has no points at all, so start from the Field Manual's where it has
      // them, and from Wahapedia's where it hasn't been read for this faction.
      pts: own || (c?.points?.expected ?? 0),
      enh: u.enh ? { nm: u.enh.nm, pts: u.enh.pts || (c?.enhancement?.db ?? 0) } : null,
      group: u.grp ? { short: parsed.groups[u.grp]?.short ?? "", role: u.role ?? null } : null,
      kw: (u.kw ?? []).filter((k) => ["CHARACTER", "INFANTRY", "VEHICLE", "MONSTER", "MOUNTED", "BATTLELINE"].includes(k)),
      weapons: u.w.filter((w) => !w.off).length,
      counted: rules.filter((r) => r.dmg).length,
      todo: rules.filter((r) => !r.dmg && r.todo).length,
      noted: rules.filter((r) => !r.dmg && !r.todo).length,
      datasheet: c?.datasheet ? { id: c.datasheet.id, name: c.datasheet.name } : null,
      // profile differences only; prices are reported in their own column
      issues: (c?.issues ?? 0) - (c?.pointsIssues ?? 0),
      // the two profiles side by side, when there is anything to show
      diff: diff && (diff.stats || diff.weapons.length || diff.leader) ? diff : null,
      manualPoints: c?.points?.source === "field-manual" ? c.points.expected : null,
      manualEnh: c?.enhancement?.source === "field-manual" ? c.enhancement.db : null,
      priceDiffers: (c?.pointsIssues ?? 0) > 0,
      // the box starts at Wahapedia's price, because the file had none and the Field Manual hasn't been read
      fromWahapedia: !own && c?.points?.source === "wahapedia"
    }
  })
  return {
    expired: false,
    review: {
      pendingId,
      fileName: p.pending.fileName,
      meta: parsed.meta,
      warnings: parsed.warnings,
      stats: parsed.stats,
      groups: parsed.groups,
      armyRules: parsed.armyRules.map((id) => library[id]?.nm ?? id),
      gameSystem: parsed.gameSystem,
      // what the boxes below add up to, which is what gets saved (a roster file alone has no points)
      total: units.reduce((s, u) => s + u.pts + (u.enh?.pts ?? 0), 0),
      fromWahapedia: units.filter((u) => u.fromWahapedia).length,
      units,
      // for the site's owner, whose agent can translate them (the MCP's save_rule)
      notModelled: isOwner(viewer)
        ? notInLibrary(parsed.units, listRuleBook(library, parsed.rules))
            .filter((x) => x.rule.todo)
            .map((x) => ({ name: x.rule.nm, src: x.rule.src, text: x.rule.txt, units: x.units.map((u) => u.nm) }))
        : [],
      database: check.snapshot
        ? {
            matched: check.totals.matched,
            unmatched: check.totals.unmatched,
            issues: check.totals.issues - check.totals.pointsIssues,
            // Wahapedia still has old prices for this faction, so its datasheets may be old too
            behind: behind ? behind.differing : 0
          }
        : null,
      manual: check.manual
        ? {
            faction: check.manual.faction,
            version: check.manual.version,
            differing: check.units.filter((u) => u.pointsIssues > 0).length,
            total: check.totals.pointsDb
          }
        : null
    }
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const viewer = requireViewer(context, request)
  const form = await request.formData()
  const intent = form.get("intent")

  if (intent === "read") {
    const file = form.get("roster")
    const text = String(form.get("text") ?? "")
    if (!(file instanceof File) || file.size === 0) return data({ error: "Choose a roster file first." }, { status: 400 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await run(
      Effect.gen(function*() {
        const xml = yield* readRosterFile(bytes)
        // parse now so a bad file is reported here, not on the review page
        yield* parseRoster(xml, text, yield* importContext)
        return { id: yield* (yield* Imports).add({ fileName: file.name, rosterXml: xml, textExport: text, ownerId: viewer.id }) }
      }).pipe(Effect.catchTag("RosterParseError", (e) => Effect.succeed({ error: e.message })))
    )
    if ("error" in result) return data({ error: result.error }, { status: 422 })
    return redirect(`/lists/import?pending=${result.id}`)
  }

  if (intent === "save") {
    const pendingId = String(form.get("pending") ?? "")
    const useDatabase = form.get("database") === "true"
    const useManual = form.get("manual") === "true"
    const id = await run(Effect.gen(function*() {
      const p = yield* preview(pendingId, viewer.id)
      if (!p) return null
      const { parsed, check, pending } = p
      const number = (key: string) => {
        const n = parseFloat(String(form.get(key) ?? ""))
        return Number.isNaN(n) || n < 0 ? null : n
      }
      // points and enhancement costs can be corrected in the review; everything else comes from the file
      const units = parsed.units.map((u): Unit => {
        // A unit's stored points include its enhancement. The form asks for the two separately, the way
        // the Field Manual prices them, and they are added here.
        const enhPts = u.enh ? (number(`enh.${u.id}`) ?? u.enh.pts) : 0
        const unitPts = number(`pts.${u.id}`) ?? u.pts - (u.enh?.pts ?? 0)
        const edited: Unit = { ...u, pts: unitPts + enhPts, ...(u.enh ? { enh: { ...u.enh, pts: enhPts } } : {}) }
        const c = check.units.find((x) => x.unitId === u.id)
        if (!c) return edited
        // the Field Manual's price replaces whatever the file or the form had, when it has one for this unit
        const priced = useManual && c.points?.source === "field-manual" ? applyPoints(edited, c) : edited
        // Wahapedia's profiles are taken for every unit, or only for the ones ticked in the review. Points are
        // a separate choice, so this never touches them.
        if (useDatabase || form.get(`db.${u.id}`) === "true") return applyProfiles(priced, c)
        return c.datasheet ? { ...priced, datasheetId: c.datasheet.id } : priced
      })
      const name = String(form.get("name") ?? "").trim() || parsed.meta.name
      const listId = yield* (yield* Lists).create({
        meta: { ...parsed.meta, name },
        groups: parsed.groups,
        armyRules: parsed.armyRules,
        rules: parsed.rules,
        units,
        rosterXml: pending.rosterXml,
        textExport: pending.textExport,
        gameSystem: parsed.gameSystem,
        ownerId: viewer.id
      })
      yield* (yield* Imports).remove(pendingId)
      return listId
    }))
    if (!id) return data({ error: "That upload has expired. Choose the file again." }, { status: 410 })
    return redirect(`/lists/${id}`)
  }

  if (intent === "cancel") {
    await run(Effect.gen(function*() {
      const imports = yield* Imports
      const id = String(form.get("pending") ?? "")
      const pending = Option.getOrUndefined(yield* imports.get(id))
      if (pending?.ownerId === viewer.id) yield* imports.remove(id)
    }))
    return redirect("/lists/import")
  }

  throw data({ message: "Unknown action." }, { status: 400 })
}

export const meta: Route.MetaFunction = () => [{ title: "Import a list · Cogitator Core" }]

export default function ImportList({ loaderData, actionData }: Route.ComponentProps) {
  const { review, expired } = loaderData
  const navigation = useNavigation()
  const intent = navigation.formData?.get("intent")
  const error = actionData && "error" in actionData ? actionData.error : expired ? "That upload has expired. Choose the file again." : null

  return (
    <main>
      <div className="crumbs">
        <Link to="/lists">Your lists</Link>
      </div>
      <div className="dhead">
        <div>
          <h2>Import a list</h2>
          <div className="meta">
            Roster files from 40k.app, NewRecruit or BattleScribe (.ros or .rosz). Units, weapons, leaders and rule text are read from the
            file, then checked against the rules database.
          </div>
        </div>
      </div>

      {review ? null : (
        <Form method="post" encType="multipart/form-data" className="impform">
          <label className="drop">
            Roster file
            <input type="file" name="roster" accept=".ros,.rosz,application/xml,text/xml,application/zip" required />
            <span className="hint">Choose a .ros or .rosz file</span>
          </label>
          <label className="txt">
            Text export, optional
            <textarea
              name="text"
              rows={7}
              placeholder="Paste the 40k.app text export here for points, enhancement costs, detachments and wargear like Faolchú that roster files leave out."
            />
          </label>
          <div className="presets">
            <button className="btn primary" type="submit" name="intent" value="read" disabled={navigation.state !== "idle"}>
              {intent === "read" ? "Reading…" : "Read the roster"}
            </button>
          </div>
          {error ? <p className="err">{error}</p> : null}
        </Form>
      )}

      {review ? <Review key={review.pendingId} review={review} error={error} /> : null}
    </main>
  )
}

type ReviewData = NonNullable<Route.ComponentProps["loaderData"]["review"]>
type ReviewUnit = ReviewData["units"][number]

const flip = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

function Review({ review, error }: { review: ReviewData; error: string | null }) {
  const navigation = useNavigation()
  const intent = navigation.formData?.get("intent")
  // which units' differences are open, and which units are to take Wahapedia's profile
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [fromDb, setFromDb] = useState<ReadonlySet<string>>(new Set())
  const differing = review.units.filter((u) => u.diff)
  const applicable = differing.filter((u) => u.diff?.applicable).map((u) => u.id)
  const chosen = applicable.filter((id) => fromDb.has(id)).length
  const allOpen = differing.length > 0 && differing.every((u) => open.has(u.id))

  return (
    <Form method="post" className="imp-review">
      <input type="hidden" name="pending" value={review.pendingId} />
      <h3 className="sh">
        Check it before saving <span>{review.fileName}</span>
      </h3>
      <label className="impname">
        List name <input name="name" defaultValue={review.meta.name} />
      </label>
      <p className="lede">
        {review.stats.onTable === review.stats.units
          ? `${review.stats.units} units`
          : `${review.stats.onTable} units on the table (${review.stats.units} datasheets; ${review.stats.units - review.stats.onTable} join another unit as its leader)`}
        , {review.stats.models} models, {review.total} pts. {review.stats.known} rules already in the library, {review.stats.newRules}{" "}
        new ones read from the file
        {review.stats.todo ? `, ${review.stats.todo} of which look like they change damage` : ""}.
        {review.armyRules.length ? ` Army and detachment rules: ${review.armyRules.join(", ")}.` : ""}
      </p>
      {review.notModelled.length ? (
        <div className="note warn">
          <b>Not modelled yet:</b> {review.notModelled.length === 1 ? "this rule reads" : `these ${review.notModelled.length} rules read`} like{" "}
          {review.notModelled.length === 1 ? "it changes" : "they change"} damage, and the rules library has nothing of that name, so the matrix will
          leave {review.notModelled.length === 1 ? "it" : "them"} out. Once the list is saved, its page has a request to paste into your connected
          agent, which drafts {review.notModelled.length === 1 ? "it" : "them"} into the library for you to check.
          <ul className="warns">
            {review.notModelled.map((x) => (
              <li key={x.name}>
                <b>{x.name}</b> ({x.src}; {x.units.join(", ")}): {x.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.warnings.length ? (
        <ul className="warns">
          {review.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {review.manual ? (
        <div className={`note ${review.manual.differing ? "warn" : ""}`}>
          <b>Points:</b> the Field Manual ({review.manual.faction.toLowerCase()} {review.manual.version}){" "}
          {review.manual.differing
            ? `prices ${review.manual.differing} ${plural(review.manual.differing, "unit")} differently from what’s below${review.manual.total !== null ? `, for a total of ${review.manual.total} pts` : ""}.`
            : "agrees with every price below."}
          <label className="tog" style={{ marginTop: 6 }}>
            <input type="checkbox" name="manual" value="true" defaultChecked />
            <span>
              Use the Field Manual’s points
              <small>
                On: each unit and enhancement is saved at its current official price, whatever the file or the boxes below say. Off: the
                numbers below are saved as they are.
              </small>
            </span>
          </label>
        </div>
      ) : review.fromWahapedia ? (
        <p className="note warn">
          <b>Points:</b> the Field Manual hasn’t been read for this faction yet, so {review.fromWahapedia} of the boxes below start at
          Wahapedia’s prices, which can be a Field Manual version behind. Check them before saving. Once the list is saved, the daily
          check reads the faction’s page, and the list’s Check page shows any price that has moved.
        </p>
      ) : (
        <p className="note">
          The Field Manual hasn’t been read for this faction, so points come from the text export or the boxes below.{" "}
          <Link to="/database">Read it</Link> to have them filled in and checked.
        </p>
      )}

      {review.database ? (
        <div className={`note ${review.database.issues ? "warn" : ""}`}>
          <b>Profiles:</b> {review.database.matched} of {review.stats.units} datasheets in the file resolve to one in Wahapedia
          {review.database.issues
            ? `, and ${review.database.issues} weapon ${plural(review.database.issues, "profile")} or stat lines in the file disagree with it.`
            : ", and every profile in the file agrees with it."}{" "}
          {differing.length ? (
            <button
              type="button"
              className="linkbtn"
              onClick={() => setOpen(allOpen ? new Set() : new Set(differing.map((u) => u.id)))}
            >
              {allOpen ? "Hide the differences" : "Show every difference"}
            </button>
          ) : null}
          {review.database.issues && review.database.behind ? (
            <>
              {" "}
              Wahapedia is still on old prices for {review.database.behind} of this faction’s {plural(review.database.behind, "unit")}, so its
              datasheets may be behind too; where the two differ, your roster may be the one that’s current.
            </>
          ) : null}
          {applicable.length ? (
            <label className="tog" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                name="database"
                value="true"
                checked={chosen === applicable.length}
                ref={(el) => {
                  if (el) el.indeterminate = chosen > 0 && chosen < applicable.length
                }}
                onChange={(e) => setFromDb(e.target.checked ? new Set(applicable) : new Set())}
              />
              <span>
                Use Wahapedia’s profiles where they differ
                <small>
                  Leave this off if your codex is newer than the Wahapedia export. Open a unit’s differences in the table to compare the
                  two, and to choose unit by unit.
                  {chosen > 0 && chosen < applicable.length ? ` On for ${chosen} of ${applicable.length} units.` : ""}
                </small>
              </span>
            </label>
          ) : null}
        </div>
      ) : (
        <p className="note warn">
          No Wahapedia export is loaded, so the file’s own profiles will be used unchecked. <Link to="/database">Load one</Link> to check them.
        </p>
      )}

      <div className="tbl-scroll">
        <table className="dt imp">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Models</th>
              <th title="The unit’s own cost. Its enhancement is entered separately and added on top.">Unit points</th>
              <th className="l">Attached</th>
              <th className="l">Enhancement</th>
              <th>Weapons</th>
              <th className="l">Rules</th>
              <th className="l">Database</th>
            </tr>
          </thead>
          <tbody>
            {review.units.map((u) => (
              <Fragment key={u.id}>
                <tr className={u.diff && open.has(u.id) ? "opened" : undefined}>
                  <td>
                    <b>{u.nm}</b>
                    <span className="um">{u.kw.map((k) => k.toLowerCase()).join(", ")}</span>
                  </td>
                  <td>{u.models}</td>
                  <td>
                    <input
                      className="ptsmini"
                      name={`pts.${u.id}`}
                      defaultValue={u.pts}
                      aria-label={`Unit points for ${u.nm}, without its enhancement`}
                      inputMode="numeric"
                    />
                  </td>
                  <td className="l">
                    {u.group ? `${u.group.role === "Bodyguard" ? "led in" : u.group.role === "Support" ? "supports" : "leads"} ${u.group.short}` : <span className="none">—</span>}
                  </td>
                  <td className="l">
                    {u.enh ? (
                      <>
                        {u.enh.nm}{" "}
                        <input className="ptsmini" name={`enh.${u.id}`} defaultValue={u.enh.pts} aria-label="Enhancement points" inputMode="numeric" /> pts
                      </>
                    ) : (
                      <span className="none">—</span>
                    )}
                  </td>
                  <td>{u.weapons}</td>
                  <td className="l">
                    {u.counted ? <DemoChip state="on">{u.counted} counted</DemoChip> : null}
                    {u.todo ? <DemoChip state="todo">{u.todo} not modelled</DemoChip> : null}
                    {u.noted ? <DemoChip state="note">{u.noted} noted</DemoChip> : null}
                  </td>
                  <td className="l">
                    {u.priceDiffers && u.manualPoints !== null ? (
                      <span className="pill gold">
                        Field Manual: {u.manualPoints}
                        {u.manualEnh !== null ? ` + ${u.manualEnh}` : ""} pts
                      </span>
                    ) : null}{" "}
                    {!review.database ? null : !u.datasheet ? (
                      <span className="pill warn">no datasheet</span>
                    ) : u.diff ? (
                      <>
                        <button
                          type="button"
                          className="pill warn"
                          aria-expanded={open.has(u.id)}
                          aria-controls={`diff-${u.id}`}
                          onClick={() => setOpen(flip(open, u.id))}
                        >
                          {u.issues} profile {plural(u.issues, "difference")} <span aria-hidden="true">{open.has(u.id) ? "▴" : "▾"}</span>
                        </button>
                        {fromDb.has(u.id) ? <span className="pill gold">taking Wahapedia’s</span> : null}
                      </>
                    ) : (
                      <span className="pill ok">profiles agree</span>
                    )}
                  </td>
                </tr>
                {u.diff && u.datasheet ? (
                  // kept in the page while closed, so a unit's choice is still submitted with the form
                  <tr className="diffrow" id={`diff-${u.id}`} hidden={!open.has(u.id)}>
                    <td colSpan={8}>
                      <DiffPanel
                        unit={u}
                        diff={u.diff}
                        datasheet={u.datasheet}
                        chosen={fromDb.has(u.id)}
                        onChoose={() => setFromDb(flip(fromDb, u.id))}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Unit points are the unit’s own cost, as the Field Manual lists it. An enhancement’s cost goes in its own box and is added on
        top, so don’t include it in the unit’s points.
      </p>
      {error ? <p className="err">{error}</p> : null}
      <div className="presets" style={{ paddingTop: 12 }}>
        <button className="btn primary" type="submit" name="intent" value="save" disabled={navigation.state !== "idle"}>
          {intent === "save" ? "Saving…" : "Save and open the matrix"}
        </button>
        <button className="btn" type="submit" name="intent" value="cancel" formNoValidate>
          Cancel
        </button>
      </div>
    </Form>
  )
}

const WEAPON_COLUMNS: ReadonlyArray<readonly [keyof ProfileCells, string]> = [
  ["A", "A"],
  ["skill", "BS/WS"],
  ["S", "S"],
  ["AP", "AP"],
  ["D", "D"],
  ["abilities", "Abilities"]
]
const STAT_COLUMNS: ReadonlyArray<readonly [keyof StatCells, string]> = [
  ["T", "T"],
  ["Sv", "Sv"],
  ["W", "W"],
  ["inv", "Invuln"]
]

/** One side of a comparison: the cells of a row, with the ones that disagree marked. */
function Cells<K extends string>({
  columns,
  row,
  changed
}: {
  columns: ReadonlyArray<readonly [K, string]>
  row: Readonly<Record<K, string>>
  changed: ReadonlyArray<K>
}) {
  return (
    <>
      {columns.map(([key]) => (
        <td key={key} className={`${key === "abilities" ? "l " : ""}${changed.includes(key) ? "chg" : ""}`}>
          {row[key] || "—"}
        </td>
      ))}
    </>
  )
}

/**
 * A unit's profile as the roster has it and as Wahapedia has it, one above the
 * other, with the cells that disagree marked on both. Neither is shown as the
 * correction of the other, because either can be the one that's out of date.
 */
function DiffPanel({
  unit,
  diff,
  datasheet,
  chosen,
  onChoose
}: {
  unit: ReviewUnit
  diff: ProfileDiff
  datasheet: { id: string; name: string }
  chosen: boolean
  onChoose: () => void
}) {
  return (
    <div className="diff">
      {diff.stats ? (
        <table className="dt pd">
          <thead>
            <tr>
              <th>Unit</th>
              <th className="l">From</th>
              {STAT_COLUMNS.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td rowSpan={2}>
                <b>{unit.nm}</b>
              </td>
              <td className="l src">Your roster</td>
              <Cells columns={STAT_COLUMNS} row={diff.stats.list} changed={diff.stats.changed} />
            </tr>
            <tr>
              <td className="l src">Wahapedia</td>
              <Cells columns={STAT_COLUMNS} row={diff.stats.db} changed={diff.stats.changed} />
            </tr>
          </tbody>
        </table>
      ) : null}
      {diff.weapons.length ? (
        <table className="dt pd">
          <thead>
            <tr>
              <th>Weapon</th>
              <th className="l">From</th>
              {WEAPON_COLUMNS.map(([key, label]) => (
                <th key={key} className={key === "abilities" ? "l" : undefined}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          {diff.weapons.map((w, i) => (
            <tbody key={i}>
              <tr>
                <td rowSpan={2}>
                  <b>{w.nm}</b>
                  <span className="um">
                    {w.melee ? "melee" : "ranged"}
                    {w.matchedAs ? `, “${w.matchedAs}” on the datasheet` : ""}
                  </span>
                </td>
                <td className="l src">Your roster</td>
                <Cells columns={WEAPON_COLUMNS} row={w.list} changed={w.changed} />
              </tr>
              <tr>
                <td className="l src">Wahapedia</td>
                {w.db ? (
                  <Cells columns={WEAPON_COLUMNS} row={w.db} changed={w.changed} />
                ) : (
                  <td className="l src" colSpan={WEAPON_COLUMNS.length}>
                    no weapon by this name on the datasheet, so the roster’s is kept
                  </td>
                )}
              </tr>
            </tbody>
          ))}
        </table>
      ) : null}
      {diff.leader ? <p className="none">{diff.leader}</p> : null}
      <div className="diffact">
        {diff.applicable ? (
          <label className="tog">
            <input type="checkbox" name={`db.${unit.id}`} value="true" checked={chosen} onChange={onChoose} />
            <span>Use Wahapedia’s profile for this unit</span>
          </label>
        ) : null}
        <Link to={`/database/datasheets/${datasheet.id}`} target="_blank" rel="noreferrer">
          Open the {datasheet.name} datasheet
        </Link>
      </div>
    </div>
  )
}
