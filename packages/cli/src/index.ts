import {
  addSubscription,
  claimNowPlaying,
  findTrack,
  getNowPlaying,
  hasActiveDevice,
  queueTrack,
  reason,
  spotifyApi,
  type SyncDeps,
  tick,
  watchAccount,
} from '../core/index.ts';
import { loadCipher, loadConfig } from './config.ts';
import { DATABASE_FILE, openLocalDatabase } from './database.ts';
import { awaitOrFail, fail, loadOrFail } from './fail.ts';
import { importJsonFiles, STATE_FILE, TOKENS_FILE } from './legacy.ts';
import { LOCAL_QUEUE_OWNER, requireLocalRefreshToken, saveLocalRefreshToken } from './owner.ts';

const watchedAccount = process.argv[2] || fail('Which Last.fm account? Usage: earshot <lastfm-username>');

const config = loadOrFail(loadConfig);
const cipher = await awaitOrFail(loadCipher);

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const db = await openLocalDatabase();

const imported = await importJsonFiles(db, cipher, { watchedAccount });
if (imported.queueOwner) {
  log(`Imported your Spotify authorization from ${TOKENS_FILE} into ${DATABASE_FILE}.`);
}
if (imported.watchedAccounts.length > 0) {
  log(`Imported ${imported.watchedAccounts.join(', ')} from ${STATE_FILE} into ${DATABASE_FILE}.`);
}

// Fail here rather than at the first Spotify call: without a Queue Owner there
// is nothing to hang the Subscription on either.
try {
  await requireLocalRefreshToken(db, cipher);
} catch (err) {
  fail(reason(err));
}

await watchAccount(db, { lastfmUsername: watchedAccount, nextPollAt: Date.now() });
await addSubscription(db, LOCAL_QUEUE_OWNER, watchedAccount);

const api = spotifyApi({
  app: config.spotify,
  readRefreshToken: () => requireLocalRefreshToken(db, cipher),
  saveRefreshToken: (refreshToken) => saveLocalRefreshToken(db, cipher, refreshToken),
});

const deps: SyncDeps = {
  watchedAccount,
  nowPlaying: (account) => getNowPlaying({ apiKey: config.lastfmApiKey, watchedAccount: account }),
  claim: (key) => claimNowPlaying(db, watchedAccount, key),
  hasActiveDevice: () => hasActiveDevice(api),
  findTrack: (artist, title) => findTrack(api, artist, title),
  queueTrack: (uri) => queueTrack(api, uri),
  log,
};

log(`Starting sync. Watching ${watchedAccount}'s Last.fm, polling every ${config.pollIntervalMs / 1000}s.`);
await tick(deps);
setInterval(() => tick(deps), config.pollIntervalMs);
