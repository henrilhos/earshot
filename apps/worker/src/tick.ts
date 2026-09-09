// The tick, wired to D1, Last.fm and Spotify. Both the Cron Trigger and
// POST /api/tick land here, so there is one description of what a tick does
// and two ways to ask for one.
import {
  type Cipher,
  cipher,
  claimDueAccounts,
  claimNowPlaying,
  type Db,
  d1Db,
  findTrack,
  forgetUnwatchedAccounts,
  getNowPlaying,
  hasActiveDevice,
  listSubscribers,
  type QueueOwner,
  queueTrack,
  recordDelivery,
  runTick,
  saveRefreshToken,
  setNeedsReauthorization,
  spotifyApi,
  type Subscriber,
  tick,
  type TickResult,
  type WatchedAccount,
} from '../../../packages/core/index.ts';
import { type Env, pollIntervalMs } from './env.ts';

export function instanceTick(env: Env): Promise<TickResult> {
  const db = d1Db(env.DB);
  return runInstanceTick(db, env);
}

// Split from instanceTick so a test can hand this a database directly,
// without D1 in the way of asserting what a poll actually recorded.
export async function runInstanceTick(db: Db, env: Env): Promise<TickResult> {
  const interval = pollIntervalMs(env);
  const secretCipher = await cipher(env.EARSHOT_SECRET_KEY);

  return runTick({
    claimDue: () => {
      // One clock reading for the whole claim: what is due and when it is next
      // due are the same decision.
      const now = Date.now();
      return claimDueAccounts(db, { now, nextPollAt: now + interval });
    },
    forgetUnwatched: () => forgetUnwatchedAccounts(db),
    poll: (account) => pollWatchedAccount(db, env, secretCipher, account),
    log: (message) => console.log(message),
  });
}

// One Watched Account, asked what they are playing, fanned out to every Queue
// Owner subscribed to them. The claim on the Now Playing key lives in
// sync.ts's tick(), shared by every Subscriber below it, so two Queue Owners
// watching the same person still cost this one Last.fm request between them.
async function pollWatchedAccount(db: Db, env: Env, secretCipher: Cipher, account: WatchedAccount): Promise<void> {
  await tick({
    watchedAccount: account.lastfmUsername,
    nowPlaying: (watchedAccount) => getNowPlaying({ apiKey: env.LASTFM_API_KEY, watchedAccount }),
    claim: (key) => claimNowPlaying(db, account.lastfmUsername, key),
    subscribers: async () => {
      const owners = await listSubscribers(db, account.lastfmUsername);
      return owners.map((owner) => toSubscriber(db, env, secretCipher, owner));
    },
    recordDelivery: (delivery) =>
      recordDelivery(db, { ...delivery, watchedAccountId: account.lastfmUsername, createdAt: Date.now() }),
    log: (message) => console.log(`${account.lastfmUsername}: ${message}`),
  });
}

// One Queue Owner's view of Spotify: their own app if they brought one,
// otherwise the Instance's (ADR-0001), and their refresh token decrypted at
// the edge rather than carried around in the clear.
function toSubscriber(db: Db, env: Env, secretCipher: Cipher, owner: QueueOwner): Subscriber {
  const app = owner.spotifyApp ?? { clientId: env.SPOTIFY_CLIENT_ID, clientSecret: env.SPOTIFY_CLIENT_SECRET };

  const api = spotifyApi({
    app,
    readRefreshToken: () => secretCipher.decrypt(owner.refreshToken),
    saveRefreshToken: async (refreshToken) =>
      saveRefreshToken(db, owner.spotifyUserId, await secretCipher.encrypt(refreshToken)),
  });

  return {
    queueOwnerId: owner.spotifyUserId,
    hasActiveDevice: () => hasActiveDevice(api),
    findTrack: (artist, title) => findTrack(api, artist, title),
    queueTrack: (uri) => queueTrack(api, uri),
    park: () => setNeedsReauthorization(db, owner.spotifyUserId, true),
  };
}
