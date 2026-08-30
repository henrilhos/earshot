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

## Comments

Implemented on `t3code/migrate-json-state`.

- `packages/cli/src/database.ts` opens `earshot.db` in the working directory —
  where `state.json` and `tokens.json` were — and runs the schema, which is
  idempotent, so opening the file is the whole migration.
- `packages/cli/src/legacy.ts` is the import. It reads both files, writes what
  it finds into the store, and leaves them on disk. Because they stay there,
  every later run reads them again, so the import is guarded per row: a
  Watched Account that already exists is the store's own and newer than the
  file, and an existing Queue Owner is never overwritten by `tokens.json`. The
  legacy bare `{ lastKey }` is attributed to the account named on the command
  line, as `migrate()` in the old `state.ts` did. The last-seen key is written
  through `claimNowPlaying`, which is exactly what the file was kept for: the
  track playing at the last shutdown counts as handled.
- `packages/cli/src/owner.ts` holds the local Queue Owner. Standalone has no
  sign-in, so there is no Spotify user id to key the row on: the id is the
  constant `local`, and a local database holds exactly one. The Spotify app
  stays null in the row, since `.env` supplies it on every run and a second
  copy could only go stale.
- `state.ts`, `tokens.ts` and `json-file.ts` are gone, including the mkdir lock
  that let several instances share one file. SQLite is that now.
- `spotifyApi` in the core took a whole `SpotifyTokens` to read and write; it
  now takes `readRefreshToken` / `saveRefreshToken`. The store keeps only the
  refresh token, and the access token was already cached in the closure, so
  persisting the rest was fabricating fields nobody read.

**The refresh token is written in the clear.** Encrypting it is issue 05, which
owns the WebCrypto key handling and the README wording; both call sites are in
`owner.ts`, so it lands there and nowhere else. Nothing has shipped with a
database yet, so there is no stored plaintext to re-encrypt when it does.
