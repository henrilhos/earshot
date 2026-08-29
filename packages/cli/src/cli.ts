#!/usr/bin/env node
// What `npx earshot` reaches. Both subcommands are scripts that do their
// work on import, so dispatching them is an import.
const USAGE = `Usage:
  earshot auth                authorize your Spotify account, once
  earshot <lastfm-username>   mirror that account's now playing`;

const command = process.argv[2];

if (command === '--help' || command === '-h') {
  console.log(USAGE);
} else if (!command) {
  console.error(USAGE);
  process.exit(1);
} else if (command === 'auth') {
  await import('./auth.ts');
} else {
  // Anything else is read as a Last.fm username. The real command surface,
  // with hosted and standalone modes, arrives with issue 11.
  await import('./index.ts');
}
