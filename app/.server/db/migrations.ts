/**
 * Schema migrations, keyed `<id>_<name>` and run once each, in id order, when
 * the database layer is built (so `npm run dev` on a fresh checkout just works).
 *
 * Shape of the store:
 * - `lists` + `list_units`: an army list. Units are JSON documents (the shape
 *   the engine consumes) with the as-imported copy kept alongside for "reset".
 * - `rules`: the translations library — official rule → engine effect (`fx`),
 *   with a review status. Seeded from the POC, edited in the app.
 * - `targets`: the benchmark defenders.
 * - `settings`: small key/value store (active list…).
 * - `mfm_*`: points from the Munitorum Field Manual, per faction and version.
 * - `wh_*`: versioned snapshots of the Wahapedia data export. Every row carries
 *   its `snapshot_id`; columns are the export's own, stored as text.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { q, WH_TABLES } from "../wahapedia/tables"

const createWahapediaTables = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  for (const t of WH_TABLES) {
    const cols = t.columns.map((c) => `${q(c)} TEXT NOT NULL DEFAULT ''`).join(", ")
    yield* sql.unsafe(
      `CREATE TABLE ${t.table} (snapshot_id INTEGER NOT NULL, row_num INTEGER NOT NULL, ${cols}, PRIMARY KEY (snapshot_id, row_num))`
    )
    yield* sql.unsafe(`CREATE INDEX ${t.table}_key ON ${t.table} (snapshot_id, ${t.key.map(q).join(", ")})`)
  }
  // lookups the mapper makes by name
  yield* sql.unsafe(`CREATE INDEX wh_datasheets_name ON wh_datasheets (snapshot_id, name)`)
  yield* sql.unsafe(`CREATE INDEX wh_enhancements_name ON wh_enhancements (snapshot_id, name)`)
})

export const migrations = {
  "0001_core": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        builtin INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        meta TEXT NOT NULL,
        groups TEXT NOT NULL,
        army_rules TEXT NOT NULL,
        rules TEXT NOT NULL,
        opts TEXT NOT NULL,
        roster_xml TEXT,
        text_export TEXT,
        game_system TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    yield* sql`
      CREATE TABLE list_units (
        list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        datasheet_id TEXT,
        data TEXT NOT NULL,
        base TEXT NOT NULL,
        PRIMARY KEY (list_id, unit_id)
      )
    `
    yield* sql`
      CREATE TABLE rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        faction TEXT,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        seed TEXT,
        wh_kind TEXT,
        wh_text TEXT,
        wh_hash TEXT,
        wh_snapshot_id INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )
    `
    yield* sql`CREATE TABLE targets (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL)`
    yield* sql`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  }),
  "0002_wahapedia": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE wh_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last_update TEXT NOT NULL,
        loaded_at TEXT NOT NULL,
        source TEXT NOT NULL,
        files TEXT NOT NULL,
        report TEXT
      )
    `
    yield* createWahapediaTables
  }),
  // an uploaded roster waiting to be reviewed and saved as a list
  "0003_pending_imports": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE pending_imports (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        roster_xml TEXT NOT NULL,
        text_export TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `
  }),
  // points from the Munitorum Field Manual: one row per faction per distinct set of prices
  "0004_field_manual": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE mfm_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL,
        faction TEXT NOT NULL,
        version TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        hash TEXT NOT NULL,
        data TEXT NOT NULL,
        changes TEXT NOT NULL,
        changes_from TEXT NOT NULL
      )
    `
    yield* sql`CREATE INDEX mfm_snapshots_slug ON mfm_snapshots (slug, id)`
    yield* sql`CREATE TABLE mfm_checks (slug TEXT PRIMARY KEY, checked_at TEXT NOT NULL, ok INTEGER NOT NULL, message TEXT NOT NULL)`
  }),

  /**
   * Accounts. The four tables are better-auth's, exactly as its migration
   * helper generates them for this configuration (`app/.server/auth.ts`),
   * with `role` added: "owner" or "friend". There is no sign-up; accounts are
   * created by the owner. Lists and pending imports get an owner; a list
   * without one (the built-in list, and lists from before accounts) belongs to
   * the site's owner.
   */
  "0005_accounts": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique,
        "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "role" text not null)
    `
    yield* sql`
      CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique,
        "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text,
        "userId" text not null references "user" ("id") on delete cascade)
    `
    yield* sql`
      CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null,
        "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text,
        "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text,
        "createdAt" date not null, "updatedAt" date not null)
    `
    yield* sql`
      CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null,
        "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null)
    `
    yield* sql`CREATE INDEX "session_userId_idx" ON "session" ("userId")`
    yield* sql`CREATE INDEX "account_userId_idx" ON "account" ("userId")`
    yield* sql`CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier")`

    yield* sql`ALTER TABLE lists ADD COLUMN owner_id TEXT`
    yield* sql`CREATE INDEX lists_owner ON lists (owner_id)`
    yield* sql`ALTER TABLE pending_imports ADD COLUMN owner_id TEXT`
  }),

  /**
   * better-auth's OAuth server for MCP clients (the JWT plugin's signing keys, and the OAuth provider's clients,
   * resources, tokens and consents), as better-auth's own migration generator wrote them; and a record of every
   * request, so the site's owner can see who uses it, and spot abuse.
   */
  "0006_oauth": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      create table "jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null,
        "createdAt" date not null, "expiresAt" date, "alg" text, "crv" text)
    `
    yield* sql`
      create table "oauthClient" ("id" text not null primary key, "clientId" text not null unique, "clientSecret" text,
        "clientDiscoveryId" text, "disabled" integer, "skipConsent" integer, "enableEndSession" integer, "subjectType" text,
        "scopes" text, "clientCredentialsScopes" text, "userId" text references "user" ("id") on delete cascade,
        "createdAt" date, "updatedAt" date, "name" text, "uri" text, "icon" text, "contacts" text, "tos" text, "policy" text,
        "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" text not null,
        "postLogoutRedirectUris" text, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" integer,
        "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" text,
        "responseTypes" text, "requirePKCE" integer, "dpopBoundAccessTokens" integer, "referenceId" text, "metadata" text)
    `
    yield* sql`
      create table "oauthResource" ("id" text not null primary key, "identifier" text not null unique, "name" text not null,
        "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text,
        "allowedScopes" text, "customClaims" text, "dpopBoundAccessTokensRequired" integer, "disabled" integer,
        "createdAt" date, "updatedAt" date, "policyVersion" integer, "metadata" text)
    `
    yield* sql`
      create table "oauthClientResource" ("id" text not null primary key,
        "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
        "resourceId" text not null references "oauthResource" ("identifier") on delete cascade, "metadata" text,
        "createdAt" date)
    `
    yield* sql`
      create table "oauthRefreshToken" ("id" text not null primary key, "token" text not null unique,
        "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
        "sessionId" text references "session" ("id") on delete set null,
        "userId" text not null references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text,
        "resources" text, "requestedUserInfoClaims" text, "expiresAt" date not null, "createdAt" date not null,
        "revoked" date, "rotatedAt" date, "rotationReplayResponse" text, "rotationReplayExpiresAt" date, "authTime" date,
        "confirmation" text, "scopes" text not null)
    `
    yield* sql`
      create table "oauthAccessToken" ("id" text not null primary key, "token" text not null unique,
        "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
        "sessionId" text references "session" ("id") on delete set null,
        "userId" text references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text,
        "resources" text, "requestedUserInfoClaims" text,
        "refreshId" text references "oauthRefreshToken" ("id") on delete cascade, "expiresAt" date not null,
        "createdAt" date not null, "revoked" date, "confirmation" text, "scopes" text not null)
    `
    yield* sql`
      create table "oauthConsent" ("id" text not null primary key,
        "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
        "userId" text references "user" ("id") on delete cascade, "referenceId" text, "resources" text,
        "requestedUserInfoClaims" text, "scopes" text not null, "createdAt" date not null, "updatedAt" date not null)
    `
    yield* sql`
      create table "oauthClientAssertion" ("id" text not null primary key, "expiresAt" date not null)
    `
    yield* sql`create index "oauthClient_userId_idx" on "oauthClient" ("userId")`
    yield* sql`create index "oauthClientResource_clientId_idx" on "oauthClientResource" ("clientId")`
    yield* sql`create index "oauthClientResource_resourceId_idx" on "oauthClientResource" ("resourceId")`
    yield* sql`create index "oauthRefreshToken_clientId_idx" on "oauthRefreshToken" ("clientId")`
    yield* sql`create index "oauthRefreshToken_sessionId_idx" on "oauthRefreshToken" ("sessionId")`
    yield* sql`create index "oauthRefreshToken_userId_idx" on "oauthRefreshToken" ("userId")`
    yield* sql`create index "oauthRefreshToken_authorizationCodeId_idx" on "oauthRefreshToken" ("authorizationCodeId")`
    yield* sql`create index "oauthAccessToken_clientId_idx" on "oauthAccessToken" ("clientId")`
    yield* sql`create index "oauthAccessToken_sessionId_idx" on "oauthAccessToken" ("sessionId")`
    yield* sql`create index "oauthAccessToken_userId_idx" on "oauthAccessToken" ("userId")`
    yield* sql`create index "oauthAccessToken_authorizationCodeId_idx" on "oauthAccessToken" ("authorizationCodeId")`
    yield* sql`create index "oauthAccessToken_refreshId_idx" on "oauthAccessToken" ("refreshId")`
    yield* sql`create index "oauthConsent_clientId_idx" on "oauthConsent" ("clientId")`
    yield* sql`create index "oauthConsent_userId_idx" on "oauthConsent" ("userId")`
    yield* sql`create unique index "oauthClientResource_clientId_resourceId_uidx" on "oauthClientResource" ("clientId", "resourceId")`

    // every request the app answers: pages, page data, form posts, OAuth and MCP (see .server/usage.ts)
    yield* sql`
      CREATE TABLE usage (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        user_id TEXT,
        visitor TEXT NOT NULL,
        country TEXT,
        client_id TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        tool TEXT,
        status INTEGER NOT NULL,
        bytes INTEGER
      )
    `
    yield* sql`CREATE INDEX usage_at ON usage (at)`
    yield* sql`CREATE INDEX usage_user ON usage (user_id, at)`
    yield* sql`CREATE INDEX usage_visitor ON usage (visitor, at)`
  })
}
