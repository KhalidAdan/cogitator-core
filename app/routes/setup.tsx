/**
 * The owner's account, once. Open only while the site has no owner, and only
 * with the SETUP_CODE secret, so nobody else can claim the site after a
 * deploy. Afterwards it sends people to sign in.
 */
import { data, Form, redirect, useNavigation } from "react-router"
import { AccountError, checkSetupCode, createAccount, hasOwner, setupConfigured, signIn } from "~/.server/auth/auth"
import { MIN_PASSWORD } from "~/viewer"
import type { Route } from "./+types/setup"

export async function loader() {
  if (await hasOwner()) throw redirect("/sign-in")
  return { configured: setupConfigured() }
}

export async function action({ request }: Route.ActionArgs) {
  if (await hasOwner()) throw redirect("/sign-in")
  const form = await request.formData()
  const text = (k: string) => String(form.get(k) ?? "")
  if (!checkSetupCode(text("code"))) {
    // a wrong code costs a moment, so it can't be guessed quickly
    await new Promise((r) => setTimeout(r, 1000))
    return data({ error: "That isn’t the setup code." }, { status: 403 })
  }
  try {
    await createAccount({ name: text("name"), email: text("email"), password: text("password"), role: "owner" })
  } catch (e) {
    if (e instanceof AccountError) return data({ error: e.message }, { status: 400 })
    throw e
  }
  const result = await signIn(request, text("email"), text("password"))
  const headers = new Headers()
  if (result.ok) for (const c of result.setCookies) headers.append("Set-Cookie", c)
  return redirect(result.ok ? "/accounts" : "/sign-in", { headers })
}

export const meta: Route.MetaFunction = () => [{ title: "Set up · Cogitator Core" }]

export default function Setup({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation()
  return (
    <main className="narrow">
      <div className="dhead">
        <div>
          <h2>Set up</h2>
          <div className="meta">Make the site owner’s account. This page closes once it exists.</div>
        </div>
      </div>
      {!loaderData.configured ? (
        <p className="note warn">
          Setup is closed: the site has no SETUP_CODE secret. Set one with <code>wrangler secret put SETUP_CODE</code> (or in{" "}
          <code>.dev.vars</code> locally), then come back.
        </p>
      ) : (
        <Form method="post" className="authform">
          <label className="field">
            Setup code <span className="hint">the SETUP_CODE secret</span>
            <input name="code" type="password" autoComplete="off" required autoFocus />
          </label>
          <label className="field">
            Your name
            <input name="name" autoComplete="name" required />
          </label>
          <label className="field">
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label className="field">
            Password <span className="hint">at least {MIN_PASSWORD} characters</span>
            <input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
          </label>
          {actionData?.error ? <p className="err">{actionData.error}</p> : null}
          <div className="presets">
            <button className="btn primary" type="submit" disabled={navigation.state !== "idle"}>
              {navigation.state !== "idle" ? "Creating…" : "Create the owner’s account"}
            </button>
          </div>
        </Form>
      )}
    </main>
  )
}
