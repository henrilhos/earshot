// packages/cli depends on packages/core but declares no dependencies, so the
// core has to travel inside the tarball rather than be fetched beside it.
//
// In the checkout, packages/cli/core is a symlink, so editing the core is felt
// immediately and a fresh clone runs with nothing installed. npm leaves
// symlinks out of tarballs, so `prepack` swaps it for a real copy, compiles
// both directories, and `postpack` puts the checkout back as it was.
import { cpSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = join(ROOT, 'packages', 'core');
const TARGET = join(ROOT, 'packages', 'cli', 'core');
const BUILD = join(ROOT, 'packages', 'cli', 'dist');

// rmSync follows a trailing slash into the directory the symlink points at,
// which would delete the core itself. Unlink the link, remove the copy.
function clear(path) {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats) return;
  if (stats.isSymbolicLink()) unlinkSync(path);
  else rmSync(path, { recursive: true });
}

function vendor() {
  clear(TARGET);
  mkdirSync(TARGET, { recursive: true });
  // Tests stay behind: nothing that installs the CLI runs them.
  for (const name of readdirSync(SOURCE)) {
    if (name.endsWith('.test.ts')) continue;
    cpSync(join(SOURCE, name), join(TARGET, name), { recursive: true });
  }
  console.log(`Vendored packages/core into ${TARGET}.`);
}

function link() {
  clear(TARGET);
  symlinkSync('../core', TARGET);
  clear(BUILD);
  console.log(`Restored ${TARGET} to a symlink and removed ${BUILD}.`);
}

const command = process.argv[2];
if (command === 'vendor') vendor();
else if (command === 'link') link();
else {
  console.error('Usage: node scripts/vendor-core.js <vendor|link>');
  process.exit(1);
}
