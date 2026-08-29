import type { NowPlaying } from './lastfm.ts';
import type { SpotifyTrack } from './spotify.ts';

// Every collaborator arrives as a plain function, so one process can run this
// for several Queue Owners at once, each with its own Spotify identity.
export type SyncDeps = {
  watchedAccount: string;
  nowPlaying: (watchedAccount: string) => Promise<NowPlaying | null>;
  claim: (key: string) => Promise<boolean>;
  hasActiveDevice: () => Promise<boolean>;
  findTrack: (artist: string, title: string) => Promise<SpotifyTrack | null>;
  queueTrack: (uri: string) => Promise<void>;
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
  try {
    if (!(await deps.claim(nowPlayingKey(current)))) return;
  } catch (err) {
    deps.log(`Could not record ${track}, skipping it: ${reason(err)}`);
    return;
  }

  deps.log(`New now-playing detected: ${track}`);

  try {
    if (!(await deps.hasActiveDevice())) {
      deps.log(`SKIPPED (no active Spotify device/session open) - ${track}`);
      return;
    }

    const match = await deps.findTrack(current.artist, current.title);
    if (!match) {
      deps.log(`NO MATCH FOUND on Spotify - ${track}`);
      return;
    }

    await deps.queueTrack(match.uri);
    const artists = match.artists.map((a) => a.name).join(', ');
    deps.log(`QUEUED: "${match.name}" by ${artists} (${match.uri})`);
  } catch (err) {
    deps.log(`ERROR while processing ${track}: ${reason(err)}`);
  }
}
