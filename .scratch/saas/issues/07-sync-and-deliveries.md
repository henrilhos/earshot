# Fan one poll out to many Deliveries

Status: ready-for-agent

Blocked by: 03, 06

One poll per Watched Account, one Delivery per Subscription. Two Queue Owners
watching the same person means one Last.fm request and two queue attempts.

Record every attempt with an Outcome — `queued`, `no_match`, `no_device`,
`unauthorized`, `error` — plus an `exact` flag. There is no `duplicate`
outcome: when Now Playing has not changed, no Delivery row is created at all.

`exact` matters because `findTrack` falls back to Spotify's top search result
when nothing matches exactly (`src/spotify.ts:158`). Without the flag a lucky
guess and a confident match are indistinguishable in the history, and the
README already concedes the fallback is "occasionally embarrassing".

## Comments

Implemented on `t3code/sync-and-deliveries`.

- `packages/core/sync.ts` now fans out: `tick()` still does the Last.fm poll
  and the claim on the Watched Account's Now Playing key exactly as before —
  that claim is the whole answer to "no `duplicate` outcome," since a poll
  that changes nothing never reaches the part that creates Deliveries. Once
  claimed, it asks `deps.subscribers()` for every Queue Owner watching this
  Watched Account and runs `deliver()` for each concurrently, the same
  per-collaborator failure isolation `runTick` already uses for accounts. One
  Last.fm request, N queue attempts.
- `deliver()` is one Subscriber's attempt: no active device, no match, queued
  (carrying `findTrack`'s `exact` flag), or an error, each turned into a
  `DeliveryAttempt` and hand it to `deps.recordDelivery`. That call is wrapped
  in its own try/catch (`report()`) so a database hiccup recording history
  costs nothing to the Spotify side effect that already happened, or to the
  next Subscriber's turn.
- `findTrack` in `packages/core/spotify.ts` returns `{ track, exact } | null`
  now instead of a bare `SpotifyTrack | null`. It already computed the
  distinction internally and threw it away; the fallback branch just keeps
  what it had.
- `SpotifyApp` split into `SpotifyCredentials` (client id/secret) plus the
  redirect URI. Refreshing a token and calling the API never used the
  redirect URI — only `authorizeUrl`/`exchangeCode` do — and a Queue Owner's
  row never stores one (`store.ts`'s `spotifyApp` is credentials only). This
  is what lets `apps/worker/src/tick.ts` build a `SpotifyApi` straight from
  either a Queue Owner's own row or the Instance's app, with no redirect URI
  to fabricate for the one that does not need it.
- `apps/worker/src/tick.ts` is the wiring: `listSubscribers` gets every Queue
  Owner behind a Watched Account, and each becomes a `Subscriber` with its own
  `SpotifyApi` — their own client id/secret if they brought one (ADR-0001),
  otherwise `env.SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`. Refresh tokens are
  decrypted at that edge through a `Cipher` built from `env.EARSHOT_SECRET_KEY`
  (ADR-0003's WebCrypto cipher, wired into the worker for the first time
  here), and a rotated token is re-encrypted through `saveRefreshToken` the
  same way `packages/cli/src/owner.ts` already does for the standalone CLI.
  `instanceTick` now splits into itself (D1-specific) and `runInstanceTick`
  (takes a `Db` directly), so `tick.test.ts` exercises the real fan-out — real
  schema, real store, a `node:sqlite` in-memory database — mocking only
  `fetch`, and checks that each Subscriber's Spotify calls carry the right
  app's Basic auth and that one Subscriber's failure does not touch the
  other's Delivery.
- `packages/cli/src/index.ts` updated to the new `SyncDeps` shape: standalone
  always has exactly one Queue Owner (`owner.ts`'s `LOCAL_QUEUE_OWNER`), so its
  `subscribers()` is a one-element array, and it now calls the store's
  `recordDelivery` too — the CLI gets Delivery history for free from the same
  schema.
- `unauthorized` is in the `Outcome` enum (schema, issue 03) and the `deliver`
  switch does not produce it: that is issue 08's job, distinguishing a dead
  grant from a transient failure. Every other Spotify-side failure here is
  recorded as a plain `error`.
