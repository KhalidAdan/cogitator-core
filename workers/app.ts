/**
 * The Cloudflare Worker.
 *
 * Static files are served by Cloudflare before this runs. Everything else goes
 * to one Durable Object, `CogitatorCore`, which holds the app's SQLite database
 * and renders the pages. One object for everything is what keeps the app as it
 * was on a server: every query is in-process and synchronous, the read caches
 * (`memo.ts`) are shared by every visitor, and there is one place for the
 * scheduled update to run.
 */
import { DurableObject } from "cloudflare:workers"
import { createRequestHandler } from "react-router"
import { installAuth } from "~/.server/auth/auth"
import { durableDb } from "~/.server/db/DurableDb"
import { appLayer, executeSql, installRuntime, run, scheduledUpdate } from "~/.server/runtime"
import { serveApp } from "~/.server/serve"
import { installUsage, pruneUsage } from "~/.server/usage"

const handler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE)

/** How often the scheduled update runs. It skips whatever was checked in the last twenty hours. */
const UPDATE_EVERY_MS = 6 * 3_600_000
/** The first check after a fresh start, which is what loads Wahapedia into a new database. */
const FIRST_UPDATE_AFTER_MS = 15_000

export class CogitatorCore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // no request gets in until the database is migrated and seeded
    ctx.blockConcurrencyWhile(async () => {
      await installRuntime(appLayer(durableDb(ctx.storage)))
      installAuth({
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
        setupCode: env.SETUP_CODE || null,
        execute: executeSql
      })
      installUsage(env.BETTER_AUTH_SECRET)
      if (this.autoUpdate && (await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + FIRST_UPDATE_AFTER_MS)
    })
  }

  private get autoUpdate() {
    return !/^(off|false|0|no)$/i.test(this.env.COGITATOR_AUTO_UPDATE ?? "on")
  }

  override fetch(request: Request): Promise<Response> {
    // the MCP endpoint, the OAuth server or the pages, each request recorded in the usage log (.server/serve.ts)
    return serveApp(request, handler)
  }

  override async alarm(): Promise<void> {
    await run(scheduledUpdate)
    await run(pruneUsage)
    if (this.autoUpdate) await this.ctx.storage.setAlarm(Date.now() + UPDATE_EVERY_MS)
  }
}

/** The app's path on the domain; React Router's `basename`. */
const BASE = "/cogitator-core"

export default {
  fetch(request, env) {
    // On khld.dev only /cogitator-core reaches this Worker (see the routes in wrangler.jsonc); on workers.dev
    // and in development everything does, so anything outside the app is sent into it.
    const url = new URL(request.url)
    // OAuth discovery lives at the site's root, with the app's paths after it (RFC 8414, RFC 9728); the app answers it
    const discovery = /^\/\.well-known\/(oauth-authorization-server|openid-configuration|oauth-protected-resource)\//.test(url.pathname)
    if (!discovery && url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return Response.redirect(new URL(`${BASE}/`, url).toString(), 302)
    return env.APP.get(env.APP.idFromName("main")).fetch(request)
  }
} satisfies ExportedHandler<Env>
