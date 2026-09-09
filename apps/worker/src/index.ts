// The Instance. Sign-in is Spotify OAuth (ADR-0001: no accounts, no invites,
// no password reset - the Spotify dashboard allowlist is the whole gate), a
// session is an httpOnly cookie (session.ts), and everything below the
// sign-in line is a Queue Owner managing their own Subscriptions and reading
// their own Delivery history. The SPA under all of this is issue 12.
import {
  type Cipher,
  cipher,
  d1Db,
  type Db,
  getQueueOwner,
  type QueueOwner,
  reason,
} from '../../../packages/core/index.ts';
import { handleCallback, handleLogin } from './auth.ts';
import {
  handleCreateSubscription,
  handleDeleteSession,
  handleDeleteSubscription,
  handleGetSession,
  handleListDeliveries,
  handleListSubscriptions,
} from './api.ts';
import type { Env } from './env.ts';
import { readSession } from './session.ts';
import { instanceTick } from './tick.ts';

const encoder = new TextEncoder();
const SUBSCRIPTIONS_PREFIX = '/api/subscriptions/';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // The tick has its own auth (a bearer secret, not a session) and builds
    // its own Db inside instanceTick, so it is handled before either is built
    // here.
    if (pathname === '/api/tick') return handleApiTick(request, env);

    // Built once per request and threaded down, rather than reconstructed at
    // each call site - the same shape tick.ts already uses for Db and Cipher.
    const db = d1Db(env.DB);
    const secretCipher = await cipher(env.EARSHOT_SECRET_KEY);

    if (pathname === '/api/auth/login') return onGet(request, () => handleLogin(env));

    if (pathname === '/api/auth/callback') {
      return onGet(request, () => handleCallback(request, env, db, secretCipher));
    }

    if (pathname === '/api/session') {
      if (request.method === 'GET') {
        return withOwner(request, db, secretCipher, (owner) => handleGetSession(owner));
      }
      if (request.method === 'DELETE') return handleDeleteSession();
      return methodNotAllowed(['GET', 'DELETE']);
    }

    if (pathname === '/api/subscriptions') {
      if (request.method === 'GET') {
        return withOwner(request, db, secretCipher, (owner) => handleListSubscriptions(db, owner));
      }
      if (request.method === 'POST') {
        return withOwner(request, db, secretCipher, (owner) => handleCreateSubscription(request, db, owner));
      }
      return methodNotAllowed(['GET', 'POST']);
    }

    if (pathname.startsWith(SUBSCRIPTIONS_PREFIX)) {
      if (request.method !== 'DELETE') return methodNotAllowed(['DELETE']);
      const lastfmUsername = decodeURIComponent(pathname.slice(SUBSCRIPTIONS_PREFIX.length));
      return withOwner(request, db, secretCipher, (owner) => handleDeleteSubscription(db, owner, lastfmUsername));
    }

    if (pathname === '/api/deliveries') {
      return onGet(request, () =>
        withOwner(request, db, secretCipher, (owner) => handleListDeliveries(request, db, owner)),
      );
    }

    return new Response('Not found', { status: 404 });
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

async function handleApiTick(request: Request, env: Env): Promise<Response> {
  // A tick writes, so it is not something a link or a prefetch can cause.
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

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
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response('Method not allowed', { status: 405, headers: { allow: allowed.join(', ') } });
}

async function onGet(request: Request, handle: () => Response | Promise<Response>): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  return handle();
}

// Resolves the cookie to the Queue Owner it names and answers 401 for every
// way that can fail - no cookie, a tampered one, or one naming a Queue Owner
// who no longer exists - rather than let a handler below guess which.
async function withOwner(
  request: Request,
  db: Db,
  secretCipher: Cipher,
  handle: (owner: QueueOwner) => Response | Promise<Response>,
): Promise<Response> {
  const spotifyUserId = await readSession(secretCipher, request);
  const owner = spotifyUserId ? await getQueueOwner(db, spotifyUserId) : null;
  if (!owner) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  return handle(owner);
}

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
