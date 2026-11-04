/**
 * Weapons an enhancement gives its bearer: "Warboss model only. This model has
 * the following weapon:", and then a weapon table.
 *
 * Neither thing the importer reads has the table. 40k.app's roster files keep
 * the enhancement's text up to that colon and no weapon, and Wahapedia's export
 * cuts the enhancement's description at the same place. Only Wahapedia's
 * faction pages show it, so the profiles are kept here, copied from those pages
 * on 4 November 2026 and written the way the export writes wargear. The
 * importer adds the weapon to the bearer, and the check page counts it as on
 * the bearer's datasheet.
 *
 * `tests/rosters.test.ts` reads the downloaded export for every enhancement that
 * gives a weapon this way, so a new one shows up there. One without a profile
 * here still imports, with a warning that its weapon isn't counted.
 */
import { norm } from "~/domain/text"
import type { WargearProfile } from "./queries"

export interface EnhancementWeapon {
  /** Wahapedia's faction id. */
  readonly faction: string
  readonly detachment: string
  readonly enhancement: string
  readonly weapon: WargearProfile
}

export const ENHANCEMENT_WEAPONS: ReadonlyArray<EnhancementWeapon> = [
  {
    faction: "ORK",
    detachment: "Brute Bosses",
    enhancement: "Da Gobshot Thunderbuss",
    weapon: {
      name: "Da Gobshot Thunderbuss",
      type: "Ranged",
      range: "24",
      A: "6",
      skill: "4+",
      S: "7",
      AP: "-2",
      D: "2",
      abilities: "LETHAL HITS: non-MONSTER/VEHICLE, RAPID FIRE 6"
    }
  },
  {
    faction: "ORK",
    detachment: "Wurrband",
    enhancement: "Da Krunch",
    weapon: { name: "Da Krunch", type: "Ranged", range: "24", A: "3", skill: "4+", S: "5", AP: "-1", D: "1", abilities: "BLAST 3, HAZARDOUS, LETHAL HITS, PSYCHIC" }
  },
  {
    faction: "ORK",
    detachment: "Wurrband",
    enhancement: "'Eadbanger",
    weapon: { name: "'Eadbanger", type: "Ranged", range: "24", A: "2", skill: "4+", S: "6", AP: "-3", D: "3", abilities: "HAZARDOUS, PRECISION, PSYCHIC" }
  },
  {
    faction: "AC",
    detachment: "Emissaries Imperatus",
    enhancement: "Auriferous Orb",
    weapon: {
      name: "Auriferous Orb",
      type: "Ranged",
      range: "12",
      A: "3",
      skill: "2+",
      S: "1",
      AP: "0",
      D: "1",
      abilities: "ANTI-non-MONSTER/VEHICLE 2+, BLINDING LIGHT, DEVASTATING WOUNDS"
    }
  },
  {
    faction: "AC",
    detachment: "Guardians of the Throne",
    enhancement: "Emperor's Light",
    weapon: { name: "Emperor's Light", type: "Melee", range: "Melee", A: "3", skill: "2+", S: "5", AP: "-2", D: "2", abilities: "EXTRA ATTACKS" }
  },
  {
    faction: "SM",
    detachment: "Black Spear Task Force",
    enhancement: "The Thief of Secrets",
    weapon: { name: "The Thief of Secrets", type: "Melee", range: "Melee", A: "6", skill: "2+", S: "6", AP: "-3", D: "2", abilities: "" }
  },
  {
    faction: "SM",
    detachment: "Assault Brethren",
    enhancement: "Imperium's Sword",
    weapon: { name: "Imperium's Sword", type: "Melee", range: "Melee", A: "6", skill: "2+", S: "7", AP: "-3", D: "3", abilities: "" }
  }
]

const byName = new Map(ENHANCEMENT_WEAPONS.map((e) => [norm(e.enhancement), e.weapon]))

/** The weapon an enhancement gives, by the enhancement's name. */
export const enhancementWeapon = (enhancement: string): WargearProfile | undefined => byName.get(norm(enhancement))
