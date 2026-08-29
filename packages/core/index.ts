// packages/core runs on both Node and workerd, so it uses Web standards only
// and takes everything else as arguments.
export { getNowPlaying, type NowPlaying } from './lastfm.ts';
export {
  authorizeUrl,
  exchangeCode,
  findTrack,
  hasActiveDevice,
  queueTrack,
  refreshTokens,
  type SpotifyApi,
  type SpotifyApp,
  type SpotifyTokens,
  type SpotifyTrack,
  spotifyApi,
} from './spotify.ts';
export { nowPlayingKey, reason, type SyncDeps, tick } from './sync.ts';
