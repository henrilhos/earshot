import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cipher, generateSecretKey } from './crypto.ts';

const TOKEN = 'AQD-the-refresh-token';

test('reads back what it encrypted', async () => {
  const sealed = await cipher(generateSecretKey());

  const ciphertext = await sealed.encrypt(TOKEN);

  assert.notEqual(ciphertext, TOKEN);
  assert.equal(await sealed.decrypt(ciphertext), TOKEN);
});

test('survives a round trip through another Cipher on the same key', async () => {
  const secretKey = generateSecretKey();

  const ciphertext = await (await cipher(secretKey)).encrypt(TOKEN);

  assert.equal(await (await cipher(secretKey)).decrypt(ciphertext), TOKEN);
});

// The nonce is drawn fresh per value, so two rows holding the same token do not
// announce that they do.
test('encrypts one value to a different ciphertext every time', async () => {
  const sealed = await cipher(generateSecretKey());

  const [first, second] = [await sealed.encrypt(TOKEN), await sealed.encrypt(TOKEN)];

  assert.notEqual(first, second);
  assert.equal(await sealed.decrypt(second), TOKEN);
});

test('carries text that is not ASCII', async () => {
  const sealed = await cipher(generateSecretKey());

  assert.equal(await sealed.decrypt(await sealed.encrypt('Versão Acústica ♪')), 'Versão Acústica ♪');
});

test('refuses to read a value encrypted under another key', async () => {
  const ciphertext = await (await cipher(generateSecretKey())).encrypt(TOKEN);
  const other = await cipher(generateSecretKey());

  await assert.rejects(other.decrypt(ciphertext), /wrong encryption key/);
});

// GCM authenticates as well as encrypts, which is what makes an edited row an
// error rather than a token that fails at Spotify for no stated reason.
test('refuses to read a value that was altered', async () => {
  const sealed = await cipher(generateSecretKey());
  const ciphertext = await sealed.encrypt(TOKEN);

  // One character past the nonce, which is the first 16 of the base64.
  const flipped = `${ciphertext.slice(0, 20)}${ciphertext[20] === 'A' ? 'B' : 'A'}${ciphertext.slice(21)}`;

  await assert.rejects(sealed.decrypt(flipped), /wrong encryption key, or the stored value was altered/);
});

// What a database written before this landed holds in the column.
test('refuses to read a value that was never encrypted', async () => {
  const sealed = await cipher(generateSecretKey());

  await assert.rejects(sealed.decrypt(TOKEN), /Could not decrypt/);
});

test('says so when the key is the wrong length', async () => {
  await assert.rejects(cipher(btoa('too short')), /must be 32 bytes, base64 encoded; this one is 9/);
});

test('says so when the key is not base64', async () => {
  await assert.rejects(cipher('not base64 at all!'), /not valid base64/);
});

test('generates a 32-byte key, and a different one each time', () => {
  const secretKey = generateSecretKey();

  assert.equal(atob(secretKey).length, 32);
  assert.notEqual(secretKey, generateSecretKey());
});
