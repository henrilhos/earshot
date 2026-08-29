import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  authorizeUrl,
  exchangeCode,
  findTrack,
  hasActiveDevice,
  queueTrack,
  type SpotifyApi,
  type SpotifyApp,
  type SpotifyTokens,
  type SpotifyTrack,
  spotifyApi,
} from './spotify.ts';

const APP: SpotifyApp = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://127.0.0.1:8888/callback',
};

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), init);
}

function tracks(items: SpotifyTrack[]) {
  return async () => json({ tracks: { items } });
}

const KENDRICK: SpotifyTrack = {
  uri: 'spotify:track:alright',
  name: 'Alright',
  artists: [{ name: 'Kendrick Lamar' }],
};

test('sends the queue owner to Spotify with the playback scopes', () => {
  const query = new URL(authorizeUrl(APP)).searchParams;

  assert.equal(query.get('response_type'), 'code');
  assert.equal(query.get('client_id'), 'client-id');
  assert.equal(query.get('redirect_uri'), 'http://127.0.0.1:8888/callback');
  assert.equal(query.get('scope'), 'user-modify-playback-state user-read-playback-state');
});

test('exchanges the code with Basic auth built without node:buffer', async (t) => {
  let sent: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent = init;
    return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
  });

  const tokens = await exchangeCode(APP, 'the-code');

  assert.equal(tokens.refresh_token, 'refresh');
  const headers = sent?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Basic ${btoa('client-id:client-secret')}`);
  assert.equal(String(sent?.body), 'grant_type=authorization_code&code=the-code&redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2Fcallback');
});

test('throws when Spotify rejects the code', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    json({ error: 'invalid_grant' }, { status: 400 }),
  );

  await assert.rejects(exchangeCode(APP, 'stale'), /invalid_grant/);
});

function tokenHarness(stored: SpotifyTokens | null, refreshed: Partial<SpotifyTokens> = {}) {
  const saved: SpotifyTokens[] = [];
  const requests: { url: string; init: RequestInit }[] = [];

  const fetchStub = async (url: string, init: RequestInit = {}) => {
    requests.push({ url, init });
    if (url.startsWith('https://accounts.spotify.com')) {
      return json({ access_token: 'fresh-access', expires_in: 3600, ...refreshed });
    }
    return json({ device: { id: 'laptop' } });
  };

  const api = spotifyApi({
    app: APP,
    readTokens: () => stored,
    saveTokens: (tokens) => {
      saved.push(tokens);
    },
  });

  return { api, saved, requests, fetchStub };
}

test('authorizes calls with an access token refreshed on demand', async (t) => {
  const { api, requests, fetchStub } = tokenHarness({
    access_token: 'stale',
    refresh_token: 'refresh',
    expires_in: 3600,
  });
  t.mock.method(globalThis, 'fetch', fetchStub);

  await api('/me/player');

  assert.equal(requests[0]?.url, 'https://accounts.spotify.com/api/token');
  assert.equal(requests[1]?.url, 'https://api.spotify.com/v1/me/player');
  const headers = requests[1]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer fresh-access');
});

test('reuses the access token across calls until it nears expiry', async (t) => {
  const { api, requests, fetchStub } = tokenHarness({
    access_token: 'stale',
    refresh_token: 'refresh',
    expires_in: 3600,
  });
  t.mock.method(globalThis, 'fetch', fetchStub);

  await api('/me/player');
  await api('/me/player');

  const refreshes = requests.filter((r) => r.url.startsWith('https://accounts.spotify.com'));
  assert.equal(refreshes.length, 1);
});

test('persists a refresh token Spotify rotated', async (t) => {
  const { api, saved, fetchStub } = tokenHarness(
    { access_token: 'stale', refresh_token: 'old', expires_in: 3600 },
    { refresh_token: 'rotated' },
  );
  t.mock.method(globalThis, 'fetch', fetchStub);

  await api('/me/player');

  assert.equal(saved.at(-1)?.refresh_token, 'rotated');
});

test('refuses to call Spotify without an authorization to refresh', async () => {
  const api = spotifyApi({ app: APP, readTokens: () => null, saveTokens: () => {} });

  await assert.rejects(api('/me/player'), /No stored Spotify authorization/);
});

test('holds one identity per client, not one per process', async (t) => {
  const bearers: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('https://accounts.spotify.com')) {
      const grant = new URLSearchParams(String(init.body));
      return json({ access_token: `access-for-${grant.get('refresh_token')}`, expires_in: 3600 });
    }
    bearers.push((init.headers as Record<string, string>).Authorization ?? '');
    return json({ device: null });
  });

  const first = spotifyApi({
    app: APP,
    readTokens: () => ({ access_token: 'a', refresh_token: 'first-owner', expires_in: 3600 }),
    saveTokens: () => {},
  });
  const second = spotifyApi({
    app: APP,
    readTokens: () => ({ access_token: 'b', refresh_token: 'second-owner', expires_in: 3600 }),
    saveTokens: () => {},
  });

  await first('/me/player');
  await second('/me/player');
  await first('/me/player');

  assert.deepEqual(bearers, [
    'Bearer access-for-first-owner',
    'Bearer access-for-second-owner',
    'Bearer access-for-first-owner',
  ]);
});

test('prefers an exact match over Spotify ranking', async () => {
  const api: SpotifyApi = tracks([
    { uri: 'spotify:track:top', name: 'Alright Again', artists: [{ name: 'Gatemouth Brown' }] },
    KENDRICK,
  ]);

  const match = await findTrack(api, 'Kendrick Lamar', 'Alright');

  assert.equal(match?.uri, 'spotify:track:alright');
});

test('matches through version markers and feature credits', async () => {
  const seen: string[] = [];
  const api: SpotifyApi = async (path) => {
    seen.push(path);
    return json({ tracks: { items: [KENDRICK] } });
  };

  const match = await findTrack(api, 'Kendrick Lamar (part. Pharrell)', 'Alright - Remastered 2015');

  assert.equal(match?.uri, 'spotify:track:alright');
  assert.match(seen[0] ?? '', /q=track%3Aalright\+artist%3Akendrick\+lamar/);
});

test('falls back to the top result when nothing matches exactly', async () => {
  const api: SpotifyApi = tracks([
    { uri: 'spotify:track:cover', name: 'Alright', artists: [{ name: 'Some Cover Band' }] },
  ]);

  const match = await findTrack(api, 'Kendrick Lamar', 'Alright');

  assert.equal(match?.uri, 'spotify:track:cover');
});

test('reports no match when Spotify returns nothing', async () => {
  assert.equal(await findTrack(tracks([]), 'Kendrick Lamar', 'Alright'), null);
});

test('throws when the search itself fails', async () => {
  const api: SpotifyApi = async () => json({ error: 'expired' }, { status: 401 });

  await assert.rejects(findTrack(api, 'Kendrick Lamar', 'Alright'), /Spotify search failed/);
});

test('sees an active device only when one is playing', async () => {
  const playing: SpotifyApi = async () => json({ device: { id: 'laptop' } });
  const idle: SpotifyApi = async () => new Response(null, { status: 204 });
  const denied: SpotifyApi = async () => json({ error: 'nope' }, { status: 403 });

  assert.equal(await hasActiveDevice(playing), true);
  assert.equal(await hasActiveDevice(idle), false);
  assert.equal(await hasActiveDevice(denied), false);
});

test('queues a track by uri', async () => {
  const seen: { path: string; init?: RequestInit }[] = [];
  const api: SpotifyApi = async (path, init) => {
    seen.push({ path, init });
    return new Response(null, { status: 204 });
  };

  await queueTrack(api, 'spotify:track:alright');

  assert.equal(seen[0]?.path, '/me/player/queue?uri=spotify%3Atrack%3Aalright');
  assert.equal(seen[0]?.init?.method, 'POST');
});

test('throws when the queue call fails', async () => {
  const api: SpotifyApi = async () => new Response('Player command failed', { status: 404 });

  await assert.rejects(queueTrack(api, 'spotify:track:alright'), /Failed to queue track \(404\)/);
});
