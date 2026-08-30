// The tick, wired to D1 and Last.fm. Both the Cron Trigger and POST /api/tick
// land here, so there is one description of what a tick does and two ways to
// ask for one.
import {
  claimDueAccounts,
  d1Db,
  forgetUnwatchedAccounts,
  getNowPlaying,
  runTick,
  type TickResult,
  type WatchedAccount,
} from '../../../packages/core/index.ts';
import { type Env, pollIntervalMs } from './env.ts';

export function instanceTick(env: Env): Promise<TickResult> {
  const db = d1Db(env.DB);
  const interval = pollIntervalMs(env);

  return runTick({
    claimDue: () => {
      // One clock reading for the whole claim: what is due and when it is next
      // due are the same decision.
      const now = Date.now();
      return claimDueAccounts(db, { now, nextPollAt: now + interval });
    },
    forgetUnwatched: () => forgetUnwatchedAccounts(db),
    poll: (account) => pollWatchedAccount(env, account),
    log: (message) => console.log(message),
  });
}

// One Watched Account, asked what they are playing.
//
// Issue 07 is what happens next: the claim on the Now Playing key and a
// Delivery for every Subscription. Until it lands this stops here rather than
// half-doing it, because claiming a key nothing acts on would hide that track
// from the fan-out that arrives to handle it.
async function pollWatchedAccount(env: Env, account: WatchedAccount): Promise<void> {
  const current = await getNowPlaying({
    apiKey: env.LASTFM_API_KEY,
    watchedAccount: account.lastfmUsername,
  });

  if (!current) return;
  console.log(`${account.lastfmUsername} is playing "${current.title}" by ${current.artist}`);
}
