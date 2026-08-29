# SaaS + CLI

Turn the single-purpose CLI into a self-hostable multi-tenant web application
that keeps working as a standalone CLI. Settled by grilling; the vocabulary is
in `CONTEXT.md` and the irreversible choices are in `docs/adr/`.

## Shape

Two deployments over one core.

- **Instance** — a Cloudflare Worker. Serves the SPA through Static Assets, a
  JSON API, and the polling tick, on one origin. State in D1. See ADR-0003.
- **Standalone CLI** — published to npm, runs the same core against a local
  SQLite file via `node:sqlite`. No account, no server, works offline.

`packages/core` runs on both Node and `workerd`, so it uses Web standards only:
`fetch`, `URL`, WebCrypto. No `node:` imports. Dependencies are injected as
plain functions, not interfaces.

```
packages/core    zero runtime deps, no build, runtime-agnostic   (CI-enforced)
packages/cli     zero runtime deps, no build, `bin` entry, npm published
apps/web         Vite + React SPA, its own dependency tree
apps/worker      the Instance: API + static assets + scheduled tick
```

## Decisions

| Area | Decision |
| --- | --- |
| Audience | No public signup. Five Queue Owners, allowlisted by hand in Spotify's dashboard. ADR-0001 |
| CLI | Standalone mode *and* a logged-in mode driving an Instance's API |
| Cardinality | Many-to-many. One poll per Watched Account, fanned out to N Subscriptions |
| Idle queue | Tracks seen while Spotify is idle are dropped, recorded as `no_device`. Playlist buffering is a later feature |
| Auth | Sign in with Spotify, sole login. Identity is the Spotify user id |
| Store | D1 for the Instance, `node:sqlite` for the CLI. One schema, identical SQL, two thin drivers. ADR-0003 |
| Secrets | Refresh tokens encrypted with AES-256-GCM via WebCrypto, key from env |
| Scheduling | `next_poll_at` in the database. Native Cron Trigger *and* an authenticated `POST /api/tick`, both calling one function |
| History | Every attempt is a Delivery row with an Outcome and an `exact` flag |
| Dead grants | Permanent auth failure parks the Queue Owner as needing re-authorization; transient failures retry |
| Operator | Named by env var. Can remove a Queue Owner and see Instance-wide Deliveries. Nothing else |

## Explicitly not doing

- Public signup, billing, password reset — foreclosed by ADR-0001.
- Bring-your-own Spotify app. Kept cheap by modelling client credentials as a
  nullable per-Queue-Owner field, but not built.
- A local worker pulling work from a cloud control plane.
- Playlist buffering for the idle-queue case.
- Delivery retention or cleanup jobs.
- Idle backoff for Watched Accounts who have stopped scrobbling.
- Roles beyond the single operator flag.

## Risks

- **10 ms CPU per Worker invocation on the free plan.** The workload is almost
  all `fetch` waiting, which does not count, but the limit is hard. Measure it.
  The answer if it bites is the $5/month plan, not a redesign.
- **Overlapping ticks.** Cron and the HTTP endpoint can run concurrently. The
  claim must be a conditional `UPDATE` on `next_poll_at` that exactly one
  invocation wins, or a track gets queued twice.
- **Two drivers drifting.** Mitigated by sharing schema and SQL text verbatim;
  only execution differs.
- **Spotify allowlisting is manual and outside the app.** Onboarding a Queue
  Owner always involves the operator pasting an email into a dashboard.
