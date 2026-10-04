/**
 * A record of every request the app answers, for its owner: who made it (an
 * account, or a pseudonymous visitor), what it was (a page, page data, a form
 * post, OAuth, MCP), and how it went. Each is one row in the `usage` table,
 * kept 90 days, and one JSON log line, which Cloudflare's Workers Logs pairs
 * with the request's CPU and wall time.
 *
 * The Durable Object records each request where it answers it (`recorded`).
 * Whatever learns who made it fills that in on the way (`noteUsage`): the
 * pages' middleware, and the MCP endpoint.
 *
 * IP addresses aren't stored. A visitor is a keyed hash of the address, so
 * anonymous traffic from one place can be grouped without keeping where it
 * came from.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { AsyncLocalStorage } from "node:async_hooks"
import { run } from "./runtime"

export type UsageKind = "page" | "data" | "action" | "oauth" | "mcp"

export const USAGE_KEEP_DAYS = 90

/** What the parts of the app that know it add to a request's record. */
export interface UsageNote {
  userId?: string | null
  /** The OAuth client (app) an MCP request comes from. */
  clientId?: string | null
  /** The MCP tool called, or the JSON-RPC method. */
  tool?: string | null
  /** The answer's size, when the response doesn't carry it. */
  bytes?: number | null
}

const scope = new AsyncLocalStorage<UsageNote>()

/** Add to the record of the request being answered. */
export function noteUsage(note: UsageNote): void {
  const current = scope.getStore()
  if (current) Object.assign(current, note)
}

/** What kind of request a path and method are, for requests React Router answers. */
export function pageKind(request: Request): UsageKind {
  if (request.method !== "GET" && request.method !== "HEAD") return "action"
  const path = new URL(request.url).pathname
  // page data for client-side navigation, and React Router's route discovery
  return path.endsWith(".data") || path.endsWith("/__manifest") ? "data" : "page"
}

let secret = "development"
/** Called by the Durable Object when it starts: the key visitors' addresses are hashed with. */
export function installUsage(key: string): void {
  secret = key
  hmac = undefined
  visitors.clear()
}

let hmac: Promise<CryptoKey> | undefined
const visitors = new Map<string, string>()

/** A short keyed hash of the address: the same visitor gets the same id, and the address can't be read back. */
async function visitorOf(ip: string): Promise<string> {
  const known = visitors.get(ip)
  if (known) return known
  hmac ??= crypto.subtle.importKey("raw", new TextEncoder().encode(`usage:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmac, new TextEncoder().encode(ip)))
  const id = [...mac.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")
  if (visitors.size > 10_000) visitors.clear()
  visitors.set(ip, id)
  return id
}

export interface UsageRow {
  readonly at: string
  readonly kind: UsageKind
  readonly userId: string | null
  readonly visitor: string
  readonly country: string | null
  readonly clientId: string | null
  readonly method: string
  readonly path: string
  readonly tool: string | null
  readonly status: number
  readonly bytes: number | null
}

const insert = (r: UsageRow) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql`
      INSERT INTO usage (at, kind, user_id, visitor, country, client_id, method, path, tool, status, bytes)
      VALUES (${r.at}, ${r.kind}, ${r.userId}, ${r.visitor}, ${r.country}, ${r.clientId}, ${r.method}, ${r.path}, ${r.tool}, ${r.status}, ${r.bytes})
    `
  )

async function record(request: Request, kind: UsageKind, note: UsageNote, status: number, response?: Response): Promise<void> {
  try {
    const url = new URL(request.url)
    const length = Number(response?.headers.get("content-length"))
    const row: UsageRow = {
      at: new Date().toISOString(),
      kind,
      userId: note.userId ?? null,
      visitor: await visitorOf(request.headers.get("cf-connecting-ip") ?? "local"),
      country: request.headers.get("cf-ipcountry"),
      clientId: note.clientId ?? null,
      method: request.method,
      // the query is left out: OAuth codes and states travel in it
      path: url.pathname,
      tool: note.tool ?? null,
      status,
      bytes: note.bytes ?? (Number.isFinite(length) && length > 0 ? length : null)
    }
    console.log(JSON.stringify({ usage: row }))
    await run(insert(row))
  } catch (e) {
    // the record is for the owner; a request never fails because it couldn't be written
    console.error("usage: not recorded", e)
  }
}

/** Answer a request, and record it once it's answered. */
export async function recorded(request: Request, kind: UsageKind, answer: () => Promise<Response>): Promise<Response> {
  const note: UsageNote = {}
  let response: Response
  try {
    response = await scope.run(note, answer)
  } catch (e) {
    await record(request, kind, note, 500)
    throw e
  }
  await record(request, kind, note, response.status, response)
  return response
}

/** Rows older than the retention period go; run with the scheduled update. */
export const pruneUsage = Effect.flatMap(SqlClient.SqlClient, (sql) => {
  const before = new Date(Date.now() - USAGE_KEEP_DAYS * 86_400_000).toISOString()
  return sql`DELETE FROM usage WHERE at < ${before}`
}).pipe(Effect.asVoid, Effect.withSpan("usage.prune"))

// ---------- the owner's report ----------

export interface UsageReport {
  readonly since: string
  readonly requests: number
  readonly byKind: Readonly<Record<string, number>>
  /** Server errors, and requests refused for want of a sign-in or a right. */
  readonly errors: number
  readonly refused: number
  readonly accounts: ReadonlyArray<{
    readonly userId: string
    readonly requests: number
    readonly byKind: Readonly<Record<string, number>>
    readonly tools: Readonly<Record<string, number>>
    readonly clients: ReadonlyArray<string>
    readonly errors: number
    readonly last: string
  }>
  /** The busiest anonymous visitors: where abuse would show. */
  readonly visitors: ReadonlyArray<{
    readonly visitor: string
    readonly requests: number
    readonly countries: ReadonlyArray<string>
    readonly refused: number
    readonly errors: number
    readonly first: string
    readonly last: string
  }>
  readonly paths: ReadonlyArray<{ readonly path: string; readonly requests: number }>
}

type Counted = { key: string | null; kind: string; n: number }

/** Requests in the last `days` days, by account, by anonymous visitor and by path; `userId` narrows it to one account. */
export const usageReport = (days: number, userId?: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const who = userId ? sql`AND user_id = ${userId}` : sql``
    const [totals] = yield* sql<{ requests: number; errors: number; refused: number }>`
      SELECT count(*) AS requests, sum(status >= 500) AS errors, sum(status IN (401, 403)) AS refused
      FROM usage WHERE at >= ${since} ${who}
    `
    const kinds = yield* sql<Counted>`SELECT NULL AS key, kind, count(*) AS n FROM usage WHERE at >= ${since} ${who} GROUP BY kind`
    const perAccount = yield* sql<Counted>`
      SELECT user_id AS key, kind, count(*) AS n FROM usage WHERE at >= ${since} AND user_id IS NOT NULL ${who} GROUP BY user_id, kind
    `
    const accountRows = yield* sql<{ userId: string; errors: number; last: string; clients: string | null }>`
      SELECT user_id AS userId, sum(status >= 500) AS errors, max(at) AS last, group_concat(DISTINCT client_id) AS clients
      FROM usage WHERE at >= ${since} AND user_id IS NOT NULL ${who} GROUP BY user_id ORDER BY count(*) DESC
    `
    const tools = yield* sql<Counted>`
      SELECT user_id AS key, tool AS kind, count(*) AS n FROM usage
      WHERE at >= ${since} AND user_id IS NOT NULL AND kind = 'mcp' AND tool IS NOT NULL ${who} GROUP BY user_id, tool
    `
    const visitors = userId
      ? []
      : yield* sql<{ visitor: string; requests: number; countries: string | null; refused: number; errors: number; first: string; last: string }>`
          SELECT visitor, count(*) AS requests, group_concat(DISTINCT country) AS countries, sum(status IN (401, 403)) AS refused,
            sum(status >= 500) AS errors, min(at) AS first, max(at) AS last
          FROM usage WHERE at >= ${since} AND user_id IS NULL GROUP BY visitor ORDER BY requests DESC LIMIT 10
        `
    const paths = yield* sql<{ path: string; requests: number }>`
      SELECT path, count(*) AS requests FROM usage WHERE at >= ${since} ${who} GROUP BY path ORDER BY requests DESC LIMIT 10
    `
    const tally = (rows: ReadonlyArray<Counted>, key: string | null) =>
      Object.fromEntries(rows.filter((r) => r.key === key).map((r) => [r.kind, Number(r.n)]))
    return {
      since,
      requests: Number(totals?.requests ?? 0),
      byKind: tally(kinds, null),
      errors: Number(totals?.errors ?? 0),
      refused: Number(totals?.refused ?? 0),
      accounts: accountRows.map((a) => ({
        userId: a.userId,
        requests: Object.values(tally(perAccount, a.userId)).reduce((s, n) => s + n, 0),
        byKind: tally(perAccount, a.userId),
        tools: tally(tools, a.userId),
        clients: (a.clients ?? "").split(",").filter(Boolean),
        errors: Number(a.errors ?? 0),
        last: a.last
      })),
      visitors: visitors.map((v) => ({
        visitor: v.visitor,
        requests: Number(v.requests),
        countries: (v.countries ?? "").split(",").filter(Boolean),
        refused: Number(v.refused ?? 0),
        errors: Number(v.errors ?? 0),
        first: v.first,
        last: v.last
      })),
      paths: paths.map((p) => ({ path: p.path, requests: Number(p.requests) }))
    } satisfies UsageReport
  }).pipe(Effect.orDie, Effect.withSpan("usage.report"))
