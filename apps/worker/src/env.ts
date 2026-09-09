// The core by path rather than by package name: wrangler bundles this, so
// there is nothing to resolve at runtime.
import type { D1Binding } from '../../../packages/core/index.ts';

// What wrangler binds and what the operator sets as secrets. Described
// structurally, so apps/worker typechecks alongside the CLI without pulling in
// the Cloudflare types.
export type Env = {
  DB: D1Binding;
  // Recent tracks are public, so this is the Instance's key for every Watched
  // Account rather than one per Queue Owner.
  LASTFM_API_KEY: string;
  // Decrypts every Queue Owner's refresh token (ADR-0003's WebCrypto cipher).
  EARSHOT_SECRET_KEY: string;
  // The Instance's own Spotify app, used by any Queue Owner who did not bring
  // their own (ADR-0001's nullable client id/secret). Sign-in always goes
  // through this app: a Queue Owner cannot bring their own until they exist
  // as a row to bring it to.
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REDIRECT_URI: string;
  // The shared secret POST /api/tick is authenticated with. Unset means the
  // endpoint is closed, not open.
  TICK_TOKEN?: string;
  POLL_INTERVAL_MS?: string;
};

// A minute, matching the Cron Trigger. Anything longer and a track that played
// only between two polls is never seen at all.
const DEFAULT_POLL_INTERVAL_MS = 60_000;

export function pollIntervalMs(env: Env): number {
  const value = Number(env.POLL_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_POLL_INTERVAL_MS;
}
