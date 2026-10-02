/** Theme preference in a cookie, so the server renders the right palette on first paint. */
import { createCookie } from "react-router"
import { isTheme, type Theme } from "~/theme"

const cookie = createCookie("theme", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 })

export async function readTheme(request: Request): Promise<Theme> {
  const v = await cookie.parse(request.headers.get("Cookie"))
  return isTheme(v) ? v : "auto"
}

export const writeTheme = (theme: Theme) => cookie.serialize(theme)
