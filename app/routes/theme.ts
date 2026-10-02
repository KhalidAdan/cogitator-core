import { data, redirect } from "react-router"
import { writeTheme } from "~/.server/theme"
import { isTheme } from "~/theme"
import type { Route } from "./+types/theme"

export async function action({ request }: Route.ActionArgs) {
  const theme = (await request.formData()).get("theme")
  if (!isTheme(theme)) throw data("Unknown theme", { status: 400 })
  return data({ theme }, { headers: { "Set-Cookie": await writeTheme(theme) } })
}

export const loader = () => redirect("/")
