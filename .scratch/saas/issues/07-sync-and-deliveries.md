# Fan one poll out to many Deliveries

Status: ready-for-agent

Blocked by: 03, 06

One poll per Watched Account, one Delivery per Subscription. Two Queue Owners
watching the same person means one Last.fm request and two queue attempts.

Record every attempt with an Outcome — `queued`, `no_match`, `no_device`,
`unauthorized`, `error` — plus an `exact` flag. There is no `duplicate`
outcome: when Now Playing has not changed, no Delivery row is created at all.

`exact` matters because `findTrack` falls back to Spotify's top search result
when nothing matches exactly (`src/spotify.ts:158`). Without the flag a lucky
guess and a confident match are indistinguishable in the history, and the
README already concedes the fallback is "occasionally embarrassing".
