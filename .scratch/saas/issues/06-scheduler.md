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
