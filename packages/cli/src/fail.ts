import { reason } from '../core/index.ts';

// Only the entry points exit; everything below them throws instead, so the
// same code can run inside a server that has other Queue Owners to serve.
export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// A missing variable is the operator's to fix, so it gets the message and not
// a stack trace.
export function loadOrFail<T>(load: () => T): T {
  try {
    return load();
  } catch (err) {
    return fail(reason(err));
  }
}

// The same, for a load that has to be awaited: importing the encryption key.
export async function awaitOrFail<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    return fail(reason(err));
  }
}
