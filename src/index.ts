import { numberEnv } from './env.ts';
import { readJson, writeJson } from './json-file.ts';
import { getNowPlaying, targetUser } from './lastfm.ts';
import { findTrack, hasActiveDevice, queueTrack } from './spotify.ts';

const POLL_INTERVAL_MS = numberEnv('POLL_INTERVAL_MS', 30_000);
const STATE_FILE = 'state.json';

type State = { lastKey: string | null };

let state = readJson<State>(STATE_FILE) ?? { lastKey: null };

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function tick(): Promise<void> {
  let current;
  try {
    current = await getNowPlaying();
  } catch (err) {
    log(`Last.fm poll failed: ${reason(err)}`);
    return;
  }

  if (!current) return; // Target user isn't playing anything right now.

  const key = `${current.artist}|||${current.title}`.toLowerCase();
  if (key === state.lastKey) return; // Same track as last poll, already handled.

  // Record the track before acting on it, so a failure never causes a retry.
  state = { lastKey: key };
  writeJson(STATE_FILE, state);

  const track = `"${current.title}" by ${current.artist}`;
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
