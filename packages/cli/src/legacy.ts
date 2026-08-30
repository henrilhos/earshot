import { readFileSync } from 'node:fs';
import {
  addSubscription,
  claimNowPlaying,
  type Db,
  getWatchedAccount,
  type SpotifyTokens,
  watchAccount,
} from '../core/index.ts';
import { LOCAL_QUEUE_OWNER, localQueueOwner, saveLocalQueueOwner } from './owner.ts';

// Where the CLI kept its state before the store. Both files are read once, on
// the first run that finds them, and then left where they are: deleting
// someone's data on their behalf is not this program's call.
export const STATE_FILE = 'state.json';
export const TOKENS_FILE = 'tokens.json';

// Files written before the users map hold a bare { lastKey }.
type StoredState = { users?: Record<string, string>; lastKey?: string | null };

export type Imported = { queueOwner: boolean; watchedAccounts: string[] };

// We owned both files end to end, so missing and corrupt mean the same thing
// here: nothing to import.
function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

// A bare lastKey could only have belonged to the one account being watched.
function lastSeen(stored: StoredState | null, watchedAccount: string): Record<string, string> {
  if (stored?.users) return stored.users;
  if (stored?.lastKey) return { [watchedAccount]: stored.lastKey };
  return {};
}

export async function importJsonFiles(
  db: Db,
  options: { watchedAccount: string; stateFile?: string; tokensFile?: string },
): Promise<Imported> {
  const { watchedAccount, stateFile = STATE_FILE, tokensFile = TOKENS_FILE } = options;
  const imported: Imported = { queueOwner: false, watchedAccounts: [] };

  // A row already here is this database's own, and newer than the file.
  let authorized = (await localQueueOwner(db)) !== null;
  if (!authorized) {
    const refreshToken = readJson<SpotifyTokens>(tokensFile)?.refresh_token;
    if (refreshToken) {
      await saveLocalQueueOwner(db, refreshToken);
      authorized = true;
      imported.queueOwner = true;
    }
  }

  // A Watched Account nobody subscribes to is not watched by anyone, so there
  // is nothing to import them into until `earshot auth` has run.
  if (!authorized) return imported;

  for (const [lastfmUsername, key] of Object.entries(lastSeen(readJson<StoredState>(stateFile), watchedAccount))) {
    if (await getWatchedAccount(db, lastfmUsername)) continue;

    await watchAccount(db, { lastfmUsername, nextPollAt: Date.now() });
    // Claiming is how the last-seen key gets written, and the effect is the one
    // the file was kept for: whatever was playing at the last shutdown counts
    // as handled and is not queued again.
    await claimNowPlaying(db, lastfmUsername, key);
    await addSubscription(db, LOCAL_QUEUE_OWNER, lastfmUsername);
    imported.watchedAccounts.push(lastfmUsername);
  }

  return imported;
}
