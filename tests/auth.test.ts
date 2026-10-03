/**
 * Accounts: who may change what, and better-auth running on the app's own
 * database through `ExecuteDialect` (in-memory node:sqlite here, the Durable
 * Object's SQLite on Cloudflare).
 */
import { Effect, ManagedRuntime } from "effect"
import { SqlClient } from "effect/sql"
import { beforeAll, describe, expect, it } from "vitest"
import {
  AccountError,
  checkSetupCode,
  createAccount,
  getViewer,
  hasOwner,
  installAuth,
  listAccounts,
  removeAccount,
  setPassword,
  signIn,
  signOut
} from "~/.server/auth/auth"
import { layerAt } from "~/.server/db/Db"
import { canEditList, isOwner, listedFor, type Viewer } from "~/viewer"

const owner: Viewer = { id: "o", name: "Khalid", email: "k@example.com", role: "owner" }
const friend: Viewer = { id: "f", name: "Sam", email: "s@example.com", role: "friend" }

describe("who may change what", () => {
  it("a list's owner may change it; the site's owner owns the lists nobody else does", () => {
    expect(canEditList(friend, { ownerId: "f" })).toBe(true)
    expect(canEditList(friend, { ownerId: "o" })).toBe(false)
    expect(canEditList(owner, { ownerId: "f" })).toBe(false)
    // the built-in list and lists from before accounts
    expect(canEditList(owner, { ownerId: null })).toBe(true)
    expect(canEditList(friend, { ownerId: null })).toBe(false)
    expect(canEditList(null, { ownerId: null })).toBe(false)
    expect(isOwner(owner)).toBe(true)
    expect(isOwner(friend)).toBe(false)
  })

  it("everyone's Lists page shows the built-in list; a signed-in one adds their own", () => {
    const builtin = { ownerId: null, builtin: true }
    const mine = { ownerId: "f", builtin: false }
    const legacy = { ownerId: null, builtin: false }
    expect([builtin, mine, legacy].filter((l) => listedFor(null, l))).toEqual([builtin])
    expect([builtin, mine, legacy].filter((l) => listedFor(friend, l))).toEqual([builtin, mine])
    expect([builtin, mine, legacy].filter((l) => listedFor(owner, l))).toEqual([builtin, legacy])
  })
})

describe("accounts on the app's database", () => {
  const runtime = ManagedRuntime.make(layerAt(":memory:"))
  const request = (cookie?: string, ip = "203.0.113.7") =>
    new Request("http://localhost:5173/cogitator-core/lists", { headers: { ...(cookie ? { cookie } : {}), "cf-connecting-ip": ip } })
  /** The Cookie header a browser would send back after these Set-Cookie headers. */
  const cookieFrom = (setCookies: ReadonlyArray<string>) =>
    setCookies.map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ")

  beforeAll(async () => {
    await runtime.runPromise(Effect.void)
    installAuth({
      secret: "a test secret that is long enough to sign sessions with",
      baseURL: "http://localhost:5173",
      setupCode: "open sesame",
      execute: (statement, params) => runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe<Record<string, unknown>>(statement, [...params])))
    })
  })

  it("starts with no owner; the setup code is checked exactly", async () => {
    expect(await hasOwner()).toBe(false)
    expect(checkSetupCode("open sesame")).toBe(true)
    expect(checkSetupCode("open sesam")).toBe(false)
    expect(checkSetupCode("")).toBe(false)
  })

  it("creates the owner, who signs in and is recognised from the session cookie", async () => {
    await createAccount({ name: "Khalid", email: "Khalid@Example.com", password: "correct horse battery", role: "owner" })
    expect(await hasOwner()).toBe(true)

    expect(await getViewer(request())).toEqual({ viewer: null, setCookies: [] })
    const result = await signIn(request(), "khalid@example.com", "correct horse battery")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const cookie = cookieFrom(result.setCookies)
    expect(cookie).toMatch(/cogitator\.session_token=/)
    // the cookie stays on this site's path; khld.dev hosts other sites
    expect(result.setCookies.find((c) => c.startsWith("cogitator.session_token"))).toMatch(/Path=\/cogitator-core/)

    const { viewer } = await getViewer(request(cookie))
    expect(viewer).toMatchObject({ name: "Khalid", email: "khalid@example.com", role: "owner" })

    // signing out ends the session itself, so even the old cookie no longer works
    await signOut(request(cookie))
    expect((await getViewer(request(cookie))).viewer).toBeNull()
  })

  it("refuses a wrong password, a short one, and a second account with the same email", async () => {
    expect((await signIn(request(undefined, "198.51.100.1"), "khalid@example.com", "wrong password")).ok).toBe(false)
    await expect(createAccount({ name: "Sam", email: "sam@example.com", password: "short", role: "friend" })).rejects.toBeInstanceOf(AccountError)
    await expect(createAccount({ name: "Again", email: "KHALID@example.com", password: "long enough password", role: "friend" })).rejects.toThrow(
      /already an account/
    )
  })

  it("stops guessing after a few failures", async () => {
    const r = () => signIn(request(undefined, "192.0.2.99"), "nobody@example.com", "guess guess guess")
    for (let i = 0; i < 8; i++) await r()
    expect(await r()).toEqual({ ok: false, message: "Too many attempts. Try again in a few minutes." })
  })

  it("adds a friend; a new password signs them out; removing them ends their session", async () => {
    const id = await createAccount({ name: "Sam", email: "sam@example.com", password: "first password!", role: "friend" })
    expect((await listAccounts()).map((a) => [a.name, a.role])).toEqual([["Khalid", "owner"], ["Sam", "friend"]])

    const first = await signIn(request(undefined, "198.51.100.2"), "sam@example.com", "first password!")
    if (!first.ok) throw new Error(first.message)
    const cookie = cookieFrom(first.setCookies)
    expect((await getViewer(request(cookie))).viewer?.role).toBe("friend")

    await setPassword(id, "second password!")
    expect((await getViewer(request(cookie))).viewer).toBeNull()
    expect((await signIn(request(undefined, "198.51.100.2"), "sam@example.com", "first password!")).ok).toBe(false)
    const second = await signIn(request(undefined, "198.51.100.2"), "sam@example.com", "second password!")
    if (!second.ok) throw new Error(second.message)

    await removeAccount(id)
    expect((await getViewer(request(cookieFrom(second.setCookies)))).viewer).toBeNull()
    expect((await listAccounts()).map((a) => a.name)).toEqual(["Khalid"])
  })
})
