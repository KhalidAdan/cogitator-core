/**
 * Link the rules library to the official text in the current snapshot, and
 * notice when that text changes.
 *
 * Each library rule is matched by name (and faction) to a datasheet ability,
 * enhancement, detachment ability or shared ability. The first time, the text
 * and its hash are recorded. On a later snapshot, a different hash means the
 * rule was reworded: the link is refreshed and the rule drops back to `draft`
 * so it shows up for review (roadmap phase 3).
 */
import { Effect, Option } from "effect"
import { norm, textHash } from "~/domain/text"
import { Rules, type RuleEntry } from "../repos/Rules"
import { currentSnapshotId, type NamedText, namedTexts } from "./queries"

export interface SyncResult {
  readonly snapshotId: number | null
  /** Rules linked to their official text for the first time. */
  readonly linked: ReadonlyArray<string>
  /** Rules whose official text changed; they are now drafts. */
  readonly changed: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly unchanged: number
  /** Rules with no text of that name in the snapshot. */
  readonly unlinked: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

/** Which kind of official text a rule most likely is, judged by where the library says it comes from. */
function preferredKinds(entry: RuleEntry): ReadonlyArray<NamedText["kind"]> {
  const src = entry.rule.src
  if (src === "Enhancement") return ["enhancement", "datasheet-ability"]
  if (src === "Army rule") return ["ability", "detachment-ability"]
  if (["Datasheet", "Leader", "Wargear", "Core", "Received"].includes(src)) return ["datasheet-ability", "ability"]
  // anything else is a detachment's name ("Corsair Coterie", "Detachment")
  return ["detachment-ability", "datasheet-ability", "ability"]
}

/** Names are compared without their bracketed tags: "Guide (Psychic)", "Spirit Mark (from Spiritseer)". */
export const ruleNameKey = (nm: string) => norm(nm.replace(/\([^)]*\)/g, ""))

export function matchRule(entry: RuleEntry, byName: ReadonlyMap<string, ReadonlyArray<NamedText>>): NamedText | null {
  const named = byName.get(ruleNameKey(entry.rule.nm))
  if (!named?.length) return null
  for (const kind of preferredKinds(entry)) {
    const ofKind = named.filter((t) => t.kind === kind && t.text)
    const pick = ofKind.find((t) => entry.faction && t.factionId === entry.faction) ?? (entry.faction ? undefined : ofKind[0])
    if (pick) return pick
  }
  // right name, wrong faction or kind: better than nothing, as long as it is unambiguous
  const texts = new Set(named.filter((t) => t.text).map((t) => textHash(t.text)))
  return texts.size === 1 ? named.find((t) => t.text) ?? null : null
}

export const syncRules = Effect.gen(function*() {
  const snapshotId = Option.getOrUndefined(yield* currentSnapshotId)
  if (snapshotId === undefined) {
    return { snapshotId: null, linked: [], changed: [], unchanged: 0, unlinked: [] } satisfies SyncResult
  }
  const rules = yield* Rules
  const byName = new Map<string, Array<NamedText>>()
  for (const t of yield* namedTexts(snapshotId)) {
    const k = ruleNameKey(t.name)
    const list = byName.get(k)
    if (list) list.push(t)
    else byName.set(k, [t])
  }

  const linked: Array<string> = []
  const changed: Array<{ id: string; name: string }> = []
  const unlinked: Array<{ id: string; name: string }> = []
  let unchanged = 0
  for (const entry of yield* rules.all) {
    const found = matchRule(entry, byName)
    if (!found) {
      unlinked.push({ id: entry.id, name: entry.rule.nm })
      continue
    }
    const hash = textHash(found.text)
    if (entry.wh?.hash === hash) {
      unchanged++
      continue
    }
    yield* rules.link(entry.id, { kind: found.kind, text: found.text, hash, snapshotId })
    if (!entry.wh) linked.push(entry.id)
    else {
      changed.push({ id: entry.id, name: entry.rule.nm })
      yield* rules.setStatus(
        entry.id,
        entry.status === "verified" ? "draft" : entry.status,
        `Official wording changed in snapshot #${snapshotId}; check the effect still matches.`
      )
    }
  }
  if (changed.length) yield* Effect.logWarning(`Official text changed for ${changed.length} rule(s): ${changed.map((c) => c.name).join(", ")}`)
  return { snapshotId, linked, changed, unchanged, unlinked } satisfies SyncResult
}).pipe(Effect.withSpan("wahapedia.syncRules"))
