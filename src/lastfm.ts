import { requireEnv } from './env.ts';

const API_KEY = requireEnv('LASTFM_API_KEY');

export type NowPlaying = {
  artist: string;
  title: string;
};

type RecentTracks = {
  recenttracks?: {
    track?: {
      name?: string;
      artist?: { '#text'?: string };
      '@attr'?: { nowplaying?: string };
    }[];
  };
};

// Recent tracks are public, so this needs an API key but no OAuth.
export async function getNowPlaying(user: string): Promise<NowPlaying | null> {
  const query = new URLSearchParams({
    method: 'user.getrecenttracks',
    user,
    api_key: API_KEY,
    format: 'json',
    limit: '1',
  });

  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}`);
  const data = (await res.json()) as RecentTracks;
  if (!res.ok) throw new Error(`Last.fm error: ${JSON.stringify(data)}`);

  const track = data.recenttracks?.track?.[0];
  if (track?.['@attr']?.nowplaying !== 'true') return null;

  return {
    artist: track.artist?.['#text'] ?? '',
    title: track.name ?? '',
  };
}
