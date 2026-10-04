# Architecture

About 8,500 lines of TypeScript, plus the POC's stylesheet. Three layers, each of which only knows about the one below it.

```
app/
  domain/            pure TypeScript, runs on server and in the browser
    schema.ts          the data model as Effect schemas (Unit, Weapon, Rule, Fx, Target, Opts…)
    engine.ts          what reaches an attacker (modifier bar scopes, rules, marks), and a unit's total
    attack.ts          one weapon against one target: resolve the effects, roll, explain
    ledger.ts          view model: matrix, findings, rule-chip states, heat colours
    options.ts         defaults, presets, and the intent reducer for option changes
    keywords.ts        weapon ability strings ↔ the engine's kw object
    fx.ts              the effect vocabulary: each field's test or addition, its words, its help
    text.ts            name normalisation, HTML → text, text hashing

  .server/           never bundled for the browser (React Router enforces this)
    runtime.ts         the ManagedRuntime (installed by the Durable Object), run(), and the scheduled update
    auth/              better-auth (accounts, sessions, sign-in throttling) and the Kysely dialect it runs on
    access.ts          the checks actions make: signed in, the site's owner, this list's owner
    mcp/               the MCP endpoint for AI agents (/mcp): a small Streamable HTTP server, and the six read-only tools
    cookies.ts         a visitor's switches on lists they can't change, and their last-opened list
    memo.ts            in-memory caches for what can't change: a snapshot's datasheets, a stored Field Manual page
    updates.ts         one "check for updates" over both sources, and whether they agree
    db/                migrations; the Durable Object's SQLite (DurableDb.ts) and node:sqlite for tests (Db.ts)
    repos/             Lists, Rules, Targets, Settings, Imports: one Effect service each
    seed/              first-run data: the POC's library, lists and targets, plus rules translated since (library.ts)
    importer/          roster (.ros/.rosz) and text-export parser
    wahapedia/         the data export: tables, csv, remote (read from wahapedia.ru), Snapshots, diff, queries, check, sync
    mfm/               points from the Munitorum Field Manual: flight, parse, store, refresh, factions
    node/              Node only, never imported by the app: downloading test data to disk

  routes/            React Router route modules: loader, action, component
  components/        controls, rule chips and card, the rule editor's effect clauses, shared hooks
  root.tsx           document shell, theme, who's signed in (middleware), request logging, error boundary
  viewer.ts          who is looking and what they may do; shared by server and pages
  entry.server.tsx   server rendering with web streams, for Workers
  routes.ts          the route table

workers/app.ts       the Cloudflare Worker, and the Durable Object that holds the database and runs the app
wrangler.jsonc       what gets deployed: Worker, Durable Object, routes on khld.dev (see cloudflare.md)
scripts/             wahapedia:fetch and mfm:fetch (test data), poc-export
tests/               engine parity, importer parity, database, Wahapedia pipeline, domain, your rosters
kill-ledger/         the POC, untouched; the tests' oracle
data/                downloaded exports and Field Manual pages for the tests (git-ignored)
```

## How a request flows

Take "switch the phase to melee" on the matrix.

1. The Phase control is a `<fetcher.Form>` that posts `intent=set&key=phase&value=melee` to `/lists/:listId`.
2. **In the browser, immediately:** the list layout reads every in-flight fetcher, turns each form into an intent with `intentFromForm`, and applies it to the options it got from the loader with `applyIntent`. The matrix re-renders from those options. No waiting.
3. **On the server:** the layout's `action` parses the same intent and hands `Lists.updateOpts` a function. That runs inside a SQLite transaction: read the list, apply the intent, write the options back. Two quick toggles can't overwrite each other.
4. React Router revalidates the layout's loader; the stored options arrive and replace the optimistic ones. They're equal, because both sides ran the same pure function.

Moving between the matrix, a dossier and the rules matrix, or opening a rule card, doesn't reload anything: the layout's `shouldRevalidate` knows the list only changes through actions.

## The damage engine

`attackUnit(unit, target, opts)` is called once per matrix cell, so the work that doesn't depend on the target is done once per unit and set of options (`prepare` in engine.ts): which rules reach each weapon, the modifier bar's settings for it, the attacker's keywords. Then each weapon goes through the attack sequence in attack.ts:

1. **Resolve.** Everything that changes the attack is an effect clause: each rule's `fx`, the modifier bar (translated into a clause once), the Order the unit is under (a library rule, picked in the bar), and the core abilities that work as modifiers (Heavy, Lance, Twin-linked). Clauses whose *when* fields match are added into one `Profile` by the vocabulary in fx.ts, which says how each field combines: hit and wound modifiers summed and capped at ±1, the strongest re-roll, the best of a granted ability.
2. **Roll.** Attacks, hit, wound, save and damage are small functions of the weapon, the target and the profile. No text.
3. **Explain.** The breakdown's notes are written last, from the profile and what each roll found.

A new effect field is a line in the `Fx` schema, an entry in fx.ts's table (the compiler requires one; it holds the field's test or addition, its words, its editor help and the kind of input the rule editor shows for it), and the arithmetic that reads it. The rule editor (`components/effect-editor.tsx`) builds its clauses from the same table.

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

SQLite: the Durable Object's own storage on Cloudflare, and an in-memory `node:sqlite` database in the tests. Migrations are in `app/.server/db/migrations.ts` and run when the object starts.

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
| `mcp.test.ts` | the MCP endpoint, driven by the official MCP SDK's client: every tool, mistakes, and the transport |
| `fx.test.ts` | the effect vocabulary's words and help, and how clauses from the bar, rules and core abilities combine |
| `domain.test.ts` | option intents, the matrix and findings (including the handoff's headline numbers), keywords, effect descriptions |
| `db.test.ts` | migrations, seed (and upgrading an older database's built-in lists), repositories, typed errors |
| `mfm.test.ts` | the Field Manual reader and parser, version comparison, and pricing lists from it (against the saved pages when present) |
| `wahapedia.test.ts` | the CSV dialect, the change report, points tiers; and against the real export: loading, diffing, datasheet queries, the list check, rule linking |

The Wahapedia integration tests skip themselves when no export has been downloaded.

## Commands

```bash
npm run dev               # develop in workerd, http://localhost:5173/cogitator-core/
npm run preview           # the production build, locally, in workerd
npm run deploy            # build and deploy to Cloudflare (wrangler login first)
npm test                  # all tests
npm run typecheck         # Worker types + route types + tsc
npm run wahapedia:fetch   # download the export into data/wahapedia for the tests
npm run mfm:fetch         # download Field Manual pages into data/mfm for the tests
node scripts/poc-export.mjs   # regenerate the seed from kill-ledger/src
```
