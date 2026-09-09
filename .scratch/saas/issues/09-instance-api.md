# Instance API and Spotify sign-in

Status: ready-for-agent

Blocked by: 03, 05

Sign in with Spotify is the only login. Identity is the id from `GET /me`;
session is an httpOnly cookie. There is no account system, no invite table and
no password reset: a Queue Owner cannot complete OAuth unless the operator has
already added their email to Spotify's dashboard allowlist, so the gate exists
before any of our code runs (ADR-0001).

Endpoints: OAuth start and callback, session, list/create/delete Subscription,
list Deliveries, `POST /api/tick` (issue 06).

## Comments

- `apps/worker/src/auth.ts` is OAuth start and callback. Both always go
  through the Instance's own Spotify app (`SPOTIFY_CLIENT_ID`/`SECRET`/
  `REDIRECT_URI`, new to `env.ts`): a Queue Owner cannot bring their own app
  until they exist as a row to bring it to, so bring-your-own-app stays a
  reconnect choice for later, not a sign-in choice. The callback calls
  `getSpotifyProfile` (new in `packages/core/spotify.ts`, hitting `GET
  /v1/me`) for the id and display name, then `saveQueueOwner` - an upsert, so
  a Queue Owner parked by issue 08 who reconnects is cleared of
  `needsReauthorization` in the same write that proves their grant works
  again.
- The OAuth `state` param (`authorizeUrl`'s new optional second argument)
  guards the callback against CSRF: `apps/worker/src/session.ts` puts a
  fresh one in a ten-minute cookie on the way out and the callback refuses
  unless the value that comes back matches it exactly.
- **The session is a cookie, not a table.** Issue 03's schema stays at five
  tables; `session.ts`'s `sessionCookie`/`readSession` seal and open the
  Queue Owner id with the same WebCrypto `Cipher` that already encrypts
  refresh tokens at rest (`EARSHOT_SECRET_KEY`, ADR-0003). A copied or edited
  cookie decrypts to nothing rather than to someone else's identity, so
  nothing server-side has to remember a session was issued, and signing out
  (`DELETE /api/session`) is just clearing the cookie that named it.
- `apps/worker/src/api.ts` is everything a signed-in Queue Owner does to
  their own rows: `GET`/`DELETE /api/session`, `GET`/`POST /api/subscriptions`,
  `DELETE /api/subscriptions/:lastfmUsername`, `GET /api/deliveries?limit=`.
  Creating a Subscription is `watchAccount` (`INSERT OR IGNORE`) then
  `addSubscription`, so subscribing to an already-watched Watched Account
  costs nothing extra. Deleting one only removes the `subscription` row -
  issue 06 already put the sweep for an unwatched Watched Account inside the
  tick (`forgetUnwatchedAccounts`), which is what lets this endpoint delete
  without also deciding whether anyone else still cares about that Watched
  Account.
- `apps/worker/src/index.ts` is the router: an explicit pathname/method
  chain, matching the one `/api/tick` already used rather than reaching for a
  framework. `Db` and `Cipher` are each built once per request and threaded
  into `withOwner` and the handlers, the same shape `tick.ts` already uses
  for its collaborators. `withOwner` is the one place a cookie is turned into
  a `QueueOwner`, answering 401 for every way that can fail - no cookie, a
  tampered one, or one naming a Queue Owner who no longer exists - so no
  handler below has to tell those apart.
- Tests are `apps/worker/src/auth.test.ts` and `api.test.ts`, both driving
  `worker.fetch` end to end against a real in-memory `node:sqlite` database
  behind a hand-written `D1Binding` (same reasoning as `tick.test.ts`: the
  store's SQL is identical either way, and these tests care whether a
  callback's upsert or a delete actually lands). Spotify's token and profile
  endpoints are mocked; nothing else is.
