/**
 * One weapon against one target: the attack sequence.
 *
 * 1. **resolve**: everything that changes the attack, added up into one
 *    Profile. The modifier bar, the rules that reach the attacker and the core
 *    abilities that work as modifiers (Heavy, Lance, Twin-linked) are all
 *    effect clauses, read through the vocabulary in fx.ts, so they combine by
 *    the same rules: hit and wound modifiers capped at ±1, the strongest
 *    re-roll, the best of a granted ability.
 * 2. **the rolls**: attacks, hit, wound, save, damage. Arithmetic on the
 *    weapon, the target and the profile; no words.
 * 3. **explain**: the notes on the breakdown, from the profile and what each
 *    roll found.
 */
import type { EffectiveRule, ResolvedMod } from "./engine"
import { clause, type ClauseCtx, kwCond, type Profile, startProfile } from "./fx"
import { antiOf } from "./keywords"
import type { Dice, Fx, Opts, Reroll, Target, Weapon } from "./schema"

// ---------- dice ----------

const DICE = /^(\d*)D(\d+)(?:\+(\d+))?$/

/** Dice expressions are few and repeat on every target, so their mean and distribution are kept. */
const means = new Map<Dice, number>()
const dists = new Map<Dice, ReadonlyArray<readonly [number, number]>>()

/** Mean of a dice expression (`"2D6+1"` → 8). */
export function avgDice(x: Dice): number {
  let m = means.get(x)
  if (m === undefined) means.set(x, (m = mean(x)))
  return m
}

/** Exact distribution of a dice expression as `[value, probability]` pairs. */
export function diceDist(x: Dice): ReadonlyArray<readonly [number, number]> {
  let d = dists.get(x)
  if (!d) dists.set(x, (d = distribution(x)))
  return d
}

function mean(x: Dice): number {
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

function distribution(x: Dice): Array<[number, number]> {
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

/** One weapon of an attacker, with what reaches it whatever the target (engine.ts prepares these). */
export interface Armed {
  readonly w: Weapon
  /** The modifier bar's settings for this weapon. */
  readonly md: ResolvedMod
  /** The rules that reach it, list-wide marks included. */
  readonly rules: ReadonlyArray<EffectiveRule>
  /** Keywords of the unit making the attack, for effects that only reach some attackers. */
  readonly attackerKw: string
  /** The weapon's name, lower case, without an attached unit's "Member: " prefix. */
  readonly name: string
}

export function scoreWeapon(a: Armed, tgt: Target, opts: Opts): Omit<AttackRow, "w"> {
  const { w, md } = a
  const ranged = w.t === "r"
  const targetKw = targetKeywords(tgt, opts)
  const kw = abilitiesAgainst(w, targetKw)
  const c: ClauseCtx = {
    ranged,
    flags: opts.flags,
    targetKw,
    attackerKw: a.attackerKw,
    weaponName: a.name,
    weaponKw: w.kw ?? {},
    cover: md.cover
  }
  const baseRf: number = kw.rf || 0
  const p = resolve(kw, md, a.rules, c)

  const volley = attacksRoll(w, p, tgt, ranged, md.half)
  const hit = hitRoll(w, p, ranged, md.cover)
  const wound = woundRoll(w, p, tgt, targetKw, hit)
  const pass = saveRoll(w, p, tgt)
  const damage = damageRoll(w, p, tgt, md.half)

  const unsavedPerAttack = wound.normal * pass + wound.mortal
  const dealt = volley.attacks * (wound.normal * pass * damage.normal + wound.mortal * damage.mortal) * damage.fnp
  const perHit = hit.perAttack ? wound.perAttack / hit.perAttack : 0
  const fail = wound.perAttack ? unsavedPerAttack / wound.perAttack : 0
  const denom = volley.attacks * hit.perAttack * perHit * fail
  return {
    models: w.n,
    attacks: volley.attacks,
    hit: hit.perAttack,
    hitChance: hit.normal + hit.crit,
    susExtra: hit.crit * hit.sus,
    lethalShare: hit.perAttack ? hit.autoWounds / hit.perAttack : 0,
    wound: perHit,
    fail,
    dmg: denom ? dealt / denom : damage.normal * damage.fnp,
    dealt,
    notes: explain(md, baseRf, ranged, p, { volley, hit, wound, damage })
  }
}

// ---------- 1. resolve ----------

/** The core abilities that work as modifiers. They are checked after the rules, which can grant them. */
const CORE = [
  { ability: "heavy", name: "Heavy", fx: { phase: "ranged", when: "stationary", hit: 1 } },
  { ability: "lance", name: "Lance", fx: { phase: "melee", when: "charged", wound: 1 } },
  { ability: "tl", name: "Twin-linked", fx: { rrWound: "all" } }
].map((k) => ({ ...k, clause: clause(k.fx as Fx) }))

const BAR_REROLL = { off: undefined, "1s": "ones", full: "all" } as const

/**
 * The modifier bar, as a clause; null when nothing in it changes the attack.
 * Cover and half range describe the table, not the attack, so they stay situations.
 * The engine hands over the same settings object for every target, so it is worked out once.
 */
const bars = new WeakMap<ResolvedMod, Fx | null>()
function barFor(md: ResolvedMod): Fx | null {
  let out = bars.get(md)
  if (out === undefined) bars.set(md, (out = barClause(md)))
  return out
}

function barClause(md: ResolvedMod): Fx | null {
  if (!md.hit && !md.wound && !md.ap && !md.sus && !md.lethal && !md.rf && md.rrHit === "off" && md.rrWound === "off") return null
  const grant: Record<string, number> = {}
  if (md.sus) grant.sus = 1
  if (md.lethal) grant.lethal = 1
  if (md.rf) grant.rf = md.rf
  return { hit: md.hit, wound: md.wound, ap: md.ap, rrHit: BAR_REROLL[md.rrHit], rrWound: BAR_REROLL[md.rrWound], grant }
}

function resolve(kw: Record<string, any>, md: ResolvedMod, rules: ReadonlyArray<EffectiveRule>, c: ClauseCtx): Profile {
  const p = startProfile(kw)
  const bar = barFor(md)
  if (bar) clause(bar).addTo(p, "Modifier bar", true, c)
  for (const x of rules) {
    if (!x.r.fx) continue
    let named = false
    for (const e of x.r.fx) {
      const k = clause(e)
      if (k.reaches(c) && k.addTo(p, x.r.nm, false, c)) named = true
    }
    if (named) p.named.push(x.r.nm)
  }
  for (const k of CORE) {
    if (p.kw[k.ability] && k.clause.reaches(c)) {
      k.clause.addTo(p, k.name, false, c)
      p.core.push(k.name)
    }
  }
  return p
}

/** The target's keywords, with CHARACTER when the "Target is a Character unit" switch is on. */
function targetKeywords(tgt: Target, opts: Opts): string {
  let k = String(tgt.kw || "").toUpperCase()
  if (opts.flags.char && !/CHARACTER/.test(k)) k += " CHARACTER"
  return k
}

/** The weapon's abilities, minus any whose keyword condition the target doesn't meet. */
function abilitiesAgainst(w: Weapon, targetKw: string): Record<string, any> {
  const kw: Record<string, any> = { ...(w.kw || {}) }
  if (kw.when) for (const k of Object.keys(kw.when)) if (!kwCond(kw.when[k], targetKw)) delete kw[k]
  return kw
}

// ---------- 2. the rolls ----------

interface Volley {
  readonly attacks: number
  readonly blast: number
  readonly cleave: number
  readonly rapidFire: number
}

function attacksRoll(w: Weapon, p: Profile, tgt: Target, ranged: boolean, half: boolean): Volley {
  let perModel = avgDice(w.A) + p.a
  const blast = p.kw.blast ? Math.floor(tgt.N / 5) * (+p.kw.blast || 1) : 0
  perModel += blast
  const cleave = p.kw.cleave && !ranged ? Math.floor(tgt.N / 5) * (+p.kw.cleave || 1) : 0
  perModel += cleave
  const rapidFire = ranged && half ? p.kw.rf || 0 : 0
  perModel += rapidFire
  return { attacks: w.n * perModel, blast, cleave, rapidFire }
}

/** How cover played out: ignored by the weapon, ignored by a rule, or worsening BS. */
type CoverOutcome = "ic" | "rule" | "applied" | null

interface HitRoll {
  /** Chance of a normal hit and of a critical one, per attack. */
  readonly normal: number
  readonly crit: number
  /** Hits per attack, sustained hits included. */
  readonly perAttack: number
  /** Hits that go on to roll to wound, per attack; lethal hits skip it. */
  readonly toWound: number
  readonly autoWounds: number
  readonly sus: number
  readonly lethal: boolean
  readonly torrent: boolean
  readonly cover: CoverOutcome
}

const reroll = (rr: Reroll | null, success: number, crit: number): [number, number] => {
  if (rr === "all") return [success + (1 - success) * success, crit + (1 - success) * crit]
  if (rr === "ones") return [success + success / 6, crit + crit / 6]
  return [success, crit]
}

function hitRoll(w: Weapon, p: Profile, ranged: boolean, cover: boolean): HitRoll {
  const sus: number = p.kw.sus || 0
  const lethal = !!p.kw.lethal
  let normal: number
  let crit: number
  let outcome: CoverOutcome = null
  if (p.kw.torrent) {
    normal = 1
    crit = 0
  } else {
    const ignorePenalty = p.ignoresPenalties.length > 0
    const hitMod = clamp(p.hitPlus + (ignorePenalty ? 0 : p.hitMinus), -1, 1)
    let bs = w.sk
    if (ranged && cover) {
      if (p.kw.ic) outcome = "ic"
      else if (ignorePenalty) outcome = "rule"
      else {
        // 11th edition: cover worsens BS, a characteristic change rather than a modifier
        bs += 1
        outcome = "applied"
      }
    }
    const need = clamp(bs - hitMod, 2, 6)
    const [success, c] = reroll(p.rrHit, (7 - Math.min(need, p.critHit)) / 6, (7 - p.critHit) / 6)
    normal = success - c
    crit = c
  }
  return {
    normal,
    crit,
    perAttack: normal + crit * (1 + sus),
    toWound: normal + crit * sus + (lethal ? 0 : crit),
    autoWounds: lethal ? crit : 0,
    sus,
    lethal,
    torrent: !!p.kw.torrent,
    cover: outcome
  }
}

interface WoundRoll {
  /** The Anti- ability that met this target, if any. */
  readonly anti: readonly [string, number] | null
  /** Wounds per attack that go to saves, and mortal wounds from Devastating Wounds. */
  readonly normal: number
  readonly mortal: number
  readonly perAttack: number
}

function woundRoll(w: Weapon, p: Profile, tgt: Target, targetKw: string, hit: HitRoll): WoundRoll {
  const need = clamp(woundNeed(w.S + p.s, tgt.T) - clamp(p.wound, -1, 1), 2, 6)
  // the best of the weapon's Anti abilities that this target has the keyword for
  let anti: readonly [string, number] | null = null
  if (p.kw.anti) {
    for (const [k, n] of Object.entries(antiOf(p.kw.anti))) if (kwCond({ only: [k] }, targetKw) && (!anti || n < anti[1])) anti = [k, n]
  }
  const critOn = anti ? Math.min(6, anti[1]) : 6
  const [success, crit] = reroll(p.rrWound, (7 - Math.min(need, critOn)) / 6, (7 - critOn) / 6)
  const rolled = hit.toWound * success
  const crits = hit.toWound * crit
  const dev = !!p.kw.dev
  return {
    anti,
    normal: (dev ? rolled - crits : rolled) + hit.autoWounds,
    mortal: dev ? crits : 0,
    perAttack: rolled + hit.autoWounds
  }
}

/** Chance a wound gets past the save. */
function saveRoll(w: Weapon, p: Profile, tgt: Target): number {
  const sv = tgt.Sv + Math.max(0, (w.AP || 0) + p.ap)
  const need = tgt.inv ? Math.min(sv, tgt.inv) : sv
  return need >= 7 ? 1 : clamp((need - 1) / 6, 0, 1)
}

interface DamageRoll {
  readonly melta: number
  /** Expected damage per unsaved wound, and per mortal wound. */
  readonly normal: number
  readonly mortal: number
  /** Share of damage that gets past Feel No Pain. */
  readonly fnp: number
}

function damageRoll(w: Weapon, p: Profile, tgt: Target, half: boolean): DamageRoll {
  const melta = p.kw.melta && half ? p.kw.melta : 0
  const add = melta + p.d
  const dist = diceDist(w.D)
  // no spill-over: damage beyond the model's wounds is lost
  const normal = (v: number) => Math.min(tgt.dr ? Math.max(1, v + add - tgt.dr) : v + add, tgt.W)
  const mortal = (v: number) => Math.min(v + add, tgt.W)
  const expect = (f: (v: number) => number) => {
    let e = 0
    for (const [v, pr] of dist) e += f(v) * pr
    if (p.rrDmg && dist.length > 1) {
      // optimal single re-roll: keep anything at or above the first roll's mean
      const e1 = e
      e = 0
      for (const [v, pr] of dist) e += Math.max(f(v), e1) * pr
    }
    return e
  }
  return { melta, normal: expect(normal), mortal: expect(mortal), fnp: tgt.fnp ? (tgt.fnp - 1) / 6 : 1 }
}

// ---------- 3. explain ----------

interface Rolls {
  readonly volley: Volley
  readonly hit: HitRoll
  readonly wound: WoundRoll
  readonly damage: DamageRoll
}

/** The modifier bar in a few words, when it is set for this weapon. */
function barNote(md: ResolvedMod, baseRf: number, ranged: boolean): string | null {
  const mn: Array<string> = []
  if (md.hit) mn.push(`${md.hit > 0 ? "+" : "−"}${Math.abs(md.hit)} hit`)
  if (md.wound) mn.push(`${md.wound > 0 ? "+" : "−"}${Math.abs(md.wound)} wound`)
  if (md.ap) mn.push(`${md.ap > 0 ? "+" : "−"}${Math.abs(md.ap)} AP`)
  if (md.sus) mn.push("Sustained 1")
  if (md.lethal) mn.push("Lethal")
  if (md.rrHit !== "off") mn.push(`re-roll hits ${md.rrHit === "1s" ? "of 1" : "(full)"}`)
  if (md.rrWound !== "off") mn.push(`re-roll wounds ${md.rrWound === "1s" ? "of 1" : "(full)"}`)
  if (md.rf && ranged && md.rf > baseRf && !md.half) mn.push(`Rapid Fire ${md.rf} (idle: not within half range)`)
  return mn.length ? "Modifier: " + mn.join(", ") : null
}

/** The breakdown's notes, in the order of the attack sequence. */
function explain(md: ResolvedMod, baseRf: number, ranged: boolean, p: Profile, r: Rolls): Array<string> {
  const notes: Array<string> = []
  const bar = barNote(md, baseRf, ranged)
  if (bar) notes.push(bar)
  notes.push(...p.named)

  if (p.shown.a) notes.push(`+${p.shown.a} A`)
  if (r.volley.blast) notes.push(`Blast +${r.volley.blast}`)
  if (r.volley.cleave) notes.push(`Cleave +${r.volley.cleave}`)
  if (r.volley.rapidFire) notes.push(`Rapid Fire +${r.volley.rapidFire}`)

  const ignoring = p.ignoresPenalties[0]
  if (p.core.includes("Heavy")) notes.push("Heavy")
  if (ignoring && p.hitMinus < 0 && !r.hit.torrent) notes.push(`${ignoring}: ignores the penalty to hit`)
  if (r.hit.torrent) notes.push("Torrent")
  else {
    if (r.hit.cover === "ic") notes.push("Ignores cover")
    else if (r.hit.cover === "rule") notes.push(`${ignoring}: ignores the cover penalty`)
    else if (r.hit.cover === "applied") notes.push("Cover −1 BS")
    if (p.critHit < 6) notes.push(`Critical hits on ${p.critHit}+`)
  }
  if (r.hit.sus && r.hit.crit) notes.push(`Sustained ${r.hit.sus}`)
  if (r.hit.lethal && r.hit.crit) notes.push("Lethal Hits")

  if (p.shown.s) notes.push(`+${p.shown.s} S`)
  if (p.core.includes("Lance")) notes.push("Lance")
  if (r.wound.anti) notes.push(`Anti-${String(r.wound.anti[0]).toLowerCase()} ${r.wound.anti[1]}+`)
  if (p.rrWound === "all" && p.kw.tl) notes.push("Twin-linked")
  if (p.kw.dev && r.wound.mortal) notes.push("Devastating")

  if (p.shown.ap) notes.push(`+${p.shown.ap} AP`)
  if (r.damage.melta) notes.push(`Melta +${r.damage.melta}`)
  if (p.shown.d) notes.push(`+${p.shown.d} D`)
  if (p.kw.oneshot) notes.push("One Shot: once per battle")
  return notes
}
