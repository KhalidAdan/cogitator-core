/**
 * The MCP endpoint (app/.server/mcp), driven by the official MCP SDK's client
 * over its Streamable HTTP transport, against an in-memory database: what a
 * real agent's client sees.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { layerAt } from "~/.server/db/Db"
import { parseRosterSync } from "~/.server/importer/roster"
import { MCP_PATH, serveCogitatorMcp } from "~/.server/mcp/server"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { appLayer, installRuntime, run } from "~/.server/runtime"
import { seedData } from "~/.server/seed/Seed"

const URL_ = `https://khld.dev${MCP_PATH}`
let client: Client
let guard = ""

type Text = { content: Array<{ type: string; text: string }>; structuredContent?: any; isError?: boolean }
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Text
const post = (body: unknown, headers: Record<string, string> = {}) =>
  serveCogitatorMcp(new Request(URL_, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) }))

beforeAll(async () => {
  await installRuntime(appLayer(layerAt(":memory:")))
  // an Astra Militarum list, as someone's own (not built in), to reach by its id
  guard = await run(Effect.gen(function*() {
    const book = yield* (yield* Rules).book
    const g = parseRosterSync(readFileSync("tests/fixtures/rosters/by-writ-of-the-lord-solar.ros", "utf8"), "", {
      library: book,
      factionArmyRules: seedData.factionArmyRules,
      detachmentRules: seedData.detachmentRules,
      detachmentUnitGrants: seedData.detachmentUnitGrants
    })
    return yield* (yield* Lists).create({ ...g, ownerId: "someone" })
  }))
  client = new Client({ name: "cogitator-test", version: "1.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { fetch: (url, init) => serveCogitatorMcp(new Request(url, init)) }))
}, 60_000)

afterAll(async () => {
  await client?.close()
})

describe("the MCP endpoint", () => {
  it("introduces itself and lists six read-only tools", async () => {
    expect(client.getServerVersion()).toMatchObject({ name: "cogitator-core", title: "Cogitator Core" })
    expect(client.getInstructions()).toMatch(/return %/)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(["list_lists", "get_list", "score_list", "explain_matchup", "list_targets", "search_rules"])
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
  })

  it("lists only the built-in lists by name", async () => {
    const r = await call("list_lists")
    expect(r.structuredContent.lists.map((l: any) => l.id)).toEqual([seedData.defaultListId])
    expect(r.content[0].text).toMatch(/The Burning One and the Exile/)
    expect(r.content[0].text).not.toMatch(/Lord Solar/i)
  })

  it("reads a list by id or by a link to any of its pages", async () => {
    const byId = await call("get_list", { list: guard })
    const byLink = await call("get_list", { list: `https://khld.dev/cogitator-core/lists/${guard}/units/kasrkin` })
    expect(byLink.structuredContent).toEqual(byId.structuredContent)
    const text = byId.content[0].text
    expect(text).toMatch(/Field Ordnance Battery/)
    expect(byId.structuredContent.orders.map((o: any) => o.id)).toContain("take-aim")
    expect(byId.structuredContent.marks.map((m: any) => m.key)).toContain("recon")
    expect(byId.structuredContent.switches.map((s: any) => s.key)).not.toContain("order")
  })

  it("scores the matrix as the page does", async () => {
    const r = await call("score_list", { list: seedData.defaultListId, saved: false })
    const yv = r.structuredContent.rows.find((x: any) => x.unit === "grp-D")
    // the handoff's headline row for Yriel + Voidscarred
    expect(["terminators", "intercessors", "canoptek-wraiths", "ctan"].map((t) => Math.round(yv.returns[t]))).toEqual([107, 104, 64, 55])
    expect(r.content[0].text).toMatch(/\| Yriel \+ Voidscarred \| 250 \|/)
  })

  it("applies modifiers and Orders the way the modifier bar does, and saves nothing", async () => {
    const base = await call("score_list", { list: seedData.defaultListId, saved: false, targets: ["terminators"] })
    const killers = await call("score_list", {
      list: seedData.defaultListId,
      saved: false,
      targets: ["Terminators"],
      modifiers: [{ unit: "Yriel + Voidscarred", d: 1 }]
    })
    const row = (r: Text) => r.structuredContent.rows.find((x: any) => x.unit === "grp-D").returns.terminators
    expect(row(killers)).toBeGreaterThan(row(base))
    expect(killers.content[0].text).toMatch(/Yriel \+ Voidscarred: \{"d":1\}/)
    // Take Aim! on the Kasrkin: their ranged weapons hit on a better roll
    const aim = await call("explain_matchup", { list: guard, unit: "Kasrkin", target: "intercessors", modifiers: [{ unit: "kasrkin", order: "take-aim" }] })
    const plain = await call("explain_matchup", { list: guard, unit: "kasrkin", target: "intercessors" })
    const gun = (r: Text) => r.structuredContent.weapons.find((w: any) => w.name === "Hot-shot lasgun")
    expect(gun(aim).hitChance).toBeGreaterThan(gun(plain).hitChance)
    expect(gun(aim).notes).toContain("Take Aim!")
    // the list is as it was
    const again = await call("score_list", { list: seedData.defaultListId, saved: false, targets: ["terminators"] })
    expect(row(again)).toBe(row(base))
  })

  it("explains a matchup weapon by weapon", async () => {
    const r = await call("explain_matchup", { list: seedData.defaultListId, unit: "grp-D", target: "terminators", saved: false })
    expect(r.structuredContent.weapons.length).toBeGreaterThan(1)
    expect(Math.round(r.structuredContent.returnPct)).toBe(107)
    expect(r.content[0].text).toMatch(/Rules in play: .*Piratical Hero/)
  })

  it("lists the targets and searches the rules library", async () => {
    expect((await call("list_targets")).structuredContent.targets).toHaveLength(seedData.targets.length)
    const r = await call("search_rules", { query: "take aim", faction: "am" })
    expect(r.structuredContent.rules[0]).toMatchObject({ id: "take-aim", effect: "ranged: BS/WS improved by 1" })
  })

  it("answers mistakes with something the agent can act on", async () => {
    const missing = await call("get_list", { list: "nope" })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toMatch(/no list "nope"/)
    const unit = await call("explain_matchup", { list: guard, unit: "Leman Russ", target: "intercessors" })
    expect(unit.isError).toBe(true)
    expect(unit.content[0].text).toMatch(/Its units: .*kasrkin/)
    await expect(client.callTool({ name: "delete_everything", arguments: {} })).rejects.toThrow(/Unknown tool/)
  })
})

describe("the transport", () => {
  it("speaks plain JSON-RPC over POST, and says no to the rest", async () => {
    const ping = await post({ jsonrpc: "2.0", id: 7, method: "ping" })
    expect(ping.status).toBe(200)
    expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} })
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202)
    expect(await (await post({ jsonrpc: "2.0", id: 1, method: "resources/list" })).json()).toMatchObject({ error: { code: -32601 } })
    const batch = await (await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "ping" }])).json()
    expect(batch).toHaveLength(2)
    expect((await serveCogitatorMcp(new Request(URL_))).status).toBe(405)
    const pre = await serveCogitatorMcp(new Request(URL_, { method: "OPTIONS", headers: { Origin: "https://example.com" } }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get("access-control-allow-origin")).toBe("*")
    expect((await serveCogitatorMcp(new Request(URL_, { method: "POST", body: "{not json" }))).status).toBe(400)
  })

  it("agrees on a protocol version", async () => {
    const init = (v: string) =>
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "x", version: "1" } } }).then((r) => r.json() as Promise<{ result: { protocolVersion: string } }>)
    expect((await init("2025-03-26")).result.protocolVersion).toBe("2025-03-26")
    expect((await init("1999-01-01")).result.protocolVersion).toBe("2025-11-25")
  })
})
