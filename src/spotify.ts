import { Buffer } from 'node:buffer';
import { requireEnv } from './env.ts';
import { readJson, writeJson } from './json-file.ts';

const CLIENT_ID = requireEnv('SPOTIFY_CLIENT_ID');
const CLIENT_SECRET = requireEnv('SPOTIFY_CLIENT_SECRET');
const TOKENS_FILE = 'tokens.json';

// user-modify-playback-state -> add to queue
// user-read-playback-state   -> check there's an active device before queueing
const SCOPES = 'user-modify-playback-state user-read-playback-state';

export const redirectUri = requireEnv('SPOTIFY_REDIRECT_URI');

export type SpotifyTrack = {
  uri: string;
  name: string;
  artists: { name: string }[];
};

type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

// The authorization-code exchange and the refresh both post to the same
// endpoint with the same client credentials; only the grant differs.
async function requestTokens(grant: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams(grant),
  });

  const data = (await res.json()) as Tokens;
  if (!res.ok) throw new Error(`Spotify token request failed: ${JSON.stringify(data)}`);
  return data;
}

export function authorizeUrl(): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: redirectUri,
  });
  return `https://accounts.spotify.com/authorize?${query}`;
}

export async function saveTokensForCode(code: string): Promise<void> {
  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  writeJson(TOKENS_FILE, tokens);
}

let accessToken: string | null = null;
let expiresAt = 0;

// Access tokens expire after an hour; the refresh token is long-lived.
async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < expiresAt - 30_000) return accessToken;

  const stored = readJson<Tokens>(TOKENS_FILE);
  if (!stored?.refresh_token) {
    throw new Error('No usable tokens.json. Run `npm run auth` first.');
  }

  const tokens = await requestTokens({
    grant_type: 'refresh_token',
    refresh_token: stored.refresh_token,
  });

  accessToken = tokens.access_token;
  expiresAt = Date.now() + tokens.expires_in * 1000;

  // Spotify sometimes rotates the refresh token itself; persist if so.
  if (tokens.refresh_token) writeJson(TOKENS_FILE, { ...stored, ...tokens });

  return accessToken;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

// Lowercase and strip the noise that keeps otherwise identical titles from
// comparing equal: "(Remastered 2011)", "- Live", feat. credits, punctuation.
export function normalize(str: string): string {
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

// Prefer an exact (normalized) artist + title match, and fall back to the top
// search result, since Spotify's own relevance ranking is usually decent.
export async function findTrack(artist: string, title: string): Promise<SpotifyTrack | null> {
  const query = new URLSearchParams({
    q: `track:${title} artist:${artist}`,
    type: 'track',
    limit: '10',
  });

  const res = await api(`/search?${query}`);
  const data = (await res.json()) as { tracks?: { items?: SpotifyTrack[] } };
  if (!res.ok) throw new Error(`Spotify search failed: ${JSON.stringify(data)}`);

  const candidates = data.tracks?.items ?? [];
  const wantTitle = normalize(title);
  const wantArtist = normalize(artist);

  const exact = candidates.find(
    (track) =>
      normalize(track.name) === wantTitle &&
      track.artists.some((a) => normalize(a.name) === wantArtist),
  );

  return exact ?? candidates[0] ?? null;
}

// The queue endpoint returns 404 "No active device found" when nothing is
// playing anywhere, so check before queueing and report a skip instead.
export async function hasActiveDevice(): Promise<boolean> {
  const res = await api('/me/player');
  if (!res.ok || res.status === 204) return false;
  const data = (await res.json()) as { device?: unknown };
  return Boolean(data.device);
}

export async function queueTrack(uri: string): Promise<void> {
  const res = await api(`/me/player/queue?${new URLSearchParams({ uri })}`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Failed to queue track (${res.status}): ${await res.text()}`);
  }
}
