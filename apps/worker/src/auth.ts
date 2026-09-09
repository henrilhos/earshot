// OAuth start and callback. Sign-in always goes through the Instance's own
// Spotify app (ADR-0001): a Queue Owner cannot bring their own app until they
// exist as a row to bring it to, so bring-your-own-app is a reconnect choice
// for later, not a sign-in choice.
import {
  authorizeUrl,
  type Cipher,
  type Db,
  exchangeCode,
  getSpotifyProfile,
  reason,
  saveQueueOwner,
  type SpotifyApp,
} from '../../../packages/core/index.ts';
import type { Env } from './env.ts';
import { clearStateCookie, newState, readState, sessionCookie, stateCookie } from './session.ts';

function instanceApp(env: Env): SpotifyApp {
  return {
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
    redirectUri: env.SPOTIFY_REDIRECT_URI,
  };
}

// A fresh CSRF token per attempt, carried in a cookie Spotify's redirect
// hands back unchanged: the callback below trusts a code only when it arrives
// with the state this login issued.
export function handleLogin(env: Env): Response {
  const state = newState();
  return new Response(null, {
    status: 302,
    headers: [
      ['location', authorizeUrl(instanceApp(env), state)],
      ['set-cookie', stateCookie(state)],
    ],
  });
}

export async function handleCallback(request: Request, env: Env, db: Db, secretCipher: Cipher): Promise<Response> {
  const url = new URL(request.url);

  const spotifyError = url.searchParams.get('error');
  if (spotifyError) return new Response(`Spotify sign-in failed: ${spotifyError}`, { status: 400 });

  const state = url.searchParams.get('state');
  if (!state || state !== readState(request)) {
    return new Response('Sign-in expired or was tampered with. Try again.', {
      status: 400,
      headers: { 'set-cookie': clearStateCookie() },
    });
  }

  const code = url.searchParams.get('code');
  if (!code) return new Response('Spotify did not send an authorization code.', { status: 400 });

  try {
    const tokens = await exchangeCode(instanceApp(env), code);
    if (!tokens.refresh_token) {
      return new Response('Spotify did not return a refresh token.', { status: 502 });
    }

    const profile = await getSpotifyProfile(tokens.access_token);

    // Upsert: a returning Queue Owner reconnecting after being parked
    // (issue 08) is exactly the case that should clear needsReauthorization -
    // they just proved the grant works again.
    await saveQueueOwner(db, {
      spotifyUserId: profile.id,
      displayName: profile.displayName,
      refreshToken: await secretCipher.encrypt(tokens.refresh_token),
      needsReauthorization: false,
      spotifyApp: null,
    });

    return new Response(null, {
      status: 302,
      headers: [
        ['location', '/'],
        ['set-cookie', clearStateCookie()],
        ['set-cookie', await sessionCookie(secretCipher, profile.id)],
      ],
    });
  } catch (err) {
    return new Response(`Sign-in failed: ${reason(err)}`, {
      status: 502,
      headers: { 'set-cookie': clearStateCookie() },
    });
  }
}
