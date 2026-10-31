/**
 * What the importer looks things up in: the rules library, the seeded army and
 * detachment rules, and the wargear swaps and twin weapons on the current
 * Wahapedia export's datasheets. Importing a list, its review and "read the
 * file again" all build it here, so they read a roster the same way.
 */
import { Effect, Option } from "effect"
import { Rules } from "../repos/Rules"
import { seedData } from "../seed/Seed"
import { datasheetIndex, factionIdFor, pickDatasheet } from "../wahapedia/check"
import { allDatasheets, currentSnapshotId } from "../wahapedia/queries"
import { type Swap, swapsFor, wargearSwaps } from "../wahapedia/swaps"
import { type Twin, twinKey, weaponTwins } from "../wahapedia/twins"
import type { ImportContext } from "./roster"

export const importContext = Effect.gen(function*() {
  const library = yield* (yield* Rules).book
  const snapshot = Option.getOrUndefined(yield* currentSnapshotId)
  const swaps: ReadonlyMap<string, ReadonlyArray<Swap>> = snapshot === undefined ? new Map() : yield* wargearSwaps(snapshot)
  const sheets = snapshot === undefined ? [] : yield* allDatasheets(snapshot)
  const index = snapshot === undefined ? new Map() : yield* datasheetIndex(snapshot, sheets)
  const twins: ReadonlyMap<string, ReadonlyMap<string, Twin>> = snapshot === undefined ? new Map() : yield* weaponTwins(snapshot)
  return {
    library,
    factionArmyRules: seedData.factionArmyRules,
    detachmentRules: seedData.detachmentRules,
    detachmentUnitGrants: seedData.detachmentUnitGrants,
    swaps: (unitName: string) => swapsFor(swaps, unitName),
    twin: (unitName: string, faction: string, weapon: string) => {
      const sheet = pickDatasheet({ nm: unitName }, index, factionIdFor(faction, sheets)).pick
      return sheet ? twins.get(sheet.id)?.get(twinKey(weapon)) : undefined
    }
  } satisfies ImportContext
})
