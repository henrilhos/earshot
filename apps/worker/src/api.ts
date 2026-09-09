// Everything a signed-in Queue Owner can do once the session cookie names
// them: read or end their session, manage their Subscriptions, and read their
// own Delivery history. Every handler here takes the QueueOwner already
// resolved from the cookie - index.ts's withOwner is what resolves it and
// answers 401 when there is none.
import {
  addSubscription,
  type Db,
  listDeliveries,
  listSubscriptions,
  type QueueOwner,
  removeSubscription,
  watchAccount,
} from '../../../packages/core/index.ts';
import { clearSessionCookie } from './session.ts';

// Deliveries can run long; a default keeps one request from paging through an
// Instance's whole history when the caller asked for nothing in particular.
const DEFAULT_DELIVERIES_LIMIT = 50;

export function handleGetSession(owner: QueueOwner): Response {
  return Response.json({
    spotifyUserId: owner.spotifyUserId,
    displayName: owner.displayName,
    needsReauthorization: owner.needsReauthorization,
  });
}

export function handleDeleteSession(): Response {
  return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie() } });
}

export async function handleListSubscriptions(db: Db, owner: QueueOwner): Promise<Response> {
  return Response.json(await listSubscriptions(db, owner.spotifyUserId));
}

export async function handleCreateSubscription(request: Request, db: Db, owner: QueueOwner): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const lastfmUsername = (body as { lastfmUsername?: unknown } | null)?.lastfmUsername;
  if (typeof lastfmUsername !== 'string' || lastfmUsername.trim() === '') {
    return Response.json({ error: 'lastfmUsername is required.' }, { status: 400 });
  }

  // The Watched Account has to exist before the Subscription can reference
  // it. Someone else may already be watching them, in which case their
  // schedule and last-seen track are none of this caller's business
  // (watchAccount is INSERT OR IGNORE).
  await watchAccount(db, { lastfmUsername, nextPollAt: Date.now() });
  await addSubscription(db, owner.spotifyUserId, lastfmUsername);

  return Response.json({ queueOwnerId: owner.spotifyUserId, watchedAccountId: lastfmUsername }, { status: 201 });
}

export async function handleDeleteSubscription(db: Db, owner: QueueOwner, lastfmUsername: string): Promise<Response> {
  // Removing a Subscription doesn't sweep the Watched Account: the next tick
  // does that (issue 06), so the schedule converges however the Subscription
  // went away.
  await removeSubscription(db, owner.spotifyUserId, lastfmUsername);
  return new Response(null, { status: 204 });
}

export async function handleListDeliveries(request: Request, db: Db, owner: QueueOwner): Promise<Response> {
  const requested = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_DELIVERIES_LIMIT;
  return Response.json(await listDeliveries(db, owner.spotifyUserId, limit));
}
