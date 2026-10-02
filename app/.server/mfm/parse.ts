/**
 * Parse a Munitorum Field Manual faction page into points.
 *
 * The input is the page's text in reading order (see flight.ts). The parser
 * goes by what a reader sees, not by markup or class names:
 *
 *   FIRE DRAGONS  ▼
 *   YOUR 1ST TO 2ND UNITS COST   5 models  ▼ (-10) 110 pts   10 models  240 pts
 *   YOUR 3RD + UNIT COSTS        5 models  ▼ (-10) 120 pts   10 models  250 pts
 *
 *   CORSAIR COTERIE  2DP  PRIORITY ASSETS  ENHANCEMENTS  Archraider  35 pts  …
 *
 * A unit is a name followed by a "YOUR … COST" header; a detachment is a name
 * followed by its detachment points. If Games Workshop restyles the page this
 * keeps working; if they reword it, `parseFieldManual` fails loudly rather
 * than returning half a faction.
 */
import { Effect, Schema } from "effect"
import { pageTokens } from "./flight"

export class FieldManualParseError extends Schema.TaggedError<FieldManualParseError>()("FieldManualParseError", {
  message: Schema.String
}) {}

export const ManualCost = Schema.Struct({
  /** `YOUR 1ST TO 2ND UNITS COST`, or empty when the unit has one price list. */
  tier: Schema.String,
  /** `5 models`, `per Storm Shield`… */
  description: Schema.String,
  cost: Schema.Number,
  /** The change the page itself marks against the previous version, if any. */
  delta: Schema.NullOr(Schema.Number)
})
export type ManualCost = typeof ManualCost.Type

export const ManualUnit = Schema.Struct({
  name: Schema.String,
  /** Sub-heading the unit is listed under (a chapter, `HARLEQUINS`…), or empty. */
  section: Schema.String,
  costs: Schema.Array(ManualCost),
  wargear: Schema.Array(ManualCost),
  /** Units it can lead or support, as listed. */
  attach: Schema.NullOr(Schema.Struct({ kind: Schema.String, units: Schema.Array(Schema.String) })),
  notes: Schema.Array(Schema.String)
})
export type ManualUnit = typeof ManualUnit.Type

export const ManualDetachment = Schema.Struct({
  name: Schema.String,
  dp: Schema.Number,
  dispositions: Schema.Array(Schema.String),
  unique: Schema.NullOr(Schema.String),
  enhancements: Schema.Array(Schema.Struct({ name: Schema.String, cost: Schema.Number, delta: Schema.NullOr(Schema.Number) })),
  notes: Schema.Array(Schema.String)
})
export type ManualDetachment = typeof ManualDetachment.Type

export const FieldManual = Schema.Struct({
  faction: Schema.String,
  version: Schema.String,
  units: Schema.Array(ManualUnit),
  detachments: Schema.Array(ManualDetachment)
})
export type FieldManual = typeof FieldManual.Type

const HEADER = /^YOUR .*COSTS?$/
const ARROW = /^[▲▼]+$/
const DP = /^(\d+)DP\b/
const PRICE = /^(?:[▲▼]\s*\(([+-]\d+)\)\s*)?([\d,]+)\s*pts$/
const VERSION = /^v\d+(\.\d+)*$/
/** Change notes are phrased as something having happened. */
const NOTE = /(?:UPDATED|REMOVED|CHANGED|ADDED|INCREASED|DECREASED|REDUCED|REPLACED|RENAMED)$/

const isHeader = (t: string | undefined) => !!t && HEADER.test(t)
const isArrow = (t: string | undefined) => !!t && ARROW.test(t)
const price = (t: string | undefined) => {
  const m = t ? PRICE.exec(t) : null
  return m ? { cost: +m[2].replace(/,/g, ""), delta: m[1] ? +m[1] : null } : null
}

/** `YOUR UNIT COSTS` is the plain case; anything else names a tier. */
const tierOf = (header: string) => (/^YOUR UNITS? COSTS?$/.test(header) ? "" : header)

export function parseFieldManualTokens(tokens: ReadonlyArray<string>): FieldManual {
  const startsUnit = (i: number) => isHeader(tokens[i + 1]) || (isArrow(tokens[i + 1]) && isHeader(tokens[i + 2]))
  const startsDetachment = (i: number) => DP.test(tokens[i + 1] ?? "")
  const startsEntry = (i: number) => startsUnit(i) || startsDetachment(i)

  const v = tokens.findIndex((t) => VERSION.test(t))
  const version = v >= 0 ? tokens[v] : ""
  const faction = v > 0 && tokens[v - 1] === tokens[v - 1].toUpperCase() && !tokens[v - 1].startsWith("_") ? tokens[v - 1] : ""

  /** Pairs of (description, price) from `j` on; returns where they stop. */
  const pairs = (j: number, tier: string, into: Array<ManualCost>) => {
    while (j + 1 < tokens.length && !isHeader(tokens[j]) && !startsEntry(j)) {
      const p = price(tokens[j + 1])
      if (!p) break
      into.push({ tier, description: tokens[j], ...p })
      j += 2
    }
    return j
  }
  /**
   * After `UPDATED`: one note, then any further tokens that read like notes
   * ("BODYGUARD UNITS UPDATED", "REQUISITION THRESHOLDS REMOVED"). A token that
   * doesn't is left alone, because it may be the heading of the next group of units.
   */
  const notesFrom = (j: number, into: Array<string>) => {
    if (j < tokens.length && !startsEntry(j)) into.push(tokens[j++])
    while (j < tokens.length && !startsEntry(j) && NOTE.test(tokens[j])) into.push(tokens[j++])
    return j
  }

  const units: Array<ManualUnit> = []
  const detachments: Array<ManualDetachment> = []
  let section = ""
  let i = 0
  while (i < tokens.length) {
    if (startsUnit(i)) {
      const name = tokens[i]
      const costs: Array<ManualCost> = []
      const wargear: Array<ManualCost> = []
      const notes: Array<string> = []
      let attach: ManualUnit["attach"] = null
      let j = i + (isArrow(tokens[i + 1]) ? 2 : 1)
      for (;;) {
        const t = tokens[j]
        if (isHeader(t)) j = pairs(j + 1, tierOf(t), costs)
        else if (t === "WARGEAR OPTIONS") j = pairs(j + 1, "", wargear)
        else if ((t === "LEADER" || t === "SUPPORT") && tokens[j + 1] !== undefined && !startsEntry(j + 1)) {
          attach = { kind: t, units: tokens[j + 1].split(",").map((s) => s.trim()).filter(Boolean) }
          j += 2
        } else if (t === "LEADER" || t === "SUPPORT") j++
        else if (t === "UPDATED") j = notesFrom(j + 1, notes)
        else break
      }
      if (!costs.length) throw new FieldManualParseError({ message: `Found the unit “${name}” but no price under it. The Field Manual’s layout has changed.` })
      units.push({ name, section, costs, wargear, attach, notes })
      i = j
    } else if (startsDetachment(i)) {
      const name = tokens[i]
      const dp = +DP.exec(tokens[i + 1])![1]
      let j = i + 2
      if (isArrow(tokens[j])) j++
      const dispositions: Array<string> = []
      let unique: string | null = null
      while (j < tokens.length && tokens[j] !== "ENHANCEMENTS" && tokens[j] !== "UPDATED" && !startsEntry(j) && j < i + 10) {
        if (/^UNIQUE:/.test(tokens[j])) unique = tokens[j].replace(/^UNIQUE:\s*/, "")
        else dispositions.push(tokens[j])
        j++
      }
      const enh: Array<ManualCost> = []
      if (tokens[j] === "ENHANCEMENTS") j = pairs(j + 1, "", enh)
      const notes: Array<string> = []
      if (tokens[j] === "UPDATED") j = notesFrom(j + 1, notes)
      detachments.push({ name, dp, dispositions, unique, enhancements: enh.map((e) => ({ name: e.description, cost: e.cost, delta: e.delta })), notes })
      i = j
    } else {
      // a heading over a group of units ("WHITE SCARS"), or page furniture to skip
      if (tokens[i] === "UNITS" || tokens[i] === "DETACHMENTS") section = ""
      else if (startsUnit(i + 1) && tokens[i] === tokens[i].toUpperCase()) section = tokens[i]
      i++
    }
  }

  if (!version || !units.length) {
    throw new FieldManualParseError({
      message: "Couldn’t find any unit prices on that page. Either it isn’t a Field Manual faction page or its format has changed."
    })
  }
  return { faction, version, units, detachments }
}

/** Parse a faction page's HTML. */
export const parseFieldManual = (html: string) =>
  Effect.try({
    try: () => parseFieldManualTokens(pageTokens(html)),
    catch: (e) => (e instanceof FieldManualParseError ? e : new FieldManualParseError({ message: `Couldn’t read the Field Manual page: ${String(e)}` }))
  })
