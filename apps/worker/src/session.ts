// Cookies for the session and the OAuth CSRF token. There is no session
// table (issue 03's schema is Queue Owner, Watched Account, Subscription,
// Delivery, CLI token - five tables, not six): the cookie itself carries the
// state, authenticated by the same WebCrypto cipher that already guards
// refresh tokens at rest (ADR-0003). A copied or edited cookie decrypts to
// nothing rather than to someone else's Queue Owner id, so nothing server-side
// has to remember it was issued.
import type { Cipher } from '../../../packages/core/index.ts';

const SESSION_COOKIE = 'session';
const STATE_COOKIE = 'oauth_state';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days.
const STATE_MAX_AGE_SECONDS = 60 * 10; // Long enough to sign in with Spotify, no longer.

function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function readCookie(request: Request, name: string): string | null {
  return parseCookies(request.headers.get('cookie'))[name] ?? null;
}

// Opaque and unpredictable, which is all a CSRF token has to be: the Instance
// never has to recognize a particular one again, only that the value coming
// back on the callback matches the one it handed to this browser.
export function newState(): string {
  return crypto.randomUUID();
}

export function stateCookie(state: string): string {
  return serializeCookie(STATE_COOKIE, state, STATE_MAX_AGE_SECONDS);
}

export function readState(request: Request): string | null {
  return readCookie(request, STATE_COOKIE);
}

// Cleared the moment the callback consumes it, used or not: a state cookie is
// worth nothing a second time.
export function clearStateCookie(): string {
  return serializeCookie(STATE_COOKIE, '', 0);
}

export async function sessionCookie(cipher: Cipher, spotifyUserId: string): Promise<string> {
  return serializeCookie(SESSION_COOKIE, await cipher.encrypt(spotifyUserId), SESSION_MAX_AGE_SECONDS);
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, '', 0);
}

// The Queue Owner id the cookie names, or null for no cookie, a tampered one,
// or one sealed under a key that has since rotated - all the same "not signed
// in" to the caller.
export async function readSession(cipher: Cipher, request: Request): Promise<string | null> {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return null;
  try {
    return await cipher.decrypt(value);
  } catch {
    return null;
  }
}
