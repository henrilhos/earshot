---
status: superseded by ADR-0003
---

# SQLite as the only store, shared by the CLI and the Instance

State lives in SQLite through Node's built-in `node:sqlite`, and both the
standalone CLI and the hosted Instance use the same schema and the same code
to read it. There is no second storage implementation and no storage
abstraction to write one behind.

Two things drove this. Self-hosting is a product goal (see ADR-0001), and
"docker run with one volume" is a materially lower bar than "also provision a
database" — a Postgres requirement is the most common reason people give up on
self-hosting something. And because `node:sqlite` ships inside Node, the core
and CLI packages keep zero runtime dependencies.

## Consequences

- The `engines` floor rises to Node 24. `node:sqlite` was flag-gated through
  the 22 line, and the repo previously declared `>=22.18`.
- `node:sqlite` is still marked experimental and prints an `ExperimentalWarning`
  on use. This is accepted, not worked around.
- Serverless hosts are ruled out. The Instance needs a persistent disk, which
  means Fly.io with a volume, Railway, a VPS, or similar.
- Horizontal scaling is unavailable by construction: one node owns the file.
  At a ceiling of five Queue Owners this costs nothing.
- The standalone CLI stops using `state.json` and `tokens.json`. Both are
  migrated into the database on first run and then left in place rather than
  deleted.

## Superseded

ADR-0003 keeps the SQLite dialect and the single schema, but drops the claim
of a single implementation and the Node 24 engine floor. Hosting on
Cloudflare Workers means the Instance reaches D1 through a Worker binding
rather than `node:sqlite`, so there are two drivers over identical SQL.
