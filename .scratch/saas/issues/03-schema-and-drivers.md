# One schema, two drivers

Status: ready-for-agent

Blocked by: 01

Tables: Queue Owner, Watched Account, Subscription, Delivery, CLI token.

- Queue Owner: Spotify user id, display name, encrypted refresh token, a
  needs-reauthorization flag, and a nullable Spotify client id/secret pair that
  falls back to the Instance's app (ADR-0001, keeps bring-your-own-app cheap
  without building it).
- Watched Account: Last.fm username, last-seen Now Playing key, `next_poll_at`.
- Subscription: Queue Owner + Watched Account.
- Delivery: Subscription, artist, title, outcome, `exact` flag, error message,
  timestamp.

Two drivers behind the injected functions from issue 01: `node:sqlite` for the
CLI, the D1 binding for the Worker. The SQL text must be character-identical
between them; only execution differs.
