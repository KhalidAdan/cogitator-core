/**
 * The rule book a list is scored with: the library, and the rules read from
 * the list's roster file over it.
 *
 * A rule the importer didn't find in the library stays with the list, under an
 * id of its own ("imp-…"). Once the library has a rule of that name, the
 * library's translation stands in for it, as re-reading the roster would do, so
 * translating a rule reaches every list that has it.
 */
import type { Rule, RuleBook, Unit } from "./schema"
import { baseRuleName, norm } from "./text"

export function listRuleBook(library: RuleBook, own: RuleBook): RuleBook {
  const byName = new Map<string, string>()
  // an army rule belongs to the list rather than a unit; only the importer files it there
  for (const [id, r] of Object.entries(library)) if (r.src !== "Army rule") byName.set(norm(r.nm), id)
  const out: Record<string, Rule> = { ...library }
  for (const [id, r] of Object.entries(own)) {
    const key = norm(r.nm)
    const libId = r.imported ? (byName.get(key) ?? byName.get(baseRuleName(key))) : undefined
    out[id] = libId ? { ...library[libId], lib: libId } : r
  }
  return out
}

export interface NotInLibrary {
  readonly id: string
  readonly rule: Rule
  /** The units that have it, in list order. */
  readonly units: ReadonlyArray<Unit>
}

/**
 * The rules a list has that the library has nothing of that name for, with the
 * units that have each: what an agent with save_rule can translate. `book` is
 * the list's rule book (`listRuleBook`), so a rule the library has gained since
 * the import isn't here.
 */
export function notInLibrary(units: ReadonlyArray<Unit>, book: RuleBook): Array<NotInLibrary> {
  return Object.entries(book)
    .filter(([id, r]) => r.imported && units.some((u) => u.rules.includes(id)))
    .map(([id, rule]) => ({ id, rule, units: units.filter((u) => u.rules.includes(id)) }))
}

/**
 * What to paste into an agent connected to the MCP, so it translates a list's
 * rules into the library: the rules that read like they change damage by name,
 * and a word to check the rest, since that reading goes by wording.
 */
export function translateRequest(list: { readonly name: string; readonly url: string }, rules: ReadonlyArray<NotInLibrary>): string {
  const names = rules.map((x) => x.rule.nm)
  return [
    `My Cogitator Core list “${list.name}” (${list.url}) has ${names.length === 1 ? "a rule" : `${names.length} rules`} the damage engine doesn't model yet: ${names.join(", ")}.`,
    `Read the list with get_list. Translate ${names.length === 1 ? "it" : "each of them"} with save_rule, which saves a draft to the rules library, and any other rule there that isn't in the library but does change damage. Check each one with explain_matchup, then tell me what you modelled and anything you weren't sure of.`
  ].join(" ")
}
