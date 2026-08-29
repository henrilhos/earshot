# lastfm-spotify-sync

Watches someone else's Last.fm "now playing" and adds each new track to the
end of your Spotify queue. Once per track. It only ever appends, and it
won't touch your queue unless Spotify is already playing.

## How it works

1. Every 30 seconds (configurable), it calls `user.getRecentTracks` for the
   target user. Last.fm needs an API key but no OAuth, since recent tracks
   are public.
2. When the `nowplaying` track changes, it strips noise like
   "- Remastered 2011" and "(feat. X)" off the artist and title, searches
   Spotify with what's left, and compares the results the same way.
3. If it finds a match and you have an active playback session, it queues
   the track with `POST /me/player/queue`.
4. Otherwise it logs the reason and moves on. It never retries a track.

It writes the last track it saw to `state.json`, so restarting won't
re-queue whatever was playing when you stopped it.

## Setup

Needs Node 22.18 or newer. The source is TypeScript, and Node runs it
directly by stripping the types, so there is no build step and nothing to
install to run it.

### 1. Last.fm API key

Free and instant: https://www.last.fm/api/account/create. The key is all
you need. No secret, no OAuth.

### 2. Spotify app

Create one at https://developer.spotify.com/dashboard.

- Add `http://127.0.0.1:8888/callback` as a Redirect URI. It has to match
  `.env` character for character.
- Copy the Client ID and Client Secret.

### 3. Configure

```bash
cp .env.example .env
# fill in LASTFM_API_KEY, LASTFM_TARGET_USER,
# SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
```

### 4. Authorize

```bash
npm run auth
```

This prints a URL. Open it, log in with your own Spotify account, the one
whose queue you want to control, and approve access. It saves a refresh
token to `tokens.json`. You only do this once, unless you revoke access.

### 5. Run

```bash
npm start
```

Leave it running. Open Spotify and play something so queued tracks have
somewhere to land.

To typecheck after changing something, `npm install` once for the dev
dependencies, then `npm run typecheck`.

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

**Request volume stays low.** Last.fm gets one call per `POLL_INTERVAL_MS`,
30 seconds by default. Spotify is only called when the now-playing track
changes, not on every poll.

**Queue once, not continuous mirroring.** It appends one track and stops.
It won't skip ahead, remove anything, or fight with the queue you built
yourself.
