# Cogitator Core on Cloudflare

The app runs on Cloudflare Workers at **https://khld.dev/cogitator-core**, on the Workers Paid plan ($5 a month). It's the first site on khld.dev; the domain's other paths are left for other sites.

## How it runs

```
browser ── khld.dev/cogitator-core/assets/…  ──▶ Cloudflare's static file server (the client build; never runs the Worker)
        └─ khld.dev/cogitator-core/…        ──▶ Worker (workers/app.ts) ──▶ Durable Object "main" (CogitatorCore)
                                                                              ├─ SQLite: lists, rules, targets, Field Manual, Wahapedia
                                                                              ├─ React Router renders the page
                                                                              └─ alarm every 6 h: check for updates
```

- **One Durable Object does everything.** It holds the app's SQLite database and renders every page, so it works the way the app did on a server: queries are in-process and synchronous, and the read caches (`app/.server/memo.ts`) are shared by every visitor. The Worker in front only forwards requests to it.
- **The database** is the object's own SQLite storage, through `@effect/sql-sqlite-do`, with the same migrations as before (`app/.server/db/DurableDb.ts`). Repositories and queries didn't change, because they only depend on Effect's `SqlClient`. The tests still use `node:sqlite` in memory (`app/.server/db/Db.ts`).
- **Updates** run from the object's alarm: about fifteen seconds after a fresh start (which is what fills a new database), then every six hours, skipping anything checked in the last twenty. The Wahapedia export is read straight from wahapedia.ru, one file at a time, into the database; there is no disk on Cloudflare and none is needed. "Check for updates" on the Database page does the same at most once every ten minutes, because the site is public.
- **Static files** live under `/cogitator-core/assets/` (Vite's `build.assetsDir`) and `/cogitator-core/favicon.svg`, so Cloudflare serves them directly. React Router's `basename` is `/cogitator-core`.

What had to change for Workers, and nothing else did: the database layer above; the Wahapedia download (read from the site instead of a folder: `wahapedia/remote.ts`); the Field Manual page archive (optional, kept only by the local scripts); the scheduled update (an alarm instead of a background fiber); a web-streams server entry (`app/entry.server.tsx`); and batching inserts and `IN (…)` lists to Durable Object SQLite's limit of 100 bound parameters per statement. Node-only code (downloading to disk for the tests) lives in `app/.server/node/`, which the app never imports.

## Develop

```bash
npm run dev       # http://localhost:5173/cogitator-core/, in workerd with a local Durable Object
npm run preview   # the production build, locally, in the same runtime
npm test          # Node, in-memory SQLite
npm run typecheck # regenerates worker-configuration.d.ts from wrangler.jsonc first
```

Local data lives in `.wrangler/state/` and is separate from the live site's. Delete that folder to start from a fresh database.

## Deploy

```bash
wrangler login    # once
npm run deploy    # build, then wrangler deploy
```

Two secrets, set once with `wrangler secret put <NAME>` (locally they're in `.dev.vars`, which is git-ignored):

| Secret | What it's for |
|---|---|
| `BETTER_AUTH_SECRET` | Signs sessions. Any long random value; changing it signs everyone out. |
| `SETUP_CODE` | What `/cogitator-core/setup` asks for before it creates the owner's account. Only used while there is no owner. |

`BETTER_AUTH_URL` (`https://khld.dev`) is an ordinary variable in `wrangler.jsonc`. After the first deploy with accounts, open `/cogitator-core/setup`, enter the setup code, and make your account; then add friends on the Accounts page.

`wrangler.jsonc` describes everything that gets created: the Worker, the Durable Object class (`CogitatorCore`, SQLite storage), and the routes `khld.dev/cogitator-core` and `khld.dev/cogitator-core/*`, plus three for the OAuth discovery documents MCP clients look for at the domain's root (`khld.dev/.well-known/oauth-authorization-server/*`, `…/oauth-protected-resource/*` and `…/openid-configuration/*`; decision D-47). There is no `workers.dev` address and no per-version preview links (`workers_dev` and `preview_urls` are off), so the only way in is khld.dev, where the rate-limit rule applies.

For the routes to receive traffic, khld.dev needs a proxied (orange cloud) DNS record. Logs: `npx wrangler tail cogitator-core`.

**First deployed 3 October 2026** (version `e1508785`), from the `cloudflare` branch: the Worker `cogitator-core`, its Durable Object, the routes `khld.dev/cogitator-core` and `khld.dev/cogitator-core/*`, and https://cogitator-core.khalid-adan.workers.dev. The first scheduled update loaded the Wahapedia export (77,689 rows) and the Aeldari Field Manual v1.5 from Cloudflare.

khld.dev's DNS, as of 3 October 2026, after the domain left Vercel:

| Record | Points at | Why |
|---|---|---|
| `AAAA khld.dev` | `100::`, proxied | Cloudflare's "no origin" placeholder. Everything on khld.dev is served by Workers or redirect rules, and the routes need the name proxied |
| `CNAME www` | `khld.dev`, proxied | So the redirect rule below can catch it |
| `TXT khld.dev` | `v=spf1 -all` | khld.dev sends no mail |
| `TXT _dmarc` | `v=DMARC1; p=reject; …` | So mail forged as khld.dev is rejected |

No mail is received at khld.dev. The five `eforward` MX records and their SPF entry, Namecheap's default email forwarding, were removed on 3 October: the forwarding only works with Namecheap's own nameservers, and nothing used it. If mail is wanted later, Cloudflare Email Routing (free) is the way to add it.

Redirect rules on the zone (free plan, Single Redirects):

- `www.khld.dev/<path>` → `https://khld.dev/<path>`, 301.
- `khld.dev/` → `https://khld.dev/cogitator-core/`, 302, until the domain has a homepage. Replace this rule when it does.

To see how Cloudflare handles a URL without sending traffic, use `cf request-tracers traces create --url <url> --method GET` (with `CLOUDFLARE_ACCOUNT_ID` set).

The workers.dev address was switched off on 3 October (version `65c0d552`), once khld.dev was serving the app. Accounts went live with version `6531b7a1`.

## Cost and safeguards

Everything this app does fits inside the plan's monthly allowance (10 million requests, 30 million CPU-ms, 1 million Durable Object requests, 400,000 GB-s of Durable Object time, 5 GB of SQLite). A single Durable Object running every second of a month is about 324,000 GB-s, so its run time can't exceed the allowance. What could grow is request counts, at roughly $0.45 per extra million.

Cloudflare has no hard spending cap. The safeguards:

- **A budget alert** in the dashboard (Billing → Billable Usage → Create budget alert), which emails when spend passes a threshold.
- **A rate-limiting rule** on the khld.dev zone (free plan: per IP and data centre, 10-second window). An address that sends more than 100 requests to `/cogitator-core` in 10 seconds is blocked for 10 seconds; a first page load, with every script and font, is about 40. It runs before the Worker, so blocked requests aren't Worker requests. Set with `cf rulesets account-rulesets phases update http_ratelimit --zone khld.dev`.
- **The update button's ten-minute cooldown**, and "follow a faction" answering from what's stored if the page was read within the hour.

Anyone can read the site, but only signed-in accounts can change anything, and only the owner can start an update (D-39).

## The `cf` CLI

`cf` is Cloudflare's newer CLI, in beta. It's used here for account work (DNS, the rate-limit rule), not for building or deploying. On 2 October 2026 `cf migrate` converted the project cleanly. But `cf build` couldn't build it, with either the stable Vite plugin (1.62.5) or the 2.0 beta: it moves the client build's output into `.cloudflare/output/`, and React Router's server build then can't find the client manifest it reads. Until `cf` supports React Router, keep using Wrangler for `dev` and `deploy`, as Cloudflare's own guidance for unmigrated projects says, and **don't run `cf dev`, `cf build` or `cf deploy` here**: in a project without `cloudflare.config.ts` they rewrite the configuration for a single-page app.
