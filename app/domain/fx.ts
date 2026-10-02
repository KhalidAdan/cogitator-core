/** Rule effects in words, for the library and the rule editor. */
import type { Fx, Rule } from "./schema"

const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)

const GRANTS: Record<string, (v: number) => string> = {
  sus: (v) => `Sustained Hits ${v}`,
  lethal: () => "Lethal Hits",
  lance: () => "Lance",
  ic: () => "Ignores Cover",
  dev: () => "Devastating Wounds",
  cleave: (v) => `Cleave ${v}`,
  tl: () => "Twin-linked",
  precision: () => "Precision"
}

export function describeFx(e: Fx): string {
  const when: Array<string> = []
  if (e.phase) when.push(e.phase === "melee" ? "melee" : "ranged")
  if (e.when) when.push(`when “${e.when}”`)
  if (e.whenNot) when.push(`unless “${e.whenNot}”`)
  if (e.vs?.only) when.push(`vs ${e.vs.only.join("/").toLowerCase()}`)
  if (e.vs?.not) when.push(`not vs ${e.vs.not.join("/").toLowerCase()}`)
  if (e.attacker?.only) when.push(`${e.attacker.only.join("/").toLowerCase()} attackers`)
  if (e.attacker?.not) when.push(`non-${e.attacker.not.join("/").toLowerCase()} attackers`)
  if (e.weapon) when.push(`“${e.weapon}” only`)
  if (e.weaponNot) when.push(`except “${e.weaponNot}”`)

  const does: Array<string> = []
  if (e.hit) does.push(`${signed(e.hit)} to hit`)
  if (e.wound) does.push(`${signed(e.wound)} to wound`)
  if (e.s) does.push(`${signed(e.s)} Strength`)
  if (e.ap) does.push(`${signed(e.ap)} AP`)
  if (e.a) does.push(`${signed(e.a)} Attacks`)
  if (e.d) does.push(`${signed(e.d)} Damage`)
  if (e.rrHit) does.push(e.rrHit === "all" ? "re-roll hits" : "re-roll hit rolls of 1")
  if (e.rrWound) does.push(e.rrWound === "all" ? "re-roll wounds" : "re-roll wound rolls of 1")
  if (e.rrDmg) does.push("re-roll damage")
  if (e.critHit) does.push(`critical hits on ${e.critHit}+`)
  if (e.ignoreHitPenalty) does.push("ignore penalties to hit and to BS/WS")
  for (const [k, v] of Object.entries(e.grant ?? {})) does.push(GRANTS[k]?.(v) ?? `${k} ${v}`)

  const what = does.length ? does.join(", ") : "nothing"
  return when.length ? `${when.join(", ")}: ${what}` : what
}

/** One line for a whole rule: what it does to the maths, or why it does nothing. */
export function describeRule(r: Rule): string {
  if (!r.dmg) return r.todo ? "Not modelled yet" : "No effect on damage"
  if (!r.fx?.length) return r.mark ? `Sets the “${r.markNm ?? r.mark}” mark` : "Counted, but has no effect written"
  return r.fx.map(describeFx).join("; ")
}

/** The effect vocabulary, as shown beside the editor. */
export const FX_HELP: ReadonlyArray<readonly [field: string, meaning: string]> = [
  ["phase", '"melee" or "ranged": only those attacks'],
  ["when / whenNot", "a situation or mark key (charged, stationary, objective, char, selfObj, or a mark) that must be on / off"],
  ["vs", '{"only": ["MONSTER", "VEHICLE"]} or {"not": [...]}: target keyword filter'],
  ["attacker", '{"only": ["VEHICLE"]}: only attacks made by units with these keywords (for a buff handed to another unit)'],
  ["weapon / weaponNot", "lower-case part of a weapon name"],
  ["hit, wound", "roll modifiers; everything is summed, then capped at ±1"],
  ["s, ap, a, d", "characteristic changes: Strength, AP, Attacks per model, Damage; uncapped"],
  ["rrHit, rrWound", '"ones" or "all"; the strongest re-roll wins'],
  ["rrDmg", "true: re-roll the damage roll"],
  ["critHit", "critical hits on this unmodified roll or better (5 for “crits on 5+”)"],
  ["ignoreHitPenalty", "true: ignore −1 to hit and the cover penalty; bonuses still count"],
  ["grant", '{"sus": 1, "lethal": 1, "lance": 1, "ic": 1, "dev": 1, "cleave": 1, "tl": 1}: weapon abilities to add']
]
