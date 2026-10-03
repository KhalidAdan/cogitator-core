/**
 * Accounts, for the site's owner: add a friend, set a new password, remove
 * one. There's no email, so a new or forgotten password is set here and passed
 * on in person.
 */
import { Effect } from "effect"
import { data, Form, useNavigation } from "react-router"
import { requireOwner } from "~/.server/access"
import { AccountError, createAccount, listAccounts, removeAccount, setPassword } from "~/.server/auth/auth"
import { Lists } from "~/.server/repos/Lists"
import { run } from "~/.server/runtime"
import { plural } from "~/components/ledger"
import { MIN_PASSWORD } from "~/viewer"
import type { Route } from "./+types/accounts"

export async function loader({ context, request }: Route.LoaderArgs) {
  const me = requireOwner(context, request)
  const [accounts, lists] = await Promise.all([listAccounts(), run(Effect.flatMap(Lists, (l) => l.all))])
  return {
    me: me.id,
    accounts: accounts.map((a) => ({
      ...a,
      // lists without an owner are the site owner's
      lists: lists.filter((l) => !l.builtin && (l.ownerId === a.id || (!l.ownerId && a.role === "owner"))).length
    }))
  }
}

export async function action({ context, request }: Route.ActionArgs) {
  const me = requireOwner(context, request)
  const form = await request.formData()
  const text = (k: string) => String(form.get(k) ?? "")
  const intent = text("intent")
  try {
    if (intent === "add") {
      await createAccount({ name: text("name"), email: text("email"), password: text("password"), role: "friend" })
      return { ok: `Added ${text("name").trim()}. Give them their email and password; they can sign in now.` }
    }
    if (intent === "password") {
      await setPassword(text("id"), text("password"))
      return { ok: "Password changed. They’ve been signed out everywhere and sign in with the new one." }
    }
    if (intent === "remove") {
      if (text("id") === me.id) return data({ error: "You can’t remove your own account." }, { status: 400 })
      await run(Effect.flatMap(Lists, (l) => l.releaseOwner(text("id"))))
      await removeAccount(text("id"))
      return { ok: "Removed. Their lists are yours now." }
    }
  } catch (e) {
    if (e instanceof AccountError) return data({ error: e.message }, { status: 400 })
    throw e
  }
  throw data({ message: "Unknown action." }, { status: 400 })
}

export const meta: Route.MetaFunction = () => [{ title: "Accounts · Cogitator Core" }]

export default function Accounts({ loaderData, actionData }: Route.ComponentProps) {
  const { accounts, me } = loaderData
  const navigation = useNavigation()
  const busy = navigation.state !== "idle"
  return (
    <main>
      <div className="dhead">
        <div>
          <h2>Accounts</h2>
          <div className="meta">
            Nobody can sign up: everyone with an account was added here. Friends can import lists and change their own; only you can
            refresh the database, edit the rules library and targets, and manage accounts.
          </div>
        </div>
      </div>
      {actionData && "ok" in actionData ? <p className="note">{actionData.ok}</p> : null}
      {actionData && "error" in actionData ? <p className="note warn">{actionData.error}</p> : null}

      <div className="tbl-scroll" style={{ marginTop: 14 }}>
        <table className="dt">
          <thead>
            <tr>
              <th>Name</th>
              <th className="l">Email</th>
              <th className="l">Role</th>
              <th>Lists</th>
              <th className="l">New password</th>
              <th className="l" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <b>{a.name}</b>
                  {a.id === me ? <span className="hint"> you</span> : null}
                </td>
                <td className="l">{a.email}</td>
                <td className="l">{a.role === "owner" ? "owner" : "friend"}</td>
                <td>{a.lists}</td>
                <td className="l">
                  <Form method="post" className="inline">
                    <input type="hidden" name="intent" value="password" />
                    <input type="hidden" name="id" value={a.id} />
                    <input
                      className="kwin"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD}
                      required
                      aria-label={`New password for ${a.name}`}
                    />{" "}
                    <button className="btn" type="submit" disabled={busy}>
                      Set
                    </button>
                  </Form>
                </td>
                <td className="l">
                  {a.id === me ? null : (
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        if (!window.confirm(`Remove ${a.name}? Their ${a.lists} ${plural(a.lists, "list")} become yours.`)) e.preventDefault()
                      }}
                    >
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="id" value={a.id} />
                      <button className="btn ghost danger" type="submit" disabled={busy}>
                        Remove
                      </button>
                    </Form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="sh">Add a friend</h3>
      <Form method="post" className="authform" key={actionData && "ok" in actionData ? actionData.ok : "add"}>
        <input type="hidden" name="intent" value="add" />
        <label className="field">
          Name
          <input name="name" required />
        </label>
        <label className="field">
          Email <span className="hint">what they sign in with</span>
          <input name="email" type="email" required />
        </label>
        <label className="field">
          Password <span className="hint">at least {MIN_PASSWORD} characters; tell them, and they can sign in</span>
          <input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </label>
        <div className="presets">
          <button className="btn primary" type="submit" disabled={busy}>
            Add the account
          </button>
        </div>
      </Form>
    </main>
  )
}
