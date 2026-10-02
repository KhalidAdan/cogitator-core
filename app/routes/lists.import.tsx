/**
 * Import a list: upload a roster (and optionally the 40k.app text export),
 * review what was read, then save it.
 *
 * The upload is stored as a pending import and the review lives at
 * `?pending=<id>`, so the page can be reloaded. Saving re-parses the stored
 * file, applies the edits from the review form, and creates the list.
 */
import { Effect, Option } from "effect"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { parseRoster, readRosterFile } from "~/.server/importer/roster"
import { Imports } from "~/.server/repos/Imports"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { run } from "~/.server/runtime"
import { seedData } from "~/.server/seed/Seed"
import { applyCheck, applyPoints, checkList } from "~/.server/wahapedia/check"
import { DemoChip } from "~/components/chips"
import { plural } from "~/components/ledger"
import type { Rule, RuleBook, Unit } from "~/domain/schema"
import type { Route } from "./+types/lists.import"

const importContext = (library: RuleBook) => ({
  library,
  factionArmyRules: seedData.factionArmyRules,
  detachmentRules: seedData.detachmentRules,
  detachmentUnitGrants: seedData.detachmentUnitGrants
})

/** Parse a pending import and check it against the database. */
const preview = (pendingId: string) =>
  Effect.gen(function*() {
    const pending = Option.getOrUndefined(yield* (yield* Imports).get(pendingId))
    if (!pending) return null
    const library = yield* (yield* Rules).book
    const parsed = yield* parseRoster(pending.rosterXml, pending.textExport, importContext(library))
    const check = yield* checkList({ units: parsed.units, meta: parsed.meta, rules: parsed.rules }, library)
    return { pending, parsed, check, library }
  })

export async function loader({ request }: Route.LoaderArgs) {
  const pendingId = new URL(request.url).searchParams.get("pending")
  if (!pendingId) return { review: null, expired: false }
  const p = await run(preview(pendingId))
  if (!p) return { review: null, expired: true }
  const { parsed, check, library } = p
  const ruleOf = (id: string): Rule | undefined => parsed.rules[id] ?? library[id]
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
      total: parsed.units.reduce((s, u) => s + u.pts, 0),
      units: parsed.units.map((u) => {
        const rules = u.rules.map(ruleOf).filter((r): r is Rule => !!r)
        const c = check.units.find((x) => x.unitId === u.id)
        return {
          id: u.id,
          nm: u.nm,
          models: u.models,
          // Shown and edited as the unit's own cost; the enhancement is a separate field and is added on save.
          // A roster with no text export has no points at all, so start from the Field Manual's where it has them.
          pts: u.pts - (u.enh?.pts ?? 0) || (c?.points?.source === "field-manual" ? (c.points.expected ?? 0) : 0),
          enh: u.enh ? { nm: u.enh.nm, pts: u.enh.pts || (c?.enhancement?.source === "field-manual" ? (c.enhancement.db ?? 0) : 0) } : null,
          group: u.grp ? { short: parsed.groups[u.grp]?.short ?? "", role: u.role ?? null } : null,
          kw: (u.kw ?? []).filter((k) => ["CHARACTER", "INFANTRY", "VEHICLE", "MONSTER", "MOUNTED", "BATTLELINE"].includes(k)),
          weapons: u.w.filter((w) => !w.off).length,
          counted: rules.filter((r) => r.dmg).length,
          todo: rules.filter((r) => !r.dmg && r.todo).length,
          noted: rules.filter((r) => !r.dmg && !r.todo).length,
          datasheet: c?.datasheet?.name ?? null,
          // profile differences only; prices are reported in their own column
          issues: (c?.issues ?? 0) - (c?.pointsIssues ?? 0),
          manualPoints: c?.points?.source === "field-manual" ? c.points.expected : null,
          manualEnh: c?.enhancement?.source === "field-manual" ? c.enhancement.db : null,
          priceDiffers: (c?.pointsIssues ?? 0) > 0
        }
      }),
      database: check.snapshot
        ? { matched: check.totals.matched, unmatched: check.totals.unmatched, issues: check.totals.issues - check.totals.pointsIssues }
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

export async function action({ request }: Route.ActionArgs) {
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
        yield* parseRoster(xml, text, importContext(yield* (yield* Rules).book))
        return { id: yield* (yield* Imports).add({ fileName: file.name, rosterXml: xml, textExport: text }) }
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
      const p = yield* preview(pendingId)
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
        if (useDatabase) return applyCheck(edited, c)
        // the Field Manual's price replaces whatever the file or the form had, when it has one for this unit
        const priced = useManual && c.points?.source === "field-manual" ? applyPoints(edited, c) : edited
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
        gameSystem: parsed.gameSystem
      })
      yield* (yield* Imports).remove(pendingId)
      return listId
    }))
    if (!id) return data({ error: "That upload has expired. Choose the file again." }, { status: 410 })
    return redirect(`/lists/${id}`)
  }

  if (intent === "cancel") {
    await run(Effect.flatMap(Imports, (i) => i.remove(String(form.get("pending") ?? ""))))
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

      {review ? (
        <Form method="post" className="imp-review">
          <input type="hidden" name="pending" value={review.pendingId} />
          <h3 className="sh">
            Check it before saving <span>{review.fileName}</span>
          </h3>
          <label className="impname">
            List name <input name="name" defaultValue={review.meta.name} />
          </label>
          <p className="lede">
            {review.stats.units} units, {review.stats.models} models, {review.total} pts. {Object.keys(review.groups).length} attached{" "}
            {plural(Object.keys(review.groups).length, "unit")} found. {review.stats.known} rules already in the library, {review.stats.newRules}{" "}
            new ones read from the file
            {review.stats.todo ? `, ${review.stats.todo} of which look like they change damage` : ""}.
            {review.armyRules.length ? ` Army and detachment rules: ${review.armyRules.join(", ")}.` : ""}
          </p>
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
          ) : (
            <p className="note">
              The Field Manual hasn’t been read for this faction, so points come from the text export or the boxes below.{" "}
              <Link to="/database">Read it</Link> to have them filled in and checked.
            </p>
          )}

          {review.database ? (
            <div className={`note ${review.database.issues ? "warn" : ""}`}>
              <b>Profiles:</b> {review.database.matched} of {review.stats.units} units resolve to a Wahapedia datasheet
              {review.database.issues
                ? `, and ${review.database.issues} weapon ${plural(review.database.issues, "profile")} or stat lines in the file disagree with it.`
                : ", and every profile in the file agrees with it."}
              {review.database.issues ? (
                <label className="tog" style={{ marginTop: 6 }}>
                  <input type="checkbox" name="database" value="true" />
                  <span>
                    Use Wahapedia’s profiles where they differ
                    <small>
                      Leave this off if your codex is newer than the Wahapedia export; you can review each difference, and apply them, on the
                      list’s Database check tab after saving.
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
                  <tr key={u.id}>
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
                      {!review.database ? null : u.datasheet ? (
                        u.issues ? (
                          <span className="pill warn">
                            {u.issues} profile {plural(u.issues, "difference")}
                          </span>
                        ) : (
                          <span className="pill ok">profiles agree</span>
                        )
                      ) : (
                        <span className="pill warn">no datasheet</span>
                      )}
                    </td>
                  </tr>
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
      ) : null}
    </main>
  )
}
