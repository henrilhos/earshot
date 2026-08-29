# Extract a runtime-agnostic core

Status: ready-for-agent

`packages/core` must run on both Node and `workerd` (ADR-0003), and must be
usable by a server process handling several Queue Owners at once. Today's code
cannot do either: `env.ts` calls `process.exit(1)` at import time, and
credentials are module-level constants, so one process can only ever act as one
Spotify identity.

- Move `lastfm.ts`, the Spotify client, and the sync tick into `packages/core`.
- Replace module-level `requireEnv` reads with values passed in. Config is read
  once at the edge (CLI entry, Worker entry) and handed down.
- Take dependencies as plain functions, not interfaces (no ports, no classes).
- Replace `node:buffer` base64 in the Spotify client with `btoa`.
- No `node:` imports anywhere in `packages/core`.

Done when `packages/core` imports nothing from `node:`, contains no
`process.exit`, and the sync tick is a function taking its collaborators as
arguments.
