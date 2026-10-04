/**
 * The MCP endpoint (app/.server/mcp) and the OAuth sign-in in front of it
 * (app/.server/auth), against an in-memory database. Each client signs in the
 * way Claude does: it registers itself, starts an authorization, is sent to the
 * sign-in page and then the consent page, swaps the code for a token, and calls
 * MCP with it, through the official MCP SDK's client.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Effect } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { consent, createAccount, installAuth, removeAccount, signIn } from "~/.server/auth/auth"
import { layerAt } from "~/.server/db/Db"
import { parseRosterSync } from "~/.server/importer/roster"
import { MCP_PATH } from "~/.server/mcp/server"
import { Lists } from "~/.server/repos/Lists"
import { Rules } from "~/.server/repos/Rules"
import { Settings, UPDATES_CHECKED_AT } from "~/.server/repos/Settings"
import { appLayer, executeSql, installRuntime, run } from "~/.server/runtime"
import { seedData } from "~/.server/seed/Seed"
import { serveApp } from "~/.server/serve"

const SITE = "http://localhost:5173"
const URL_ = `${SITE}${MCP_PATH}`
const CALLBACK = "https://agent.example/oauth/callback"
const OWNER = { email: "owner@example.com", password: "owner-password-1" }
const FRIEND = { email: "sam@example.com", password: "friend-password-1" }

/** The Durable Object's routing, with a stand-in for the pages, which these tests don't render. */
const app = (path: string, init?: RequestInit) =>
  serveApp(new Request(path.startsWith("http") ? path : `${SITE}${path}`, init), async () => new Response("a page", { status: 200 }))

const cookieHeader = (setCookies: ReadonlyArray<string>) => setCookies.map((c) => c.split(";")[0]).join("; ")
const pathOf = (location: string) => {
  const u = new URL(location, SITE)
  return { url: u, query: u.search.slice(1) }
}

interface Session {
  readonly token: string
  readonly refresh: string
  readonly clientId: string
  /** Whether the consent page was shown on the way. */
  readonly consentShown: boolean
}

/** Register a client (as Claude does) unless one is given, and sign in through the whole authorization code flow. */
async function oauthSignIn(who: { email: string; password: string }, existing?: string): Promise<Session> {
  let clientId = existing
  if (!clientId) {
    const reg = await app("/cogitator-core/api/auth/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test agent",
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"]
      })
    })
    expect(reg.status, await reg.clone().text()).toBeLessThan(300)
    clientId = ((await reg.json()) as { client_id: string }).client_id
  }
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const authorize = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    scope: "openid profile offline_access",
    state: "state-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: URL_
  })
  const start = await app(`/cogitator-core/api/auth/oauth2/authorize?${authorize}`, { redirect: "manual" })
  expect(start.status, await start.clone().text()).toBe(302)
  const login = pathOf(start.headers.get("location")!)
  expect(login.url.pathname).toBe("/cogitator-core/sign-in")
  // the sign-in page posts back the signed request it was sent with
  const signedIn = await signIn(new Request(login.url), who.email, who.password, login.query)
  if (!signedIn.ok) throw new Error(signedIn.message)
  let next = pathOf(signedIn.next!)
  let consentShown = false
  if (next.url.pathname === "/cogitator-core/consent") {
    consentShown = true
    const back = await consent(new Request(next.url, { headers: { cookie: cookieHeader(signedIn.setCookies) } }), next.query, true)
    next = pathOf(back)
  }
  expect(`${next.url.origin}${next.url.pathname}`).toBe(CALLBACK)
  expect(next.url.searchParams.get("state")).toBe("state-1")
  const tokenResponse = await app("/cogitator-core/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: next.url.searchParams.get("code")!,
      redirect_uri: CALLBACK,
      client_id: clientId,
      code_verifier: verifier,
      resource: URL_
    })
  })
  expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200)
  const t = (await tokenResponse.json()) as { access_token: string; refresh_token: string }
  return { token: t.access_token, refresh: t.refresh_token, clientId, consentShown }
}

async function connect(token: string) {
  const c = new Client({ name: "cogitator-test", version: "1.0.0" })
  await c.connect(new StreamableHTTPClientTransport(new URL(URL_), { fetch: (url, init) => app(String(url), init), requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return c
}

let guard = ""
let samsList = ""
let sam: Session
let khalid: Session
let client: Client
let owner: Client

type Text = { content: Array<{ type: string; text: string }>; structuredContent?: any; isError?: boolean }
const callAs = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as Text
const call = (name: string, args: Record<string, unknown> = {}) => callAs(client, name, args)
const post = (body: unknown, headers: Record<string, string> = {}) =>
  app(MCP_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${sam.token}`, ...headers },
    body: JSON.stringify(body)
  })

beforeAll(async () => {
  await installRuntime(appLayer(layerAt(":memory:")))
  installAuth({ secret: "a-test-secret-that-is-long-enough-for-better-auth", baseURL: SITE, setupCode: null, execute: executeSql })
  await createAccount({ name: "Khalid", email: OWNER.email, password: OWNER.password, role: "owner" })
  const samId = await createAccount({ name: "Sam", email: FRIEND.email, password: FRIEND.password, role: "friend" })
  // an Astra Militarum list someone else owns, reachable only by its id; and one of Sam's own
  const lords = (ownerId: string, name?: string) =>
    Effect.gen(function*() {
      const book = yield* (yield* Rules).book
      const g = parseRosterSync(readFileSync("tests/fixtures/rosters/by-writ-of-the-lord-solar.ros", "utf8"), "", {
        library: book,
        factionArmyRules: seedData.factionArmyRules,
        detachmentRules: seedData.detachmentRules,
        detachmentUnitGrants: seedData.detachmentUnitGrants
      })
      return yield* (yield* Lists).create({ ...g, meta: { ...g.meta, name: name ?? g.meta.name }, ownerId })
    })
  guard = await run(lords("someone"))
  samsList = await run(lords(samId, "Sam's Guard"))
  sam = await oauthSignIn(FRIEND)
  khalid = await oauthSignIn(OWNER)
  client = await connect(sam.token)
  owner = await connect(khalid.token)
}, 60_000)

afterAll(async () => {
  await client?.close()
  await owner?.close()
})

describe("signing in", () => {
  it("tells a client without a token where to sign in", async () => {
    const r = await app(MCP_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) })
    expect(r.status).toBe(401)
    expect(r.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource${MCP_PATH}"`)
    const bad = await app(MCP_PATH, { method: "POST", headers: { Authorization: "Bearer not-a-token" }, body: "{}" })
    expect(bad.status).toBe(401)
    expect(bad.headers.get("www-authenticate")).toMatch(/error="invalid_token"/)
  })

  it("serves the discovery documents at the site's root", async () => {
    const resource = (await (await app(`/.well-known/oauth-protected-resource${MCP_PATH}`)).json()) as { resource: string; authorization_servers: Array<string> }
    expect(resource.resource).toBe(URL_)
    const issuer = resource.authorization_servers[0]
    expect(issuer).toBe(`${SITE}/cogitator-core/api/auth`)
    const meta = (await (await app(`/.well-known/oauth-authorization-server/cogitator-core/api/auth`)).json()) as Record<string, any>
    expect(meta).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      registration_endpoint: `${issuer}/oauth2/register`
    })
    expect(meta.code_challenge_methods_supported).toContain("S256")
  })

  it("asks for consent once per app, and keeps the rest of better-auth off the web", async () => {
    expect(sam.consentShown).toBe(true)
    const again = await oauthSignIn(FRIEND, sam.clientId)
    expect(again.consentShown).toBe(false)
    expect((await app("/cogitator-core/api/auth/sign-up/email", { method: "POST", body: "{}" })).status).toBe(200)
    expect(await (await app("/cogitator-core/api/auth/sign-up/email", { method: "POST", body: "{}" })).text()).toBe("a page")
  })
})

describe("the MCP endpoint", () => {
  it("introduces itself to the signed-in person, with six read-only tools for a friend", async () => {
    expect(client.getServerVersion()).toMatchObject({ name: "cogitator-core", title: "Cogitator Core" })
    expect(client.getInstructions()).toMatch(/signed in as Sam/)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(["list_lists", "get_list", "score_list", "explain_matchup", "list_targets", "search_rules"])
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
  })

  it("lists the built-in lists and the caller's own", async () => {
    const r = await call("list_lists")
    expect(r.structuredContent.lists.map((l: any) => l.id)).toEqual([seedData.defaultListId, samsList])
    expect(r.content[0].text).toMatch(/Sam's lists:\n- .*Sam's Guard/)
    expect(r.structuredContent.lists.map((l: any) => l.id)).not.toContain(guard)
  })

  it("reads a list by id or by a link to any of its pages", async () => {
    const byId = await call("get_list", { list: guard })
    const byLink = await call("get_list", { list: `https://khld.dev/cogitator-core/lists/${guard}/units/kasrkin` })
    expect(byLink.structuredContent).toEqual(byId.structuredContent)
    expect(byId.content[0].text).toMatch(/Field Ordnance Battery/)
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
    const killers = await call("score_list", { list: seedData.defaultListId, saved: false, targets: ["Terminators"], modifiers: [{ unit: "Yriel + Voidscarred", d: 1 }] })
    const row = (r: Text) => r.structuredContent.rows.find((x: any) => x.unit === "grp-D").returns.terminators
    expect(row(killers)).toBeGreaterThan(row(base))
    expect(killers.content[0].text).toMatch(/Yriel \+ Voidscarred: \{"d":1\}/)
    const aim = await call("explain_matchup", { list: guard, unit: "Kasrkin", target: "intercessors", modifiers: [{ unit: "kasrkin", order: "take-aim" }] })
    const plain = await call("explain_matchup", { list: guard, unit: "kasrkin", target: "intercessors" })
    const gun = (r: Text) => r.structuredContent.weapons.find((w: any) => w.name === "Hot-shot lasgun")
    expect(gun(aim).hitChance).toBeGreaterThan(gun(plain).hitChance)
    expect(gun(aim).notes).toContain("Take Aim!")
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

describe("the owner's tools", () => {
  it("are offered to the owner only, and refused to anyone else", async () => {
    const names = (await owner.listTools()).tools.map((t) => t.name)
    expect(names.slice(6)).toEqual(["usage_report", "check_for_updates", "manage_accounts"])
    expect(owner.getInstructions()).toMatch(/usage_report/)
    await expect(client.callTool({ name: "usage_report", arguments: {} })).rejects.toThrow(/Unknown tool/)
  })

  it("report who used what, as the usage log recorded it", async () => {
    const r = await callAs(owner, "usage_report", { days: 1 })
    const samRow = r.structuredContent.accounts.find((a: any) => a.name.startsWith("Sam"))
    expect(samRow.byKind.mcp).toBeGreaterThan(5)
    expect(samRow.tools.score_list).toBeGreaterThanOrEqual(3)
    expect(r.content[0].text).toMatch(/- Sam \(friend\): \d+ requests .*MCP tools: .*score_list \d+.*apps: Test agent/)
    // anonymous requests, like the unsigned MCP calls above, are grouped under a visitor and counted as refused
    expect(r.structuredContent.refused).toBeGreaterThan(0)
    expect(r.structuredContent.visitors.length).toBeGreaterThan(0)
    expect((await callAs(owner, "usage_report", { account: "sam@example.com" })).structuredContent.accounts.map((a: any) => a.name)).toEqual(["Sam (friend)"])
  })

  it("check for updates, within the cooldown without going out", async () => {
    await run(Effect.flatMap(Settings, (s) => s.set(UPDATES_CHECKED_AT, new Date().toISOString())))
    const r = await callAs(owner, "check_for_updates")
    expect(r.content[0].text).toMatch(/Try again in \d+ minutes?/)
  })

  it("list connected apps and disconnect one, at once", async () => {
    const listed = await callAs(owner, "manage_accounts")
    expect(listed.content[0].text).toMatch(/Sam <sam@example.com>, friend, .*apps: Test agent/)
    const still = await app(MCP_PATH, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sam.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) })
    expect(still.status).toBe(200)
    const done = await callAs(owner, "manage_accounts", { action: "disconnect", account: "Sam", app: "Test agent" })
    expect(done.content[0].text).toMatch(/Disconnected 1 app from Sam/)
    const after = await app(MCP_PATH, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sam.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) })
    expect(after.status).toBe(401)
    // signing in again works, and asks again
    sam = await oauthSignIn(FRIEND, sam.clientId)
    expect(sam.consentShown).toBe(true)
  })

  it("shuts out a removed account", async () => {
    const accounts = await callAs(owner, "manage_accounts")
    const id = accounts.structuredContent.accounts.find((a: any) => a.email === FRIEND.email).id
    await removeAccount(id)
    const r = await post({ jsonrpc: "2.0", id: 1, method: "ping" })
    expect(r.status).toBe(401)
  })
})

describe("the transport", () => {
  it("speaks plain JSON-RPC over POST, and says no to the rest", async () => {
    const ping = await post({ jsonrpc: "2.0", id: 7, method: "ping" }, { Authorization: `Bearer ${khalid.token}` })
    expect(ping.status).toBe(200)
    expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} })
    const asOwner = { Authorization: `Bearer ${khalid.token}` }
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, asOwner)).status).toBe(202)
    expect(await (await post({ jsonrpc: "2.0", id: 1, method: "resources/list" }, asOwner)).json()).toMatchObject({ error: { code: -32601 } })
    const batch = await (await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "ping" }], asOwner)).json()
    expect(batch).toHaveLength(2)
    expect((await app(MCP_PATH, { headers: asOwner })).status).toBe(405)
    const pre = await app(MCP_PATH, { method: "OPTIONS", headers: { Origin: "https://example.com" } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get("access-control-allow-origin")).toBe("*")
    expect((await app(MCP_PATH, { method: "POST", headers: asOwner, body: "{not json" })).status).toBe(400)
  })

  it("agrees on a protocol version", async () => {
    const init = (v: string) =>
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "x", version: "1" } } }, { Authorization: `Bearer ${khalid.token}` }).then(
        (r) => r.json() as Promise<{ result: { protocolVersion: string } }>
      )
    expect((await init("2025-03-26")).result.protocolVersion).toBe("2025-03-26")
    expect((await init("1999-01-01")).result.protocolVersion).toBe("2025-11-25")
  })
})
