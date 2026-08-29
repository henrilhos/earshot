import { DatabaseSync } from 'node:sqlite';
import type { Db, Row } from '../core/index.ts';

export type LocalDatabase = Db & { close: () => void };

// The CLI's driver. node:sqlite is synchronous, so the promises the store
// takes are already settled by the time they are returned; that difference,
// and nothing about the SQL itself, is all that separates this from the D1
// driver (ADR-0003).
//
// node:sqlite is still experimental and prints a warning on use. That is
// accepted rather than silenced.
export function openDatabase(path: string): LocalDatabase {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });

  return {
    async all(sql, params = []) {
      return db.prepare(sql).all(...params) as Row[];
    },
    async run(sql, params = []) {
      // changes arrives as a bigint when the database is opened for them.
      return Number(db.prepare(sql).run(...params).changes);
    },
    close: () => db.close(),
  };
}
