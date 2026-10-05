/**
 * What the importer looks things up in: the rules library, the seeded army and
 * detachment rules, and the wargear swaps on the current Wahapedia export's
 * datasheets. Importing a list, its review and "read the file again" all build
 * it here, so they read a roster the same way.
 */
import { Effect, Option } from "effect"
import { Rules } from "../repos/Rules"
import { seedData } from "../seed/Seed"
import { currentSnapshotId } from "../wahapedia/queries"
import { type Swap, swapsFor, wargearSwaps } from "../wahapedia/swaps"
import type { ImportContext } from "./roster"

export const importContext = Effect.gen(function*() {
  const library = yield* (yield* Rules).book
  const snapshot = Option.getOrUndefined(yield* currentSnapshotId)
  const swaps: ReadonlyMap<string, ReadonlyArray<Swap>> = snapshot === undefined ? new Map() : yield* wargearSwaps(snapshot)
  return {
    library,
    factionArmyRules: seedData.factionArmyRules,
    detachmentRules: seedData.detachmentRules,
    detachmentUnitGrants: seedData.detachmentUnitGrants,
    swaps: (unitName: string) => swapsFor(swaps, unitName)
  } satisfies ImportContext
})
