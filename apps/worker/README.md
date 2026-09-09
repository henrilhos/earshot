# @earshot/worker

The Instance: the JSON API, Spotify sign-in, and the schedule. The SPA served
through Static Assets is issue 12.

It runs `packages/core` on `workerd`, which is why the core carries no `node:`
imports (ADR-0003), and reaches it by relative path rather than by package
name: wrangler bundles this, so there is nothing to resolve at runtime and a
fresh checkout runs the tests with nothing installed.

## The tick

The schedule is data. Each Watched Account carries a `next_poll_at`, and a tick
claims whatever is due, stamps each row's next poll in the same statement, and
polls what it won. Adding a Subscription is an `INSERT` with no live timer to
invalidate, which is what lets Subscriptions appear and vanish from the web UI
while the Instance runs.

Two things ask for a tick, and both call `instanceTick` in `src/tick.ts`:

- The Cron Trigger, once a minute.
- `POST /api/tick`, for a self-hoster whose platform has no cron and for
  forcing a poll while debugging instead of waiting for the next minute.

They can overlap, so the claim is a conditional `UPDATE` that exactly one
invocation wins (`claimDueAccounts` in `packages/core/store.ts`). A tick that
claims nothing had nothing to do.

There is no idle backoff. A Watched Account who stopped scrobbling costs one
request a minute, far under Last.fm's limits.

A poll fans out to one Delivery per Subscription: every Queue Owner watching
that person gets their own queue attempt, recorded with an Outcome (`queued`,
`no_match`, `no_device`, `unauthorized`, `error`) and, for `queued`, whether
the match was exact or a fallback to Spotify's top search result.

## Sign-in and the JSON API

Sign in with Spotify is the only login (ADR-0001): identity is the id `GET
/me` returns, there is no account system, and a Queue Owner cannot complete
OAuth at all unless the operator has already added their email to the Spotify
app's dashboard allowlist. Sign-in always goes through the Instance's own app
— a Queue Owner cannot bring their own until they exist as a row to bring it
to (`spotify_client_id`/`secret` stay null on every sign-in; bringing one's own
app is a later reconnect, not built here).

| Route | Auth | What it does |
| --- | --- | --- |
| `GET /api/auth/login` | — | Redirects to Spotify, with a CSRF `state` in a short-lived cookie |
| `GET /api/auth/callback` | — | Exchanges the code, upserts the Queue Owner, sets the session cookie, redirects to `/` |
| `GET /api/session` | session | The signed-in Queue Owner: id, display name, `needsReauthorization` |
| `DELETE /api/session` | session | Signs out by clearing the cookie |
| `GET /api/subscriptions` | session | This Queue Owner's Subscriptions |
| `POST /api/subscriptions` | session | `{ "lastfmUsername": "..." }` — watches the account if nobody already did, and subscribes |
| `DELETE /api/subscriptions/:lastfmUsername` | session | Unsubscribes. The Watched Account itself is swept by the next tick if nobody else is watching (`forgetUnwatchedAccounts`), not by this call |
| `GET /api/deliveries?limit=50` | session | This Queue Owner's Delivery history, newest first |
| `POST /api/tick` | bearer | See below |

The session is an httpOnly, Secure cookie holding the Queue Owner id, sealed
with the same WebCrypto AES-GCM cipher that already encrypts refresh tokens at
rest (`EARSHOT_SECRET_KEY`, ADR-0003). There is no session table: a copied or
edited cookie decrypts to nothing rather than to someone else's identity, so
nothing server-side has to remember a session was issued or revoke it early —
signing out just stops sending the cookie that named it.

## The tick

The schedule is data. Each Watched Account carries a `next_poll_at`, and a tick
claims whatever is due, stamps each row's next poll in the same statement, and
polls what it won. Adding a Subscription is an `INSERT` with no live timer to
invalidate, which is what lets Subscriptions appear and vanish through the API
while the Instance runs.

Two things ask for a tick, and both call `instanceTick` in `src/tick.ts`:

- The Cron Trigger, once a minute.
- `POST /api/tick`, for a self-hoster whose platform has no cron and for
  forcing a poll while debugging instead of waiting for the next minute.

They can overlap, so the claim is a conditional `UPDATE` that exactly one
invocation wins (`claimDueAccounts` in `packages/core/store.ts`). A tick that
claims nothing had nothing to do.

There is no idle backoff. A Watched Account who stopped scrobbling costs one
request a minute, far under Last.fm's limits.

A poll fans out to one Delivery per Subscription: every Queue Owner watching
that person gets their own queue attempt, recorded with an Outcome (`queued`,
`no_match`, `no_device`, `unauthorized`, `error`) and, for `queued`, whether
the match was exact or a fallback to Spotify's top search result.

## Bindings and secrets

| Name | What it is |
| --- | --- |
| `DB` | The D1 binding |
| `LASTFM_API_KEY` | Reads public recent tracks, so one key serves the whole Instance |
| `EARSHOT_SECRET_KEY` | Decrypts every Queue Owner's refresh token, and seals the session cookie |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | The Instance's own Spotify app: every sign-in, and any Queue Owner who did not bring their own |
| `SPOTIFY_REDIRECT_URI` | Must point at this Instance's `/api/auth/callback` |
| `TICK_TOKEN` | The bearer token `POST /api/tick` requires. Unset closes the endpoint rather than opening it |
| `POLL_INTERVAL_MS` | Optional. Defaults to 60000, matching the Cron Trigger |

```bash
curl -X POST -H "Authorization: Bearer $TICK_TOKEN" https://your-instance/api/tick
# {"polled":["their_lastfm_username"]}
```

The `wrangler` config that binds these — D1, Static Assets, and the
minute-granularity Cron Trigger — is issue 14, along with the deployment docs.
