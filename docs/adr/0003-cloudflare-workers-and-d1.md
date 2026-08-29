# Cloudflare Workers and D1, with a runtime-agnostic core

Supersedes ADR-0002.

The Instance runs as a Cloudflare Worker: one deploy serves the SPA through
Static Assets, the JSON API, and the polling tick, all on one origin. State
lives in D1.

This was forced by scheduling. The Instance has to poll Last.fm about once a
minute, because a "now playing" track that is not seen while it plays is never
seen at all. Vercel's free plan refuses cron expressions that run more than
once per day, and a deployment with a `*/1` schedule fails to build. Render's
free Postgres deletes itself thirty days after creation. Cloudflare's free plan
allows minute-granularity Cron Triggers and a D1 database that persists, which
made it the only free tier that can run this product at all.

D1 is SQLite, so the dialect and the schema stay shared with the standalone
CLI, which is what ADR-0002 was actually protecting.

## Consequences

- `packages/core` must run on both Node and `workerd`, so it may use only Web
  standards: `fetch`, `URL`, WebCrypto. No `node:` imports. `node:buffer` is
  already used for base64 in the Spotify client and has to go.
- Credential encryption at rest uses WebCrypto rather than
  `node:crypto`, which makes it one implementation across both runtimes instead
  of two.
- There are two storage drivers over one schema: `node:sqlite` for the CLI and
  the D1 binding for the Worker. The SQL text is identical; only execution
  differs. They sit behind the plain injected functions the core already takes.
- The Workers free plan allows 10 ms of CPU per invocation. The workload is
  almost entirely waiting on `fetch`, which does not count against it, but this
  is a hard limit. If real measurement shows it is tight, the answer is the
  $5/month Workers paid plan and its 30 s allowance, not an architectural
  change.
- The Node engine floor no longer needs to rise for `node:sqlite`, though the
  CLI still uses it.
