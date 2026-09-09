# Park Queue Owners whose Spotify grant has died

Status: ready-for-agent

Blocked by: 03, 07

A revoked refresh token currently just throws. On a minute-by-minute cron that
is 1,440 failed token requests a day against the shared Spotify app every other
Queue Owner depends on.

Distinguish permanent from transient: Spotify answering `400 invalid_grant`
means the grant is gone, park the Queue Owner as needing re-authorization and
stop scheduling their Subscriptions. A 502 or a timeout is transient — retry
next tick, forever. Today every failure is treated the same.

Record the parking attempt as an `unauthorized` Delivery, and surface a
reconnect prompt in the SPA.

## Comments

- `SpotifyGrantRevokedError` in `packages/core/spotify.ts` is the
  distinction: `requestTokens` (shared by `refreshTokens` and
  `exchangeCode`) throws it only for a `400` whose body is
  `{ error: "invalid_grant" }`. Every other non-2xx - a 502, a 500, a
  timeout that never reaches this check - falls through to the existing
  generic `Error`, which `deliver()` in `sync.ts` already retried forever by
  recording `error` and moving on next tick.
- `Subscriber` in `sync.ts` gained a `park: () => Promise<void>` collaborator
  alongside `hasActiveDevice`/`findTrack`/`queueTrack`. `deliver()`'s catch
  special-cases `SpotifyGrantRevokedError`: it calls `park()` (itself wrapped
  in its own try/catch, on the same reasoning as `report()` - a database
  hiccup parking someone must not cost the `unauthorized` Delivery that
  already happened) and records `unauthorized` instead of `error`.
- "Stop scheduling their Subscriptions" is `store.ts`'s `listSubscribers`
  query, not the scheduler: it now excludes `needs_reauthorization = 1`, so
  the next tick's fan-out for that Watched Account never hands the parked
  Queue Owner back, and no further refresh call is spent on a grant that
  cannot come back. Other Subscribers on the same Watched Account are
  unaffected - only the one Queue Owner is parked.
- `apps/worker/src/tick.ts` and `packages/cli/src/index.ts` both wire `park`
  to the `setNeedsReauthorization` store function that issue 03 already
  added. The standalone CLI has exactly one Queue Owner and no join to
  filter through, so it re-reads its own row in `subscribers()` and returns
  an empty array once parked, rather than keep retrying a dead grant forever
  on its `setInterval`.
- The reconnect prompt itself is not here: `apps/web` is still a placeholder
  (issue 12) and there is no Instance API yet to read `needsReauthorization`
  from (issue 09). What this issue leaves behind for both to build on is the
  data: `needsReauthorization` on `QueueOwner`, and every parking attempt
  recorded as an `unauthorized` Delivery with `errorMessage` set.
