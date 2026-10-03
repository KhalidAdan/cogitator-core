import "@fontsource/cormorant-garamond/latin-500.css"
import "@fontsource/cormorant-garamond/latin-500-italic.css"
import "@fontsource/cormorant-garamond/latin-600.css"
import "@fontsource/cormorant-garamond/latin-700.css"
import "@fontsource/ibm-plex-sans-condensed/latin-400.css"
import "@fontsource/ibm-plex-sans-condensed/latin-500.css"
import "@fontsource/ibm-plex-sans-condensed/latin-600.css"
import "./styles/app.css"

import { Effect } from "effect"
import {
  Form,
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useFetcher,
  useNavigation,
  useRouteLoaderData
} from "react-router"
import { getViewer } from "~/.server/auth/auth"
import { run } from "~/.server/runtime"
import { readTheme } from "~/.server/theme"
import { nextTheme, type Theme } from "~/theme"
import { isOwner, type Viewer, viewerContext } from "~/viewer"
import type { Route } from "./+types/root"

/** A response that takes extra Set-Cookie headers, even when the original's headers are immutable (a fetched redirect). */
function withCookies(response: Response, cookies: ReadonlyArray<string>): Response {
  if (!cookies.length) return response
  try {
    for (const c of cookies) response.headers.append("Set-Cookie", c)
    return response
  } catch {
    const copy = new Response(response.body, response)
    for (const c of cookies) copy.headers.append("Set-Cookie", c)
    return copy
  }
}

// A form posted from another site never reaches an action: React Router refuses it (its built-in CSRF check).
export const middleware: Route.MiddlewareFunction[] = [
  // Who is asking: every loader and action can read it from the context.
  async ({ request, context }, next) => {
    const { viewer, setCookies } = await getViewer(request)
    context.set(viewerContext, viewer)
    return withCookies(await next(), setCookies)
  },
  // Log every request through the Effect logger, with how long it took.
  async ({ request }, next) => {
    const start = performance.now()
    const response = await next()
    const url = new URL(request.url)
    void run(Effect.logDebug(`${request.method} ${url.pathname}${url.search} → ${response.status} in ${Math.round(performance.now() - start)}ms`))
    return response
  }
]

export async function loader({ request, context }: Route.LoaderArgs) {
  return { theme: await readTheme(request), viewer: context.get(viewerContext) }
}

// the theme and who is signed in only change through these actions
export const shouldRevalidate = ({ formAction }: { formAction?: string }) =>
  !!formAction && /\/(theme|sign-in|sign-out|setup)$/.test(new URL(formAction, "http://x").pathname)

export const meta: Route.MetaFunction = () => [
  { title: "Cogitator Core" },
  { name: "description", content: "How many enemy points does each unit remove per point it costs?" }
]

// under the app's prefix, like the built assets, so Cloudflare serves it without running the Worker
export const links: Route.LinksFunction = () => [{ rel: "icon", href: "/cogitator-core/favicon.svg", type: "image/svg+xml" }]

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root")
  const fetcher = useFetcher<{ theme: Theme }>({ key: "theme" })
  const pending = fetcher.formData?.get("theme")
  const theme = (typeof pending === "string" ? pending : data?.theme ?? "auto") as Theme
  return (
    <html lang="en" data-theme={theme === "auto" ? undefined : theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <Meta />
        <Links />
      </head>
      <body>
        <div className="wrap">
          <TopBar theme={theme} viewer={data?.viewer ?? null} />
          {children}
          <footer className="credit">
            Datasheets and rules text are <a href="https://wahapedia.ru/wh40k11ed/the-rules/data-export" rel="noreferrer">powered by Wahapedia</a>;
            if the export is useful to you, consider <a href="https://wahapedia.ru/wh40k11ed/the-rules/author/#Support" rel="noreferrer">supporting the project</a>.
            Points are read from the <a href="https://mfm.warhammer-community.com" rel="noreferrer">Munitorum Field Manual</a>. This idea was done
            first at the <a href="https://cullingcogitator.app" rel="noreferrer">Culling Cogitator</a>, give them a look for a productized version that
            is very affordable!
          </footer>
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

function TopBar({ theme, viewer }: { theme: Theme; viewer: Viewer | null }) {
  const fetcher = useFetcher({ key: "theme" })
  const navigation = useNavigation()
  return (
    <nav className="topbar" aria-label="Sections">
      <Link to="/" className="brand">
        Cogitator core
      </Link>
      <div className="toplinks">
        <NavLink to="/lists" prefetch="intent">Lists</NavLink>
        <NavLink to="/library" prefetch="intent">Rules library</NavLink>
        <NavLink to="/database" prefetch="intent">Database</NavLink>
        {isOwner(viewer) ? <NavLink to="/accounts">Accounts</NavLink> : null}
      </div>
      <span className={"busy" + (navigation.state === "idle" ? "" : " on")} aria-hidden="true" />
      {viewer ? (
        <Form method="post" action="/sign-out" className="who">
          <span title={viewer.email}>{viewer.name}</span>
          <button className="linkbtn" type="submit">
            Sign out
          </button>
        </Form>
      ) : (
        <Link to="/sign-in" className="who">
          Sign in
        </Link>
      )}
      <fetcher.Form method="post" action="/theme">
        <button className="themebtn" type="submit" name="theme" value={nextTheme(theme)}>
          Theme: {theme}
        </button>
      </fetcher.Form>
    </nav>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong"
  let detail = "An unexpected error occurred."
  let stack: string | undefined
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Not found" : `Error ${error.status}`
    detail = (typeof error.data === "object" && error.data?.message) || (typeof error.data === "string" && error.data) || error.statusText || detail
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message
    stack = error.stack
  }
  return (
    <main>
      <div className="dhead">
        <div>
          <h2>{title}</h2>
          <div className="meta">{detail}</div>
        </div>
      </div>
      <p className="empty">
        <Link to="/">Back to your list</Link>
      </p>
      {stack ? <pre className="stack">{stack}</pre> : null}
    </main>
  )
}
