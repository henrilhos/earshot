import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { claimNowPlaying, getWatchedAccount, listSubscriptions, migrate } from '../core/index.ts';
import { importJsonFiles } from './legacy.ts';
import { LOCAL_QUEUE_OWNER, localQueueOwner } from './owner.ts';
import { type LocalDatabase, openDatabase } from './sqlite.ts';

const TOKENS = { access_token: 'expired', refresh_token: 'the-refresh-token', expires_in: 3600 };

type Files = { stateFile: string; tokensFile: string };

// The files land in a temp directory rather than the working one, so a test
// run never reads or writes the state of whoever is running it.
function files(t: TestContext, contents: { state?: unknown; tokens?: unknown }): Files {
  const dir = mkdtempSync(join(tmpdir(), 'earshot-'));
  const paths = { stateFile: join(dir, 'state.json'), tokensFile: join(dir, 'tokens.json') };

  if (contents.state !== undefined) writeFileSync(paths.stateFile, JSON.stringify(contents.state));
  if (contents.tokens !== undefined) writeFileSync(paths.tokensFile, JSON.stringify(contents.tokens));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  return paths;
}

async function database(t: TestContext): Promise<LocalDatabase> {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  await migrate(db);
  return db;
}

test('imports the users map as one Watched Account each, carrying the last-seen key', async (t) => {
  const db = await database(t);
  const paths = files(t, {
    state: { users: { someone: 'kendrick lamar|||alright', someone_else: 'sza|||snooze' } },
    tokens: TOKENS,
  });

  const imported = await importJsonFiles(db, { watchedAccount: 'someone', ...paths });

  assert.deepEqual(imported.watchedAccounts, ['someone', 'someone_else']);
  assert.equal((await getWatchedAccount(db, 'someone'))?.lastNowPlayingKey, 'kendrick lamar|||alright');
  assert.equal((await getWatchedAccount(db, 'someone_else'))?.lastNowPlayingKey, 'sza|||snooze');
});

test('subscribes the local Queue Owner to everyone the file was watching', async (t) => {
  const db = await database(t);
  const paths = files(t, { state: { users: { someone: 'kendrick lamar|||alright' } }, tokens: TOKENS });

  await importJsonFiles(db, { watchedAccount: 'someone', ...paths });

  assert.deepEqual(await listSubscriptions(db, LOCAL_QUEUE_OWNER), [
    { queueOwnerId: LOCAL_QUEUE_OWNER, watchedAccountId: 'someone' },
  ]);
});

test('imports a bare lastKey as the account being watched', async (t) => {
  const db = await database(t);
  const paths = files(t, { state: { lastKey: 'kendrick lamar|||alright' }, tokens: TOKENS });

  await importJsonFiles(db, { watchedAccount: 'someone', ...paths });

  assert.equal((await getWatchedAccount(db, 'someone'))?.lastNowPlayingKey, 'kendrick lamar|||alright');
});

test('imports the refresh token as the local Queue Owner', async (t) => {
  const db = await database(t);
  const paths = files(t, { tokens: TOKENS });

  const imported = await importJsonFiles(db, { watchedAccount: 'someone', ...paths });

  assert.equal(imported.queueOwner, true);
  assert.equal((await localQueueOwner(db))?.refreshToken, 'the-refresh-token');
});

test('leaves both files where it found them', async (t) => {
  const db = await database(t);
  const paths = files(t, { state: { users: { someone: 'kendrick lamar|||alright' } }, tokens: TOKENS });

  await importJsonFiles(db, { watchedAccount: 'someone', ...paths });

  assert.ok(existsSync(paths.stateFile));
  assert.ok(existsSync(paths.tokensFile));
});

// The files stay on disk, so every later run reads them again and has to leave
// the store alone.
test('never imports over what the store already knows', async (t) => {
  const db = await database(t);
  const paths = files(t, { state: { users: { someone: 'kendrick lamar|||alright' } }, tokens: TOKENS });

  await importJsonFiles(db, { watchedAccount: 'someone', ...paths });
  await claimNowPlaying(db, 'someone', 'sza|||snooze');
  const again = await importJsonFiles(db, { watchedAccount: 'someone', ...paths });

  assert.deepEqual(again, { queueOwner: false, watchedAccounts: [] });
  assert.equal((await getWatchedAccount(db, 'someone'))?.lastNowPlayingKey, 'sza|||snooze');
});

// Whoever has a state.json has a tokens.json too, so this only happens when
// the token is gone. There is nobody to subscribe the accounts to yet.
test('waits for an authorization before importing Watched Accounts', async (t) => {
  const db = await database(t);
  const paths = files(t, { state: { users: { someone: 'kendrick lamar|||alright' } } });

  const imported = await importJsonFiles(db, { watchedAccount: 'someone', ...paths });

  assert.deepEqual(imported, { queueOwner: false, watchedAccounts: [] });
  assert.equal(await getWatchedAccount(db, 'someone'), null);
});

test('imports nothing when there are no files to import', async (t) => {
  const db = await database(t);
  const paths = files(t, {});

  const imported = await importJsonFiles(db, { watchedAccount: 'someone', ...paths });

  assert.deepEqual(imported, { queueOwner: false, watchedAccounts: [] });
  assert.equal(await localQueueOwner(db), null);
});
