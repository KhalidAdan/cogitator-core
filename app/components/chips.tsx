/**
 * Rule chips and the rule card they open. Which card is open lives in the URL
 * (`?rule=owner:id`), so it survives a reload, works with the back button and
 * needs no client state.
 */
import { useEffect } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { availableMarks, RULE_STATE_TITLE, ruleState } from "~/domain/ledger"
import { Toggle } from "./controls"
import { type LedgerContext, useLedger } from "./ledger"

const withParam = (params: URLSearchParams, key: string, value: string | null) => {
  const next = new URLSearchParams(params)
  if (value === null) next.delete(key)
  else next.set(key, value)
  const s = next.toString()
  return s ? `?${s}` : "?"
}

export function Chip({ owner, id, label }: { owner: string; id: string; label?: string }) {
  const { rules, opts } = useLedger()
  const [params] = useSearchParams()
  const r = rules[id]
  if (!r) return null
  const st = ruleState(r, owner, id, opts)
  const key = `${owner}:${id}`
  const selected = params.get("rule") === key
  const title = st === "idle" && r.condNm ? `Waiting for: ${r.condNm}` : RULE_STATE_TITLE[st]
  return (
    <Link
      to={withParam(params, "rule", selected ? null : key)}
      preventScrollReset
      replace
      className={`chip ${st}${selected ? " sel" : ""}`}
      title={title}
      aria-pressed={selected}
    >
      {label ?? r.nm}
    </Link>
  )
}

/** A chip that only illustrates a state, in the legends. */
export const DemoChip = ({ state, children }: { state: string; children: React.ReactNode }) => (
  <span className={`chip ${state} demo`}>{children}</span>
)

export function RuleDrawer({ ledger }: { ledger: LedgerContext }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const key = params.get("rule")
  const close = withParam(params, "rule", null)

  useEffect(() => {
    if (!key) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate(close, { preventScrollReset: true, replace: true })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [key, close, navigate])

  if (!key) return null
  const split = key.indexOf(":")
  const owner = key.slice(0, split)
  const id = key.slice(split + 1)
  const { rules, opts, units, groups, action } = ledger
  const r = rules[id]
  if (!r) return null
  const st = ruleState(r, owner, id, opts)
  const ownerUnit = units.find((u) => u.id === owner)
  const group = ownerUnit?.grp ? groups[ownerUnit.grp] : undefined
  const who = owner === "army" ? "" : r.scope === "unit" && ownerUnit && group ? `${ownerUnit.nm} and the rest of ${group.short}` : ownerUnit?.nm ?? ""
  const mark = r.mark ? availableMarks(units, rules).find((m) => m.key === r.mark) : undefined

  return (
    <aside className="drawer" aria-live="polite">
      <div className="dr-in">
        <div className="dr-head">
          <div>
            <div className="dr-src">
              {r.src}
              {who ? `, ${who}` : ""}
            </div>
            <h4>{r.nm}</h4>
          </div>
          <Link className="x" to={close} preventScrollReset replace aria-label="Close">
            ×
          </Link>
        </div>
        <p>{r.txt}</p>
        {r.mark ? (
          <Toggle big action={action} fields={{ intent: "flag", key: r.mark }} checked={!!opts.flags[r.mark]}>
            Marked: {(mark?.label ?? r.mark).toLowerCase()}
            <small>{mark?.hint ? `${mark.hint} ` : ""}Applies to every matchup in the matrix while it’s on.</small>
          </Toggle>
        ) : r.dmg ? (
          <>
            <Toggle big action={action} field="on" fields={{ intent: "rule-switch", key }} checked={st !== "off"}>
              Count it in the damage maths
            </Toggle>
            {r.cond ? (
              <Toggle big action={action} fields={{ intent: "flag", key: r.cond }} checked={!!opts.flags[r.cond]}>
                {r.condNm ?? r.cond}
                <small>{opts.flags[r.cond] ? "On: the rule is changing the numbers now." : "Off: the rule is idle in every matchup."}</small>
              </Toggle>
            ) : null}
          </>
        ) : r.todo ? (
          <p className="hint">
            This reads like it changes damage, but the engine doesn’t model it yet. Approximate it with the modifier bar for now, or give it an
            effect in the <Link to={`/library/${encodeURIComponent(id)}`}>rules library</Link>.
          </p>
        ) : (
          <p className="hint">Doesn’t change damage dealt, so the matrix leaves it out.</p>
        )}
        {!r.imported ? (
          <p className="hint">
            <Link to={`/library/${encodeURIComponent(id)}`}>Open in the rules library</Link>
          </p>
        ) : null}
      </div>
    </aside>
  )
}
