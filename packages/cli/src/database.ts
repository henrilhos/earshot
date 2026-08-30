import { migrate } from '../core/index.ts';
import { type LocalDatabase, openDatabase } from './sqlite.ts';

// Everything the standalone CLI remembers, in one file in the directory it is
// run from — the same place state.json and tokens.json were written.
export const DATABASE_FILE = 'earshot.db';

// The schema is idempotent, so opening the file is the whole migration step.
export async function openLocalDatabase(path = DATABASE_FILE): Promise<LocalDatabase> {
  const db = openDatabase(path);
  await migrate(db);
  return db;
}
