import type { SpotifyTokens } from '../packages/core/index.ts';
import { readJson, writeJson } from './json-file.ts';

const TOKENS_FILE = 'tokens.json';

// The core only knows that it has no authorization to refresh with. Which
// file it should have come from, and the command that writes it, are the
// CLI's to know, so the CLI is what says them.
export function readTokens(): SpotifyTokens {
  const tokens = readJson<SpotifyTokens>(TOKENS_FILE);
  if (!tokens?.refresh_token) {
    throw new Error('No usable tokens.json. Run `npm run auth` first.');
  }
  return tokens;
}

export function saveTokens(tokens: SpotifyTokens): void {
  writeJson(TOKENS_FILE, tokens);
}
