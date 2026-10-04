/**
 * Accounts and sessions, with better-auth, and the OAuth server AI agents sign
 * in through.
 *
 * Email and password, and no sign-up: the site's owner creates every account
 * (the first through `/setup`, which needs the SETUP_CODE secret, the rest on
 * the Accounts page). better-auth stores its users, sessions, password hashes
 * and OAuth clients and tokens in the app's own SQLite (migrations
 * `0005_accounts` and `0006_oauth`) through `ExecuteDialect`. The pages call it
 * from their loaders and actions; over HTTP only the OAuth endpoints and their
 * discovery documents are served (`isAuthHttpPath`).
 *
 * For MCP clients (Claude, ChatGPT, coding agents) better-auth is an OAuth 2.1
 * server: a client registers itself or names itself by URL, sends the person
 * to `/sign-in` and `/consent`, and gets a signed access token for the MCP
 * endpoint, which `verifyMcpRequest` checks.
 *
 * The Durable Object installs it at start-up (`installAuth`), with the secret
 * and the site's URL from its environment.
 */
import { cimd } from "@better-auth/cimd"
import { mcp } from "@better-auth/mcp"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { jwt } from "better-auth/plugins"
import { createLocalJWKSet, jwtVerify } from "jose"
import { MIN_PASSWORD, type Role, type Viewer } from "~/viewer"
import { type Execute, ExecuteDialect } from "./dialect"

/** The app's path on the site: React Router's basename. */
export const BASE = "/cogitator-core"
const AUTH_BASE = `${BASE}/api/auth`
/** The MCP endpoint, the resource OAuth access tokens are issued for. */
export const MCP_PATH = `${BASE}/mcp`

export interface AuthConfig {
  /** BETTER_AUTH_SECRET: signs sessions. */
  readonly secret: string
  /** BETTER_AUTH_URL: where the site is served, e.g. https://khld.dev. */
  readonly baseURL: string
  /** SETUP_CODE: what `/setup` asks for before it creates the owner's account. Unset: setup is closed. */
  readonly setupCode: string | null
  /** Runs better-auth's queries on the app's database. */
  readonly execute: Execute
}

/**
 * Client ID Metadata Documents (a client's `client_id` is a URL serving its
 * metadata; Claude's is https://claude.ai/oauth/mcp-oauth-client-metadata),
 * fetched the Workers way: HTTPS only, GET or HEAD only, and never through a
 * redirect. better-auth asks with `redirect: "error"`, which Workers don't
 * support (only "follow" and "manual"; constructing a request with "error"
 * throws), so the fetch is made with "manual" and a redirect is refused here.
 * better-auth also asks for a transport that refuses private and special-use
 * addresses; on Workers that is the platform's doing, as outbound fetches can't
 * reach private networks or loopback.
 */
export const fetchClientMetadataResource = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.protocol !== "https:") throw new TypeError("Client metadata documents must be served over HTTPS")
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
  if (method !== "GET" && method !== "HEAD") throw new TypeError("Client metadata documents are only read")
  const response = await fetch(url, { method, headers: init?.headers, signal: init?.signal ?? null, redirect: "manual" })
  if (response.status >= 300 && response.status < 400) throw new TypeError("Client metadata documents must not redirect")
  return response
}

export const authOptions = (config: AuthConfig) =>
  ({
    appName: "Cogitator Core",
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: AUTH_BASE,
    database: { dialect: new ExecuteDialect(config.execute), type: "sqlite", transaction: false },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD },
    user: { additionalFields: { role: { type: "string", defaultValue: "friend", input: false } } },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // No cached copy of the session in a cookie: removing an account or changing a password signs it out at
      // once, and the lookup is an in-process query anyway.
      cookieCache: { enabled: false }
    },
    advanced: {
      cookiePrefix: "cogitator",
      // khld.dev will host other sites; this one's cookies stay on its own path
      defaultCookieAttributes: { path: "/cogitator-core", sameSite: "lax", httpOnly: true }
    },
    telemetry: { enabled: false },
    plugins: [
      // the keys access tokens are signed with
      jwt(),
      mcp({
        loginPage: `${BASE}/sign-in`,
        consentPage: `${BASE}/consent`,
        resource: `${config.baseURL}${MCP_PATH}`,
        // Claude and ChatGPT register themselves (RFC 7591), newer clients name themselves by URL (cimd, below).
        // Registering grants nothing: a client still needs one of the owner's accounts to sign in, and their consent.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true
      }),
      cimd({ fetchClientMetadataResource })
    ]
  }) satisfies BetterAuthOptions

const makeAuth = (config: AuthConfig) => betterAuth(authOptions(config))

type Auth = ReturnType<typeof makeAuth>

let current: { readonly auth: Auth; readonly config: AuthConfig } | undefined

/** Called once by the Durable Object when it starts. */
export function installAuth(config: AuthConfig): void {
  current = { auth: makeAuth(config), config }
  keys = undefined
}

const get = () => {
  if (!current) throw new Error("Accounts aren't set up: the Durable Object installs them when it starts.")
  return current
}

/**
 * The headers better-auth needs from a request: the session cookie, and who
 * is calling. Not the `Origin`: these are the app's own server-side calls, and
 * the routes' forms are same-site (session cookies are SameSite=Lax).
 */
const authHeaders = (request: Request) => {
  const h = new Headers()
  for (const k of ["cookie", "user-agent"]) {
    const v = request.headers.get(k)
    if (v) h.set(k, v)
  }
  const ip = request.headers.get("cf-connecting-ip")
  if (ip) h.set("x-forwarded-for", ip)
  return h
}

const setCookies = (headers: Headers | undefined): Array<string> => headers?.getSetCookie() ?? []

const toViewer = (u: { id: string; name: string; email: string; role?: unknown }): Viewer => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role === "owner" ? "owner" : "friend"
})

/** Who is signed in, if anyone, and any cookies better-auth wants refreshed. */
export async function getViewer(request: Request): Promise<{ viewer: Viewer | null; setCookies: Array<string> }> {
  if (!request.headers.get("cookie")?.includes("cogitator.session")) return { viewer: null, setCookies: [] }
  const { headers, response } = await get().auth.api.getSession({ headers: authHeaders(request), returnHeaders: true })
  return { viewer: response ? toViewer(response.user) : null, setCookies: setCookies(headers) }
}

// ---------- signing in ----------

/** Failed attempts per address and per email, so a password can't be guessed by brute force. */
const failures = new Map<string, { count: number; since: number }>()
const WINDOW_MS = 15 * 60_000
const MAX_FAILURES = 8

const tooMany = (key: string, now: number) => {
  const f = failures.get(key)
  return !!f && now - f.since < WINDOW_MS && f.count >= MAX_FAILURES
}
const fail = (key: string, now: number) => {
  const f = failures.get(key)
  failures.set(key, f && now - f.since < WINDOW_MS ? { count: f.count + 1, since: f.since } : { count: 1, since: now })
}

/**
 * An OAuth step made through better-auth's own HTTP handler, from the server:
 * the authorization it carries on with reads the whole request, which a direct
 * `auth.api` call doesn't have. The visitor's cookies go with it.
 */
async function oauthStep(path: string, request: Request, body: unknown) {
  const headers = authHeaders(request)
  headers.set("content-type", "application/json")
  headers.set("accept", "application/json")
  headers.set("origin", get().config.baseURL)
  const r = await get().auth.handler(new Request(`${get().config.baseURL}${AUTH_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) }))
  return { ok: r.ok, json: (await r.json().catch(() => null)) as unknown, setCookies: r.headers.getSetCookie() }
}

/** Where better-auth says to send the browser next, from an OAuth step's answer. */
const nextFrom = (r: unknown): string | undefined => {
  if (!r || typeof r !== "object") return undefined
  const o = r as { redirect_uri?: unknown; url?: unknown }
  return typeof o.redirect_uri === "string" ? o.redirect_uri : typeof o.url === "string" ? o.url : undefined
}

/**
 * Sign in. `oauthQuery` is the signed authorization request an MCP client's
 * sign-in arrives with (the sign-in page's query); with it, better-auth carries
 * on with the authorization once the session exists, and `next` is where to
 * send the browser: the consent page, or back to the client.
 */
export async function signIn(
  request: Request,
  email: string,
  password: string,
  oauthQuery?: string
): Promise<
  | { readonly ok: true; readonly setCookies: Array<string>; readonly next?: string }
  | { readonly ok: false; readonly message: string }
> {
  const now = Date.now()
  const throttle = [`ip:${request.headers.get("cf-connecting-ip") ?? "local"}`, `email:${email.toLowerCase()}`]
  if (throttle.some((k) => tooMany(k, now))) return { ok: false, message: "Too many attempts. Try again in a few minutes." }
  try {
    if (oauthQuery) {
      const r = await oauthStep("/sign-in/email", request, { email, password, oauth_query: oauthQuery })
      if (!r.ok) throw new Error("sign-in refused")
      for (const k of throttle) failures.delete(k)
      return { ok: true, setCookies: r.setCookies, next: nextFrom(r.json) }
    }
    const { headers } = await get().auth.api.signInEmail({ body: { email, password }, headers: authHeaders(request), returnHeaders: true })
    for (const k of throttle) failures.delete(k)
    return { ok: true, setCookies: setCookies(headers) }
  } catch {
    for (const k of throttle) fail(k, now)
    return { ok: false, message: "That email and password don’t match an account." }
  }
}

export async function signOut(request: Request): Promise<Array<string>> {
  try {
    const { headers } = await get().auth.api.signOut({ headers: authHeaders(request), returnHeaders: true })
    return setCookies(headers)
  } catch {
    return []
  }
}

// ---------- accounts (the owner's Accounts page, and setup) ----------

export interface Account {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: Role
  readonly createdAt: string
}

export async function hasOwner(): Promise<boolean> {
  const ctx = await get().auth.$context
  return (await ctx.internalAdapter.countTotalUsers([{ field: "role", value: "owner" }])) > 0
}

/** Constant-time comparison, so the setup code can't be found one character at a time. */
export function checkSetupCode(code: string): boolean {
  const expected = get().config.setupCode
  if (!expected) return false
  const a = new TextEncoder().encode(code)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

export const setupConfigured = () => !!get().config.setupCode

export class AccountError extends Error {}

export async function createAccount(input: { name: string; email: string; password: string; role: Role }): Promise<string> {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  if (!name) throw new AccountError("Give the account a name.")
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AccountError("That doesn’t look like an email address.")
  if (input.password.length < MIN_PASSWORD) throw new AccountError(`Passwords need at least ${MIN_PASSWORD} characters.`)
  const ctx = await get().auth.$context
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new AccountError("There’s already an account with that email.")
  const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true, role: input.role }, { method: "admin" })
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(input.password)
  })
  return user.id
}

export async function listAccounts(): Promise<Array<Account>> {
  const ctx = await get().auth.$context
  const users = await ctx.internalAdapter.listUsers(200, 0, { field: "createdAt", direction: "asc" })
  return users.map((u) => ({ ...toViewer(u), createdAt: new Date(u.createdAt).toISOString() }))
}

export async function setPassword(userId: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD) throw new AccountError(`Passwords need at least ${MIN_PASSWORD} characters.`)
  const ctx = await get().auth.$context
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password))
  // signed out everywhere, connected apps included; they sign in again with the new one
  await ctx.internalAdapter.deleteUserSessions(userId)
  await revokeApps(userId)
}

export async function removeAccount(userId: string): Promise<void> {
  const ctx = await get().auth.$context
  await revokeApps(userId)
  await ctx.internalAdapter.deleteUserSessions(userId)
  await ctx.internalAdapter.deleteAccounts(userId)
  await ctx.internalAdapter.deleteUser(userId)
}

// ---------- OAuth: what MCP clients sign in through ----------

/** OAuth endpoints and discovery documents better-auth serves over HTTP; everything else of its stays server-side. */
const AUTH_HTTP = [
  new RegExp(`^${AUTH_BASE}/oauth2/(authorize|token|register|userinfo|revoke|introspect|end-session)$`),
  new RegExp(`^${AUTH_BASE}/jwks$`),
  new RegExp(`^${AUTH_BASE}/\\.well-known/(oauth-authorization-server|openid-configuration)$`),
  // discovery at the site's root, with the issuer's or the resource's path after it (RFC 8414, RFC 9728)
  /^\/\.well-known\/(oauth-authorization-server|openid-configuration|oauth-protected-resource)(\/.*)?$/
]

export const isAuthHttpPath = (pathname: string) => AUTH_HTTP.some((r) => r.test(pathname))

/** Clients call these from servers and from browsers; none of them uses cookies, except authorize, a navigation. */
const OPEN_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version"
}

export async function serveAuthHttp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: OPEN_CORS })
  const response = await get().auth.handler(request)
  if (new URL(request.url).pathname.endsWith("/oauth2/authorize")) return response
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(OPEN_CORS)) headers.set(k, v)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * Approve or refuse a client's request, from the consent page. `oauthQuery` is
 * the page's own (signed) query. Returns where to send the browser: back to the
 * client, with a code or with the refusal.
 */
export async function consent(request: Request, oauthQuery: string, accept: boolean): Promise<string> {
  const r = await oauthStep("/oauth2/consent", request, { accept, oauth_query: oauthQuery })
  const next = nextFrom(r.json)
  if (!next) throw new Error(`The authorization server didn’t say where to go next: ${JSON.stringify(r.json)}`)
  return next
}

export interface OAuthClientInfo {
  readonly clientId: string
  readonly name: string
  /** The client's home page, if it gave one. */
  readonly uri: string | null
}

type ClientRow = { clientId: string; name?: string | null; uri?: string | null }

/** A registered client, for the consent page and the owner's account tools. */
export async function oauthClient(clientId: string): Promise<OAuthClientInfo | null> {
  const ctx = await get().auth.$context
  const c = await ctx.adapter.findOne<ClientRow>({ model: "oauthClient", where: [{ field: "clientId", value: clientId }] })
  return c ? { clientId: c.clientId, name: c.name || c.clientId, uri: c.uri ?? null } : null
}

export interface ConnectedApp extends OAuthClientInfo {
  readonly userId: string
  /** When the person first allowed it. */
  readonly since: string
}

/** The apps people have allowed to use their account; one person's, or everyone's. */
export async function connectedApps(userId?: string): Promise<Array<ConnectedApp>> {
  const ctx = await get().auth.$context
  const consents = await ctx.adapter.findMany<{ userId: string; clientId: string; createdAt: Date | string }>({
    model: "oauthConsent",
    where: userId ? [{ field: "userId", value: userId }] : []
  })
  const out: Array<ConnectedApp> = []
  for (const c of consents) {
    const client = await oauthClient(c.clientId)
    out.push({ userId: c.userId, clientId: c.clientId, name: client?.name ?? c.clientId, uri: client?.uri ?? null, since: new Date(c.createdAt).toISOString() })
  }
  return out
}

/**
 * Disconnect a person's apps, or one of them: their consent and tokens go, so
 * the app has to ask again. The MCP endpoint checks for the consent on every
 * call, so an access token already issued stops working at once too.
 */
export async function revokeApps(userId: string, clientId?: string): Promise<number> {
  const ctx = await get().auth.$context
  const where = [{ field: "userId", value: userId }, ...(clientId ? [{ field: "clientId", value: clientId }] : [])]
  const before = await ctx.adapter.count({ model: "oauthConsent", where })
  for (const model of ["oauthRefreshToken", "oauthAccessToken", "oauthConsent"]) await ctx.adapter.deleteMany({ model, where })
  return before
}

// ---------- the MCP endpoint's side: checking a bearer token ----------

/** Who an MCP request comes from: the person, and the app acting for them. */
export interface McpCaller {
  readonly viewer: Viewer
  readonly clientId: string | null
}

/** The signing keys, from the JWT plugin, kept for ten minutes (re-read at once for a key it doesn't know). */
let keys: { readonly at: number; readonly set: ReturnType<typeof createLocalJWKSet> } | undefined
async function signingKeys(fresh: boolean) {
  if (!fresh && keys && Date.now() - keys.at < 10 * 60_000) return keys.set
  const jwks = (await get().auth.api.getJwks()) as Parameters<typeof createLocalJWKSet>[0]
  keys = { at: Date.now(), set: createLocalJWKSet(jwks) }
  return keys.set
}

/** Where an MCP client finds out how to sign in (RFC 9728), at the site's root with the endpoint's path. */
export const protectedResourceMetadataUrl = () => `${get().config.baseURL}/.well-known/oauth-protected-resource${MCP_PATH}`

/**
 * Check an MCP request's bearer token: signed by this server, issued for the
 * MCP endpoint, not expired, for an account that still exists, and for an app
 * the person hasn't disconnected. Returns the caller, or a 401 that tells the
 * client where to sign in.
 */
export async function verifyMcpRequest(request: Request): Promise<{ readonly caller: McpCaller } | { readonly refusal: Response }> {
  const refuse = (error?: string) => {
    const challenge = [`Bearer resource_metadata="${protectedResourceMetadataUrl()}"`, ...(error ? [`error="${error}"`] : [])].join(", ")
    return {
      refusal: new Response(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: error ? "The access token isn't valid; sign in again." : "Sign in to use Cogitator Core." } }),
        { status: 401, headers: { "Content-Type": "application/json", "WWW-Authenticate": challenge, "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "WWW-Authenticate" } }
      )
    }
  }
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return refuse()
  const ctx = await get().auth.$context
  const options = { issuer: ctx.baseURL, audience: `${get().config.baseURL}${MCP_PATH}` }
  let claims: { sub?: string; azp?: unknown; client_id?: unknown }
  try {
    claims = (await jwtVerify(token, await signingKeys(false), options)).payload
  } catch (e) {
    // a key the cache doesn't have yet: read the keys again, once
    if (!(e instanceof Error && /no applicable key/i.test(e.message))) return refuse("invalid_token")
    try {
      claims = (await jwtVerify(token, await signingKeys(true), options)).payload
    } catch {
      return refuse("invalid_token")
    }
  }
  const user = claims.sub ? await ctx.internalAdapter.findUserById(claims.sub) : null
  if (!user) return refuse("invalid_token")
  const client = typeof claims.azp === "string" ? claims.azp : typeof claims.client_id === "string" ? claims.client_id : null
  // disconnecting an app takes effect at once, not when its token lapses: the person's consent must still be there
  const allowed = client
    ? await ctx.adapter.count({ model: "oauthConsent", where: [{ field: "userId", value: user.id }, { field: "clientId", value: client }] })
    : 0
  if (!allowed) return refuse("invalid_token")
  return { caller: { viewer: toViewer(user as typeof user & { role?: unknown }), clientId: client } }
}
