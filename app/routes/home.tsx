import { Effect } from "effect"
import { href, redirect } from "react-router"
import { readActiveList } from "~/.server/cookies"
import { Lists } from "~/.server/repos/Lists"
import { run } from "~/.server/runtime"
import type { Route } from "./+types/home"

/** `/` opens the list this browser last had open, or the built-in list. */
export async function loader({ request }: Route.LoaderArgs) {
  const active = await readActiveList(request)
  const listId = await run(Effect.gen(function*() {
    const lists = yield* Lists
    if (active && (yield* lists.exists(active))) return active
    return (yield* lists.all).find((l) => l.builtin)?.id
  }))
  return redirect(listId ? href("/lists/:listId", { listId }) : href("/lists"))
}
