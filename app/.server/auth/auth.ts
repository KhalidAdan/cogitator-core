/**
 * Accounts and sessions, with better-auth.
 *
 * Email and password, and no sign-up: the site's owner creates every account
 * (the first through `/setup`, which needs the SETUP_CODE secret, the rest on
 * the Accounts page). better-auth stores its users, sessions and password
 * hashes in the app's own SQLite (migration `0005_accounts`) through
 * `ExecuteDialect`, and is only ever called from the server, from the routes'
 * loaders and actions. Its HTTP endpoints aren't exposed.
 *
 * The Durable Object installs it at start-up (`installAuth`), with the secret
 * and the site's URL from its environment.
 */
import { betterAuth } from "better-auth"
import { MIN_PASSWORD, type Role, type Viewer } from "~/viewer"
import { type Execute, ExecuteDialect } from "./dialect"

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

const makeAuth = (config: AuthConfig) =>
  betterAuth({
    appName: "Cogitator Core",
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/cogitator-core/api/auth",
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
    telemetry: { enabled: false }
  })

type Auth = ReturnType<typeof makeAuth>

let current: { readonly auth: Auth; readonly config: AuthConfig } | undefined

/** Called once by the Durable Object when it starts. */
export function installAuth(config: AuthConfig): void {
  current = { auth: makeAuth(config), config }
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

export async function signIn(
  request: Request,
  email: string,
  password: string
): Promise<{ readonly ok: true; readonly setCookies: Array<string> } | { readonly ok: false; readonly message: string }> {
  const now = Date.now()
  const keys = [`ip:${request.headers.get("cf-connecting-ip") ?? "local"}`, `email:${email.toLowerCase()}`]
  if (keys.some((k) => tooMany(k, now))) return { ok: false, message: "Too many attempts. Try again in a few minutes." }
  try {
    const { headers } = await get().auth.api.signInEmail({ body: { email, password }, headers: authHeaders(request), returnHeaders: true })
    for (const k of keys) failures.delete(k)
    return { ok: true, setCookies: setCookies(headers) }
  } catch {
    for (const k of keys) fail(k, now)
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
  // signed out everywhere; they sign in again with the new one
  await ctx.internalAdapter.deleteUserSessions(userId)
}

export async function removeAccount(userId: string): Promise<void> {
  const ctx = await get().auth.$context
  await ctx.internalAdapter.deleteUserSessions(userId)
  await ctx.internalAdapter.deleteAccounts(userId)
  await ctx.internalAdapter.deleteUser(userId)
}
