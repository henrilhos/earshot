import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NowPlaying } from './lastfm.ts';
import type { TrackMatch } from './spotify.ts';
import { type DeliveryAttempt, type Subscriber, type SyncDeps, tick } from './sync.ts';

const NOW_PLAYING: NowPlaying = { artist: 'Kendrick Lamar', title: 'Alright' };

const MATCH: TrackMatch = {
  track: { uri: 'spotify:track:alright', name: 'Alright', artists: [{ name: 'Kendrick Lamar' }] },
  exact: true,
};

function subscriber(queueOwnerId: string, overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    queueOwnerId,
    hasActiveDevice: async () => true,
    findTrack: async () => MATCH,
    queueTrack: async () => {},
    ...overrides,
  };
}

type Recorded = {
  polled: string[];
  claimed: string[];
  delivered: DeliveryAttempt[];
  logs: string[];
};

function harness(subscribers: Subscriber[], overrides: Partial<SyncDeps> = {}) {
  const calls: Recorded = { polled: [], claimed: [], delivered: [], logs: [] };

  const deps: SyncDeps = {
    watchedAccount: 'someone',
    nowPlaying: async (account) => {
      calls.polled.push(account);
      return NOW_PLAYING;
    },
    claim: async (key) => {
      calls.claimed.push(key);
      return true;
    },
    subscribers: async () => subscribers,
    recordDelivery: async (delivery) => {
      calls.delivered.push(delivery);
    },
    log: (message) => {
      calls.logs.push(message);
    },
    ...overrides,
  };

  return { deps, calls };
}

test('queues the match for a new now playing track', async () => {
  const { deps, calls } = harness([subscriber('owner-1')]);

  await tick(deps);

  assert.deepEqual(calls.polled, ['someone']);
  assert.deepEqual(calls.claimed, ['kendrick lamar|||alright']);
  assert.deepEqual(calls.delivered, [
    {
      queueOwnerId: 'owner-1',
      artist: 'Kendrick Lamar',
      title: 'Alright',
      outcome: 'queued',
      exact: true,
      errorMessage: null,
    },
  ]);
  assert.match(calls.logs.at(-1) ?? '', /^QUEUED: "Alright" by Kendrick Lamar \(spotify:track:alright\) - owner-1$/);
});

test('fans one poll out to every Subscriber, one Delivery each', async () => {
  const queued: string[] = [];
  const { deps, calls } = harness([
    subscriber('owner-1', {
      queueTrack: async (uri) => {
        queued.push(`owner-1:${uri}`);
      },
    }),
    subscriber('owner-2', {
      findTrack: async () => ({ track: { ...MATCH.track, uri: 'spotify:track:fallback' }, exact: false }),
      queueTrack: async (uri) => {
        queued.push(`owner-2:${uri}`);
      },
    }),
  ]);

  await tick(deps);

  // One Last.fm request no matter how many Subscribers fan out from it.
  assert.deepEqual(calls.polled, ['someone']);
  assert.deepEqual(queued, ['owner-1:spotify:track:alright', 'owner-2:spotify:track:fallback']);
  assert.deepEqual(
    calls.delivered.map((d) => [d.queueOwnerId, d.outcome, d.exact]),
    [
      ['owner-1', 'queued', true],
      ['owner-2', 'queued', false],
    ],
  );
});

test('does nothing when the watched account is not listening', async () => {
  const { deps, calls } = harness([subscriber('owner-1')], { nowPlaying: async () => null });

  await tick(deps);

  assert.deepEqual(calls.claimed, []);
  assert.deepEqual(calls.delivered, []);
  assert.deepEqual(calls.logs, []);
});

test('reports a failed Last.fm poll and leaves every Subscriber alone', async () => {
  const { deps, calls } = harness([subscriber('owner-1')], {
    nowPlaying: async () => {
      throw new Error('rate limited');
    },
  });

  await tick(deps);

  assert.deepEqual(calls.logs, ['Last.fm poll failed: rate limited']);
  assert.deepEqual(calls.claimed, []);
  assert.deepEqual(calls.delivered, []);
});

test('stays quiet and never asks who is subscribed when the track was already claimed', async () => {
  let askedSubscribers = false;
  const { deps, calls } = harness([subscriber('owner-1')], {
    claim: async () => false,
    subscribers: async () => {
      askedSubscribers = true;
      return [subscriber('owner-1')];
    },
  });

  await tick(deps);

  assert.equal(askedSubscribers, false);
  assert.deepEqual(calls.delivered, []);
  assert.deepEqual(calls.logs, []);
});

test('skips the track when it cannot be recorded, without fanning out', async () => {
  const { deps, calls } = harness([subscriber('owner-1')], {
    claim: async () => {
      throw new Error('locked');
    },
  });

  await tick(deps);

  assert.deepEqual(calls.logs, ['Could not record "Alright" by Kendrick Lamar, skipping it: locked']);
  assert.deepEqual(calls.delivered, []);
});

test('records no_device when a Subscriber has no active Spotify device', async () => {
  const { deps, calls } = harness([subscriber('owner-1', { hasActiveDevice: async () => false })]);

  await tick(deps);

  assert.deepEqual(calls.delivered, [
    { queueOwnerId: 'owner-1', artist: 'Kendrick Lamar', title: 'Alright', outcome: 'no_device', exact: null, errorMessage: null },
  ]);
  assert.match(
    calls.logs.at(-1) ?? '',
    /^SKIPPED \(no active Spotify device\/session open\) - "Alright" by Kendrick Lamar - owner-1$/,
  );
});

test('records no_match when Spotify does not have the track', async () => {
  const { deps, calls } = harness([subscriber('owner-1', { findTrack: async () => null })]);

  await tick(deps);

  assert.deepEqual(calls.delivered, [
    { queueOwnerId: 'owner-1', artist: 'Kendrick Lamar', title: 'Alright', outcome: 'no_match', exact: null, errorMessage: null },
  ]);
  assert.equal(calls.logs.at(-1), 'NO MATCH FOUND on Spotify - "Alright" by Kendrick Lamar - owner-1');
});

test('records error and the reason when the queue attempt fails, without throwing', async () => {
  const { deps, calls } = harness([
    subscriber('owner-1', {
      queueTrack: async () => {
        throw new Error('403');
      },
    }),
  ]);

  await tick(deps);

  assert.deepEqual(calls.delivered, [
    { queueOwnerId: 'owner-1', artist: 'Kendrick Lamar', title: 'Alright', outcome: 'error', exact: null, errorMessage: '403' },
  ]);
  assert.equal(calls.logs.at(-1), 'ERROR while processing "Alright" by Kendrick Lamar - owner-1: 403');
});

test('one Subscriber failing costs the others no Delivery', async () => {
  const { deps, calls } = harness([
    subscriber('broken', {
      queueTrack: async () => {
        throw new Error('Spotify is down');
      },
    }),
    subscriber('fine'),
  ]);

  await tick(deps);

  assert.deepEqual(
    calls.delivered.map((d) => [d.queueOwnerId, d.outcome]).sort(),
    [
      ['broken', 'error'],
      ['fine', 'queued'],
    ].sort(),
  );
});

test('a failure to record a Delivery is logged rather than thrown', async () => {
  const { deps, calls } = harness([subscriber('owner-1')], {
    recordDelivery: async () => {
      throw new Error('database is locked');
    },
  });

  await tick(deps);

  assert.equal(calls.logs.at(-1), 'Could not record the queued Delivery for owner-1: database is locked');
});

test('announces the track once before fanning out to any Subscriber', async () => {
  const { deps, calls } = harness([subscriber('owner-1')]);

  await tick(deps);

  assert.equal(calls.logs[0], 'New now-playing detected: "Alright" by Kendrick Lamar');
});
