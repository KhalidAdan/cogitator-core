/**
 * What the views are built from: the matrix, the findings under it, and the
 * state of each rule chip. Pure functions over a list, the rules that apply to
 * it, the targets and the options — the same on the server and in the browser.
 */
import { attackerList, attackUnit, type AttackResult, effectiveRules, ruleKey, unitPts } from "./engine"
import { SITUATION } from "./options"
import type { Group, Opts, Rule, RuleBook, Target, Unit } from "./schema"

export interface Ledger {
  readonly units: ReadonlyArray<Unit>
  readonly rules: RuleBook
  readonly targets: ReadonlyArray<Target>
  readonly opts: Opts
  readonly groups: Readonly<Record<string, Group>>
}

/** A target mark and the rule that sets it. */
export interface MarkInfo {
  readonly key: string
  readonly label: string
  readonly hint: string
  /** Unit in this list that can set it. */
  readonly by: string | null
}

/** Target marks only count when a unit in this list can set them. */
export function availableMarks(units: ReadonlyArray<Unit>, rules: RuleBook): Array<MarkInfo> {
  const out = new Map<string, MarkInfo>()
  for (const u of units) {
    for (const id of u.rules) {
      const r = rules[id]
      if (!r?.mark) continue
      const setter = r.src !== "Received"
      const existing = out.get(r.mark)
      if (!existing) {
        out.set(r.mark, { key: r.mark, label: r.markNm ?? r.mark, hint: r.markTxt ?? "", by: setter ? u.nm : null })
      } else if (setter && (!existing.by || r.markNm)) {
        out.set(r.mark, { key: r.mark, label: r.markNm ?? existing.label, hint: r.markTxt ?? existing.hint, by: existing.by ?? u.nm })
      }
    }
  }
  return [...out.values()]
}

/** A situation switch: one of the built-in five, or a condition a rule in the list waits for. */
export interface SituationInfo {
  readonly key: string
  readonly label: string
  readonly hint: string
}

/**
 * The situation switches for a list: the built-in ones, then any condition one
 * of its rules waits for that isn't built in ("made a Dark Pact", "target is
 * the closest enemy unit"). So a new kind of condition is a field on a rule,
 * not a change to the app.
 */
export function situations(units: ReadonlyArray<Unit>, rules: RuleBook): Array<SituationInfo> {
  const out: Array<SituationInfo> = SITUATION.map(([key, label, hint]) => ({ key, label, hint }))
  const seen = new Set(out.map((s) => s.key))
  for (const u of units) {
    for (const id of u.rules) {
      const r = rules[id]
      if (!r?.cond || !r.dmg || seen.has(r.cond)) continue
      seen.add(r.cond)
      out.push({ key: r.cond, label: r.condNm ?? r.cond, hint: r.condTxt ?? `For ${r.nm}.` })
    }
  }
  return out
}

/** Every key that is a target mark anywhere in the rule book. */
const allMarkKeys = (rules: RuleBook) => new Set(Object.values(rules).flatMap((r) => (r.mark ? [r.mark] : [])))

/*
 * `attack` is called once per matrix cell with the same list, rules and
 * options, so what it derives from them is kept, keyed on those objects (a new
 * list, rule book or set of options misses and is worked out afresh).
 */
const unsettableCache = new WeakMap<RuleBook, WeakMap<ReadonlyArray<Unit>, ReadonlyArray<string>>>()
/** Mark keys in the rule book that no unit in this list can set. */
function unsettableMarks(units: ReadonlyArray<Unit>, rules: RuleBook): ReadonlyArray<string> {
  let byUnits = unsettableCache.get(rules)
  if (!byUnits) unsettableCache.set(rules, (byUnits = new WeakMap()))
  let out = byUnits.get(units)
  if (!out) {
    const available = new Set(availableMarks(units, rules).map((m) => m.key))
    out = [...allMarkKeys(rules)].filter((k) => !available.has(k))
    byUnits.set(units, out)
  }
  return out
}

const effectiveCache = new WeakMap<Opts, { units: ReadonlyArray<Unit>; rules: RuleBook; out: Opts }>()

/** The options the engine sees: marks nobody in this list can set are forced off. */
export function effectiveOpts(l: Pick<Ledger, "units" | "rules">, opts: Opts): Opts {
  const hit = effectiveCache.get(opts)
  if (hit && hit.units === l.units && hit.rules === l.rules) return hit.out
  const flags = { ...opts.flags }
  for (const k of unsettableMarks(l.units, l.rules)) flags[k] = false
  const out = { ...opts, flags }
  effectiveCache.set(opts, { units: l.units, rules: l.rules, out })
  return out
}

export const attack = (l: Ledger, u: Unit, t: Target, opts: Opts = l.opts): AttackResult =>
  attackUnit(u, t, effectiveOpts(l, opts), { rules: l.rules, units: l.units })

/** Matrix rows under the current "attached units" setting. */
export const rows = (l: Ledger): Array<Unit> => attackerList(l.units, l.opts)

/** Every attacker that can be opened: each datasheet, plus each attached unit as one. */
export const allAttackers = (l: Pick<Ledger, "units">): Array<Unit> =>
  [...l.units, ...attackerList(l.units, { combine: true }).filter((u) => u.combined)]

export const findUnit = (l: Pick<Ledger, "units">, id: string) => allAttackers(l).find((u) => u.id === id)

export function sectionOf(u: Unit, groups: Ledger["groups"]): string {
  if (u.combined) return "Attached units"
  if (u.grp && groups[u.grp]) return `${groups[u.grp].nm}: ${groups[u.grp].short}`
  return u.cat || "Other"
}

export function unitSub(u: Unit, opts: Pick<Opts, "enh">): string {
  const b = [`${unitPts(u, opts)} pts`]
  if (u.enh) b.push(opts.enh ? `incl. ${u.enh.nm}` : `${u.enh.nm} excluded`)
  if (u.sub) b.push(u.sub)
  return b.join(", ")
}

export const phaseLabel = (p: Opts["phase"]) => ({ all: "Shooting and melee", ranged: "Shooting only", melee: "Melee only" })[p]

// ---------- rule chips ----------

export type RuleState = "on" | "off" | "idle" | "mark-on" | "mark-off" | "note" | "todo"

export function ruleState(rule: Rule | undefined, owner: string, id: string, opts: Opts): RuleState {
  if (!rule) return "note"
  if (rule.mark) return opts.flags[rule.mark] ? "mark-on" : "mark-off"
  if (!rule.dmg) return rule.todo ? "todo" : "note"
  if (opts.off[ruleKey(owner, id)]) return "off"
  return rule.cond && !opts.flags[rule.cond] ? "idle" : "on"
}

export const RULE_STATE_TITLE: Record<RuleState, string> = {
  todo: "Looks like it changes damage, but it isn’t modelled yet",
  note: "Real rule, no effect on damage dealt",
  idle: "Waiting for its condition",
  "mark-on": "Target mark",
  "mark-off": "Target mark",
  on: "Counted in the maths",
  off: "Switched off"
}

// ---------- heat ----------

export interface Heat {
  readonly bg: string
  readonly fg: string
  readonly efficient: boolean
}

/** Cell colour for a return percentage: gold at 100%+, jade from 65%, a tint from 35%. */
export function heat(roi: number): Heat {
  if (roi >= 100) {
    const m = Math.min(85, 62 + (roi - 100) / 4)
    return { bg: `color-mix(in oklab, var(--gold) ${m}%, var(--surface))`, fg: "var(--gold-ink)", efficient: true }
  }
  if (roi >= 65) {
    const m = 36 + ((roi - 65) / 35) * 26
    return { bg: `color-mix(in oklab, var(--jade) ${m}%, var(--surface))`, fg: "var(--jade-ink)", efficient: true }
  }
  if (roi >= 35) {
    const m = 7 + ((roi - 35) / 30) * 17
    return { bg: `color-mix(in oklab, var(--jade) ${m}%, var(--surface))`, fg: "var(--ink)", efficient: false }
  }
  return { bg: "transparent", fg: "var(--muted)", efficient: false }
}

export const barBackground = (h: Heat) => (h.bg === "transparent" ? "color-mix(in oklab, var(--muted) 30%, var(--surface))" : h.bg)

/** The line at which a unit counts as an efficient answer to a target. */
export const EFFICIENT = 65

// ---------- matrix ----------

export interface MatrixRow {
  readonly unit: Unit
  /** One result per target, in `targets` order. */
  readonly cells: ReadonlyArray<AttackResult>
  readonly avg: number
  /** Index into `targets` of the best matchup. */
  readonly best: number
}

export interface Matrix {
  readonly rows: ReadonlyArray<MatrixRow>
  /** Targets in display order: infantry and beasts, then vehicles and monsters. */
  readonly targets: ReadonlyArray<Target>
  readonly infantry: number
  /** Units at the efficient line or better, per target. */
  readonly coverage: ReadonlyArray<number>
}

export function matrix(l: Ledger): Matrix {
  const inf = l.targets.filter((t) => t.cls === "inf")
  const veh = l.targets.filter((t) => t.cls !== "inf")
  const targets = [...inf, ...veh]
  const out = rows(l).map((unit): MatrixRow => {
    const cells = targets.map((t) => attack(l, unit, t))
    const vals = cells.map((c) => c.roi)
    let best = 0
    vals.forEach((v, i) => {
      if (v > vals[best]) best = i
    })
    return { unit, cells, avg: vals.reduce((a, b) => a + b, 0) / (vals.length || 1), best }
  })
  return {
    rows: out,
    targets,
    infantry: inf.length,
    coverage: targets.map((_, k) => out.filter((r) => r.cells[k].roi >= EFFICIENT).length)
  }
}

// ---------- findings ----------

export type Finding =
  | { readonly kind: "gap"; readonly target: Target; readonly unit: Unit; readonly roi: number; readonly others: number }
  | { readonly kind: "covered" }
  | { readonly kind: "prime"; readonly unit: Unit; readonly count: number; readonly of: number; readonly peak: number; readonly peakTarget: Target }
  | {
      readonly kind: "enhancement"
      readonly unit: Unit
      readonly enhancement: string
      readonly pts: number
      /** Average return with the enhancement and its cost. */
      readonly withIt: number
      /** Average with the enhancement's effect but not its cost. */
      readonly free: number
      /** Average without the enhancement at all. */
      readonly without: number
      /** The enhancement changes damage under the current options. */
      readonly adds: boolean
    }

/** The three auto-written findings under the matrix (handoff section 1). */
export function findings(l: Ledger, m: Matrix): Array<Finding> {
  const out: Array<Finding> = []
  if (!m.rows.length || !m.targets.length) return out

  const best = m.targets.map((t, k) => {
    let b = m.rows[0]
    for (const r of m.rows) if (r.cells[k].roi > b.cells[k].roi) b = r
    return { t, unit: b.unit, roi: b.cells[k].roi }
  })
  const weak = best.filter((x) => x.roi < EFFICIENT).sort((a, b) => a.roi - b.roi)
  if (weak.length) out.push({ kind: "gap", target: weak[0].t, unit: weak[0].unit, roi: weak[0].roi, others: weak.length - 1 })
  else out.push({ kind: "covered" })

  const counts = m.rows
    .map((r) => {
      let peak = 0
      r.cells.forEach((c, i) => {
        if (c.roi > r.cells[peak].roi) peak = i
      })
      return { unit: r.unit, n: r.cells.filter((c) => c.roi >= EFFICIENT).length, peak: r.cells[peak].roi, peakTarget: m.targets[peak] }
    })
    .sort((a, b) => b.n - a.n || b.peak - a.peak)
  const p = counts[0]
  out.push({ kind: "prime", unit: p.unit, count: p.n, of: m.targets.length, peak: p.peak, peakTarget: p.peakTarget })

  if (l.opts.enh) {
    const members = (u: Unit) => (u.combined ? (u.members ?? []).map((id) => l.units.find((x) => x.id === id)) : [u])
    const avg = (u: Unit, o: Opts) => l.targets.reduce((s, t) => s + attack(l, u, t, o).roi, 0) / l.targets.length
    const taxed = m.rows
      .filter((r) => r.unit.enh)
      .map((r) => {
        const free = avg(r.unit, { ...l.opts, enh: false })
        const off = { ...l.opts.off }
        for (const mem of members(r.unit)) if (mem?.enh?.id) off[ruleKey(mem.id, mem.enh.id)] = true
        const without = avg(r.unit, { ...l.opts, enh: false, off })
        const adds = members(r.unit).some((mem) => {
          const er = mem?.enh?.id ? l.rules[mem.enh.id] : undefined
          return !!er && er.dmg && (!er.cond || !!l.opts.flags[er.cond])
        })
        return { unit: r.unit, withIt: r.avg, free, without, adds }
      })
      .sort((x, y) => y.free - y.withIt - (x.free - x.withIt))
    const t = taxed[0]
    if (t) out.push({ kind: "enhancement", unit: t.unit, enhancement: t.unit.enh!.nm, pts: t.unit.enh!.pts, withIt: t.withIt, free: t.free, without: t.without, adds: t.adds })
  }
  return out
}

/** Rules in play for one attacker, and how many of its rules don't touch damage. */
export function rulesInPlay(l: Ledger, u: Unit) {
  const er = effectiveRules(u, l.units, l.rules)
  const members = u.combined ? (u.members ?? []).map((id) => l.units.find((x) => x.id === id)).filter((x): x is Unit => !!x) : [u]
  const noted = members.reduce((s, m) => s + m.rules.filter((id) => l.rules[id] && !l.rules[id].dmg).length, 0)
  return { rules: er, noted }
}

/** Does any modifier scope touch this row? */
export function rowModified(u: Unit, opts: Opts, isSet: (m: Opts["mods"][string] | undefined) => boolean): boolean {
  const sc = new Set([u.id])
  if (!u.combined && u.grp) sc.add("grp-" + u.grp)
  if (u.combined) for (const m of u.members ?? []) sc.add(m)
  return [...sc].some((s) => isSet(opts.mods[s]))
}
