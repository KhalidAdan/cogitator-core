/**
 * Field Manual snapshots in SQLite. One row per faction per distinct set of
 * prices; the parsed page is stored as a JSON document (a faction is ~100
 * units, so there is nothing to gain from normalising it).
 */
import { DateTime, Effect, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { createHash } from "node:crypto"
import { FieldManual } from "./parse"

export interface ManualChange {
  readonly kind: "unit" | "wargear" | "enhancement" | "detachment"
  /** Unit or enhancement name; for an enhancement, `in` is its detachment. */
  readonly name: string
  readonly in?: string
  /** `5 models (your 1st to 2nd units cost)`, `detachment points`… */
  readonly line: string
  readonly from: number | null
  readonly to: number | null
}

export interface ManualSnapshot {
  readonly id: number
  readonly slug: string
  readonly faction: string
  readonly version: string
  readonly fetchedAt: string
  readonly manual: FieldManual
  /** Against the previous snapshot; for the first one, the changes the page itself marks. */
  readonly changes: ReadonlyArray<ManualChange>
  /** Whether `changes` came from comparing two snapshots or from the page's own markers. */
  readonly changesFrom: "previous" | "page"
}

export interface ManualStatus {
  readonly slug: string
  readonly checkedAt: string | null
  readonly ok: boolean
  readonly message: string
  readonly latest: Omit<ManualSnapshot, "manual"> | null
  readonly snapshots: number
}

const ManualJson = Schema.fromJsonString(FieldManual)
const decodeManual = Schema.decodeUnknownSync(ManualJson)
const encodeManual = Schema.encodeSync(ManualJson)

/** Snapshots kept per faction. */
const KEEP = 6

/** What makes two fetches "the same prices": everything but the page's own change markers. */
export function manualHash(m: FieldManual): string {
  const essence = {
    version: m.version,
    units: m.units.map((u) => [u.name, u.costs.map((c) => [c.tier, c.description, c.cost]), u.wargear.map((c) => [c.description, c.cost])]),
    detachments: m.detachments.map((d) => [d.name, d.dp, d.dispositions, d.unique, d.enhancements.map((e) => [e.name, e.cost])])
  }
  return createHash("sha256").update(JSON.stringify(essence)).digest("hex")
}

const lineLabel = (c: { tier: string; description: string }) =>
  c.tier ? `${c.description} (${c.tier.toLowerCase().replace(/^your /, "").replace(/ units? costs?$/, "")} units)` : c.description

/** Price changes between two versions of a faction's page. */
export function diffManuals(prev: FieldManual, next: FieldManual): Array<ManualChange> {
  const out: Array<ManualChange> = []
  const lines = (m: FieldManual, kind: "costs" | "wargear") => {
    const map = new Map<string, { name: string; line: string; cost: number }>()
    for (const u of m.units) for (const c of u[kind]) map.set(`${u.name}\u0001${c.tier}\u0001${c.description}`, { name: u.name, line: lineLabel(c), cost: c.cost })
    return map
  }
  for (const kind of ["costs", "wargear"] as const) {
    const a = lines(prev, kind)
    const b = lines(next, kind)
    const k = kind === "costs" ? "unit" : "wargear"
    for (const [key, n] of b) {
      const p = a.get(key)
      if (!p) out.push({ kind: k, name: n.name, line: n.line, from: null, to: n.cost })
      else if (p.cost !== n.cost) out.push({ kind: k, name: n.name, line: n.line, from: p.cost, to: n.cost })
    }
    for (const [key, p] of a) if (!b.has(key)) out.push({ kind: k, name: p.name, line: p.line, from: p.cost, to: null })
  }
  const enh = (m: FieldManual) => new Map(m.detachments.flatMap((d) => d.enhancements.map((e) => [`${d.name}\u0001${e.name}`, { d: d.name, ...e }] as const)))
  const ea = enh(prev)
  const eb = enh(next)
  for (const [key, n] of eb) {
    const p = ea.get(key)
    if (!p) out.push({ kind: "enhancement", name: n.name, in: n.d, line: "enhancement", from: null, to: n.cost })
    else if (p.cost !== n.cost) out.push({ kind: "enhancement", name: n.name, in: n.d, line: "enhancement", from: p.cost, to: n.cost })
  }
  for (const [key, p] of ea) if (!eb.has(key)) out.push({ kind: "enhancement", name: p.name, in: p.d, line: "enhancement", from: p.cost, to: null })
  const da = new Map(prev.detachments.map((d) => [d.name, d]))
  const db = new Map(next.detachments.map((d) => [d.name, d]))
  for (const [name, n] of db) {
    const p = da.get(name)
    if (!p) out.push({ kind: "detachment", name, line: "detachment points", from: null, to: n.dp })
    else if (p.dp !== n.dp) out.push({ kind: "detachment", name, line: "detachment points", from: p.dp, to: n.dp })
  }
  for (const [name, p] of da) if (!db.has(name)) out.push({ kind: "detachment", name, line: "detachment points", from: p.dp, to: null })
  return out
}

/** The changes a page marks against its own previous version (the ▲ and ▼ figures). */
export function markedChanges(m: FieldManual): Array<ManualChange> {
  const out: Array<ManualChange> = []
  for (const u of m.units) {
    for (const c of u.costs) if (c.delta !== null) out.push({ kind: "unit", name: u.name, line: lineLabel(c), from: c.cost - c.delta, to: c.cost })
    for (const c of u.wargear) if (c.delta !== null) out.push({ kind: "wargear", name: u.name, line: c.description, from: c.cost - c.delta, to: c.cost })
  }
  for (const d of m.detachments) {
    for (const e of d.enhancements) if (e.delta !== null) out.push({ kind: "enhancement", name: e.name, in: d.name, line: "enhancement", from: e.cost - e.delta, to: e.cost })
  }
  return out
}

type Row = { id: number; slug: string; faction: string; version: string; fetched_at: string; data: string; changes: string; changes_from: string }

const toSnapshot = (r: Row): ManualSnapshot => ({
  id: r.id,
  slug: r.slug,
  faction: r.faction,
  version: r.version,
  fetchedAt: r.fetched_at,
  manual: decodeManual(r.data),
  changes: JSON.parse(r.changes) as Array<ManualChange>,
  changesFrom: r.changes_from === "previous" ? "previous" : "page"
})

/** The newest snapshot for a faction page. */
export const latestManual = Effect.fn("mfm.latestManual")(function*(slug: string) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<Row>`SELECT * FROM mfm_snapshots WHERE slug = ${slug} ORDER BY id DESC LIMIT 1`.pipe(Effect.orDie)
  return Option.fromNullishOr(rows[0]).pipe(Option.map(toSnapshot))
})

/**
 * Store a freshly parsed page if its prices differ from the newest snapshot.
 * Returns the stored snapshot, or `null` when nothing changed.
 */
export const saveManual = Effect.fn("mfm.saveManual")(function*(slug: string, manual: FieldManual) {
  const sql = yield* SqlClient.SqlClient
  const hash = manualHash(manual)
  const previous = Option.getOrUndefined(yield* latestManual(slug))
  if (previous && manualHash(previous.manual) === hash) return null
  const changes = previous ? diffManuals(previous.manual, manual) : markedChanges(manual)
  const fetchedAt = DateTime.formatIso(yield* DateTime.now)
  yield* sql.withTransaction(Effect.gen(function*() {
    yield* sql`
      INSERT INTO mfm_snapshots (slug, faction, version, fetched_at, hash, data, changes, changes_from)
      VALUES (${slug}, ${manual.faction}, ${manual.version}, ${fetchedAt}, ${hash}, ${encodeManual(manual)},
              ${JSON.stringify(changes)}, ${previous ? "previous" : "page"})
    `
    yield* sql`
      DELETE FROM mfm_snapshots WHERE slug = ${slug} AND id NOT IN (
        SELECT id FROM mfm_snapshots WHERE slug = ${slug} ORDER BY id DESC LIMIT ${KEEP}
      )
    `
  })).pipe(Effect.orDie)
  return Option.getOrThrow(yield* latestManual(slug))
})

/** Record that a faction page was looked at, whether or not it had changed. */
export const recordCheck = Effect.fn("mfm.recordCheck")(function*(slug: string, ok: boolean, message: string) {
  const sql = yield* SqlClient.SqlClient
  const at = DateTime.formatIso(yield* DateTime.now)
  yield* sql`
    INSERT INTO mfm_checks (slug, checked_at, ok, message) VALUES (${slug}, ${at}, ${ok ? 1 : 0}, ${message})
    ON CONFLICT (slug) DO UPDATE SET checked_at = excluded.checked_at, ok = excluded.ok, message = excluded.message
  `.pipe(Effect.orDie)
})

/** Every faction that has been checked or stored, with its newest snapshot (without the prices themselves). */
export const manualStatuses = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const [checks, snaps] = yield* Effect.all([
    sql<{ slug: string; checked_at: string; ok: number; message: string }>`SELECT slug, checked_at, ok, message FROM mfm_checks`,
    sql<Omit<Row, "data"> & { n: number }>`
      SELECT s.id, s.slug, s.faction, s.version, s.fetched_at, s.changes, s.changes_from,
             (SELECT COUNT(*) FROM mfm_snapshots x WHERE x.slug = s.slug) AS n
      FROM mfm_snapshots s WHERE s.id IN (SELECT MAX(id) FROM mfm_snapshots GROUP BY slug)
    `
  ]).pipe(Effect.orDie)
  const slugs = [...new Set([...checks.map((c) => c.slug), ...snaps.map((s) => s.slug)])].sort()
  return slugs.map((slug): ManualStatus => {
    const c = checks.find((x) => x.slug === slug)
    const s = snaps.find((x) => x.slug === slug)
    return {
      slug,
      checkedAt: c?.checked_at ?? null,
      ok: c ? c.ok !== 0 : true,
      message: c?.message ?? "",
      snapshots: s?.n ?? 0,
      latest: s
        ? {
            id: s.id,
            slug: s.slug,
            faction: s.faction,
            version: s.version,
            fetchedAt: s.fetched_at,
            changes: JSON.parse(s.changes) as Array<ManualChange>,
            changesFrom: s.changes_from === "previous" ? "previous" : "page"
          }
        : null
    }
  })
})

/** When a faction page was last looked at, as epoch milliseconds. */
export const lastChecked = Effect.fn("mfm.lastChecked")(function*(slug: string) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ checked_at: string }>`SELECT checked_at FROM mfm_checks WHERE slug = ${slug}`.pipe(Effect.orDie)
  return rows[0] ? Date.parse(rows[0].checked_at) : null
})
