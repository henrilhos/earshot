import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runTick, type SchedulerDeps } from './scheduler.ts';
import type { WatchedAccount } from './store.ts';

function account(lastfmUsername: string): WatchedAccount {
  return { lastfmUsername, lastNowPlayingKey: null, nextPollAt: 0 };
}

type Recorded = {
  forgot: number;
  polled: string[];
  logs: string[];
};

function harness(due: WatchedAccount[], overrides: Partial<SchedulerDeps> = {}) {
  const calls: Recorded = { forgot: 0, polled: [], logs: [] };

  const deps: SchedulerDeps = {
    claimDue: async () => due,
    forgetUnwatched: async () => {
      calls.forgot++;
    },
    poll: async (watched) => {
      calls.polled.push(watched.lastfmUsername);
    },
    log: (message) => {
      calls.logs.push(message);
    },
    ...overrides,
  };

  return { calls, deps };
}

test('polls everything the claim won', async () => {
  const { calls, deps } = harness([account('someone'), account('someone-else')]);

  assert.deepEqual(await runTick(deps), { polled: ['someone', 'someone-else'] });
  assert.deepEqual(calls.polled, ['someone', 'someone-else']);
});

test('polls nothing when nothing is due', async () => {
  const { calls, deps } = harness([]);

  assert.deepEqual(await runTick(deps), { polled: [] });
  assert.deepEqual(calls.polled, []);
  // A minute-granularity cron mostly finds nothing due, so a quiet tick has to
  // stay quiet.
  assert.deepEqual(calls.logs, []);
});

test('drops Watched Accounts nobody subscribes to before claiming', async () => {
  const order: string[] = [];
  const { deps } = harness([account('someone')], {
    forgetUnwatched: async () => {
      order.push('forget');
    },
    claimDue: async () => {
      order.push('claim');
      return [];
    },
  });

  await runTick(deps);

  assert.deepEqual(order, ['forget', 'claim']);
});

test('one failing poll costs the others nothing', async () => {
  const { calls, deps } = harness([account('broken'), account('someone')], {
    poll: async (watched) => {
      if (watched.lastfmUsername === 'broken') throw new Error('Last.fm is down');
      calls.polled.push(watched.lastfmUsername);
    },
  });

  const result = await runTick(deps);

  assert.deepEqual(calls.polled, ['someone']);
  assert.match(calls.logs.join('\n'), /broken.*Last\.fm is down/);
  // It was claimed and polled; the poll is what failed, and the stamp already
  // landed, so it waits its turn like everything else.
  assert.deepEqual(result.polled, ['broken', 'someone']);
});

test('polls concurrently, so a slow account does not hold up the tick', async () => {
  // The first account only finishes once the second has started, so this
  // completes if the polls overlap and deadlocks if they are run in turn.
  let started = () => {};
  const second = new Promise<void>((resolve) => {
    started = resolve;
  });

  const { calls, deps } = harness([account('slow'), account('someone')], {
    poll: async (watched) => {
      if (watched.lastfmUsername === 'slow') await second;
      else started();
      calls.polled.push(watched.lastfmUsername);
    },
  });

  await runTick(deps);

  assert.deepEqual(calls.polled, ['someone', 'slow']);
});
