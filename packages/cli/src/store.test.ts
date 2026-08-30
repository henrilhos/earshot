import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import {
  addSubscription,
  claimDueAccounts,
  claimNowPlaying,
  createCliToken,
  type Delivery,
  deleteQueueOwner,
  forgetUnwatchedAccounts,
  getQueueOwner,
  getWatchedAccount,
  listCliTokens,
  listDeliveries,
  listSubscribers,
  listSubscriptions,
  migrate,
  type QueueOwner,
  queueOwnerForToken,
  recordDelivery,
  removeSubscription,
  saveQueueOwner,
  saveRefreshToken,
  setNeedsReauthorization,
  watchAccount,
} from '../core/index.ts';
import { type LocalDatabase, openDatabase } from './sqlite.ts';

const OWNER: QueueOwner = {
  spotifyUserId: 'queue-owner',
  displayName: 'Queue Owner',
  refreshToken: 'encrypted-refresh-token',
  needsReauthorization: false,
  spotifyApp: null,
};

const DELIVERY: Omit<Delivery, 'id'> = {
  queueOwnerId: OWNER.spotifyUserId,
  watchedAccountId: 'someone',
  artist: 'Kendrick Lamar',
  title: 'Alright',
  outcome: 'queued',
  exact: true,
  errorMessage: null,
  createdAt: 1_700_000_000_000,
};

// The schema and the queries are the core's; only the driver under them is the
// CLI's, so this is where both get exercised against real SQLite.
async function database(t: TestContext): Promise<LocalDatabase> {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  await migrate(db);
  return db;
}

// A Subscription, and the two rows a Delivery needs to hang off.
async function subscribed(db: LocalDatabase, owner: QueueOwner = OWNER): Promise<void> {
  await saveQueueOwner(db, owner);
  await watchAccount(db, { lastfmUsername: 'someone', nextPollAt: 0 });
  await addSubscription(db, owner.spotifyUserId, 'someone');
}

test('round-trips a Queue Owner on the Instance app', async (t) => {
  const db = await database(t);

  await saveQueueOwner(db, OWNER);

  assert.deepEqual(await getQueueOwner(db, 'queue-owner'), OWNER);
});

test('keeps the Spotify app a Queue Owner brought', async (t) => {
  const db = await database(t);
  const byo = { ...OWNER, spotifyApp: { clientId: 'their-id', clientSecret: 'their-secret' } };

  await saveQueueOwner(db, byo);

  assert.deepEqual((await getQueueOwner(db, 'queue-owner'))?.spotifyApp, byo.spotifyApp);
});

test('refuses half a Spotify app', async (t) => {
  const db = await database(t);

  await assert.rejects(
    db.run(
      `INSERT INTO queue_owner (spotify_user_id, display_name, refresh_token, spotify_client_id)
       VALUES (?, ?, ?, ?)`,
      ['half', 'Half', 'token', 'id-without-a-secret'],
    ),
    /CHECK constraint failed/,
  );
});

test('signing in again replaces the refresh token', async (t) => {
  const db = await database(t);

  await saveQueueOwner(db, OWNER);
  await saveRefreshToken(db, 'queue-owner', 'rotated');

  assert.equal((await getQueueOwner(db, 'queue-owner'))?.refreshToken, 'rotated');
});

test('parks a Queue Owner whose grant died', async (t) => {
  const db = await database(t);

  await saveQueueOwner(db, OWNER);
  await setNeedsReauthorization(db, 'queue-owner', true);

  assert.equal((await getQueueOwner(db, 'queue-owner'))?.needsReauthorization, true);
});

test('reports nothing for a Queue Owner who never signed in', async (t) => {
  const db = await database(t);

  assert.equal(await getQueueOwner(db, 'stranger'), null);
});

test('leaves an already watched account on its own schedule', async (t) => {
  const db = await database(t);

  await watchAccount(db, { lastfmUsername: 'someone', nextPollAt: 100 });
  await claimNowPlaying(db, 'someone', 'kendrick lamar|||alright');
  await watchAccount(db, { lastfmUsername: 'someone', nextPollAt: 999 });

  assert.deepEqual(await getWatchedAccount(db, 'someone'), {
    lastfmUsername: 'someone',
    lastNowPlayingKey: 'kendrick lamar|||alright',
    nextPollAt: 100,
  });
});

test('lets exactly one caller claim a now playing track', async (t) => {
  const db = await database(t);
  await watchAccount(db, { lastfmUsername: 'someone', nextPollAt: 0 });

  assert.equal(await claimNowPlaying(db, 'someone', 'kendrick lamar|||alright'), true);
  assert.equal(await claimNowPlaying(db, 'someone', 'kendrick lamar|||alright'), false);
  assert.equal(await claimNowPlaying(db, 'someone', 'kendrick lamar|||dna'), true);
});

test('claims nothing for an account nobody watches', async (t) => {
  const db = await database(t);

  assert.equal(await claimNowPlaying(db, 'someone', 'kendrick lamar|||alright'), false);
});

test('claims only the Watched Accounts that are due', async (t) => {
  const db = await database(t);
  await watchAccount(db, { lastfmUsername: 'due', nextPollAt: 1_000 });
  await watchAccount(db, { lastfmUsername: 'exactly-due', nextPollAt: 2_000 });
  await watchAccount(db, { lastfmUsername: 'later', nextPollAt: 2_001 });

  const claimed = await claimDueAccounts(db, { now: 2_000, nextPollAt: 62_000 });

  assert.deepEqual(
    claimed.map((watched) => watched.lastfmUsername),
    ['due', 'exactly-due'],
  );
  assert.equal((await getWatchedAccount(db, 'later'))?.nextPollAt, 2_001);
});

test('stamps the next poll in the same statement that claims the account', async (t) => {
  const db = await database(t);
  await watchAccount(db, { lastfmUsername: 'someone', nextPollAt: 0 });
  await claimNowPlaying(db, 'someone', 'kendrick lamar|||alright');

  const [claimed] = await claimDueAccounts(db, { now: 2_000, nextPollAt: 62_000 });

  // The last-seen key is what the poll needs, and the schedule has already
  // moved on without waiting to hear how the poll went.
  assert.deepEqual(claimed, {
    lastfmUsername: 'someone',
    lastNowPlayingKey: 'kendrick lamar|||alright',
    nextPollAt: 62_000,
  });
});

// The Cron Trigger and POST /api/tick can overlap, and two ticks that both
// acted on one Watched Account would queue the same track twice.
test('lets exactly one overlapping tick claim a due Watched Account', async (t) => {
  const db = await database(t);
  await watchAccount(db, { lastfmUsername: 'someone', nextPollAt: 0 });

  const first = await claimDueAccounts(db, { now: 2_000, nextPollAt: 62_000 });
  const second = await claimDueAccounts(db, { now: 2_000, nextPollAt: 62_000 });

  assert.equal(first.length, 1);
  assert.deepEqual(second, []);
});

test('fans one Watched Account out to every subscriber', async (t) => {
  const db = await database(t);
  await subscribed(db);
  await subscribed(db, { ...OWNER, spotifyUserId: 'other-owner', displayName: 'Other' });

  const subscribers = await listSubscribers(db, 'someone');

  assert.deepEqual(
    subscribers.map((owner) => owner.spotifyUserId),
    ['other-owner', 'queue-owner'],
  );
});

test('subscribing twice is the same Subscription', async (t) => {
  const db = await database(t);
  await subscribed(db);

  await addSubscription(db, 'queue-owner', 'someone');

  assert.deepEqual(await listSubscriptions(db, 'queue-owner'), [
    { queueOwnerId: 'queue-owner', watchedAccountId: 'someone' },
  ]);
});

test('drops Watched Accounts nobody subscribes to', async (t) => {
  const db = await database(t);
  await subscribed(db);
  await watchAccount(db, { lastfmUsername: 'abandoned', nextPollAt: 0 });

  await forgetUnwatchedAccounts(db);

  assert.notEqual(await getWatchedAccount(db, 'someone'), null);
  assert.equal(await getWatchedAccount(db, 'abandoned'), null);
});

test('records a Delivery and reads it back newest first', async (t) => {
  const db = await database(t);
  await subscribed(db);

  await recordDelivery(db, DELIVERY);
  await recordDelivery(db, {
    ...DELIVERY,
    title: 'DNA.',
    outcome: 'no_device',
    exact: null,
    createdAt: DELIVERY.createdAt + 1,
  });

  const deliveries = await listDeliveries(db, 'queue-owner', 10);

  assert.deepEqual(
    deliveries.map((delivery) => [delivery.title, delivery.outcome, delivery.exact]),
    [
      ['DNA.', 'no_device', null],
      ['Alright', 'queued', true],
    ],
  );
});

test('remembers a queued track was the fallback rather than an exact match', async (t) => {
  const db = await database(t);
  await subscribed(db);

  await recordDelivery(db, { ...DELIVERY, exact: false });

  assert.equal((await listDeliveries(db, 'queue-owner', 10))[0]?.exact, false);
});

test('records why a Delivery failed', async (t) => {
  const db = await database(t);
  await subscribed(db);

  await recordDelivery(db, {
    ...DELIVERY,
    outcome: 'error',
    exact: null,
    errorMessage: 'Failed to queue track (404)',
  });

  assert.equal((await listDeliveries(db, 'queue-owner', 10))[0]?.errorMessage, 'Failed to queue track (404)');
});

test('refuses an Outcome that is not one of the five', async (t) => {
  const db = await database(t);
  await subscribed(db);

  await assert.rejects(
    recordDelivery(db, { ...DELIVERY, outcome: 'duplicate' as never, exact: null }),
    /CHECK constraint failed/,
  );
});

test('refuses a Delivery without a Subscription behind it', async (t) => {
  const db = await database(t);
  await saveQueueOwner(db, OWNER);

  await assert.rejects(recordDelivery(db, DELIVERY), /FOREIGN KEY constraint failed/);
});

test('unsubscribing takes that history with it', async (t) => {
  const db = await database(t);
  await subscribed(db);
  await recordDelivery(db, DELIVERY);

  await removeSubscription(db, 'queue-owner', 'someone');

  assert.deepEqual(await listDeliveries(db, 'queue-owner', 10), []);
});

test('removing a Queue Owner removes their rows, tokens and Subscriptions', async (t) => {
  const db = await database(t);
  await subscribed(db);
  await recordDelivery(db, DELIVERY);
  await createCliToken(db, {
    id: 'token-1',
    queueOwnerId: 'queue-owner',
    tokenHash: 'hash-1',
    createdAt: 1,
  });

  await deleteQueueOwner(db, 'queue-owner');

  assert.equal(await getQueueOwner(db, 'queue-owner'), null);
  assert.deepEqual(await listSubscriptions(db, 'queue-owner'), []);
  assert.deepEqual(await listDeliveries(db, 'queue-owner', 10), []);
  assert.deepEqual(await listCliTokens(db, 'queue-owner'), []);
  // The Watched Account survives: someone else may still be watching them.
  assert.notEqual(await getWatchedAccount(db, 'someone'), null);
});

test('speaks for the Queue Owner a CLI token belongs to', async (t) => {
  const db = await database(t);
  await saveQueueOwner(db, OWNER);
  await createCliToken(db, {
    id: 'token-1',
    queueOwnerId: 'queue-owner',
    tokenHash: 'hash-1',
    createdAt: 1,
  });

  assert.deepEqual(await queueOwnerForToken(db, 'hash-1'), OWNER);
  assert.equal(await queueOwnerForToken(db, 'hash-2'), null);
});
