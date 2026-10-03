/**
 * The checks loaders and actions make before changing anything. Pages also
 * hide what a visitor can't do, but these are what actually stop it.
 */
import { data, redirect, type RouterContextProvider } from "react-router"
import { canEditList, isOwner, type Viewer, viewerContext } from "~/viewer"

type Context = Readonly<RouterContextProvider>

const signInFirst = (request: Request) => {
  const url = new URL(request.url)
  // the path as the app sees it, without the site prefix that redirect() adds back
  const back = url.pathname.replace(/^\/cogitator-core/, "") + url.search
  return redirect(`/sign-in?back=${encodeURIComponent(back || "/")}`)
}

export const viewerOf = (context: Context): Viewer | null => context.get(viewerContext)

/** Signed in, or sent to sign in and brought back. */
export function requireViewer(context: Context, request: Request): Viewer {
  const v = viewerOf(context)
  if (!v) throw signInFirst(request)
  return v
}

/** The site's owner: refreshing data, the rules library, benchmark targets, accounts. */
export function requireOwner(context: Context, request: Request): Viewer {
  const v = requireViewer(context, request)
  if (!isOwner(v)) throw data({ message: "Only the site’s owner can do that." }, { status: 403 })
  return v
}

/** This list's owner (the site's owner for the built-in list). */
export function requireListEditor(context: Context, request: Request, list: { readonly ownerId?: string | null }): Viewer {
  const v = requireViewer(context, request)
  if (!canEditList(v, list)) throw data({ message: "Only the list’s owner can change it." }, { status: 403 })
  return v
}
