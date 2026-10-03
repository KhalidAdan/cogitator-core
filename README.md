# Cogitator Core

How many enemy points does each unit in an army list remove per point it costs? Cogitator Core scores every unit of a Warhammer 40,000 (11th edition) list against a set of benchmark targets, with the list's own rules applied, and checks the list against a versioned copy of the Wahapedia data export.

```
return % = (wounds dealt ÷ your points) × (their points ÷ their total wounds) × 100
```

React Router 7 (framework mode), Effect 4, SQLite. Needs Node 24.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The first start creates and seeds `data/cogitator.db`, and loads a Wahapedia export if one has been downloaded.

That's the development server, which is slow to load pages by design (unbundled modules, development React). To use the app at full speed, build it and serve the result on http://localhost:3000:

```bash
npm run preview
```

Points come from Games Workshop's Munitorum Field Manual; datasheets, profiles and rules text come from the Wahapedia export. The app checks both once a day while it's running. To check now, use "Check for updates" on the Database page, or:

```bash
npm run update
```

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
- `app/routes` — the pages
- `docs/` — **start with [docs/README.md](docs/README.md)**: what was built, what was verified, and the decisions behind it
- `kill-ledger/` — the proof of concept this was ported from, kept as the tests' reference

Datasheets and rules text are powered by [Wahapedia](https://wahapedia.ru/wh40k11ed/the-rules/data-export). Points are read from the [Munitorum Field Manual](https://mfm.warhammer-community.com).
# cogitator-core
