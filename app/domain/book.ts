/**
 * The rule book a list is scored with: the library, and the rules read from
 * the list's roster file over it.
 *
 * A rule the importer didn't find in the library stays with the list, under an
 * id of its own ("imp-…"). Once the library has a rule of that name, the
 * library's translation stands in for it, as re-reading the roster would do, so
 * translating a rule reaches every list that has it.
 */
import type { Rule, RuleBook } from "./schema"
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
