# Deployment and self-hosting docs

Status: ready-for-agent

Blocked by: 06, 12

Wrangler config: D1 binding, Static Assets, a minute-granularity Cron Trigger,
secrets for the Spotify app and the encryption key.

README: the two ways to run it, and the manual step that cannot be automated —
onboarding a Queue Owner means the operator pastes their Spotify account email
into the developer dashboard, because development mode allows five authenticated
users and individuals cannot apply for extended quota (ADR-0001).

Measure CPU time per invocation against the free plan's 10 ms and record the
number. If it is tight the answer is the $5/month Workers plan, not a redesign.
