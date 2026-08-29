# Browser-assisted CLI login

Status: ready-for-agent

Blocked by: 09

`lfss login <instance-url>` starts a local callback server, opens the browser,
and the Instance redirects back to `127.0.0.1` with a freshly minted token —
the shape `gh auth login` has. `src/auth.ts` is already a localhost callback
server and is the pattern to reuse.

Tokens are long-lived and revocable from the SPA rather than expiring. At five
users, forced re-login is friction with no threat model behind it.
