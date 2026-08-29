import type { Db, Row, SqlValue } from './db.ts';

export type QueueOwner = {
  spotifyUserId: string;
  displayName: string;
  // Encrypted at rest; the store never looks inside it.
  refreshToken: string;
  needsReauthorization: boolean;
  // Null means this Queue Owner runs on the Instance's own Spotify app.
  spotifyApp: { clientId: string; clientSecret: string } | null;
};

export type WatchedAccount = {
  lastfmUsername: string;
  lastNowPlayingKey: string | null;
  nextPollAt: number;
};

export type Subscription = {
  queueOwnerId: string;
  watchedAccountId: string;
};

export type Outcome = 'queued' | 'no_match' | 'no_device' | 'unauthorized' | 'error';

export type Delivery = {
  id: number;
  queueOwnerId: string;
  watchedAccountId: string;
  artist: string;
  title: string;
  outcome: Outcome;
  // Only a queued Delivery has an answer: exact match, or Spotify's top result.
  exact: boolean | null;
  errorMessage: string | null;
  createdAt: number;
};

export type CliToken = {
  id: string;
  queueOwnerId: string;
  tokenHash: string;
  createdAt: number;
};

// SQLite has no boolean, and neither driver accepts one as a parameter.
function flag(value: boolean): number {
  return value ? 1 : 0;
}

function toQueueOwner(row: Row): QueueOwner {
  const clientId = row.spotify_client_id;
  return {
    spotifyUserId: String(row.spotify_user_id),
    displayName: String(row.display_name),
    refreshToken: String(row.refresh_token),
    needsReauthorization: Boolean(row.needs_reauthorization),
    spotifyApp:
      clientId == null
        ? null
        : { clientId: String(clientId), clientSecret: String(row.spotify_client_secret) },
  };
}

function toWatchedAccount(row: Row): WatchedAccount {
  return {
    lastfmUsername: String(row.lastfm_username),
    lastNowPlayingKey: row.last_now_playing_key == null ? null : String(row.last_now_playing_key),
    nextPollAt: Number(row.next_poll_at),
  };
}

function toSubscription(row: Row): Subscription {
  return {
    queueOwnerId: String(row.queue_owner_id),
    watchedAccountId: String(row.watched_account_id),
  };
}

function toDelivery(row: Row): Delivery {
  return {
    id: Number(row.id),
    queueOwnerId: String(row.queue_owner_id),
    watchedAccountId: String(row.watched_account_id),
    artist: String(row.artist),
    title: String(row.title),
    outcome: String(row.outcome) as Outcome,
    exact: row.exact == null ? null : Boolean(row.exact),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    createdAt: Number(row.created_at),
  };
}

function toCliToken(row: Row): CliToken {
  return {
    id: String(row.id),
    queueOwnerId: String(row.queue_owner_id),
    tokenHash: String(row.token_hash),
    createdAt: Number(row.created_at),
  };
}

async function one<T>(db: Db, sql: string, params: SqlValue[], read: (row: Row) => T): Promise<T | null> {
  const [row] = await db.all(sql, params);
  return row ? read(row) : null;
}

// Queue Owners ---------------------------------------------------------------

// The row is written as given, so a caller signing someone in again has to say
// whether they brought their own Spotify app, not leave it out and hope.
export async function saveQueueOwner(db: Db, owner: QueueOwner): Promise<void> {
  await db.run(
    `INSERT INTO queue_owner (
       spotify_user_id, display_name, refresh_token, needs_reauthorization,
       spotify_client_id, spotify_client_secret
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (spotify_user_id) DO UPDATE SET
       display_name = excluded.display_name,
       refresh_token = excluded.refresh_token,
       needs_reauthorization = excluded.needs_reauthorization,
       spotify_client_id = excluded.spotify_client_id,
       spotify_client_secret = excluded.spotify_client_secret`,
    [
      owner.spotifyUserId,
      owner.displayName,
      owner.refreshToken,
      flag(owner.needsReauthorization),
      owner.spotifyApp?.clientId ?? null,
      owner.spotifyApp?.clientSecret ?? null,
    ],
  );
}

export function getQueueOwner(db: Db, spotifyUserId: string): Promise<QueueOwner | null> {
  return one(db, 'SELECT * FROM queue_owner WHERE spotify_user_id = ?', [spotifyUserId], toQueueOwner);
}

// Spotify rotates refresh tokens on its own schedule, which is a write of that
// column alone.
export async function saveRefreshToken(db: Db, spotifyUserId: string, refreshToken: string): Promise<void> {
  await db.run('UPDATE queue_owner SET refresh_token = ? WHERE spotify_user_id = ?', [
    refreshToken,
    spotifyUserId,
  ]);
}

export async function setNeedsReauthorization(db: Db, spotifyUserId: string, needed: boolean): Promise<void> {
  await db.run('UPDATE queue_owner SET needs_reauthorization = ? WHERE spotify_user_id = ?', [
    flag(needed),
    spotifyUserId,
  ]);
}

// Takes their Subscriptions, Deliveries and CLI tokens with it, by cascade.
export async function deleteQueueOwner(db: Db, spotifyUserId: string): Promise<void> {
  await db.run('DELETE FROM queue_owner WHERE spotify_user_id = ?', [spotifyUserId]);
}

// Watched Accounts -----------------------------------------------------------

// Someone else may already be watching them, in which case their schedule and
// their last-seen track are none of this caller's business.
export async function watchAccount(db: Db, account: { lastfmUsername: string; nextPollAt: number }): Promise<void> {
  await db.run('INSERT OR IGNORE INTO watched_account (lastfm_username, next_poll_at) VALUES (?, ?)', [
    account.lastfmUsername,
    account.nextPollAt,
  ]);
}

export function getWatchedAccount(db: Db, lastfmUsername: string): Promise<WatchedAccount | null> {
  return one(db, 'SELECT * FROM watched_account WHERE lastfm_username = ?', [lastfmUsername], toWatchedAccount);
}

// Answers whether this caller is the one that gets to act on the track, and
// records the answer in the same statement so a second caller cannot also win.
// A Delivery is created only when this returns true.
export async function claimNowPlaying(db: Db, lastfmUsername: string, key: string): Promise<boolean> {
  const changed = await db.run(
    `UPDATE watched_account SET last_now_playing_key = ?
     WHERE lastfm_username = ?
       AND (last_now_playing_key IS NULL OR last_now_playing_key <> ?)`,
    [key, lastfmUsername, key],
  );
  return changed > 0;
}

// A Watched Account nobody subscribes to is no longer worth polling.
export async function forgetUnwatchedAccounts(db: Db): Promise<void> {
  await db.run(
    `DELETE FROM watched_account
     WHERE lastfm_username NOT IN (SELECT watched_account_id FROM subscription)`,
  );
}

// Subscriptions --------------------------------------------------------------

// The Watched Account has to exist first; subscribing twice is a no-op.
export async function addSubscription(db: Db, queueOwnerId: string, lastfmUsername: string): Promise<void> {
  await db.run(
    'INSERT OR IGNORE INTO subscription (queue_owner_id, watched_account_id) VALUES (?, ?)',
    [queueOwnerId, lastfmUsername],
  );
}

export async function removeSubscription(db: Db, queueOwnerId: string, lastfmUsername: string): Promise<void> {
  await db.run('DELETE FROM subscription WHERE queue_owner_id = ? AND watched_account_id = ?', [
    queueOwnerId,
    lastfmUsername,
  ]);
}

export async function listSubscriptions(db: Db, queueOwnerId: string): Promise<Subscription[]> {
  const rows = await db.all(
    'SELECT * FROM subscription WHERE queue_owner_id = ? ORDER BY watched_account_id',
    [queueOwnerId],
  );
  return rows.map(toSubscription);
}

// One poll, then one Delivery for each of these.
export async function listSubscribers(db: Db, lastfmUsername: string): Promise<QueueOwner[]> {
  const rows = await db.all(
    `SELECT queue_owner.* FROM queue_owner
     JOIN subscription ON subscription.queue_owner_id = queue_owner.spotify_user_id
     WHERE subscription.watched_account_id = ?
     ORDER BY queue_owner.spotify_user_id`,
    [lastfmUsername],
  );
  return rows.map(toQueueOwner);
}

// Deliveries -----------------------------------------------------------------

export async function recordDelivery(db: Db, delivery: Omit<Delivery, 'id'>): Promise<void> {
  await db.run(
    `INSERT INTO delivery (
       queue_owner_id, watched_account_id, artist, title, outcome, exact, error_message, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      delivery.queueOwnerId,
      delivery.watchedAccountId,
      delivery.artist,
      delivery.title,
      delivery.outcome,
      delivery.exact == null ? null : flag(delivery.exact),
      delivery.errorMessage,
      delivery.createdAt,
    ],
  );
}

// Newest first, and by id within a millisecond, so two Deliveries from one
// poll keep the order they were written in.
export async function listDeliveries(db: Db, queueOwnerId: string, limit: number): Promise<Delivery[]> {
  const rows = await db.all(
    'SELECT * FROM delivery WHERE queue_owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [queueOwnerId, limit],
  );
  return rows.map(toDelivery);
}

// CLI tokens -----------------------------------------------------------------

export async function createCliToken(db: Db, token: CliToken): Promise<void> {
  await db.run(
    'INSERT INTO cli_token (id, queue_owner_id, token_hash, created_at) VALUES (?, ?, ?, ?)',
    [token.id, token.queueOwnerId, token.tokenHash, token.createdAt],
  );
}

export async function listCliTokens(db: Db, queueOwnerId: string): Promise<CliToken[]> {
  const rows = await db.all('SELECT * FROM cli_token WHERE queue_owner_id = ? ORDER BY created_at DESC', [
    queueOwnerId,
  ]);
  return rows.map(toCliToken);
}

// The CLI presents a token; this is the Queue Owner it speaks for.
export function queueOwnerForToken(db: Db, tokenHash: string): Promise<QueueOwner | null> {
  return one(
    db,
    `SELECT queue_owner.* FROM queue_owner
     JOIN cli_token ON cli_token.queue_owner_id = queue_owner.spotify_user_id
     WHERE cli_token.token_hash = ?`,
    [tokenHash],
    toQueueOwner,
  );
}

export async function revokeCliToken(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM cli_token WHERE id = ?', [id]);
}
