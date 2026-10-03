/** Sign out: ends the session and clears its cookies. */
import { redirect } from "react-router"
import { signOut } from "~/.server/auth/auth"
import type { Route } from "./+types/sign-out"

export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers()
  for (const c of await signOut(request)) headers.append("Set-Cookie", c)
  return redirect("/lists", { headers })
}

export const loader = () => redirect("/lists")
