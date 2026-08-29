import { existsSync } from 'node:fs';

// Node can read .env natively, so there's no dotenv dependency. A missing
// .env is fine as long as the variables are already in the environment.
if (existsSync('.env')) process.loadEnvFile();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

export function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
