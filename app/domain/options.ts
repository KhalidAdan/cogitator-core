/**
 * List options: the defaults, the presets, and the one reducer through which
 * every change to them goes.
 *
 * A control posts an *intent* ("set phase to melee", "switch this rule off").
 * The server action applies it with `applyIntent` and stores the result; the
 * browser applies the same function to pending submissions so the matrix
 * recalculates before the server has answered.
 */
import { MOD0, modIsSet, ruleKey } from "./engine"
import type { Mod, Opts, Unit } from "./schema"

/** Situation switches shown in the controls, in order. */
export const SITUATION: ReadonlyArray<readonly [key: string, label: string, hint: string]> = [
  ["charged", "Charged this turn", "Lance weapons add 1 to the wound roll."],
  ["stationary", "Remained stationary", "Heavy weapons add 1 to hit."],
  ["objective", "Target is on an objective", "For rules that upgrade against objective holders, like Reavers of the Void."],
  ["char", "Target is a Character unit", "For rules that only work against Characters, like Assassins’ Eye or Trophy Taker."],
  ["selfObj", "Your unit is on an objective", "For rules that work while your unit holds an objective, like Deeds of Legend."]
]

export const ACCOUNTING: ReadonlyArray<readonly [key: "enh" | "cap", label: string, hint: string]> = [
  ["enh", "Count enhancement points", "Enhancements raise the cost you divide by."],
  ["cap", "Stop at the unit’s total wounds", "Overkill beyond the target’s wound pool earns nothing."]
]

/** Table defaults: what a fresh list starts with. "Charged" is on, as in the POC. */
export const defaultOpts = (): Opts => ({
  phase: "all",
  combine: true,
  enh: true,
  cap: false,
  flags: { charged: true },
  off: {},
  mods: {}
})

/**
 * Rules the Culling Cogitator appears not to apply. Switching these off for
 * every unit is the "bare datasheets" preset, and the setting the calibration
 * rows are checked under.
 */
export const BARE_DATASHEET_RULES_OFF = ["piratical-hero", "reavers", "assured"] as const

export function bareDatasheetOpts(units: ReadonlyArray<Unit>, keep?: Pick<Opts, "phase" | "combine">): Opts {
  const off: Record<string, boolean> = {}
  for (const u of units) for (const r of BARE_DATASHEET_RULES_OFF) off[ruleKey(u.id, r)] = true
  return { ...defaultOpts(), combine: false, ...keep, off }
}

// ---------- intents ----------

export type OptsIntent =
  | { readonly intent: "set"; readonly key: "phase" | "combine" | "enh" | "cap"; readonly value: string }
  | { readonly intent: "flag"; readonly key: string; readonly value: boolean }
  | { readonly intent: "mod"; readonly scope: string; readonly key: keyof Mod; readonly value: string }
  | { readonly intent: "mod-clear"; readonly scope: string }
  | { readonly intent: "rule-switch"; readonly key: string; readonly on: boolean }
  | { readonly intent: "preset"; readonly value: "table" | "bare" }

const truthy = (v: unknown) => v === "true" || v === "on" || v === "1"

/** Read an intent out of a form post. Returns `null` for anything that isn't one. */
export function intentFromForm(fd: FormData): OptsIntent | null {
  const s = (k: string) => {
    const v = fd.get(k)
    return typeof v === "string" ? v : ""
  }
  switch (s("intent")) {
    case "set": {
      const key = s("key")
      if (key === "phase" || key === "combine" || key === "enh" || key === "cap") return { intent: "set", key, value: s("value") }
      return null
    }
    case "flag":
      return s("key") ? { intent: "flag", key: s("key"), value: truthy(s("value")) } : null
    case "mod": {
      const key = s("key")
      return key in MOD0 && s("scope") ? { intent: "mod", scope: s("scope"), key: key as keyof Mod, value: s("value") } : null
    }
    case "mod-clear":
      return s("scope") ? { intent: "mod-clear", scope: s("scope") } : null
    case "rule-switch":
      return s("key") ? { intent: "rule-switch", key: s("key"), on: truthy(s("on")) } : null
    case "preset": {
      const v = s("value")
      return v === "table" || v === "bare" ? { intent: "preset", value: v } : null
    }
    default:
      return null
  }
}

const PHASES = ["all", "ranged", "melee"] as const
const APPLY = ["both", "ranged", "melee"] as const
const REROLLS = ["off", "1s", "full"] as const
const oneOf = <A extends string>(list: ReadonlyArray<A>, v: string, fallback: A): A => (list.includes(v as A) ? (v as A) : fallback)
const bounded = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.trunc(Number(v)) || 0))

function modWith(m: Mod, key: keyof Mod, value: string): Mod {
  switch (key) {
    case "apply":
      return { ...m, apply: oneOf(APPLY, value, "both") }
    case "hit":
      return { ...m, hit: bounded(value, -1, 1) }
    case "wound":
      return { ...m, wound: bounded(value, -1, 1) }
    case "ap":
      return { ...m, ap: bounded(value, -2, 3) }
    case "rf":
      return { ...m, rf: bounded(value, 0, 4) }
    case "s":
    case "a":
    case "d":
      return { ...m, [key]: bounded(value, -1, 2) }
    case "rrHit":
      return { ...m, rrHit: oneOf(REROLLS, value, "off") }
    case "rrWound":
      return { ...m, rrWound: oneOf(REROLLS, value, "off") }
    case "sus":
    case "lethal":
    case "cover":
    case "half":
      return { ...m, [key]: truthy(value) }
  }
}

/** Apply one intent. Pure; the same function runs in the action and in the browser. */
export function applyIntent(opts: Opts, i: OptsIntent, units: ReadonlyArray<Unit>): Opts {
  switch (i.intent) {
    case "set":
      if (i.key === "phase") return { ...opts, phase: oneOf(PHASES, i.value, "all") }
      return { ...opts, [i.key]: truthy(i.value) }
    case "flag":
      return { ...opts, flags: { ...opts.flags, [i.key]: i.value } }
    case "mod": {
      const next = modWith({ ...MOD0, ...opts.mods[i.scope] }, i.key, i.value)
      const mods = { ...opts.mods }
      // keep the "applies to" choice even before a modifier is set, drop empty scopes otherwise
      if (modIsSet(next) || (i.key === "apply" && next.apply !== "both")) mods[i.scope] = next
      else delete mods[i.scope]
      return { ...opts, mods }
    }
    case "mod-clear": {
      const mods = { ...opts.mods }
      delete mods[i.scope]
      return { ...opts, mods }
    }
    case "rule-switch": {
      const off = { ...opts.off }
      if (i.on) delete off[i.key]
      else off[i.key] = true
      return { ...opts, off }
    }
    case "preset":
      return i.value === "bare"
        ? bareDatasheetOpts(units, { phase: opts.phase, combine: opts.combine })
        : { ...defaultOpts(), phase: opts.phase, combine: opts.combine }
  }
}
