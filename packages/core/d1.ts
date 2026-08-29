import type { Db, Row, SqlValue } from './db.ts';

// The shape of the Worker's D1 binding, structurally, so packages/core needs
// no dependency on the Cloudflare types to describe it.
export type D1Statement = {
  bind: (...params: SqlValue[]) => D1Statement;
  all: () => Promise<{ results?: unknown[] }>;
  run: () => Promise<{ meta?: { changes?: number } }>;
};

export type D1Binding = {
  prepare: (sql: string) => D1Statement;
};

// The Instance's driver. It hands D1 the SQL it was given and reports back
// rows and a changed count; nothing about the statement itself is D1's to
// know (ADR-0003).
export function d1Db(binding: D1Binding): Db {
  // D1 rejects bind() without arguments, and statements without parameters
  // have nothing to bind anyway.
  function statement(sql: string, params: SqlValue[]): D1Statement {
    const prepared = binding.prepare(sql);
    return params.length > 0 ? prepared.bind(...params) : prepared;
  }

  return {
    async all(sql, params = []) {
      const { results } = await statement(sql, params).all();
      return (results ?? []) as Row[];
    },
    async run(sql, params = []) {
      const { meta } = await statement(sql, params).run();
      return meta?.changes ?? 0;
    },
  };
}
