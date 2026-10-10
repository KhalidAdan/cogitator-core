# Cogitator Core

How many enemy points does each unit in an army list remove per point it costs? Cogitator Core scores every unit of a Warhammer 40,000 (11th edition) list against a set of benchmark targets, with the list's own rules applied, and checks the list against a versioned copy of the Wahapedia data export.

```
return % = (wounds dealt ÷ your points) × (their points ÷ their total wounds) × 100
```

React Router 7 (framework mode), Effect 4, SQLite, on Cloudflare Workers. Lives at https://khld.dev/cogitator-core. Needs Node 24.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173/cogitator-core/. The dev server runs the app inside `workerd`, Cloudflare's Workers runtime, through Cloudflare's Vite plugin: the Durable Object that holds the database included. Its data lives in `.wrangler/state/`, separate from the live site. A fresh local database seeds itself, and about fifteen seconds after start it reads the Field Manual and the Wahapedia export (wahapedia.ru doesn't resolve through some VPNs).

Anyone can use the site; signing in is only for you and the friends you add. In a fresh database, open http://localhost:5173/cogitator-core/setup and enter the `SETUP_CODE` from `.dev.vars` to make the owner's account. `.dev.vars` (git-ignored) holds the local secrets; copy `.dev.vars.example` to start one.

Points come from Games Workshop's Munitorum Field Manual; datasheets, profiles and rules text come from the Wahapedia export. The app checks both every six hours by itself; "Check for updates" on the Database page checks now (at most once every ten minutes).

To run the production build locally, in the same runtime:

```bash
npm run preview
```

## Use it from an AI assistant

The live site has an MCP endpoint: **https://khld.dev/cogitator-core/mcp**. Add it as a custom connector in Claude or ChatGPT, or as a remote MCP server in a coding agent. The assistant opens the site's sign-in page (one of the accounts made on the Accounts page) and asks you to allow it; then it can list, read and score army lists, explain a matchup weapon by weapon, and look up how a rule is modelled. It reads and scores, and changes nothing. The site's owner also gets `save_rule`, which saves a rule's translation to the rules library as a draft, and the `translate_rules` prompt, which sets the assistant to work through a list's untranslated rules. The owner also gets a usage report, "check for updates", and connected apps. See decisions D-46, D-47 and D-50.

## Deploy it

```bash
npm run deploy
```

Builds, then `wrangler deploy`: the Worker, its Durable Object and the `khld.dev/cogitator-core` routes, as `wrangler.jsonc` describes them. Needs `wrangler login` once, and the secrets `BETTER_AUTH_SECRET` and `SETUP_CODE` (`wrangler secret put`). See [docs/cloudflare.md](docs/cloudflare.md).

## Check it

```bash
npm test
```

```bash
npm run typecheck
```

## Where things are

- `app/domain` — the damage engine and view model; pure TypeScript, shared by server and browser
- `app/.server` — database, repositories, roster importer, Wahapedia pipeline; all Effect
- `workers/app.ts` — the Cloudflare Worker and the Durable Object that runs the app
- `app/routes` — the pages
- `docs/` — **start with [docs/README.md](docs/README.md)**: what was built, what was verified, and the decisions behind it
- `kill-ledger/` — the proof of concept this was ported from, kept as the tests' reference

Datasheets and rules text are powered by [Wahapedia](https://wahapedia.ru/wh40k11ed/the-rules/data-export). Points are read from the [Munitorum Field Manual](https://mfm.warhammer-community.com).
