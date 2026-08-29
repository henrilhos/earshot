# Migrate state.json and tokens.json into the store

Status: ready-for-agent

Blocked by: 03

On first run the CLI imports the existing files and then leaves them in place
rather than deleting them.

- `state.json`'s `users` map becomes one Watched Account row each, carrying the
  last-seen key. Handle the legacy bare `{ lastKey }` shape too — the current
  `migrate()` in `src/index.ts` already does.
- `tokens.json`'s refresh token becomes the local Queue Owner's, encrypted.

There is no standalone-to-hosted migration: moving to an Instance means
re-authorizing Spotify against that Instance's app, then re-running `watch`.
