/**
 * Check a list against the rules database: does every unit resolve to a
 * datasheet, and do its points, weapon profiles, stats and abilities agree?
 * This is the "roster says X, database says Y" report from the roadmap, and
 * the basis for applying database values to a list.
 *
 * Two sources, each used for what it is best at. Profiles, stats and abilities
 * come from the Wahapedia snapshot. Points come from the Munitorum Field Manual
 * when it has been fetched for the list's faction, because it is the official
 * source and is updated first; Wahapedia's points are the fallback.
 *
 * The comparison itself (`checkUnit`) is pure; `checkList` fetches what it
 * needs.
 */
import { Effect, Option } from "effect"
import { listRuleBook } from "~/domain/book"
import { keywordText, parseDice, parseNum, parseWeaponKeywords } from "~/domain/keywords"
import type { ArmyList, RuleBook, Unit, Weapon } from "~/domain/schema"
import { norm } from "~/domain/text"
import { memo } from "../memo"
import { fieldManualSlug } from "../mfm/factions"
import type { FieldManual, ManualUnit } from "../mfm/parse"
import { latestManual } from "../mfm/store"
import {
  allDatasheets,
  type CostLine,
  currentSnapshotId,
  type Datasheet,
  datasheets,
  type DatasheetSummary,
  type DetachmentInfo,
  detachments,
  type EnhancementInfo,
  enhancements,
  type WargearProfile
} from "./queries"

// ---------- factions ----------

/** List faction names (as rosters and text exports write them) → Wahapedia faction id. */
const FACTION_ALIASES: Record<string, string> = {
  aeldari: "AE",
  asuryani: "AE",
  ynnari: "AE",
  harlequins: "AE",
  craftworlds: "AE",
  drukhari: "DRU",
  "space marines": "SM",
  "adeptus astartes": "SM",
  "white scars": "SM",
  ultramarines: "SM",
  "imperial fists": "SM",
  "iron hands": "SM",
  "raven guard": "SM",
  salamanders: "SM",
  "blood angels": "SM",
  "dark angels": "SM",
  "space wolves": "SM",
  "black templars": "SM",
  deathwatch: "SM"
}

export function factionIdFor(faction: string | undefined, known: ReadonlyArray<DatasheetSummary>): string | null {
  const key = norm(faction)
  if (!key) return null
  if (FACTION_ALIASES[key]) return FACTION_ALIASES[key]
  return known.find((d) => norm(d.faction) === key)?.factionId ?? null
}

// ---------- result ----------

export type Change = readonly [list: string, db: string]

export interface WeaponCheck {
  readonly nm: string
  /** Index into the unit's weapon rows. */
  readonly index: number
  readonly status: "ok" | "differs" | "missing"
  /** Database name, when it isn't spelled the same way. */
  readonly matchedAs?: string
  readonly changes: Readonly<Record<string, Change>>
  /** The row as the database has it, for applying. */
  readonly db?: Pick<Weapon, "A" | "sk" | "S" | "AP" | "D" | "kw">
}

export type PointsSource = "field-manual" | "wahapedia"

export interface PointsCheck {
  /** Unit cost in the list, without its enhancement. */
  readonly list: number
  /** Prices the source allows for this many models. */
  readonly options: ReadonlyArray<CostLine>
  readonly ok: boolean
  /** The single price for this unit's place in the list, when there is exactly one. */
  readonly expected: number | null
  readonly note: string
  readonly source: PointsSource
}

export interface UnitCheck {
  readonly unitId: string
  readonly unit: string
  readonly datasheet: Pick<Datasheet, "id" | "name" | "faction" | "source" | "link" | "legacy"> | null
  /** How many datasheets shared the name. */
  readonly candidates: number
  readonly points: PointsCheck | null
  readonly enhancement: {
    readonly name: string
    readonly list: number
    readonly db: number | null
    readonly detachment: string
    readonly ok: boolean
    readonly source: PointsSource
  } | null
  readonly stats: Readonly<Record<string, Change>>
  /** The database's profile, for applying. */
  readonly dbStats: { readonly T: number; readonly Sv: number; readonly W: number; readonly inv: number; readonly invRangedOnly: boolean } | null
  readonly weapons: ReadonlyArray<WeaponCheck>
  readonly abilities: { readonly notOnUnit: ReadonlyArray<string>; readonly notInDatabase: ReadonlyArray<string> }
  readonly leader: string | null
  /** Number of things that disagree. */
  readonly issues: number
  /** …of which are prices: the unit's own cost and its enhancement's. */
  readonly pointsIssues: number
}

export interface ListCheck {
  /** The Wahapedia snapshot profiles were checked against, if one is loaded. */
  readonly snapshot: { readonly id: number } | null
  /** The Field Manual points were checked against, if it has been fetched for this faction. */
  readonly manual: { readonly slug: string; readonly faction: string; readonly version: string; readonly fetchedAt: string } | null
  readonly factionId: string | null
  readonly units: ReadonlyArray<UnitCheck>
  readonly detachments: ReadonlyArray<{ readonly name: string; readonly found: DetachmentInfo | null }>
  readonly totals: {
    readonly matched: number
    readonly unmatched: number
    readonly issues: number
    readonly pointsIssues: number
    readonly pointsList: number
    /** The list's total at the source's prices, when every unit has exactly one. */
    readonly pointsDb: number | null
  }
}

// ---------- matching ----------

const unitNameKeys = (nm: string) => {
  const n = norm(nm)
  // 40k.app letters repeated units: "Outrider Squad B"
  return [n, n.replace(/ [a-z]$/, "")]
}

export function pickDatasheet(
  unit: Unit,
  index: ReadonlyMap<string, ReadonlyArray<DatasheetSummary>>,
  factionId: string | null
): { pick: DatasheetSummary | null; candidates: number } {
  for (const key of unitNameKeys(unit.nm)) {
    const c = index.get(key)
    if (!c?.length) continue
    const score = (d: DatasheetSummary) => (factionId && d.factionId === factionId ? 4 : 0) + (d.legacy ? 0 : 2) + (d.virtual ? 0 : 1)
    const pick = [...c].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0]
    return { pick, candidates: c.length }
  }
  return { pick: null, candidates: 0 }
}

/** Weapon names as lists write them: "Neuro disruptor (Felarch)" → "neuro disruptor". */
const weaponKey = (nm: string) => norm(nm.replace(/\([^)]*\)/g, ""))

/**
 * Rosters split a weapon with a ranged and a melee profile by type ("Guardian
 * spear - ranged"); the datasheet gives both rows the one name and tells them
 * apart by type, which `findWargear` already filters on.
 */
const TYPE_SUFFIX = /\s*[-–—]\s*(ranged|melee)\s*$/i

function findWargear(nm: string, wargear: ReadonlyArray<WargearProfile>, melee: boolean): { w: WargearProfile; exact: boolean } | null {
  const sameType = wargear.filter((w) => (w.type === "Melee") === melee)
  const pool = sameType.length ? sameType : wargear
  const loose = (s: string) => s.replace(/s$/, "")
  // the name as written first, so a datasheet that really has a "… - melee" row still wins
  for (const key of new Set([weaponKey(nm), weaponKey(nm.replace(TYPE_SUFFIX, ""))])) {
    const exact = pool.find((w) => norm(w.name) === key)
    if (exact) return { w: exact, exact: true }
    // "Chainsword" ↔ "Astartes chainsword", "Fragstorm Grenade Launchers" ↔ "Fragstorm grenade launcher"
    const near = pool.filter((w) => {
      const k = norm(w.name)
      return loose(k) === loose(key) || k.endsWith(" " + key) || key.endsWith(" " + k)
    })
    if (near.length === 1) return { w: near[0], exact: false }
  }
  return null
}

const dbSkill = (s: string) => (/n\/a|^-$/i.test(s.trim()) ? 0 : parseNum(s))

function toEngine(w: WargearProfile): NonNullable<WeaponCheck["db"]> {
  const kw = parseWeaponKeywords(w.abilities)
  return { A: parseDice(w.A), sk: kw.torrent ? 0 : dbSkill(w.skill), S: parseNum(w.S), AP: Math.abs(parseNum(w.AP)), D: parseDice(w.D), kw }
}

function checkWeapon(w: Weapon, index: number, sheet: Datasheet): WeaponCheck {
  const found = findWargear(w.nm, sheet.wargear, w.t === "m")
  if (!found) return { nm: w.nm, index, status: "missing", changes: {} }
  const db = toEngine(found.w)
  const changes: Record<string, Change> = {}
  const cmp = (label: string, a: unknown, b: unknown) => {
    if (String(a).toUpperCase() !== String(b).toUpperCase()) changes[label] = [String(a), String(b)]
  }
  cmp("A", w.A, db.A)
  cmp(w.t === "m" ? "WS" : "BS", w.sk, db.sk)
  cmp("S", w.S, db.S)
  cmp("AP", w.AP, db.AP)
  cmp("D", w.D, db.D)
  const mine = keywordText({ kw: w.kw })
  const theirs = keywordText({ kw: db.kw })
  if (mine !== theirs) changes.Abilities = [mine || "none", theirs || "none"]
  return {
    nm: w.nm,
    index,
    status: Object.keys(changes).length ? "differs" : "ok",
    ...(found.exact ? {} : { matchedAs: found.w.name }),
    changes,
    db
  }
}

const ORDINAL = /(\d+)(?:ST|ND|RD|TH)/g

/** `YOUR 1ST TO 2ND UNITS COST` → [1, 2]; `YOUR 3RD + UNIT COSTS` → [3, ∞]; no tier → [1, ∞]. */
export function tierRange(tier: string): readonly [number, number] {
  const nums = [...tier.toUpperCase().matchAll(ORDINAL)].map((m) => +m[1])
  if (!nums.length) return [1, Infinity]
  if (nums.length > 1) return [nums[0], nums[1]]
  return /\+/.test(tier) ? [nums[0], Infinity] : [nums[0], nums[0]]
}

/** Positions of a Field Manual's units by normalised name, built once per (cached, unchanging) manual. */
const manualIndexes = new WeakMap<FieldManual, Map<string, Array<number>>>()
function manualIndex(manual: FieldManual): Map<string, Array<number>> {
  let index = manualIndexes.get(manual)
  if (!index) {
    index = new Map()
    manual.units.forEach((u, i) => {
      const k = norm(u.name)
      const at = index!.get(k)
      if (at) at.push(i)
      else index!.set(k, [i])
    })
    manualIndexes.set(manual, index)
  }
  return index
}

/** A unit in the Field Manual by the list's name for it ("Outrider Squad B") or its datasheet's. */
export function manualUnitFor(manual: FieldManual | null, unit: Unit, sheetName?: string): ManualUnit | null {
  if (!manual) return null
  const keys = new Set([...unitNameKeys(unit.nm), ...(sheetName ? [norm(sheetName)] : [])])
  const index = manualIndex(manual)
  // in the page's own order, as a scan of its units would find them
  const found = [...new Set([...keys].flatMap((k) => index.get(k) ?? []))].sort((a, b) => a - b).map((i) => manual.units[i])
  if (found.length <= 1) return found[0] ?? null
  // Some pages price a unit twice (Imperial Agents: in its own detachment, and as an assigned agent).
  // The list doesn't say which applies, so every price is an acceptable one.
  return { ...found[0], costs: found.flatMap((u) => u.costs), wargear: found.flatMap((u) => u.wargear) }
}

/**
 * How many models a price line is for. Usually it says so (`5 models`); a few
 * units are priced by composition instead (`1 Sword Brother, 4 Neophytes, 5
 * Initiates`, `11 Gretchin`), where it is the sum. Wargear and add-on lines
 * (`per Storm Shield`, `+ 1 Invader ATV`) aren't unit sizes at all.
 */
export function modelCount(description: string): number | null {
  if (/^(per |\+)/i.test(description.trim())) return null
  const parts = description.split(",").map((part) => /^\s*(\d+)\s+\S/.exec(part))
  if (!parts.length || parts.some((m) => !m)) return null
  return parts.reduce((n, m) => n + +m![1], 0)
}

/** An enhancement's price in the Field Manual, preferring the list's own detachments. */
function manualEnhancement(manual: FieldManual | null, name: string, detachmentNames: ReadonlyArray<string>) {
  if (!manual) return null
  const key = norm(name)
  const dets = new Set(detachmentNames.map(norm))
  const all = manual.detachments.flatMap((d) => d.enhancements.filter((e) => norm(e.name) === key).map((e) => ({ cost: e.cost, detachment: d.name })))
  return all.find((e) => dets.has(norm(e.detachment))) ?? (new Set(all.map((e) => e.cost)).size === 1 ? all[0] : null)
}

/** Whether `extra` points are made of the wargear costs, each bought at most `most` times (once per model). */
function wargearMakes(extra: number, wargear: ReadonlyArray<number>, most: number): boolean {
  if (extra === 0) return true
  let made = new Set([0])
  for (const cost of wargear) {
    if (cost <= 0) continue
    const next = new Set(made)
    for (const m of made) for (let k = 1; k <= most && m + k * cost <= extra; k++) next.add(m + k * cost)
    made = next
  }
  return made.has(extra)
}

/**
 * A unit's price against the source's. `wargear` is what the source charges per item on top ("per Storm Shield",
 * 5): a list price that is the unit's price plus some of those is right, and stays the price to keep, since the
 * file doesn't say how many were bought.
 */
function checkPoints(
  unit: Unit,
  costs: ReadonlyArray<CostLine>,
  position: number,
  source: PointsSource,
  wargear: ReadonlyArray<number>
): PointsCheck {
  const list = unit.pts - (unit.enh?.pts ?? 0)
  const where = source === "field-manual" ? "The Field Manual" : "The database"
  const forSize = costs.filter((c) => modelCount(c.description) === unit.models)
  if (!forSize.length) {
    return { list, options: [], ok: false, expected: null, note: `${where} has no price for ${unit.models} models of this unit.`, source }
  }
  const here = forSize.filter((c) => {
    const [lo, hi] = tierRange(c.tier)
    return position >= lo && position <= hi
  })
  const prices = [...new Set((here.length ? here : forSize).map((c) => c.cost))]
  const exact = forSize.some((c) => c.cost === list)
  const withWargear = exact || list <= 0 ? undefined : (here.length ? here : forSize).find((c) => list > c.cost && wargearMakes(list - c.cost, wargear, unit.models))
  return {
    list,
    options: forSize,
    ok: exact || !!withWargear,
    expected: withWargear ? list : prices.length === 1 ? prices[0] : null,
    note: withWargear
      ? `${withWargear.cost} pts plus ${list - withWargear.cost} pts of wargear.`
      : wargear.length
        ? "This unit also has wargear costs; check those by hand."
        : "",
    source
  }
}

function checkStats(unit: Unit, sheet: Datasheet): Pick<UnitCheck, "stats" | "dbStats"> {
  if (!sheet.models.length) return { stats: {}, dbStats: null }
  const parsed = sheet.models.map((m) => ({
    T: parseNum(m.T),
    Sv: parseNum(m.Sv),
    W: parseNum(m.W),
    inv: /\d/.test(m.inv) ? parseNum(m.inv) : 0,
    invRangedOnly: /ranged attacks only/i.test(m.invNote)
  }))
  const s = unit.stats
  if (!s) return { stats: {}, dbStats: parsed[0] }
  const eq = (p: (typeof parsed)[number]) => p.T === s.T && p.Sv === s.Sv && p.W === s.W && p.inv === (s.inv ?? 0)
  // a unit with several model profiles (an Exarch with more wounds) is fine if it matches any of them
  const match = parsed.find(eq)
  if (match) return { stats: {}, dbStats: match }
  const p = parsed[0]
  const stats: Record<string, Change> = {}
  if (p.T !== s.T) stats.T = [String(s.T), String(p.T)]
  if (p.Sv !== s.Sv) stats.Sv = [`${s.Sv}+`, `${p.Sv}+`]
  if (p.W !== s.W) stats.W = [String(s.W), String(p.W)]
  if (p.inv !== (s.inv ?? 0)) stats.Invuln = [s.inv ? `${s.inv}+` : "none", p.inv ? `${p.inv}+` : "none"]
  return { stats, dbStats: p }
}

/** Ability types that every unit of a faction has, or that are bookkeeping rather than rules on the unit. */
const STRUCTURAL_ABILITIES = new Set(["leader", "support", "invulnerable save", "attached to", "led by", "supported by"])

function checkAbilities(unit: Unit, sheet: Datasheet, rules: RuleBook): UnitCheck["abilities"] {
  // "Fury of the Void (Psychic)" and "Scouts 7"" are the same rules as their bare names
  const base = (s: string) => norm(s.replace(/\([^)]*\)/g, "")).replace(/ (d?\d+|x)$/, "")
  const mine = unit.rules.map((id) => rules[id]).filter(Boolean)
  const mineKeys = new Set(mine.flatMap((r) => [norm(r.nm), base(r.nm)]))
  const theirs = sheet.abilities.filter((a) => a.name && !STRUCTURAL_ABILITIES.has(norm(a.name)))
  const theirKeys = new Set(theirs.flatMap((a) => [norm(a.name), base(a.name)]))
  return {
    // wargear abilities are optional equipment, so their absence from a unit is not a mismatch
    notOnUnit: theirs.filter((a) => a.type === "Datasheet" && !mineKeys.has(norm(a.name)) && !mineKeys.has(base(a.name))).map((a) => a.name),
    notInDatabase: mine
      .filter((r) => ["Datasheet", "Leader", "Core"].includes(r.src) && !theirKeys.has(norm(r.nm)) && !theirKeys.has(base(r.nm)))
      .map((r) => r.nm)
  }
}

export interface CheckContext {
  readonly candidates: number
  /** 1 for the first unit of this kind in the list, 2 for the second… */
  readonly position: number
  readonly rules: RuleBook
  readonly enhancements: ReadonlyArray<EnhancementInfo>
  readonly factionId: string | null
  readonly detachmentNames: ReadonlyArray<string>
  /** Datasheet of the bodyguard this unit leads or supports, if any. */
  readonly attachedTo: { readonly unit: Unit; readonly sheetId: string | null } | null
  /** The Field Manual for the list's faction, when it has been fetched. */
  readonly manual: FieldManual | null
}

/** Points for a unit and its enhancement: from the Field Manual where it has them, else from the datasheet. */
function checkPrices(unit: Unit, sheet: Datasheet | null, ctx: CheckContext): Pick<UnitCheck, "points" | "enhancement" | "pointsIssues"> {
  const fromManual = manualUnitFor(ctx.manual, unit, sheet?.name)
  const points = fromManual
    ? checkPoints(unit, fromManual.costs, ctx.position, "field-manual", fromManual.wargear.map((w) => w.cost))
    : sheet
      ? checkPoints(unit, sheet.costs, ctx.position, "wahapedia", sheet.costs.filter((c) => /^per |^\+/i.test(c.description)).map((c) => c.cost))
      : null
  let enhancement: UnitCheck["enhancement"] = null
  if (unit.enh) {
    const m = manualEnhancement(ctx.manual, unit.enh.nm, ctx.detachmentNames)
    if (m) {
      enhancement = { name: unit.enh.nm, list: unit.enh.pts, db: m.cost, detachment: m.detachment, ok: m.cost === unit.enh.pts, source: "field-manual" }
    } else {
      const key = norm(unit.enh.nm)
      const named = ctx.enhancements.filter((e) => norm(e.name) === key)
      const dets = new Set(ctx.detachmentNames.map(norm))
      const e =
        named.find((x) => x.factionId === ctx.factionId && dets.has(norm(x.detachment))) ??
        named.find((x) => x.factionId === ctx.factionId) ??
        (named.length === 1 ? named[0] : undefined)
      enhancement = {
        name: unit.enh.nm,
        list: unit.enh.pts,
        db: e?.cost ?? null,
        detachment: e?.detachment ?? "",
        ok: !!e && e.cost === unit.enh.pts,
        source: "wahapedia"
      }
    }
  }
  return { points, enhancement, pointsIssues: (points && !points.ok ? 1 : 0) + (enhancement && !enhancement.ok ? 1 : 0) }
}

export function checkUnit(unit: Unit, sheet: Datasheet | null, ctx: CheckContext): UnitCheck {
  const prices = checkPrices(unit, sheet, ctx)
  if (!sheet) {
    return {
      unitId: unit.id,
      unit: unit.nm,
      datasheet: null,
      candidates: 0,
      ...prices,
      stats: {},
      dbStats: null,
      weapons: [],
      abilities: { notOnUnit: [], notInDatabase: [] },
      leader: null,
      // with no datasheet there is nothing to compare profiles with; that is itself worth a look
      issues: prices.pointsIssues + 1
    }
  }
  const { stats, dbStats } = checkStats(unit, sheet)
  const weapons = unit.w.map((w, i) => checkWeapon(w, i, sheet))
  const abilities = checkAbilities(unit, sheet, ctx.rules)
  let leader: string | null = null
  if (ctx.attachedTo && (unit.role === "Leader" || unit.role === "Support")) {
    const ok = ctx.attachedTo.sheetId ? sheet.leads.some((l) => l.id === ctx.attachedTo!.sheetId) : true
    if (!ok) leader = `The database doesn’t list ${ctx.attachedTo.unit.nm} among the units ${sheet.name} can join.`
  }
  return {
    unitId: unit.id,
    unit: unit.nm,
    datasheet: { id: sheet.id, name: sheet.name, faction: sheet.faction, source: sheet.source, link: sheet.link, legacy: sheet.legacy },
    candidates: ctx.candidates,
    ...prices,
    stats,
    dbStats,
    weapons,
    abilities,
    leader,
    issues: prices.pointsIssues + (Object.keys(stats).length ? 1 : 0) + weapons.filter((w) => w.status !== "ok").length + (leader ? 1 : 0)
  }
}

/** Datasheets by normalised name; several share a name across factions. */
function nameIndex(all: ReadonlyArray<DatasheetSummary>): ReadonlyMap<string, ReadonlyArray<DatasheetSummary>> {
  const index = new Map<string, Array<DatasheetSummary>>()
  for (const d of all) {
    const k = norm(d.name)
    const l = index.get(k)
    if (l) l.push(d)
    else index.set(k, [d])
  }
  return index
}

/** Where each unit sits among units of the same kind, for tiered prices ("your 3rd+ unit costs…"). */
function positions(units: ReadonlyArray<Unit>, keyOf: (u: Unit, i: number) => string | null): Array<number> {
  const seen = new Map<string, number>()
  return units.map((u, i) => {
    const key = keyOf(u, i)
    if (key === null) return 1
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return n
  })
}

/**
 * Check a whole list. Profiles need a Wahapedia snapshot and points need
 * either that or the Field Manual; with neither loaded, both `snapshot` and
 * `manual` are null and there is nothing to report.
 */
export const checkList = Effect.fn("wahapedia.checkList")(function*(list: Pick<ArmyList, "units" | "meta" | "rules">, library: RuleBook) {
  const snapshot = Option.getOrUndefined(yield* currentSnapshotId)
  const slug = fieldManualSlug(list.meta.faction)
  const stored = slug ? Option.getOrUndefined(yield* latestManual(slug)) : undefined
  const manual = stored?.manual ?? null
  const manualInfo = stored ? { slug: stored.slug, faction: stored.faction, version: stored.version, fetchedAt: stored.fetchedAt } : null
  const pointsList = list.units.reduce((s, u) => s + u.pts, 0)
  const rules = listRuleBook(library, list.rules)
  const detachmentNames = list.meta.detachments ?? []

  const all = snapshot === undefined ? [] : yield* allDatasheets(snapshot)
  const index = snapshot === undefined ? new Map<string, Array<DatasheetSummary>>() : yield* memo("datasheetIndex", snapshot, Effect.sync(() => nameIndex(all)), 2)
  const factionId = factionIdFor(list.meta.faction, all)
  const picks = list.units.map((u) => {
    const known = u.datasheetId ? all.find((d) => d.id === u.datasheetId) : undefined
    return known ? { pick: known, candidates: 1 } : pickDatasheet(u, index, factionId)
  })
  const sheets = snapshot === undefined ? new Map<string, Datasheet>() : yield* datasheets(snapshot, [...new Set(picks.flatMap((p) => (p.pick ? [p.pick.id] : [])))])
  const [enh, dets] = snapshot === undefined ? [[], []] : yield* Effect.all([enhancements(snapshot), detachments(snapshot)])

  const sheetOf = (i: number) => (picks[i].pick ? (sheets.get(picks[i].pick!.id) ?? null) : null)
  const place = positions(list.units, (u, i) => manualUnitFor(manual, u, sheetOf(i)?.name)?.name ?? sheetOf(i)?.id ?? null)
  const units = list.units.map((u, i) => {
    const bodyguardIndex = u.grp && u.role !== "Bodyguard" ? list.units.findIndex((x) => x.grp === u.grp && x.role === "Bodyguard") : -1
    return checkUnit(u, sheetOf(i), {
      candidates: picks[i].candidates,
      position: place[i],
      rules,
      enhancements: enh,
      factionId,
      detachmentNames,
      attachedTo: bodyguardIndex >= 0 ? { unit: list.units[bodyguardIndex], sheetId: picks[bodyguardIndex].pick?.id ?? null } : null,
      manual
    })
  })

  const matched = units.filter((u) => u.datasheet).length
  const everyPriced = units.length > 0 && units.every((u) => u.points?.expected != null)
  return {
    snapshot: snapshot === undefined ? null : { id: snapshot },
    manual: manualInfo,
    factionId,
    units: snapshot === undefined && !manual ? [] : units,
    detachments: detachmentNames.map((name) => ({
      name,
      found: dets.find((d) => norm(d.name) === norm(name) && (!factionId || d.factionId === factionId)) ?? dets.find((d) => norm(d.name) === norm(name)) ?? null
    })),
    totals: {
      matched,
      unmatched: units.length - matched,
      issues: units.reduce((s, u) => s + u.issues, 0),
      pointsIssues: units.reduce((s, u) => s + u.pointsIssues, 0),
      pointsList,
      pointsDb: everyPriced ? units.reduce((s, u) => s + (u.points?.expected ?? 0) + (u.enhancement?.db ?? u.enhancement?.list ?? 0), 0) : null
    }
  } satisfies ListCheck
})

/** What the Field Manual says a list's units should cost, without touching the Wahapedia snapshot. */
export interface PointsDrift {
  readonly slug: string
  readonly faction: string
  readonly version: string
  readonly fetchedAt: string
  /** Units whose price, or whose enhancement's price, isn't the Field Manual's. */
  readonly units: ReadonlyArray<{ readonly unitId: string; readonly unit: string }>
  /** The list's total at Field Manual prices, when every unit has exactly one. */
  readonly total: number | null
}

/**
 * The cheap check behind the notice on every list page: are this list's points
 * still the Field Manual's? `null` when the Field Manual hasn't been fetched
 * for the faction.
 */
export const pointsDrift = Effect.fn("wahapedia.pointsDrift")(function*(list: Pick<ArmyList, "units" | "meta">) {
  const slug = fieldManualSlug(list.meta.faction)
  const stored = slug ? Option.getOrUndefined(yield* latestManual(slug)) : undefined
  if (!stored) return null
  const manual = stored.manual
  const place = positions(list.units, (u) => manualUnitFor(manual, u)?.name ?? null)
  const ctx = { candidates: 0, rules: {}, enhancements: [], factionId: null, detachmentNames: list.meta.detachments ?? [], attachedTo: null, manual }
  const checks = list.units.map((u, i) => ({ u, c: checkPrices(u, null, { ...ctx, position: place[i] }) }))
  const priced = checks.every(({ c }) => c.points?.expected != null)
  return {
    slug: stored.slug,
    faction: stored.faction,
    version: stored.version,
    fetchedAt: stored.fetchedAt,
    units: checks.filter(({ c }) => c.pointsIssues > 0).map(({ u }) => ({ unitId: u.id, unit: u.nm })),
    total: priced ? checks.reduce((s, { u, c }) => s + (c.points?.expected ?? 0) + (c.enhancement?.db ?? u.enh?.pts ?? 0), 0) : null
  } satisfies PointsDrift
})

// ---------- the differences, side by side ----------

/** A weapon profile as the tables print it. */
export interface ProfileCells {
  readonly A: string
  readonly skill: string
  readonly S: string
  readonly AP: string
  readonly D: string
  readonly abilities: string
}

export interface StatCells {
  readonly T: string
  readonly Sv: string
  readonly W: string
  readonly inv: string
}

export interface WeaponDiff {
  readonly nm: string
  readonly melee: boolean
  /** The datasheet's name for it, when it isn't spelled the same way. */
  readonly matchedAs: string | null
  readonly list: ProfileCells
  /** Null when the datasheet has no such weapon. */
  readonly db: ProfileCells | null
  readonly changed: ReadonlyArray<keyof ProfileCells>
}

/**
 * Where a unit's profile disagrees with its datasheet, with both sides in
 * full so they can be read against each other. Neither side is "the old one":
 * Wahapedia can lag a codex, so which is right is the reader's call.
 */
export interface ProfileDiff {
  readonly stats: { readonly list: StatCells; readonly db: StatCells; readonly changed: ReadonlyArray<keyof StatCells> } | null
  readonly weapons: ReadonlyArray<WeaponDiff>
  readonly leader: string | null
  /** Whether `applyProfiles` would change anything: a weapon missing from the datasheet can't be taken from it. */
  readonly applicable: boolean
}

const profileCells = (w: Pick<Weapon, "A" | "sk" | "S" | "AP" | "D" | "kw">): ProfileCells => ({
  A: String(w.A),
  skill: w.kw?.torrent || !w.sk ? "N/A" : `${w.sk}+`,
  S: String(w.S),
  AP: w.AP ? `-${w.AP}` : "0",
  D: String(w.D),
  abilities: keywordText({ kw: w.kw })
})

const statCells = (s: { T: number; Sv: number; W: number; inv?: number }): StatCells => ({
  T: String(s.T),
  Sv: `${s.Sv}+`,
  W: String(s.W),
  inv: s.inv ? `${s.inv}+` : "none"
})

const WEAPON_CELL: Record<string, keyof ProfileCells> = { A: "A", WS: "skill", BS: "skill", S: "S", AP: "AP", D: "D", Abilities: "abilities" }
const STAT_CELL: Record<string, keyof StatCells> = { T: "T", Sv: "Sv", W: "W", Invuln: "inv" }

export function profileDiff(unit: Unit, check: UnitCheck): ProfileDiff {
  const statsDiffer = Object.keys(check.stats).length > 0 && !!unit.stats && !!check.dbStats
  const weapons = check.weapons.flatMap((c): Array<WeaponDiff> => {
    const row = unit.w[c.index]
    if (c.status === "ok" || !row) return []
    return [{
      nm: c.nm,
      melee: row.t === "m",
      matchedAs: c.matchedAs ?? null,
      list: profileCells(row),
      db: c.db ? profileCells(c.db) : null,
      changed: Object.keys(c.changes).flatMap((k) => (WEAPON_CELL[k] ? [WEAPON_CELL[k]] : []))
    }]
  })
  return {
    stats: statsDiffer
      ? {
          list: statCells(unit.stats!),
          db: statCells(check.dbStats!),
          changed: Object.keys(check.stats).flatMap((k) => (STAT_CELL[k] ? [STAT_CELL[k]] : []))
        }
      : null,
    weapons,
    leader: check.leader,
    applicable: statsDiffer || weapons.some((w) => w.db !== null)
  }
}

// ---------- applying ----------

/**
 * A unit with the database's values written over the list's: weapon profiles
 * and unit stats wherever the database had a match, and points where the
 * source has exactly one price for the unit. Anything it couldn't resolve is
 * left as the list had it.
 */
export function applyCheck(unit: Unit, check: UnitCheck): Unit {
  return applyProfiles(applyPoints(unit, check), check)
}

/** A unit with only its profiles taken from the database: weapon rows and unit stats. Points are left alone. */
export function applyProfiles(unit: Unit, check: UnitCheck): Unit {
  if (!check.datasheet) return unit
  const w = unit.w.map((row, i) => {
    const c = check.weapons.find((x) => x.index === i)
    return c?.db ? { ...row, ...c.db } : row
  })
  return {
    ...unit,
    datasheetId: check.datasheet.id,
    ...(check.dbStats ? { stats: { ...(unit.stats ?? { M: null, Ld: null, OC: null }), ...check.dbStats } } : {}),
    w
  }
}

/** A unit with only its points brought up to date: its own cost and its enhancement's. Profiles are left alone. */
export function applyPoints(unit: Unit, check: UnitCheck): Unit {
  const enhPts = check.enhancement?.db ?? unit.enh?.pts ?? 0
  const base = check.points?.expected ?? unit.pts - (unit.enh?.pts ?? 0)
  return {
    ...unit,
    pts: base + (unit.enh ? enhPts : 0),
    ...(unit.enh ? { enh: { ...unit.enh, pts: enhPts } } : {})
  }
}
