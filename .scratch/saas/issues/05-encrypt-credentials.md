# Encrypt refresh tokens at rest

Status: ready-for-agent

Blocked by: 03

AES-256-GCM through WebCrypto, key from an environment variable, ciphertext in
the database. WebCrypto rather than `node:crypto` so it is one implementation
across both runtimes (ADR-0003).

The threat is a leaked backup or a data directory committed by accident, not an
attacker who owns the host — the key sits next to the data. Say so in the
README rather than implying more.

## Comments

Implemented on `t3code/encrypt-credentials`.

- `packages/core/crypto.ts` is the whole of it: `cipher(secretKey)` returns an
  `encrypt`/`decrypt` pair over AES-256-GCM through WebCrypto, so the Instance
  on workerd and the CLI on Node run one implementation (ADR-0003). A fresh
  96-bit nonce per value travels in front of the ciphertext, base64, so one
  column holds everything needed to read the value back and two rows holding
  the same token do not announce that they do. GCM authenticates as well as
  encrypts, so a wrong key, an edited row and a column that was never
  encrypted all raise rather than returning something that fails later at
  Spotify for no stated reason.
- `generateSecretKey()` is exported because the operator needs one and should
  not have to invent the format. `loadCipher()` in `packages/cli/src/config.ts`
  reads `EARSHOT_SECRET_KEY` and, when it is missing, throws a message with a
  freshly generated key to paste into `.env`.
- The key is read at the entry points only, and everything below takes the
  `Cipher` rather than the key. Both call sites were in
  `packages/cli/src/owner.ts` as issue 04 predicted: `saveLocalQueueOwner` and
  `saveLocalRefreshToken` encrypt, `requireLocalRefreshToken` decrypts, and
  `localQueueOwner` still answers with the row as stored. `importJsonFiles`
  takes the `Cipher` too, so a token imported from `tokens.json` lands
  encrypted while the file itself stays as it was found.
- `awaitOrFail` joins `loadOrFail` in `fail.ts`, since importing a key is the
  first startup step that has to be awaited. `earshot auth` reads the key
  before it prints the authorize URL: a key that failed after the callback
  would mean asking Spotify for a second authorization to replace the one that
  could not be stored.
- The README says what this is and is not for. The key sits in `.env` next to
  `earshot.db`, so it covers a leaked backup, a synced folder, a directory
  committed by accident — and not anyone who can already read the environment
  of the process. Claiming more would be a lie.
- Only the refresh token is encrypted. The nullable per-Queue-Owner Spotify
  client secret is still plaintext in the schema; nothing writes it, since
  bring-your-own-app is not built, and whoever builds it puts it through the
  same `Cipher`.
