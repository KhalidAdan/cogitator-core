/**
 * The domain model, as Effect schemas. Everything that crosses a boundary
 * (SQLite JSON columns, form posts, roster imports, the POC seed data) is
 * decoded through these. The engine itself only imports the *types*, so none of
 * this ends up in the hot path.
 *
 * Field names are deliberately the POC's short ones (`nm`, `pts`, `w`, `kw`…):
 * the handoff document, the seed data and the calibration tests all speak that
 * dialect, and renaming them would have made the port unverifiable.
 */
import { Schema } from "effect"

const opt = Schema.optional
const NullishString = Schema.optional(Schema.NullOr(Schema.String))

/** `3`, or a dice expression such as `"D6+1"` / `"2D3"`. */
export const Dice = Schema.Union([Schema.Number, Schema.String])
export type Dice = typeof Dice.Type

/** Target keyword filter: matches when any `only` is present and no `not` is. */
export const KwCond = Schema.Struct({
  only: opt(Schema.Array(Schema.String)),
  not: opt(Schema.Array(Schema.String))
})
export type KwCond = typeof KwCond.Type

/** Weapon abilities. Flags are stored as `1`, as in the POC data. */
export const WeaponKw = Schema.Struct({
  torrent: opt(Schema.Number),
  lethal: opt(Schema.Number),
  sus: opt(Schema.Number),
  tl: opt(Schema.Number),
  dev: opt(Schema.Number),
  lance: opt(Schema.Number),
  blast: opt(Schema.Number),
  cleave: opt(Schema.Number),
  melta: opt(Schema.Number),
  heavy: opt(Schema.Number),
  rf: opt(Schema.Number),
  anti: opt(Schema.Tuple([Schema.String, Schema.Number])),
  pistol: opt(Schema.Number),
  ic: opt(Schema.Number),
  precision: opt(Schema.Number),
  psychic: opt(Schema.Number),
  hazardous: opt(Schema.Number),
  indirect: opt(Schema.Number),
  extra: opt(Schema.Number),
  oneshot: opt(Schema.Number),
  /** Conditional abilities: the keyed ability only counts against matching targets. */
  when: opt(Schema.Record(Schema.String, KwCond)),
  /** Ability text the engine does not understand; shown, never modelled. */
  other: opt(Schema.Array(Schema.String))
})
export type WeaponKw = typeof WeaponKw.Type

export const Weapon = Schema.Struct({
  nm: Schema.String,
  t: Schema.Literals(["r", "m"]),
  /** Copies of this profile in the unit. */
  n: Schema.Number,
  A: Dice,
  /** BS/WS as the number on the dice; 0 for torrent. */
  sk: Schema.Number,
  S: Schema.Number,
  /** Positive: `AP -2` is stored as 2. */
  AP: Schema.Number,
  D: Dice,
  kw: WeaponKw,
  /** Pick-one group: the engine keeps the best row per target. */
  alt: NullishString,
  /** Carried but not used (pistol rule); the string is the reason shown. */
  off: NullishString,
  /** Set only inside combined units. */
  _owner: NullishString
})
export type Weapon = typeof Weapon.Type

export const Enhancement = Schema.Struct({
  id: opt(Schema.String),
  nm: Schema.String,
  pts: Schema.Number,
  ids: opt(Schema.Array(Schema.String))
})
export type Enhancement = typeof Enhancement.Type

export const UnitStats = Schema.Struct({
  T: Schema.Number,
  Sv: Schema.Number,
  W: Schema.Number,
  M: NullishString,
  Ld: NullishString,
  OC: NullishString,
  inv: opt(Schema.Number),
  invRangedOnly: opt(Schema.Boolean)
})
export type UnitStats = typeof UnitStats.Type

export const Role = Schema.Literals(["Leader", "Support", "Bodyguard"])
export type Role = typeof Role.Type

export const Unit = Schema.Struct({
  id: Schema.String,
  nm: Schema.String,
  sub: NullishString,
  /** Includes enhancement points. */
  pts: Schema.Number,
  enh: opt(Schema.NullOr(Enhancement)),
  grp: NullishString,
  role: opt(Schema.NullOr(Role)),
  cat: NullishString,
  models: Schema.Number,
  kw: opt(Schema.Array(Schema.String)),
  rules: Schema.Array(Schema.String),
  w: Schema.Array(Weapon),
  stats: opt(Schema.NullOr(UnitStats)),
  warlord: opt(Schema.Boolean),
  /** Wahapedia datasheet this unit was matched to, when known. */
  datasheetId: NullishString,
  // only present on the synthetic "attached unit" rows the engine builds
  combined: opt(Schema.Boolean),
  members: opt(Schema.Array(Schema.String))
})
export type Unit = typeof Unit.Type

export const Reroll = Schema.Literals(["ones", "all"])
export type Reroll = typeof Reroll.Type

/**
 * One clause of a rule's effect. All filters must pass for the clause to
 * apply; everything it carries is then added to the attack.
 */
export const Fx = Schema.Struct({
  phase: opt(Schema.Literals(["melee", "ranged"])),
  /** Only while this situation flag / mark is on. */
  when: opt(Schema.String),
  whenNot: opt(Schema.String),
  vs: opt(KwCond),
  /** Only for attackers with these keywords (the unit making the attack, not the target). */
  attacker: opt(KwCond),
  /** Substring of the weapon name (lower case). */
  weapon: opt(Schema.String),
  weaponNot: opt(Schema.String),
  /** Roll modifiers: summed with everything else, then capped at ±1. */
  hit: opt(Schema.Number),
  wound: opt(Schema.Number),
  /** Characteristic changes: uncapped, they stack. */
  s: opt(Schema.Number),
  ap: opt(Schema.Number),
  a: opt(Schema.Number),
  d: opt(Schema.Number),
  rrHit: opt(Reroll),
  rrWound: opt(Reroll),
  /** Re-roll the damage roll (optimal single re-roll). */
  rrDmg: opt(Schema.Boolean),
  /** Critical hits on this unmodified roll or better (default 6). */
  critHit: opt(Schema.Number),
  /** Ignore penalties to the hit roll and to BS/WS (a −1 to hit, the cover penalty); bonuses still count. */
  ignoreHitPenalty: opt(Schema.Boolean),
  /** Weapon abilities to add; numeric ones take the max. */
  grant: opt(Schema.Record(Schema.String, Schema.Number))
})
export type Fx = typeof Fx.Type

export const RuleStatus = Schema.Literals(["verified", "draft", "note", "todo"])
export type RuleStatus = typeof RuleStatus.Type

export const Rule = Schema.Struct({
  nm: Schema.String,
  src: Schema.String,
  /** Changes damage dealt, so the engine models it. */
  dmg: Schema.Boolean,
  def: opt(Schema.Boolean),
  /** `unit` = shared across the attached unit; otherwise this datasheet only. */
  scope: opt(Schema.NullOr(Schema.Literals(["unit", "self"]))),
  /** Situation flag the rule waits for; shown as "idle" while it is off. */
  cond: opt(Schema.String),
  condNm: opt(Schema.String),
  /** One line under the condition's switch, for conditions the app doesn't have built in. */
  condTxt: opt(Schema.String),
  /** Target mark this rule sets or reads; its switch lives with the marks. */
  mark: opt(Schema.String),
  /** On the rule that *sets* a mark: the switch label and one-line effect. */
  markNm: opt(Schema.String),
  markTxt: opt(Schema.String),
  /** A mark whose effect applies to every attacker in the list. */
  global: opt(Schema.Boolean),
  /** Having this rule in the list hands `rule` to every unit with keyword `kw`. */
  grants: opt(Schema.Struct({ kw: Schema.String, rule: Schema.String })),
  /** Imported, reads like it changes damage, not translated yet. */
  todo: opt(Schema.Boolean),
  imported: opt(Schema.Boolean),
  txt: Schema.String,
  fx: opt(Schema.Array(Fx)),
  /** Who the rule reaches, for army and detachment rules. */
  reach: opt(Schema.String)
})
export type Rule = typeof Rule.Type
export type RuleBook = Readonly<Record<string, Rule>>

export const Target = Schema.Struct({
  id: Schema.String,
  nm: Schema.String,
  pts: Schema.Number,
  T: Schema.Number,
  Sv: Schema.Number,
  /** 0 = none. */
  inv: Schema.Number,
  /** Wounds per model. */
  W: Schema.Number,
  /** Models in the unit. */
  N: Schema.Number,
  /** 0 = none. */
  fnp: Schema.Number,
  /** Damage reduction. */
  dr: Schema.Number,
  /** Space-separated, upper case. */
  kw: Schema.String,
  cls: Schema.Literals(["inf", "veh"])
})
export type Target = typeof Target.Type

export const ModReroll = Schema.Literals(["off", "1s", "full"])
export type ModReroll = typeof ModReroll.Type

/** One scope of the modifier bar. */
export const Mod = Schema.Struct({
  apply: Schema.Literals(["both", "ranged", "melee"]),
  hit: Schema.Number,
  wound: Schema.Number,
  ap: Schema.Number,
  sus: Schema.Boolean,
  lethal: Schema.Boolean,
  rrHit: ModReroll,
  rrWound: ModReroll,
  cover: Schema.Boolean,
  half: Schema.Boolean,
  rf: Schema.Number
})
export type Mod = typeof Mod.Type

export const Phase = Schema.Literals(["all", "ranged", "melee"])
export type Phase = typeof Phase.Type

export const Opts = Schema.Struct({
  phase: Phase,
  /** Score attached units as one row. */
  combine: Schema.Boolean,
  /** Count enhancement points in the cost. */
  enh: Schema.Boolean,
  /** Stop at the target's total wounds. */
  cap: Schema.Boolean,
  /** Situation switches and target marks, by key. */
  flags: Schema.Record(Schema.String, Schema.Boolean),
  /** Per-owner rule switches: `"owner:ruleId" → true` means switched off. */
  off: Schema.Record(Schema.String, Schema.Boolean),
  /** Modifier bar, per scope (`all`, a unit id, `grp-X`). */
  mods: Schema.Record(Schema.String, Mod)
})
export type Opts = typeof Opts.Type

export const Group = Schema.Struct({ nm: Schema.String, short: Schema.String })
export type Group = typeof Group.Type

export const ListMeta = Schema.Struct({
  name: Schema.String,
  sub: opt(Schema.String),
  faction: opt(Schema.String),
  detachments: opt(Schema.Array(Schema.String)),
  mission: opt(Schema.String)
})
export type ListMeta = typeof ListMeta.Type

/** An army list as the app works with it. */
export const ArmyList = Schema.Struct({
  id: Schema.String,
  builtin: Schema.Boolean,
  meta: ListMeta,
  groups: Schema.Record(Schema.String, Group),
  armyRules: Schema.Array(Schema.String),
  /** Rules read from the roster file; they overlay the library for this list. */
  rules: Schema.Record(Schema.String, Rule),
  units: Schema.Array(Unit),
  opts: Opts
})
export type ArmyList = typeof ArmyList.Type
