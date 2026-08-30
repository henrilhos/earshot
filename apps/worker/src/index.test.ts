import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { D1Binding, D1Statement, SqlValue } from '../../../packages/core/index.ts';
import type { Env } from './env.ts';
import worker from './index.ts';

const TOKEN = 'a-shared-secret';

// Answers the way an empty D1 does, and records what it was asked, so a tick
// that never reached the database is visible as an empty log rather than as a
// response that looks the same either way.
function fakeD1(log: string[]): D1Binding {
  return {
    prepare(sql) {
      const statement: D1Statement = {
        bind: () => statement,
        all: async () => {
          log.push(sql);
          return { results: [] };
        },
        run: async () => {
          log.push(sql);
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
  };
}

function environment(overrides: Partial<Env> = {}): { env: Env; sql: string[] } {
  const sql: string[] = [];
  return {
    env: { DB: fakeD1(sql), LASTFM_API_KEY: 'lastfm-key', TICK_TOKEN: TOKEN, ...overrides },
    sql,
  };
}

function tickRequest(token: string | null = TOKEN, method = 'POST'): Request {
  return new Request('https://earshot.example/api/tick', {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
}

test('runs a tick for a caller holding the secret', async () => {
  const { env, sql } = environment();

  const response = await worker.fetch(tickRequest(), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { polled: [] });
  assert.ok(sql.some((statement) => statement.startsWith('UPDATE watched_account SET next_poll_at')));
});

test('turns away a caller with the wrong secret', async () => {
  const { env, sql } = environment();

  const response = await worker.fetch(tickRequest('not-the-secret'), env);

  assert.equal(response.status, 401);
  assert.deepEqual(sql, []);
});

test('turns away a caller with no Authorization header at all', async () => {
  const { env } = environment();

  assert.equal((await worker.fetch(tickRequest(null), env)).status, 401);
});

// The safe direction for a secret nobody set: an open tick endpoint is a
// stranger emptying the Instance's Last.fm budget.
test('closes the endpoint when the Instance has no secret set', async () => {
  const { env, sql } = environment({ TICK_TOKEN: undefined });

  assert.equal((await worker.fetch(tickRequest(''), env)).status, 401);
  assert.equal((await worker.fetch(tickRequest(TOKEN), env)).status, 401);
  assert.deepEqual(sql, []);
});

test('refuses to tick on a GET, before it looks at the secret', async () => {
  const { env } = environment();

  const response = await worker.fetch(tickRequest(TOKEN, 'GET'), env);

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

test('has nothing else to serve yet', async () => {
  const { env } = environment();

  const response = await worker.fetch(new Request('https://earshot.example/'), env);

  assert.equal(response.status, 404);
});

test('the Cron Trigger runs the same tick', async () => {
  const { env, sql } = environment();

  await worker.scheduled(null, env);

  assert.ok(sql.some((statement) => statement.startsWith('UPDATE watched_account SET next_poll_at')));
});

// A cron nobody is watching has to leave the reason somewhere.
test('a failing scheduled tick is logged rather than thrown', async () => {
  const { env } = environment({
    DB: {
      prepare: () => {
        throw new Error('D1 is unreachable');
      },
    },
  });
  const logged: unknown[] = [];
  const error = console.error;
  console.error = (message: unknown) => logged.push(message);

  try {
    await worker.scheduled(null, env);
  } finally {
    console.error = error;
  }

  assert.deepEqual(logged, ['Scheduled tick failed: D1 is unreachable']);
});

test('answers a failed forced tick with the reason', async () => {
  const { env } = environment({
    DB: {
      prepare: () => {
        throw new Error('D1 is unreachable');
      },
    },
  });

  const response = await worker.fetch(tickRequest(), env);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'D1 is unreachable' });
});

test('the claim is bound to the clock, not to a constant', async () => {
  const bound: SqlValue[][] = [];
  const { env } = environment({
    DB: {
      prepare(sql) {
        const statement: D1Statement = {
          bind(...params) {
            if (sql.startsWith('UPDATE watched_account SET next_poll_at')) bound.push(params);
            return statement;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        };
        return statement;
      },
    },
    POLL_INTERVAL_MS: '30000',
  });

  const before = Date.now();
  await worker.fetch(tickRequest(), env);

  const [claim] = bound;
  assert.equal(claim?.length, 2);
  const [nextPollAt, now] = claim as [number, number];
  assert.ok(now >= before);
  assert.equal(nextPollAt - now, 30_000);
});
