// apps/web brings a build step and a dependency tree; packages/cli must never
// grow either, or `npx earshot` stops being a thing you can run without
// waiting for an install. The boundary is the point of the workspace split,
// so it is checked rather than intended.
import { readFileSync } from 'node:fs';

const SEALED = ['packages/core', 'packages/cli'];
const FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const problems = SEALED.flatMap((workspace) => {
  const manifest = JSON.parse(readFileSync(`${workspace}/package.json`, 'utf8'));

  return FIELDS.flatMap((field) => {
    const declared = Object.keys(manifest[field] ?? {});
    if (declared.length > 0) return [`${workspace} declares ${field}: ${declared.join(', ')}`];
    // An absent block is as easy to add to as an empty one. The empty block is
    // there to be noticed by whoever is about to reach for a package.
    if (field === 'dependencies' && manifest.dependencies === undefined) {
      return [`${workspace} is missing its empty dependencies block`];
    }
    return [];
  });
});

if (problems.length > 0) {
  console.error('The CLI has to install with no dependency tree:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`${SEALED.join(' and ')} declare no dependencies.`);
