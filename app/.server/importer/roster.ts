/**
 * Roster importer: `.ros` / `.rosz` files from 40k.app, NewRecruit or
 * BattleScribe, plus the optional 40k.app text export for what rosters leave
 * out (points, enhancement costs, detachments, profile-less wargear).
 *
 * Ported step for step from the POC's `importer.js`; handoff section 8 is the
 * specification. `tests/importer-parity.test.ts` checks the output against the
 * POC's own for both fixture rosters.
 */
import { Effect, Schema } from "effect"
import { unzipSync } from "fflate"
import { parseDice, parseNum, parseWeaponKeywords } from "~/domain/keywords"
import type { Enhancement, Group, ListMeta, Role, Rule, RuleBook, Unit, UnitStats, Weapon, WeaponKw } from "~/domain/schema"
import { clean, norm, slug, titleCase } from "~/domain/text"
import { attr, descendants, kid, kids, parseXml, textContent, type XNode } from "./xml"

export class RosterParseError extends Schema.TaggedError<RosterParseError>()("RosterParseError", {
  message: Schema.String
}) {}

/** Lookups the importer needs beyond the roster itself. */
export interface ImportContext {
  /** The rules library, for matching abilities by name. */
  readonly library: RuleBook
  readonly factionArmyRules: Readonly<Record<string, ReadonlyArray<string>>>
  readonly detachmentRules: Readonly<Record<string, ReadonlyArray<string>>>
  readonly detachmentUnitGrants: Readonly<Record<string, ReadonlyArray<{ readonly name: string; readonly rule: string }>>>
}

export interface ImportStats {
  readonly units: number
  readonly models: number
  readonly weapons: number
  /** Rules matched to the library. */
  readonly known: number
  /** Rules read from the file. */
  readonly newRules: number
  /** …of which look like they change damage. */
  readonly todo: number
  readonly unknownDets: ReadonlyArray<string>
}

export interface ImportResult {
  readonly meta: ListMeta
  readonly units: Array<Unit>
  readonly groups: Record<string, Group>
  readonly armyRules: Array<string>
  readonly rules: Record<string, Rule>
  readonly warnings: Array<string>
  readonly stats: ImportStats
  readonly gameSystem: string
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type W = Mutable<Weapon> & { range?: string }
interface Item {
  w: W
  upg: string
  multi: boolean
  drop?: boolean
}
interface ModelGroup {
  n: number
  nm: string
  items: Array<Item>
  prof: Omit<UnitStats, "inv" | "invRangedOnly"> | null
  sig?: string
}
type DraftUnit = Mutable<Unit> & { _attachedTo: string | null; _ledBy: string | null; _support: boolean; rules: Array<string>; kw: Array<string> }

// ---------- weapon profile ----------

const characteristics = (p: XNode): Record<string, string> => {
  const ch: Record<string, string> = {}
  for (const c of descendants(p, "characteristic")) ch[attr(c, "name") ?? ""] = textContent(c).trim()
  return ch
}

function weaponFromProfile(p: XNode, count: number): W {
  const ch = characteristics(p)
  const melee = attr(p, "typeName") === "Melee Weapons" || /^melee$/i.test(ch.Range || "")
  const kw = parseWeaponKeywords(ch.Keywords)
  const skill = ch[melee ? "WS" : "BS"] || ""
  return {
    nm: clean(attr(p, "name")),
    t: melee ? "m" : "r",
    n: count,
    A: parseDice(ch.A),
    sk: /n\/a/i.test(skill) || kw.torrent ? 0 : parseNum(skill),
    S: parseNum(ch.S),
    AP: Math.abs(parseNum(ch.AP)),
    D: parseDice(ch.D),
    kw,
    range: ch.Range || ""
  }
}

const profKey = (w: W) => JSON.stringify([w.nm, w.t, w.A, w.sk, w.S, w.AP, w.D, w.kw])

const avgD = (x: number | string): number => {
  if (typeof x === "number") return x
  const m = String(x).match(/^(\d*)D(\d+)(?:\+(\d+))?$/)
  return m ? ((m[1] ? +m[1] : 1) * (+m[2] + 1)) / 2 + (m[3] ? +m[3] : 0) : 0
}

/** `y` is at least as good as `x` in every number, and has every keyword `x` has. */
function dominates(y: W, x: W): boolean {
  if (avgD(y.A) < avgD(x.A) || y.sk > x.sk || y.S < x.S || y.AP < x.AP || avgD(y.D) < avgD(x.D)) return false
  const kx = Object.keys(x.kw || {}).filter((k) => k !== "other")
  const ky = Object.keys(y.kw || {})
  return kx.every((k) => ky.includes(k)) && !(x.kw.other || []).length
}

// ---------- model groups ----------

function collectWeapons(sel: XNode, out: Array<Item>): Array<Item> {
  for (const s of kids(kid(sel, "selections"), "selection")) {
    if (attr(s, "type") === "model") continue
    const n = +(attr(s, "number") ?? 0) || 1
    const profs = kids(kid(s, "profiles"), "profile").filter((p) => /Weapons$/.test(attr(p, "typeName") || ""))
    for (const p of profs) out.push({ w: weaponFromProfile(p, n), upg: clean(attr(s, "name")), multi: profs.length > 1 })
    collectWeapons(s, out)
  }
  return out
}

function unitProfile(sel: XNode): ModelGroup["prof"] {
  const p = kids(kid(sel, "profiles"), "profile").find((x) => attr(x, "typeName") === "Unit")
  if (!p) return null
  const ch = characteristics(p)
  return { T: parseNum(ch.T), Sv: parseNum(ch.SV), W: parseNum(ch.W), M: ch.M, Ld: ch.LD, OC: ch.OC }
}

function modelGroups(top: XNode): Array<ModelGroup> {
  const groups: Array<ModelGroup> = []
  const group = (s: XNode): ModelGroup => ({
    n: +(attr(s, "number") ?? 0) || 1,
    nm: clean(attr(s, "name")),
    items: collectWeapons(s, []),
    prof: unitProfile(s)
  })
  if (attr(top, "type") === "model") groups.push(group(top))
  for (const s of kids(kid(top, "selections"), "selection")) if (attr(s, "type") === "model") groups.push(group(s))
  if (attr(top, "type") !== "model") {
    // weapons hanging off the unit itself rather than a model
    const loose = collectWeapons(top, [])
    if (loose.length) groups.push({ n: 0, nm: "unit wargear", items: loose, prof: unitProfile(top) })
  }
  return groups
}

// ---------- rules ----------

const STRUCTURAL = new Set(["attached to", "led by", "supported by", "leader", "support", "invulnerable save", "battle focus"])
const CORE = ["scouts", "stealth", "deep strike", "lone operative", "infiltrators", "deadly demise", "fights first", "feel no pain", "firing deck", "hover", "leader", "scout"]

/** "Damaged 4", "Deadly Demise D3", "Scouts 7"" → the name without its number. */
const baseName = (k: string) => k.replace(/ (d?\d+|x)$/, "").replace(/ once per .*$/, "").trim()

/** Heuristic: does this ability text read like it changes the damage this unit deals? */
export function looksOffensive(txt: string): boolean {
  const t = txt.toLowerCase()
  const terms =
    /hit roll|wound roll|strength characteristic|armour penetration|damage characteristic|re-?roll|\[(lethal|sustained|devastating|anti|twin|ignores|lance|precision|torrent|blast|melta|rapid)|critical (hit|wound)|attacks characteristic|mortal wound/.test(
      t
    )
  const ours = /makes an attack|makes a ranged attack|makes a melee attack|weapons equipped by|attacks? made by/.test(t)
  const theirs = /an attack targets (this|that) (unit|model)|attack (is )?allocated to|targets this unit|targets this model/.test(t)
  return terms && ours && !theirs
}

/**
 * Shown when a roster comes without its text export. 40k.app's roster files leave out wargear with
 * no weapon profile, which only the text export lists (found on 4 October with Faolchú).
 */
export const NO_TEXT_EXPORT =
  "No text export. 40k.app’s roster file leaves out wargear that has no weapon profile (Faolchú, Mistshields, Aspect Shrine Tokens, Forceshields…), so this list won’t have it. To include it, go back and paste the text export with the file. Points come from the Field Manual where it prices the unit; check the rest below."

// ---------- text export (points, enhancements, wargear names, detachments) ----------

export interface TextEntry {
  nm: string
  pts: number
  models: number | null
  enh: { nm: string; pts: number } | null
  gear: string
  tag: string
  section: string
  idx: number
}

export interface TextExport {
  name: string
  faction: string
  detachments: Array<string>
  mission: string
  units: Record<string, TextEntry>
  order: Array<string>
  entries: Array<TextEntry>
}

export function parseTextExport(text: string | null | undefined): TextExport {
  const out: TextExport = { name: "", faction: "", detachments: [], mission: "", units: {}, order: [], entries: [] }
  if (!text || !text.trim()) return out
  const lines = text.replace(/\r/g, "").split("\n")
  const head = lines.filter((l) => l.trim()).slice(0, 4)
  out.name = (head[0] || "").trim()
  const parts = (head[1] || "")
    .split(/\s*[·•|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length) {
    out.faction = parts[0]
    out.detachments = parts.slice(1)
  }
  const mis = lines.find((l) => /^\s*Mission:/i.test(l))
  if (mis) out.mission = mis.replace(/^\s*Mission:\s*/i, "").trim()
  let cur: TextEntry | null = null
  let curIndent = 0
  let section = ""
  for (const l of lines) {
    const sec = l.match(/^(\S.*?) \[(\d+) pts\]\s*$/)
    if (sec) {
      section = sec[1].trim()
      cur = null
      continue
    }
    const m = l.match(/^(\s+)(.+?) \[(\d+) pts\](?: \((\d+) models?\))?(?:\s*-\s*(.+?))?\s*$/)
    if (m) {
      cur = { nm: m[2].trim(), pts: +m[3], models: m[4] ? +m[4] : null, enh: null, gear: "", tag: m[5] || "", section, idx: out.entries.length }
      curIndent = m[1].length
      out.entries.push(cur)
      if (!out.units[norm(cur.nm)]) out.units[norm(cur.nm)] = cur
      out.order.push(norm(cur.nm))
      continue
    }
    if (cur && /^\s/.test(l) && l.match(/^\s*/)![0].length > curIndent) {
      const e = l.match(/Enhancement:\s*(.+?)\s*\(\+(\d+) pts\)/)
      if (e) cur.enh = { nm: e[1].trim(), pts: +e[2] }
      else cur.gear += " " + l.trim()
    } else if (!/^\s/.test(l)) cur = null
  }
  return out
}

// ---------- main ----------

const SECTIONS = ["Characters", "Battleline", "Dedicated transport", "Infantry", "Mounted", "Beasts and swarms", "Vehicles and monsters", "Other"]

/** Parse a roster (and optional text export) into a list. Throws `RosterParseError`. */
export function parseRosterSync(xmlText: string, exportText: string | null | undefined, ctx: ImportContext): ImportResult {
  const roster = parseXml(xmlText)
  if (!roster) throw new RosterParseError({ message: "That file isn’t valid roster XML." })
  if (roster.name !== "roster") {
    throw new RosterParseError({ message: "No <roster> found. Is this a BattleScribe, NewRecruit or 40k.app roster?" })
  }
  const txt = parseTextExport(exportText)
  const LIB = ctx.library
  const lib: Record<string, string> = {}
  for (const [id, r] of Object.entries(LIB)) lib[norm(r.nm)] = id

  const warnings: Array<string> = []
  const rules: Record<string, Rule> = {}
  const units: Array<DraftUnit> = []
  const armyFound = new Set<string>()
  const forces = descendants(roster, "force")
  const tops: Array<XNode> = []
  for (const f of forces) {
    for (const s of kids(kid(f, "selections"), "selection")) {
      const t = attr(s, "type")
      if (t === "unit" || t === "model") tops.push(s)
    }
  }

  const ids = new Set<string>()
  for (const top of tops) {
    const nm = clean(attr(top, "name"))
    let id = slug(nm)
    while (ids.has(id)) id += "-2"
    ids.add(id)
    const cats = descendants(top, "category")
      .map((c) => attr(c, "name"))
      .filter((c): c is string => !!c && !/^Faction:/i.test(c))
    const kw = [...new Set(cats.map((c) => c.toUpperCase()))]
    const isVM = kw.includes("VEHICLE") || kw.includes("MONSTER")

    // abilities
    const abil = kids(kid(top, "profiles"), "profile")
      .filter((p) => attr(p, "typeName") === "Abilities")
      .map((p) => ({
        nm: clean(attr(p, "name")),
        txt: clean(descendants(p, "characteristic").map(textContent).join(" "))
      }))
    const get = (n: string) => abil.find((a) => a.nm.toLowerCase() === n)
    const unitRules: Array<string> = []
    let enh: Mutable<Enhancement> | null = null
    for (const a of abil) {
      let name = a.nm
      let src = "Datasheet"
      if (/^enhancement:/i.test(name)) {
        name = name.replace(/^enhancement:\s*/i, "")
        src = "Enhancement"
      }
      const key = norm(name)
      if (src !== "Enhancement" && STRUCTURAL.has(key)) continue
      let rid = lib[key] || lib[baseName(key)]
      if (rid && LIB[rid].src === "Army rule") {
        armyFound.add(rid)
        continue
      }
      if (!rid) {
        rid = "imp-" + slug(name)
        if (!rules[rid]) {
          const core = CORE.some((c) => key.startsWith(c))
          const leader = /while this model is leading a unit/i.test(a.txt)
          const body = a.txt && a.txt.trim() !== "-" ? a.txt : "(no text in the roster file)"
          const shared = /leading a unit|a model in this unit|models in this unit/i.test(a.txt)
          rules[rid] = {
            nm: name,
            src: src === "Enhancement" ? "Enhancement" : core ? "Core" : leader ? "Leader" : "Datasheet",
            dmg: false,
            txt: body,
            imported: true,
            ...(shared ? { scope: "unit" as const } : {}),
            todo: !core && looksOffensive(a.txt)
          }
        }
      }
      if (src === "Enhancement") enh = { id: rid, nm: name, pts: 0 }
      if (!unitRules.includes(rid)) unitRules.push(rid)
    }

    // weapons: per model group, then merge groups with identical loadouts
    const groups = modelGroups(top).filter((g) => g.items.length || g.prof)
    const merged: Array<ModelGroup> = []
    for (const g of groups) {
      const sig = JSON.stringify(g.items.map((i) => profKey(i.w)).sort())
      const same = merged.find((m) => m.sig === sig)
      if (same) {
        same.n += g.n
        same.items.forEach((it) => {
          const o = g.items.find((x) => profKey(x.w) === profKey(it.w))
          if (o) it.w.n += o.w.n
        })
      } else merged.push({ ...g, sig })
    }
    const w: Array<W> = []
    merged.forEach((g, gi) => {
      const items: Array<Item> = g.items.map((i) => ({ ...i, w: { ...i.w } }))
      // one weapon with several profiles, or "Name - profile" siblings: pick one per attack
      const byBase: Record<string, Array<Item>> = {}
      items.forEach((i) => {
        const base = i.multi ? i.upg : i.w.nm.includes(" - ") ? i.w.nm.split(" - ")[0] : null
        if (base) (byBase[base] = byBase[base] || []).push(i)
      })
      for (const [base, list] of Object.entries(byBase)) {
        if (list.length > 1) list.forEach((i) => (i.w.alt = `p${gi}:${slug(base)}`))
      }
      // pistol rule
      const ranged = items.filter((i) => i.w.t === "r")
      if (!isVM && ranged.some((i) => !i.w.kw.pistol)) {
        ranged.filter((i) => i.w.kw.pistol).forEach((i) => (i.w.off = "Fires its other guns instead (pistol rule)"))
      }
      // melee: drop weapons that another option beats outright, then pick per target
      let melee = items.filter((i) => i.w.t === "m" && !i.w.kw.extra && !i.w.alt)
      melee = melee.filter((i) => !melee.some((j) => j !== i && dominates(j.w, i.w) && profKey(j.w) !== profKey(i.w)))
      if (melee.length > 1) melee.forEach((i) => (i.w.alt = `m${gi}:melee`))
      items.forEach((i) => {
        if (i.w.t === "m" && !i.w.kw.extra && !i.w.alt && !melee.includes(i)) i.drop = true
      })
      items.filter((i) => !i.drop).forEach((i) => w.push(i.w))
    })
    // merge identical rows that aren't choices
    const rows: Array<W> = []
    for (const x of w) {
      const same = !x.alt && rows.find((r) => !r.alt && profKey(r) === profKey(x) && (r.off || "") === (x.off || ""))
      if (same) same.n += x.n
      else rows.push(x)
    }
    rows.forEach((r) => {
      delete r.range
    })
    rows.sort((a, b) => (a.t === b.t ? 0 : a.t === "r" ? -1 : 1) || (a.off ? 1 : 0) - (b.off ? 1 : 0))
    const models = groups.reduce((s, g) => s + g.n, 0) || 1
    const prof = groups.find((g) => g.prof)?.prof ?? null
    const inv = get("invulnerable save")
    const u: DraftUnit = {
      id,
      nm,
      pts: 0,
      models,
      kw,
      rules: unitRules,
      w: rows,
      grp: null,
      role: null,
      cat: null,
      stats: prof ? { ...prof, inv: inv ? parseNum(inv.txt) : 0, invRangedOnly: inv ? /ranged attacks only/i.test(inv.txt) : false } : null,
      _attachedTo: get("attached to")?.txt || null,
      _ledBy: (get("led by") || get("supported by"))?.txt || null,
      _support: !!get("support") && !get("leader")
    }
    if (enh) u.enh = enh
    units.push(u)
  }

  // Points, enhancement costs and wargear from the text export. Match roster units to text-export
  // entries: unique exact names first, then by the attached-unit section their leader sits in
  // (text exports repeat names like "Outrider Squad"), then by name without an A/B letter.
  const used = new Set<number>()
  const match = new Map<DraftUnit, TextEntry>()
  const fuzzy = new Set<DraftUnit>()
  const E = txt.entries
  const take = (u: DraftUnit, e: TextEntry) => {
    match.set(u, e)
    used.add(e.idx)
  }
  const baseN = (s: string) => norm(s).replace(/ [a-z]$/, "")
  for (const u of units) {
    const c = E.filter((e) => !used.has(e.idx) && norm(e.nm) === norm(u.nm))
    if (c.length === 1) take(u, c[0])
  }
  for (const u of units) {
    if (match.has(u)) continue
    const partners = [u._ledBy, u._attachedTo]
      .filter(Boolean)
      .map((n) => units.find((x) => norm(x.nm) === norm(n)))
      .filter((x): x is DraftUnit => !!x)
    const lead = units.filter((x) => x._attachedTo && norm(x._attachedTo) === norm(u.nm))
    const secs = new Set(
      [...partners, ...lead]
        .map((x) => match.get(x))
        .filter((e): e is TextEntry => !!e)
        .map((e) => e.section)
    )
    const c = E.filter((e) => !used.has(e.idx) && secs.has(e.section) && baseN(e.nm) === baseN(u.nm))
    if (c.length) take(u, c.find((e) => e.models === u.models) || c[0])
  }
  for (const u of units) {
    if (match.has(u)) continue
    const c = E.filter((e) => !used.has(e.idx) && baseN(e.nm) === baseN(u.nm))
    const pick = c.find((e) => e.models === u.models) || c[0]
    if (pick) {
      take(u, pick)
      fuzzy.add(u)
    }
  }
  const haveText = Object.keys(txt.units).length > 0
  for (const u of units) {
    const t = match.get(u)
    if (!t) {
      if (haveText) warnings.push(`${u.nm}: not found in the text export, so it has no points yet.`)
      continue
    }
    if (fuzzy.has(u)) warnings.push(`${u.nm} matched to “${t.nm}” in the text export (${t.pts} pts) by name only. Check that’s the right one.`)
    if (/warlord/i.test(t.tag || "")) u.warlord = true
    u.pts = t.pts
    if (t.enh) {
      if (u.enh) u.enh = { ...u.enh, pts: t.enh.pts }
      else warnings.push(`${u.nm}: the text export lists ${t.enh.nm}, but the roster file doesn’t.`)
    }
    const gear = norm(t.gear)
    for (const [id, r] of Object.entries(LIB)) {
      if (r.src === "Wargear" && gear.includes(norm(r.nm)) && !u.rules.includes(id)) u.rules.push(id)
    }
  }
  const unmatched = E.filter((e) => !used.has(e.idx))
  if (unmatched.length) warnings.push(`In the text export but not the roster file: ${unmatched.map((e) => e.nm).join(", ")}.`)
  if (!haveText) warnings.push(NO_TEXT_EXPORT)

  // rules that grant other rules (e.g. Spirit Mark → Wraith Constructs)
  for (const id of new Set(units.flatMap((u) => u.rules))) {
    const g = LIB[id]?.grants
    if (g) units.forEach((u) => {
      if (u.kw.includes(g.kw) && !u.rules.includes(g.rule)) u.rules.push(g.rule)
    })
  }

  // leaders
  const byName = (n: string) => units.find((u) => norm(u.nm) === norm(n))
  const groups: Record<string, { bg: DraftUnit; leaders: Array<DraftUnit> }> = {}
  const order: Array<string> = []
  for (const u of units) {
    if (!u._attachedTo) continue
    const bg = byName(u._attachedTo)
    if (!bg) {
      warnings.push(`${u.nm} is attached to “${u._attachedTo}”, which isn’t in the roster.`)
      continue
    }
    const key = bg.id
    if (!groups[key]) {
      groups[key] = { bg, leaders: [] }
      order.push(key)
    }
    groups[key].leaders.push(u)
  }
  const pos = (u: DraftUnit) => {
    const e = match.get(u)
    return e ? e.idx : 999 + units.indexOf(u)
  }
  order.sort((a, b) => Math.min(...groups[a].leaders.map(pos), pos(groups[a].bg)) - Math.min(...groups[b].leaders.map(pos), pos(groups[b].bg)))
  const short = (n: string) => n.replace(/^Corsair /, "").replace(/^Prince /, "")
  const G: Record<string, Group> = {}
  order.forEach((k, i) => {
    const L = String.fromCharCode(65 + i)
    const g = groups[k]
    G[L] = { nm: `Attached unit ${L}`, short: [...g.leaders.map((l) => short(l.nm)), short(g.bg.nm)].join(" + ") }
    g.leaders.forEach((l) => {
      l.grp = L
      l.role = l._support ? "Support" : "Leader"
    })
    g.bg.grp = L
    g.bg.role = "Bodyguard"
  })

  // sections for everything else
  for (const u of units) {
    const k = u.kw
    u.cat = k.includes("CHARACTER")
      ? "Characters"
      : k.includes("BATTLELINE")
        ? "Battleline"
        : k.includes("DEDICATED TRANSPORT")
          ? "Dedicated transport"
          : k.includes("VEHICLE") || k.includes("MONSTER")
            ? "Vehicles and monsters"
            : k.includes("MOUNTED")
              ? "Mounted"
              : k.includes("INFANTRY")
                ? "Infantry"
                : k.includes("BEASTS") || k.includes("SWARM")
                  ? "Beasts and swarms"
                  : "Other"
    if (u.grp && u.role !== "Bodyguard" && !u.kw.includes("CHARACTER")) u.cat = "Characters"
    if (u._ledBy && !u.grp) warnings.push(`${u.nm} says it’s led by ${u._ledBy}, but that leader doesn’t point back to it.`)
  }
  const roleOrder: Record<Role, number> = { Leader: 0, Support: 1, Bodyguard: 2 }
  units.sort((a, b) => {
    if (a.grp || b.grp) {
      if (!a.grp) return 1
      if (!b.grp) return -1
      if (a.grp !== b.grp) return a.grp < b.grp ? -1 : 1
      return roleOrder[a.role!] - roleOrder[b.role!]
    }
    return SECTIONS.indexOf(a.cat!) - SECTIONS.indexOf(b.cat!) || pos(a) - pos(b)
  })

  // army and detachment rules we know about
  const army: Array<string> = []
  const force = forces[0] ?? null
  const facKey = norm(txt.faction || attr(force, "catalogueName") || "")
  for (const id of ctx.factionArmyRules[facKey] || []) army.push(id)
  armyFound.forEach((id) => {
    if (!army.includes(id)) army.push(id)
  })
  const dets = txt.detachments
  const unknownDets: Array<string> = []
  for (const d of dets) {
    const r = ctx.detachmentRules[norm(d)]
    if (r) {
      for (const id of r) if (!army.includes(id)) army.push(id)
    } else unknownDets.push(d)
  }

  const faction = txt.faction || attr(force, "catalogueName") || ""
  const meta: Mutable<ListMeta> = {
    name: titleCase(txt.name || clean(attr(roster, "name")) || "Imported list"),
    faction,
    detachments: dets,
    mission: txt.mission
  }
  meta.sub = [meta.faction, dets.join(" and "), meta.mission].filter(Boolean).join(", ") + ". Imported from a roster file."

  // detachment rules that hand a named unit an extra ability (e.g. Wrath of the First Khan)
  for (const id of army) {
    for (const g of ctx.detachmentUnitGrants[id] || []) {
      units.forEach((u) => {
        if (norm(u.nm).includes(g.name) && !u.rules.includes(g.rule)) u.rules.push(g.rule)
      })
    }
  }
  if (unknownDets.length) warnings.push(`No rules library yet for ${unknownDets.join(" or ")}. Its detachment rules won’t show until we add them.`)

  const finished: Array<Unit> = units.map(({ _attachedTo, _ledBy, _support, ...u }) => u)
  const stats: ImportStats = {
    units: finished.length,
    models: finished.reduce((s, u) => s + u.models, 0),
    weapons: finished.reduce((s, u) => s + u.w.length, 0),
    known: [...new Set(finished.flatMap((u) => u.rules).concat(army))].filter((id) => LIB[id]).length,
    newRules: Object.keys(rules).length,
    todo: Object.values(rules).filter((r) => r.todo).length,
    unknownDets
  }
  return { meta, units: finished, groups: G, armyRules: army, rules, warnings, stats, gameSystem: attr(roster, "gameSystemName") || "" }
}

/**
 * Units read again from a list's roster file, keeping the prices it was saved
 * with wherever the file has none. A roster file without its text export
 * carries no points (the import review prices it from the Field Manual), so
 * re-reading it would otherwise put every unit back to 0 pts. Units are
 * matched by id, which comes from the unit's name in the file.
 */
export function keepPrices(reread: ReadonlyArray<Unit>, saved: ReadonlyArray<Unit>): Array<Unit> {
  const before = new Map(saved.map((u) => [u.id, u]))
  return reread.map((u) => {
    const was = before.get(u.id)
    if (!was || u.pts) return u
    // pts includes the enhancement's: keep the unit's own share, and the enhancement's price if it's the same one
    const enh = u.enh && !u.enh.pts && was.enh?.nm === u.enh.nm ? { ...u.enh, pts: was.enh.pts } : u.enh
    return { ...u, pts: was.pts - (was.enh?.pts ?? 0) + (enh?.pts ?? 0), enh, datasheetId: u.datasheetId ?? was.datasheetId }
  })
}

/** `parseRosterSync` as an Effect with a typed failure. */
export const parseRoster = (xmlText: string, exportText: string | null | undefined, ctx: ImportContext) =>
  Effect.try({
    try: () => parseRosterSync(xmlText, exportText, ctx),
    catch: (e) => (e instanceof RosterParseError ? e : new RosterParseError({ message: e instanceof Error ? e.message : String(e) }))
  })

/** Roster XML from an uploaded file: plain `.ros`, or the first `.ros` inside a `.rosz` zip. */
export const readRosterFile = (bytes: Uint8Array) =>
  Effect.try({
    try: () => {
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
      if (!isZip) return new TextDecoder("utf-8").decode(bytes)
      const files = unzipSync(bytes)
      const names = Object.keys(files).filter((n) => !n.endsWith("/"))
      const entry = names.find((n) => /\.ros$/i.test(n)) ?? names[0]
      if (!entry) throw new RosterParseError({ message: "The .rosz archive is empty." })
      return new TextDecoder("utf-8").decode(files[entry])
    },
    catch: (e) => (e instanceof RosterParseError ? e : new RosterParseError({ message: "Couldn’t read that file as a roster." }))
  })

export type { WeaponKw }
