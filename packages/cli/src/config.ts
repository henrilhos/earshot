import { existsSync } from 'node:fs';
import { type Cipher, cipher, generateSecretKey, type SpotifyApp } from '../core/index.ts';

export type Config = {
  lastfmApiKey: string;
  spotify: SpotifyApp;
  pollIntervalMs: number;
};

// Node can read .env natively, so there's no dotenv dependency. A missing
// .env is fine as long as the variables are already in the environment.
function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile();
}

// Reports every missing variable at once, so filling in .env doesn't take
// four runs to discover four holes.
function requireEnv<Name extends string>(names: Name[]): Record<Name, string> {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }

  const values = {} as Record<Name, string>;
  for (const name of names) values[name] = process.env[name] as string;
  return values;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Authorizing doesn't touch Last.fm, so it doesn't need that key present.
export function loadSpotifyApp(): SpotifyApp {
  loadDotEnv();
  const env = requireEnv(['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI']);

  return {
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
    redirectUri: env.SPOTIFY_REDIRECT_URI,
  };
}

// The key is read here and nowhere else: everything below takes the Cipher.
// A missing key is not a rule to look up, so the message hands over a fresh one
// to paste rather than describing the shape of the one it wants.
export async function loadCipher(): Promise<Cipher> {
  loadDotEnv();
  const secretKey = process.env.EARSHOT_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'Missing EARSHOT_SECRET_KEY, which encrypts your Spotify authorization at rest.\n' +
        `Add this line to your .env:\n\n  EARSHOT_SECRET_KEY=${generateSecretKey()}\n`,
    );
  }
  return cipher(secretKey);
}

// Read once, here at the edge, and handed down to the core as plain values.
export function loadConfig(): Config {
  const spotify = loadSpotifyApp();
  const env = requireEnv(['LASTFM_API_KEY']);

  return {
    lastfmApiKey: env.LASTFM_API_KEY,
    spotify,
    pollIntervalMs: numberEnv('POLL_INTERVAL_MS', 60_000),
  };
}
