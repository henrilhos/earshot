// One-time setup. Run `earshot auth`, open the printed URL, approve access on
// Spotify, and this saves the refresh token the sync uses from then on (until
// you revoke it) as the local Queue Owner.
import { createServer } from 'node:http';
import { authorizeUrl, exchangeCode } from '../core/index.ts';
import { loadSpotifyApp } from './config.ts';
import { DATABASE_FILE, openLocalDatabase } from './database.ts';
import { loadOrFail } from './fail.ts';
import { saveLocalQueueOwner } from './owner.ts';

const app = loadOrFail(loadSpotifyApp);
const db = await openLocalDatabase();

const callback = new URL(app.redirectUri);
const port = Number(callback.port) || 8888;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', callback.origin);
  if (url.pathname !== callback.pathname) {
    res.writeHead(404).end();
    return;
  }

  let failed = false;
  try {
    const error = url.searchParams.get('error');
    if (error) throw new Error(`Spotify returned an error: ${error}`);

    const code = url.searchParams.get('code');
    if (!code) throw new Error('Spotify did not send an authorization code.');

    // The access token expires within the hour and lives in memory; the
    // refresh token is the whole of what is worth keeping.
    const tokens = await exchangeCode(app, code);
    if (!tokens.refresh_token) throw new Error('Spotify did not return a refresh token.');

    await saveLocalQueueOwner(db, tokens.refresh_token);
    res.writeHead(200).end('Success! You can close this tab and go back to the terminal.');
    console.log(`\nSaved your authorization to ${DATABASE_FILE}. Now run \`earshot <lastfm-username>\`.\n`);
  } catch (err) {
    failed = true;
    res.writeHead(500).end('Authorization failed. Check the terminal.');
    console.error(err);
  } finally {
    db.close();
    // Give the browser a moment to receive the response before shutting down.
    server.close();
    setTimeout(() => process.exit(failed ? 1 : 0), 500);
  }
});

server.listen(port, () => {
  console.log('\nOpen this URL to authorize (this is YOUR Spotify account - the queue owner):\n');
  console.log(authorizeUrl(app));
  console.log(`\nWaiting for callback on port ${port}...\n`);
});
