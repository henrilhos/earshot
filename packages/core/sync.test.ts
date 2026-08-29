import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NowPlaying } from './lastfm.ts';
import type { SpotifyTrack } from './spotify.ts';
import { type SyncDeps, tick } from './sync.ts';

const NOW_PLAYING: NowPlaying = { artist: 'Kendrick Lamar', title: 'Alright' };

const MATCH: SpotifyTrack = {
  uri: 'spotify:track:alright',
  name: 'Alright',
  artists: [{ name: 'Kendrick Lamar' }],
};

type Recorded = {
  polled: string[];
  claimed: string[];
  searched: [string, string][];
  queued: string[];
  logs: string[];
};

function harness(overrides: Partial<SyncDeps> = {}) {
  const calls: Recorded = { polled: [], claimed: [], searched: [], queued: [], logs: [] };

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
    hasActiveDevice: async () => true,
    findTrack: async (artist, title) => {
      calls.searched.push([artist, title]);
      return MATCH;
    },
    queueTrack: async (uri) => {
      calls.queued.push(uri);
    },
    log: (message) => {
      calls.logs.push(message);
    },
    ...overrides,
  };

  return { deps, calls };
}

test('queues the match for a new now playing track', async () => {
  const { deps, calls } = harness();

  await tick(deps);

  assert.deepEqual(calls.polled, ['someone']);
  assert.deepEqual(calls.claimed, ['kendrick lamar|||alright']);
  assert.deepEqual(calls.searched, [['Kendrick Lamar', 'Alright']]);
  assert.deepEqual(calls.queued, ['spotify:track:alright']);
  assert.match(calls.logs.at(-1) ?? '', /^QUEUED: "Alright" by Kendrick Lamar \(spotify:track:alright\)$/);
});

test('does nothing when the watched account is not listening', async () => {
  const { deps, calls } = harness({ nowPlaying: async () => null });

  await tick(deps);

  assert.deepEqual(calls.claimed, []);
  assert.deepEqual(calls.queued, []);
  assert.deepEqual(calls.logs, []);
});

test('reports a failed Last.fm poll and leaves Spotify alone', async () => {
  const { deps, calls } = harness({
    nowPlaying: async () => {
      throw new Error('rate limited');
    },
  });

  await tick(deps);

  assert.deepEqual(calls.logs, ['Last.fm poll failed: rate limited']);
  assert.deepEqual(calls.claimed, []);
  assert.deepEqual(calls.searched, []);
});

test('stays quiet when the track was already claimed', async () => {
  const { deps, calls } = harness({ claim: async () => false });

  await tick(deps);

  assert.deepEqual(calls.searched, []);
  assert.deepEqual(calls.queued, []);
  assert.deepEqual(calls.logs, []);
});

test('skips the track when it cannot be recorded', async () => {
  const { deps, calls } = harness({
    claim: async () => {
      throw new Error('locked');
    },
  });

  await tick(deps);

  assert.deepEqual(calls.logs, ['Could not record "Alright" by Kendrick Lamar, skipping it: locked']);
  assert.deepEqual(calls.searched, []);
});

test('skips the track when no Spotify device is active', async () => {
  const { deps, calls } = harness({ hasActiveDevice: async () => false });

  await tick(deps);

  assert.deepEqual(calls.searched, []);
  assert.deepEqual(calls.queued, []);
  assert.match(calls.logs.at(-1) ?? '', /^SKIPPED \(no active Spotify device\/session open\) - "Alright" by Kendrick Lamar$/);
});

test('reports a track Spotify does not have', async () => {
  const { deps, calls } = harness({ findTrack: async () => null });

  await tick(deps);

  assert.deepEqual(calls.queued, []);
  assert.equal(calls.logs.at(-1), 'NO MATCH FOUND on Spotify - "Alright" by Kendrick Lamar');
});

test('reports a failed queue attempt without throwing', async () => {
  const { deps, calls } = harness({
    queueTrack: async () => {
      throw new Error('403');
    },
  });

  await tick(deps);

  assert.equal(calls.logs.at(-1), 'ERROR while processing "Alright" by Kendrick Lamar: 403');
});

test('announces the track once it is claimed', async () => {
  const { deps, calls } = harness();

  await tick(deps);

  assert.equal(calls.logs[0], 'New now-playing detected: "Alright" by Kendrick Lamar');
});
