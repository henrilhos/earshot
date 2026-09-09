import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import {
  addSubscription,
  cipher,
  type D1Binding,
  type Db,
  generateSecretKey,
  getQueueOwner,
  listDeliveries,
  listSubscribers,
  migrate,
  type Row,
  saveQueueOwner,
  watchAccount,
} from '../../../packages/core/index.ts';
import type { Env } from './env.ts';
import { runInstanceTick } from './tick.ts';

// A real, in-memory database rather than a fake D1: the store's SQL is the
// same either way (ADR-0003), and this test cares whether a poll actually
// lands the Delivery rows it claims to, not whether it can talk to D1.
async function testDb(): Promise<Db> {
  const sqlite = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  const db: Db = {
    all: async (sql, params = []) => sqlite.prepare(sql).all(...params) as Row[],
    run: async (sql, params = []) => Number(sqlite.prepare(sql).run(...params).changes),
  };
  await migrate(db);
  return db;
}

// Never called: runInstanceTick takes the database directly, and this only
// satisfies Env's DB field so the type checks.
const UNUSED_DB: D1Binding = {
  prepare: () => {
    throw new Error('DB should not be reached; runInstanceTick was given a database directly.');
  },
};

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), init);
}

type Requested = { url: string; init: RequestInit };

function fetchStub(log: Requested[]) {
  return async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    log.push({ url: href, init });

    if (href.startsWith('https://ws.audioscrobbler.com')) {
      return json({
        recenttracks: {
          track: [{ name: 'Alright', artist: { '#text': 'Kendrick Lamar' }, '@attr': { nowplaying: 'true' } }],
        },
      });
    }
    if (href.startsWith('https://accounts.spotify.com/api/token')) {
      const auth = (init.headers as Record<string, string>).Authorization;
      return json({ access_token: `access-for(${auth})`, expires_in: 3600 });
    }
    if (href.includes('/me/player/queue')) return new Response(null, { status: 204 });
    if (href.includes('/me/player')) return json({ device: { id: 'laptop' } });
    if (href.includes('/search')) {
      return json({
        tracks: { items: [{ uri: 'spotify:track:alright', name: 'Alright', artists: [{ name: 'Kendrick Lamar' }] }] },
      });
    }
    throw new Error(`Unexpected fetch in test: ${href}`);
  };
}

async function seed(db: Db, secretKey: string) {
  const secretCipher = await cipher(secretKey);

  await saveQueueOwner(db, {
    spotifyUserId: 'brought-own-app',
    displayName: 'Brought Their Own App',
    refreshToken: await secretCipher.encrypt('refresh-own'),
    needsReauthorization: false,
    spotifyApp: { clientId: 'own-client-id', clientSecret: 'own-client-secret' },
  });
  await saveQueueOwner(db, {
    spotifyUserId: 'uses-default-app',
    displayName: 'Uses the Instance App',
    refreshToken: await secretCipher.encrypt('refresh-default'),
    needsReauthorization: false,
    spotifyApp: null,
  });

  await watchAccount(db, { lastfmUsername: 'watched-person', nextPollAt: Date.now() });
  await addSubscription(db, 'brought-own-app', 'watched-person');
  await addSubscription(db, 'uses-default-app', 'watched-person');
}

function environment(secretKey: string): Env {
  return {
    DB: UNUSED_DB,
    LASTFM_API_KEY: 'lastfm-key',
    EARSHOT_SECRET_KEY: secretKey,
    SPOTIFY_CLIENT_ID: 'instance-client-id',
    SPOTIFY_CLIENT_SECRET: 'instance-client-secret',
    SPOTIFY_REDIRECT_URI: 'https://earshot.example/api/auth/callback',
  };
}

test('fans one poll out to a Delivery per Subscriber, each with its own Spotify app', async (t) => {
  const secretKey = generateSecretKey();
  const db = await testDb();
  await seed(db, secretKey);

  const requests: Requested[] = [];
  t.mock.method(globalThis, 'fetch', fetchStub(requests));

  const result = await runInstanceTick(db, environment(secretKey));

  assert.deepEqual(result.polled, ['watched-person']);

  const tokenRequests = requests.filter((r) => r.url.startsWith('https://accounts.spotify.com'));
  const authHeaders = tokenRequests.map((r) => (r.init.headers as Record<string, string>).Authorization).sort();
  assert.deepEqual(authHeaders, [
    `Basic ${btoa('instance-client-id:instance-client-secret')}`,
    `Basic ${btoa('own-client-id:own-client-secret')}`,
  ]);

  const ownDeliveries = await listDeliveries(db, 'brought-own-app', 10);
  const defaultDeliveries = await listDeliveries(db, 'uses-default-app', 10);

  for (const deliveries of [ownDeliveries, defaultDeliveries]) {
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.outcome, 'queued');
    assert.equal(deliveries[0]?.exact, true);
    assert.equal(deliveries[0]?.artist, 'Kendrick Lamar');
    assert.equal(deliveries[0]?.title, 'Alright');
  }
});

test('records no_device for every Subscriber without ever calling the queue endpoint', async (t) => {
  const secretKey = generateSecretKey();
  const db = await testDb();
  await seed(db, secretKey);

  const requests: Requested[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    if (href.includes('/me/player') && !href.includes('/queue')) return new Response(null, { status: 204 });
    return fetchStub(requests)(url, init);
  });

  await runInstanceTick(db, environment(secretKey));

  const ownDeliveries = await listDeliveries(db, 'brought-own-app', 10);
  const defaultDeliveries = await listDeliveries(db, 'uses-default-app', 10);

  assert.equal(ownDeliveries[0]?.outcome, 'no_device');
  assert.equal(defaultDeliveries[0]?.outcome, 'no_device');
  assert.ok(!requests.some((r) => r.url.includes('/queue')));
});

test('one Subscriber whose queue attempt fails still leaves the other Delivered', async (t) => {
  const secretKey = generateSecretKey();
  const db = await testDb();
  await seed(db, secretKey);

  // The Bearer token is the Basic auth header from the refresh, folded into
  // the fake access token by fetchStub, so it still says which owner's app
  // refreshed it.
  const ownBasicAuth = `Basic ${btoa('own-client-id:own-client-secret')}`;

  const requests: Requested[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    if (href.includes('/me/player/queue')) {
      const auth = (init.headers as Record<string, string>).Authorization ?? '';
      if (auth.includes(ownBasicAuth)) return new Response('nope', { status: 403 });
    }
    return fetchStub(requests)(url, init);
  });

  await runInstanceTick(db, environment(secretKey));

  const ownDeliveries = await listDeliveries(db, 'brought-own-app', 10);
  const defaultDeliveries = await listDeliveries(db, 'uses-default-app', 10);

  assert.equal(ownDeliveries[0]?.outcome, 'error');
  assert.match(ownDeliveries[0]?.errorMessage ?? '', /403/);
  assert.equal(defaultDeliveries[0]?.outcome, 'queued');
});

test('parks a Queue Owner whose Spotify grant died and stops scheduling them', async (t) => {
  const secretKey = generateSecretKey();
  const db = await testDb();
  await seed(db, secretKey);

  const ownBasicAuth = `Basic ${btoa('own-client-id:own-client-secret')}`;

  const requests: Requested[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    if (href.startsWith('https://accounts.spotify.com/api/token')) {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === ownBasicAuth) return json({ error: 'invalid_grant' }, { status: 400 });
    }
    return fetchStub(requests)(url, init);
  });

  await runInstanceTick(db, environment(secretKey));

  const ownDeliveries = await listDeliveries(db, 'brought-own-app', 10);
  const defaultDeliveries = await listDeliveries(db, 'uses-default-app', 10);

  assert.equal(ownDeliveries[0]?.outcome, 'unauthorized');
  assert.match(ownDeliveries[0]?.errorMessage ?? '', /invalid_grant/);
  assert.equal(defaultDeliveries[0]?.outcome, 'queued');

  // Parked immediately, without waiting for a second failed tick.
  assert.equal((await getQueueOwner(db, 'brought-own-app'))?.needsReauthorization, true);

  // And the next poll's fan-out no longer spends a refresh call on them.
  assert.deepEqual(
    (await listSubscribers(db, 'watched-person')).map((owner) => owner.spotifyUserId),
    ['uses-default-app'],
  );
});
