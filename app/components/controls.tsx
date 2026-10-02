/**
 * The controls above every list view. Each one is a real form that posts an
 * intent to the list layout's action; with JavaScript they submit through
 * fetchers and the layout applies the pending intents optimistically.
 */
import { useState } from "react"
import { NavLink, useFetcher } from "react-router"
import { MOD0, modIsSet } from "~/domain/engine"
import { allAttackers, availableMarks, findUnit, situations } from "~/domain/ledger"
import { ACCOUNTING } from "~/domain/options"
import type { Mod } from "~/domain/schema"
import type { LedgerContext } from "./ledger"

type Value = string | number | boolean

function Hidden({ fields }: { fields: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  )
}

/** A segmented control: one form, one submit button per option. */
export function Seg({
  action,
  fields,
  value,
  options,
  small,
  label
}: {
  action: string
  fields: Record<string, string>
  value: Value
  options: ReadonlyArray<readonly [Value, string]>
  small?: boolean
  label: string
}) {
  const fetcher = useFetcher()
  return (
    <fetcher.Form method="post" action={action} className={"seg" + (small ? " sm" : "")} role="group" aria-label={label}>
      <Hidden fields={fields} />
      {options.map(([v, l]) => (
        <button key={String(v)} type="submit" name="value" value={String(v)} data-mval={String(v)} aria-pressed={String(value) === String(v)}>
          {l}
        </button>
      ))}
    </fetcher.Form>
  )
}

/** A checkbox that posts as soon as it changes. `field` is the form field its state is sent as. */
export function Toggle({
  action,
  fields,
  field = "value",
  checked,
  big,
  children
}: {
  action: string
  fields: Record<string, string>
  field?: string
  checked: boolean
  big?: boolean
  children: React.ReactNode
}) {
  const fetcher = useFetcher()
  return (
    <fetcher.Form method="post" action={action} onChange={(e) => fetcher.submit(e.currentTarget)}>
      <Hidden fields={fields} />
      <label className={"tog" + (big ? " big" : "")}>
        <input type="checkbox" name={field} value="true" checked={checked} onChange={() => {}} />
        <span>{children}</span>
      </label>
    </fetcher.Form>
  )
}

export function PostButton({
  action,
  fields,
  className = "btn",
  children,
  confirm: confirmText
}: {
  action: string
  fields: Record<string, string>
  className?: string
  children: React.ReactNode
  confirm?: string
}) {
  const fetcher = useFetcher()
  return (
    <fetcher.Form
      method="post"
      action={action}
      style={{ display: "inline" }}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault()
      }}
    >
      <Hidden fields={fields} />
      <button className={className} type="submit" disabled={fetcher.state !== "idle"}>
        {children}
      </button>
    </fetcher.Form>
  )
}

// ---------- modifier bar ----------

const N = [
  [-1, "−1"],
  [0, "Off"],
  [1, "+1"]
] as const
const ONOFF = [
  [false, "Off"],
  [true, "On"]
] as const
const RR = [
  ["off", "Off"],
  ["1s", "1s"],
  ["full", "Full"]
] as const

type ModControl = readonly [key: keyof Mod, label: string, options: ReadonlyArray<readonly [Value, string]>, note?: string]

const MOD_GROUPS: ReadonlyArray<ReadonlyArray<ModControl>> = [
  [
    ["hit", "Hit", N, "Net change capped at ±1"],
    ["wound", "Wound", N, "Net change capped at ±1"],
    [
      "ap",
      "AP",
      [
        [-2, "−2"],
        [-1, "−1"],
        [0, "Off"],
        [1, "+1"],
        [2, "+2"],
        [3, "+3"]
      ],
      "Changes the AP characteristic, so it stacks with rules like Assassins’ Eye. −1 is Armour of Contempt"
    ]
  ],
  [
    ["sus", "Sustained 1", ONOFF],
    ["lethal", "Lethal", ONOFF],
    ["rrHit", "Re-roll hit", RR],
    ["rrWound", "Re-roll wound", RR]
  ],
  [
    ["cover", "Cover", ONOFF, "Ranged only"],
    ["half", "Half range", ONOFF, "Melta, Rapid Fire"],
    [
      "rf",
      "Rapid Fire",
      [
        [0, "Off"],
        [1, "1"],
        [2, "2"],
        [3, "3"],
        [4, "4"]
      ],
      "Extra attacks per gun, only within half range. Takes the higher of this and the weapon’s own"
    ]
  ]
]

function modSummary(m: Mod): string {
  const p: Array<string> = []
  if (m.hit) p.push(`${m.hit > 0 ? "+" : "−"}1 hit`)
  if (m.wound) p.push(`${m.wound > 0 ? "+" : "−"}1 wound`)
  if (m.ap) p.push(`${m.ap > 0 ? "+" : "−"}${Math.abs(m.ap)} AP`)
  if (m.sus) p.push("Sustained 1")
  if (m.lethal) p.push("Lethal")
  if (m.rrHit !== "off") p.push(`re-roll hits ${m.rrHit === "1s" ? "of 1" : "in full"}`)
  if (m.rrWound !== "off") p.push(`re-roll wounds ${m.rrWound === "1s" ? "of 1" : "in full"}`)
  if (m.rf) p.push(`Rapid Fire ${m.rf}${m.half ? "" : " (needs half range)"}`)
  const scoped = p.length && m.apply !== "both" ? `${p.join(", ")} (${m.apply} only)` : p.join(", ")
  const extra: Array<string> = []
  if (m.cover) extra.push("target in cover")
  if (m.half) extra.push("half range")
  return [scoped, extra.join(", ")].filter(Boolean).join("; ")
}

function ModBar({ ledger }: { ledger: LedgerContext }) {
  const { opts, units, action } = ledger
  const [scope, setScope] = useState("all")
  const attackers = allAttackers(ledger)
  // a scope from another list, or a unit since removed, falls back to "all"
  const sc = scope === "all" || attackers.some((u) => u.id === scope) ? scope : "all"
  const m: Mod = { ...MOD0, ...opts.mods[sc] }
  const combined = attackers.filter((u) => u.combined)
  const active = Object.keys(opts.mods).filter((k) => modIsSet(opts.mods[k]))
  const dot = (id: string) => (modIsSet(opts.mods[id]) ? " •" : "")
  const scopeName = (id: string) => {
    if (id === "all") return "All units"
    const u = findUnit(ledger, id)
    return u ? `${u.nm}${u.sub ? ` (${u.sub})` : ""}` : id
  }
  return (
    <details className="modwrap">
      <summary>Modifiers: {active.length ? `${active.length} set` : "none"}</summary>
      <div className="modbar" role="group" aria-label="Modifiers">
        <div className="mcluster c1">
          <div className="mg">
            <label className="ml" htmlFor="modscope">
              Unit
            </label>
            <select id="modscope" value={sc} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All units{dot("all")}</option>
              {combined.length ? (
                <optgroup label="Attached units">
                  {combined.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nm}
                      {dot(u.id)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Datasheets">
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nm}
                    {u.sub ? ` (${u.sub})` : ""}
                    {dot(u.id)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="mg">
            <span className="ml">Applies to</span>
            <Seg
              small
              action={action}
              label="Applies to"
              fields={{ intent: "mod", scope: sc, key: "apply" }}
              value={m.apply}
              options={[
                ["both", "Both"],
                ["ranged", "Ranged"],
                ["melee", "Melee"]
              ]}
            />
          </div>
        </div>
        {MOD_GROUPS.map((g, gi) => (
          <div key={gi} className={`mcluster c${gi + 2}`}>
            {g.map(([k, l, options, note]) => (
              <div className="mg" key={k}>
                <span className="ml">{l}</span>
                <Seg small action={action} label={l} fields={{ intent: "mod", scope: sc, key: k }} value={m[k]} options={options} />
                {note ? <span className="mnote">{note}</span> : null}
              </div>
            ))}
          </div>
        ))}
        {modIsSet(opts.mods[sc]) ? (
          <PostButton action={action} fields={{ intent: "mod-clear", scope: sc }} className="btn ghost">
            Clear {sc === "all" ? "all-units" : "this unit’s"} modifiers
          </PostButton>
        ) : null}
      </div>
      <p className="modsum">
        {active.length ? (
          <>
            Modifiers in play:{" "}
            {active.map((k, i) => (
              <span key={k}>
                {i ? ". " : ""}
                <b>{scopeName(k)}</b> {modSummary({ ...MOD0, ...opts.mods[k] })}
              </span>
            ))}
            .
          </>
        ) : (
          "No modifiers. Pick a unit (or all of them) and set a buff or debuff; it stacks with the list’s own rules, capped at ±1 to hit and wound."
        )}
      </p>
    </details>
  )
}

// ---------- the whole strip ----------

export function Tabs({ listId }: { listId: string }) {
  const base = `/lists/${listId}`
  return (
    <nav className="tabs" aria-label="Views">
      <NavLink to={base} end prefetch="intent">
        Damage matrix
      </NavLink>
      <NavLink to={`${base}/rules`} prefetch="intent">
        Rules matrix
      </NavLink>
      <NavLink to={`${base}/check`} prefetch="intent">
        Database check
      </NavLink>
    </nav>
  )
}

export function Controls({ ledger }: { ledger: LedgerContext }) {
  const { opts, action, units, rules } = ledger
  const marks = availableMarks(units, rules)
  const marksOn = marks.filter((m) => opts.flags[m.key]).map((m) => m.label.toLowerCase())
  const situation = situations(units, rules)
  const sitOn = situation.filter((s) => opts.flags[s.key]).map((s) => s.label.toLowerCase())
  return (
    <div className="controls">
      <span>
        <span className="seglabel">Phase</span>
        <Seg
          action={action}
          label="Phase"
          fields={{ intent: "set", key: "phase" }}
          value={opts.phase}
          options={[
            ["all", "All"],
            ["ranged", "Shooting"],
            ["melee", "Melee"]
          ]}
        />
      </span>
      <span>
        <span className="seglabel">Attached units</span>
        <Seg
          action={action}
          label="Attached units"
          fields={{ intent: "set", key: "combine" }}
          value={opts.combine}
          options={[
            [true, "As one unit"],
            [false, "Split"]
          ]}
        />
      </span>
      <ModBar ledger={ledger} />
      <details className="assume">
        <summary>
          Situation: {sitOn.length ? sitOn.join(", ") : "none"}. Marks: {marksOn.length ? marksOn.join(", ") : "none"}.
        </summary>
        <div className="assume-grid">
          <div>
            <h3>Situation</h3>
            {situation.map((s) => (
              <Toggle key={s.key} action={action} fields={{ intent: "flag", key: s.key }} checked={!!opts.flags[s.key]}>
                {s.label}
                <small>{s.hint}</small>
              </Toggle>
            ))}
          </div>
          {marks.length ? (
            <div>
              <h3>
                Marks <span className="hint">set by your units during the turn, on an enemy or on one of your own</span>
              </h3>
              {marks.map((m) => (
                <Toggle key={m.key} action={action} fields={{ intent: "flag", key: m.key }} checked={!!opts.flags[m.key]}>
                  {m.label}
                  {m.by ? <span className="by"> by {m.by}</span> : null}
                  <small>{m.hint}</small>
                </Toggle>
              ))}
            </div>
          ) : null}
          <div>
            <h3>Accounting</h3>
            {ACCOUNTING.map(([k, l, d]) => (
              <Toggle key={k} action={action} fields={{ intent: "set", key: k }} checked={opts[k]}>
                {l}
                <small>{d}</small>
              </Toggle>
            ))}
            <div className="presets">
              <PostButton action={action} fields={{ intent: "preset", value: "table" }}>
                Table defaults
              </PostButton>
              <PostButton action={action} fields={{ intent: "preset", value: "bare" }}>
                Bare datasheets
              </PostButton>
            </div>
            <small className="hint">Bare datasheets turns off leader buffs and re-rolls, which is how the Cogitator scores units.</small>
          </div>
        </div>
      </details>
    </div>
  )
}
