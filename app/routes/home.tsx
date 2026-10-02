import { Effect, Option } from "effect"
import { href, redirect } from "react-router"
import { Lists } from "~/.server/repos/Lists"
import { ACTIVE_LIST, Settings } from "~/.server/repos/Settings"
import { run } from "~/.server/runtime"

/** `/` opens the list you last had open. */
export async function loader() {
  const listId = await run(Effect.gen(function*() {
    const lists = yield* Lists
    const active = Option.getOrUndefined(yield* (yield* Settings).get(ACTIVE_LIST))
    if (active && (yield* lists.exists(active))) return active
    return (yield* lists.all)[0]?.id
  }))
  return redirect(listId ? href("/lists/:listId", { listId }) : href("/lists"))
}
