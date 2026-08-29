// The store speaks to SQLite through these two functions, and nothing else.
// Both drivers receive the SQL that packages/core wrote, unaltered, so the
// text is identical between node:sqlite and D1 by construction rather than by
// two copies kept in step (ADR-0003).
export type SqlValue = string | number | null;

export type Db = {
  all: (sql: string, params?: SqlValue[]) => Promise<Row[]>;
  // Rows changed, which is how a conditional UPDATE says whether it won.
  run: (sql: string, params?: SqlValue[]) => Promise<number>;
};

export type Row = Record<string, unknown>;
