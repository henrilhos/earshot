import { readJson, updateJson } from './json-file.ts';

// Several instances share this file, one entry each, so the Watched Account
// has to be part of the state rather than implied by it.
type State = { users: Record<string, string> };

// Files written before the users map still hold a bare { lastKey }.
type StoredState = Partial<State> & { lastKey?: string | null };

function migrate(stored: StoredState | null, watchedAccount: string): State {
  if (stored?.users) return { users: stored.users };
  // A bare lastKey could only have belonged to the one user being watched.
  if (stored?.lastKey) return { users: { [watchedAccount]: stored.lastKey } };
  return { users: {} };
}

// Answers whether this instance is the one that gets to act on a track, and
// remembers the answer so the same track is only ever acted on once.
export function trackClaims(options: { path: string; watchedAccount: string }): (key: string) => Promise<boolean> {
  const { path, watchedAccount } = options;
  let lastKey = migrate(readJson<StoredState>(path), watchedAccount).users[watchedAccount] ?? null;

  return async (key) => {
    if (key === lastKey) return false;

    let claimed = false;

    // The entry on disk is the authority, not our in-memory copy: another
    // instance may have written to the file since we last read it.
    await updateJson<StoredState>(path, (stored) => {
      const state = migrate(stored, watchedAccount);
      claimed = state.users[watchedAccount] !== key;
      if (claimed) state.users[watchedAccount] = key;
      return state;
    });

    // Whether we claimed it or someone else did, this track is now handled.
    lastKey = key;
    return claimed;
  };
}
