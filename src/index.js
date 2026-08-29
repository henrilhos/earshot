import 'dotenv/config';
import fs from 'fs';
import { getNowPlaying } from './lastfm.js';
import { findTrack, queueTrack, hasActiveDevice } from './spotify.js';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30_000);
const STATE_FILE = 'state.json';

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { lastKey: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastKey: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function trackKey(artist, title) {
  return `${artist}|||${title}`.toLowerCase();
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

let state = loadState();

async function tick() {
  let current;
  try {
    current = await getNowPlaying();
  } catch (err) {
    log(`Last.fm poll failed: ${err.message}`);
    return;
  }

  if (!current || !current.nowPlaying) {
    // Target user isn't actively playing anything right now - nothing to mirror.
    return;
  }

  const key = trackKey(current.artist, current.title);
  if (key === state.lastKey) {
    // Same track as last time we checked - already handled, do nothing.
    return;
  }

  // New track detected.
  state.lastKey = key;
  saveState(state);

  log(`New now-playing detected: "${current.title}" by ${current.artist}`);

  try {
    const active = await hasActiveDevice();
    if (!active) {
      log(`SKIPPED (no active Spotify device/session open) - "${current.title}" by ${current.artist}`);
      return;
    }

    const match = await findTrack(current.artist, current.title);
    if (!match) {
      log(`NO MATCH FOUND on Spotify - "${current.title}" by ${current.artist}`);
      return;
    }

    await queueTrack(match.uri);
    log(`QUEUED: "${match.name}" by ${match.artists.map((a) => a.name).join(', ')} (${match.uri})`);
  } catch (err) {
    log(`ERROR while processing "${current.title}" by ${current.artist}: ${err.message}`);
  }
}

log(`Starting sync. Watching ${process.env.LASTFM_TARGET_USER}'s Last.fm, polling every ${POLL_INTERVAL_MS / 1000}s.`);
tick();
setInterval(tick, POLL_INTERVAL_MS);
