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
      condTxt: "Give the unit an Order in the modifier bar.",
      txt: "While the unit is under an Order and Remained Stationary this turn, its Heavy weapons have Sustained Hits 1. Give it an Order in the modifier bar and switch on “Remained stationary”.",
      fx: [{ when: "stationary", phase: "ranged", weaponKw: "heavy", grant: { sus: 1 } }]
    }
  },
  {
    id: "voice-of-command",
    faction: "AM",
    status: "draft",
    rule: {
      nm: "Voice of Command",
      src: "Datasheet",
      dmg: false,
      txt: "Officers issue Orders to eligible units within 6\": each lasts until your next Command phase, one at a time per unit, and ends if the unit is Battle-shocked. Give a unit its Order in the modifier bar; the Officer’s datasheet says how many it can issue and to whom, which the app leaves to you.",
      orders: ["take-aim", "first-rank-fire", "fix-bayonets", "move-move-move", "take-cover", "duty-and-honour"]
    }
  },

  // ---------- Thousand Sons (5 October 2026, from "The Fifteenth Grievance")
  {
    id: "bringers-of-change",
    faction: "TS",
    status: "draft",
    rule: {
      nm: "Bringers of Change",
      src: "Datasheet",
      scope: "unit",
      dmg: true,
      def: true,
      txt: "Ranged attacks re-roll wound rolls of 1. Against a unit within range of an objective you don’t control, they re-roll the whole wound roll instead (switch “Target is on an objective”). A leader in the unit benefits too.",
      fx: [
        { phase: "ranged", whenNot: "objective", rrWound: "ones" },
        { phase: "ranged", when: "objective", rrWound: "all" }
      ]
    }
  },
  {
    id: "malefic-maelstrom",
    faction: "TS",
    status: "draft",
    rule: {
      nm: "Malefic Maelstrom",
      src: "Leader",
      scope: "unit",
      dmg: true,
      def: true,
      txt: "While this model leads a unit, weapons in that unit (its own included) have Sustained Hits 1.",
      fx: [{ grant: { sus: 1 } }]
    }
  },
  {
    id: "empyric-guidance",
    faction: "TS",
    status: "draft",
    rule: {
      nm: "Empyric Guidance",
      src: "Leader",
      scope: "unit",
      dmg: true,
      def: true,
      txt: "While this model leads a unit, weapons in that unit (its own included) have Lethal Hits.",
      fx: [{ grant: { lethal: 1 } }]
    }
  },
  {
    id: "marked-by-fate",
    faction: "TS",
    status: "draft",
    rule: {
      nm: "Marked by Fate",
      src: "Leader",
      scope: "unit",
      dmg: true,
      mark: "fated",
      markNm: "Marked by Fate",
      markTxt: "Marked by Fate: the Sorcerer’s unit adds 1 to ranged hit rolls against it.",
      txt: "At the start of your Shooting phase this Psyker picks one enemy unit it can see. Until the end of the phase, attacks by models in its unit against that enemy add 1 to the hit roll: ranged attacks, since it lasts only the Shooting phase.",
      fx: [{ phase: "ranged", hit: 1 }]
    }
  },
  {
    id: "lord-of-the-rubricae",
    faction: "TS",
    status: "draft",
    rule: {
      nm: "Lord of the Rubricae",
      src: "Enhancement",
      scope: "unit",
      dmg: true,
      def: true,
      txt: "While the bearer leads a unit, Rubricae models in it add 1 to their hit rolls. The bearer himself isn’t Rubricae, so his own attacks don’t.",
      fx: [{ attacker: { only: ["RUBRICAE"] }, hit: 1 }]
    }
  },

  ...order("take-aim", "Take Aim!", "Improve the Ballistic Skill of the unit’s ranged weapons by 1.", [{ phase: "ranged", skill: 1 }]),
  ...order(
    "first-rank-fire",
    "First Rank, Fire! Second Rank, Fire!",
    "Improve the Attacks of the unit’s Rapid Fire weapons by 1.",
    [{ phase: "ranged", weaponKw: "rf", a: 1 }]
  ),
  ...order("fix-bayonets", "Fix Bayonets!", "Improve the Weapon Skill of the unit’s melee weapons by 1.", [{ phase: "melee", skill: 1 }]),
  ...order("move-move-move", "Move! Move! Move!", "Add 3\" to the unit’s Move. No effect on damage, but the unit is under an Order."),
  ...order("take-cover", "Take Cover!", "Improve the unit’s Save by 1 (not better than 3+). No effect on damage dealt, but the unit is under an Order."),
  ...order("duty-and-honour", "Duty and Honour!", "Add 1 to the unit’s Leadership and Objective Control. No effect on damage, but the unit is under an Order."),

  // ---------- Space Marines (10 October 2026, from "The Wall Advances": the importer only learned to read it that day)
  {
    // Either condition is enough. With both switched on, the two +1s are capped at +1, as every hit modifier is.
    id: "bolter-discipline",
    faction: "SM",
    status: "draft",
    rule: {
      nm: "Bolter Discipline",
      src: "Datasheet",
      dmg: true,
      txt: "In your Shooting phase, the unit’s ranged attacks get +1 to hit while it is within range of an objective, or while the target is. Switch on “Your unit is on an objective” or “Target is on an objective”.",
      fx: [
        { phase: "ranged", when: "selfObj", hit: 1 },
        { phase: "ranged", when: "objective", hit: 1 }
      ]
    }
  }
]

/** An Astra Militarum Order: picked per unit in the modifier bar, offered by Voice of Command. */
function order(id: string, nm: string, txt: string, fx?: Rule["fx"]): Array<LibraryRule> {
  return [{ id, faction: "AM", status: "draft", rule: { nm, src: "Order", dmg: !!fx, txt, ...(fx ? { fx } : {}) } }]
}
