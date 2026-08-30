import { type Db, getQueueOwner, type QueueOwner, saveQueueOwner, saveRefreshToken } from '../core/index.ts';

// Standalone has no sign-in, so there is no Spotify user id to key the row on.
// A local database holds exactly one Queue Owner, and this is their id.
export const LOCAL_QUEUE_OWNER = 'local';

export function localQueueOwner(db: Db): Promise<QueueOwner | null> {
  return getQueueOwner(db, LOCAL_QUEUE_OWNER);
}

// The Spotify app comes from .env on every run, so the row leaves the client
// credentials null rather than keeping a second copy of them that can go stale.
export async function saveLocalQueueOwner(db: Db, refreshToken: string): Promise<void> {
  await saveQueueOwner(db, {
    spotifyUserId: LOCAL_QUEUE_OWNER,
    displayName: 'Standalone CLI',
    refreshToken,
    needsReauthorization: false,
    spotifyApp: null,
  });
}

// The core only knows that it has no authorization to refresh with. The
// command that creates one is the CLI's to know, so the CLI is what says it.
export async function requireLocalRefreshToken(db: Db): Promise<string> {
  const owner = await localQueueOwner(db);
  if (!owner) throw new Error('No Spotify authorization yet. Run `earshot auth` first.');
  return owner.refreshToken;
}

// Spotify rotates refresh tokens on its own schedule.
export function saveLocalRefreshToken(db: Db, refreshToken: string): Promise<void> {
  return saveRefreshToken(db, LOCAL_QUEUE_OWNER, refreshToken);
}
