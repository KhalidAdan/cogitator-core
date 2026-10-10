/**
 * Rule editor: the paraphrase shown on rule cards, the official wording from
 * the database beside it, and the effect the engine applies. The effect is
 * built as clauses from the effect vocabulary (components/effect-editor.tsx),
 * posted as JSON and validated against the schema on save.
 */
import { Effect } from "effect"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { requireOwner } from "~/.server/access"
import { saveRule } from "~/.server/library"
import { Rules } from "~/.server/repos/Rules"
import { run } from "~/.server/runtime"
import { EffectEditor } from "~/components/effect-editor"
import { SITUATION } from "~/domain/options"
import { isOwner, useViewer } from "~/viewer"
import type { Route } from "./+types/library.rule"

export async function loader({ params }: Route.LoaderArgs) {
  return run(Effect.gen(function*() {
    const rules = yield* Rules
    const entry = yield* rules.get(params.ruleId)
    // conditions other rules already wait for, so a new rule can share one instead of inventing a second key
    const all = yield* rules.all
    const known = new Map<string, string>(SITUATION.map(([k, l]) => [k, l]))
    for (const e of all) if (e.rule.cond && !known.has(e.rule.cond)) known.set(e.rule.cond, e.rule.condNm ?? e.rule.cond)
    const conditions = [...known].map(([key, label]) => ({ key, label }))
    // an effect can also wait for a mark
    const marks = new Map<string, string>()
    for (const e of all) if (e.rule.mark && !known.has(e.rule.mark) && !marks.has(e.rule.mark)) marks.set(e.rule.mark, `Mark: ${e.rule.markNm ?? e.rule.mark}`)
    return { entry, conditions, switches: [...conditions, ...[...marks].map(([key, label]) => ({ key, label }))] }
  }))
}

export async function action({ request, params, context }: Route.ActionArgs) {
  // the library is everyone's maths, so only the site's owner changes it
  requireOwner(context, request)
  const form = await request.formData()
  const intent = form.get("intent")
  const id = params.ruleId
  const text = (k: string) => String(form.get(k) ?? "").trim()

  if (intent === "reset") {
    await run(Effect.flatMap(Rules, (r) => r.resetToSeed(id)))
    return { saved: "Put back to the seeded version." }
  }
  if (intent === "delete") {
    await run(Effect.gen(function*() {
      const rules = yield* Rules
      const entry = yield* rules.get(id)
      // seeded rules are referenced by the built-in lists
      if (!entry.seeded) yield* rules.remove(id)
    }))
    return redirect("/library")
  }
  if (intent !== "save") throw data({ message: "Unknown action." }, { status: 400 })

  let fxInput: unknown
  try {
    fxInput = text("fx") ? JSON.parse(text("fx")) : []
  } catch (e) {
    return data({ error: `The effect isn’t valid JSON: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 })
  }

  const result = await run(
    saveRule(id, {
      nm: text("nm"),
      src: text("src"),
      txt: text("txt"),
      dmg: form.get("dmg") === "true",
      scope: text("scope"),
      // a condition picked from the list, or a new one typed in (key and label)
      cond: text("condNew") || text("cond"),
      condNm: text("condNm"),
      condTxt: text("condTxt"),
      mark: text("mark"),
      markNm: text("markNm"),
      markTxt: text("markTxt"),
      global: form.get("global") === "true",
      fx: fxInput,
      status: text("status"),
      notes: text("notes"),
      faction: text("faction")
    }).pipe(
      Effect.as({ saved: "Saved. Every list that uses this rule now scores with it." }),
      Effect.catchTag("SchemaError", (e) => Effect.succeed({ error: e.message }))
    )
  )
  return "error" in result ? data(result, { status: 400 }) : result
}

export const meta: Route.MetaFunction = ({ data }) => [{ title: `${data?.entry.rule.nm ?? "Rule"} · Rules library` }]

export default function RuleEditor({ loaderData, actionData }: Route.ComponentProps) {
  const { entry, conditions, switches } = loaderData
  const r = entry.rule
  const customCond = !!r.cond && !SITUATION.some(([k]) => k === r.cond)
  const navigation = useNavigation()
  const owner = isOwner(useViewer())
  const saving = navigation.state !== "idle" && navigation.formMethod === "POST"
  const error = actionData && "error" in actionData ? actionData.error : null
  const saved = actionData && "saved" in actionData ? actionData.saved : null
  // remount the form when the stored rule changes, so "reset" refills the fields
  const formKey = `${entry.id}:${entry.updatedAt}`

  return (
    <main>
      <div className="crumbs">
        <Link to="/library">Rules library</Link>
      </div>
      <div className="dhead">
        <div>
          <h2>{r.nm}</h2>
          <div className="meta">
            {r.src}
            {entry.faction ? `, ${entry.faction}` : ""}. {entry.seeded ? (entry.edited ? "Seeded from the POC, edited since." : "Seeded from the POC.") : "Added in the app."}
          </div>
        </div>
      </div>

      {saved ? <p className="note">{saved}</p> : null}
      {error ? <p className="note warn" style={{ whiteSpace: "pre-wrap" }}>{error}</p> : null}

      {owner ? null : <p className="note">Only the site’s owner can change the rules library; this is how the engine reads the rule.</p>}
      <Form method="post" key={formKey}>
        <fieldset disabled={!owner} className="plain">
        <div className="dgrid">
          <section>
            <h3 className="sh">The rule</h3>
            <label className="field">
              Name
              <input name="nm" defaultValue={r.nm} />
            </label>
            <label className="field">
              Source <span className="hint">Datasheet, Leader, Wargear, Enhancement, Army rule, or a detachment’s name</span>
              <input name="src" defaultValue={r.src} />
            </label>
            <label className="field">
              Faction code <span className="hint">as Wahapedia writes it: AE, SM…</span>
              <input name="faction" defaultValue={entry.faction ?? ""} style={{ maxWidth: 120 }} />
            </label>
            <label className="field">
              In plain words <span className="hint">shown on the rule card</span>
              <textarea name="txt" rows={5} defaultValue={r.txt} style={{ fontFamily: "var(--sans)", fontSize: 14.5 }} />
            </label>
            <h3 className="sh">
              Official wording <span>{entry.wh ? `from Wahapedia, snapshot #${entry.wh.snapshotId ?? "?"}` : "not linked"}</span>
            </h3>
            {entry.wh ? (
              <p className="rtext">{entry.wh.text}</p>
            ) : (
              <p className="hint">
                Nothing in the database goes by this name for this faction. “Compare with the database” on the library page looks again.
              </p>
            )}
            <label className="field" style={{ marginTop: 18 }}>
              Notes
              <textarea name="notes" rows={3} defaultValue={entry.notes} style={{ fontFamily: "var(--sans)", fontSize: 14.5 }} />
            </label>
          </section>

          <section>
            <h3 className="sh">In the engine</h3>
            <label className="tog big">
              <input type="checkbox" name="dmg" value="true" defaultChecked={r.dmg} />
              <span>
                Changes damage dealt
                <small>Off: the rule is shown as noted and the effect below is ignored.</small>
              </span>
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              Reaches
              <select name="scope" defaultValue={r.scope === "unit" ? "unit" : "self"}>
                <option value="self">This datasheet only</option>
                <option value="unit">The whole attached unit (leader, support and bodyguard)</option>
              </select>
            </label>
            <label className="field">
              Waits for <span className="hint">shown as idle until this situation is switched on</span>
              <select name="cond" defaultValue={r.cond ?? ""}>
                <option value="">Nothing; always on</option>
                {conditions.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <details className="assume" style={{ marginBottom: 14 }} open={customCond}>
              <summary>A condition that isn’t in that list</summary>
              <div style={{ paddingTop: 10 }}>
                <label className="field">
                  New condition’s key <span className="hint">one lower-case word, used in the effect as “when”; leave blank to use the list above</span>
                  <input name="condNew" defaultValue="" placeholder="darkpact" style={{ maxWidth: 200 }} />
                </label>
                <label className="field">
                  Switch label
                  <input name="condNm" defaultValue={customCond ? (r.condNm ?? "") : ""} placeholder="Made a Dark Pact this phase" />
                </label>
                <label className="field">
                  Switch hint
                  <input name="condTxt" defaultValue={customCond ? (r.condTxt ?? "") : ""} placeholder="For rules that trigger on a Dark Pact." />
                </label>
              </div>
            </details>
            <h3 className="sh">
              Effect <span>what the engine adds to each attack</span>
            </h3>
            <EffectEditor name="fx" initial={r.fx ?? []} switches={switches} />

            <h3 className="sh">
              Target mark <span>for rules that mark an enemy unit</span>
            </h3>
            <label className="field">
              Mark key <span className="hint">blank for most rules; rules sharing a key share one switch</span>
              <input name="mark" defaultValue={r.mark ?? ""} style={{ maxWidth: 200 }} />
            </label>
            <label className="field">
              Switch label
              <input name="markNm" defaultValue={r.markNm ?? ""} placeholder="Riven" />
            </label>
            <label className="field">
              Switch hint
              <input name="markTxt" defaultValue={r.markTxt ?? ""} placeholder="+1 Strength for every attack." />
            </label>
            <label className="tog">
              <input type="checkbox" name="global" value="true" defaultChecked={!!r.global} />
              <span>
                The mark’s effect applies to every attacker in the list
                <small>Off: only units that carry this rule get the effect while the mark is on.</small>
              </span>
            </label>

            <h3 className="sh">Review</h3>
            <label className="field">
              Status
              <select name="status" defaultValue={entry.status}>
                <option value="verified">Verified: checked against the official wording</option>
                <option value="draft">Draft: needs a look</option>
                <option value="note">Noted: doesn’t change damage</option>
                <option value="todo">To do: changes damage, not translated yet</option>
              </select>
            </label>
          </section>
        </div>

        </fieldset>
        <div className="presets" style={{ paddingTop: 16 }} hidden={!owner}>
          <button className="btn primary" type="submit" name="intent" value="save" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {entry.seeded && entry.edited ? (
            <button className="btn" type="submit" name="intent" value="reset" disabled={saving}>
              Put back the seeded version
            </button>
          ) : null}
          {entry.seeded ? null : (
            <button
              className="btn ghost danger"
              type="submit"
              name="intent"
              value="delete"
              onClick={(e) => {
                if (!window.confirm("Delete this rule from the library?")) e.preventDefault()
              }}
            >
              Delete
            </button>
          )}
        </div>
      </Form>
    </main>
  )
}
