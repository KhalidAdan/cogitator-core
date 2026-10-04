/**
 * Sign in. There is no sign-up: the site's owner makes every account.
 *
 * An MCP client's OAuth request arrives here too, signed, in the query (see
 * .server/auth): the page says which app is asking, and signing in carries on
 * with the request, to the consent page or straight back to the app.
 */
import { data, Form, redirect, redirectDocument, useNavigation, useSearchParams } from "react-router"
import { oauthClient, signIn } from "~/.server/auth/auth"
import { viewerContext } from "~/viewer"
import type { Route } from "./+types/sign-in"

/** Only paths inside this site, so a link can't use the sign-in page to send someone elsewhere. */
const safeBack = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/lists")

/** The signed authorization request an MCP client's sign-in carries, if this is one. */
const oauthQueryOf = (url: URL) => (url.searchParams.has("sig") && url.searchParams.has("client_id") ? url.search.slice(1) : null)

export async function loader({ context, request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const oauth = oauthQueryOf(url)
  // already signed in: back where they came from, unless an app asked them to sign in again
  if (context.get(viewerContext) && !oauth) throw redirect(safeBack(url.searchParams.get("back")))
  const client = oauth ? await oauthClient(url.searchParams.get("client_id") ?? "") : null
  return { app: oauth ? (client?.name ?? "An app") : null }
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const email = String(form.get("email") ?? "").trim()
  const password = String(form.get("password") ?? "")
  const oauth = String(form.get("oauth_query") ?? "") || undefined
  const result = await signIn(request, email, password, oauth)
  if (!result.ok) return data({ error: result.message, email }, { status: 401 })
  const headers = new Headers()
  for (const c of result.setCookies) headers.append("Set-Cookie", c)
  // an app's sign-in goes on to the consent page, or back to the app; anyone else, back where they were
  if (oauth) {
    if (!result.next) {
      return data({ error: "Signed in, but the app’s request couldn’t carry on. Try connecting again from the app.", email }, { status: 400, headers })
    }
    // a full page load at an absolute address: the next step may be the consent page, the OAuth server or the app
    // itself, and a path would otherwise be read as inside the app and given its base path twice
    return redirectDocument(new URL(result.next, request.url).toString(), { headers })
  }
  return redirect(safeBack(form.get("back")), { headers })
}

export const meta: Route.MetaFunction = () => [{ title: "Sign in · Cogitator Core" }]

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const oauth = params.has("sig") && params.has("client_id") ? params.toString() : ""
  return (
    <main className="narrow">
      <div className="dhead">
        <div>
          <h2>Sign in</h2>
          <div className="meta">
            {loaderData.app
              ? `${loaderData.app} wants to use Cogitator Core with your account. Sign in to continue; you’ll be asked to allow it next.`
              : "Accounts are made by the site’s owner. Without one you can still open any list and try its switches."}
          </div>
        </div>
      </div>
      <Form method="post" className="authform">
        <input type="hidden" name="back" value={params.get("back") ?? "/lists"} />
        {oauth ? <input type="hidden" name="oauth_query" value={oauth} /> : null}
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="username" required defaultValue={actionData?.email ?? ""} autoFocus />
        </label>
        <label className="field">
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {actionData?.error ? <p className="err">{actionData.error}</p> : null}
        <div className="presets">
          <button className="btn primary" type="submit" disabled={navigation.state !== "idle"}>
            {navigation.state !== "idle" ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </Form>
    </main>
  )
}
