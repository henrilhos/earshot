import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { type Cipher, cipher, generateSecretKey, migrate } from '../core/index.ts';
import {
  LOCAL_QUEUE_OWNER,
  localQueueOwner,
  requireLocalRefreshToken,
  saveLocalQueueOwner,
  saveLocalRefreshToken,
} from './owner.ts';
import { type LocalDatabase, openDatabase } from './sqlite.ts';

const TOKEN = 'AQD-the-refresh-token';

async function database(t: TestContext): Promise<LocalDatabase> {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  await migrate(db);
  return db;
}

// A throwaway key, so a test never reads or writes the operator's own.
function throwawayCipher(): Promise<Cipher> {
  return cipher(generateSecretKey());
}

test('reads back the refresh token it was given', async (t) => {
  const db = await database(t);
  const sealed = await throwawayCipher();

  await saveLocalQueueOwner(db, sealed, TOKEN);

  assert.equal(await requireLocalRefreshToken(db, sealed), TOKEN);
});

// The point of the whole exercise: a stolen earshot.db is not a stolen Spotify
// account unless the .env came with it.
test('never writes the refresh token to the database in the clear', async (t) => {
  const db = await database(t);
  const sealed = await throwawayCipher();

  await saveLocalQueueOwner(db, sealed, TOKEN);

  const stored = (await localQueueOwner(db))?.refreshToken;
  assert.ok(stored);
  assert.ok(!stored.includes(TOKEN));
});

test('encrypts the rotated token too', async (t) => {
  const db = await database(t);
  const sealed = await throwawayCipher();
  await saveLocalQueueOwner(db, sealed, TOKEN);

  await saveLocalRefreshToken(db, sealed, 'AQD-the-rotated-token');

  assert.equal(await requireLocalRefreshToken(db, sealed), 'AQD-the-rotated-token');
  assert.notEqual((await localQueueOwner(db))?.refreshToken, 'AQD-the-rotated-token');
});

// Losing the key loses the authorization, and `earshot auth` is how it comes
// back. Saying so beats a Spotify request that fails for no stated reason.
test('says the value cannot be read when the key has changed', async (t) => {
  const db = await database(t);
  await saveLocalQueueOwner(db, await throwawayCipher(), TOKEN);

  await assert.rejects(
    requireLocalRefreshToken(db, await throwawayCipher()),
    /wrong encryption key, or the stored value was altered/,
  );
});

test('asks for `earshot auth` when there is no Queue Owner yet', async (t) => {
  const db = await database(t);

  await assert.rejects(requireLocalRefreshToken(db, await throwawayCipher()), /earshot auth/);
  assert.equal(await localQueueOwner(db), null);
});

test('keys the row on the one id a local database has', async (t) => {
  const db = await database(t);
  const sealed = await throwawayCipher();

  await saveLocalQueueOwner(db, sealed, TOKEN);

  const owner = await localQueueOwner(db);
  assert.equal(owner?.spotifyUserId, LOCAL_QUEUE_OWNER);
  // .env supplies the Spotify app on every run, so the row keeps no copy.
  assert.equal(owner?.spotifyApp, null);
});
