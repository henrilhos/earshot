import { readFileSync, writeFileSync } from 'node:fs';

// Both tokens.json and state.json are small blobs we own end to end, so a
// missing or corrupt file is treated the same way: no value yet.
export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}
