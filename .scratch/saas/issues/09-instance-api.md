# Instance API and Spotify sign-in

Status: ready-for-agent

Blocked by: 03, 05

Sign in with Spotify is the only login. Identity is the id from `GET /me`;
session is an httpOnly cookie. There is no account system, no invite table and
no password reset: a Queue Owner cannot complete OAuth unless the operator has
already added their email to Spotify's dashboard allowlist, so the gate exists
before any of our code runs (ADR-0001).

Endpoints: OAuth start and callback, session, list/create/delete Subscription,
list Deliveries, `POST /api/tick` (issue 06).
