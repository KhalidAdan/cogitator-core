/**
 * Change report between two snapshots of the Wahapedia export: what a
 * dataslate or errata actually moved. Pure functions over rows in memory.
 *
 * Two layers: a generic keyed diff of every table (counts), and readable
 * summaries of the changes that matter to this app — points, weapon profiles,
 * model profiles, rule text, datasheets added and removed.
 */
import { stripHtml, textHash } from "~/domain/text"
import { WH_TABLES, type WhTable } from "./tables"

export type Row = Readonly<Record<string, string>>
export type TableRows = Readonly<Record<string, ReadonlyArray<Row>>>

export interface TableDelta {
  readonly file: string
  readonly label: string
  readonly added: number
  readonly removed: number
  readonly changed: number
}

export type FieldChanges = Readonly<Record<string, readonly [from: string, to: string]>>

export interface SheetRef {
  readonly datasheetId: string
  readonly datasheet: string
  readonly faction: string
}

export interface ChangeReport {
  readonly from: { readonly id: number | null; readonly lastUpdate: string } | null
  readonly to: { readonly lastUpdate: string }
  readonly tables: ReadonlyArray<TableDelta>
  readonly datasheets: {
    readonly added: ReadonlyArray<SheetRef>
    readonly removed: ReadonlyArray<SheetRef>
  }
  readonly points: ReadonlyArray<SheetRef & { readonly line: string; readonly from: string; readonly to: string }>
  readonly weapons: ReadonlyArray<SheetRef & { readonly weapon: string; readonly kind: ChangeKind; readonly changes: FieldChanges }>
  readonly models: ReadonlyArray<SheetRef & { readonly model: string; readonly kind: ChangeKind; readonly changes: FieldChanges }>
  readonly abilities: ReadonlyArray<SheetRef & { readonly ability: string; readonly kind: ChangeKind }>
  readonly sharedAbilities: ReadonlyArray<{ readonly name: string; readonly faction: string; readonly kind: ChangeKind }>
  readonly enhancements: ReadonlyArray<{
    readonly name: string
    readonly faction: string
    readonly detachment: string
    readonly kind: ChangeKind
    readonly changes: FieldChanges
  }>
  readonly detachmentAbilities: ReadonlyArray<{ readonly name: string; readonly faction: string; readonly detachment: string; readonly kind: ChangeKind }>
  /** Totals before the lists above were cut to `LIMIT` entries. */
  readonly totals: Readonly<Record<string, number>>
}

export type ChangeKind = "added" | "removed" | "changed"

const LIMIT = 500

interface KeyedDiff {
  readonly added: Array<Row>
  readonly removed: Array<Row>
  readonly changed: Array<readonly [before: Row, after: Row]>
}

const keyOf = (t: WhTable, r: Row) => t.key.map((k) => r[k] ?? "").join("\u0001")
const same = (t: WhTable, a: Row, b: Row) => t.columns.every((c) => (a[c] ?? "") === (b[c] ?? ""))

/**
 * Keyed diff that tolerates repeated keys: rows under one key are compared as
 * a bag. Identical rows cancel; what is left pairs off as "changed", and any
 * surplus is added or removed.
 */
export function diffTable(t: WhTable, prev: ReadonlyArray<Row>, next: ReadonlyArray<Row>): KeyedDiff {
  const bag = (rows: ReadonlyArray<Row>) => {
    const m = new Map<string, Array<Row>>()
    for (const r of rows) {
      const k = keyOf(t, r)
      const list = m.get(k)
      if (list) list.push(r)
      else m.set(k, [r])
    }
    return m
  }
  const a = bag(prev)
  const b = bag(next)
  const out: KeyedDiff = { added: [], removed: [], changed: [] }
  for (const [k, after] of b) {
    const before = a.get(k)
    if (!before) {
      out.added.push(...after)
      continue
    }
    const left = before.filter((x) => !after.some((y) => same(t, x, y)))
    const right = after.filter((y) => !before.some((x) => same(t, x, y)))
    const n = Math.min(left.length, right.length)
    for (let i = 0; i < n; i++) out.changed.push([left[i], right[i]])
    out.removed.push(...left.slice(n))
    out.added.push(...right.slice(n))
  }
  for (const [k, before] of a) if (!b.has(k)) out.removed.push(...before)
  return out
}

const fieldChanges = (before: Row, after: Row, columns: ReadonlyArray<string>): FieldChanges => {
  const out: Record<string, readonly [string, string]> = {}
  for (const c of columns) if ((before[c] ?? "") !== (after[c] ?? "")) out[c] = [before[c] ?? "", after[c] ?? ""]
  return out
}

/** Rule text counts as changed only when its words do, not its markup. */
const textChanged = (a: string, b: string) => textHash(stripHtml(a)) !== textHash(stripHtml(b))

const cut = <A>(list: Array<A>, totals: Record<string, number>, name: string): Array<A> => {
  totals[name] = list.length
  return list.slice(0, LIMIT)
}

export function buildReport(
  prev: TableRows,
  next: TableRows,
  from: ChangeReport["from"],
  to: ChangeReport["to"]
): ChangeReport {
  const diffs: Record<string, KeyedDiff> = {}
  const tables: Array<TableDelta> = []
  for (const t of WH_TABLES) {
    const d = diffTable(t, prev[t.file] ?? [], next[t.file] ?? [])
    diffs[t.file] = d
    tables.push({ file: t.file, label: t.label, added: d.added.length, removed: d.removed.length, changed: d.changed.length })
  }

  const factionName = new Map<string, string>()
  for (const f of [...(prev.Factions ?? []), ...(next.Factions ?? [])]) factionName.set(f.id, f.name)
  const sheets = new Map<string, Row>()
  for (const d of [...(prev.Datasheets ?? []), ...(next.Datasheets ?? [])]) sheets.set(d.id, d)
  const ref = (datasheetId: string): SheetRef => {
    const d = sheets.get(datasheetId)
    return { datasheetId, datasheet: d?.name ?? datasheetId, faction: factionName.get(d?.faction_id ?? "") ?? d?.faction_id ?? "" }
  }
  const byName = <A extends { datasheet?: string; name?: string }>(a: A, b: A) =>
    (a.datasheet ?? a.name ?? "").localeCompare(b.datasheet ?? b.name ?? "")
  const totals: Record<string, number> = {}

  // points: a cost line means nothing without the tier header above it
  const tierOf = (rows: ReadonlyArray<Row>) => {
    const m = new Map<string, string>()
    const header = new Map<string, string>()
    const sorted = [...rows].sort((a, b) => a.datasheet_id.localeCompare(b.datasheet_id) || +a.line - +b.line)
    for (const r of sorted) {
      if (!r.cost.trim()) header.set(r.datasheet_id, stripHtml(r.description))
      else m.set(`${r.datasheet_id}\u0001${r.line}`, header.get(r.datasheet_id) ?? "")
    }
    return m
  }
  const nextTier = tierOf(next.Datasheets_models_cost ?? [])
  const prevTier = tierOf(prev.Datasheets_models_cost ?? [])
  const costLabel = (r: Row, tiers: Map<string, string>) => {
    const tier = tiers.get(`${r.datasheet_id}\u0001${r.line}`)
    const plain = !tier || /^your unit costs?$/i.test(tier)
    return plain ? stripHtml(r.description) : `${stripHtml(r.description)} (${tier.toLowerCase()})`
  }
  const cost = diffs.Datasheets_models_cost
  const points = [
    ...cost.changed
      .filter(([a, b]) => a.cost.trim() !== b.cost.trim() || a.description !== b.description)
      .map(([a, b]) => ({ ...ref(b.datasheet_id), line: costLabel(b, nextTier), from: a.cost.trim() || "–", to: b.cost.trim() || "–" })),
    ...cost.added.filter((r) => r.cost.trim()).map((r) => ({ ...ref(r.datasheet_id), line: costLabel(r, nextTier), from: "–", to: r.cost.trim() })),
    ...cost.removed.filter((r) => r.cost.trim()).map((r) => ({ ...ref(r.datasheet_id), line: costLabel(r, prevTier), from: r.cost.trim(), to: "–" }))
  ]
    // a datasheet that is new or gone is reported once, under datasheets
    .filter((p) => !diffs.Datasheets.added.some((d) => d.id === p.datasheetId) && !diffs.Datasheets.removed.some((d) => d.id === p.datasheetId))
    .sort(byName)

  const newOrGone = new Set([...diffs.Datasheets.added, ...diffs.Datasheets.removed].map((d) => d.id))
  const WEAPON_COLS = ["description", "range", "type", "A", "BS_WS", "S", "AP", "D"]
  const wd = diffs.Datasheets_wargear
  const weapons = [
    ...wd.changed
      .map(([a, b]) => ({ ...ref(b.datasheet_id), weapon: b.name, kind: "changed" as const, changes: fieldChanges(a, b, WEAPON_COLS) }))
      .filter((x) => Object.keys(x.changes).length),
    ...wd.added.map((r) => ({ ...ref(r.datasheet_id), weapon: r.name, kind: "added" as const, changes: {} })),
    ...wd.removed.map((r) => ({ ...ref(r.datasheet_id), weapon: r.name, kind: "removed" as const, changes: {} }))
  ]
    .filter((x) => !newOrGone.has(x.datasheetId))
    .sort(byName)

  const MODEL_COLS = ["M", "T", "Sv", "inv_sv", "inv_sv_descr", "W", "Ld", "OC"]
  const md = diffs.Datasheets_models
  const models = [
    ...md.changed
      .map(([a, b]) => ({ ...ref(b.datasheet_id), model: b.name, kind: "changed" as const, changes: fieldChanges(a, b, MODEL_COLS) }))
      .filter((x) => Object.keys(x.changes).length),
    ...md.added.map((r) => ({ ...ref(r.datasheet_id), model: r.name, kind: "added" as const, changes: {} })),
    ...md.removed.map((r) => ({ ...ref(r.datasheet_id), model: r.name, kind: "removed" as const, changes: {} }))
  ]
    .filter((x) => !newOrGone.has(x.datasheetId))
    .sort(byName)

  // datasheet abilities: only the ones written on the datasheet (shared ones are reported once, below)
  const ad = diffs.Datasheets_abilities
  const inline = (r: Row) => !r.ability_id && !!r.name
  const abilities = [
    ...ad.changed
      .filter(([a, b]) => inline(b) && textChanged(a.description, b.description))
      .map(([, b]) => ({ ...ref(b.datasheet_id), ability: b.name, kind: "changed" as const })),
    ...ad.added.filter(inline).map((r) => ({ ...ref(r.datasheet_id), ability: r.name, kind: "added" as const })),
    ...ad.removed.filter(inline).map((r) => ({ ...ref(r.datasheet_id), ability: r.name, kind: "removed" as const }))
  ]
    .filter((x) => !newOrGone.has(x.datasheetId))
    .sort(byName)

  const sd = diffs.Abilities
  const fac = (id: string) => factionName.get(id) ?? id
  const sharedAbilities = [
    ...sd.changed
      .filter(([a, b]) => textChanged(a.description, b.description) || a.name !== b.name)
      .map(([, b]) => ({ name: b.name, faction: fac(b.faction_id), kind: "changed" as const })),
    ...sd.added.map((r) => ({ name: r.name, faction: fac(r.faction_id), kind: "added" as const })),
    ...sd.removed.map((r) => ({ name: r.name, faction: fac(r.faction_id), kind: "removed" as const }))
  ].sort(byName)

  const ed = diffs.Enhancements
  const enhChanges = (a: Row, b: Row): FieldChanges => {
    const out: Record<string, readonly [string, string]> = { ...fieldChanges(a, b, ["cost", "name", "detachment", "upgrade"]) }
    if (textChanged(a.description, b.description)) out.text = ["", ""]
    return out
  }
  const enhancements = [
    ...ed.changed
      .map(([a, b]) => ({ name: b.name, faction: fac(b.faction_id), detachment: b.detachment, kind: "changed" as const, changes: enhChanges(a, b) }))
      .filter((x) => Object.keys(x.changes).length),
    ...ed.added.map((r) => ({ name: r.name, faction: fac(r.faction_id), detachment: r.detachment, kind: "added" as const, changes: {} })),
    ...ed.removed.map((r) => ({ name: r.name, faction: fac(r.faction_id), detachment: r.detachment, kind: "removed" as const, changes: {} }))
  ].sort(byName)

  const dd = diffs.Detachment_abilities
  const detachmentAbilities = [
    ...dd.changed
      .filter(([a, b]) => textChanged(a.description, b.description) || a.name !== b.name)
      .map(([, b]) => ({ name: b.name, faction: fac(b.faction_id), detachment: b.detachment, kind: "changed" as const })),
    ...dd.added.map((r) => ({ name: r.name, faction: fac(r.faction_id), detachment: r.detachment, kind: "added" as const })),
    ...dd.removed.map((r) => ({ name: r.name, faction: fac(r.faction_id), detachment: r.detachment, kind: "removed" as const }))
  ].sort(byName)

  return {
    from,
    to,
    tables,
    datasheets: {
      added: cut(diffs.Datasheets.added.map((d) => ref(d.id)).sort(byName), totals, "datasheetsAdded"),
      removed: cut(diffs.Datasheets.removed.map((d) => ref(d.id)).sort(byName), totals, "datasheetsRemoved")
    },
    points: cut(points, totals, "points"),
    weapons: cut(weapons, totals, "weapons"),
    models: cut(models, totals, "models"),
    abilities: cut(abilities, totals, "abilities"),
    sharedAbilities: cut(sharedAbilities, totals, "sharedAbilities"),
    enhancements: cut(enhancements, totals, "enhancements"),
    detachmentAbilities: cut(detachmentAbilities, totals, "detachmentAbilities"),
    totals
  }
}

/** Is there anything in the report beyond "nothing changed"? */
export const reportHasChanges = (r: ChangeReport) => r.tables.some((t) => t.added + t.removed + t.changed > 0)
