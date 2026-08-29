import {
  findTrack,
  getNowPlaying,
  hasActiveDevice,
  queueTrack,
  spotifyApi,
  type SyncDeps,
  tick,
} from '../core/index.ts';
import { loadConfig } from './config.ts';
import { fail, loadOrFail } from './fail.ts';
import { trackClaims } from './state.ts';
import { readTokens, saveTokens } from './tokens.ts';

const STATE_FILE = 'state.json';

const watchedAccount = process.argv[2] || fail('Which Last.fm account? Usage: earshot <lastfm-username>');

const config = loadOrFail(loadConfig);

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const api = spotifyApi({ app: config.spotify, readTokens, saveTokens });

const deps: SyncDeps = {
  watchedAccount,
  nowPlaying: (account) => getNowPlaying({ apiKey: config.lastfmApiKey, watchedAccount: account }),
  claim: trackClaims({ path: STATE_FILE, watchedAccount }),
  hasActiveDevice: () => hasActiveDevice(api),
  findTrack: (artist, title) => findTrack(api, artist, title),
  queueTrack: (uri) => queueTrack(api, uri),
  log,
};

log(`Starting sync. Watching ${watchedAccount}'s Last.fm, polling every ${config.pollIntervalMs / 1000}s.`);
await tick(deps);
setInterval(() => tick(deps), config.pollIntervalMs);
