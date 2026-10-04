/**
 * Cogitator Core for AI agents, over MCP, at /cogitator-core/mcp.
 *
 * Every call is signed in: the person's MCP client gets an OAuth access token
 * through the site's sign-in and consent pages (see .server/auth), and each
 * call is checked against it and recorded as theirs in the usage log. The
 * tools read and score; nothing an agent sets is saved. A caller sees what they
 * would see signed in on the site: the built-in lists and their own by name,
 * and any list by its link. The site's owner also gets three tools of their
 * own: the usage report, checking for updates, and connected apps.
 *
 * Scores come from the same engine and view model as the pages.
 */
import { Effect } from "effect"
import { describeRule } from "~/domain/fx"
import { unitPts } from "~/domain/engine"
import { keywordText } from "~/domain/keywords"
import { allAttackers, attack, availableMarks, availableOrders, type Ledger, matrix, situations } from "~/domain/ledger"
import { applyIntent, defaultOpts, type OptsIntent } from "~/domain/options"
import type { ArmyList, Mod, Opts, RuleBook, Target, Unit } from "~/domain/schema"
import { Lists } from "../repos/Lists"
import { Rules } from "../repos/Rules"
import { Targets } from "../repos/Targets"
import { run } from "../runtime"
import { listedFor } from "~/viewer"
import { connectedApps, listAccounts, type McpCaller, MCP_PATH, oauthClient, revokeApps, verifyMcpRequest } from "../auth/auth"
import { updateByHand } from "../updates"
import { noteUsage, usageReport } from "../usage"
import { type JsonSchema, type McpServer, type McpTool, serveMcp, type ToolResult } from "./protocol"

export { MCP_PATH }

type Args = Readonly<Record<string, unknown>>

class ToolError extends Error {}

const pct = (n: number) => Math.round(n)
const f2 = (n: number | undefined) => (n === undefined ? "–" : (Math.round(n * 100) / 100).toString())
const percent = (n: number | undefined) => (n === undefined ? "–" : `${Math.round(n * 1000) / 10}%`)
const obj = (v: unknown): Args => (v && typeof v === "object" && !Array.isArray(v) ? (v as Args) : {})
const arr = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : [])
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

// ---------- loading ----------

/** A list's id from an id or a link to any of its pages. */
const listId = (ref: unknown) => {
  const v = String(ref ?? "").trim()
  const m = v.match(/\/lists\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : v
}

interface Loaded {
  readonly list: ArmyList
  readonly rules: RuleBook
  readonly targets: ReadonlyArray<Target>
}

async function load(ref: unknown): Promise<Loaded> {
  const id = listId(ref)
  if (!id) throw new ToolError("Which list? Give its id (from list_lists) or a link to it.")
  const loaded = await run(Effect.gen(function*() {
    const list = yield* (yield* Lists).get(id)
    const [book, targets] = yield* Effect.all([(yield* Rules).book, (yield* Targets).all])
    return { list, rules: { ...book, ...list.rules }, targets }
  }).pipe(Effect.catchTag("ListNotFound", () => Effect.succeed(null))))
  if (!loaded) throw new ToolError(`There's no list "${id}". list_lists gives the built-in ones; other lists need their link or id.`)
  return loaded
}

/**
 * One of `items` by id, by name, or by a part of its name that only one has;
 * case and punctuation don't matter.
 */
function pick<T extends { id: string; nm: string }>(items: ReadonlyArray<T>, ref: unknown): T | undefined {
  const v = norm(String(ref ?? ""))
  if (!v) return undefined
  const exact = items.find((x) => norm(x.id) === v || norm(x.nm) === v)
  if (exact) return exact
  const partial = items.filter((x) => norm(x.nm).includes(v) || norm(x.id).includes(v))
  return partial.length === 1 ? partial[0] : undefined
}

const ledgerOf = (l: Loaded, opts: Opts): Ledger => ({ units: l.list.units, rules: l.rules, targets: l.targets, opts, groups: l.list.groups })

/** A datasheet or attached unit, by id or name. */
function unitRef(l: Loaded, ref: unknown, what = "unit"): Unit {
  const v = String(ref ?? "").trim()
  const all = allAttackers({ units: l.list.units })
  const found = pick(all, v)
  if (!found) throw new ToolError(`No ${what} "${v}" in ${l.list.meta.name}. Its units: ${all.map((u) => `${u.id} (${u.nm})`).join(", ")}.`)
  return found
}

function targetRef(l: Loaded, ref: unknown): Target {
  const v = String(ref ?? "").trim()
  const found = pick(l.targets, v)
  if (!found) throw new ToolError(`No target "${v}". The targets: ${l.targets.map((t) => t.id).join(", ")}.`)
  return found
}

// ---------- options ----------

/** Modifier fields as agents write them, and how each becomes a modifier-bar setting. */
const MODIFIERS: ReadonlyArray<readonly [arg: string, key: keyof Mod, value: (v: unknown) => string]> = [
  ["appliesTo", "apply", String],
  ["hit", "hit", String],
  ["wound", "wound", String],
  ["ap", "ap", String],
  ["s", "s", String],
  ["a", "a", String],
  ["d", "d", String],
  ["sustained", "sus", (v) => String(v === true)],
  ["lethal", "lethal", (v) => String(v === true)],
  ["rerollHits", "rrHit", (v) => ({ ones: "1s", all: "full" })[String(v)] ?? "off"],
  ["rerollWounds", "rrWound", (v) => ({ ones: "1s", all: "full" })[String(v)] ?? "off"],
  ["cover", "cover", (v) => String(v === true)],
  ["halfRange", "half", (v) => String(v === true)],
  ["rapidFire", "rf", String],
  ["order", "order", String]
]

/** The list's options, or the table defaults, with the agent's choices applied the way the page applies a click. */
function optionsFor(l: Loaded, a: Args): Opts {
  let o: Opts = a.saved === false ? defaultOpts() : l.list.opts
  const step = (i: OptsIntent) => {
    o = applyIntent(o, i, l.list.units)
  }
  if (typeof a.phase === "string") step({ intent: "set", key: "phase", value: a.phase })
  if (typeof a.combine === "boolean") step({ intent: "set", key: "combine", value: String(a.combine) })
  if (typeof a.enhancementPoints === "boolean") step({ intent: "set", key: "enh", value: String(a.enhancementPoints) })
  if (typeof a.capAtWounds === "boolean") step({ intent: "set", key: "cap", value: String(a.capAtWounds) })
  for (const [k, v] of Object.entries(obj(a.switches))) step({ intent: "flag", key: k, value: v === true })
  for (const m of arr(a.modifiers).map(obj)) {
    const scope = m.unit === undefined || m.unit === "all" ? "all" : unitRef(l, m.unit).id
    for (const [arg, key, value] of MODIFIERS) if (m[arg] !== undefined) step({ intent: "mod", scope, key, value: value(m[arg]) })
  }
  for (const r of arr(a.rulesOff)) step({ intent: "rule-switch", key: String(r), on: false })
  return o
}

/** The options in a line, so the agent can see what it scored under. */
function describeOptions(l: Loaded, o: Opts): string {
  const on = Object.entries(o.flags).filter(([, v]) => v).map(([k]) => k)
  const mods = Object.entries(o.mods).filter(([, m]) => Object.entries(m).some(([k, v]) => k !== "apply" && v !== undefined && v !== "" && v !== 0 && v !== false && v !== "off"))
  const name = (scope: string) => (scope === "all" ? "all units" : allAttackers({ units: l.list.units }).find((u) => u.id === scope)?.nm ?? scope)
  const modText = mods.map(([scope, m]) => `${name(scope)}: ${JSON.stringify(Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== "" && v !== 0 && v !== false && v !== "off" && v !== "both")))}`)
  return [
    `phase ${o.phase}`,
    o.combine ? "attached units as one row" : "attached units split",
    `switches on: ${on.length ? on.join(", ") : "none"}`,
    modText.length ? `modifiers: ${modText.join("; ")}` : "no modifiers",
    Object.keys(o.off).length ? `rules off: ${Object.keys(o.off).join(", ")}` : null
  ]
    .filter(Boolean)
    .join("; ")
}

// ---------- schemas ----------

const LIST: JsonSchema = { type: "string", description: "The list's id (from list_lists) or a link to any of its pages." }
const OPTIONS: Record<string, JsonSchema> = {
  saved: { type: "boolean", description: "Start from the list's saved settings (default) or, if false, from the table defaults." },
  phase: { type: "string", enum: ["all", "ranged", "melee"], description: "Shooting and melee, shooting only, or melee only." },
  combine: { type: "boolean", description: "Score attached units (leader plus bodyguard) as one row." },
  enhancementPoints: { type: "boolean", description: "Count enhancement points in a unit's cost." },
  capAtWounds: { type: "boolean", description: "Stop counting at the target unit's total wounds (no overkill)." },
  switches: {
    type: "object",
    additionalProperties: { type: "boolean" },
    description:
      "Situation switches and target marks to set, by key: charged, stationary, objective (target on an objective), char (target is a Character), selfObj (your unit on an objective), and any condition or mark key get_list shows for this list."
  },
  modifiers: {
    type: "array",
    description: "Modifier-bar settings, each for all units or one unit. Characteristic changes (s, a, d, ap) aren't capped; hit and wound are, at ±1 together with rules.",
    items: {
      type: "object",
      properties: {
        unit: { type: "string", description: "\"all\" (default), or a unit's id or name; an attached unit's id is grp-<letter>." },
        appliesTo: { type: "string", enum: ["both", "ranged", "melee"] },
        hit: { type: "integer", minimum: -1, maximum: 1 },
        wound: { type: "integer", minimum: -1, maximum: 1 },
        ap: { type: "integer", minimum: -2, maximum: 3, description: "Improvement to AP: 1 turns AP -1 into AP -2." },
        s: { type: "integer", minimum: -1, maximum: 2, description: "Strength change." },
        a: { type: "integer", minimum: -1, maximum: 2, description: "Attacks change, per model." },
        d: { type: "integer", minimum: -1, maximum: 2, description: "Damage change." },
        sustained: { type: "boolean", description: "Sustained Hits 1." },
        lethal: { type: "boolean", description: "Lethal Hits." },
        rerollHits: { type: "string", enum: ["off", "ones", "all"] },
        rerollWounds: { type: "string", enum: ["off", "ones", "all"] },
        cover: { type: "boolean", description: "The target is in cover (ranged attacks: -1 BS)." },
        halfRange: { type: "boolean", description: "Within half range (Melta, Rapid Fire)." },
        rapidFire: { type: "integer", minimum: 0, maximum: 4, description: "Rapid Fire X for guns that lack it." },
        order: { type: "string", description: "An Order's id from get_list (Astra Militarum), e.g. take-aim; \"\" for none." }
      },
      additionalProperties: false
    }
  },
  rulesOff: { type: "array", items: { type: "string" }, description: "Rules to switch off, as \"unitId:ruleId\" (ids from get_list)." }
}

// ---------- tools ----------

async function listLists(caller: McpCaller): Promise<ToolResult> {
  const lists = await run(Effect.flatMap(Lists, (l) => l.all))
  const open = lists.filter((l) => listedFor(caller.viewer, l))
  const line = (l: (typeof open)[number]) => `- ${l.id}: ${l.name} (${l.faction || "no faction"}, ${l.units} units, ${l.pts} pts)`
  const builtin = open.filter((l) => l.builtin)
  const yours = open.filter((l) => !l.builtin)
  return {
    text: [
      `Built-in lists:\n${builtin.map(line).join("\n")}`,
      yours.length ? `${caller.viewer.name}'s lists:\n${yours.map(line).join("\n")}` : `${caller.viewer.name} hasn't imported any lists.`,
      "Other people's lists aren't listed, but any list opens by its link (https://khld.dev/cogitator-core/lists/<id>) or id: if the user means one that isn't above, ask them for its link."
    ].join("\n\n"),
    data: { lists: open.map((l) => ({ id: l.id, name: l.name, faction: l.faction, units: l.units, pts: l.pts, builtin: l.builtin })) }
  }
}

async function getList(a: Args): Promise<ToolResult> {
  const l = await load(a.list)
  const { list, rules } = l
  const ruleName = (id: string) => rules[id]?.nm ?? id
  const units = list.units.map((u) => ({
    id: u.id,
    name: u.nm,
    pts: u.pts,
    models: u.models,
    attachedUnit: u.grp ? `grp-${u.grp}` : null,
    role: u.role ?? null,
    enhancement: u.enh?.nm ?? null,
    weapons: u.w.map((w) => ({ name: w.nm, type: w.t === "r" ? "ranged" : "melee", count: w.n, A: w.A, skill: w.sk, S: w.S, AP: w.AP, D: w.D, abilities: keywordText(w), unused: w.off ?? null })),
    rules: u.rules.map((id) => ({ id, name: ruleName(id), changesDamage: !!rules[id]?.dmg }))
  }))
  const groups = Object.entries(list.groups).map(([g, x]) => ({ id: `grp-${g}`, name: x.short }))
  const sw = situations(list.units, rules).map((s) => ({ key: s.key, label: s.label, on: !!list.opts.flags[s.key] }))
  const marks = availableMarks(list.units, rules).map((m) => ({ key: m.key, label: m.label, effect: m.hint, on: !!list.opts.flags[m.key] }))
  const orders = availableOrders(list.units, rules)
  const lines = [
    `# ${list.meta.name}`,
    [list.meta.faction, list.meta.detachments?.join(" and "), `${list.units.reduce((s, u) => s + u.pts, 0)} pts`].filter(Boolean).join(", "),
    list.armyRules.length ? `Army rules: ${list.armyRules.map(ruleName).join(", ")}` : "",
    "",
    "## Units",
    ...list.units.map(
      (u) =>
        `- ${u.id}: ${u.nm}, ${u.pts} pts, ${u.models} ${u.models === 1 ? "model" : "models"}${u.grp ? `, in attached unit grp-${u.grp}` : ""}${u.enh ? `, enhancement ${u.enh.nm}` : ""}\n  weapons: ${u.w.map((w) => `${w.nm} (${w.t === "r" ? "ranged" : "melee"} A${w.A} ${w.sk}+ S${w.S} AP-${w.AP} D${w.D}${keywordText(w) ? `; ${keywordText(w)}` : ""})`).join(", ")}\n  rules: ${u.rules.map((id) => `${ruleName(id)}${rules[id]?.dmg ? "" : " (no effect on damage)"}`).join(", ") || "none"}`
    ),
    groups.length ? `\nAttached units (score as one row with combine): ${groups.map((g) => `${g.id} = ${g.name}`).join("; ")}` : "",
    `\n## Switches\n${sw.map((s) => `- ${s.key}: ${s.label}${s.on ? " (on)" : ""}`).join("\n")}`,
    marks.length ? `\n## Target marks\n${marks.map((m) => `- ${m.key}: ${m.label}. ${m.effect}${m.on ? " (on)" : ""}`).join("\n")}` : "",
    orders.length ? `\n## Orders (modifiers[].order)\n${orders.map((o) => `- ${o.id}: ${o.label}. ${o.hint}`).join("\n")}` : "",
    `\nSaved settings: ${describeOptions(l, list.opts)}`
  ]
  return {
    text: lines.filter((x) => x !== "").join("\n"),
    data: { id: list.id, name: list.meta.name, faction: list.meta.faction ?? null, units, attachedUnits: groups, switches: sw, marks, orders }
  }
}

async function scoreList(a: Args): Promise<ToolResult> {
  const l = await load(a.list)
  const opts = optionsFor(l, a)
  const ledger = ledgerOf(l, opts)
  const m = matrix(ledger)
  const only = arr(a.targets).map((t) => targetRef(l, t).id)
  const cols = m.targets.map((t, k) => ({ t, k })).filter(({ t }) => !only.length || only.includes(t.id))
  const head = `| Unit | pts | avg | ${cols.map(({ t }) => t.nm).join(" | ")} |`
  const rule = `|${" --- |".repeat(cols.length + 3)}`
  const body = m.rows.map((r) => `| ${r.unit.nm} | ${unitPts(r.unit, opts)} | ${pct(r.avg)} | ${cols.map(({ k }) => pct(r.cells[k].roi)).join(" | ")} |`)
  const best = cols.map(({ t, k }) => {
    const top = [...m.rows].sort((x, y) => y.cells[k].roi - x.cells[k].roi)[0]
    return `${t.nm}: ${top ? `${top.unit.nm} ${pct(top.cells[k].roi)}%` : "–"}`
  })
  return {
    text: [
      `# ${l.list.meta.name}: return % per unit and target`,
      "Return % = the target's points removed per 100 points spent on the unit; 65% or more is efficient. avg is across all targets.",
      `Scored under: ${describeOptions(l, opts)}`,
      "",
      head,
      rule,
      ...body,
      "",
      `Best answer per target: ${best.join("; ")}`
    ].join("\n"),
    data: {
      list: l.list.id,
      targets: cols.map(({ t }) => ({ id: t.id, name: t.nm })),
      rows: m.rows.map((r) => ({
        unit: r.unit.id,
        name: r.unit.nm,
        pts: unitPts(r.unit, opts),
        avg: r.avg,
        returns: Object.fromEntries(cols.map(({ t, k }) => [t.id, r.cells[k].roi]))
      }))
    }
  }
}

async function explainMatchup(a: Args): Promise<ToolResult> {
  const l = await load(a.list)
  const opts = optionsFor(l, a)
  const u = unitRef(l, a.unit)
  const t = targetRef(l, a.target)
  const r = attack(ledgerOf(l, opts), u, t)
  const rows = r.rows.map((x) =>
    x.skipped
      ? `| ${x.w.nm} | not counted: ${x.skipped} | | | | | | | |`
      : `| ${x.w.nm} | ${x.models} | ${f2(x.attacks)} | ${percent(x.hitChance)} | ${percent(x.wound)} | ${percent(x.fail)} | ${f2(x.dmg)} | ${f2(x.dealt)} | ${(x.notes ?? []).join(", ")} |`
  )
  return {
    text: [
      `# ${u.nm} into ${t.nm}`,
      `Target: ${t.N} × T${t.T} ${t.Sv}+${t.inv ? ` ${t.inv}++` : ""} W${t.W}${t.fnp ? ` FNP ${t.fnp}+` : ""}${t.dr ? ` −${t.dr} damage` : ""}, ${t.pts} pts (${t.kw.toLowerCase()})`,
      `Scored under: ${describeOptions(l, opts)}`,
      "",
      "| Weapon | models | attacks | hit | wound per hit | past saves | damage each | wounds dealt | notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
      "",
      `Total: ${f2(r.total)} of the target's ${r.pool} wounds${r.capped ? " (capped)" : ""}. Return ${Math.round(r.roi * 10) / 10}% for ${r.pts} pts (target ${f2(r.ppw)} pts per wound).`,
      r.rules.length ? `Rules in play: ${[...new Set(r.rules.map((x) => x.r.nm))].join(", ")}` : "No rules in play."
    ].join("\n"),
    data: {
      unit: u.id,
      target: t.id,
      total: r.total,
      returnPct: r.roi,
      pool: r.pool,
      weapons: r.rows.map((x) => ({
        name: x.w.nm,
        skipped: x.skipped ?? null,
        models: x.models ?? null,
        attacks: x.attacks ?? null,
        hitChance: x.hitChance ?? null,
        woundPerHit: x.wound ?? null,
        failSave: x.fail ?? null,
        damage: x.dmg ?? null,
        dealt: x.dealt ?? null,
        notes: x.notes ?? []
      }))
    }
  }
}

async function listTargets(): Promise<ToolResult> {
  const targets = await run(Effect.flatMap(Targets, (t) => t.all))
  return {
    text: [
      "Benchmark targets every list is scored against:",
      "| id | target | pts | models | T | Sv | inv | W | FNP | damage reduction | keywords |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...targets.map((t) => `| ${t.id} | ${t.nm} | ${t.pts} | ${t.N} | ${t.T} | ${t.Sv}+ | ${t.inv ? `${t.inv}++` : "–"} | ${t.W} | ${t.fnp ? `${t.fnp}+` : "–"} | ${t.dr || "–"} | ${t.kw} |`)
    ].join("\n"),
    data: { targets: targets.map((t) => ({ ...t })) }
  }
}

async function searchRules(a: Args): Promise<ToolResult> {
  const q = norm(String(a.query ?? ""))
  const faction = String(a.faction ?? "").trim().toUpperCase()
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(a.limit)) || 20))
  const all = await run(Effect.flatMap(Rules, (r) => r.all))
  const found = all
    .filter((e) => (!faction || (e.faction ?? "").toUpperCase() === faction) && (!q || norm(e.rule.nm).includes(q) || norm(e.rule.txt).includes(q)))
    .sort((x, y) => Number(norm(y.rule.nm).includes(q)) - Number(norm(x.rule.nm).includes(q)) || x.rule.nm.localeCompare(y.rule.nm))
  const shown = found.slice(0, limit)
  return {
    text: shown.length
      ? [
          `${found.length} ${found.length === 1 ? "rule" : "rules"}${found.length > shown.length ? `, the first ${shown.length}` : ""}:`,
          ...shown.map((e) => `- ${e.id}: ${e.rule.nm} (${[e.faction, e.rule.src, e.status].filter(Boolean).join(", ")})\n  in the engine: ${describeRule(e.rule)}\n  ${e.rule.txt}`)
        ].join("\n")
      : "No rules match.",
    data: {
      total: found.length,
      rules: shown.map((e) => ({ id: e.id, name: e.rule.nm, faction: e.faction, source: e.rule.src, status: e.status, effect: describeRule(e.rule), text: e.rule.txt, fx: e.rule.fx ?? [] }))
    }
  }
}

// ---------- the owner's tools ----------

const when = (iso: string) => iso.replace("T", " ").slice(0, 16)

/** An account by id, email or name. */
async function accountRef(ref: unknown) {
  const v = String(ref ?? "").trim().toLowerCase()
  const accounts = await listAccounts()
  const found = accounts.find((a) => a.id === v || a.email === v) ?? accounts.find((a) => a.name.toLowerCase() === v)
  if (!found) throw new ToolError(`No account "${String(ref)}". The accounts: ${accounts.map((a) => `${a.name} (${a.email})`).join(", ")}.`)
  return found
}

async function usageReportTool(a: Args): Promise<ToolResult> {
  const days = Math.min(90, Math.max(1, Math.trunc(Number(a.days)) || 7))
  const account = a.account === undefined ? null : await accountRef(a.account)
  const r = await run(usageReport(days, account?.id))
  const accounts = await listAccounts()
  const nameOf = (id: string) => {
    const x = accounts.find((y) => y.id === id)
    return x ? `${x.name} (${x.role})` : `a removed account (${id})`
  }
  const appName = async (id: string) => (await oauthClient(id))?.name ?? id
  const counts = (o: Readonly<Record<string, number>>) =>
    Object.entries(o)
      .sort((x, y) => y[1] - x[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(", ") || "none"
  const accountLines = await Promise.all(
    r.accounts.map(async (x) => {
      const apps = await Promise.all(x.clients.map(appName))
      return `- ${nameOf(x.userId)}: ${x.requests} requests (${counts(x.byKind)})${Object.keys(x.tools).length ? `; MCP tools: ${counts(x.tools)}` : ""}${apps.length ? `; apps: ${apps.join(", ")}` : ""}${x.errors ? `; ${x.errors} errors` : ""}; last ${when(x.last)}`
    })
  )
  return {
    text: [
      `# Usage, last ${days} ${days === 1 ? "day" : "days"}${account ? ` for ${account.name}` : ""} (since ${when(r.since)} UTC)`,
      `${r.requests} requests: ${counts(r.byKind)}. ${r.errors} server errors, ${r.refused} refused (not signed in, or not allowed).`,
      "Counts only: exact CPU per request is in Cloudflare's Workers Logs for the last 7 days, under the same requests.",
      `\n## Accounts\n${accountLines.join("\n") || "No signed-in use."}`,
      account ? "" : `\n## Busiest anonymous visitors (keyed hashes of their addresses)\n${r.visitors.map((v) => `- ${v.visitor}: ${v.requests} requests${v.countries.length ? ` from ${v.countries.join(", ")}` : ""}${v.refused ? `, ${v.refused} refused` : ""}${v.errors ? `, ${v.errors} errors` : ""}; ${when(v.first)} to ${when(v.last)}`).join("\n") || "None."}`,
      `\n## Busiest paths\n${r.paths.map((x) => `- ${x.path}: ${x.requests}`).join("\n") || "None."}`
    ]
      .filter(Boolean)
      .join("\n"),
    data: { ...r, accounts: r.accounts.map((x) => ({ ...x, name: nameOf(x.userId) })) }
  }
}

async function checkForUpdatesTool(): Promise<ToolResult> {
  const r = await run(updateByHand)
  return { text: r.message, data: r, isError: !r.ok }
}

async function manageAccountsTool(a: Args): Promise<ToolResult> {
  const action = String(a.action ?? "list")
  if (action === "disconnect") {
    const account = await accountRef(a.account)
    let clientId: string | undefined
    if (a.app !== undefined) {
      const apps = await connectedApps(account.id)
      const app = apps.find((x) => x.clientId === a.app) ?? apps.find((x) => x.name.toLowerCase() === String(a.app).toLowerCase())
      if (!app) throw new ToolError(`${account.name} hasn't connected "${String(a.app)}". Their apps: ${apps.map((x) => x.name).join(", ") || "none"}.`)
      clientId = app.clientId
    }
    const n = await revokeApps(account.id, clientId)
    return {
      text: n
        ? `Disconnected ${n} ${n === 1 ? "app" : "apps"} from ${account.name}, at once. To use it again they'll be asked to sign in and allow it.`
        : `${account.name} had no connected ${clientId ? "app by that name" : "apps"}.`,
      data: { account: account.id, disconnected: n }
    }
  }
  if (action !== "list") throw new ToolError(`Unknown action "${action}": use list or disconnect.`)
  const [accounts, apps] = await Promise.all([listAccounts(), connectedApps()])
  const rows = accounts.map((x) => ({ ...x, apps: apps.filter((y) => y.userId === x.id).map((y) => ({ clientId: y.clientId, name: y.name, since: y.since })) }))
  return {
    text: [
      "Accounts (add people, set passwords and remove accounts on the Accounts page):",
      ...rows.map((x) => `- ${x.name} <${x.email}>, ${x.role}, since ${x.createdAt.slice(0, 10)}; apps: ${x.apps.map((y) => `${y.name} (since ${y.since.slice(0, 10)})`).join(", ") || "none"}`)
    ].join("\n"),
    data: { accounts: rows }
  }
}

/** A tool's failure the agent can act on, rather than a stack trace. */
const guarded = (f: (a: Args) => Promise<ToolResult>) => async (a: Args): Promise<ToolResult> => {
  try {
    return await f(a)
  } catch (e) {
    if (e instanceof ToolError) return { text: e.message, isError: true }
    throw e
  }
}

const OWNER_TOOLS: ReadonlyArray<McpTool> = [
  {
    name: "usage_report",
    title: "Usage report (owner)",
    description:
      "Who used the site and the MCP over the last days: requests per account by kind (pages, page data, form posts, OAuth, MCP), MCP tools and apps, errors and refusals, the busiest anonymous visitors (keyed hashes of their addresses, for spotting abuse) and the busiest paths. Counts only. Only the site's owner has this tool.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 90, description: "How far back; default 7." },
        account: { type: "string", description: "Only this account (id, email or name)." }
      },
      additionalProperties: false
    },
    call: guarded(usageReportTool)
  },
  {
    name: "check_for_updates",
    title: "Check for updates (owner)",
    description:
      "Read the Munitorum Field Manual for every faction with a list, then Wahapedia's data export, as the Database page's button does; at most once every ten minutes. Says what changed. Only the site's owner has this tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    call: guarded(checkForUpdatesTool)
  },
  {
    name: "manage_accounts",
    title: "Accounts and connected apps (owner)",
    description:
      "List the accounts and the apps each has connected to Cogitator Core, or disconnect an account's apps (all, or one by name or client id), which makes the app ask again. Adding people and setting passwords stay on the Accounts page. Only the site's owner has this tool.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "disconnect"], description: "Default list." },
        account: { type: "string", description: "For disconnect: the account's id, email or name." },
        app: { type: "string", description: "For disconnect: only this app (its name or client id); default all of the account's apps." }
      },
      additionalProperties: false
    },
    call: guarded(manageAccountsTool)
  }
]

/** The server as one caller sees it: their own lists, and the owner's tools for the owner. */
export function cogitatorMcp(caller: McpCaller): McpServer {
  const owner = caller.viewer.role === "owner"
  return {
  name: "cogitator-core",
  title: "Cogitator Core",
  version: "1.1.0",
  instructions: [
    "Cogitator Core scores Warhammer 40,000 (11th edition) army lists: for every unit, how many enemy points it removes per point it costs (return %), against a set of benchmark targets, with the list's own rules applied. 65% or more is efficient.",
    `You're signed in as ${caller.viewer.name}. list_lists names the built-in lists and theirs; any other list opens by its link (https://khld.dev/cogitator-core/lists/<id>) or id, so when the user names one you can't see, ask for its link. get_list shows a list's units, rules, and the switches, target marks and Orders it can use. score_list gives the whole matrix under any situation; explain_matchup breaks one unit against one target down weapon by weapon. search_rules shows how a rule is modelled. Nothing you set is saved.`,
    ...(owner ? ["As the site's owner you also have usage_report (who used the site and the MCP), check_for_updates (refresh the rules data) and manage_accounts (accounts and their connected apps)."] : [])
  ].join("\n\n"),
  tools: [
    {
      name: "list_lists",
      title: "List the army lists",
      description:
        "The built-in army lists and the signed-in person's own, with ids. Other people's lists aren't listed but open by their link or id, so ask the user for the link.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      call: guarded(() => listLists(caller))
    },
    {
      name: "get_list",
      title: "Read an army list",
      description: "A list's units (points, models, weapons and their profiles, rules), attached units, and the switches, target marks and Orders that apply to it, with their keys for score_list.",
      inputSchema: { type: "object", properties: { list: LIST }, required: ["list"], additionalProperties: false },
      call: guarded(getList)
    },
    {
      name: "score_list",
      title: "Score a list",
      description:
        "The damage matrix: each unit's return % against each benchmark target, under the list's saved settings plus any switches, modifiers, Orders and rule switches you give. Use it to compare units, answer 'what kills X best', or see what a buff or stratagem changes.",
      inputSchema: {
        type: "object",
        properties: { list: LIST, ...OPTIONS, targets: { type: "array", items: { type: "string" }, description: "Only these targets (ids or names); default all." } },
        required: ["list"],
        additionalProperties: false
      },
      call: guarded(scoreList)
    },
    {
      name: "explain_matchup",
      title: "Explain one matchup",
      description:
        "One unit (or attached unit) against one target, weapon by weapon: attacks, hit chance, wounds, saves, damage, wounds dealt, and which rules and abilities did what. Takes the same situation options as score_list.",
      inputSchema: {
        type: "object",
        properties: {
          list: LIST,
          unit: { type: "string", description: "The unit's id or name (attached units: grp-<letter> or their joined name)." },
          target: { type: "string", description: "The target's id or name (see list_targets)." },
          ...OPTIONS
        },
        required: ["list", "unit", "target"],
        additionalProperties: false
      },
      call: guarded(explainMatchup)
    },
    {
      name: "list_targets",
      title: "List the benchmark targets",
      description: "The benchmark targets lists are scored against: points, models, Toughness, saves, wounds, Feel No Pain, damage reduction and keywords.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      call: guarded(listTargets)
    },
    {
      name: "search_rules",
      title: "Search the rules library",
      description: "Rules in the library by name or wording, optionally by faction code (AE, SM, CSM, AC, AM…): how each is modelled in the engine, in words and as effect clauses, with its plain-words summary and review status.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Part of a rule's name or wording." },
          faction: { type: "string", description: "Faction code as Wahapedia writes it." },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 20." }
        },
        additionalProperties: false
      },
      call: guarded(searchRules)
    },
    ...(owner ? OWNER_TOOLS : [])
  ]
  }
}

/**
 * The MCP endpoint: a signed-in caller's request is answered by the server as
 * they see it; anything else gets the 401 that tells their client where to sign
 * in. A browser client's CORS preflight carries no token and is answered as is.
 */
export async function serveCogitatorMcp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return serveMcp(request, PREFLIGHT)
  const checked = await verifyMcpRequest(request)
  if ("refusal" in checked) return checked.refusal
  noteUsage({ userId: checked.caller.viewer.id, clientId: checked.caller.clientId })
  return serveMcp(request, cogitatorMcp(checked.caller))
}

/** Enough of a server to answer a preflight, which never reaches the tools. */
const PREFLIGHT: McpServer = { name: "cogitator-core", title: "Cogitator Core", version: "1.1.0", instructions: "", tools: [] }
