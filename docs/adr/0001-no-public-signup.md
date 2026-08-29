# No public signup: the hosted instance serves at most five Queue Owners

Spotify caps an app in development mode at five authenticated users, each added
by hand to an allowlist in the developer dashboard. Extended quota, which lifts
the cap, has been restricted since 15 May 2025 to legally registered
organizations running a launched service with at least 250k monthly active
users; individuals cannot apply. There is therefore no path from five users to
public signup for an app owned by one person.

So the hosted deployment is multi-tenant in its code but private in its
practice: it serves the operator and up to four other people, invited by being
allowlisted in the Spotify dashboard. Anyone else who wants the service runs
their own Instance with their own Spotify app. The product is a self-hostable
web application, not a service strangers join.

## Consequences

- There is no signup flow, no billing, and no password reset to build.
- Onboarding a Queue Owner has a manual step outside the application: the
  operator adds their Spotify account email to the developer dashboard.
- Spotify client credentials are modelled as a nullable per-Queue-Owner field
  falling back to the Instance's own app. Null spends an allowlist slot; set
  means that Queue Owner brought their own Spotify app and spends none. This
  keeps bring-your-own-app available as a later feature rather than a rewrite.
- Queue Owners need Spotify Premium regardless, as the playback endpoints
  require it.
