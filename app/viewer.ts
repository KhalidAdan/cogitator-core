/**
 * Who is looking, and what they may do. Shared by the server (which enforces
 * it) and the pages (which only show what will work).
 *
 * There is no sign-up: the site's owner creates every account. The owner can
 * do everything; a friend can import lists and change their own. Anyone, signed
 * in or not, can open any list by its link and play with its switches, which
 * are then kept in their browser, not on the list.
 */
import { createContext, useRouteLoaderData } from "react-router"

export type Role = "owner" | "friend"

export interface Viewer {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: Role
}

/** Set by the root middleware for every request; `null` when signed out. */
export const viewerContext = createContext<Viewer | null>(null)

/** In a page: who is signed in, from the root route's loader. */
export const useViewer = (): Viewer | null => useRouteLoaderData<{ viewer: Viewer | null }>("root")?.viewer ?? null

export const isOwner = (v: Viewer | null | undefined): boolean => v?.role === "owner"

/** Shortest password an account can have. */
export const MIN_PASSWORD = 10

/**
 * May this person change this list? Its owner may; a list with no owner (the
 * built-in list, and lists from before accounts) belongs to the site's owner.
 */
export const canEditList = (v: Viewer | null | undefined, list: { readonly ownerId?: string | null }): boolean =>
  !!v && (list.ownerId ? list.ownerId === v.id : v.role === "owner")

/** Lists shown on someone's "Your lists": theirs, plus the built-in list for everyone. */
export const listedFor = (v: Viewer | null | undefined, list: { readonly ownerId?: string | null; readonly builtin: boolean }): boolean =>
  list.builtin || canEditList(v, list)
