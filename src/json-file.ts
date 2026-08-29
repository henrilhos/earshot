import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';

const LOCK_POLL_MS = 20;
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

// We own both files end to end, so missing and corrupt mean the same thing
// here: no value yet.
export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

// rename is atomic within a filesystem, so an instance reading at the same
// moment sees either the whole old file or the whole new one, never a
// half-written one.
export function writeJson(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, path);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockAge(lock: string): number {
  try {
    return Date.now() - statSync(lock).mtimeMs;
  } catch {
    // It was released while we looked at it. Age 0 sends us back to mkdir.
    return 0;
  }
}

// mkdir either creates the directory or fails, with nothing in between, which
// makes it a lock every instance can agree on without a dependency.
async function acquireLock(lock: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;

  for (;;) {
    try {
      mkdirSync(lock);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      // An instance killed mid-update leaves its lock behind forever, so treat
      // an old one as abandoned instead of blocking everyone else for good.
      if (lockAge(lock) > LOCK_STALE_MS) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }

      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lock}`);
      await sleep(LOCK_POLL_MS);
    }
  }
}

// Instances running side by side merge into the same file instead of
// overwriting each other: the value handed to `update` is what is on disk right
// now, not what this process last wrote.
export async function updateJson<T>(path: string, update: (current: T | null) => T): Promise<void> {
  const lock = `${path}.lock`;
  await acquireLock(lock);
  try {
    writeJson(path, update(readJson<T>(path)));
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
