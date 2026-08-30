// AES-256-GCM through WebCrypto, so the Instance on workerd and the CLI on
// Node encrypt with one implementation rather than two (ADR-0003).
//
// What this protects against is a database that ends up somewhere it should
// not be: a backup, a synced folder, a data directory committed by accident.
// The key comes from the environment of the process holding the database, so
// it is no defence against someone who already has the host.
export type Cipher = {
  encrypt: (plaintext: string) => Promise<string>;
  decrypt: (ciphertext: string) => Promise<string>;
};

// AES-256 takes a 32-byte key. GCM is specified for a 96-bit nonce, which it
// uses as given; any other length it hashes into one first.
const KEY_BYTES = 32;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// btoa and atob speak binary strings rather than bytes. They are the base64
// both runtimes agree on, where Node has helpers that workerd does not.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The key an operator puts in the environment: 32 random bytes, base64, which
// is one line they can paste and no format of our own to explain.
export function generateSecretKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

// CryptoKey is a global in both runtimes, but Node's types only name it
// through node:crypto, which packages/core may not import.
type SecretKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function importKey(secretKey: string): Promise<SecretKey> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(secretKey);
  } catch {
    throw new Error('The encryption key is not valid base64.');
  }

  // A short key would otherwise fail at importKey with a message about
  // algorithms, which tells the operator nothing about what to do next.
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`The encryption key must be ${KEY_BYTES} bytes, base64 encoded; this one is ${bytes.length}.`);
  }

  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Everything below this takes the Cipher, not the key, so the key is read once
// at the edge and never travels through the store.
export async function cipher(secretKey: string): Promise<Cipher> {
  const key = await importKey(secretKey);

  return {
    async encrypt(plaintext) {
      // A nonce may never repeat under one key, so it is drawn fresh per value
      // rather than derived from anything about the row.
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));

      // The nonce is not a secret, only unique, so it travels in front of the
      // ciphertext and one column holds the whole of what is needed to read it
      // back. GCM's authentication tag is already on the end of sealed.
      const bytes = new Uint8Array(IV_BYTES + sealed.byteLength);
      bytes.set(iv);
      bytes.set(new Uint8Array(sealed), IV_BYTES);
      return toBase64(bytes);
    },

    async decrypt(ciphertext) {
      // Wrong key, altered ciphertext and a column that was never encrypted
      // all arrive here, and all mean the same thing to whoever is reading the
      // message: this value cannot be trusted, so it is not returned.
      try {
        const bytes = fromBase64(ciphertext);
        const opened = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) },
          key,
          bytes.subarray(IV_BYTES),
        );
        return decoder.decode(opened);
      } catch {
        throw new Error('Could not decrypt: wrong encryption key, or the stored value was altered.');
      }
    },
  };
}
