# Encrypt refresh tokens at rest

Status: ready-for-agent

Blocked by: 03

AES-256-GCM through WebCrypto, key from an environment variable, ciphertext in
the database. WebCrypto rather than `node:crypto` so it is one implementation
across both runtimes (ADR-0003).

The threat is a leaked backup or a data directory committed by accident, not an
attacker who owns the host — the key sits next to the data. Say so in the
README rather than implying more.
