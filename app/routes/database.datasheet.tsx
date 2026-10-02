/** One datasheet as the database has it, and a way to turn it into a benchmark target. */
import { Effect, Option } from "effect"
import { Form, Link, useNavigation } from "react-router"
import { Targets } from "~/.server/repos/Targets"
import { run } from "~/.server/runtime"
import { currentSnapshotId, type Datasheet, datasheets } from "~/.server/wahapedia/queries"
import { parseNum } from "~/domain/keywords"
import type { Target } from "~/domain/schema"
import { slug } from "~/domain/text"
import type { Route } from "./+types/database.datasheet"

const load = (datasheetId: string) =>
  Effect.gen(function*() {
    const id = Option.getOrUndefined(yield* currentSnapshotId)
    const sheet = id === undefined ? undefined : (yield* datasheets(id, [datasheetId])).get(datasheetId)
    if (!sheet) return yield* Effect.fail({ _tag: "TargetNotFound" as const, message: "That datasheet isn’t in the current snapshot." })
    return sheet
  })

export async function loader({ params }: Route.LoaderArgs) {
  return { sheet: await run(load(params.datasheetId)) }
}

const TARGET_KEYWORDS = ["INFANTRY", "VEHICLE", "MONSTER", "MOUNTED", "BEASTS", "SWARM", "FLY", "CHARACTER", "PSYKER", "TITANIC", "WALKER", "DAEMON"]

/**
 * A benchmark target from a datasheet. Targets are single-profile (handoff
 * section 11), so this takes the first model profile and the chosen unit size.
 */
function targetFrom(sheet: Datasheet, costIndex: number): Target | null {
  const cost = sheet.costs[costIndex]
  const model = sheet.models[0]
  const size = cost?.description.match(/^(\d+) models?$/i)
  if (!cost || !model || !size) return null
  const kw = sheet.keywords.map((k) => k.toUpperCase())
  return {
    id: `ds-${slug(sheet.name)}-${size[1]}`,
    nm: sheet.name,
    pts: cost.cost,
    T: parseNum(model.T),
    Sv: parseNum(model.Sv),
    // an invulnerable save that only works against shooting can't be expressed on a single-profile target
    inv: /\d/.test(model.inv) && !/ranged attacks only/i.test(model.invNote) ? parseNum(model.inv) : 0,
    W: parseNum(model.W),
    N: +size[1],
    fnp: 0,
    dr: 0,
    kw: kw.filter((k) => TARGET_KEYWORDS.includes(k)).join(" "),
    cls: kw.includes("VEHICLE") || kw.includes("MONSTER") ? "veh" : "inf"
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData()
  const index = Number(form.get("cost"))
  return run(Effect.gen(function*() {
    const sheet = yield* load(params.datasheetId)
    const target = targetFrom(sheet, index)
    if (!target) {
      return yield* Effect.fail({ _tag: "InvalidInput" as const, message: "That datasheet has no profile or price to build a target from." })
    }
    yield* (yield* Targets).add(target)
    return { added: `${target.nm} (${target.N} × W${target.W}, T${target.T}, ${target.Sv}+, ${target.pts} pts)` }
  }))
}

export const meta: Route.MetaFunction = ({ data }) => [{ title: `${data?.sheet.name ?? "Datasheet"} · Cogitator Core` }]

export default function DatasheetView({ loaderData, actionData }: Route.ComponentProps) {
  const { sheet } = loaderData
  const navigation = useNavigation()
  const sizes = sheet.costs.map((c, i) => ({ c, i })).filter(({ c }) => /^\d+ models?$/i.test(c.description))
  return (
    <main>
      <div className="crumbs">
        <Link to="/database/datasheets">Datasheets</Link>
      </div>
      <div className="dhead">
        <div>
          <h2>{sheet.name}</h2>
          <div className="meta">
            {sheet.faction}, {sheet.role || "no role"}. Source: {sheet.source}
            {sheet.legacy ? " (legacy)" : ""}.{" "}
            {sheet.link ? (
              <a href={sheet.link} rel="noreferrer">
                On Wahapedia
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <h3 className="sh">Profile</h3>
      <div className="tbl-scroll">
        <table className="dt">
          <thead>
            <tr>
              <th>Model</th>
              <th>M</th>
              <th>T</th>
              <th>Sv</th>
              <th>Inv</th>
              <th>W</th>
              <th>Ld</th>
              <th>OC</th>
            </tr>
          </thead>
          <tbody>
            {sheet.models.map((m) => (
              <tr key={m.name}>
                <td>
                  <span className="wn">{m.name}</span>
                  {m.invNote ? <span className="wnotes">{m.invNote}</span> : null}
                </td>
                <td>{m.M}</td>
                <td>{m.T}</td>
                <td>{m.Sv}</td>
                <td>{/\d/.test(m.inv) ? `${m.inv}+` : "–"}</td>
                <td>{m.W}</td>
                <td>{m.Ld}</td>
                <td>{m.OC}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="sh">Weapons</h3>
      <div className="tbl-scroll">
        <table className="dt">
          <thead>
            <tr>
              <th>Weapon</th>
              <th>Range</th>
              <th>A</th>
              <th>BS/WS</th>
              <th>S</th>
              <th>AP</th>
              <th>D</th>
              <th className="l">Abilities</th>
            </tr>
          </thead>
          <tbody>
            {sheet.wargear.map((w, i) => (
              <tr key={i}>
                <td>
                  <span className="wn">{w.name}</span>
                </td>
                <td>{w.range}</td>
                <td>{w.A}</td>
                <td>{/\d/.test(w.skill) ? `${w.skill}+` : "N/A"}</td>
                <td>{w.S}</td>
                <td>{w.AP}</td>
                <td>{w.D}</td>
                <td className="l">{w.abilities}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dgrid">
        <section>
          <h3 className="sh">Points</h3>
          <div className="tbl-scroll">
            <table className="dt" style={{ minWidth: 0 }}>
              <tbody>
                {sheet.costs.map((c, i) => (
                  <tr key={i}>
                    <td>
                      {c.description}
                      {c.tier ? <span className="wnotes">{c.tier.toLowerCase()}</span> : null}
                    </td>
                    <td className="dealt">{c.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sizes.length && sheet.models.length ? (
            <Form method="post" className="searchbar">
              <label className="field">
                Benchmark target from this datasheet
                <select name="cost">
                  {sizes.map(({ c, i }) => (
                    <option key={i} value={i}>
                      {c.description}, {c.cost} pts{c.tier ? ` (${c.tier.toLowerCase()})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" type="submit" disabled={navigation.state === "submitting"}>
                Add to the benchmark set
              </button>
            </Form>
          ) : null}
          {actionData ? <p className="note">Added {actionData.added}. It’s a new column in every list’s matrix; tune it on its target page.</p> : null}
          <p className="hint">
            Targets are a single profile: the first model’s stats, no Feel No Pain or damage reduction. Add those on the target’s page if the
            unit has them.
          </p>

          <h3 className="sh">Composition and keywords</h3>
          <p className="rtext">{[...sheet.composition, sheet.loadout].filter(Boolean).join("\n")}</p>
          <div className="chips">
            {sheet.factionKeywords.map((k) => (
              <span key={k} className="chip mark-off demo">
                {k}
              </span>
            ))}
            {sheet.keywords.map((k) => (
              <span key={k} className="chip note demo">
                {k}
              </span>
            ))}
          </div>
          {sheet.leads.length ? (
            <p className="hint">
              Can {sheet.isSupport ? "support" : "lead"}:{" "}
              {sheet.leads.map((l, i) => (
                <span key={l.id}>
                  {i ? ", " : ""}
                  <Link to={`/database/datasheets/${l.id}`}>{l.name}</Link>
                </span>
              ))}
              .
            </p>
          ) : null}
          {sheet.ledBy.length ? (
            <p className="hint">
              Can be joined by:{" "}
              {sheet.ledBy.map((l, i) => (
                <span key={l.id}>
                  {i ? ", " : ""}
                  <Link to={`/database/datasheets/${l.id}`}>{l.name}</Link>
                </span>
              ))}
              .
            </p>
          ) : null}
        </section>
        <section>
          <h3 className="sh">Abilities</h3>
          {sheet.abilities.map((a, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <b>
                {a.name}
                {a.parameter ? ` ${a.parameter}` : ""}
              </b>{" "}
              <span className="pill">{a.type.replace(/ \(.*\)$/, "")}</span>
              {a.type === "Core" || a.type === "Faction" ? null : (
                <p className="rtext" style={{ margin: "4px 0 0" }}>
                  {a.text}
                </p>
              )}
            </div>
          ))}
          {sheet.damaged ? <p className="hint">Damaged, {sheet.damaged}</p> : null}
          {sheet.options.length ? (
            <>
              <h3 className="sh">Wargear options</h3>
              <ul className="warns">
                {sheet.options.map((o, i) => (
                  <li key={i} className="rtext">
                    {o}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>
    </main>
  )
}
