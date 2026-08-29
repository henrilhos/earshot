# Park Queue Owners whose Spotify grant has died

Status: ready-for-agent

Blocked by: 03, 07

A revoked refresh token currently just throws. On a minute-by-minute cron that
is 1,440 failed token requests a day against the shared Spotify app every other
Queue Owner depends on.

Distinguish permanent from transient: Spotify answering `400 invalid_grant`
means the grant is gone, park the Queue Owner as needing re-authorization and
stop scheduling their Subscriptions. A 502 or a timeout is transient — retry
next tick, forever. Today every failure is treated the same.

Record the parking attempt as an `unauthorized` Delivery, and surface a
reconnect prompt in the SPA.
