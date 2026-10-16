# Call pipeline audit

**Scope.** Calls in this repo are custom peer-to-peer WebRTC (`react-native-webrtc` 124.0.7) with
Convex as the signalling relay. LiveKit is not in the media path — `grep -r "livekit" src/` returns
nothing; the `.env.local` key is inert. Media is STUN-only, single server, no TURN.

Already fixed and **not** re-litigated here: the callee-side ICE queue flush, the missing
`android.permission.CAMERA`, the foreground ring with no owner, and the unconditional audio-mode
release.

This document does two things: state the reference behaviour from primary sources, then audit the
code against it. Verdicts are `correct` / `defect` / `gap` / `acceptable tradeoff`. Anything that
genuinely needs a device to settle is called out as such rather than guessed.

---

## 1. Reference behaviour

### 1.1 LiveKit's call pipeline

LiveKit is an SFU, not P2P — that difference matters for this audit, because the structural things a
hand-rolled P2P pipeline gets wrong are largely *absorbed* by the SFU. What is left is the part that
is worth copying.

Sources:

- [LiveKit SFU (reference)](https://docs.livekit.io/reference/internals/livekit-sfu)
- [`client-sdk-js/src/room/PCTransport.ts`](https://github.com/livekit/client-sdk-js/blob/main/src/room/PCTransport.ts)
- [`client-sdk-js/src/room/RTCEngine.ts`](https://github.com/livekit/client-sdk-js/blob/main/src/room/RTCEngine.ts)
- [`client-sdk-js/src/room/Room.ts`](https://github.com/livekit/client-sdk-js/blob/main/src/room/Room.ts)
- [`client-sdk-js/src/room/DefaultReconnectPolicy.ts`](https://github.com/livekit/client-sdk-js/blob/main/src/room/DefaultReconnectPolicy.ts)
- [`client-sdk-js/src/room/defaults.ts`](https://github.com/livekit/client-sdk-js/blob/main/src/room/defaults.ts)
- [LiveKit: Improving connectivity with TURN](https://docs.livekit.io/oss/deployment/)

**Signalling.** One persistent WebSocket (`SignalClient`), not a row per message. Offers, answers
and candidates are all multiplexed over it, and the protocol carries a `lastMessageSeq` per
participant so a resumed connection can ask for the gap and have it resent
(`RTCEngine.resendReliableMessagesForResume`). Delivery is ordered and resumable; the client's
transport never silently drops a message.

**Offer ownership is decided by the server, not by the client.** A join response flags
`subscriberPrimary`, and `PCTransportManager` is constructed as `publisher-only` /
`subscriber-primary` / `publisher-primary` accordingly. Exactly one peer is the offerer for any
given negotiation, so glare cannot occur and perfect negotiation is not needed.

**Negotiation is serialised, not just debounced.** `negotiate` is a 20 ms debounce over a `Mutex`
(`offerLock`) held for the whole of `createAndSendOffer`. If a local offer is already pending, the
request sets a `renegotiate` latch instead of issuing a second offer.

**Answers are deduplicated by offer id, not by hope.** `setRemoteDescription` refuses an answer whose
`offerId` is not `latestOfferId`, refuses a second answer for an offer already in flight
(`answerInFlight`), and refuses one already applied (`answeredOfferId`). An answer for a stale offer
is logged and dropped — it does not corrupt signalling state.

**ICE candidate queueing is explicit and unconditional.**
`PCTransport.addIceCandidate`:

```js
async addIceCandidate(candidate) {
  if (this.pc.remoteDescription && !this.restartingIce) {
    return this.pc.addIceCandidate(candidate);
  }
  this.iceLog.debug('queuing remote ICE candidate until remote description applied', …);
  this.pendingCandidates.push(candidate);
}
```

and `applyRemoteDescription` drains `pendingCandidates` immediately after the remote description is
applied, then clears `restartingIce`. Note the second condition: during an ICE restart, candidates
are queued *even though* a remote description exists, because the new candidates belong to a new ICE
generation the old remote description has not accepted.

**ICE restart has a defined escalation path.** `createAndSendOffer({iceRestart: true})` sets
`restartingIce`; if the client is sitting in `have-local-offer` it re-applies the current remote
description first (rollback) so the restart offer is valid on top of negotiated state; if there is
no remote description at all it throws `NegotiationError("ICE restart requested without a remote
description, peer connection must be recreated")`. It never silently stalls.

**Reconnection is a two-tier state machine with backoff.** `RTCEngine` carries
`PCState = New | Connected | Disconnected | Reconnecting | Closed`. A signal drop or a PC `failed`
enters `handleDisconnect`, which consults a `ReconnectPolicy`
(`[0, 300, 1200, 2700, 4800, 7000…]` ms, ±50% jitter, first retry 0–500 ms random) and then either
**resumes** (signal reconnected, `triggerIceRestart()`, peer connections kept) or **restarts**
(`restartConnection()`, peer connections rebuilt, full rejoin). A failed resume escalates to a full
restart; an unrecoverable error (`UnexpectedConnectionState`) gives up immediately. Server-initiated
`LeaveRequest` actions (`RECONNECT`, `RESUME`, `DISCONNECT`) are handled explicitly.

**Transport health is bounded, not observed.** `verifyTransport()` returns false if the transport is
stuck in `CONNECTING` longer than `peerConnectionTimeout` (15 s default) — a PC that never reaches
`CONNECTED` *and* never reports `FAILED` would otherwise look healthy forever. Separately, a
sustained server-reported connection quality of `LOST` while connected and publishing for 10 s forces
a full reconnect. `Room` reconciles on a 4 s timer
(`CONNECTION_RECONCILE_FREQUENCY_MS`).

**ICE servers come from the server, per join.** `makeRTCConfiguration` copies
`serverResponse.iceServers` (STUN *and* TURN with credentials) into `RTCConfiguration`, and honours
`clientConfiguration.forceRelay` by setting `iceTransportPolicy: 'relay'`. LiveKit also ships an
embedded TURN server integrated with its own auth, and advertises TURN over UDP/443 and TURN/TLS.

**`continualGatheringPolicy: 'gather_continually'`.** Candidates keep being gathered for the life of
the connection, so a network change produces fresh candidates without any renegotiation.

**Connection state is a first-class, five-value surface.** `ConnectionState =
disconnected | connecting | connected | reconnecting | signalReconnecting`, exposed on `Room` and
emitted as events. "Reconnecting" is a state the user can be told about, not an absence.

**What hand-rolled pipelines typically get wrong, per the above:** no serialisation of offers; no
answer deduplication; dropping early candidates; no ICE restart, and no plan B when restart is
impossible; no bounded transport health; no reconnect ladder; no server-supplied TURN credentials; no
continual gathering.

### 1.2 Canonical WebRTC guidance

Source: [W3C WebRTC: Peer Connection, §Perfect Negotiation Example](https://w3c.github.io/webrtc-pc/#perfect-negotiation-example)
and [§The `addIceCandidate` method](https://w3c.github.io/webrtc-pc/#dom-rtcpeerconnection-addicecandidate).

**Why early candidates must be queued.** `addIceCandidate` step 4.1 is normative:

> If `remoteDescription` is `null` return a promise rejected with an `InvalidStateError`.

There is no buffering in the platform: a candidate that arrives before `setRemoteDescription` is a
hard rejection. The spec's own answer is that the *local* side buffers its own gathered candidates in
an `[[EarlyCandidates]]` slot until `setLocalDescription` releases them, and the application must do
the mirror-image thing for remote candidates. Perfect negotiation's reference handler calls
`await pc.addIceCandidate(candidate)` and treats a throw as fatal (suppressed only for ignored
offers) — it relies on the browser's `[[EarlyCandidates]]` for its own side and on signalling
ordering for the remote side.

**Why dropping early candidates causes intermittent failure.** Candidates arrive from a separate
channel and carry no ordering relationship to the SDP. On mobile, gathering starts at
`setLocalDescription`, so a peer commonly emits its first candidates *before* its offer/answer
mutation has even been acknowledged by the signalling server. A receiver that applies candidates
immediately and swallows the rejection loses those candidates permanently. Which candidates you lose
varies per call and per network, so the failure is not a consistent "never connects" — it is
"connects sometimes", specifically when a host candidate happens to be reachable (same LAN, some
Wi-Fi) and not otherwise. ICE will then burn its own consent-freshness and retransmit timers before
reporting `failed`, which is why the symptom is a long silent "Connecting…" rather than an error.

**Perfect negotiation** (`makingOffer` / `ignoreOffer` / `isSettingRemoteAnswerPending`, polite peer
rolls back, impolite peer ignores) exists to let *both* peers drive `addTrack`/`removeTrack`
concurrently without glare. A pipeline with a fixed caller-may-offer / callee-answers rule does not
need it — glare is impossible by construction. What it *does* need is the candidate queue and the
operations chain, which the spec mandates independently.

Also normative and commonly missed: `RTCOfferOptions.iceRestart` — "Performing an ICE restart is
recommended when `iceConnectionState` transitions to `failed`."

### 1.3 NAT traversal

Sources: [RFC 8835 §3.3](https://www.rfc-editor.org/rfc/rfc8835.txt),
[RFC 8656](https://www.rfc-editor.org/rfc/rfc8656.html), [RFC 8445](https://datatracker.ietf.org/doc/html/rfc8445).

Four candidate types, per RFC 8445 §5.1.1: host, server-reflexive (via STUN or TURN), peer-reflexive,
relayed (via TURN only).

**STUN gives you server-reflexive candidates only.** A STUN server tells a client the public
address:port its own outbound packet appeared to come from. That is useful only if the NAT's
mapping is address-and-port *independent* (cone NAT) and the filtering is permissive, because the
peer must be able to send back to that exact mapping.

**Symmetric NAT** (RFC 5128 §2.4, "endpoint-dependent mapping") allocates a *different* public
mapping per destination. The reflexive address the peer learned is only valid for traffic arriving
from the peer — which is fine — but a stricter symmetric-plus variant, and any NAT that also filters
by source, means neither side's hole opens. This is the case ICE cannot solve on its own.

**The normative requirement.** RFC 8835 §3.3, on what a WebRTC implementation must support:

> In order to deal with situations where both parties are behind NATs of the type that perform
> endpoint-dependent mapping (as defined in [RFC5128], Section 2.4), TURN [RFC8656] MUST be
> supported.
>
> In order to deal with firewalls that block all UDP traffic, the mode of TURN that uses TCP … MUST
> be supported, and the mode of TURN that uses TLS over TCP … MUST be supported.

RFC 8656's abstract states the economics plainly: TURN "comes at a high cost to the provider …
it is best to use a TURN server only when a direct communication path cannot be established."
So TURN is a **fallback**, not a default path — ICE's candidate priority already prefers
host > srflx > relay.

**What STUN-only costs you in practice.** Consumer mobile networks (CGNAT on LTE/5G) are usually
address-dependent but not symmetric, and UDP generally passes, so STUN-only P2P usually works on a
phone on mobile data. It fails on: enterprise/campus/hotel Wi-Fi with symmetric NAT; some carrier
CGNAT pools and MVNO configurations; any network where UDP is blocked or throttled (corporate VPN,
some hotel and school networks, some APNs); and users tunnelling traffic through a VPN client. With
no TURN there is no fallback at all in those cases — the call simply never connects, and the only
honest thing the client can do is time out and say so. Google's own WebRTC samples ship
`turn:`/`turns:` entries in their default config for exactly this reason.

### 1.4 Android audio

Sources: [`AudioManager`](https://developer.android.com/reference/android/media/AudioManager),
[`AudioAttributes`](https://developer.android.com/reference/android/media/AudioAttributes).

**Modes.** `MODE_NORMAL` — "Normal audio mode: not ringing and no call established."
`MODE_IN_COMMUNICATION` — "In communication audio mode. An audio/video chat or VoIP call is
established." `MODE_RINGTONE` — "Ringing audio mode." A stuck `MODE_IN_COMMUNICATION` tells the audio
flatterer that a voice session owns the device: the ringer is muted or redirected, and the
`MODE_IN_COMMUNICATION` signal-processing path (echo cancellation tuned for voice, voice-call
bandwidth) is engaged. Hence the well-known symptom: a call that leaves the mode behind makes the
*next* incoming call inaudible. The fix is never "reset the mode at random" — it is that each owner
releases only the state it acquired.

**Communication device vs speakerphone.** `MODE_IN_COMMUNICATION` alone makes the platform choose the
route (Bluetooth/wired headset if connected, else earpiece). `setCommunicationDevice(device)` and
`isSpeakerphoneOn` are *overrides*. Calling either at call setup — before the user has expressed a
preference — is what forces a Bluetooth headset to be ignored. On API 31+,
`clearCommunicationDevice()` returns to platform default routing and is the correct way to "undo" an
override.

**Audio focus.** `AUDIOFOCUS_GAIN_TRANSIENT` for a ring: gain for the duration, then give it back.
`AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE` is wrong here — it would block the call's own audio session
from taking focus on answer.

**Ringer vs notification stream.** `AudioAttributes.USAGE_NOTIFICATION_RINGTONE` is documented as
"Usage value to use when the usage is telephony ringtone"; `USAGE_NOTIFICATION` is "Usage value to
use when the usage is notification." The distinction is not cosmetic: usage decides which stream
volume applies, whether the ringer's silent/vibrate mode applies, and which DND filter may suppress
the sound. Android's own calling-app guidance uses
`USAGE_NOTIFICATION_RINGTONE` + `CONTENT_TYPE_SONIFICATION` + legacy `STREAM_RING` for the incoming
call channel
([`voip-app/notifications`](https://developer.android.com/develop/connectivity/telecom/voip-app/notifications)).
The correct ownership model for a ringing notification vs an active call: **the ring channel is
born with ringtone attributes; the ongoing-call channel is born silent; the ringing notification and
the active call are different channels because importance and sound are immutable once created**
(see §1.5).

### 1.5 Foreground vs background ringing

Sources: [`voip-app/notifications`](https://developer.android.com/develop/connectivity/telecom/voip-app/notifications),
[Create and manage notification channels](https://developer.android.com/develop/ui/compose/notifications/channels),
[Android 14 behaviour changes — secure full-screen intents](https://developer.android.com/about/versions/14/behavior-changes-14),
[`NotificationChannel`](https://developer.android.com/reference/android/app/NotificationChannel),
[Notifee foreground service](https://notifee.firebase.google.com/docs/foreground-service).

The established pattern:

1. **Two channels.** Incoming calls: `IMPORTANCE_HIGH`, ringtone sound, vibration, `setSound(
   RingtoneManager.getDefaultUri(TYPE_RINGTONE), AudioAttributes(USAGE_NOTIFICATION_RINGTONE,
   CONTENT_TYPE_SONIFICATION).setLegacyStreamType(STREAM_RING))`. Ongoing calls: `IMPORTANCE_DEFAULT`
   or lower, **no sound**, not alertable. You cannot share one channel, because "After you create a
   notification channel, you can't change the notification behaviors. The user has complete control
   at that point" — importance, sound and vibration are frozen at creation.
2. **One sound source per app state.** Incoming notification (looping sound, full-screen intent,
   Accept/Decline) when the app is not visible; in-app UI plus in-app sound when it is. Android's own
   framework resolves the handover for you — "The notification manager framework will display your
   notification as a heads-up notification if the user is actively using the phone. When the user is
   not using the phone, your full-screen incoming call UI is used instead" — but that resolution
   happens at *display* time and cannot be reversed when the user backgrounds the app mid-ring, which
   is why the ringing notification must remain able to ring on its own.
3. **Accept stops the ring before anything else**, releases focus, and posts the ongoing
   notification. Accept/decline must be idempotent and must tear down unconditionally, including on
   the failure path.
4. **A foreground service typed for the call** keeps the process alive: on Android 14+,
   `foregroundServiceType="phoneCall"` requires both `FOREGROUND_SERVICE_PHONE_CALL` and
   `MANAGE_OWN_CALLS`, or `startForeground` throws `SecurityException`.
5. **Full-screen intents are special app access on Android 14+.** `USE_FULL_SCREEN_INTENT` alone is
   no longer sufficient — a non-calling app is blocked by default and the notification is silently
   downgraded to a heads-up. Check with `NotificationManager.canUseFullScreenIntent()` and prompt.
6. **Nothing rings for longer than the ring window.** A platform-side bound on every ring owner
   (channel `timeoutAfter`, native timeout, server-side timeout) so that a ring whose app was killed
   cannot outlast the call.
7. **Ongoing call notifications should use `Notification.CallStyle`** (API 31+) — "Because incoming
   and ongoing calls are high-priority events, these notifications receive top priority in the
   notification shade", and the system forwards them to other devices.

---

## 2. Findings

Severity is user impact on a real Android phone on a real mobile network. `file:line` is the
primary site.

### WebRTC / signalling

| # | Reference behaviour | What the code does | Verdict | Severity | file:line |
|---|---|---|---|---|---|
| 1 | ICE candidates queued until a remote description exists; flushed immediately after | `flushPendingIce()` drains the queue right after `setRemoteDescription`, before the answer is created and sent. Matches the spec and LiveKit | **correct** | — | `WebRTCCallScreen.tsx:451-463,478,490` |
| 2 | Glare impossible by fixed roles; no perfect negotiation needed | Caller always offers, callee always answers. Structurally safe | **correct** | — | `WebRTCCallScreen.tsx:385-394,472-486` |
| 3 | Signals applied in order, once each | `appliedSignalsRef` marks each `_id` synchronously before any `await`, so a re-entrant effect run cannot double-apply. Ordering preserved by `createdAt` sort | **correct** | — | `WebRTCCallScreen.tsx:465-469`; `convex/calls.ts:544-547` |
| 4 | Signalling is ordered, resumable, and never silently drops a message | Every SDP fragment and every candidate is an independent, fire-and-forget Convex mutation. `sendSignal(...).catch(log)` on failure; no retry, no sequence number, no resumable stream, no end-of-candidates marker | **gap** | High | `WebRTCCallScreen.tsx:333-347,385-394`; `convex/calls.ts:510-532` |
| 5 | ICE restart is the documented remedy for `failed`, with an escalation path when it is impossible | No `restartIce()`, no re-negotiation, no `pc.setConfiguration`. `iceconnectionstatechange` is only read into state for display | **gap** | High | `WebRTCCallScreen.tsx:377-379` |
| 6 | `continualGatheringPolicy: 'gather_continually'` so a network change yields fresh candidates for free | Not exposed by `react-native-webrtc` 124's `RTCConfiguration` (`node_modules/react-native-webrtc/src/RTCPeerConnection.ts:56-62`), so gathering is `gather_once`. Combined with #5, an IP change is unrecoverable | **gap** | High | `WebRTCCallScreen.tsx:55-57,321` |
| 7 | `peerConnectionState` is a five-value surface with a `reconnecting` state the user is told about | `disconnected` renders as "Reconnecting…" and then nothing acts on it. There is no reconnecting *behaviour*, only a label | **gap** | High | `WebRTCCallScreen.tsx:362-373`; `callSetup.ts:186-188` |
| 8 | Connect/transport health is bounded by a *deadline per attempt*, and re-armed per attempt | `connectDeadlineRef` is written once when the row flips to `active` and the interval then runs for the life of the call. `shouldGiveUpConnecting` returns false only while `connected`/`closed` — so **any** later `disconnected`/`checking`/`new` past the 25 s mark hangs the call up with "Connection failed" | **defect** | High | `WebRTCCallScreen.tsx:578-595`; `callSetup.ts:209-221` |
| 9 | TURN available as a fallback candidate type | `stun.l.google.com:19302` only. No `turn:`, no `turns:`, no `iceTransportPolicy` | **defect** | High | `WebRTCCallScreen.tsx:55-57` |
| 10 | Negotiation serialised behind a lock; stale answers rejected by offer id | Single-shot, so no lock needed; but `setRemoteDescription` failures are logged and the signal left unconsumed rather than being distinguished by kind. Acceptable for a fixed two-peer call | **acceptable tradeoff** | Low | `WebRTCCallScreen.tsx:500-508` |
| 11 | Send `pc.localDescription` after `setLocalDescription` | Sends `JSON.stringify(offer)` from `createOffer`. libwebrtc's `createOffer` output already carries `ice-ufrag`/`ice-pwd`/fingerprint, so this is safe in practice, but it is not the value the peer is meant to receive if the stack ever munges the local description | **acceptable tradeoff** | Low | `WebRTCCallScreen.tsx:386-393,480-486` |
| 12 | One `signals` read, ordered by a monotonic sequence | Sorted by `createdAt` from `Date.now()`. Two server mutations in the same millisecond tie, and the index range scan's tie order is not contractual | **gap** | Low | `convex/calls.ts:544-547` |
| 13 | Queues drained even when a remote description already exists, because a restart introduces a new ICE generation | Not applicable — there is no restart. Flagged so the ICE-restart fix does not regress into the LiveKit bug | n/a | — | `WebRTCCallScreen.tsx:451-463` |
| 14 | Peer connection lifecycle state is reset together | `remoteDescSetRef`, `appliedSignalsRef` and `pendingIceRef` are *not* cleared when the PC is torn down and rebuilt by the media effect. Currently unreachable (`token` only changes at sign-in/restore/sign-out) but it is a live landmine | **gap** | Low | `WebRTCCallScreen.tsx:110-112,405-423` |
| 15 | Async work is cancelled on unmount | The signals effect has no cancellation and keeps applying signals to a closed PC after unmount; per-signal errors are logged | **gap** | Low | `WebRTCCallScreen.tsx:430-514` |
| 16 | Consumed messages are acknowledged | `appliedSignalsRef` is updated before `consumeSignals` runs, and `consumeSignals(...).catch(()=>{})` swallows failure — so a failed delete leaves rows that will never be re-processed. Same for rows still queued when a call ends | **gap** | Low | `WebRTCCallScreen.tsx:466-469,510-512` |
| 17 | Server rejects signalling for a terminal call | `calls.signal` accepts any status, including `ended`/`missed`/`rejected` | **gap** | Low | `convex/calls.ts:517-531` |

### Android audio

| # | Reference behaviour | What the code does | Verdict | Severity | file:line |
|---|---|---|---|---|---|
| 18 | `MODE_IN_COMMUNICATION` leaves routing to the platform; `setCommunicationDevice` is only an override applied on user intent | `applyAudioRoute(false)` at call setup, which calls `setCommunicationDevice(TYPE_BUILTIN_EARPIECE)` (or `isSpeakerphoneOn = false` pre-S). **A connected Bluetooth or wired headset is ignored for the whole call** because nobody pressed "Earpiece" | **defect** | High | `WebRTCCallScreen.tsx:319`; `CallAudioModule.kt:385-397` |
| 19 | Each owner releases only what it acquired; the route is not disturbed while a call is live | Returning to the foreground mid-call runs `hideOngoingCallNotification` → `releaseAudioRoute()` → `releaseAudio()`, which clears the communication device, turns the speakerphone off and forces `MODE_NORMAL` — while the peer connection is live. This is exactly the "minimise, tap the notification to come back" path | **defect** | High | `WebRTCCallScreen.tsx:636-642` → `ongoingCall.ts:124-131` → `callMediaState.ts:73-83` → `CallAudioModule.kt:412-435` |
| 20 | Ownership must be acquired, not inferred | `ownsAudioMode` is set to `true` precisely when the mode was *not* already `MODE_IN_COMMUNICATION` — i.e. exactly when `react-native-webrtc` has not yet claimed it. In practice `CallAudio` wins that race (mode is set before `addTrack`), then force-clears a mode libwebrtc also believes it owns | **defect** | Medium-High | `CallAudioModule.kt:380-384,412-435` |
| 21 | Ring uses `USAGE_NOTIFICATION_RINGTONE` + legacy `STREAM_RING` | Uses `USAGE_NOTIFICATION` for the `MediaPlayer`, the vibration attributes and the focus request. The KDoc at `CallAudioModule.kt:466-475` asserts that `USAGE_NOTIFICATION_RINGTONE` "does not exist on this platform" — it does, and is documented as "the usage is telephony ringtone". Consequence: the ring follows notification volume, ignores the ringer's silent/vibrate mode, and is subject to the notification DND filter rather than the alarm/priority policy a call should be under | **defect** | Medium | `CallAudioModule.kt:466-479` |
| 22 | Incoming-call channel born with ringtone audio attributes | `sound:` is a bare URI string through Notifee, with no `AudioAttributes`. androidx's `NotificationChannelCompat` default is `USAGE_NOTIFICATION`/`CONTENT_TYPE_SONIFICATION`, i.e. notification stream, not ringer — *probably*; the Notifee core AAR is not in the Gradle cache here so this needs a device check | **gap** | Medium | `callNotifications.ts:203-220` |
| 23 | Every ring owner has a sound fallback | `CallAudioModule.start` returns `false` when `RingtoneManager.getDefaultUri(TYPE_RINGTONE)` is null, and the foreground ring then never starts. The notification path has a bundled fallback for exactly this case. With "ringtone = None", a foreground incoming call is **silent** | **defect** | Medium | `CallAudioModule.kt:107-115` vs `callNotifications.ts:150-176` |
| 24 | `AUDIOFOCUS_GAIN_TRANSIENT`, not `_EXCLUSIVE`, so the call's own session can take focus on answer | Correct, and deliberately reasoned | **correct** | — | `CallAudioModule.kt:222-243` |
| 25 | Audio focus for the call itself | Not requested by this app; delegated to `react-native-webrtc`'s `JavaAudioDeviceModule`, constructed at `WebRTCModule.java:93`. Correct *if* the library requests it — not verified here | **acceptable tradeoff** | — | `node_modules/react-native-webrtc/.../WebRTCModule.java:93` |
| 26 | `Vibrator.cancel()` scoped to the requesting app | `cancelVibration()` cancels without an app scope; pre-API 26 that is device-wide | **gap** | Low | `CallAudioModule.kt:289-291` |

### Foreground / background ringing

| # | Reference behaviour | What the code does | Verdict | Severity | file:line |
|---|---|---|---|---|---|
| 27 | Two channels: incoming (HIGH, rings) and ongoing (LOW, silent) | Exactly that. Separate ids, and separate ids bumped on every behavioural change because channels are immutable | **correct** | — | `callNotifications.ts:44-51,193-234` |
| 28 | One sound source per app state, with a handover that cannot leave a gap | `IncomingCallRingBridge` (module-scope ownership keyed by callId) + AppState handover that posts the notification *before* stopping the native ring, gated on `ringIsWithNotification` so a shade pull cannot restart the ringtone | **correct** | — | `IncomingCallOverlay.tsx:170-243`; `foregroundRinging.ts:66-138` |
| 29 | Ring teardown on every terminal path, including failures | `silenceRing` runs before the mutation and `teardownRinging` again in `finally`; `IncomingCallActivity.onDestroy` cancels posted ring notifications natively for paths with no JS at all | **correct** | — | `IncomingCallOverlay.tsx:103-106,132,151`; `IncomingCallActivity.kt:184-222` |
| 30 | Incoming-call notification is non-dismissable | `ongoing: false`, and `EventType.DISMISSED` is routed to `calls.reject`. A user who swipes the notification to silence the ring has declined the call. Android's reference uses `setOngoing(true)` | **acceptable tradeoff** | Medium | `callNotifications.ts:279-286`; `background.ts:256-259` |
| 31 | A call in progress suppresses a second incoming ring | `IncomingCallOverlay` renders for *any* ringing call and does not read `useCallStore`. `convex/calls.ts start` only clears *my own* stale rings, so a second incoming call is created and rings over a live call. The callee cannot answer it ("You are already on another call") | **defect** | Medium | `IncomingCallOverlay.tsx:60-79`; `convex/calls.ts:151-164,317-339` |
| 32 | Accept navigates only if the accept succeeded | The deferred accept's `.finally` opens `CallScreen` unconditionally, so a rejected accept ("already on another call", "no longer ringing") still navigates, takes `MODE_IN_COMMUNICATION` and shows a phantom "Connecting…" callee screen until the server's 60 s window expires | **defect** | Medium | `App.tsx:296-308` |
| 33 | `phoneCall` foreground service with its permission pair | `FOREGROUND_SERVICE_PHONE_CALL` + `MANAGE_OWN_CALLS` declared; Notifee's service overridden to `phoneCall` | **correct** | — | `AndroidManifest.xml:36-37,162-165` |
| 34 | Full-screen intent is special app access on Android 14+; check and prompt | `canRingOverLockScreen()` gates a one-time prompt that deep-links to the settings screen | **correct** | — | `App.tsx:506-539`; `CallIntentModule.kt:171-206` |
| 35 | Every ring bounded by the ring window | Server `markTimedOut` at 60 s, notification `timeoutAfter` at 60 s, native ring timeout at 60 s, ring-screen auto-dismiss, `PENDING_CALL_TTL_MS` at 60 s | **correct** | — | `convex/calls.ts:15,174-178`; `callNotifications.ts:296`; `CallAudioModule.kt:461` |
| 36 | `Notification.CallStyle` on API 31+ | Not used. Costs Call-category ranking and cross-device forwarding, not correctness | **gap** | Low | `callNotifications.ts:274-312` |
| 37 | Ring screen does not busy-wait | `resolveAfterSettling()` sleeps the main thread in up to a 1.2 s poll loop before deciding whether to draw | **acceptable tradeoff** | Low | `IncomingCallActivity.kt:275-282` |

---

## 3. What is still wrong, ordered by user impact

**1. A call in progress can never recover, and a stale deadline kills it if it takes too long.**
`WebRTCCallScreen.tsx:578-595` arms a single 25 s connect deadline when the row flips to `active` and
never re-arms it. `callSetup.ts:209-221` treats every non-`connected` state as "never going to
connect". Combine that with no ICE restart (#5), no continual gathering (#6), and
`disconnected` being display-only (#7): a Wi-Fi→LTE handover, a lift, a tunnel, or a congested cell
that stalls consent freshness for a few seconds puts the connection into `disconnected` — and if the
call is older than 25 s the user is hung up with "Connection failed" within one tick. If it happens
in the first 25 s, the user sits on "Reconnecting…" with no recovery attempt and no new candidates
ever being gathered, until the same deadline fires. This is the single highest-impact remaining
problem because it is deterministic, it hits the most common mobile event, and the peer is told the
call ended.

**2. No TURN, so a real call simply never connects on a real network.**
`WebRTCCallScreen.tsx:55-57`. See §4.

**3. Signalling can lose a candidate permanently, with no recovery path.**
Each ICE candidate is an independent Convex mutation whose failure is logged and dropped
(`WebRTCCallScreen.tsx:333-347`). There is no end-of-candidates marker, no re-offer after gathering
completes, and no retry, so the app is trickle-only with an unreliable transport and no non-trickle
fallback. LiveKit is trickle-only too, but over a resumable stream with sequence numbers. A single
lost candidate is survivable; the design has no way to notice or repair it.

**4. Bluetooth headsets are ignored, and coming back to the app breaks the audio route.**
`CallAudioModule.kt:385-397` forces the earpiece at setup, so a user on a car kit or a Bluetooth
headset hears the call from the phone. Then `WebRTCCallScreen.tsx:636-642` → `ongoingCall.ts:124-131`
→ `CallAudioModule.kt:412-435` clears the communication device, drops the speakerphone and forces
`MODE_NORMAL` the moment the user returns to the foreground — on a live call. That is the "sounds
wrong" defect, and it is on the path users take every time they check who just messaged.

**5. A second incoming call rings over a live call, and a failed accept still navigates.**
`IncomingCallOverlay.tsx:60-79` and `App.tsx:296-308`. Two ringing UIs for a call that cannot be
answered, and a call screen for a call that was never accepted.

**6. With the device ringtone set to None, a foreground incoming call is silent.**
`CallAudioModule.kt:107-115` returns `false`; the notification path has a bundled fallback, the
native path does not.

**7. The ring is tagged `USAGE_NOTIFICATION`, not `USAGE_NOTIFICATION_RINGTONE`,** on both the
native ring and (probably) the channel. The KDoc justifying this is factually wrong
(`CallAudioModule.kt:466-475`). Consequence: notification volume instead of ringer volume, DND
"priority only" suppresses the ring, and the ringer's silent mode is ignored. The last of those is
arguably a feature for a call, but it is arriving by accident rather than by design, and the two ring
owners do not agree with each other about which policy applies.

**8. Dead signal rows accumulate.** Failed `consumeSignals`, plus every row still queued when a call
ends (`convex/calls.ts:510-532`). Cosmetic until the table gets large.

---

## 4. The TURN decision

### The requirement, precisely

- RFC 8835 §3.3 makes TURN a MUST for a conformant WebRTC implementation, specifically for
  endpoint-dependent (symmetric) NATs on both peers, for UDP-blocking firewalls (TURN/TCP and
  TURN/TLS), and for the IPv4↔IPv6 case.
- RFC 8656's abstract is the economic counterweight: a TURN server "typically needs a
  high-bandwidth connection to the Internet", and TURN "is best to use … only when a direct
  communication path" cannot be established.
- ICE's own candidate priority already handles this correctly: relay candidates are only used when
  host and server-reflexive pairs fail. Adding TURN does not mean routing everything through a relay;
  it means adding the last rung of the ladder.

### What STUN-only actually costs a consumer calling app

Honest assessment for a 1:1 call between two phones:

- **Works most of the time on mobile data.** Carrier CGNAT is overwhelmingly address-and-port
  dependent, not symmetric, and UDP passes. Two phones on different carriers both get working
  server-reflexive candidates.
- **Fails outright on:** corporate/university/hospitality Wi-Fi with symmetric NAT; some MVNO and
  regional CGNAT pools; corporate VPN clients; networks that filter UDP (some APNs block or throttle
  it). Both peers behind such a network, or one peer behind one with a symmetric NAT, means ICE never
  finds a working pair and the call sits on "Connecting…" until the client's own 25 s timeout — which
  then reports "Connection failed" with no explanation.
- **There is no partial credit.** P2P ICE is all-or-nothing: one unreachable path fails the call.

### Options

| Option | Cost | Notes |
|---|---|---|
| **Managed TURN (e.g. LiveKit Cloud, Cloudflare Calls TURN, Twilio, Metered, Xirsys, Nextcloud)** | Free tier to low tens of USD/month at small call volumes; usually per-GB relayed. Credentials are time-limited and signed by your backend | Fastest to ship. Credentials must come from your own backend (HMAC over an expiry), never be embedded in the APK. |
| **Self-host `coturn`** | One small VM + bandwidth. `coturn` is the reference implementation and is what most people run | Needs a public IP, TLS cert, and UDP+TCP open. Relay bandwidth is your egress bill. |
| **Self-host LiveKit's embedded TURN and *only* its TURN** | Same infra cost as coturn, plus LiveKit as a service you don't otherwise use | Sensible only if you end up adopting LiveKit for the SFU anyway. |
| **Upgrade to an SFU (LiveKit) instead of hardening P2P** | ~1 small VPS + bandwidth; solves NAT *and* signalling and reconnection in one move | The largest change. Not warranted for a strictly 1:1 app with a working signalling relay. |

All four are the same operational shape: a public UDP + TCP/443 endpoint, time-limited HMAC
credentials minted by a Convex mutation, and a second `RTCIceServer` entry.

### Recommendation

**Add TURN, and do it as a fallback, not a rewrite.** Specifically:

1. Mint short-lived TURN credentials in a Convex query (`GET_CREDENTIALS` / REST-style time-limited
   HMAC), returned alongside the existing `calls.get` payload. Expiry ~1 hour; never in the APK.
2. Replace the module-level `ICE_SERVERS` constant with a config assembled from
   `{ stun: [google, cloudflare], turn: <signed from server> }`, fetched once per call and injected
   into `new RTCPeerConnection(...)` at `WebRTCCallScreen.tsx:321`.
3. **Advertise TURN/UDP on 443 and TURN/TLS on 443.** TURN/UDP on 443 gets you through QUIC-shaped
   allowlists; TURN/TLS on 443 is the only thing that gets through a network that blocks UDP
   outright. LiveKit's deployment docs make the same point and the same recommendation
   ([docs.livekit.io/oss/deployment](https://docs.livekit.io/oss/deployment/)).
4. Leave `iceTransportPolicy` at `all`. Setting `relay` would force every call through the relay and
   raise cost and latency for the ~95% of sessions that connect directly.
5. Start with a managed provider to get coverage this week; move to `coturn` once call volume makes
   the relay bill material. The client-side change is identical either way, which is the point of
   doing it as a fallback.

**Do this after fixing #1 and #3.** TURN raises the connect *success rate*; it does nothing for the
case where a working call is torn down by a stale deadline. Both are cheap; #1 is cheaper.

---

## 5. Cannot be determined without a device

Stated rather than guessed:

1. **Whether Notifee 9.1.8 passes `AudioAttributes` to `NotificationChannel.setSound`.** The Notifee
   core AAR is not in the Gradle cache in this checkout and the JS `sound` field is a bare string, so
   finding #22 is inferred from androidx's `NotificationChannelCompat` default. Verify by reading
   `NotificationChannel.getAudioAttributes()` on a device.
2. **Who wins the `MODE_IN_COMMUNICATION` race** between `applyAudioRoute(false)`
   (`WebRTCCallScreen.tsx:319`) and `JavaAudioDeviceModule`'s own `setAudioMode(true)`. The ordering
   depends on whether libwebrtc initialises recording at `getUserMedia` or at `addTrack`. Finding #20
   is a defect either way (the inference is unsound), but its practical magnitude depends on the
   answer.
3. **Whether `react-native-webrtc`'s `JavaAudioDeviceModule` requests and abandons audio focus for
   the call.** Delegated, not audited.
4. **Real-world connect success rate without TURN.** Requires `getStats()` on a sample of calls
   across networks. Worth instrumenting: `pc.getStats()` → selected candidate pair type
   (`srflx` vs `relay` vs `host`) is the cheapest possible TURN business case.
5. **Whether `AppState` reports `inactive` on this RN version during a full-screen-intent launch**
   on the target OEM builds. The handover listens only for `background`, which is correct for the
   shade-pull case but unverified for the FSI case.