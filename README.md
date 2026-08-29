# lastfm-spotify-sync

Watches someone else's Last.fm "now playing" and, the first time it sees a
new track, adds the matching song to the end of **your** Spotify queue.
One-shot per track — it won't keep re-adding it, and it won't touch your
queue if it isn't already actively playing something.

## How it works

1. Polls `user.getRecentTracks` on Last.fm for the target user every 30s
   (configurable). Only the public API is needed — no auth for Last.fm.
2. When the `nowplaying` track changes, searches Spotify for a matching
   track (artist + title, with fuzzy normalization for things like
   "- Remastered 2011" or "(feat. X)").
3. If a match is found **and** you have an active Spotify playback session
   open (app open and something loaded/playing), queues it via
   `POST /me/player/queue`.
4. If no match is found, or you have no active device, it logs that and
   moves on — it never retries the same track.

State (the last track key seen) is persisted to `state.json` so a restart
doesn't immediately re-queue whatever was last processed.

## Setup

### 1. Last.fm API key

Free, instant: https://www.last.fm/api/account/create
You just need the API key — no secret, no OAuth, since recent tracks are
public data.

### 2. Spotify app

Create one at https://developer.spotify.com/dashboard

- Add a Redirect URI: `http://127.0.0.1:8888/callback` (must match `.env` exactly)
- Grab the Client ID and Client Secret

### 3. Configure

```bash
cp .env.example .env
# edit .env: fill in LASTFM_API_KEY, LASTFM_TARGET_USER,
# SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
```

### 4. Install & authorize (once)

```bash
npm install
npm run auth
```

This prints a URL — open it, log in with **your own** Spotify account (the
one whose queue you want to control), approve access. It saves
`tokens.json` with a refresh token. You only need to do this once (unless
you revoke access).

### 5. Run

```bash
npm start
```

Leave it running. Open Spotify and start playing something (anything —
the queue API needs an active device) so tracks have somewhere to land.

## Notes / limitations

- **Spotify's queue endpoint needs an active device.** If Spotify isn't
  open and playing on some device, queueing fails — the script logs a
  skip rather than erroring out.
- **Matching isn't perfect.** Live versions, alternate releases, and
  obscure/unreleased tracks may not resolve correctly, or at all. Misses
  are logged with the artist/title so you can see what got skipped.
- **Rate limits as configured:** Last.fm polled at most once per
  `POLL_INTERVAL_MS` (default 30s, per your ask); Spotify is only called
  when Last.fm reports an actual new now-playing track, not on every poll.
- **This is "queue once," not continuous mirroring.** It won't skip
  ahead in your playback, remove things, or fight with your own queue —
  it just appends the one matched track.
