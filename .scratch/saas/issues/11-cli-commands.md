# CLI command surface and mode selection

Status: ready-for-agent

Blocked by: 04, 10

`login <url>`, `logout`, `watch <lastfm-user>`, `unwatch`, `list`, `status`,
`run` (standalone only), `auth` (standalone Spotify authorization).

Mode is inferred from a saved profile: present means hosted, absent means
standalone. No `--local` flag on every invocation.

`status` prints the mode loudly, and commands invalid for the current mode fail
with a real explanation — `run` in hosted mode must say that the Instance is
already polling, not silently start a second poller and queue every track
twice. That is the failure that will actually bite, because both modes look
like they are working.
