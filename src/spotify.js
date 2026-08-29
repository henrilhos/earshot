import fs from 'fs';

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
} = process.env;

let cachedAccessToken = null;
let cachedExpiry = 0;

function loadTokens() {
  if (!fs.existsSync('tokens.json')) {
    throw new Error('tokens.json not found. Run `npm run auth` first.');
  }
  return JSON.parse(fs.readFileSync('tokens.json', 'utf8'));
}

// Spotify access tokens expire after 1hr; refresh_token is long-lived.
async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedExpiry - 30_000) {
    return cachedAccessToken;
  }

  const { refresh_token } = loadTokens();

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${JSON.stringify(data)}`);
  }

  cachedAccessToken = data.access_token;
  cachedExpiry = Date.now() + data.expires_in * 1000;

  // Spotify sometimes rotates the refresh token itself; persist if so.
  if (data.refresh_token) {
    const tokens = loadTokens();
    tokens.refresh_token = data.refresh_token;
    fs.writeFileSync('tokens.json', JSON.stringify(tokens, null, 2));
  }

  return cachedAccessToken;
}

async function spotifyFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
}

// Normalize a string for fuzzy comparison: lowercase, strip parenthetical
// noise like "(Remastered 2011)" / "- Live" / feat. credits, punctuation.
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/\(feat\.?[^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\(.*?(remaster|live|version|mix|edit|mono|stereo).*?\)/g, '')
    .replace(/-\s*(remaster|live|version|mix|edit|mono|stereo).*/g, '')
    .replace(/feat\.?.*/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Search Spotify for a track matching artist + title. Returns a track object
// or null if nothing reasonably close was found.
async function findTrack(artist, title) {
  const query = `track:${title} artist:${artist}`;
  const res = await spotifyFetch(`/search?${new URLSearchParams({ q: query, type: 'track', limit: '10' })}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Spotify search failed: ${JSON.stringify(data)}`);
  }

  const candidates = data.tracks?.items || [];
  if (candidates.length === 0) return null;

  const wantTitle = normalize(title);
  const wantArtist = normalize(artist);

  // Prefer an exact (normalized) title + artist match; fall back to the
  // top search result if nothing matches exactly, since Spotify's own
  // relevance ranking is usually decent.
  const exact = candidates.find(
    (t) =>
      normalize(t.name) === wantTitle &&
      t.artists.some((a) => normalize(a.name) === wantArtist)
  );

  return exact || candidates[0];
}

// Requires an active playback session (device) - Spotify's queue endpoint
// returns 404 "No active device found" otherwise.
async function hasActiveDevice() {
  const res = await spotifyFetch('/me/player');
  if (res.status === 204) return false; // no active player at all
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data?.device);
}

async function queueTrack(uri) {
  const res = await spotifyFetch(`/me/player/queue?${new URLSearchParams({ uri })}`, {
    method: 'POST',
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Failed to queue track (${res.status}): ${text}`);
  }
}

export { findTrack, queueTrack, hasActiveDevice, normalize };
