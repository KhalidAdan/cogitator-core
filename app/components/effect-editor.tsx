/**
 * The rule editor's effect, as clauses built from the effect vocabulary
 * (app/domain/fx.ts): each clause lists its *when* fields and its *does*
 * fields, each with the input its kind calls for, and reads back in words as
 * it is edited. The JSON underneath is what the form posts, so it can still be
 * edited by hand; a valid edit there rebuilds the clauses.
 */
import { useState } from "react"
import { CLAUSE, describeFx, FIELD_KEYS, type FieldSpec, FX_HELP, isWhen, tidyClause } from "~/domain/fx"
import { ABILITIES } from "~/domain/keywords"
import type { Fx } from "~/domain/schema"

type Draft = Record<string, unknown>

export interface Switch {
  readonly key: string
  readonly label: string
}

const asJson = (clauses: ReadonlyArray<Draft>) => JSON.stringify(clauses.map(tidyClause), null, 2)
const spec = (k: string) => (CLAUSE as Record<string, FieldSpec>)[k]

export function EffectEditor({ name, initial, switches }: { name: string; initial: ReadonlyArray<Fx>; switches: ReadonlyArray<Switch> }) {
  const [clauses, setClauses] = useState<Array<Draft>>(() => initial.map((e) => ({ ...e })))
  const [json, setJson] = useState(() => asJson(initial))
  const [jsonError, setJsonError] = useState<string | null>(null)
  // bumped when the JSON replaces the clauses, so inputs that keep their own text start again
  const [version, setVersion] = useState(0)

  const update = (next: Array<Draft>) => {
    setClauses(next)
    setJson(asJson(next))
    setJsonError(null)
  }
  const setField = (i: number, k: string, v: unknown) => update(clauses.map((c, j) => (j === i ? { ...c, [k]: v } : c)))
  const dropField = (i: number, k: string) =>
    update(clauses.map((c, j) => (j === i ? Object.fromEntries(Object.entries(c).filter(([x]) => x !== k)) : c)))

  const editJson = (text: string) => {
    setJson(text)
    try {
      const v: unknown = text.trim() ? JSON.parse(text) : []
      const list = Array.isArray(v) ? v : [v]
      if (!list.every((x) => x && typeof x === "object" && !Array.isArray(x))) throw new Error("each clause is an object")
      setClauses(list as Array<Draft>)
      setVersion((n) => n + 1)
      setJsonError(null)
    } catch (e) {
      setJsonError(`Not valid yet (${e instanceof Error ? e.message : String(e)}); the clauses above show the last valid version.`)
    }
  }

  return (
    <div className="fxedit">
      {clauses.length ? null : <p className="hint">No effect yet: a rule that changes damage needs at least one clause.</p>}
      {clauses.map((c, i) => (
        <ClauseCard
          key={`${version}:${i}`}
          n={i + 1}
          clause={c}
          switches={switches}
          onSet={(k, v) => setField(i, k, v)}
          onAdd={(k) => setField(i, k, spec(k).blank)}
          onDrop={(k) => dropField(i, k)}
          onRemove={() => update(clauses.filter((_, j) => j !== i))}
        />
      ))}
      <button type="button" className="btn" onClick={() => update([...clauses, {}])}>
        Add a clause
      </button>
      <p className="hint" style={{ marginTop: 6 }}>Every condition in a clause must hold for its effects to apply; clauses apply separately.</p>

      <details className="assume" style={{ marginBottom: 14 }}>
        <summary>As JSON</summary>
        <label className="field" style={{ marginTop: 8 }}>
          <span className="hint">what is saved; edit it here if you prefer</span>
          <textarea name={name} rows={9} spellCheck={false} value={json} onChange={(e) => editJson(e.target.value)} />
        </label>
        {jsonError ? <p className="err">{jsonError}</p> : null}
        <table className="dt" style={{ minWidth: 0, marginTop: 8 }}>
          <tbody>
            {FX_HELP.map(([f, m]) => (
              <tr key={f}>
                <td>
                  <code>{f}</code>
                </td>
                <td className="l">{m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

function ClauseCard(props: {
  n: number
  clause: Draft
  switches: ReadonlyArray<Switch>
  onSet: (k: string, v: unknown) => void
  onAdd: (k: string) => void
  onDrop: (k: string) => void
  onRemove: () => void
}) {
  const { clause, switches } = props
  const present = FIELD_KEYS.filter((k) => k in clause)
  const missing = FIELD_KEYS.filter((k) => !(k in clause))
  const rows = (when: boolean) =>
    present
      .filter((k) => isWhen(spec(k)) === when)
      .map((k) => (
        <div className="fxrow" key={k}>
          <span className="fxlabel">{spec(k).label}</span>
          <FieldValue field={k} s={spec(k)} value={clause[k]} switches={switches} onChange={(v) => props.onSet(k, v)} />
          <button type="button" className="fxdrop" aria-label={`Remove ${spec(k).label}`} onClick={() => props.onDrop(k)}>
            ×
          </button>
        </div>
      ))
  const adder = (when: boolean, prompt: string) => {
    const options = missing.filter((k) => isWhen(spec(k)) === when)
    if (!options.length) return null
    return (
      <select className="fxadd" value="" aria-label={prompt} onChange={(e) => e.target.value && props.onAdd(e.target.value)}>
        <option value="">{prompt}</option>
        {options.map((k) => (
          <option key={k} value={k}>
            {spec(k).label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div className="fxclause">
      <div className="fxhead">
        <span>Clause {props.n}</span>
        <button type="button" className="btn ghost danger" onClick={props.onRemove}>
          Remove
        </button>
      </div>
      <p className="fxreads">{describeFx(tidyClause(clause))}</p>
      <div className="fxpart">When</div>
      {rows(true)}
      {adder(true, "Add a condition…")}
      <div className="fxpart">Does</div>
      {rows(false)}
      {adder(false, "Add an effect…")}
    </div>
  )
}

function FieldValue(props: { field: string; s: FieldSpec; value: unknown; switches: ReadonlyArray<Switch>; onChange: (v: unknown) => void }) {
  const { s, value, onChange } = props
  const input = s.input
  switch (input.kind) {
    case "choice":
      return (
        <select value={String(value ?? "")} aria-label={s.label} onChange={(e) => onChange(e.target.value)}>
          {input.options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      )
    case "switch":
      return <SwitchPicker label={s.label} value={String(value ?? "")} switches={props.switches} onChange={onChange} />
    case "keywords": {
      const v = (value ?? {}) as { only?: Array<string>; not?: Array<string> }
      return (
        <span className="fxpair">
          <KeywordList label="has any of" value={v.only} onChange={(only) => onChange({ ...v, only })} />
          <KeywordList label="has none of" value={v.not} onChange={(not) => onChange({ ...v, not })} />
        </span>
      )
    }
    case "text":
      return <input value={String(value ?? "")} placeholder={input.placeholder} aria-label={s.label} onChange={(e) => onChange(e.target.value.toLowerCase())} />
    case "ability":
      return (
        <select value={String(value ?? "")} aria-label={s.label} onChange={(e) => onChange(e.target.value)}>
          {ABILITIES.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      )
    case "number":
      return (
        <input
          type="number"
          className="fxnum"
          min={input.min}
          max={input.max}
          step={1}
          value={typeof value === "number" ? value : ""}
          aria-label={s.label}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      )
    case "on":
      return <span className="hint">yes</span>
    case "abilities":
      return <AbilityPicker value={(value ?? {}) as Record<string, number>} onChange={onChange} />
    case "anti":
      return <AntiList value={(value ?? {}) as Record<string, number>} onChange={onChange} />
  }
}

/** The picker's "Another key…" entry; switch keys are single lower-case words, so this can't be one. */
const OTHER = " other"

/** A switch or mark from the list, or another key typed in. */
function SwitchPicker(props: { label: string; value: string; switches: ReadonlyArray<Switch>; onChange: (v: string) => void }) {
  const known = props.switches.some((x) => x.key === props.value)
  const [typing, setTyping] = useState(!known && props.value !== "")
  if (typing) {
    return (
      <span className="fxpair">
        <input value={props.value} placeholder="a key: darkpact" aria-label={props.label} onChange={(e) => props.onChange(e.target.value.trim())} />
        <button type="button" className="btn ghost" onClick={() => setTyping(false)}>
          Pick from the list
        </button>
      </span>
    )
  }
  return (
    <select
      value={known ? props.value : ""}
      aria-label={props.label}
      onChange={(e) => (e.target.value === OTHER ? setTyping(true) : props.onChange(e.target.value))}
    >
      {known ? null : <option value="">Pick a switch…</option>}
      {props.switches.map((x) => (
        <option key={x.key} value={x.key}>
          {x.label}
        </option>
      ))}
      <option value={OTHER}>Another key…</option>
    </select>
  )
}

/** Keywords typed as words, kept as an upper-case list. */
function KeywordList(props: { label: string; value: ReadonlyArray<string> | undefined; onChange: (v: Array<string>) => void }) {
  const [text, setText] = useState((props.value ?? []).join(", "))
  return (
    <input
      value={text}
      placeholder={props.label === "has any of" ? "has any of: VEHICLE, MONSTER" : "has none of: TITANIC"}
      aria-label={props.label}
      onChange={(e) => {
        setText(e.target.value)
        props.onChange(
          e.target.value
            .split(/[\s,/]+/)
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean)
        )
      }}
    />
  )
}

function AbilityPicker(props: { value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const set = (k: string, n: number | null) => {
    const next = { ...props.value }
    if (n === null) delete next[k]
    else next[k] = n
    props.onChange(next)
  }
  return (
    <span className="fxchecks">
      {ABILITIES.filter((a) => a.grant).map((a) => {
        const on = a.key in props.value
        return (
          <label key={a.key} className="fxcheck">
            <input type="checkbox" checked={on} onChange={(e) => set(a.key, e.target.checked ? 1 : null)} />
            {a.label}
            {a.n && on ? (
              <input
                type="number"
                className="fxnum"
                min={1}
                max={6}
                value={props.value[a.key]}
                aria-label={`${a.label} value`}
                onChange={(e) => set(a.key, Math.max(1, Number(e.target.value) || 1))}
              />
            ) : null}
          </label>
        )
      })}
    </span>
  )
}

/** Anti-X as rows of keyword and roll. */
function AntiList(props: { value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const [rows, setRows] = useState<Array<{ k: string; n: number }>>(() => {
    const r = Object.entries(props.value).map(([k, n]) => ({ k, n }))
    return r.length ? r : [{ k: "", n: 4 }]
  })
  const commit = (next: Array<{ k: string; n: number }>) => {
    setRows(next)
    props.onChange(Object.fromEntries(next.filter((r) => r.k.trim()).map((r) => [r.k.trim().toUpperCase(), r.n])))
  }
  return (
    <span className="fxanti">
      {rows.map((r, i) => (
        <span key={i} className="fxpair">
          <input
            value={r.k}
            placeholder="INFANTRY"
            aria-label="Keyword"
            onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, k: e.target.value.toUpperCase() } : x)))}
          />
          <input
            type="number"
            className="fxnum"
            min={2}
            max={6}
            value={r.n}
            aria-label="Critical wound roll"
            onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, n: Math.min(6, Math.max(2, Number(e.target.value) || 4)) } : x)))}
          />
          +
          {rows.length > 1 ? (
            <button type="button" className="fxdrop" aria-label="Remove this keyword" onClick={() => commit(rows.filter((_, j) => j !== i))}>
              ×
            </button>
          ) : null}
        </span>
      ))}
      <button type="button" className="btn ghost" onClick={() => setRows([...rows, { k: "", n: 4 }])}>
        Another keyword
      </button>
    </span>
  )
}
