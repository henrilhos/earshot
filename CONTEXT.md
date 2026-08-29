# earshot

Mirrors what other people are listening to on Last.fm into a Spotify queue,
once per new track.

## Language

**Watched Account**:
A Last.fm user whose listening the system observes. Public scrobbles only, so
watching one requires no permission from them.
_Avoid_: target user, source user, tracked user

**Queue Owner**:
The person whose Spotify queue receives tracks, and who has authorized the
system against their Spotify account.
_Avoid_: user, account, tenant, subscriber

**Subscription**:
The standing arrangement by which one Queue Owner receives tracks from one
Watched Account. Many-to-many: a Queue Owner may hold several, and several
Queue Owners may hold one against the same Watched Account.
_Avoid_: watch, follow, link, job

**Now Playing**:
The track Last.fm currently reports as playing for a Watched Account. Absent
when they are not listening.
_Avoid_: current track, scrobble

**Delivery**:
One attempt to place one track in one Queue Owner's Spotify queue on behalf of
one Subscription, together with how it turned out. Recorded whether or not the
track reached the queue. At most one per Now Playing per Subscription, never
retried.
_Avoid_: queueing, push, sync, delivery attempt

**Instance**:
One deployment of the application, with its own Spotify app registration and
its own set of Queue Owners. The operator runs one; anyone else who wants the
service runs another.
_Avoid_: server, tenant, installation

**Outcome**:
How a Delivery turned out. One of `queued`, `no_match`, `no_device`,
`unauthorized`, or `error`. A `queued` Delivery also records whether the match
was exact or a fallback to Spotify's top search result.
_Avoid_: status, result, state
