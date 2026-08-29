import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getNowPlaying } from './lastfm.ts';

function recentTracks(track: unknown) {
  return new Response(JSON.stringify({ recenttracks: { track: [track] } }));
}

test('reports the track the watched account is playing', async (t) => {
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    seen.push(url);
    return recentTracks({
      name: 'Alright',
      artist: { '#text': 'Kendrick Lamar' },
      '@attr': { nowplaying: 'true' },
    });
  });

  const current = await getNowPlaying({ apiKey: 'key-123', watchedAccount: 'someone' });

  assert.deepEqual(current, { artist: 'Kendrick Lamar', title: 'Alright' });

  const query = new URL(seen[0] ?? '').searchParams;
  assert.equal(query.get('method'), 'user.getrecenttracks');
  assert.equal(query.get('user'), 'someone');
  assert.equal(query.get('api_key'), 'key-123');
});

test('reports nothing when the last track has stopped playing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    recentTracks({ name: 'Alright', artist: { '#text': 'Kendrick Lamar' } }),
  );

  assert.equal(await getNowPlaying({ apiKey: 'key-123', watchedAccount: 'someone' }), null);
});

test('throws when Last.fm rejects the request', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 403 }),
  );

  await assert.rejects(
    getNowPlaying({ apiKey: 'nope', watchedAccount: 'someone' }),
    /Invalid API key/,
  );
});
