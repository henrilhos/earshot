# Database-driven scheduling with a claimed tick

Status: ready-for-agent

Blocked by: 03

The schedule is data: each Watched Account carries `next_poll_at`, and a tick
selects whatever is due, polls it, and stamps the next time. Adding a
Subscription is an INSERT, with no live timer to invalidate — which matters
because Subscriptions now appear and vanish from the web UI while the thing
runs.

Both a Worker `scheduled` handler and an authenticated `POST /api/tick` call
the same function. The endpoint exists for self-hosters without Cloudflare cron
and for forcing a poll while debugging instead of waiting a minute.

**The claim must be a conditional UPDATE on `next_poll_at` that exactly one
invocation can win.** Cron and the endpoint can overlap, and two ticks that
both read the same due row will queue the same track twice. `claim()` in
`src/index.ts` already has this instinct — record before acting — and it moves
into SQL here.

No idle backoff. A Watched Account who stopped scrobbling costs one request a
minute, far under Last.fm's limits.

## Comments

Implemented on `t3code/implement-scheduler`.

- `claimDueAccounts` in `packages/core/store.ts` is the claim, and the whole of
  the schedule's concurrency control:
  `UPDATE watched_account SET next_poll_at = ? WHERE next_poll_at <= ? RETURNING *`.
  Selecting what is due and stamping its next poll are one statement, so two
  overlapping ticks cannot both act on one row — SQLite serializes the writes,
  and by the time the loser's `WHERE` runs it no longer matches. `RETURNING`
  hands back the rows this invocation won, still carrying the last-seen key the
  poll needs. Both drivers already speak it, and `drivers.test.ts` runs it
  through each and compares the SQL character for character.
- The stamp lands *before* the poll, which is `claim()`'s instinct — record
  before acting — moved into SQL. An account whose poll throws waits its
  interval like everything else instead of being retried at every tick until it
  stops throwing.
- `packages/core/scheduler.ts` is the shared function: forget the Watched
  Accounts nobody subscribes to, claim what is due, poll the winners together
  with each failure kept to its own account, and answer with who was claimed.
  It takes plain functions rather than a `Db`, matching `SyncDeps`, so it tests
  without a database and the store owns the SQL alone.
- The sweep for unwatched accounts runs inside the tick rather than at the
  unsubscribe. Removing a Subscription is the last thing holding a Watched
  Account on the schedule, and doing it here means the schedule converges
  however the Subscription went away — including the ones issue 09's web UI
  will delete.
- `apps/worker/src/index.ts` is the Worker: a `scheduled` handler for the Cron
  Trigger and `POST /api/tick`, both calling `instanceTick` in `tick.ts`. The
  endpoint takes a bearer `TICK_TOKEN` rather than a session, because the two
  callers it exists for — the operator's own cron, and the operator debugging —
  are not signed in. An Instance that never set the token refuses every call
  instead of accepting every one, and the comparison is over SHA-256 digests so
  its timing says nothing about how much of the token was right.
- The Worker reaches the core by relative path, not by package name. It gets
  bundled, so there is nothing to resolve at runtime, and `npm test` keeps
  working in a checkout where nothing has been installed. It describes the D1
  binding and the cron controller structurally, so `apps/worker` needs no
  Cloudflare types to typecheck beside the CLI.

**What a poll does is issue 07.** `poll()` in `apps/worker/src/tick.ts` asks
Last.fm what a Watched Account is playing and logs it; the claim on the Now
Playing key and the Delivery per Subscription land there. It deliberately stops
short rather than half-doing it: claiming a key that nothing acts on would hide
that track from the fan-out arriving to handle it.

**No `wrangler` config yet**, so nothing is deployed and the Cron Trigger has
nothing to fire it. The D1 binding, Static Assets and the minute-granularity
schedule are issue 14, along with the CPU-time measurement against the free
plan's 10 ms.
