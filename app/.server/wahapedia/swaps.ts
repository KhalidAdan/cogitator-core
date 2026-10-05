/**
 * Which weapons a wargear option takes away, read from Wahapedia's option lines.
 *
 * 40k.app's roster files keep the weapon a model gave up for an option: its
 * Rubric Marine with a soulreaper cannon still carries the inferno boltgun the
 * cannon replaced, so the squad shoots one gun too many. A datasheet's options
 * say what replaces what ("1 Rubric Marine's inferno boltgun can be replaced
 * with 1 soulreaper cannon"), which tells a swap apart from an addition ("can
 * be equipped with 1 Astartes grenade launcher"). The importer uses them to
 * drop the replaced weapon from a model that took the option.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { norm, stripHtml } from "~/domain/text"
import { memo } from "../memo"

export interface Swap {
  /** Weapons given up, as `weaponKey`s: some options take two ("combi-bolter and accursed weapon"), some either ("power sword or shuriken rifle"). */
  readonly from: ReadonlyArray<string>
  /** What can take their place: each choice is one or more weapons. */
  readonly to: ReadonlyArray<ReadonlyArray<string>>
}

/** A weapon's name for matching: the profile ("Plasma gun - supercharge") and any count ("1 plasma gun") left out. */
export const weaponKey = (name: string): string => norm(name.split(" - ")[0].replace(/[*.]/g, "")).replace(/^\d+ /, "")

const weaponsIn = (s: string, joiners: RegExp) =>
  s
    .replace(/\(.*?\)/g, "")
    .split(joiners)
    .map(weaponKey)
    .filter(Boolean)

/** One option line (HTML as Wahapedia has it), or null when it doesn't replace anything. */
export function parseSwap(html: string): Swap | null {
  const listed = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => stripHtml(m[1]))
  const head = stripHtml(html.replace(/<ul[\s\S]*$/i, "")).replace(/\s+/g, " ").trim()
  const m = head.match(/(?:’s|'s|\btheir|\bits)\s+(.+?)\s+(?:can be |is )?replaced with\s*(.*)$/i)
  if (!m) return null
  const from = weaponsIn(m[1], /\s+(?:and|or)\s+|,\s*/)
  const rest = m[2].replace(/one of the following:?/i, "")
  const to = (listed.length ? listed : [rest]).map((c) => weaponsIn(c, /\s+and\s+/)).filter((c) => c.length)
  return from.length && to.length ? { from, to } : null
}

/** Every datasheet's swaps, by normalised datasheet name; datasheets sharing a name share their options. */
export const wargearSwaps = (snapshotId: number) =>
  memo(
    "wargearSwaps",
    snapshotId,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ name: string; description: string }>`
        SELECT d.name AS name, o.description AS description
        FROM wh_datasheet_options o
        JOIN wh_datasheets d ON d.snapshot_id = o.snapshot_id AND d.id = o.datasheet_id
        WHERE o.snapshot_id = ${snapshotId}
      `.pipe(Effect.orDie)
      const out = new Map<string, Array<Swap>>()
      for (const r of rows) {
        const swap = parseSwap(r.description ?? "")
        if (!swap) continue
        const key = norm(r.name)
        const list = out.get(key) ?? []
        if (!list.some((s) => JSON.stringify(s) === JSON.stringify(swap))) list.push(swap)
        out.set(key, list)
      }
      return out
    }),
    2
  )

/**
 * The swaps for a unit as a roster names it. 40k.app adds a letter to repeated units ("Rubric Marines A"), and a
 * datasheet the export doesn't have under that name may have it under a shorter one ("Eradicator Squad with melta
 * rifles" is Wahapedia's "Eradicator Squad").
 */
export function swapsFor(all: ReadonlyMap<string, ReadonlyArray<Swap>>, unitName: string): ReadonlyArray<Swap> {
  let key = norm(unitName.replace(/\s+[A-Z]$/, ""))
  for (;;) {
    const found = all.get(key)
    if (found) return found
    const cut = key.lastIndexOf(" with ")
    if (cut < 0) return []
    key = key.slice(0, cut)
  }
}
