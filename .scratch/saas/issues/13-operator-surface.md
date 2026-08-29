# Operator surface

Status: ready-for-agent

Blocked by: 09, 12

The operator is named by an environment variable holding their Spotify user id
— configuration, not a database column, so there is no way to accidentally
promote someone and no bootstrapping problem on a fresh Instance.

Exactly two abilities: remove a Queue Owner (their rows, tokens and
Subscriptions; removing their dashboard allowlist entry only stops future
logins), and see Instance-wide Deliveries. Nothing more.
