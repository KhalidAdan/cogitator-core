/**
 * What a visitor's browser keeps for them.
 *
 * - The switches and modifiers they set on a list they can't change (signed
 *   out, or someone else's list): kept per list in a cookie, so the matrix
 *   answers them without touching the list itself.
 * - The list they last opened, so `/` takes them back to it.
 */
import { Option, Schema } from "effect"
import { createCookie } from "react-router"
import { Opts } from "~/domain/schema"

const PATH = "/cogitator-core"
const secure = (request: Request) => new URL(request.url).protocol === "https:"

const optsCookie = (listId: string) => createCookie(`opts-${listId}`, { path: PATH, sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 90 })
const decodeOpts = Schema.decodeUnknownOption(Opts)

/** The options this browser has set on a list, if any. Anything that doesn't decode is ignored. */
export async function readViewerOpts(request: Request, listId: string): Promise<Opts | null> {
  const raw = await optsCookie(listId).parse(request.headers.get("Cookie"))
  return raw ? Option.getOrNull(decodeOpts(raw)) : null
}

export const writeViewerOpts = (request: Request, listId: string, opts: Opts) => optsCookie(listId).serialize(opts, { secure: secure(request) })

export const clearViewerOpts = (request: Request, listId: string) => optsCookie(listId).serialize("", { maxAge: 0, secure: secure(request) })

const activeList = createCookie("active-list", { path: PATH, sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 })

export async function readActiveList(request: Request): Promise<string | null> {
  const v = await activeList.parse(request.headers.get("Cookie"))
  return typeof v === "string" ? v : null
}

export const writeActiveList = (request: Request, listId: string) => activeList.serialize(listId, { secure: secure(request) })
