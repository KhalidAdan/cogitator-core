# Architecture

About 8,500 lines of TypeScript, plus the POC's stylesheet. Three layers, each of which only knows about the one below it.

```
app/
  domain/            pure TypeScript, runs on server and in the browser
    schema.ts          the data model as Effect schemas (Unit, Weapon, Rule, Fx, Target, Opts…)
    engine.ts          the damage maths (handoff section 5)
    ledger.ts          view model: matrix, findings, rule-chip states, heat colours
    options.ts         defaults, presets, and the intent reducer for option changes
    keywords.ts        weapon ability strings ↔ the engine's kw object
    fx.ts              rule effects in words
    text.ts            name normalisation, HTML → text, text hashing

  .server/           never bundled for the browser (React Router enforces this)
    runtime.ts         the ManagedRuntime, and run(): Effect → loader/action result
    memo.ts            in-memory caches for what can't change: a snapshot's datasheets, a stored Field Manual page
    updates.ts         one "check for updates" over both sources, and whether they agree
    db/                SqlClient layer on node:sqlite, migrations
    repos/             Lists, Rules, Targets, Settings, Imports: one Effect service each
    seed/              first-run data: the POC's library, lists and targets, plus rules translated since (library.ts)
    importer/          roster (.ros/.rosz) and text-export parser
    wahapedia/         the data export: tables, csv, fetch, Snapshots, diff, queries, check, sync
    mfm/               points from the Munitorum Field Manual: flight, parse, store, refresh, factions

  routes/            React Router route modules: loader, action, component
  components/        controls, rule chips and card, shared hooks
  root.tsx           document shell, theme, request-logging middleware, error boundary
  routes.ts          the route table

scripts/             wahapedia:fetch, wahapedia:load, db:migrate, db:reset, poc-export
tests/               engine parity, importer parity, database, Wahapedia pipeline, domain
kill-ledger/         the POC, untouched; the tests' oracle
data/                cogitator.db and downloaded exports (git-ignored)
```

## How a request flows

Take "switch the phase to melee" on the matrix.

1. The Phase control is a `<fetcher.Form>` that posts `intent=set&key=phase&value=melee` to `/lists/:listId`.
2. **In the browser, immediately:** the list layout reads every in-flight fetcher, turns each form into an intent with `intentFromForm`, and applies it to the options it got from the loader with `applyIntent`. The matrix re-renders from those options. No waiting.
3. **On the server:** the layout's `action` parses the same intent and hands `Lists.updateOpts` a function. That runs inside a SQLite transaction: read the list, apply the intent, write the options back. Two quick toggles can't overwrite each other.
4. React Router revalidates the layout's loader; the stored options arrive and replace the optimistic ones. They're equal, because both sides ran the same pure function.

Moving between the matrix, a dossier and the rules matrix, or opening a rule card, doesn't reload anything: the layout's `shouldRevalidate` knows the list only changes through actions.

## Effect

One `ManagedRuntime` is built from one layer:

```
FirstSnapshot, UpdateWatch ─────▶ SeedLive ─▶ Lists, Rules, Targets, Settings, Imports, Snapshots ─▶ DbLive
 (load the export if none is      (first-run     (repositories and the snapshot service)          (SqlClient + migrations)
  loaded; check both sources       data)
  daily, in the background)
```

Building the layer runs migrations, seeds an empty database and loads a downloaded export if the database has no snapshot. That's why `npm run dev` on a fresh checkout needs no setup.

Loaders and actions describe what they need as an Effect and pass it to `run`:

```ts
export async function loader({ params }: Route.LoaderArgs) {
  return run(Effect.gen(function*() {
    const list = yield* (yield* Lists).get(params.listId)
    return { list, book: yield* (yield* Rules).book }
  }))
}
```

`run` executes it on the runtime. A failure whose tag is a known domain error (`ListNotFound`, `RosterParseError`, `InvalidInput`…) is thrown as a React Router `data()` response with the right status, so the nearest error boundary renders it. Anything else is a bug and surfaces as one. Repositories convert SQL and schema failures to defects with `Effect.orDie`, so their signatures only mention errors a caller can do something about.

Other places Effect earns its keep:

- **Schema** validates everything that crosses a boundary: JSON columns coming out of SQLite, the seed file, the roster-derived units, a target or unit edited through a form, and the rule editor's effect JSON (decoded strictly, so a misspelt field is an error with a path: `Expected no excess property at [0]["wond"]`).
- **HttpClient** downloads the export with retries on transient failures; **FileSystem** writes it to a scratch folder and renames it into place.
- **Config** locates the database (`COGITATOR_DB`) and the export folder (`COGITATOR_WAHAPEDIA_DIR`).
- **Layers in tests**: the same repositories run against `:memory:` SQLite.

## React Router features in use

| Feature | Where |
|---|---|
| Framework mode, SSR, `routes.ts` | everything |
| Generated route types (`./+types/…`) | every route module |
| Nested layout with shared data via `<Outlet context>` | `routes/list.tsx` and its five children |
| Loaders and actions | every route; resource route for the JSON download |
| Fetchers and optimistic UI | option controls, theme, target editor, database fetch, rule sync |
| `shouldRevalidate` | the list layout and the root |
| Middleware (`v8_middleware`) | request logging in `root.tsx` |
| Search params as state | rule card, selected matchup, edit mode, searches |
| `prefetch="intent"` | tabs and matrix links |
| Pending UI (`useNavigation`, fetcher state) | buttons, the busy dot in the top bar |
| Cookies | theme, so the server renders the right palette |
| `meta`, `links`, `ErrorBoundary`, `ScrollRestoration`, `preventScrollReset` | throughout |
| `.server` module boundary | all server code |
| Multipart form upload | roster import |
| Route `handle` | the Database check tab hides the option controls |

Not used: `clientLoader`/`clientAction` (nothing needs browser-only data), prerendering (every page depends on the database), streaming with `Await` (loaders answer in a few milliseconds).

## Database

SQLite, one file, `data/cogitator.db`. Migrations are in `app/.server/db/migrations.ts` and run on start.

| Table | Holds |
|---|---|
| `lists` | one row per list: name, metadata, attached-unit groups, army rules, rules read from the roster, **options**, and the original roster XML and text export |
| `list_units` | one row per unit: the current document and the as-imported one (`base`), plus `datasheet_id` once matched |
| `rules` | the rules library: the rule document, review status, faction, notes, the seeded original, and the linked official text with its hash |
| `targets` | the benchmark defenders |
| `settings` | key/value: last list opened, seed version |
| `pending_imports` | uploaded rosters awaiting review |
| `mfm_snapshots`, `mfm_checks` | Field Manual points per faction and version, as a JSON document with what changed; and when each faction page was last looked at |
| `wh_snapshots` | one row per loaded export: its timestamp, file hashes, and the change report against the previous one |
| `wh_*` (18 tables) | the export's rows, each tagged with `snapshot_id`; columns are the export's own, as text |

Units, rules and options are JSON documents in text columns, decoded through the schemas on the way out. I chose that over fully relational tables because the engine consumes documents, and because it kept the port verifiable against the POC. The Wahapedia tables, which do get queried relationally, are proper columns.

The `wh_*` tables, the loader and the change report are all generated from one registry, `app/.server/wahapedia/tables.ts`. If the export's format changes, that file is the only one to edit.

## Tests

| File | What it holds the code to |
|---|---|
| `engine-parity.test.ts` | Cogitator calibration rows; the 88.0% anchor; 72,618 cells against the POC engine |
| `importer-parity.test.ts` | the POC importer's output for both fixture rosters, and the 684 / 532 / 570 cell regression |
| `library-rules.test.ts` | each rule added since the POC does what its wording says, and only then |
| `rosters.test.ts` | your real rosters (`tests/fixtures/rosters`): read, fully translated, scored; and against the export, which weapons aren't on their datasheets |
| `domain.test.ts` | option intents, the matrix and findings (including the handoff's headline numbers), keywords, effect descriptions |
| `db.test.ts` | migrations, seed (and upgrading an older database's built-in lists), repositories, typed errors |
| `mfm.test.ts` | the Field Manual reader and parser, version comparison, and pricing lists from it (against the saved pages when present) |
| `wahapedia.test.ts` | the CSV dialect, the change report, points tiers; and against the real export: loading, diffing, datasheet queries, the list check, rule linking |

The Wahapedia integration tests skip themselves when no export has been downloaded.

## Commands

```bash
npm run dev               # develop, http://localhost:5173
npm test                  # all tests
npm run typecheck         # route types + tsc
npm run build && npm start   # production build and server
npm run wahapedia:fetch   # download the export if it changed, load it, re-link the rules
npm run wahapedia:load    # load the newest downloaded export (or a folder you name)
npm run update            # check for updates: Field Manual points, then the Wahapedia export
npm run mfm:fetch         # only the Field Manual (your factions, or name some, or --all)
npm run db:reset          # delete the database; the next start rebuilds it
node scripts/poc-export.mjs   # regenerate the seed from kill-ledger/src
```
