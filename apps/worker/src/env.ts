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
