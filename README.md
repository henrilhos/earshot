# earshot

[![CI](https://github.com/henrilhos/earshot/actions/workflows/ci.yml/badge.svg)](https://github.com/henrilhos/earshot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](https://nodejs.org)

Watches someone else's Last.fm "now playing" and adds each new track to the
end of your Spotify queue. Once per track. It only ever appends, and it
won't touch your queue unless Spotify is already playing.

## How it works

1. Every 60 seconds (configurable), it calls `user.getRecentTracks` for the
   target user. Last.fm needs an API key but no OAuth, since recent tracks
   are public.
2. When the `nowplaying` track changes, it strips noise like
   "- Remastered 2011" and "(feat. X)" off the artist and title, searches
   Spotify with what's left, and compares the results the same way.
3. If it finds a match and you have an active playback session, it queues
   the track with `POST /me/player/queue`.
4. Otherwise it logs the reason and moves on. It never retries a track.

It keeps everything it remembers in `earshot.db`, a SQLite file in the
directory you run it from: your Spotify authorization, who you're watching, and
the last track it saw for each of them, so restarting won't re-queue whatever
was playing when you stopped it. The authorization is encrypted with a key from
your `.env`; see [what the encryption is for](#notes-and-limitations).

## Setup

Needs Node 22.18 or newer.

### 1. Last.fm API key

Free and instant: https://www.last.fm/api/account/create. The key is all
you need. No secret, no OAuth.

### 2. Spotify app

Create one at https://developer.spotify.com/dashboard.

- Add `http://127.0.0.1:8888/callback` as a Redirect URI. It has to match
  `.env` character for character.
- Copy the Client ID and Client Secret.

### 3. Configure

It reads a `.env` from the directory you run it in, or the variables
straight out of the environment.

```bash
LASTFM_API_KEY=...
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
EARSHOT_SECRET_KEY=...
POLL_INTERVAL_MS=60000   # optional
```

From a clone, `cp .env.example .env` gets you the same file with comments.

`EARSHOT_SECRET_KEY` is what your Spotify refresh token is encrypted with. It's
thirty-two random bytes in base64, and you don't have to make one yourself:
run `npx earshot auth` without it and it prints a fresh key to paste into
`.env`. Keep it, back it up with the database, and don't put it in git. Lose it
and nothing is broken except that authorization — delete `earshot.db`, set a
new key, and authorize again.

### 4. Authorize

```bash
npx earshot auth
```

This prints a URL. Open it, log in with your own Spotify account, the one
whose queue you want to control, and approve access. It saves a refresh
token to `earshot.db`. You only do this once, unless you revoke access.

### 5. Run

```bash
npx earshot their_lastfm_username
```

The argument is the Last.fm account you're mirroring. Leave it running.
Open Spotify and play something so queued tracks have somewhere to land.

To mirror several people into the same queue, start one instance per
account:

```bash
npx earshot first_username &
npx earshot second_username &
```

They share `earshot.db` and keep one row each, so they don't overwrite
each other's progress. Two instances watching the *same* account won't
queue the track twice either: whichever one records it first wins.

## Notes and limitations

**Queueing needs an active device.** Spotify's queue endpoint fails if
nothing is playing anywhere. The script logs a skip instead of crashing,
but tracks that come in while you aren't listening are gone. It won't go
back for them.

**Matching is best-effort, and it will get things wrong.** Live versions,
alternate pressings, and anything obscure tend to resolve to something
adjacent or to nothing at all. When the normalized artist and title don't
match exactly, it falls back to Spotify's top search result, which is
usually right and occasionally embarrassing. Every miss is logged with the
artist and title so you can check what it did.

**Upgrading from `state.json` and `tokens.json`.** Earlier versions kept
their state in those two files. The first run reads whatever it finds in them
into `earshot.db`, encrypting the token on the way in, and then leaves them
alone — nothing is deleted for you, and
a later run never reads them back over anything the database has since
learned. Once it has started cleanly you can delete both.

**What the encryption is for.** The refresh token in `earshot.db` is encrypted
with AES-256-GCM, so the database on its own is not enough to act as you on
Spotify. That covers the way these things usually leak: a backup, a synced
folder, a directory committed by accident. It is not protection against anyone
who can read your `.env`, because the key is right there next to the data —
same machine, same account, usually the same folder. Anyone with your user has
both.

**Request volume stays low.** Last.fm gets one call per `POLL_INTERVAL_MS`,
60 seconds by default. Spotify is only called when the now-playing track
changes, not on every poll.

**Queue once, not continuous mirroring.** It appends one track and stops.
It won't skip ahead, remove anything, or fight with the queue you built
yourself.

## Working on it

```
packages/core    the sync itself: zero dependencies, no build, runs on Node
                 and workerd alike, all of it checked in CI
packages/cli     what npm publishes, zero dependencies, no build
apps/web         the SPA, with its own dependency tree     (not built yet)
apps/worker      the hosted Instance                       (the tick only)
```

`packages/core` and `packages/cli` declare no dependencies, and `npm run
verify:deps` fails the build if either grows one. That is the whole point of
the split: `apps/web` brings a bundler and a few hundred packages, and none of
it may reach the thing people install with `npx`.

Clone it and it runs with nothing installed, because Node executes the
TypeScript directly:

```bash
npm run auth
npm start -- their_lastfm_username
```

`npm install` once gets you the two dev dependencies behind `npm run
typecheck`. `npm test` needs nothing.

The npm tarball is the exception. Node refuses to strip types under
`node_modules`, so `packages/cli` compiles to JavaScript on `prepack`, which
also copies `packages/core` in beside it — the published package cannot
depend on a sibling it has no dependency on. `npm pack -w earshot` does both
and puts the checkout back afterwards.

## Releasing

Bump `version` in `packages/cli/package.json`, then push a matching tag:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

`.github/workflows/release.yml` typechecks, tests, checks the tag against the
manifest, and publishes with provenance. It needs an `NPM_TOKEN` secret with
publish rights.

## License

[MIT](LICENSE)
