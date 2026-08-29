# One schema, two drivers

Status: ready-for-agent

Blocked by: 01

Tables: Queue Owner, Watched Account, Subscription, Delivery, CLI token.

- Queue Owner: Spotify user id, display name, encrypted refresh token, a
  needs-reauthorization flag, and a nullable Spotify client id/secret pair that
  falls back to the Instance's app (ADR-0001, keeps bring-your-own-app cheap
  without building it).
- Watched Account: Last.fm username, last-seen Now Playing key, `next_poll_at`.
- Subscription: Queue Owner + Watched Account.
- Delivery: Subscription, artist, title, outcome, `exact` flag, error message,
  timestamp.

Two drivers behind the injected functions from issue 01: `node:sqlite` for the
CLI, the D1 binding for the Worker. The SQL text must be character-identical
between them; only execution differs.

## Comments

Implemented on `t3code/feat/schema-and-drivers`.

- `packages/core/schema.ts` holds the five tables as idempotent DDL, so opening
  a database is the whole migration step. Times are epoch milliseconds.
- `packages/core/store.ts` is the queries, over a `Db` of two injected
  functions (`packages/core/db.ts`): `all` and `run`, where `run` answers with
  rows changed so issue 06's conditional claim can tell a win from a loss.
  `claimNowPlaying` is already that shape, replacing `trackClaims`.
- Drivers: `packages/core/d1.ts` for the Worker, `packages/cli/src/sqlite.ts`
  for the CLI. Both are handed the SQL the store wrote, unaltered, and
  `packages/cli/src/drivers.test.ts` runs every statement through both and
  compares.
- Natural keys throughout: a Queue Owner is their Spotify user id, a Watched
  Account is their Last.fm username, a Subscription is the pair. A Delivery
  cascades from its Subscription.
- The CLI still reads `state.json` and `tokens.json`. Moving it onto the store
  is issue 04.
