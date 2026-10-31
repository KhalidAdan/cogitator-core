/**
 * Weapons a datasheet lists twice under one name, once ranged and once melee.
 *
 * 40k.app's roster files keep only one of the two. Arjac Rockfist comes through
 * with the ranged Foehammer and no melee one, Custodian Guard with the melee
 * Guardian Spear and no ranged one, and nothing says which it will be. A model
 * with such a weapon has both rows, so the importer adds the one that's missing.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { memo } from "../memo"
import { toEngine, TYPE_SUFFIX, weaponKey } from "./check"
import { wargearProfile, type WargearProfile } from "./queries"

export interface Twin {
  /** The datasheet's name for the weapon. */
  readonly name: string
  readonly r: ReturnType<typeof toEngine>
  readonly m: ReturnType<typeof toEngine>
}

/** A weapon's name for matching: rows a roster split by type ("Guardian spear - ranged") are the datasheet's one name. */
export const twinKey = (name: string): string => weaponKey(name.replace(TYPE_SUFFIX, ""))

/** Every datasheet's twin weapons, by datasheet id and then `twinKey`. */
export const weaponTwins = (snapshotId: number) =>
  memo(
    "weaponTwins",
    snapshotId,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<Record<string, string>>`
        SELECT * FROM wh_datasheet_wargear WHERE snapshot_id = ${snapshotId} ORDER BY row_num
      `.pipe(Effect.orDie)
      const sheets = new Map<string, Map<string, { r?: WargearProfile; m?: WargearProfile }>>()
      for (const row of rows) {
        const w = wargearProfile(row)
        const weapons = sheets.get(row.datasheet_id) ?? new Map<string, { r?: WargearProfile; m?: WargearProfile }>()
        sheets.set(row.datasheet_id, weapons)
        const pair = weapons.get(twinKey(w.name)) ?? {}
        weapons.set(twinKey(w.name), pair)
        // a weapon's first row of each type; the export repeats some rows exactly
        if (w.type === "Melee") pair.m ??= w
        else pair.r ??= w
      }
      const out = new Map<string, ReadonlyMap<string, Twin>>()
      for (const [id, weapons] of sheets) {
        const twins = new Map<string, Twin>()
        for (const [key, { r, m }] of weapons) {
          if (r && m) twins.set(key, { name: r.name, r: toEngine(r), m: toEngine(m) })
        }
        if (twins.size) out.set(id, twins)
      }
      return out
    }),
    2
  )
