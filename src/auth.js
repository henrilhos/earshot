// One-time setup script. Run `npm run auth`, open the printed URL, approve
// access on Spotify, and this will save tokens.json with a refresh token
// that src/index.js uses forever after (until you revoke it).
import 'dotenv/config';
import express from 'express';
import fs from 'fs';

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
} = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REDIRECT_URI) {
  console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REDIRECT_URI in .env');
  process.exit(1);
}

// user-modify-playback-state -> add to queue
// user-read-playback-state   -> check there's an active device before queueing
const SCOPES = ['user-modify-playback-state', 'user-read-playback-state'].join(' ');

const app = express();
const port = new URL(SPOTIFY_REDIRECT_URI).port || 8888;

app.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    res.status(400).send(`Spotify returned an error: ${error}`);
    return;
  }

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('Token exchange failed:', tokens);
      res.status(500).send('Token exchange failed. Check the terminal.');
      return;
    }

    fs.writeFileSync('tokens.json', JSON.stringify(tokens, null, 2));
    console.log('\nSaved tokens.json. You can close this tab and run `npm start`.\n');
    res.send('Success! You can close this tab and go back to the terminal.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong. Check the terminal.');
  } finally {
    setTimeout(() => process.exit(0), 500);
  }
});

app.listen(port, () => {
  const authUrl =
    'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: SPOTIFY_CLIENT_ID,
      scope: SCOPES,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    });

  console.log('\nOpen this URL to authorize (this is YOUR Spotify account - the queue owner):\n');
  console.log(authUrl);
  console.log(`\nWaiting for callback on port ${port}...\n`);
});
