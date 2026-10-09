/**
 * Coverage by toughness band: the matrix's targets grouped where common
 * weapons change how easily they wound, and how many units in the list really
 * hurt each group. A list wants at least two on every band, so losing one unit
 * doesn't leave a kind of target with no answer.
 *
 * Built from a `Matrix`, so it runs nothing the matrix hasn't already.
 */
import type { AttackResult } from "./engine"
import { EFFICIENT, type Matrix } from "./ledger"
import type { Target, Unit } from "./schema"

export interface Band {
  readonly id: string
  readonly label: string
  /** Highest Toughness in the band; the first band takes everything up to T4. */
  readonly max: number
  /** The band's name in a sentence: "T12 or more". */
  readonly words: string
}

export const BANDS: ReadonlyArray<Band> = [
  { id: "t3-4", label: "T3–4", max: 4, words: "T4 or less" },
  { id: "t5", label: "T5", max: 5, words: "T5" },
  { id: "t6", label: "T6", max: 6, words: "T6" },
  { id: "t7-9", label: "T7–9", max: 9, words: "T7 to T9" },
  { id: "t10-11", label: "T10–11", max: 11, words: "T10 or T11" },
  { id: "t12", label: "T12+", max: Infinity, words: "T12 or more" }
]

export const bandOf = (t: Pick<Target, "T">): Band => BANDS.find((b) => t.T <= b.max)!

/** How many units a band wants that really hurt it. */
export const BAND_MIN = 2

/** Enemy points one activation has to remove for the "removes" test. */
export const PUNCH = 80

/**
 * What hurting a target means:
 * - `removes`: one activation takes at least 80 of its points off the table, or the whole unit when it's worth less;
 * - `return`: the unit earns back at least 65% of its own cost against it, the matrix's efficient line.
 */
export type BandTest = "removes" | "return"

/** Enemy points one activation removes. Overkill never counts here, whatever the matrix's wound cap is set to. */
export const pointsRemoved = (c: AttackResult): number => Math.min(c.total, c.pool) * c.ppw

/** The points the "removes" test asks of a target: 80, or the whole unit when it's worth less. */
export const punchLine = (t: Pick<Target, "pts">): number => Math.max(1, Math.min(PUNCH, t.pts))

/** How far a cell gets towards hurting its target: 1 or more is a hit. Judged by the whole number shown, as the matrix is. */
export function reach(c: AttackResult, t: Target, test: BandTest): number {
  return test === "return" ? Math.round(c.roi) / EFFICIENT : Math.round(pointsRemoved(c)) / punchLine(t)
}

/** A unit covers a band when it hurts at least half its targets: either of two, two of three or four, three of five. */
export const coversBand = (hit: number, of: number): boolean => of > 0 && hit * 2 >= of

export interface BandCell {
  /** For each of the band's targets, in its order: does this unit hurt it? */
  readonly hits: ReadonlyArray<boolean>
  readonly covers: boolean
  /** Index into the band's targets of the one this unit does best into. */
  readonly best: number
  /** Sum over the band's targets of how close each comes to a hit (each at most 1), to rank near misses. */
  readonly score: number
}

export interface BandColumn {
  readonly band: Band
  readonly targets: ReadonlyArray<Target>
  /** Units that cover the band, in matrix order. */
  readonly units: ReadonlyArray<Unit>
}

export interface BandRow {
  readonly unit: Unit
  /** One per band, in `BANDS` order. */
  readonly cells: ReadonlyArray<BandCell>
}

export interface BandView {
  readonly test: BandTest
  readonly columns: ReadonlyArray<BandColumn>
  readonly rows: ReadonlyArray<BandRow>
}

export function bandView(m: Matrix, test: BandTest): BandView {
  const cols = BANDS.map((band) => ({ band, idx: m.targets.flatMap((t, k) => (bandOf(t) === band ? [k] : [])) }))
  const rows = m.rows.map(
    (r): BandRow => ({
      unit: r.unit,
      cells: cols.map(({ idx }): BandCell => {
        const reaches = idx.map((k) => reach(r.cells[k], m.targets[k], test))
        const hits = reaches.map((x) => x >= 1)
        let best = 0
        reaches.forEach((x, i) => {
          if (x > reaches[best]) best = i
        })
        return {
          hits,
          covers: coversBand(hits.filter(Boolean).length, idx.length),
          best,
          score: reaches.reduce((s, x) => s + Math.min(1, x), 0)
        }
      })
    })
  )
  return {
    test,
    columns: cols.map(({ band, idx }, j) => ({
      band,
      targets: idx.map((k) => m.targets[k]),
      units: rows.filter((r) => r.cells[j].covers).map((r) => r.unit)
    })),
    rows
  }
}

export type BandNote =
  /** No benchmark target in the band. */
  | { readonly kind: "empty"; readonly band: Band }
  /** Fewer than `BAND_MIN` units cover it; `closest` is the best of the rest. */
  | {
      readonly kind: "thin"
      readonly band: Band
      readonly units: ReadonlyArray<Unit>
      readonly closest: { readonly unit: Unit; readonly hit: number; readonly of: number } | null
    }
  /** Judged on a single target. */
  | { readonly kind: "single"; readonly band: Band; readonly target: Target }
  /** Every band with targets has at least `BAND_MIN`; `thinnest` has the fewest. */
  | { readonly kind: "covered"; readonly thinnest: Band; readonly count: number }

/** What's worth saying under the band table: thin bands first, then bands the benchmarks can't judge well. */
export function bandNotes(v: BandView): Array<BandNote> {
  const thin: Array<BandNote> = []
  const weak: Array<BandNote> = []
  v.columns.forEach((c, j) => {
    if (!c.targets.length) {
      weak.push({ kind: "empty", band: c.band })
      return
    }
    if (c.units.length < BAND_MIN) {
      const rest = v.rows
        .filter((r) => !r.cells[j].covers)
        .map((r) => ({ unit: r.unit, hit: r.cells[j].hits.filter(Boolean).length, score: r.cells[j].score }))
        .sort((a, b) => b.hit - a.hit || b.score - a.score)
      const near = rest[0]
      thin.push({ kind: "thin", band: c.band, units: c.units, closest: near ? { unit: near.unit, hit: near.hit, of: c.targets.length } : null })
    }
    if (c.targets.length === 1) weak.push({ kind: "single", band: c.band, target: c.targets[0] })
  })
  const judged = v.columns.filter((c) => c.targets.length)
  if (!thin.length && judged.length) {
    const fewest = judged.reduce((a, b) => (b.units.length < a.units.length ? b : a))
    thin.push({ kind: "covered", thinnest: fewest.band, count: fewest.units.length })
  }
  return [...thin, ...weak]
}
