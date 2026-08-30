import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addSubscription,
  claimDueAccounts,
  claimNowPlaying,
  createCliToken,
  type Db,
  type D1Binding,
  type D1Statement,
  d1Db,
  listDeliveries,
  listSubscribers,
  migrate,
  queueOwnerForToken,
  recordDelivery,
  SCHEMA,
  saveQueueOwner,
  setNeedsReauthorization,
  type SqlValue,
  watchAccount,
} from '../core/index.ts';
import { openDatabase } from './sqlite.ts';

type Executed = { sql: string; params: SqlValue[] };

function recording(db: Db, log: Executed[]): Db {
  return {
    all: (sql, params = []) => {
      log.push({ sql, params });
      return db.all(sql, params);
    },
    run: (sql, params = []) => {
      log.push({ sql, params });
      return db.run(sql, params);
    },
  };
}

// Records what the Worker's binding is handed, and answers the way D1 does.
function fakeD1(log: Executed[], results: unknown[] = [], changes = 0): D1Binding {
  return {
    prepare(sql) {
      let params: SqlValue[] = [];
      const statement: D1Statement = {
        bind(...bound) {
          params = bound;
          return statement;
        },
        all: async () => {
          log.push({ sql, params });
          return { results };
        },
        run: async () => {
          log.push({ sql, params });
          return { meta: { changes } };
        },
      };
      return statement;
    },
  };
}

// Every table, read and written, so nothing the store says goes unrecorded.
async function everything(db: Db): Promise<void> {
  await migrate(db);
  await saveQueueOwner(db, {
    spotifyUserId: 'queue-owner',
    displayName: 'Queue Owner',
    refreshToken: 'encrypted-refresh-token',
    needsReauthorization: false,
    spotifyApp: null,
  });
  await setNeedsReauthorization(db, 'queue-owner', true);
  await watchAccount(db, { lastfmUsername: 'someone', nextPollAt: 0 });
  await addSubscription(db, 'queue-owner', 'someone');
  await claimNowPlaying(db, 'someone', 'kendrick lamar|||alright');
  await claimDueAccounts(db, { now: 1, nextPollAt: 60_001 });
  await listSubscribers(db, 'someone');
  await recordDelivery(db, {
    queueOwnerId: 'queue-owner',
    watchedAccountId: 'someone',
    artist: 'Kendrick Lamar',
    title: 'Alright',
    outcome: 'queued',
    exact: true,
    errorMessage: null,
    createdAt: 1_700_000_000_000,
  });
  await listDeliveries(db, 'queue-owner', 10);
  await createCliToken(db, {
    id: 'token-1',
    queueOwnerId: 'queue-owner',
    tokenHash: 'hash-1',
    createdAt: 1,
  });
  await queueOwnerForToken(db, 'hash-1');
}

// The whole point of two drivers over one schema: the CLI and the Instance run
// the same statements, and only the execution underneath them differs.
test('both drivers are handed character-identical SQL', async (t) => {
  const local: Executed[] = [];
  const worker: Executed[] = [];

  const db = openDatabase(':memory:');
  t.after(() => db.close());

  await everything(recording(db, local));
  await everything(d1Db(fakeD1(worker)));

  assert.deepEqual(worker, local);
  // A driver that silently ran nothing would also pass a comparison of two
  // empty logs.
  assert.ok(local.length > SCHEMA.length);
});

test('the D1 driver reads rows out of the binding', async () => {
  const db = d1Db(fakeD1([], [{ spotify_user_id: 'queue-owner' }]));

  assert.deepEqual(await db.all('SELECT * FROM queue_owner'), [{ spotify_user_id: 'queue-owner' }]);
});

test('the D1 driver reports rows changed, so a conditional claim can be lost', async () => {
  const log: Executed[] = [];

  assert.equal(await d1Db(fakeD1(log, [], 1)).run('UPDATE watched_account SET next_poll_at = 1'), 1);
  assert.equal(await d1Db(fakeD1(log)).run('UPDATE watched_account SET next_poll_at = 1'), 0);
});

test('the D1 driver leaves a parameterless statement unbound', async () => {
  const bound: SqlValue[][] = [];
  const binding: D1Binding = {
    prepare: () => {
      const statement: D1Statement = {
        bind(...params) {
          bound.push(params);
          return statement;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      };
      return statement;
    },
  };

  await d1Db(binding).all('SELECT * FROM queue_owner');

  assert.deepEqual(bound, []);
});
