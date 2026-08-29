// packages/core has to load on workerd as well as Node (ADR-0003), and has to
// be usable by a process serving several Queue Owners. Both are properties of
// the source that are easy to break by accident, so they are checked rather
// than intended. Tests are excluded: workerd never loads them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = 'packages/core';

const FORBIDDEN = [
  [/\bfrom\s+'node:/, "imports from 'node:'"],
  [/\brequire\('node:/, "requires from 'node:'"],
  [/\bprocess\.exit\b/, 'calls process.exit'],
  [/\bBuffer\b/, 'uses Buffer'],
];

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}

const problems = sources(CORE).flatMap((path) => {
  const source = readFileSync(path, 'utf8');
  return FORBIDDEN.filter(([pattern]) => pattern.test(source)).map(
    ([, description]) => `${path} ${description}`,
  );
});

if (problems.length > 0) {
  console.error(`${CORE} must run on Node and workerd alike:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`${CORE} is runtime-agnostic.`);
