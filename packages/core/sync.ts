import type { NowPlaying } from './lastfm.ts';
import { SpotifyGrantRevokedError, type TrackMatch } from './spotify.ts';
import type { Outcome } from './store.ts';

// One Queue Owner's queue attempt, everything a poll needs to make one.
// Every collaborator arrives as a plain function, so fanning a poll out to
// several Subscriptions costs nothing but another entry in this array.
export type Subscriber = {
  queueOwnerId: string;
  hasActiveDevice: () => Promise<boolean>;
  findTrack: (artist: string, title: string) => Promise<TrackMatch | null>;
  queueTrack: (uri: string) => Promise<void>;
  // Called once this Subscriber's grant has answered invalid_grant: parks
  // them as needing reauthorization so the next tick's subscribers() stops
  // handing them back, and this tick's Spotify call is the last one spent on
  // a token that will never work again.
  park: () => Promise<void>;
};

// What one queue attempt leaves behind, still missing the Watched Account and
// timestamp: the caller already knows both, and adds them at the edge rather
// than have every Subscriber's attempt repeat them back.
export type DeliveryAttempt = {
  queueOwnerId: string;
  artist: string;
  title: string;
  outcome: Outcome;
  exact: boolean | null;
  errorMessage: string | null;
};

// Every collaborator arrives as a plain function, so one process can run this
// for several Watched Accounts at once, each fanning out to its own
// Subscribers.
export type SyncDeps = {
  watchedAccount: string;
  nowPlaying: (watchedAccount: string) => Promise<NowPlaying | null>;
  claim: (key: string) => Promise<boolean>;
  // Every Queue Owner subscribed to this Watched Account, asked for only once
  // the claim says there is new Now Playing worth fanning out to them.
  subscribers: () => Promise<Subscriber[]>;
  recordDelivery: (delivery: DeliveryAttempt) => Promise<void>;
  log: (message: string) => void;
};

// What "the same track as last time" means. Callers store it, so it has to
// stay stable across restarts.
export function nowPlayingKey(current: NowPlaying): string {
  return `${current.artist}|||${current.title}`.toLowerCase();
}

// Errors cross this boundary as messages, since the caller logs them rather
// than handling them.
export function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A Delivery is history, not the thing being delivered: a failure to record
// one must not take down a queue attempt that already happened, and must not
// cost the next Subscriber its turn either.
async function report(deps: SyncDeps, delivery: DeliveryAttempt): Promise<void> {
  try {
    await deps.recordDelivery(delivery);
  } catch (err) {
    deps.log(`Could not record the ${delivery.outcome} Delivery for ${delivery.queueOwnerId}: ${reason(err)}`);
  }
}

// One Queue Owner's attempt at one Now Playing. Every outcome from here on is
// a Delivery: reaching the queue is one ending among several worth keeping.
async function deliver(deps: SyncDeps, subscriber: Subscriber, current: NowPlaying, track: string): Promise<void> {
  const base = { queueOwnerId: subscriber.queueOwnerId, artist: current.artist, title: current.title };
  const who = subscriber.queueOwnerId;

  try {
    if (!(await subscriber.hasActiveDevice())) {
      deps.log(`SKIPPED (no active Spotify device/session open) - ${track} - ${who}`);
      await report(deps, { ...base, outcome: 'no_device', exact: null, errorMessage: null });
      return;
    }

    const match = await subscriber.findTrack(current.artist, current.title);
    if (!match) {
      deps.log(`NO MATCH FOUND on Spotify - ${track} - ${who}`);
      await report(deps, { ...base, outcome: 'no_match', exact: null, errorMessage: null });
      return;
    }

    await subscriber.queueTrack(match.track.uri);
    const artists = match.track.artists.map((a) => a.name).join(', ');
    deps.log(`QUEUED: "${match.track.name}" by ${artists} (${match.track.uri}) - ${who}`);
    await report(deps, { ...base, outcome: 'queued', exact: match.exact, errorMessage: null });
  } catch (err) {
    if (err instanceof SpotifyGrantRevokedError) {
      deps.log(`UNAUTHORIZED (Spotify grant revoked, parking pending reauthorization) - ${track} - ${who}`);
      try {
        await subscriber.park();
      } catch (parkErr) {
        deps.log(`Could not park ${who} after their Spotify grant died: ${reason(parkErr)}`);
      }
      await report(deps, { ...base, outcome: 'unauthorized', exact: null, errorMessage: reason(err) });
      return;
    }

    const message = reason(err);
    deps.log(`ERROR while processing ${track} - ${who}: ${message}`);
    await report(deps, { ...base, outcome: 'error', exact: null, errorMessage: message });
  }
}

export async function tick(deps: SyncDeps): Promise<void> {
  let current;
  try {
    current = await deps.nowPlaying(deps.watchedAccount);
  } catch (err) {
    deps.log(`Last.fm poll failed: ${reason(err)}`);
    return;
  }

  if (!current) return;

  const track = `"${current.title}" by ${current.artist}`;

  // Record the track before acting on it, so a failure never causes a retry.
  // The claim is on the Watched Account, shared by every Subscriber, so two
  // Queue Owners watching the same person cost one Last.fm request between
  // them: whichever tick wins the claim is the only one that fans out.
  try {
    if (!(await deps.claim(nowPlayingKey(current)))) return;
  } catch (err) {
    deps.log(`Could not record ${track}, skipping it: ${reason(err)}`);
    return;
  }

  deps.log(`New now-playing detected: ${track}`);

  // One poll, one Delivery per Subscriber. Each keeps its own failure: a
  // Queue Owner whose Spotify call errors must not cost the others their
  // queue attempt.
  const subscribers = await deps.subscribers();
  await Promise.all(subscribers.map((subscriber) => deliver(deps, subscriber, current, track)));
}
