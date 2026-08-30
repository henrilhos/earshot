# @earshot/worker

The Instance. The JSON API and the SPA served through Static Assets land here
(issues 09 and 12); what is built so far is the schedule.

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

## Bindings and secrets

| Name | What it is |
| --- | --- |
| `DB` | The D1 binding |
| `LASTFM_API_KEY` | Reads public recent tracks, so one key serves the whole Instance |
| `TICK_TOKEN` | The bearer token `POST /api/tick` requires. Unset closes the endpoint rather than opening it |
| `POLL_INTERVAL_MS` | Optional. Defaults to 60000, matching the Cron Trigger |

```bash
curl -X POST -H "Authorization: Bearer $TICK_TOKEN" https://your-instance/api/tick
# {"polled":["their_lastfm_username"]}
```

The `wrangler` config that binds these — D1, Static Assets, and the
minute-granularity Cron Trigger — is issue 14, along with the deployment docs.
