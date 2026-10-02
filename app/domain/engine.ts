/**
 * The damage engine. Pure functions, no Effect, no I/O: it runs in loaders, in
 * the browser for optimistic recalculation, and in tests.
 *
 * Ported from the POC's `engine.js` (handoff section 5). The one structural
 * change is that every rule is now data: the POC's `LEGACY_FX` branches
 * (Piratical Hero, Reavers, Assured Destruction, the Riven/Web/Guide marks…)
 * are expressed in the `fx` vocabulary, which grew `rrDmg` and `critHit` to
 * cover them. `tests/engine-parity.test.ts` holds this port to the POC's
 * numbers cell by cell.
 */
import type { Dice, Fx, KwCond, Mod, Opts, Reroll, Rule, RuleBook, Target, Unit, Weapon, WeaponKw } from "./schema"

// ---------- dice ----------

const DICE = /^(\d*)D(\d+)(?:\+(\d+))?$/

/** Mean of a dice expression (`"2D6+1"` → 8). */
export function avgDice(x: Dice): number {
  if (typeof x === "number") return x
  const m = String(x).trim().toUpperCase().match(DICE)
  if (m) {
    const k = m[1] ? +m[1] : 1
    const f = +m[2]
    const add = m[3] ? +m[3] : 0
    return (k * (f + 1)) / 2 + add
  }
  const n = parseFloat(x)
  return Number.isNaN(n) ? 0 : n
}

/** Exact distribution of a dice expression as `[value, probability]` pairs. */
export function diceDist(x: Dice): Array<[number, number]> {
  if (typeof x === "number") return [[x, 1]]
  const m = String(x).trim().toUpperCase().match(DICE)
  if (!m) {
    const n = parseFloat(x)
    return [[Number.isNaN(n) ? 0 : n, 1]]
  }
  const k = m[1] ? +m[1] : 1
  const f = +m[2]
  const add = m[3] ? +m[3] : 0
  let dist = new Map<number, number>([[0, 1]])
  for (let i = 0; i < k; i++) {
    const nd = new Map<number, number>()
    for (const [v, p] of dist) for (let r = 1; r <= f; r++) nd.set(v + r, (nd.get(v + r) || 0) + p / f)
    dist = nd
  }
  return [...dist].map(([v, p]) => [v + add, p])
}

export function woundNeed(S: number, T: number): number {
  if (S >= 2 * T) return 2
  if (S > T) return 3
  if (S === T) return 4
  if (2 * S <= T) return 6
  return 5
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

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
  rf: 0
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

type ResolvedMod = Omit<Mod, "apply">

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
    rf: 0
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

export function ruleActive(er: EffectiveRule, opts: Opts): boolean {
  if (er.r.mark) return !!opts.flags[er.r.mark]
  return !opts.off[ruleKey(er.owner, er.id)]
}

export function unitPts(unit: Unit, opts: Pick<Opts, "enh">): number {
  const e = unit.enh ? unit.enh.pts : 0
  return opts.enh ? unit.pts : unit.pts - e
}

/** Does a target's keyword string satisfy `{only:[…]}` / `{not:[…]}`? */
export function kwCond(c: KwCond | undefined | null, tKw: string): boolean {
  if (!c) return true
  const has = (k: string) => tKw.split(/[\s,]+/).includes(k) || tKw.includes(k)
  if (c.only && !c.only.some(has)) return false
  if (c.not && c.not.some(has)) return false
  return true
}

function targetKw(tgt: Target, opts: Opts): string {
  let k = String(tgt.kw || "").toUpperCase()
  if (opts.flags.char && !/CHARACTER/.test(k)) k += " CHARACTER"
  return k
}

// ---------- attack ----------

export interface AttackRow {
  readonly w: Weapon
  /** Why the row is not counted (pistol rule, the other profile was better…). */
  skipped?: string
  models?: number
  attacks?: number
  /** Hits per attack, sustained hits included. */
  hit?: number
  /** Chance one attack hits. */
  hitChance?: number
  /** Extra hits per attack from Sustained Hits. */
  susExtra?: number
  lethalShare?: number
  /** Wounds per hit. */
  wound?: number
  /** Share of wounds that get past the save. */
  fail?: number
  /** Damage per unsaved wound. */
  dmg?: number
  dealt?: number
  notes?: Array<string>
}

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

export function attackUnit(unit: Unit, tgt: Target, opts: Opts, ctx: EngineContext, phase?: Opts["phase"]): AttackResult {
  phase = phase || opts.phase
  const er = effectiveRules(unit, ctx.units, ctx.rules).filter((x) => ruleActive(x, opts))
  // Target marks with a list-wide effect reach every attacker. They are applied
  // once, from here, so the unit that sets the mark does not get it twice (the
  // POC double-counted Shattered Defences on the Thunderstrike itself).
  const marks: Array<EffectiveRule> = []
  for (const [id, r] of Object.entries(ctx.rules)) {
    if (r.mark && r.global && r.fx && opts.flags[r.mark]) marks.push({ id, owner: "mark", r })
  }
  const own = er.filter((x) => !(x.r.mark && x.r.global))
  const rows: Array<AttackRow> = []
  for (const w of unit.w) {
    if (phase === "ranged" && w.t !== "r") continue
    if (phase === "melee" && w.t !== "m") continue
    if (w.off) {
      rows.push({ w, skipped: w.off })
      continue
    }
    // in a combined unit, a rule that isn't shared only covers its own datasheet's weapons
    const mine = own
      .filter((x) => !unit.combined || x.r.scope === "unit" || !w._owner || w._owner === x.owner)
      .concat(marks)
    // the datasheet this weapon belongs to: the unit itself, or the member of an attached unit that carries it
    const carrier = unit.combined && w._owner ? ctx.units.find((x) => x.id === w._owner) : unit
    const attackerKw = (carrier?.kw ?? []).join(" ").toUpperCase()
    rows.push({ w, ...attackWeapon(w, tgt, opts, modsFor(unit, w, opts), mine, attackerKw) })
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
  return { rows, total, pts, ppw, roi: pts > 0 ? (total / pts) * ppw * 100 : 0, pool, capped, rules: er }
}

/** `m0:melee` / `yriel:m0:melee` are per-model melee choices; `p…` are weapon profiles. */
export const isMeleeChoice = (alt: string | null | undefined) => !!alt && /(^|:)m\d*:/.test(alt)

const RR: Record<string, number> = { null: 0, ones: 1, all: 2 }

/** Fields of an effect clause that say when it applies, rather than what it does. */
const FX_FILTERS = new Set(["phase", "when", "whenNot", "vs", "attacker", "weapon", "weaponNot"])

export function attackWeapon(
  w: Weapon,
  tgt: Target,
  opts: Opts,
  md: ResolvedMod,
  ruleList: ReadonlyArray<EffectiveRule>,
  /** Keywords of the unit making the attack, for effects that only reach some attackers. */
  attackerKw = ""
): Omit<AttackRow, "w"> {
  const notes: Array<string> = []
  const ranged = w.t === "r"
  const tKw = targetKw(tgt, opts)
  // weapon abilities, minus any whose keyword condition the target doesn't meet
  const kw: Record<string, any> = { ...(w.kw || {}) }
  if (kw.when) for (const k of Object.keys(kw.when)) if (!kwCond(kw.when[k], tKw)) delete kw[k]

  const mn: Array<string> = []
  if (md.hit) mn.push(`${md.hit > 0 ? "+" : "−"}${Math.abs(md.hit)} hit`)
  if (md.wound) mn.push(`${md.wound > 0 ? "+" : "−"}${Math.abs(md.wound)} wound`)
  if (md.ap) mn.push(`${md.ap > 0 ? "+" : "−"}${Math.abs(md.ap)} AP`)
  if (md.sus) mn.push("Sustained 1")
  if (md.lethal) mn.push("Lethal")
  if (md.rrHit !== "off") mn.push(`re-roll hits ${md.rrHit === "1s" ? "of 1" : "(full)"}`)
  if (md.rrWound !== "off") mn.push(`re-roll wounds ${md.rrWound === "1s" ? "of 1" : "(full)"}`)
  if (md.rf && ranged && md.rf > (kw.rf || 0) && !md.half) mn.push(`Rapid Fire ${md.rf} (idle: not within half range)`)
  if (mn.length) notes.push("Modifier: " + mn.join(", "))

  // Hit modifiers are kept as bonuses and penalties, because some rules ignore only the penalties.
  let hitPlus = 0
  let hitMinus = 0
  const addHit = (n: number) => {
    if (n > 0) hitPlus += n
    else hitMinus += n
  }
  addHit(md.hit)
  const ignoresPenalties: Array<string> = []

  // rule effects from the library
  const fx = { wound: 0, s: 0, ap: 0, a: 0, d: 0 }
  let fxRrHit: Reroll | null = null
  let fxRrWound: Reroll | null = null
  let rrDmg = false
  let critOn = 6
  const bare = String(w.nm || "")
    .replace(/^[^:]*:\s*/, "")
    .toLowerCase()
  for (const x of ruleList) {
    if (!x.r.fx) continue
    let used = false
    for (const e of x.r.fx) {
      if (!fxApplies(e, ranged, opts, tKw, bare, attackerKw)) continue
      addHit(e.hit || 0)
      if (e.ignoreHitPenalty) ignoresPenalties.push(x.r.nm)
      fx.wound += e.wound || 0
      fx.s += e.s || 0
      fx.ap += e.ap || 0
      fx.a += e.a || 0
      fx.d += e.d || 0
      if (e.rrHit && RR[e.rrHit] > RR[String(fxRrHit)]) fxRrHit = e.rrHit
      if (e.rrWound && RR[e.rrWound] > RR[String(fxRrWound)]) fxRrWound = e.rrWound
      if (e.rrDmg) rrDmg = true
      if (e.critHit) critOn = Math.min(critOn, e.critHit)
      if (e.grant) {
        for (const [k, v] of Object.entries(e.grant)) {
          if (typeof v === "number" && typeof kw[k] === "number") kw[k] = Math.max(kw[k], v)
          else if (!kw[k]) kw[k] = v
        }
      }
      // Ignores Cover only does something when the target is in cover, and ignoring penalties only when
      // there is one; those are credited where they take effect, not here
      const does = Object.keys(e).filter((k) => !FX_FILTERS.has(k))
      const onlyIgnoresCover = does.every((k) => k === "grant") && Object.keys(e.grant ?? {}).every((k) => k === "ic")
      const onlyIgnoresPenalties = does.every((k) => k === "ignoreHitPenalty")
      if (!onlyIgnoresPenalties && (!onlyIgnoresCover || md.cover)) used = true
    }
    if (used) notes.push(x.r.nm)
  }

  // attacks
  let perModel = avgDice(w.A) + fx.a
  if (fx.a) notes.push(`+${fx.a} A`)
  if (kw.blast) {
    const b = Math.floor(tgt.N / 5) * (+kw.blast || 1)
    if (b) {
      perModel += b
      notes.push(`Blast +${b}`)
    }
  }
  if (kw.cleave && !ranged) {
    const b = Math.floor(tgt.N / 5) * (+kw.cleave || 1)
    if (b) {
      perModel += b
      notes.push(`Cleave +${b}`)
    }
  }
  const rf = ranged ? Math.max(kw.rf || 0, md.rf || 0) : 0
  if (rf && md.half) {
    perModel += rf
    notes.push(`Rapid Fire +${rf}`)
  }
  const attacks = w.n * perModel

  // modifiers
  const sus = Math.max(kw.sus || 0, md.sus ? 1 : 0)
  const lethal = !!kw.lethal || md.lethal
  let rrHit: Reroll | null = fxRrHit
  let rrWound: Reroll | null = kw.tl ? "all" : null
  if (fxRrWound && RR[fxRrWound] > RR[String(rrWound)]) rrWound = fxRrWound
  const ic = !!kw.ic
  const apB = md.ap + fx.ap
  const sB = fx.s
  if (kw.heavy && opts.flags.stationary && ranged) {
    addHit(1)
    notes.push("Heavy")
  }
  const ignorePenalty = ignoresPenalties.length > 0
  const hitMod = clamp(hitPlus + (ignorePenalty ? 0 : hitMinus), -1, 1)
  if (ignorePenalty && hitMinus < 0 && !kw.torrent) notes.push(`${ignoresPenalties[0]}: ignores the penalty to hit`)
  if (md.rrHit === "full") rrHit = "all"
  else if (md.rrHit === "1s" && !rrHit) rrHit = "ones"
  if (md.rrWound === "full") rrWound = "all"
  else if (md.rrWound === "1s" && !rrWound) rrWound = "ones"

  // hit
  let pN: number
  let pC: number
  if (kw.torrent) {
    pN = 1
    pC = 0
    notes.push("Torrent")
  } else {
    let bs = w.sk
    if (ranged && md.cover) {
      if (ic) notes.push("Ignores cover")
      else if (ignorePenalty) notes.push(`${ignoresPenalties[0]}: ignores the cover penalty`)
      else {
        // 11th edition: cover worsens BS, a characteristic change rather than a modifier
        bs += 1
        notes.push("Cover −1 BS")
      }
    }
    const need = clamp(bs - hitMod, 2, 6)
    let pS = (7 - Math.min(need, critOn)) / 6
    let pc = (7 - critOn) / 6
    if (rrHit === "all") {
      pc = pc + (1 - pS) * pc
      pS = pS + (1 - pS) * pS
    } else if (rrHit === "ones") {
      pS = pS + pS / 6
      pc = pc + pc / 6
    }
    pN = pS - pc
    pC = pc
    if (critOn < 6) notes.push(`Critical hits on ${critOn}+`)
  }
  if (sus && pC) notes.push(`Sustained ${sus}`)
  if (lethal && pC) notes.push("Lethal Hits")
  const hitsPerAttack = pN + pC * (1 + sus)
  const toRoll = pN + pC * sus + (lethal ? 0 : pC)
  const autoW = lethal ? pC : 0

  // wound
  let wn = woundNeed(w.S + sB, tgt.T)
  if (fx.s) notes.push(`+${fx.s} S`)
  let wMod = md.wound + fx.wound
  if (kw.lance && opts.flags.charged && !ranged) {
    wMod += 1
    notes.push("Lance")
  }
  wn = clamp(wn - clamp(wMod, -1, 1), 2, 6)
  let critW = 6
  if (kw.anti && String(kw.anti[0]).split("/").some((k) => kwCond({ only: [k] }, tKw))) {
    critW = Math.min(6, kw.anti[1])
    notes.push(`Anti-${String(kw.anti[0]).toLowerCase()} ${kw.anti[1]}+`)
  }
  let qS = (7 - Math.min(wn, critW)) / 6
  let qC = (7 - critW) / 6
  if (rrWound === "all") {
    qC = qC + (1 - qS) * qC
    qS = qS + (1 - qS) * qS
    if (kw.tl) notes.push("Twin-linked")
  } else if (rrWound === "ones") {
    qS = qS + qS / 6
    qC = qC + qC / 6
  }
  const rolledW = toRoll * qS
  const critWounds = toRoll * qC
  const dev = !!kw.dev
  const normalW = (dev ? rolledW - critWounds : rolledW) + autoW
  const mortalW = dev ? critWounds : 0
  if (dev && mortalW) notes.push("Devastating")
  const woundsPerAttack = rolledW + autoW

  // save
  if (fx.ap) notes.push(`+${fx.ap} AP`)
  const sv = tgt.Sv + Math.max(0, (w.AP || 0) + apB)
  const needS = tgt.inv ? Math.min(sv, tgt.inv) : sv
  const pf = needS >= 7 ? 1 : clamp((needS - 1) / 6, 0, 1)

  // damage
  const melta = kw.melta && md.half ? kw.melta : 0
  if (melta) notes.push(`Melta +${melta}`)
  if (fx.d) notes.push(`+${fx.d} D`)
  const add = melta + fx.d
  const dist = diceDist(w.D)
  // no spill-over: damage beyond the model's wounds is lost
  const capN = (v: number) => Math.min(tgt.dr ? Math.max(1, v + add - tgt.dr) : v + add, tgt.W)
  const capM = (v: number) => Math.min(v + add, tgt.W)
  const exp = (f: (v: number) => number) => {
    let e = 0
    for (const [v, p] of dist) e += f(v) * p
    if (rrDmg && dist.length > 1) {
      // optimal single re-roll: keep anything at or above the first roll's mean
      const e1 = e
      e = 0
      for (const [v, p] of dist) e += Math.max(f(v), e1) * p
    }
    return e
  }
  const dN = exp(capN)
  const dM = exp(capM)
  const fnpMul = tgt.fnp ? (tgt.fnp - 1) / 6 : 1

  const unsavedPerAttack = normalW * pf + mortalW
  const dealt = attacks * (normalW * pf * dN + mortalW * dM) * fnpMul
  const wound = hitsPerAttack ? woundsPerAttack / hitsPerAttack : 0
  const fail = woundsPerAttack ? unsavedPerAttack / woundsPerAttack : 0
  const denom = attacks * hitsPerAttack * wound * fail
  const dmg = denom ? dealt / denom : dN * fnpMul
  if (kw.oneshot) notes.push("One Shot: once per battle")
  return {
    models: w.n,
    attacks,
    hit: hitsPerAttack,
    hitChance: pN + pC,
    susExtra: pC * sus,
    lethalShare: hitsPerAttack ? autoW / hitsPerAttack : 0,
    wound,
    fail,
    dmg,
    dealt,
    notes
  }
}

function fxApplies(e: Fx, ranged: boolean, opts: Opts, tKw: string, bareWeaponName: string, attackerKw: string): boolean {
  if (e.attacker && !kwCond(e.attacker, attackerKw)) return false
  if (e.phase === "melee" && ranged) return false
  if (e.phase === "ranged" && !ranged) return false
  if (e.when && !opts.flags[e.when]) return false
  if (e.whenNot && opts.flags[e.whenNot]) return false
  if (e.vs && !kwCond(e.vs, tKw)) return false
  if (e.weapon && !bareWeaponName.includes(e.weapon)) return false
  if (e.weaponNot && bareWeaponName.includes(e.weaponNot)) return false
  return true
}

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
