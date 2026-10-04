/**
 * The effect vocabulary: every field an effect clause can have, defined once.
 *
 * A clause is a rule's effect, the modifier bar, or a core ability that works
 * as a modifier (see attack.ts); they are all read through this table. A
 * *when* field says whether the clause reaches an attack; a *does* field adds
 * something to the attack's Profile. Each entry also carries its words, for the
 * library and the rule editor, and its line of help beside the editor.
 *
 * A new field is a line in the `Fx` schema (schema.ts), an entry here (the
 * compiler insists on one), and the arithmetic in attack.ts that reads it.
 */
import { ABILITIES, antiValue, mergeAnti } from "./keywords"
import type { Fx, KwCond, Reroll, Rule } from "./schema"

/** What a *when* field can see about one attack. */
export interface ClauseCtx {
  readonly ranged: boolean
  /** Situation switches and marks. */
  readonly flags: Readonly<Record<string, boolean>>
  /** The target's keywords, upper case. */
  readonly targetKw: string
  /** The keywords of the unit making the attack. */
  readonly attackerKw: string
  /** The weapon's name, lower case, without an attached unit's "Member: " prefix. */
  readonly weaponName: string
  /** The weapon's own abilities, before anything is granted. */
  readonly weaponKw: Readonly<Record<string, unknown>>
  /** The target is in cover (the modifier bar). */
  readonly cover: boolean
}

/** Everything the clauses that reach one attack add up to. */
export interface Profile {
  /** Bonuses and penalties to the hit roll, kept apart because some rules ignore only the penalties. */
  hitPlus: number
  hitMinus: number
  wound: number
  /** Improvement to BS/WS. */
  skill: number
  s: number
  ap: number
  a: number
  d: number
  rrHit: Reroll | null
  rrWound: Reroll | null
  rrDmg: boolean
  /** Critical hits on this unmodified roll or better. */
  critHit: number
  /** Rules that ignore penalties to the hit roll, in the order they reached the attack. */
  readonly ignoresPenalties: Array<string>
  /** The weapon's abilities against this target, with what the clauses granted. */
  readonly kw: Record<string, any>
  /** What the rules changed, without the modifier bar, which has its own note. */
  readonly shown: { skill: number; a: number; s: number; ap: number; d: number }
  /** Rules that changed something, for the notes. */
  readonly named: Array<string>
  /** Core abilities that applied as modifiers (Heavy, Lance, Twin-linked). */
  readonly core: Array<string>
}

export const startProfile = (kw: Record<string, any>): Profile => ({
  hitPlus: 0,
  hitMinus: 0,
  wound: 0,
  skill: 0,
  s: 0,
  ap: 0,
  a: 0,
  d: 0,
  rrHit: null,
  rrWound: null,
  rrDmg: false,
  critHit: 6,
  ignoresPenalties: [],
  kw,
  shown: { skill: 0, a: 0, s: 0, ap: 0, d: 0 },
  named: [],
  core: []
})

type Help = readonly [label: string, meaning: string]

/** How the rule editor asks for a field's value. */
export type FieldInput =
  | { readonly kind: "choice"; readonly options: ReadonlyArray<readonly [value: string, label: string]> }
  /** A situation switch or a mark, by key. */
  | { readonly kind: "switch" }
  /** `{only, not}` keyword lists. */
  | { readonly kind: "keywords" }
  | { readonly kind: "text"; readonly placeholder: string }
  /** One weapon ability, by its key. */
  | { readonly kind: "ability" }
  | { readonly kind: "number"; readonly min: number; readonly max: number }
  /** True while the field is there. */
  | { readonly kind: "on" }
  /** Weapon abilities to add, some with a number. */
  | { readonly kind: "abilities" }
  /** Target keyword → critical wound roll. */
  | { readonly kind: "anti" }

/** What every field has, besides its role: how the rule editor shows it. */
interface Field<V> {
  /** The field's name in the rule editor. */
  readonly label: string
  readonly input: FieldInput
  /** Its value when it is added to a clause. */
  readonly blank: V
  readonly says: (v: V) => ReadonlyArray<string>
  /** Absent when another field's help covers it. */
  readonly help?: Help
}

interface When<V> extends Field<V> {
  /** Does the clause reach this attack? */
  readonly test: (v: V, c: ClauseCtx) => boolean
}

interface Does<V> extends Field<V> {
  readonly add: (p: Profile, v: V, source: string, fromBar: boolean) => void
  /** Whether it counts as the rule having done something, so it is named in the notes. Default: yes. */
  readonly credit?: (v: V, c: ClauseCtx) => boolean
}

/** Does a keyword string satisfy `{only:[…]}` / `{not:[…]}`? */
export function kwCond(c: KwCond | undefined | null, kw: string): boolean {
  if (!c) return true
  const has = (k: string) => kw.split(/[\s,]+/).includes(k) || kw.includes(k)
  if (c.only && !c.only.some(has)) return false
  if (c.not && c.not.some(has)) return false
  return true
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)
const RANK = { none: 0, ones: 1, all: 2 } as const
const stronger = (have: Reroll | null, v: Reroll) => (RANK[v] > RANK[have ?? "none"] ? v : have)
/** A characteristic change that the notes show when a rule made it. */
const shownSum = (k: "skill" | "a" | "s" | "ap" | "d") => (p: Profile, v: number, _source: string, fromBar: boolean) => {
  p[k] += v
  if (!fromBar) p.shown[k] += v
}

const granted = (k: string, n: number) => {
  const a = ABILITIES.find((x) => x.key === k)
  return a ? (a.n ? `${a.label} ${n}` : a.label) : `${k} ${n}`
}
const keywords = (v: KwCond, only: (k: string) => string, not: (k: string) => string) => [
  ...(v.only?.length ? [only(v.only.join("/").toLowerCase())] : []),
  ...(v.not?.length ? [not(v.not.join("/").toLowerCase())] : [])
]
const number = (min: number, max: number): FieldInput => ({ kind: "number", min, max })
const REROLLS: FieldInput = { kind: "choice", options: [["ones", "rolls of 1"], ["all", "any failed roll"]] }

/** The vocabulary, in the order the editor's help and a clause's description list it. */
export const CLAUSE: { readonly [K in keyof Fx]-?: When<NonNullable<Fx[K]>> | Does<NonNullable<Fx[K]>> } = {
  // ---------- when ----------
  phase: {
    label: "Only",
    input: { kind: "choice", options: [["ranged", "ranged attacks"], ["melee", "melee attacks"]] },
    blank: "ranged",
    test: (v, c) => (v === "ranged") === c.ranged,
    says: (v) => [v],
    help: ["phase", '"melee" or "ranged": only those attacks']
  },
  when: {
    label: "While switched on",
    input: { kind: "switch" },
    blank: "charged",
    test: (v, c) => !!c.flags[v],
    says: (v) => [`when “${v}”`],
    help: ["when / whenNot", "a situation or mark key (charged, stationary, objective, char, selfObj, or a mark) that must be on / off"]
  },
  whenNot: {
    label: "While switched off",
    input: { kind: "switch" },
    blank: "charged",
    test: (v, c) => !c.flags[v],
    says: (v) => [`unless “${v}”`]
  },
  vs: {
    label: "Target keywords",
    input: { kind: "keywords" },
    blank: {},
    test: (v, c) => kwCond(v, c.targetKw),
    says: (v) => keywords(v, (k) => `vs ${k}`, (k) => `not vs ${k}`),
    help: ["vs", '{"only": ["MONSTER", "VEHICLE"]} or {"not": [...]}: target keyword filter']
  },
  attacker: {
    label: "Attacker keywords",
    input: { kind: "keywords" },
    blank: {},
    test: (v, c) => kwCond(v, c.attackerKw),
    says: (v) => keywords(v, (k) => `${k} attackers`, (k) => `non-${k} attackers`),
    help: ["attacker", '{"only": ["VEHICLE"]}: only attacks made by units with these keywords (for a buff handed to another unit)']
  },
  weapon: {
    label: "Weapon name has",
    input: { kind: "text", placeholder: "lance" },
    blank: "",
    test: (v, c) => c.weaponName.includes(v),
    says: (v) => [`“${v}” only`],
    help: ["weapon / weaponNot", "lower-case part of a weapon name"]
  },
  weaponNot: {
    label: "Weapon name hasn’t",
    input: { kind: "text", placeholder: "pistol" },
    blank: "",
    test: (v, c) => !c.weaponName.includes(v),
    says: (v) => [`except “${v}”`]
  },
  weaponKw: {
    label: "Weapons with",
    input: { kind: "ability" },
    blank: "heavy",
    test: (v, c) => !!c.weaponKw[v],
    says: (v) => [`${v} weapons`],
    help: ["weaponKw", 'only weapons with this ability, as the importer keys it: "heavy", "rf", "blast", "pistol", "torrent"…']
  },

  // ---------- does ----------
  hit: {
    label: "Hit roll",
    input: number(-2, 2),
    blank: 1,
    add: (p, v) => {
      if (v > 0) p.hitPlus += v
      else p.hitMinus += v
    },
    says: (v) => [`${signed(v)} to hit`],
    help: ["hit, wound", "roll modifiers; everything is summed, then capped at ±1"]
  },
  wound: {
    label: "Wound roll",
    input: number(-2, 2),
    blank: 1,
    add: (p, v) => {
      p.wound += v
    },
    says: (v) => [`${signed(v)} to wound`]
  },
  skill: {
    label: "BS / WS",
    input: number(-2, 2),
    blank: 1,
    add: shownSum("skill"),
    says: (v) => [v > 0 ? `BS/WS improved by ${v}` : `BS/WS worsened by ${-v}`],
    help: ["skill", "improve Ballistic or Weapon Skill by this much (1: a 4+ hits on 3+); a characteristic change, so not capped like hit"]
  },
  s: {
    label: "Strength",
    input: number(-6, 6),
    blank: 1,
    add: shownSum("s"),
    says: (v) => [`${signed(v)} Strength`],
    help: ["s, ap, a, d", "characteristic changes: Strength, AP, Attacks per model, Damage; uncapped"]
  },
  ap: { label: "AP", input: number(-4, 4), blank: 1, add: shownSum("ap"), says: (v) => [`${signed(v)} AP`] },
  a: { label: "Attacks", input: number(-6, 6), blank: 1, add: shownSum("a"), says: (v) => [`${signed(v)} Attacks`] },
  d: { label: "Damage", input: number(-6, 6), blank: 1, add: shownSum("d"), says: (v) => [`${signed(v)} Damage`] },
  rrHit: {
    label: "Re-roll hits",
    input: REROLLS,
    blank: "ones",
    add: (p, v) => {
      p.rrHit = stronger(p.rrHit, v)
    },
    says: (v) => [v === "all" ? "re-roll hits" : "re-roll hit rolls of 1"],
    help: ["rrHit, rrWound", '"ones" or "all"; the strongest re-roll wins']
  },
  rrWound: {
    label: "Re-roll wounds",
    input: REROLLS,
    blank: "ones",
    add: (p, v) => {
      p.rrWound = stronger(p.rrWound, v)
    },
    says: (v) => [v === "all" ? "re-roll wounds" : "re-roll wound rolls of 1"]
  },
  rrDmg: {
    label: "Re-roll damage",
    input: { kind: "on" },
    blank: true,
    add: (p, v) => {
      if (v) p.rrDmg = true
    },
    says: () => ["re-roll damage"],
    help: ["rrDmg", "true: re-roll the damage roll"]
  },
  critHit: {
    label: "Critical hits on",
    input: number(2, 6),
    blank: 5,
    add: (p, v) => {
      if (v) p.critHit = Math.min(p.critHit, v)
    },
    says: (v) => [`critical hits on ${v}+`],
    help: ["critHit", "critical hits on this unmodified roll or better (5 for “crits on 5+”)"]
  },
  ignoreHitPenalty: {
    label: "Ignore hit penalties",
    input: { kind: "on" },
    blank: true,
    add: (p, v, source) => {
      if (v) p.ignoresPenalties.push(source)
    },
    // named where it takes effect, and only when there was a penalty to ignore
    credit: () => false,
    says: () => ["ignore penalties to hit and to BS/WS"],
    help: ["ignoreHitPenalty", "true: ignore −1 to hit and the cover penalty; bonuses still count"]
  },
  grant: {
    label: "Weapons gain",
    input: { kind: "abilities" },
    blank: {},
    add: (p, v) => {
      for (const [k, n] of Object.entries(v)) {
        if (typeof n === "number" && typeof p.kw[k] === "number") p.kw[k] = Math.max(p.kw[k], n)
        else if (!p.kw[k]) p.kw[k] = n
      }
    },
    // Ignores Cover only does something when the target is in cover
    credit: (v, c) => c.cover || Object.keys(v).some((k) => k !== "ic"),
    says: (v) => Object.entries(v).map(([k, n]) => granted(k, n)),
    help: ["grant", '{"sus": 1, "lethal": 1, "lance": 1, "ic": 1, "dev": 1, "cleave": 1, "tl": 1}: weapon abilities to add']
  },
  anti: {
    label: "Weapons gain Anti-",
    input: { kind: "anti" },
    blank: {},
    add: (p, v) => {
      p.kw.anti = antiValue(mergeAnti(p.kw.anti, v))
    },
    says: (v) => Object.entries(v).map(([k, n]) => `Anti-${k.toLowerCase()} ${n}+`),
    help: ["anti", '{"INFANTRY": 2, "MONSTER": 5}: Anti abilities to add (target keyword → critical wound roll); the better roll wins']
  }
}

type AnySpec = When<any> | Does<any>
const FIELDS = Object.keys(CLAUSE) as Array<keyof Fx>

/** An effect clause, ready to use: split into its *when* and *does* fields once. */
export interface Clause {
  /** Does it reach this attack? */
  readonly reaches: (c: ClauseCtx) => boolean
  /** Add its *does* fields to the profile; true when they count as the clause doing something. */
  readonly addTo: (p: Profile, source: string, fromBar: boolean, c: ClauseCtx) => boolean
}

const clauses = new WeakMap<Fx, Clause>()

/** The clause for an effect, worked out once per effect object. */
export function clause(e: Fx): Clause {
  let out = clauses.get(e)
  if (!out) {
    const when: Array<readonly [When<any>, unknown]> = []
    const does: Array<readonly [Does<any>, unknown]> = []
    for (const k in e) {
      const s = (CLAUSE as Record<string, AnySpec>)[k]
      const v = e[k as keyof Fx]
      if (!s) continue
      // an empty *when* field doesn't filter; an absent *does* field adds nothing
      if ("test" in s) {
        if (v) when.push([s, v])
      } else if (v !== undefined && v !== null) does.push([s, v])
    }
    out = {
      reaches: (c) => {
        for (const [s, v] of when) if (!s.test(v, c)) return false
        return true
      },
      addTo: (p, source, fromBar, c) => {
        let credited = false
        for (const [s, v] of does) {
          s.add(p, v, source, fromBar)
          if (!s.credit || s.credit(v, c)) credited = true
        }
        return credited
      }
    }
    clauses.set(e, out)
  }
  return out
}

// ---------- in the editor ----------

export type FieldSpec = When<any> | Does<any>
export const FIELD_KEYS: ReadonlyArray<keyof Fx> = FIELDS
export const isWhen = (s: FieldSpec): s is When<any> => "test" in s

/** Whether a value says nothing: an empty text, list, keyword filter or map. */
function empty(v: unknown): boolean {
  if (v === undefined || v === null || v === "" || v === false) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "object") return Object.values(v as object).every(empty)
  return false
}

/**
 * A clause as the editor saves it: fields in the table's order, and anything
 * that says nothing left out (a keyword filter with no keywords, a weapon name
 * not typed yet), since an empty `only` list would match no target at all.
 */
export function tidyClause(e: Readonly<Record<string, unknown>>): Fx {
  const out: Record<string, unknown> = {}
  for (const k of FIELDS) {
    let v = e[k]
    if (v && typeof v === "object" && !Array.isArray(v) && (k === "vs" || k === "attacker")) {
      v = Object.fromEntries(Object.entries(v).filter(([, x]) => !empty(x)))
    }
    if (!empty(v)) out[k] = v
  }
  return out as Fx
}

// ---------- in words ----------

export function describeFx(e: Fx): string {
  const when: Array<string> = []
  const does: Array<string> = []
  for (const k of FIELDS) {
    const v = e[k]
    if (!v) continue
    const s = CLAUSE[k] as AnySpec
    ;("test" in s ? when : does).push(...s.says(v))
  }
  const what = does.length ? does.join(", ") : "nothing"
  return when.length ? `${when.join(", ")}: ${what}` : what
}

/** One line for a whole rule: what it does to the maths, or why it does nothing. */
export function describeRule(r: Rule): string {
  if (!r.dmg) return r.todo ? "Not modelled yet" : "No effect on damage"
  if (!r.fx?.length) return r.mark ? `Sets the “${r.markNm ?? r.mark}” mark` : "Counted, but has no effect written"
  return r.fx.map(describeFx).join("; ")
}

/** The vocabulary, as shown beside the editor. */
export const FX_HELP: ReadonlyArray<Help> = FIELDS.flatMap((k) => {
  const help = (CLAUSE[k] as AnySpec).help
  return help ? [help] : []
})
