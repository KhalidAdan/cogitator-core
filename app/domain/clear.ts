/**
 * How much of a target one activation clears, and how often it clears all of it.
 *
 * The matrix adds up averages, which is the right sum for a return on points
 * and the wrong one here: damage past a model's last wound is lost, and an
 * average hides how often the job gets done. So this follows the attacks one at
 * a time and keeps a chance for every state the target can be in. It's exact
 * rather than simulated, so a cell reads the same on every load.
 *
 * A state is the wounds the target has left, counting the model being worked on
 * as damaged: state 0 is a wiped unit, and a model takes all the damage until it
 * dies. Built from a `Matrix`, whose rows have already settled which weapons
 * fire, under the phase, the pistol rule and pick-one profiles.
 */
import type { AttackChances, AttackRow } from "./attack"
import { heat, type Heat, type Matrix } from "./ledger"
import type { Target, Unit } from "./schema"

/** Chance of a wipe at which a unit counts as clearing a target: more often than not. */
export const WIPES = 50

type Dist = ReadonlyArray<readonly [number, number]>
type State = Float64Array
/** What one attack does from each state: `[state, chance]` pairs, sparse because few states are reachable. */
type Step = ReadonlyArray<Dist>

export interface Clear {
  /** Average share of the target removed, as a percentage: its models, or its wounds when it's one model. */
  readonly cleared: number
  /** Chance none of it is left, as a percentage. */
  readonly wipe: number
  /** Average models removed. */
  readonly models: number
}

/** Damage after Feel No Pain, which is rolled for each point. */
function pastFnp(damage: Dist, fnp: number): Dist {
  if (fnp >= 1) return damage
  const out = new Map<number, number>()
  for (const [d, pr] of damage) {
    let ways = 1
    for (let k = 0; k <= d; k++) {
      out.set(k, (out.get(k) ?? 0) + pr * ways * fnp ** k * (1 - fnp) ** (d - k))
      ways = (ways * (d - k)) / (k + 1)
    }
  }
  return [...out]
}

/** Every state after taking one roll of `damage`. Damage past the model it's on is lost. */
function struck(from: State, damage: Dist, W: number): State {
  const out = new Float64Array(from.length)
  out[0] = from[0]
  for (let left = 1; left < from.length; left++) {
    const chance = from[left]
    if (!chance) continue
    const onModel = ((left - 1) % W) + 1
    for (const [d, pr] of damage) out[d >= onModel ? left - onModel : left - d] += chance * pr
  }
  return out
}

/** `parts` as `[weight, state]` pairs, added up. */
function blend(size: number, parts: ReadonlyArray<readonly [number, State]>): State {
  const out = new Float64Array(size)
  for (const [weight, state] of parts) for (let i = 0; i < size; i++) out[i] += weight * state[i]
  return out
}

/** One attack from every state: the hit roll, then the wound rolls, saves and damage each hit leads to. */
function stepOf(c: AttackChances, W: number, size: number): Step {
  const damage = pastFnp(c.damage, c.fnp)
  const mortalDamage = pastFnp(c.mortalDamage, c.fnp)
  const toSave = (s: State) => blend(size, [[1 - c.unsaved, s], [c.unsaved, struck(s, damage, W)]])
  const toWound = (s: State) => blend(size, [[1 - c.wound - c.mortal, s], [c.wound, toSave(s)], [c.mortal, struck(s, mortalDamage, W)]])
  const attack = (s: State) => {
    let critical = c.lethal ? toSave(s) : toWound(s)
    for (let i = 0; i < c.sus; i++) critical = toWound(critical)
    return blend(size, [[1 - c.normal - c.crit, s], [c.normal, toWound(s)], [c.crit, critical]])
  }
  const step: Array<Dist> = [[[0, 1]]]
  for (let left = 1; left < size; left++) {
    const from = new Float64Array(size)
    from[left] = 1
    const to = attack(from)
    step.push([...to].flatMap((pr, i): Array<readonly [number, number]> => (pr > 0 ? [[i, pr]] : [])))
  }
  return step
}

function attacked(from: State, step: Step): State {
  const out = new Float64Array(from.length)
  for (let left = 0; left < from.length; left++) {
    const chance = from[left]
    if (!chance) continue
    for (const [to, pr] of step[left]) out[to] += chance * pr
  }
  return out
}

/** Every attack of a weapon. With random attacks, each model rolls for its own. */
function fired(from: State, row: AttackRow, c: AttackChances, W: number): State {
  const step = stepOf(c, W, from.length)
  const n = row.w.n
  let state = from
  if (c.perModel.length === 1) {
    for (let i = 0; i < n * c.perModel[0][0]; i++) state = attacked(state, step)
    return state
  }
  for (let m = 0; m < n; m++) {
    let after = state
    let made = 0
    const parts: Array<readonly [number, State]> = []
    for (const [attacks, pr] of [...c.perModel].sort((a, b) => a[0] - b[0])) {
      for (; made < attacks; made++) after = attacked(after, step)
      parts.push([pr, after])
    }
    state = blend(from.length, parts)
  }
  return state
}

/**
 * What a unit's weapons leave of a target at full strength. Shooting comes before fighting, and within each the
 * hardest-hitting weapons go first, leaving the small ones to finish a damaged model.
 */
export function clearOf(weapons: ReadonlyArray<AttackRow>, t: Pick<Target, "N" | "W">): Clear {
  const size = t.N * t.W + 1
  let state: State = new Float64Array(size)
  state[size - 1] = 1
  const order = weapons
    .filter((r) => !r.skipped && r.chances && r.dealt)
    .sort((a, b) => (a.w.t === b.w.t ? (b.dmg ?? 0) - (a.dmg ?? 0) : a.w.t === "r" ? -1 : 1))
  for (const r of order) state = fired(state, r, r.chances!, t.W)
  let models = 0
  let wounds = 0
  for (let left = 0; left < size; left++) {
    models += state[left] * (t.N - Math.ceil(left / t.W))
    wounds += state[left] * (size - 1 - left)
  }
  return { cleared: (t.N === 1 ? wounds / (size - 1) : models / t.N) * 100, wipe: state[0] * 100, models }
}

/** Cell colour: gold for a target it clears more often than not, then jade and a tint by how much it clears. */
export const clearHeat = (c: Clear): Heat => heat(Math.round(c.wipe) >= WIPES ? 100 + (c.wipe - WIPES) * 1.84 : Math.min(99, c.cleared))

/** Clears it more often than not, judged by the whole number shown. */
export const wipes = (c: Clear): boolean => Math.round(c.wipe) >= WIPES

// ---------- the view ----------

export interface ClearRow {
  readonly unit: Unit
  /** One per target, in `targets` order. */
  readonly cells: ReadonlyArray<Clear>
  /** Targets it clears more often than not. */
  readonly wiped: number
  /** Index into `targets` of the target it takes the most points off. */
  readonly best: number
}

export interface ClearMatrix {
  readonly rows: ReadonlyArray<ClearRow>
  readonly targets: ReadonlyArray<Target>
  readonly infantry: number
  /** Units that clear each target more often than not. */
  readonly coverage: ReadonlyArray<number>
}

export function clearMatrix(m: Matrix): ClearMatrix {
  const rows = m.rows.map((r): ClearRow => {
    const cells = r.cells.map((c, k) => clearOf(c.rows, m.targets[k]))
    const removed = cells.map((c, k) => c.cleared * m.targets[k].pts)
    return {
      unit: r.unit,
      cells,
      wiped: cells.filter(wipes).length,
      best: removed.reduce((best, v, k) => (v > removed[best] ? k : best), 0)
    }
  })
  return {
    rows,
    targets: m.targets,
    infantry: m.infantry,
    coverage: m.targets.map((_, k) => rows.filter((r) => wipes(r.cells[k])).length)
  }
}

export type ClearNote =
  | { readonly kind: "covered" }
  | { readonly kind: "gap"; readonly target: Target; readonly unit: Unit; readonly clear: Clear; readonly others: number }
  | { readonly kind: "top"; readonly unit: Unit; readonly count: number; readonly of: number }
  | { readonly kind: "none" }

/** The findings under the view: the target the list is worst at clearing, and the unit that clears the most. */
export function clearNotes(v: ClearMatrix): Array<ClearNote> {
  if (!v.rows.length || !v.targets.length) return []
  // the wipe chance decides, as a cell shows it; where nothing can wipe a target, how much it clears does
  const rank = (c: Clear) => Math.round(c.wipe) * 1000 + c.cleared
  const best = v.targets.map((target, k) => {
    const top = v.rows.reduce((a, b) => (rank(b.cells[k]) > rank(a.cells[k]) ? b : a))
    return { target, unit: top.unit, clear: top.cells[k] }
  })
  const missed = best.filter((b) => !wipes(b.clear)).sort((a, b) => rank(a.clear) - rank(b.clear))
  const out: Array<ClearNote> = [missed.length ? { kind: "gap", target: missed[0].target, unit: missed[0].unit, clear: missed[0].clear, others: missed.length - 1 } : { kind: "covered" }]
  const top = v.rows.reduce((a, b) => (b.wiped > a.wiped ? b : a))
  out.push(top.wiped ? { kind: "top", unit: top.unit, count: top.wiped, of: v.targets.length } : { kind: "none" })
  return out
}
