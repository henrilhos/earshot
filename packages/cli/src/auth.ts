// One-time setup. Run `earshot auth`, open the printed URL, approve
// access on Spotify, and this saves tokens.json with the refresh token the sync
// uses from then on (until you revoke it).
import { createServer } from 'node:http';
import { authorizeUrl, exchangeCode } from '../core/index.ts';
import { loadSpotifyApp } from './config.ts';
import { loadOrFail } from './fail.ts';
import { saveTokens } from './tokens.ts';

const app = loadOrFail(loadSpotifyApp);

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

    saveTokens(await exchangeCode(app, code));
    res.writeHead(200).end('Success! You can close this tab and go back to the terminal.');
    console.log('\nSaved tokens.json. Now run `earshot <lastfm-username>`.\n');
  } catch (err) {
    failed = true;
    res.writeHead(500).end('Authorization failed. Check the terminal.');
    console.error(err);
  } finally {
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
