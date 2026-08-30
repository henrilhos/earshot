// The Instance. The JSON API and the SPA under it are issue 09; what is here
// is the schedule: a Cron Trigger every minute, and the same tick exposed over
// HTTP for a self-hoster whose platform has no cron and for forcing a poll
// while debugging instead of waiting for the next minute.
import { reason } from '../../../packages/core/index.ts';
import type { Env } from './env.ts';
import { instanceTick } from './tick.ts';

const encoder = new TextEncoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api/tick') return new Response('Not found', { status: 404 });

    // A tick writes, so it is not something a link or a prefetch can cause.
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
    }

    if (!(await authorized(request, env))) {
      return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
    }

    try {
      return Response.json(await instanceTick(env));
    } catch (err) {
      // The endpoint exists for debugging, so the reason is more use to the
      // operator here than a bare 500 is.
      return Response.json({ error: reason(err) }, { status: 500 });
    }
  },

  // The controller says when the tick was scheduled and which cron fired it,
  // and neither changes what a tick does. Awaiting it is what keeps the
  // invocation alive until the polls finish.
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    try {
      await instanceTick(env);
    } catch (err) {
      // Nothing is listening to a Cron Trigger, so an error that is not logged
      // here is an Instance that quietly stops polling.
      console.error(`Scheduled tick failed: ${reason(err)}`);
    }
  },
};

// A shared secret rather than a Queue Owner's session: the two callers this
// exists for are the operator's own cron and the operator debugging, neither
// of whom is signed in. An Instance that never set the secret answers no to
// everything, which is the safe direction for a config line left out.
async function authorized(request: Request, env: Env): Promise<boolean> {
  if (!env.TICK_TOKEN) return false;

  const [scheme, presented] = (request.headers.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !presented) return false;

  return sameSecret(presented, env.TICK_TOKEN);
}

// Digests rather than the secrets themselves, so the comparison is over two
// fixed-length values and the loop runs the same number of rounds whether the
// token was wrong in the first character or the last.
async function sameSecret(presented: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(presented), digest(expected)]);

  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
