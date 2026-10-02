/** Resource route: a list as a JSON file, for backup or for moving it to another machine. */
import { Effect } from "effect"
import { Lists } from "~/.server/repos/Lists"
import { run } from "~/.server/runtime"
import { slug } from "~/domain/text"
import type { Route } from "./+types/list.export"

export async function loader({ params }: Route.LoaderArgs) {
  const list = await run(Effect.flatMap(Lists, (l) => l.get(params.listId)))
  return new Response(JSON.stringify({ format: "cogitator-core/list@1", ...list }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug(list.meta.name)}.json"`
    }
  })
}
