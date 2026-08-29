import type { Db } from './db.ts';

// One schema, run by both drivers. Every statement is idempotent, so opening a
// database is the only migration step there is.
//
// Times are epoch milliseconds, because Date.now() is the one clock both
// runtimes have and integers compare correctly in SQL.
export const SCHEMA: string[] = [
  // The Spotify user id is the identity the Instance signs people in with
  // (ADR-0001), so it is the key rather than a surrogate alongside it.
  //
  // A null client id/secret pair means this Queue Owner runs on the Instance's
  // own Spotify app and spends one of its five allowlist slots. Set means they
  // brought their own. The CHECK keeps half a pair from being stored.
  `CREATE TABLE IF NOT EXISTS queue_owner (
  spotify_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  needs_reauthorization INTEGER NOT NULL DEFAULT 0,
  spotify_client_id TEXT,
  spotify_client_secret TEXT,
  CHECK ((spotify_client_id IS NULL) = (spotify_client_secret IS NULL))
)`,

  // Watching someone needs no permission from them, so the Last.fm username is
  // all there is to a Watched Account, plus what the poller remembers about it.
  `CREATE TABLE IF NOT EXISTS watched_account (
  lastfm_username TEXT PRIMARY KEY,
  last_now_playing_key TEXT,
  next_poll_at INTEGER NOT NULL
)`,

  // Many-to-many, and the pair is the identity: subscribing twice is the same
  // Subscription, not a second one.
  `CREATE TABLE IF NOT EXISTS subscription (
  queue_owner_id TEXT NOT NULL REFERENCES queue_owner (spotify_user_id) ON DELETE CASCADE,
  watched_account_id TEXT NOT NULL REFERENCES watched_account (lastfm_username) ON DELETE CASCADE,
  PRIMARY KEY (queue_owner_id, watched_account_id)
)`,

  // Recorded whether or not the track reached the queue, which is what makes
  // this the answer to "why didn't it queue that song?".
  //
  // exact is null unless the outcome is queued: it says whether the match was
  // exact or a fallback to Spotify's top search result, and an attempt that
  // never searched has no answer to give.
  `CREATE TABLE IF NOT EXISTS delivery (
  id INTEGER PRIMARY KEY,
  queue_owner_id TEXT NOT NULL,
  watched_account_id TEXT NOT NULL,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('queued', 'no_match', 'no_device', 'unauthorized', 'error')
  ),
  exact INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  CHECK (exact IS NULL OR outcome = 'queued'),
  FOREIGN KEY (queue_owner_id, watched_account_id)
    REFERENCES subscription (queue_owner_id, watched_account_id) ON DELETE CASCADE
)`,

  // Only the hash is stored: a leaked backup then reveals no working token.
  // The id is the handle the SPA revokes by, so it is safe to show.
  `CREATE TABLE IF NOT EXISTS cli_token (
  id TEXT PRIMARY KEY,
  queue_owner_id TEXT NOT NULL REFERENCES queue_owner (spotify_user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
)`,

  // One poll fans out to every Subscription against that Watched Account.
  `CREATE INDEX IF NOT EXISTS subscription_by_watched_account
  ON subscription (watched_account_id)`,

  // The tick selects whatever is due, so this is the hot path of the schedule.
  `CREATE INDEX IF NOT EXISTS watched_account_by_next_poll
  ON watched_account (next_poll_at)`,

  // The Deliveries screen reads one Queue Owner's history, newest first.
  `CREATE INDEX IF NOT EXISTS delivery_by_queue_owner
  ON delivery (queue_owner_id, created_at DESC)`,
];

export async function migrate(db: Db): Promise<void> {
  for (const statement of SCHEMA) await db.run(statement);
}
