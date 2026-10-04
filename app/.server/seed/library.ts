/**
 * Rules added to the library since the POC's set, seeded alongside it.
 *
 * The POC's library (poc-seed.json) covers Aeldari and Space Marines. These
 * are translations made in this app, kept as code so that a fresh database has
 * them too. Like every seeded rule they are only inserted where missing, so
 * edits made in the rules library are never overwritten.
 *
 * They are seeded as drafts: each was translated from wording that matches
 * Wahapedia's text exactly, but nobody has reviewed the translation yet.
 */
import type { Rule, RuleStatus } from "~/domain/schema"

export interface LibraryRule {
  readonly id: string
  readonly faction: string
  readonly status: RuleStatus
  readonly rule: Rule
}

/** A condition several Chaos Space Marines rules share. */
const DARK_PACT = {
  cond: "darkpact",
  condNm: "Made a Dark Pact this phase",
  condTxt:
    "For rules that trigger on a Dark Pact, like Despoilers. The pact’s own Lethal Hits or Sustained Hits 1 isn’t added by this switch; set that in the modifier bar."
} as const

export const LIBRARY_RULES: ReadonlyArray<LibraryRule> = [
  // ---------- Chaos Space Marines (2 October 2026, from "The Citadel Moves")
  {
    id: "despoilers",
    faction: "CSM",
    status: "draft",
    rule: {
      nm: "Despoilers",
      src: "Datasheet",
      scope: "unit",
      dmg: true,
      def: true,
      ...DARK_PACT,
      txt: "After the unit makes a Dark Pact, its attacks can re-roll the hit roll until the end of the phase. A leader in the unit benefits too.",
      fx: [{ when: "darkpact", rrHit: "all" }]
    }
  },
  {
    id: "daemonforge",
    faction: "CSM",
    status: "draft",
    rule: {
      nm: "Daemonforge",
      src: "Datasheet",
      dmg: true,
      def: true,
      ...DARK_PACT,
      txt: "After this unit makes a Dark Pact, the model’s attacks re-roll wound rolls of 1 until the end of the phase.",
      fx: [{ when: "darkpact", rrWound: "ones" }]
    }
  },
  {
    id: "stabilisation-talons",
    faction: "CSM",
    status: "draft",
    rule: {
      nm: "Stabilisation Talons",
      src: "Datasheet",
      scope: "unit",
      dmg: true,
      def: true,
      txt: "Ranged attacks ignore modifiers to the hit roll and to Ballistic Skill, so a −1 to hit or the cover penalty doesn’t apply. It only shows when one of those is set in the modifier bar.",
      fx: [{ phase: "ranged", ignoreHitPenalty: true }]
    }
  },
  {
    id: "master-of-mechanisms",
    faction: "CSM",
    status: "draft",
    rule: {
      nm: "Master of Mechanisms",
      src: "Datasheet",
      dmg: true,
      mark: "mechanisms",
      markNm: "Tended by the Warpsmith",
      markTxt: "Master of Mechanisms: +1 to hit for the Vehicle he chose.",
      global: true,
      txt: "In your Command phase the Warpsmith picks one friendly Heretic Astartes Vehicle within 3\": it regains up to D3 wounds and adds 1 to its hit rolls until your next Command phase. He can only pick one, so with the switch on the matrix shows each Vehicle as if it were the one chosen.",
      fx: [{ attacker: { only: ["VEHICLE"] }, hit: 1 }]
    }
  },
  {
    id: "headlong-destruction",
    faction: "CSM",
    status: "draft",
    rule: {
      nm: "Headlong Destruction",
      src: "Datasheet",
      scope: "unit",
      dmg: true,
      def: true,
      cond: "closest",
      condNm: "Target is the closest enemy unit",
      condTxt: "For rules that reward attacking whatever is nearest, like Headlong Destruction.",
      txt: "Attacks that target the closest eligible enemy unit get +1 AP. The whole attached unit benefits.",
      fx: [{ when: "closest", ap: 1 }]
    }
  },
  {
    id: "architect-of-ruin",
    faction: "CSM",
    status: "draft",
    rule: {
      nm: "Architect of Ruin",
      src: "Datasheet",
      dmg: true,
      mark: "hatedfoe",
      markNm: "Hated foe",
      markTxt: "Architect of Ruin: Kravek Morne re-rolls wounds against it.",
      txt: "At the start of the battle, pick one enemy unit as this model’s hated foe: its own attacks against that unit can re-roll the wound roll. When the hated foe is destroyed it picks another.",
      fx: [{ rrWound: "all" }]
    }
  },

  // ---------- Adeptus Custodes (2 October 2026, from "Ten Thousand and No More")
  {
    id: "stand-vigil",
    faction: "AC",
    status: "draft",
    rule: {
      nm: "Stand Vigil",
      src: "Datasheet",
      scope: "unit",
      dmg: true,
      def: true,
      txt: "Re-roll wound rolls of 1. While the unit is within range of an objective you control, re-roll the whole wound roll instead (switch “Your unit is on an objective”).",
      fx: [
        { whenNot: "selfObj", rrWound: "ones" },
        { when: "selfObj", rrWound: "all" }
      ]
    }
  },
  {
    id: "captain-general",
    faction: "AC",
    status: "draft",
    rule: {
      nm: "Captain-General",
      src: "Leader",
      scope: "unit",
      dmg: true,
      def: true,
      txt: "While this model leads a unit, its attacks ignore modifiers to the hit roll and to Ballistic or Weapon Skill, so a −1 to hit or the cover penalty doesn’t apply. It only shows when one of those is set in the modifier bar.",
      fx: [{ ignoreHitPenalty: true }]
    }
  },
  {
    id: "purity-of-execution",
    faction: "AC",
    status: "draft",
    rule: {
      nm: "Purity of Execution",
      src: "Datasheet",
      scope: "unit",
      dmg: true,
      def: true,
      txt: "Ranged attacks that target a Psyker unit gain Precision and Devastating Wounds. None of the default benchmark targets is a Psyker; add PSYKER to a target’s keywords on its page to see this.",
      fx: [{ phase: "ranged", vs: { only: ["PSYKER"] }, grant: { dev: 1, precision: 1 } }]
    }
  },

  // ---------- Astra Militarum (4 October 2026, from "By Writ of the Lord Solar!")
  {
    id: "daring-recon",
    faction: "AM",
    status: "draft",
    rule: {
      nm: "Daring Recon",
      src: "Datasheet",
      dmg: true,
      mark: "recon",
      markNm: "Spotted by the Scout Sentinels",
      markTxt: "Daring Recon: your ranged attacks against it re-roll hit rolls of 1.",
      global: true,
      txt: "At the start of your Shooting phase the Scout Sentinels pick one enemy unit within 18\" and visible to them. Until the end of the phase, every Astra Militarum attack against it re-rolls hit rolls of 1: ranged attacks, since it lasts only the Shooting phase.",
      fx: [{ phase: "ranged", rrHit: "ones" }]
    }
  },
  {
    // The Heavy Mortar Team's version gives Sustained Hits 1 to all its ranged weapons, and its only one is the Heavy mortar.
    id: "rearm-reload-fire",
    faction: "AM",
    status: "draft",
    rule: {
      nm: "Rearm, Reload, Fire",
      src: "Datasheet",
      dmg: true,
      def: true,
      cond: "order",
      condNm: "Under an Order",
      condTxt: "For rules that work while a unit is affected by an Order, like Rearm, Reload, Fire. The Orders themselves (Take Aim!, Fix Bayonets!…) aren’t added by this switch.",
      txt: "While the unit is affected by an Order and Remained Stationary this turn, its Heavy weapons have Sustained Hits 1. It needs both switches: “Under an Order” and “Remained stationary”.",
      fx: [{ when: "stationary", phase: "ranged", weaponKw: "heavy", grant: { sus: 1 } }]
    }
  }
]
