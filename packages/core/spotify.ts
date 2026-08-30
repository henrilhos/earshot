// The Instance's own Spotify app registration, or a Queue Owner's own.
export type SpotifyApp = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type SpotifyTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export type SpotifyTrack = {
  uri: string;
  name: string;
  artists: { name: string }[];
};

// One authorized Spotify identity's view of the API. Every call carries that
// Queue Owner's access token, so a process can hold several at once.
export type SpotifyApi = (path: string, init?: RequestInit) => Promise<Response>;

// user-modify-playback-state -> add to queue
// user-read-playback-state   -> check there's an active device before queueing
const SCOPES = 'user-modify-playback-state user-read-playback-state';

// btoa rather than node:buffer, since this has to run on workerd too. Client
// credentials are ASCII, which is all btoa accepts.
function basicAuth(app: SpotifyApp): string {
  return `Basic ${btoa(`${app.clientId}:${app.clientSecret}`)}`;
}

async function requestTokens(app: SpotifyApp, grant: Record<string, string>): Promise<SpotifyTokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(app),
    },
    body: new URLSearchParams(grant),
  });

  const data = (await res.json()) as SpotifyTokens;
  if (!res.ok) throw new Error(`Spotify token request failed: ${JSON.stringify(data)}`);
  return data;
}

export function authorizeUrl(app: SpotifyApp): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: app.clientId,
    scope: SCOPES,
    redirect_uri: app.redirectUri,
  });
  return `https://accounts.spotify.com/authorize?${query}`;
}

export function exchangeCode(app: SpotifyApp, code: string): Promise<SpotifyTokens> {
  return requestTokens(app, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: app.redirectUri,
  });
}

export function refreshTokens(app: SpotifyApp, refreshToken: string): Promise<SpotifyTokens> {
  return requestTokens(app, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

// The access token is cached in this closure rather than at module level, so
// two of these can exist side by side without one answering as the other.
export function spotifyApi(options: {
  app: SpotifyApp;
  // Only the refresh token is stored. The access token lives in this closure,
  // so the caller never has to keep a value that is stale within the hour.
  readRefreshToken: () => string | null | Promise<string | null>;
  saveRefreshToken: (refreshToken: string) => void | Promise<void>;
}): SpotifyApi {
  let accessToken: string | null = null;
  let expiresAt = 0;

  // Access tokens expire after an hour; the refresh token is long-lived.
  async function getAccessToken(): Promise<string> {
    if (accessToken && Date.now() < expiresAt - 30_000) return accessToken;

    const stored = await options.readRefreshToken();
    if (!stored) throw new Error('No stored Spotify authorization to refresh.');

    const tokens = await refreshTokens(options.app, stored);

    accessToken = tokens.access_token;
    expiresAt = Date.now() + tokens.expires_in * 1000;

    // Spotify sometimes rotates the refresh token itself; persist if so.
    if (tokens.refresh_token) await options.saveRefreshToken(tokens.refresh_token);

    return accessToken;
  }

  return async (path, init = {}) => {
    const token = await getAccessToken();
    return fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  };
}

// Version markers that Last.fm and Spotify spell differently, in English and
// pt-BR: "Ao Vivo", "Remasterizado 2011", "Versão Acústica", "Edição Especial".
const VERSION_TERMS =
  'remaster|ao vivo|live|versao|version|mix|edit|edicao|mono|stereo|acustic';

// Brazilian releases credit featured artists with "part." (participação)
// instead of "feat.". The dot is required so titles like "Part 1" survive.
const FEATURE_TERMS = 'feat\\.?|ft\\.|part\\.|participacao';

// Strips the noise that keeps otherwise identical titles from comparing
// equal: "(Remastered 2011)", "- Ao Vivo", feat./part. credits, punctuation.
function normalize(str: string): string {
  return str
    .toLowerCase()
    // Accents first, so "Versão" reaches the term lists as "versao".
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(new RegExp(`\\((?:${FEATURE_TERMS})[^)]*\\)`, 'g'), '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(new RegExp(`\\(.*?(?:${VERSION_TERMS}).*?\\)`, 'g'), '')
    .replace(new RegExp(`-\\s*(?:${VERSION_TERMS}).*`, 'g'), '')
    .replace(new RegExp(`(?:${FEATURE_TERMS}).*`, 'g'), '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The fallback to the top result is deliberate: Spotify's own relevance
// ranking is usually better than nothing when nothing matches exactly.
export async function findTrack(
  api: SpotifyApi,
  artist: string,
  title: string,
): Promise<SpotifyTrack | null> {
  const wantTitle = normalize(title);
  const wantArtist = normalize(artist);

  // Search on the normalized terms too, since Spotify has no track called
  // "Me and Your Mama - Remastered". Titles like "!!!" normalize to nothing.
  const query = new URLSearchParams({
    q: `track:${wantTitle || title} artist:${wantArtist || artist}`,
    type: 'track',
    limit: '10',
  });

  const res = await api(`/search?${query}`);
  const data = (await res.json()) as { tracks?: { items?: SpotifyTrack[] } };
  if (!res.ok) throw new Error(`Spotify search failed: ${JSON.stringify(data)}`);

  const candidates = data.tracks?.items ?? [];

  const exact = candidates.find(
    (track) =>
      normalize(track.name) === wantTitle &&
      track.artists.some((a) => normalize(a.name) === wantArtist),
  );

  return exact ?? candidates[0] ?? null;
}

// The queue endpoint returns 404 "No active device found" when nothing is
// playing anywhere, so check before queueing and report a skip instead.
export async function hasActiveDevice(api: SpotifyApi): Promise<boolean> {
  const res = await api('/me/player');
  if (!res.ok || res.status === 204) return false;
  const data = (await res.json()) as { device?: unknown };
  return Boolean(data.device);
}

export async function queueTrack(api: SpotifyApi, uri: string): Promise<void> {
  const res = await api(`/me/player/queue?${new URLSearchParams({ uri })}`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Failed to queue track (${res.status}): ${await res.text()}`);
  }
}
