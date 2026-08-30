import type { WatchedAccount } from './store.ts';
import { reason } from './sync.ts';

// The schedule is data, not a timer. There is nothing here to start, nothing
// to invalidate when a Subscription appears, and nothing that has to survive a
// restart: a tick asks the database what is due, and the database says.
//
// Every collaborator arrives as a plain function, so the one function behind
// the Cron Trigger is the same one behind POST /api/tick, and a test can run
// it without a database or a network.
export type SchedulerDeps = {
  // Answers with the Watched Accounts this invocation won, having already
  // stamped each one's next poll. A tick running alongside this one gets the
  // rest, and never the same row twice.
  claimDue: () => Promise<WatchedAccount[]>;
  // Nobody subscribes to them any more, so nothing would read the poll.
  forgetUnwatched: () => Promise<void>;
  poll: (account: WatchedAccount) => Promise<void>;
  log: (message: string) => void;
};

export type TickResult = {
  // Who this tick claimed, which is what makes a forced poll worth forcing:
  // an empty list means nothing was due, not that nothing happened.
  polled: string[];
};

export async function runTick(deps: SchedulerDeps): Promise<TickResult> {
  // Unsubscribing is the last thing holding a Watched Account on the schedule.
  // Sweeping here rather than at the unsubscribe means the schedule converges
  // however the Subscription went away.
  await deps.forgetUnwatched();

  const due = await deps.claimDue();

  // Polls run together and each one keeps its own failure: they are almost
  // entirely waiting on Last.fm, and one account that is slow or throwing must
  // not cost the others their turn.
  await Promise.all(
    due.map(async (account) => {
      try {
        await deps.poll(account);
      } catch (err) {
        deps.log(`Poll of ${account.lastfmUsername} failed: ${reason(err)}`);
      }
    }),
  );

  return { polled: due.map((account) => account.lastfmUsername) };
}
