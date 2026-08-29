const { LASTFM_API_KEY, LASTFM_TARGET_USER } = process.env;

// Returns { artist, title, album, nowPlaying } for the target user's most
// recent track, or null if they have no recent activity at all.
async function getNowPlaying() {
  const url =
    'https://ws.audioscrobbler.com/2.0/?' +
    new URLSearchParams({
      method: 'user.getrecenttracks',
      user: LASTFM_TARGET_USER,
      api_key: LASTFM_API_KEY,
      format: 'json',
      limit: '1',
    });

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Last.fm error: ${JSON.stringify(data)}`);
  }

  const track = data.recenttracks?.track?.[0];
  if (!track) return null;

  return {
    artist: track.artist?.['#text'] || '',
    title: track.name || '',
    album: track.album?.['#text'] || '',
    nowPlaying: track['@attr']?.nowplaying === 'true',
  };
}

export { getNowPlaying };
