/**
 * Weapon ability strings ↔ the engine's `kw` object.
 *
 * `parseWeaponKeywords` reads the comma-separated ability list from a roster
 * profile or a Wahapedia wargear row (handoff section 4 has the table).
 */
import type { Dice, KwCond, Weapon, WeaponKw } from "./schema"

type MutableKw = { -readonly [K in keyof WeaponKw]: WeaponKw[K] } & { when?: Record<string, KwCond>; other?: Array<string> }

const diceNumber = (s: string) => (s === "d3" ? 2 : s === "d6" ? 3.5 : +s)

/** `m0:melee` / `yriel:m0:melee` are per-model melee choices; `p…` are weapon profiles. */
export const isMeleeChoice = (alt: string | null | undefined) => !!alt && /(^|:)m\d*:/.test(alt)

/** Weapon abilities by the key the engine uses, for pickers. `n`: it takes a number (Sustained Hits 2). */
export const ABILITIES: ReadonlyArray<{ readonly key: string; readonly label: string; readonly n?: true; readonly grant?: true }> = [
  { key: "sus", label: "Sustained Hits", n: true, grant: true },
  { key: "lethal", label: "Lethal Hits", grant: true },
  { key: "dev", label: "Devastating Wounds", grant: true },
  { key: "lance", label: "Lance", grant: true },
  { key: "tl", label: "Twin-linked", grant: true },
  { key: "ic", label: "Ignores Cover", grant: true },
  { key: "precision", label: "Precision", grant: true },
  { key: "cleave", label: "Cleave", n: true, grant: true },
  { key: "rf", label: "Rapid Fire", n: true, grant: true },
  { key: "melta", label: "Melta", n: true, grant: true },
  { key: "heavy", label: "Heavy", grant: true },
  { key: "blast", label: "Blast", grant: true },
  { key: "torrent", label: "Torrent", grant: true },
  { key: "pistol", label: "Pistol" },
  { key: "indirect", label: "Indirect Fire" },
  { key: "psychic", label: "Psychic" },
  { key: "hazardous", label: "Hazardous" },
  { key: "extra", label: "Extra Attacks" },
  { key: "oneshot", label: "One Shot" }
]

// ---------- Anti-X ----------

export type Anti = NonNullable<WeaponKw["anti"]>

/** A weapon's Anti abilities as keyword → critical wound roll, whichever way they are stored. */
export function antiOf(a: Anti | undefined | null): Record<string, number> {
  if (!a) return {}
  if (!Array.isArray(a)) return { ...(a as Record<string, number>) }
  const [keywords, roll] = a as readonly [string, number]
  // older data could name several keywords at one roll, "MONSTER/VEHICLE"
  return Object.fromEntries(String(keywords).split("/").map((k) => [k.trim().toUpperCase(), roll]))
}

/** Both sets of Anti abilities; where both have a keyword, the better roll. */
export function mergeAnti(a: Anti | undefined | null, b: Anti | undefined | null): Record<string, number> {
  const out = antiOf(a)
  for (const [k, n] of Object.entries(antiOf(b))) out[k] = k in out ? Math.min(out[k], n) : n
  return out
}

/** How Anti abilities are stored: one as a pair, as lists always have; several as a map. */
export function antiValue(m: Record<string, number>): Anti | undefined {
  const entries = Object.entries(m)
  if (!entries.length) return undefined
  return entries.length === 1 ? entries[0] : m
}

export function parseWeaponKeywords(str: unknown): WeaponKw {
  const kw: MutableKw = {}
  const other: Array<string> = []
  const tokens = String(str ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
  for (const t0 of tokens) {
    // "SUSTAINED HITS 1: non-MONSTER/VEHICLE" only applies against (or not against) those keywords
    let t = t0
    let cond: KwCond | null = null
    const ci = t0.indexOf(":")
    if (ci > 0) {
      t = t0.slice(0, ci).trim()
      const c = t0.slice(ci + 1).trim()
      const neg = /^non-/i.test(c)
      const list = c
        .replace(/^non-/i, "")
        .split(/[/,]/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      cond = neg ? { not: list } : { only: list }
    }
    const l = t.toLowerCase()
    const before = new Set(Object.keys(kw))
    let m: RegExpMatchArray | null
    if (l === "assault" || l === "-" || l === "–" || l === "—" || l === "none") continue
    else if (l === "pistol" || l === "close-quarters" || l === "close quarters") kw.pistol = 1
    else if ((m = l.match(/^blast(?: (\d+|d3))?$/))) kw.blast = m[1] ? diceNumber(m[1]) : 1
    else if ((m = l.match(/^cleave (\d+|d3)/))) kw.cleave = diceNumber(m[1])
    else if (l === "one shot") kw.oneshot = 1
    else if ((m = l.match(/^rapid fire (\d+)/))) kw.rf = +m[1]
    else if ((m = l.match(/^sustained hits (\d+|d3)/))) kw.sus = diceNumber(m[1])
    else if (l === "lethal hits") kw.lethal = 1
    else if (l === "devastating wounds") kw.dev = 1
    else if (l === "twin-linked") kw.tl = 1
    else if (l === "torrent") kw.torrent = 1
    else if ((m = l.match(/^melta (\d+)/))) kw.melta = +m[1]
    else if (l === "heavy") kw.heavy = 1
    else if (l === "lance") kw.lance = 1
    else if (l === "ignores cover") kw.ic = 1
    else if (l === "precision") kw.precision = 1
    else if (l === "psychic") kw.psychic = 1
    else if (l === "hazardous") kw.hazardous = 1
    else if (l === "extra attacks") kw.extra = 1
    else if (l === "indirect fire") kw.indirect = 1
    else if ((m = l.match(/^anti-(.+?) (\d)\+$/))) kw.anti = antiValue(mergeAnti(kw.anti, { [m[1].toUpperCase()]: +m[2] }))
    else other.push(t0)
    if (cond) {
      const added = Object.keys(kw).filter((k) => !before.has(k))
      if (added.length) {
        kw.when = kw.when || {}
        for (const k of added) kw.when[k] = cond
      }
    }
  }
  if (other.length) kw.other = other
  return kw
}

/** A characteristic that may be a number or dice (`"D6+1"`). */
export const parseDice = (v: unknown): Dice => {
  const s = String(v ?? "").trim().toUpperCase()
  return /D/.test(s) ? s.replace(/\s+/g, "") : parseFloat(s) || 0
}

/** First integer in a characteristic such as `3+`, `-2`, `6"`. */
export const parseNum = (v: unknown): number => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10)
  return Number.isNaN(n) ? 0 : n
}

/** Weapon abilities as the dossier shows them. */
export function keywordText(w: Pick<Weapon, "kw" | "alt">): string {
  const k = w.kw || {}
  const t: Array<string> = []
  // conditional abilities read like "Lethal Hits (not vs monster/vehicle)"
  const cnd = (key: string) => {
    const c = k.when?.[key]
    if (!c) return ""
    return c.not ? ` (not vs ${c.not.join("/").toLowerCase()})` : ` (vs ${(c.only ?? []).join("/").toLowerCase()})`
  }
  const push = (s: string, key?: string) => t.push(s + (key ? cnd(key) : ""))
  if (k.torrent) push("Torrent")
  if (k.lethal) push("Lethal Hits", "lethal")
  if (k.sus) push(`Sustained ${k.sus}`, "sus")
  if (k.tl) push("Twin-linked", "tl")
  if (k.dev) push("Devastating", "dev")
  if (k.lance) push("Lance", "lance")
  if (k.blast) push(k.blast > 1 ? `Blast ${k.blast}` : "Blast")
  if (k.cleave) push(`Cleave ${k.cleave}`)
  if (k.melta) push(`Melta ${k.melta}`)
  if (k.heavy) push("Heavy")
  if (k.rf) push(`Rapid Fire ${k.rf}`)
  for (const [kw, n] of Object.entries(antiOf(k.anti))) push(`Anti-${kw.toLowerCase()} ${n}+`)
  if (k.pistol) push("Pistol / close-quarters")
  if (k.ic) push("Ignores Cover", "ic")
  if (k.precision) push("Precision", "precision")
  if (k.psychic) push("Psychic")
  if (k.extra) push("Extra Attacks")
  if (k.oneshot) push("One Shot")
  if (k.hazardous) push("Hazardous")
  if (k.indirect) push("Indirect Fire")
  if (k.other) t.push(...k.other)
  if (w.alt) push(isMeleeChoice(w.alt) ? "one melee weapon per model" : "pick one profile")
  return t.join(", ")
}

const FLAGS = ["torrent", "lethal", "tl", "dev", "lance", "blast", "heavy", "pistol", "ic", "precision", "psychic", "extra"] as const

/** The compact form typed into the loadout editor: `lethal sus1 melta2 anti-infantry2`. */
export function keywordsToInput(k: WeaponKw | undefined): string {
  if (!k) return ""
  const t: Array<string> = []
  for (const x of FLAGS) if (k[x]) t.push(x)
  if (k.sus) t.push("sus" + k.sus)
  if (k.melta) t.push("melta" + k.melta)
  if (k.rf) t.push("rf" + k.rf)
  if (k.cleave) t.push("cleave" + k.cleave)
  for (const [kw, n] of Object.entries(antiOf(k.anti))) t.push(`anti-${kw.toLowerCase()}${n}`)
  return t.join(" ")
}

export function keywordsFromInput(s: string): WeaponKw {
  const k: MutableKw = {}
  for (let tok of String(s).toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    tok = tok
      .replace(/twin-?linked/, "tl")
      .replace(/^ignores?-?cover$/, "ic")
      .replace(/^devastating$/, "dev")
      .replace(/\+$/, "")
    let m: RegExpMatchArray | null
    if ((m = tok.match(/^(sus|sustained)(\d)$/))) k.sus = +m[2]
    else if ((m = tok.match(/^melta(\d)$/))) k.melta = +m[1]
    else if ((m = tok.match(/^(rf|rapidfire)(\d)$/))) k.rf = +m[2]
    else if ((m = tok.match(/^cleave(\d)$/))) k.cleave = +m[1]
    else if ((m = tok.match(/^anti-([a-z/]+?)(\d)$/))) k.anti = antiValue(mergeAnti(k.anti, [m[1].toUpperCase(), +m[2]]))
    else if ((FLAGS as ReadonlyArray<string>).includes(tok)) (k as Record<string, number>)[tok] = 1
  }
  return k
}
