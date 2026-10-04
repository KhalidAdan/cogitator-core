/**
 * The damage engine. Pure functions, no Effect, no I/O: it runs in loaders, in
 * the browser for optimistic recalculation, and in tests.
 *
 * Ported from the POC's `engine.js` (handoff section 5). The one structural
 * change is that every rule is now data: the POC's `LEGACY_FX` branches
 * (Piratical Hero, Reavers, Assured Destruction, the Riven/Web/Guide marks…)
 * are expressed in the effect vocabulary (fx.ts). `tests/engine-parity.test.ts`
 * holds this port to the POC's numbers cell by cell.
 *
 * This module decides what reaches an attacker (the modifier bar's scopes, the
 * rules of the unit and its attached unit, list-wide marks) and adds up a
 * unit's weapons; attack.ts scores each weapon.
 */
import { type Armed, type AttackRow, scoreWeapon } from "./attack"
import { isMeleeChoice } from "./keywords"
import type { Mod, Opts, Rule, RuleBook, Target, Unit, Weapon, WeaponKw } from "./schema"

export { avgDice, diceDist, woundNeed } from "./attack"
export type { AttackRow } from "./attack"

export const ruleKey = (owner: string, id: string) => `${owner}:${id}`

// ---------- modifier bar ----------

export const MOD0: Mod = {
  apply: "both",
  hit: 0,
  wound: 0,
  ap: 0,
  sus: false,
  lethal: false,
  rrHit: "off",
  rrWound: "off",
  cover: false,
  half: false,
  rf: 0,
  s: 0,
  a: 0,
  d: 0
}

const RR_RANK = { off: 0, "1s": 1, full: 2 } as const

export function modIsSet(m: Partial<Mod> | undefined | null): boolean {
  if (!m) return false
  return (Object.keys(MOD0) as Array<keyof Mod>).some((k) => k !== "apply" && m[k] !== undefined && m[k] !== MOD0[k])
}

/** The modifier scopes that reach one weapon of one attacker row. */
export function modScopes(unit: Unit, w?: Weapon): Array<string> {
  const s = ["all", unit.id]
  if (!unit.combined && unit.grp) s.push("grp-" + unit.grp)
  if (unit.combined && w && w._owner) s.push(w._owner)
  return [...new Set(s)]
}

export type ResolvedMod = Required<Omit<Mod, "apply">>

export function modsFor(unit: Unit, w: Weapon, opts: Opts): ResolvedMod {
  const mods = opts.mods || {}
  const out: { -readonly [K in keyof ResolvedMod]: ResolvedMod[K] } = {
    hit: 0,
    wound: 0,
    ap: 0,
    sus: false,
    lethal: false,
    rrHit: "off",
    rrWound: "off",
    cover: false,
    half: false,
    rf: 0,
    s: 0,
    a: 0,
    d: 0
  }
  for (const sc of modScopes(unit, w)) {
    const m = mods[sc]
    if (!modIsSet(m)) continue
    // cover and half range describe the table, not the attack, so they ignore "applies to"
    if (m.cover) out.cover = true
    if (m.half) out.half = true
    const ok = !m.apply || m.apply === "both" || (m.apply === "ranged") === (w.t === "r")
    if (!ok) continue
    out.hit += m.hit || 0
    out.wound += m.wound || 0
    out.ap += m.ap || 0
    out.s += m.s || 0
    out.a += m.a || 0
    out.d += m.d || 0
    if ((m.rf || 0) > out.rf) out.rf = m.rf
    if (m.sus) out.sus = true
    if (m.lethal) out.lethal = true
    if (RR_RANK[m.rrHit || "off"] > RR_RANK[out.rrHit]) out.rrHit = m.rrHit
    if (RR_RANK[m.rrWound || "off"] > RR_RANK[out.rrWound]) out.rrWound = m.rrWound
  }
  return out
}

// ---------- rules ----------

export interface EffectiveRule {
  readonly id: string
  /** Unit id the rule comes from, or `"mark"` for a list-wide target mark. */
  readonly owner: string
  readonly r: Rule
}

/** Damage rules that reach this attacker: its own, plus what its attached unit shares. */
export function effectiveRules(unit: Unit, allUnits: ReadonlyArray<Unit>, rules: RuleBook): Array<EffectiveRule> {
  const out: Array<EffectiveRule> = []
  const add = (owner: string, id: string) => {
    const r = rules[id]
    if (r && r.dmg && !out.some((x) => x.id === id && x.owner === owner)) out.push({ id, owner, r })
  }
  if (unit.combined) {
    for (const mid of unit.members ?? []) {
      const m = allUnits.find((x) => x.id === mid)
      if (m) m.rules.forEach((id) => add(m.id, id))
    }
  } else {
    unit.rules.forEach((id) => add(unit.id, id))
    if (unit.grp) {
      for (const m of allUnits) {
        if (m.grp !== unit.grp || m.id === unit.id) continue
        m.rules.forEach((id) => {
          if (rules[id]?.scope === "unit") add(m.id, id)
        })
      }
    }
  }
  return out
}

/*
 * A matrix asks for the same unit against every target, so the parts of an
 * attack that don't depend on the target are kept between calls: which rules
 * reach a unit, and which list-wide marks exist in a rule book. Both caches are
 * keyed on the objects they were computed from and only ever read, so a new
 * list, unit or rule book simply misses.
 */
const reachCache = new WeakMap<Unit, { units: ReadonlyArray<Unit>; rules: RuleBook; out: ReadonlyArray<EffectiveRule> }>()
function rulesReaching(unit: Unit, units: ReadonlyArray<Unit>, rules: RuleBook): ReadonlyArray<EffectiveRule> {
  const hit = reachCache.get(unit)
  if (hit && hit.units === units && hit.rules === rules) return hit.out
  const out = effectiveRules(unit, units, rules)
  reachCache.set(unit, { units, rules, out })
  return out
}

const globalMarkCache = new WeakMap<RuleBook, ReadonlyArray<EffectiveRule>>()
/** Every rule in the book that, when its mark is on, reaches every attacker. */
function globalMarks(rules: RuleBook): ReadonlyArray<EffectiveRule> {
  let out = globalMarkCache.get(rules)
  if (!out) {
    out = Object.entries(rules)
      .filter(([, r]) => r.mark && r.global && r.fx)
      .map(([id, r]) => ({ id, owner: "mark", r }))
    globalMarkCache.set(rules, out)
  }
  return out
}

export function ruleActive(er: EffectiveRule, opts: Opts): boolean {
  if (er.r.mark) return !!opts.flags[er.r.mark]
  // a rule waiting for a situation is idle while its switch is off, whatever its clauses say
  if (er.r.cond && !opts.flags[er.r.cond]) return false
  return !opts.off[ruleKey(er.owner, er.id)]
}

export function unitPts(unit: Unit, opts: Pick<Opts, "enh">): number {
  const e = unit.enh ? unit.enh.pts : 0
  return opts.enh ? unit.pts : unit.pts - e
}

// ---------- attack ----------

export interface AttackResult {
  readonly rows: Array<AttackRow>
  /** Wounds dealt. */
  readonly total: number
  readonly pts: number
  /** Target points per wound. */
  readonly ppw: number
  /** Return on points, as a percentage. */
  readonly roi: number
  /** Target's wound pool. */
  readonly pool: number
  readonly capped: boolean
  readonly rules: Array<EffectiveRule>
}

export interface EngineContext {
  readonly rules: RuleBook
  readonly units: ReadonlyArray<Unit>
}

/**
 * What reaches each of a unit's weapons, whatever the target: the rules, the
 * modifier bar, the attacker's keywords. A matrix row asks for the same unit
 * against every target, so this is worked out once per unit and set of options
 * (and the attack sequence gets the same objects back each time, which its own
 * caches rely on).
 */
interface Prepared {
  readonly opts: Opts
  readonly rules: RuleBook
  readonly units: ReadonlyArray<Unit>
  readonly active: Array<EffectiveRule>
  readonly weapons: ReadonlyArray<Armed>
}
const preparedCache = new WeakMap<Unit, Prepared>()

function prepare(unit: Unit, opts: Opts, ctx: EngineContext): Prepared {
  const hit = preparedCache.get(unit)
  if (hit && hit.opts === opts && hit.rules === ctx.rules && hit.units === ctx.units) return hit
  const active = rulesReaching(unit, ctx.units, ctx.rules).filter((x) => ruleActive(x, opts))
  // Target marks with a list-wide effect reach every attacker. They are applied
  // once, from here, so the unit that sets the mark does not get it twice (the
  // POC double-counted Shattered Defences on the Thunderstrike itself).
  const marks = globalMarks(ctx.rules).filter((x) => opts.flags[x.r.mark!])
  const own = active.filter((x) => !(x.r.mark && x.r.global))
  const weapons = unit.w.map((w): Armed => {
    // the datasheet this weapon belongs to: the unit itself, or the member of an attached unit that carries it
    const carrier = unit.combined && w._owner ? ctx.units.find((x) => x.id === w._owner) : unit
    return {
      w,
      md: modsFor(unit, w, opts),
      // in a combined unit, a rule that isn't shared only covers its own datasheet's weapons
      rules: own.filter((x) => !unit.combined || x.r.scope === "unit" || !w._owner || w._owner === x.owner).concat(marks),
      attackerKw: (carrier?.kw ?? []).join(" ").toUpperCase(),
      name: String(w.nm || "")
        .replace(/^[^:]*:\s*/, "")
        .toLowerCase()
    }
  })
  const out = { opts, rules: ctx.rules, units: ctx.units, active, weapons }
  preparedCache.set(unit, out)
  return out
}

export function attackUnit(unit: Unit, tgt: Target, opts: Opts, ctx: EngineContext, phase?: Opts["phase"]): AttackResult {
  phase = phase || opts.phase
  const prepared = prepare(unit, opts, ctx)
  const rows: Array<AttackRow> = []
  for (const a of prepared.weapons) {
    const w = a.w
    if (phase === "ranged" && w.t !== "r") continue
    if (phase === "melee" && w.t !== "m") continue
    if (w.off) {
      rows.push({ w, skipped: w.off })
      continue
    }
    rows.push({ w, ...scoreWeapon(a, tgt, opts) })
  }
  // one profile per multi-profile weapon, one melee weapon per model
  const alts: Record<string, Array<AttackRow>> = {}
  rows.forEach((r) => {
    if (r.w.alt && !r.skipped) (alts[r.w.alt] = alts[r.w.alt] || []).push(r)
  })
  for (const k in alts) {
    const g = alts[k]
    const best = g.reduce((a, b) => ((b.dealt ?? 0) > (a.dealt ?? 0) ? b : a))
    g.forEach((r) => {
      if (r !== best) {
        r.skipped = isMeleeChoice(r.w.alt) ? "This model fights with a better weapon here" : "The other profile does more damage here"
        r.dealt = 0
      }
    })
  }
  let total = rows.reduce((s, r) => s + (r.skipped ? 0 : r.dealt || 0), 0)
  const pool = tgt.W * tgt.N
  const capped = opts.cap && total > pool
  if (opts.cap) total = Math.min(total, pool)
  const pts = unitPts(unit, opts)
  const ppw = tgt.pts / pool
  return { rows, total, pts, ppw, roi: pts > 0 ? (total / pts) * ppw * 100 : 0, pool, capped, rules: prepared.active }
}

export { isMeleeChoice }

// ---------- attached units ----------

/** Display name without the faction prefix that makes combined names unwieldy. */
export const shortName = (n: string) => n.replace("Corsair ", "").replace("Prince ", "")

/** The rows of the matrix: attached units merged into one row when `combine` is on. */
export function attackerList(units: ReadonlyArray<Unit>, opts: Pick<Opts, "combine">): Array<Unit> {
  if (!opts.combine) return [...units]
  const out: Array<Unit> = []
  const seen = new Set<string>()
  for (const u of units) {
    if (u.grp) {
      if (seen.has(u.grp)) continue
      seen.add(u.grp)
      out.push(combineUnits(u.grp, units.filter((x) => x.grp === u.grp)))
    } else out.push(u)
  }
  return out
}

export function combineUnits(g: string, members: ReadonlyArray<Unit>): Unit {
  const w: Array<Weapon> = []
  for (const m of members) {
    for (const x of m.w) {
      w.push({ ...x, nm: `${shortName(m.nm)}: ${x.nm}`, alt: x.alt ? m.id + ":" + x.alt : undefined, _owner: m.id })
    }
  }
  const enhs = members.filter((m) => m.enh)
  return {
    id: "grp-" + g,
    nm: members.map((m) => shortName(m.nm)).join(" + "),
    grp: g,
    combined: true,
    members: members.map((m) => m.id),
    pts: members.reduce((s, m) => s + m.pts, 0),
    enh: enhs.length
      ? {
          nm: enhs.map((m) => m.enh!.nm).join(", "),
          pts: enhs.reduce((s, m) => s + m.enh!.pts, 0),
          ids: enhs.map((m) => m.enh!.id ?? "")
        }
      : null,
    models: members.reduce((s, m) => s + m.models, 0),
    w,
    rules: []
  }
}

export type { WeaponKw }
