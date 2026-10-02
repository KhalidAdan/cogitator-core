/**
 * Read model over the current Wahapedia snapshot: datasheets with everything
 * that hangs off them, as the rest of the app wants to see them. Rule text is
 * returned as plain text; numbers stay as the export's strings until a caller
 * needs them as numbers.
 */
import { Effect, Option } from "effect"
import { SqlClient } from "effect/sql"
import { norm, stripHtml } from "~/domain/text"

export interface DatasheetSummary {
  readonly id: string
  readonly name: string
  readonly factionId: string
  readonly faction: string
  readonly role: string
  readonly source: string
  /** Legends and Forge World datasheets: real, but not what a matched-play list should resolve to first. */
  readonly legacy: boolean
  readonly virtual: boolean
}

export interface ModelProfile {
  readonly name: string
  readonly M: string
  readonly T: string
  readonly Sv: string
  readonly inv: string
  readonly invNote: string
  readonly W: string
  readonly Ld: string
  readonly OC: string
}

export interface WargearProfile {
  readonly name: string
  /** Ability list as written: `assault, melta 3`. */
  readonly abilities: string
  readonly range: string
  readonly type: string
  readonly A: string
  readonly skill: string
  readonly S: string
  readonly AP: string
  readonly D: string
}

export interface DatasheetAbility {
  readonly name: string
  readonly text: string
  /** Core, Faction, Datasheet, Wargear… */
  readonly type: string
  readonly parameter: string
  readonly model: string
}

export interface CostLine {
  /** `YOUR 1ST TO 2ND UNITS COST`, or empty when the datasheet has one price list. */
  readonly tier: string
  /** `5 models`, `per Multi-melta`… */
  readonly description: string
  readonly cost: number
}

export interface Datasheet extends DatasheetSummary {
  readonly link: string
  readonly isSupport: boolean
  readonly loadout: string
  readonly damaged: string
  readonly models: ReadonlyArray<ModelProfile>
  readonly wargear: ReadonlyArray<WargearProfile>
  readonly abilities: ReadonlyArray<DatasheetAbility>
  readonly keywords: ReadonlyArray<string>
  readonly factionKeywords: ReadonlyArray<string>
  readonly costs: ReadonlyArray<CostLine>
  readonly composition: ReadonlyArray<string>
  readonly options: ReadonlyArray<string>
  /** Bodyguard datasheets this one can lead. */
  readonly leads: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly ledBy: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

export interface EnhancementInfo {
  readonly id: string
  readonly name: string
  readonly factionId: string
  readonly cost: number
  readonly detachment: string
  readonly text: string
}

export interface DetachmentInfo {
  readonly id: string
  readonly name: string
  readonly factionId: string
  readonly type: string
  readonly dp: string
  readonly forceDisposition: string
  readonly abilities: ReadonlyArray<{ readonly name: string; readonly text: string }>
}

type Rows = ReadonlyArray<Record<string, string>>

export const currentSnapshotId = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ id: number | null }>`SELECT MAX(id) AS id FROM wh_snapshots`
  return Option.fromNullishOr(rows[0]?.id)
}).pipe(Effect.orDie)

const LEGACY = /legends|forge world/i

/** Every datasheet in a snapshot, lightly. ~1,700 rows; cheap enough to index in memory per request. */
export const allDatasheets = Effect.fn("wahapedia.allDatasheets")(function*(snapshotId: number) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<Record<string, string>>`
    SELECT d.id, d.name, d.faction_id, d.role, d."virtual" AS is_virtual,
           COALESCE(f.name, d.faction_id) AS faction, COALESCE(s.name, '') AS source
    FROM wh_datasheets d
    LEFT JOIN wh_factions f ON f.snapshot_id = d.snapshot_id AND f.id = d.faction_id
    LEFT JOIN wh_sources s ON s.snapshot_id = d.snapshot_id AND s.id = d.source_id
    WHERE d.snapshot_id = ${snapshotId}
    ORDER BY d.name, d.id
  `.pipe(Effect.orDie)
  return rows.map((r): DatasheetSummary => ({
    id: r.id,
    name: r.name,
    factionId: r.faction_id,
    faction: r.faction,
    role: r.role,
    source: r.source,
    legacy: LEGACY.test(r.source),
    virtual: r.is_virtual === "true"
  }))
})

export const factions = Effect.fn("wahapedia.factions")(function*(snapshotId: number) {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ id: string; name: string; datasheets: number }>`
    SELECT f.id, f.name, COUNT(d.id) AS datasheets
    FROM wh_factions f LEFT JOIN wh_datasheets d ON d.snapshot_id = f.snapshot_id AND d.faction_id = f.id
    WHERE f.snapshot_id = ${snapshotId}
    GROUP BY f.id ORDER BY f.name
  `.pipe(Effect.orDie)
})

const group = (rows: Rows, key = "datasheet_id") => {
  const m = new Map<string, Array<Record<string, string>>>()
  for (const r of rows) {
    const list = m.get(r[key])
    if (list) list.push(r)
    else m.set(r[key], [r])
  }
  return m
}

/** Cost rows carry their tier as a header line above them; fold it into each priced line. */
export function costLines(rows: Rows): Array<CostLine> {
  const out: Array<CostLine> = []
  let tier = ""
  for (const r of [...rows].sort((a, b) => +a.line - +b.line)) {
    const description = stripHtml(r.description)
    const cost = r.cost.trim()
    if (!cost) tier = /^your units? costs?$/i.test(description) ? "" : description
    else if (/^\d+$/.test(cost)) out.push({ tier, description, cost: +cost })
  }
  // Space Marine datasheets repeat the same block once per pricing variant; collapse exact repeats
  return out.filter((c, i) => out.findIndex((o) => o.tier === c.tier && o.description === c.description && o.cost === c.cost) === i)
}

/** Full datasheets for the given ids. Unknown ids are simply absent from the result. */
export const datasheets = Effect.fn("wahapedia.datasheets")(function*(snapshotId: number, ids: ReadonlyArray<string>) {
  if (ids.length === 0) return new Map<string, Datasheet>()
  const sql = yield* SqlClient.SqlClient
  const inIds = sql.in(ids)
  const q = <A extends object = Record<string, string>>(table: string, column = "datasheet_id", order = "row_num") =>
    sql<A>`SELECT * FROM ${sql.literal(table)} WHERE snapshot_id = ${snapshotId} AND ${sql.literal(column)} IN ${inIds} ORDER BY ${sql.literal(order)}`

  const [heads, models, wargear, abilities, keywords, costs, composition, options, leads, ledBy, shared, summaries] = yield* Effect.all([
    q("wh_datasheets", "id"),
    q("wh_datasheet_models"),
    q("wh_datasheet_wargear"),
    q("wh_datasheet_abilities"),
    q("wh_datasheet_keywords"),
    q("wh_datasheet_models_cost"),
    q("wh_datasheet_unit_composition"),
    q("wh_datasheet_options"),
    q("wh_datasheet_leaders", "leader_id"),
    q("wh_datasheet_leaders", "attached_id"),
    sql<Record<string, string>>`SELECT id, name, description, faction_id FROM wh_abilities WHERE snapshot_id = ${snapshotId}`,
    allDatasheets(snapshotId)
  ]).pipe(Effect.orDie)

  const summary = new Map(summaries.map((s) => [s.id, s]))
  const sharedById = group(shared, "id")
  const byLine = (rows: Array<Record<string, string>> | undefined) => [...(rows ?? [])].sort((a, b) => +a.line - +b.line)
  const g = {
    models: group(models),
    wargear: group(wargear),
    abilities: group(abilities),
    keywords: group(keywords),
    costs: group(costs),
    composition: group(composition),
    options: group(options),
    leads: group(leads, "leader_id"),
    ledBy: group(ledBy, "attached_id")
  }
  const named = (id: string) => ({ id, name: summary.get(id)?.name ?? id })
  const uniq = <A>(list: Array<A>, key: (a: A) => string) => list.filter((a, i) => list.findIndex((b) => key(b) === key(a)) === i)

  const out = new Map<string, Datasheet>()
  for (const h of heads) {
    const s = summary.get(h.id)
    if (!s) continue
    const kw = g.keywords.get(h.id) ?? []
    out.set(h.id, {
      ...s,
      link: h.link,
      isSupport: h.is_support === "true",
      loadout: stripHtml(h.loadout),
      damaged: h.damaged_w ? `${h.damaged_w}: ${stripHtml(h.damaged_description)}` : "",
      models: byLine(g.models.get(h.id)).map((m) => ({
        name: m.name,
        M: m.M,
        T: m.T,
        Sv: m.Sv,
        inv: m.inv_sv,
        invNote: stripHtml(m.inv_sv_descr),
        W: m.W,
        Ld: m.Ld,
        OC: m.OC
      })),
      wargear: (g.wargear.get(h.id) ?? []).map((w) => ({
        name: w.name,
        abilities: stripHtml(w.description),
        range: w.range,
        type: w.type,
        A: w.A,
        skill: w.BS_WS,
        S: w.S,
        AP: w.AP,
        D: w.D
      })),
      abilities: byLine(g.abilities.get(h.id)).map((a) => {
        // a filled ability_id means "take the name and text from Abilities.csv"
        const ref = a.ability_id ? (sharedById.get(a.ability_id) ?? []) : []
        const linked = ref.find((x) => x.faction_id === h.faction_id) ?? ref[0]
        return {
          name: linked?.name || a.name,
          text: stripHtml(linked?.description || a.description),
          type: a.type,
          parameter: a.parameter,
          model: a.model
        }
      }),
      keywords: [...new Set(kw.filter((k) => k.is_faction_keyword !== "true" && k.keyword).map((k) => k.keyword))],
      factionKeywords: [...new Set(kw.filter((k) => k.is_faction_keyword === "true" && k.keyword).map((k) => k.keyword))],
      costs: costLines(g.costs.get(h.id) ?? []),
      composition: byLine(g.composition.get(h.id)).map((c) => stripHtml(c.description)),
      options: byLine(g.options.get(h.id)).map((o) => stripHtml(o.description)).filter((o) => o && o !== "None"),
      leads: uniq((g.leads.get(h.id) ?? []).map((l) => named(l.attached_id)), (x) => x.id),
      ledBy: uniq((g.ledBy.get(h.id) ?? []).map((l) => named(l.leader_id)), (x) => x.id)
    })
  }
  return out
})

/** Just the price lines for some datasheets: the cheap query behind comparing Wahapedia's points with the Field Manual's. */
export const costsFor = Effect.fn("wahapedia.costsFor")(function*(snapshotId: number, ids: ReadonlyArray<string>) {
  const out = new Map<string, Array<CostLine>>()
  if (ids.length === 0) return out
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<Record<string, string>>`
    SELECT datasheet_id, line, description, cost FROM wh_datasheet_models_cost
    WHERE snapshot_id = ${snapshotId} AND datasheet_id IN ${sql.in(ids)}
  `.pipe(Effect.orDie)
  for (const [id, list] of group(rows)) out.set(id, costLines(list))
  return out
})

/** The version of the Munitorum Field Manual a Wahapedia export says it was built from, if it says. */
export const exportManualVersion = Effect.fn("wahapedia.exportManualVersion")(function*(snapshotId: number) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ version: string }>`
    SELECT version FROM wh_sources WHERE snapshot_id = ${snapshotId} AND name = 'Munitorum Field Manual' AND version <> ''
  `.pipe(Effect.orDie)
  return rows[0] ? `v${rows[0].version.replace(/^v/i, "")}` : null
})

export const enhancements = Effect.fn("wahapedia.enhancements")(function*(snapshotId: number) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<Record<string, string>>`
    SELECT id, name, faction_id, cost, detachment, description FROM wh_enhancements WHERE snapshot_id = ${snapshotId}
  `.pipe(Effect.orDie)
  return rows.map((r): EnhancementInfo => ({
    id: r.id,
    name: r.name,
    factionId: r.faction_id,
    cost: parseInt(r.cost, 10) || 0,
    detachment: r.detachment,
    text: stripHtml(r.description)
  }))
})

export const detachments = Effect.fn("wahapedia.detachments")(function*(snapshotId: number) {
  const sql = yield* SqlClient.SqlClient
  const [dets, abilities] = yield* Effect.all([
    sql<Record<string, string>>`SELECT id, name, faction_id, type, dp, force_disposition FROM wh_detachments WHERE snapshot_id = ${snapshotId}`,
    sql<Record<string, string>>`SELECT name, description, detachment_id FROM wh_detachment_abilities WHERE snapshot_id = ${snapshotId} ORDER BY row_num`
  ]).pipe(Effect.orDie)
  const byDet = group(abilities, "detachment_id")
  return dets.map((d): DetachmentInfo => ({
    id: d.id,
    name: d.name,
    factionId: d.faction_id,
    type: d.type,
    dp: d.dp,
    forceDisposition: d.force_disposition,
    abilities: (byDet.get(d.id) ?? []).map((a) => ({ name: a.name, text: stripHtml(a.description) }))
  }))
})

/** Datasheet browser: name contains `q`, optionally within one faction. */
export const searchDatasheets = Effect.fn("wahapedia.searchDatasheets")(
  function*(snapshotId: number, q: string, factionId: string | null, limit = 200) {
    const needle = norm(q)
    const all = yield* allDatasheets(snapshotId)
    return all
      .filter((d) => (!factionId || d.factionId === factionId) && (!needle || norm(d.name).includes(needle)))
      .slice(0, limit)
  }
)

/** Every piece of rule text in the snapshot that goes by a name, for linking library rules to their source. */
export interface NamedText {
  readonly kind: "datasheet-ability" | "enhancement" | "detachment-ability" | "ability"
  readonly name: string
  readonly factionId: string
  readonly text: string
}

export const namedTexts = Effect.fn("wahapedia.namedTexts")(function*(snapshotId: number) {
  const sql = yield* SqlClient.SqlClient
  const [abil, enh, det, shared] = yield* Effect.all([
    sql<Record<string, string>>`
      SELECT a.name, a.description, d.faction_id FROM wh_datasheet_abilities a
      JOIN wh_datasheets d ON d.snapshot_id = a.snapshot_id AND d.id = a.datasheet_id
      WHERE a.snapshot_id = ${snapshotId} AND a.name <> ''
    `,
    sql<Record<string, string>>`SELECT name, description, faction_id FROM wh_enhancements WHERE snapshot_id = ${snapshotId}`,
    sql<Record<string, string>>`SELECT name, description, faction_id FROM wh_detachment_abilities WHERE snapshot_id = ${snapshotId}`,
    sql<Record<string, string>>`SELECT name, description, faction_id FROM wh_abilities WHERE snapshot_id = ${snapshotId}`
  ]).pipe(Effect.orDie)
  const map = (kind: NamedText["kind"]) => (r: Record<string, string>): NamedText => ({
    kind,
    name: r.name,
    factionId: r.faction_id,
    text: stripHtml(r.description)
  })
  return [
    ...abil.map(map("datasheet-ability")),
    ...enh.map(map("enhancement")),
    ...det.map(map("detachment-ability")),
    ...shared.map(map("ability"))
  ]
})
