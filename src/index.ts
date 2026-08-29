import { numberEnv } from './env.ts';
import { readJson, updateJson } from './json-file.ts';
import { getNowPlaying } from './lastfm.ts';
import { findTrack, hasActiveDevice, queueTrack } from './spotify.ts';

const POLL_INTERVAL_MS = numberEnv('POLL_INTERVAL_MS', 60_000);
const STATE_FILE = 'state.json';
const targetUser = requireTargetUser();

// Several instances share this file, one entry each, so the user being watched
// has to be part of the state rather than implied by it.
type State = { users: Record<string, string> };

// Files written before the users map still hold a bare { lastKey }.
type StoredState = Partial<State> & { lastKey?: string | null };

let lastKey = migrate(readJson<StoredState>(STATE_FILE)).users[targetUser] ?? null;

function requireTargetUser(): string {
  const user = process.argv[2];
  if (!user) {
    console.error('Usage: npm start -- <lastfm-username>');
    process.exit(1);
  }
  return user;
}

function migrate(stored: StoredState | null): State {
  if (stored?.users) return { users: stored.users };
  // A bare lastKey could only have belonged to the one user being watched.
  if (stored?.lastKey) return { users: { [targetUser]: stored.lastKey } };
  return { users: {} };
}

// The entry on disk is the authority, not our in-memory copy: another instance
// may have written to the file since we last read it.
async function claim(key: string): Promise<boolean> {
  let claimed = false;

  await updateJson<StoredState>(STATE_FILE, (stored) => {
    const state = migrate(stored);
    claimed = state.users[targetUser] !== key;
    if (claimed) state.users[targetUser] = key;
    return state;
  });

  // Whether we claimed it or someone else did, this track is now handled.
  lastKey = key;
  return claimed;
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function tick(): Promise<void> {
  let current;
  try {
    current = await getNowPlaying(targetUser);
  } catch (err) {
    log(`Last.fm poll failed: ${reason(err)}`);
    return;
  }

  if (!current) return;

  const key = `${current.artist}|||${current.title}`.toLowerCase();
  if (key === lastKey) return;

  const track = `"${current.title}" by ${current.artist}`;

  // Record the track before acting on it, so a failure never causes a retry.
  try {
    if (!(await claim(key))) return;
  } catch (err) {
    log(`Could not record ${track}, skipping it: ${reason(err)}`);
    return;
  }

  log(`New now-playing detected: ${track}`);

  try {
    if (!(await hasActiveDevice())) {
      log(`SKIPPED (no active Spotify device/session open) - ${track}`);
      return;
    }

    const match = await findTrack(current.artist, current.title);
    if (!match) {
      log(`NO MATCH FOUND on Spotify - ${track}`);
      return;
    }

    await queueTrack(match.uri);
    const artists = match.artists.map((a) => a.name).join(', ');
    log(`QUEUED: "${match.name}" by ${artists} (${match.uri})`);
  } catch (err) {
    log(`ERROR while processing ${track}: ${reason(err)}`);
  }
}

log(`Starting sync. Watching ${targetUser}'s Last.fm, polling every ${POLL_INTERVAL_MS / 1000}s.`);
await tick();
setInterval(tick, POLL_INTERVAL_MS);
