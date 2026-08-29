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
export async function getNowPlaying(options: {
  apiKey: string;
  watchedAccount: string;
}): Promise<NowPlaying | null> {
  const query = new URLSearchParams({
    method: 'user.getrecenttracks',
    user: options.watchedAccount,
    api_key: options.apiKey,
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
