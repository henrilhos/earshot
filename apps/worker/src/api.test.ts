import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import {
  cipher,
  type D1Binding,
  type D1Statement,
  type Db,
  generateSecretKey,
  listSubscriptions,
  migrate,
  recordDelivery,
  type Row,
  saveQueueOwner,
  type SqlValue,
} from '../../../packages/core/index.ts';
import type { Env } from './env.ts';
import worker from './index.ts';
import { sessionCookie } from './session.ts';

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

async function seedOwner(db: Db, spotifyUserId: string, needsReauthorization = false): Promise<void> {
  await saveQueueOwner(db, {
    spotifyUserId,
    displayName: `Display Name for ${spotifyUserId}`,
    refreshToken: 'irrelevant-for-these-tests',
    needsReauthorization,
    spotifyApp: null,
  });
}

async function cookieFor(spotifyUserId: string): Promise<string> {
  const secretCipher = await cipher(SECRET_KEY);
  return (await sessionCookie(secretCipher, spotifyUserId)).split(';')[0]!;
}

function request(url: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, headers, ...rest } = init;
  return new Request(url, {
    ...rest,
    headers: { ...(headers as Record<string, string>), ...(cookie ? { cookie } : {}) },
  });
}

// Session --------------------------------------------------------------------

test('GET /api/session answers with the signed-in Queue Owner', async () => {
  const { db, binding } = await testDb();
  await seedOwner(db, 'owner-1');
  const cookie = await cookieFor('owner-1');

  const response = await worker.fetch(request('https://earshot.example/api/session', { cookie }), environment(binding));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    spotifyUserId: 'owner-1',
    displayName: 'Display Name for owner-1',
    needsReauthorization: false,
  });
});

test('GET /api/session is 401 with no cookie', async () => {
  const { binding } = await testDb();
  const response = await worker.fetch(new Request('https://earshot.example/api/session'), environment(binding));
  assert.equal(response.status, 401);
});

test('GET /api/session is 401 for a cookie naming a Queue Owner who no longer exists', async () => {
  const { binding } = await testDb();
  const cookie = await cookieFor('long-gone');

  const response = await worker.fetch(request('https://earshot.example/api/session', { cookie }), environment(binding));

  assert.equal(response.status, 401);
});

test('GET /api/session is 401 for a tampered cookie', async () => {
  const { binding } = await testDb();
  const response = await worker.fetch(
    request('https://earshot.example/api/session', { cookie: 'session=not-a-real-ciphertext' }),
    environment(binding),
  );
  assert.equal(response.status, 401);
});

test('DELETE /api/session clears the cookie', async () => {
  const { db, binding } = await testDb();
  await seedOwner(db, 'owner-1');
  const cookie = await cookieFor('owner-1');

  const response = await worker.fetch(
    request('https://earshot.example/api/session', { method: 'DELETE', cookie }),
    environment(binding),
  );

  assert.equal(response.status, 204);
  const cleared = response.headers.getSetCookie().find((c) => c.startsWith('session='));
  assert.ok(cleared?.includes('Max-Age=0'));
});

test('/api/session refuses methods other than GET and DELETE', async () => {
  const { binding } = await testDb();
  const response = await worker.fetch(
    new Request('https://earshot.example/api/session', { method: 'POST' }),
    environment(binding),
  );
  assert.equal(response.status, 405);
});

// Subscriptions ----------------------------------------------------------------

test('POST /api/subscriptions creates a Watched Account and Subscription, then GET lists it', async () => {
  const { db, binding } = await testDb();
  await seedOwner(db, 'owner-1');
  const env = environment(binding);
  const cookie = await cookieFor('owner-1');

  const created = await worker.fetch(
    request('https://earshot.example/api/subscriptions', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastfmUsername: 'their-lastfm-name' }),
    }),
    env,
  );

  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { queueOwnerId: 'owner-1', watchedAccountId: 'their-lastfm-name' });

  const listed = await worker.fetch(request('https://earshot.example/api/subscriptions', { cookie }), env);
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), [{ queueOwnerId: 'owner-1', watchedAccountId: 'their-lastfm-name' }]);
});

test('POST /api/subscriptions rejects a missing lastfmUsername', async () => {
  const { db, binding } = await testDb();
  await seedOwner(db, 'owner-1');
  const cookie = await cookieFor('owner-1');

  const response = await worker.fetch(
    request('https://earshot.example/api/subscriptions', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
    environment(binding),
  );

  assert.equal(response.status, 400);
});

test('subscriptions endpoints are 401 without a session', async () => {
  const { binding } = await testDb();
  const env = environment(binding);

  assert.equal((await worker.fetch(new Request('https://earshot.example/api/subscriptions'), env)).status, 401);
  assert.equal(
    (
      await worker.fetch(
        new Request('https://earshot.example/api/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ lastfmUsername: 'x' }),
        }),
        env,
      )
    ).status,
    401,
  );
  assert.equal(
    (await worker.fetch(new Request('https://earshot.example/api/subscriptions/x', { method: 'DELETE' }), env)).status,
    401,
  );
});

test('DELETE /api/subscriptions/:lastfmUsername removes only that Subscription', async () => {
  const { db, binding } = await testDb();
  await seedOwner(db, 'owner-1');
  const env = environment(binding);
  const cookie = await cookieFor('owner-1');

  await worker.fetch(
    request('https://earshot.example/api/subscriptions', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastfmUsername: 'keep-me' }),
    }),
    env,
  );
  await worker.fetch(
    request('https://earshot.example/api/subscriptions', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastfmUsername: 'remove-me' }),
    }),
    env,
  );

  const deleted = await worker.fetch(
    request('https://earshot.example/api/subscriptions/remove-me', { method: 'DELETE', cookie }),
    env,
  );
  assert.equal(deleted.status, 204);

  assert.deepEqual(
    (await listSubscriptions(db, 'owner-1')).map((s) => s.watchedAccountId),
    ['keep-me'],
  );
});

test('a Subscription belonging to another Queue Owner is not deletable through this endpoint', async () => {
  const { db, binding } = await testDb();
  await seedOwner(db, 'owner-1');
  await seedOwner(db, 'owner-2');
  const env = environment(binding);

  await worker.fetch(
    request('https://earshot.example/api/subscriptions', {
      method: 'POST',
      cookie: await cookieFor('owner-1'),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastfmUsername: 'shared-watched-account' }),
    }),
    env,
  );

  await worker.fetch(
    request('https://earshot.example/api/subscriptions/shared-watched-account', {
      method: 'DELETE',
      cookie: await cookieFor('owner-2'),
    }),
    env,
  );

  assert.deepEqual(
    (await listSubscriptions(db, 'owner-1')).map((s) => s.watchedAccountId),
    ['shared-watched-account'],
  );
});

// Deliveries -------------------------------------------------------------------

test('GET /api/deliveries answers only the signed-in Queue Owner\'s history, newest first', async () => {
  const { db, binding } = await testDb();
  await seedOwner(db, 'owner-1');
  await seedOwner(db, 'owner-2');
  await worker.fetch(
    request('https://earshot.example/api/subscriptions', {
      method: 'POST',
      cookie: await cookieFor('owner-1'),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastfmUsername: 'watched' }),
    }),
    environment(binding),
  );
  await worker.fetch(
    request('https://earshot.example/api/subscriptions', {
      method: 'POST',
      cookie: await cookieFor('owner-2'),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastfmUsername: 'watched' }),
    }),
    environment(binding),
  );

  await recordDelivery(db, {
    queueOwnerId: 'owner-1',
    watchedAccountId: 'watched',
    artist: 'Kendrick Lamar',
    title: 'Alright',
    outcome: 'queued',
    exact: true,
    errorMessage: null,
    createdAt: 1,
  });
  await recordDelivery(db, {
    queueOwnerId: 'owner-1',
    watchedAccountId: 'watched',
    artist: 'Kendrick Lamar',
    title: 'DUCKWORTH.',
    outcome: 'no_device',
    exact: null,
    errorMessage: null,
    createdAt: 2,
  });
  await recordDelivery(db, {
    queueOwnerId: 'owner-2',
    watchedAccountId: 'watched',
    artist: 'Kendrick Lamar',
    title: 'Alright',
    outcome: 'queued',
    exact: true,
    errorMessage: null,
    createdAt: 1,
  });

  const response = await worker.fetch(
    request('https://earshot.example/api/deliveries', { cookie: await cookieFor('owner-1') }),
    environment(binding),
  );

  assert.equal(response.status, 200);
  const deliveries = (await response.json()) as { title: string }[];
  assert.deepEqual(
    deliveries.map((d) => d.title),
    ['DUCKWORTH.', 'Alright'],
  );
});

test('GET /api/deliveries honors a limit query parameter', async () => {
  const { db, binding } = await testDb();
  await seedOwner(db, 'owner-1');
  await worker.fetch(
    request('https://earshot.example/api/subscriptions', {
      method: 'POST',
      cookie: await cookieFor('owner-1'),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastfmUsername: 'watched' }),
    }),
    environment(binding),
  );

  for (let i = 0; i < 3; i++) {
    await recordDelivery(db, {
      queueOwnerId: 'owner-1',
      watchedAccountId: 'watched',
      artist: 'Artist',
      title: `Track ${i}`,
      outcome: 'queued',
      exact: true,
      errorMessage: null,
      createdAt: i,
    });
  }

  const response = await worker.fetch(
    request('https://earshot.example/api/deliveries?limit=1', { cookie: await cookieFor('owner-1') }),
    environment(binding),
  );

  const deliveries = (await response.json()) as unknown[];
  assert.equal(deliveries.length, 1);
});

test('GET /api/deliveries is 401 without a session', async () => {
  const { binding } = await testDb();
  const response = await worker.fetch(new Request('https://earshot.example/api/deliveries'), environment(binding));
  assert.equal(response.status, 401);
});
