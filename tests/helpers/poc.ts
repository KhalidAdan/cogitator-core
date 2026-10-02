/**
 * Loads the original POC (kill-ledger/src) into a VM so tests can use it as an
 * oracle. Nothing in the app imports this; it exists to prove the port.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import type { Opts } from "~/domain/schema"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
export const pocPath = (...p: Array<string>) => join(root, "kill-ledger", ...p)

export interface Poc {
  BASE_RULES: Record<string, any>
  DEFAULT_UNITS: Array<any>
  DEFAULT_TARGETS: Array<any>
  EXTRA_BUILTIN_LISTS: Array<any>
  attackUnit: (unit: any, tgt: any, opts: any, allUnits: Array<any>) => any
  attackerList: (units: Array<any>, opts: any) => Array<any>
  setRules: (rules: Record<string, any>) => void
}

export function loadPoc(): Poc {
  const src = ["data.js", "extra_lists.js", "engine.js"].map((f) => readFileSync(pocPath("src", f), "utf8")).join("\n")
  return vm.runInNewContext(
    src +
      ";({BASE_RULES, DEFAULT_UNITS, DEFAULT_TARGETS, EXTRA_BUILTIN_LISTS, attackUnit, attackerList, setRules: (r) => { RULES = r }})",
    { module: undefined }
  )
}

/** This app's options, flattened into the shape the POC engine expects. */
export const toPocOpts = (o: Opts) => ({ phase: o.phase, combine: o.combine, enh: o.enh, cap: o.cap, ...o.flags, off: o.off, mods: o.mods })

/** The POC's lists, keyed by the ids this app seeds them under. */
export function pocLists(poc: Poc): Record<string, { units: Array<any>; rules: Record<string, any> }> {
  const out: Record<string, { units: Array<any>; rules: Record<string, any> }> = {
    "builtin-burning-v1": { units: poc.DEFAULT_UNITS, rules: {} }
  }
  for (const L of poc.EXTRA_BUILTIN_LISTS) out[L.id] = { units: L.units, rules: L.rules }
  return out
}

/**
 * Strike Force Cophasta as the POC built it. The app no longer ships this list, but it is the only
 * reference that exercises the Space Marines rules, so the tests keep checking against it.
 */
export const COPHASTA = "builtin-cophasta"

export function pocCophasta(poc: Poc = loadPoc()) {
  const list = poc.EXTRA_BUILTIN_LISTS.find((l) => l.id === COPHASTA)
  if (!list) throw new Error("kill-ledger/src/extra_lists.js no longer contains Strike Force Cophasta")
  // plain JSON, so it is the same kind of object as the lists in the seed file
  return JSON.parse(JSON.stringify(list)) as {
    id: string
    meta: { name: string; faction: string; detachments: Array<string>; mission: string }
    groups: Record<string, { nm: string; short: string }>
    armyRules: Array<string>
    rules: Record<string, any>
    units: Array<any>
  }
}
