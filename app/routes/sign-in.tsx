/** Sign in. There is no sign-up: the site's owner makes every account. */
import { data, Form, redirect, useNavigation, useSearchParams } from "react-router"
import { signIn } from "~/.server/auth/auth"
import { viewerContext } from "~/viewer"
import type { Route } from "./+types/sign-in"

/** Only paths inside this site, so a link can't use the sign-in page to send someone elsewhere. */
const safeBack = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/lists")

export async function loader({ context, request }: Route.LoaderArgs) {
  if (context.get(viewerContext)) throw redirect(safeBack(new URL(request.url).searchParams.get("back")))
  return null
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const email = String(form.get("email") ?? "").trim()
  const password = String(form.get("password") ?? "")
  const result = await signIn(request, email, password)
  if (!result.ok) return data({ error: result.message, email }, { status: 401 })
  const headers = new Headers()
  for (const c of result.setCookies) headers.append("Set-Cookie", c)
  return redirect(safeBack(form.get("back")), { headers })
}

export const meta: Route.MetaFunction = () => [{ title: "Sign in · Cogitator Core" }]

export default function SignIn({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams()
  const navigation = useNavigation()
  return (
    <main className="narrow">
      <div className="dhead">
        <div>
          <h2>Sign in</h2>
          <div className="meta">Accounts are made by the site’s owner. Without one you can still open any list and try its switches.</div>
        </div>
      </div>
      <Form method="post" className="authform">
        <input type="hidden" name="back" value={params.get("back") ?? "/lists"} />
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
