import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import {
  cipher,
  type D1Binding,
  type D1Statement,
  type Db,
  generateSecretKey,
  getQueueOwner,
  migrate,
  type Row,
  saveQueueOwner,
  type SqlValue,
} from '../../../packages/core/index.ts';
import type { Env } from './env.ts';
import worker from './index.ts';

// A real, in-memory database behind the D1 shape, so a callback's upsert is
// asserted against what actually landed rather than against SQL text.
function sqliteD1(sqlite: DatabaseSync): D1Binding {
  return {
    prepare(sql) {
      let bound: SqlValue[] = [];
      const statement: D1Statement = {
        bind(...params) {
          bound = params;
          return statement;
        },
        all: async () => ({ results: sqlite.prepare(sql).all(...bound) as unknown[] }),
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bound).changes) } }),
      };
      return statement;
    },
  };
}

async function testDb(): Promise<{ db: Db; binding: D1Binding }> {
  const sqlite = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  const binding = sqliteD1(sqlite);
  const db: Db = {
    all: async (sql, params = []) => sqlite.prepare(sql).all(...params) as Row[],
    run: async (sql, params = []) => Number(sqlite.prepare(sql).run(...params).changes),
  };
  await migrate(db);
  return { db, binding };
}

const SECRET_KEY = generateSecretKey();

function environment(binding: D1Binding): Env {
  return {
    DB: binding,
    LASTFM_API_KEY: 'lastfm-key',
    EARSHOT_SECRET_KEY: SECRET_KEY,
    SPOTIFY_CLIENT_ID: 'instance-client-id',
    SPOTIFY_CLIENT_SECRET: 'instance-client-secret',
    SPOTIFY_REDIRECT_URI: 'https://earshot.example/api/auth/callback',
  };
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), init);
}

// Spotify's token exchange and profile lookup, the only two calls a callback
// makes, keyed off the URL so a test can override either independently.
function spotifyStub(overrides: { token?: () => Response; profile?: () => Response } = {}) {
  return async (url: string | URL) => {
    const href = String(url);
    if (href.startsWith('https://accounts.spotify.com/api/token')) {
      return overrides.token
        ? overrides.token()
        : json({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 });
    }
    if (href.startsWith('https://api.spotify.com/v1/me')) {
      return overrides.profile
        ? overrides.profile()
        : json({ id: 'spotify-user', display_name: 'Someone' });
    }
    throw new Error(`Unexpected fetch in test: ${href}`);
  };
}

function stateCookieValue(response: Response): string {
  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith('oauth_state='));
  assert.ok(setCookie, 'expected a Set-Cookie for oauth_state');
  return setCookie.split(';')[0]!;
}

function stateQueryParam(response: Response): string {
  const location = response.headers.get('location');
  assert.ok(location);
  return new URL(location!).searchParams.get('state')!;
}

test('GET /api/auth/login redirects to Spotify with the playback scopes and a state cookie', async () => {
  const { binding } = await testDb();
  const env = environment(binding);

  const response = await worker.fetch(new Request('https://earshot.example/api/auth/login'), env);

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.origin + location.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(location.searchParams.get('client_id'), 'instance-client-id');
  assert.equal(location.searchParams.get('redirect_uri'), env.SPOTIFY_REDIRECT_URI);
  assert.ok(location.searchParams.get('state'));
  assert.equal(location.searchParams.get('state'), stateQueryParam(response));

  assert.ok(stateCookieValue(response).startsWith('oauth_state='));
});

test('refuses to start sign-in on anything but GET', async () => {
  const { binding } = await testDb();
  const response = await worker.fetch(new Request('https://earshot.example/api/auth/login', { method: 'POST' }), environment(binding));
  assert.equal(response.status, 405);
});

test('GET /api/auth/callback signs a new Queue Owner in and sets a session cookie', async (t) => {
  const { db, binding } = await testDb();
  const env = environment(binding);
  t.mock.method(globalThis, 'fetch', spotifyStub());

  const login = await worker.fetch(new Request('https://earshot.example/api/auth/login'), env);
  const state = stateQueryParam(login);
  const cookie = stateCookieValue(login);

  const callback = await worker.fetch(
    new Request(`https://earshot.example/api/auth/callback?code=the-code&state=${state}`, {
      headers: { cookie },
    }),
    env,
  );

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/');

  const setCookies = callback.headers.getSetCookie();
  const session = setCookies.find((c) => c.startsWith('session='));
  assert.ok(session, 'expected a session cookie to be set');
  assert.ok(setCookies.some((c) => c.startsWith('oauth_state=') && c.includes('Max-Age=0')));

  const owner = await getQueueOwner(db, 'spotify-user');
  assert.equal(owner?.displayName, 'Someone');
  assert.equal(owner?.needsReauthorization, false);
  assert.equal(owner?.spotifyApp, null);

  const secretCipher = await cipher(SECRET_KEY);
  assert.equal(await secretCipher.decrypt(owner!.refreshToken), 'refresh-token');
});

test('rejects a callback whose state does not match the cookie, and saves nobody', async (t) => {
  const { db, binding } = await testDb();
  const env = environment(binding);
  t.mock.method(globalThis, 'fetch', spotifyStub());

  const response = await worker.fetch(
    new Request('https://earshot.example/api/auth/callback?code=the-code&state=forged', {
      headers: { cookie: 'oauth_state=the-real-state' },
    }),
    env,
  );

  assert.equal(response.status, 400);
  assert.equal(await getQueueOwner(db, 'spotify-user'), null);
});

test('rejects a callback with no state cookie at all', async (t) => {
  const { binding } = await testDb();
  const env = environment(binding);
  t.mock.method(globalThis, 'fetch', spotifyStub());

  const response = await worker.fetch(
    new Request('https://earshot.example/api/auth/callback?code=the-code&state=anything'),
    env,
  );

  assert.equal(response.status, 400);
});

test('surfaces a Spotify sign-in error without touching the database', async (t) => {
  const { db, binding } = await testDb();
  const env = environment(binding);
  t.mock.method(globalThis, 'fetch', spotifyStub());

  const login = await worker.fetch(new Request('https://earshot.example/api/auth/login'), env);
  const state = stateQueryParam(login);
  const cookie = stateCookieValue(login);

  const response = await worker.fetch(
    new Request(`https://earshot.example/api/auth/callback?error=access_denied&state=${state}`, {
      headers: { cookie },
    }),
    env,
  );

  assert.equal(response.status, 400);
  assert.equal(await getQueueOwner(db, 'spotify-user'), null);
});

test('a returning Queue Owner who signs in again is cleared of needsReauthorization', async (t) => {
  const { db, binding } = await testDb();
  const env = environment(binding);

  await saveQueueOwner(db, {
    spotifyUserId: 'spotify-user',
    displayName: 'Stale Name',
    refreshToken: 'irrelevant-plaintext-for-this-test',
    needsReauthorization: true,
    spotifyApp: null,
  });

  t.mock.method(globalThis, 'fetch', spotifyStub());

  const login = await worker.fetch(new Request('https://earshot.example/api/auth/login'), env);
  const state = stateQueryParam(login);
  const cookie = stateCookieValue(login);

  await worker.fetch(
    new Request(`https://earshot.example/api/auth/callback?code=the-code&state=${state}`, { headers: { cookie } }),
    env,
  );

  const owner = await getQueueOwner(db, 'spotify-user');
  assert.equal(owner?.needsReauthorization, false);
  assert.equal(owner?.displayName, 'Someone');
});

test('answers 502 when Spotify never returns a refresh token', async (t) => {
  const { db, binding } = await testDb();
  const env = environment(binding);
  t.mock.method(
    globalThis,
    'fetch',
    spotifyStub({ token: () => json({ access_token: 'access-token', expires_in: 3600 }) }),
  );

  const login = await worker.fetch(new Request('https://earshot.example/api/auth/login'), env);
  const state = stateQueryParam(login);
  const cookie = stateCookieValue(login);

  const response = await worker.fetch(
    new Request(`https://earshot.example/api/auth/callback?code=the-code&state=${state}`, { headers: { cookie } }),
    env,
  );

  assert.equal(response.status, 502);
  assert.equal(await getQueueOwner(db, 'spotify-user'), null);
});
