/**
 * Saving a rule to the library: the one save behind the rule editor's form
 * and the MCP's save_rule. The effect is decoded strictly, so a misspelt field
 * is an error with its path rather than a clause that silently does nothing.
 */
import { Effect, Schema } from "effect"
import { SITUATION } from "~/domain/options"
import { Fx, Rule, RuleStatus } from "~/domain/schema"
import { type RuleEntry, Rules } from "./repos/Rules"

/**
 * A change to one rule. A field left out keeps what the rule has; an empty
 * string clears it. The form sends every field; an agent sends what it means
 * to change.
 */
export interface RuleEdit {
  readonly nm?: string
  readonly src?: string
  readonly txt?: string
  readonly dmg?: boolean
  /** "unit": shared across an attached unit; anything else: this datasheet only. */
  readonly scope?: string
  /** A situation switch's key, or a new one. */
  readonly cond?: string
  readonly condNm?: string
  readonly condTxt?: string
  readonly mark?: string
  readonly markNm?: string
  readonly markTxt?: string
  readonly global?: boolean
  /** Effect clauses as plain JSON values; one clause on its own is taken as a list of one. */
  readonly fx?: unknown
  readonly status: string
  /** Replaces the rule's notes. */
  readonly notes?: string
  /** Goes on top of the rule's notes. */
  readonly note?: string
  readonly faction?: string
}

export interface Saved {
  readonly id: string
  readonly rule: Rule
  readonly status: RuleStatus
  /** The library had no rule with this id before. */
  readonly created: boolean
}

/** Unknown fields are almost always typos, so the effect is decoded strictly. */
const decodeFx = Schema.decodeUnknownEffect(Schema.Array(Fx), { onExcessProperty: "error", errors: "all" })

/**
 * Save `edit` over the rule with this id. With `create`, a rule the library
 * doesn't have is added (it needs a name); without it, that's `RuleNotFound`.
 */
export const saveRule = Effect.fn("saveRule")(function*(id: string, edit: RuleEdit, options: { readonly create?: boolean } = {}) {
  const rules = yield* Rules
  const current: RuleEntry | null = options.create
    ? yield* rules.get(id).pipe(Effect.catchTag("RuleNotFound", () => Effect.succeed(null)))
    : yield* rules.get(id)
  const was = current?.rule
  const fx = edit.fx === undefined ? (was?.fx ?? []) : yield* decodeFx(Array.isArray(edit.fx) ? edit.fx : [edit.fx])
  // effects given without saying whether the rule changes damage: it does if there are any
  const dmg = edit.dmg ?? (edit.fx !== undefined ? fx.length > 0 : (was?.dmg ?? false))

  // a condition other rules already wait for keeps their label, so the switch reads the same everywhere
  const cond = edit.cond ?? was?.cond ?? ""
  const builtIn = SITUATION.find(([k]) => k === cond)
  const others = cond ? (yield* rules.all).find((e) => e.id !== id && e.rule.cond === cond)?.rule : undefined
  const sameCond = !!cond && was?.cond === cond
  const condNm = !cond ? undefined : builtIn ? builtIn[1] : edit.condNm || others?.condNm || (sameCond ? was?.condNm : undefined) || cond
  const condTxt = !cond || builtIn ? undefined : edit.condTxt || others?.condTxt || (edit.condTxt === undefined && sameCond ? was?.condTxt : undefined) || undefined

  const mark = edit.mark ?? was?.mark ?? ""
  const kept = (v: string | undefined, before: string | undefined) => (v === undefined ? before : v || undefined)
  const scope = edit.scope === undefined ? was?.scope : edit.scope === "unit" ? "unit" : undefined

  const rule = yield* Schema.decodeUnknownEffect(Rule)({
    ...was,
    nm: edit.nm || was?.nm,
    src: edit.src || was?.src || "Datasheet",
    txt: edit.txt ?? was?.txt ?? "",
    dmg,
    scope: scope ?? undefined,
    cond: cond || undefined,
    condNm,
    condTxt,
    mark: mark || undefined,
    markNm: mark ? kept(edit.markNm, was?.markNm) : undefined,
    markTxt: mark ? kept(edit.markTxt, was?.markTxt) : undefined,
    global: mark && (edit.global ?? was?.global) ? true : undefined,
    fx: dmg && fx.length ? fx : undefined,
    // saved by someone, so translated: no longer waiting, and no longer only the roster's
    todo: undefined,
    imported: undefined,
    lib: undefined
  })
  const status = yield* Schema.decodeUnknownEffect(RuleStatus)(edit.status)
  const notes = edit.note ? [edit.note, edit.notes ?? current?.notes ?? ""].filter(Boolean).join("\n") : edit.notes
  yield* rules.save(id, { rule, status, notes, faction: edit.faction || null })
  return { id, rule, status, created: current === null } satisfies Saved
})
