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

Points come from Games Workshop's Munitorum Field Manual; datasheets, profiles and rules text come from the Wahapedia export. The app checks both every six hours by itself; "Check for updates" on the Database page checks now (at most once every ten minutes).

To run the production build locally, in the same runtime:

```bash
npm run preview
```

## Deploy it

```bash
npm run deploy
```

Builds, then `wrangler deploy`: the Worker, its Durable Object and the `khld.dev/cogitator-core` routes, as `wrangler.jsonc` describes them. Needs `wrangler login` once. See [docs/cloudflare.md](docs/cloudflare.md).

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
