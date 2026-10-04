/**
 * Allow an app (an MCP client: Claude, ChatGPT, a coding agent) to use
 * Cogitator Core as you. The OAuth server sends you here after you've signed
 * in, with its request signed in the query; allowing or refusing sends you back
 * to the app (see .server/auth). Once allowed, the app doesn't ask again until
 * it's disconnected.
 */
import { data, Form, redirect, redirectDocument, useNavigation, useSearchParams } from "react-router"
import { consent, oauthClient } from "~/.server/auth/auth"
import { viewerContext } from "~/viewer"
import type { Route } from "./+types/consent"

/** What each scope lets the app do, in words. */
const SCOPES: Record<string, string> = {
  openid: "Know which account it’s using",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected without asking again, until it’s disconnected"
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const viewer = context.get(viewerContext)
  if (!viewer) throw redirect(`/sign-in?back=${encodeURIComponent(`/consent${url.search}`)}`)
  const clientId = url.searchParams.get("client_id") ?? ""
  const client = await oauthClient(clientId)
  const scopes = (url.searchParams.get("scope") ?? "").split(/\s+/).filter(Boolean)
  return { app: client?.name ?? clientId, uri: client?.uri ?? null, account: { name: viewer.name, email: viewer.email }, scopes }
}

export async function action({ request, context }: Route.ActionArgs) {
  if (!context.get(viewerContext)) throw redirect("/sign-in")
  const form = await request.formData()
  const oauth = String(form.get("oauth_query") ?? "")
  if (!oauth) throw data({ message: "This page needs the app’s request; start again from the app." }, { status: 400 })
  try {
    // back to the app, usually on another site: a full page load at an absolute address
    return redirectDocument(new URL(await consent(request, oauth, form.get("intent") === "allow"), request.url).toString())
  } catch {
    return data({ error: "The app’s request has expired or isn’t valid; start again from the app." }, { status: 400 })
  }
}

export const meta: Route.MetaFunction = () => [{ title: "Allow an app · Cogitator Core" }]

export default function Consent({ loaderData, actionData }: Route.ComponentProps) {
  const { app, uri, account, scopes } = loaderData
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const busy = navigation.state !== "idle"
  return (
    <main className="narrow">
      <div className="dhead">
        <div>
          <h2>Allow {app}?</h2>
          <div className="meta">
            {app}
            {uri ? ` (${uri})` : ""} wants to use Cogitator Core as <b>{account.name}</b> ({account.email}).
          </div>
        </div>
      </div>
      <div className="authform">
        <p>It will be able to:</p>
        <ul className="scopes">
          <li>Read and score army lists, explain matchups and look up rules, as you</li>
          {scopes
            .filter((s) => s in SCOPES)
            .map((s) => (
              <li key={s}>{SCOPES[s]}</li>
            ))}
          {scopes
            .filter((s) => !(s in SCOPES))
            .map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
        </ul>
        <p className="hint">
          It can’t change your lists or anything else on the site. What it does is recorded as yours, and the site’s owner can disconnect it.
        </p>
        {actionData && "error" in actionData ? <p className="err">{actionData.error}</p> : null}
        <Form method="post" className="presets">
          <input type="hidden" name="oauth_query" value={params.toString()} />
          <button className="btn primary" type="submit" name="intent" value="allow" disabled={busy}>
            Allow
          </button>
          <button className="btn" type="submit" name="intent" value="deny" disabled={busy}>
            Don’t allow
          </button>
        </Form>
      </div>
    </main>
  )
}
