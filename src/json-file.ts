import { readFileSync, writeFileSync } from 'node:fs';

// We own both files end to end, so missing and corrupt mean the same thing
// here: no value yet.
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
