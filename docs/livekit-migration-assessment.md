# LiveKit migration assessment

**Date:** 2026-10-16
**Question:** *"Can we make the calls the way it should be by doing it all with the LiveKit
integration? Or is there something else we can do about it?"*
**Status:** research only. No application code was modified.

---

## 0. The answer, up front

**No — a full LiveKit migration is not the way to make the calls right. Add TURN to the pipeline
you already have.**

Here is the whole argument, in the order that convinced me:

1. **Almost everything on the "make it the way it should be" list has already been fixed, in the
   last few commits.** The connect deadline, ICE restart, audio routing, Bluetooth, ringing
   ownership, foreground service and resume path are all real, tested code with tests
   (`src/components/calls/callSetup.test.ts`, `callScreenRecovery.test.ts`, `callLinkRecovery.test.ts`).
   A migration replaces ~250 lines of working, understood logic with a dependency that does the same
   job behind an API you have not yet learned.
2. **Of the gaps that remain, exactly one is a class of problem we cannot close ourselves: TURN.**
   Not "the hardest" — the only one. Everything else is either already done, or is a few days of
   work, or is a dependency swap.
3. **LiveKit does not supply TURN in a form this app could borrow.** LiveKit's TURN is
   authenticated by the LiveKit JWT and gated on an established signal connection, so it is only
   reachable by a client that has already joined a room. If TURN is what you want, LiveKit is the
   wrong instrument for it — you want coturn or a managed TURN provider, wired into the pipeline
   you have.
4. **LiveKit owns none of the part of calling that is actually hard on Android.** Incoming-call
   ringing, the locked-screen full-screen intent, `IncomingCallActivity`, the `phoneCall` foreground
   service, the ongoing-call notification with its chronometer and Mute/Speaker/End actions, the
   FCM data-only push, the single-ring-owner handover between the overlay and the notification
   channel — all of that is media-plane-independent, all of it is already built here, and all of it
   survives a LiveKit migration untouched. The recent commits that fixed real bugs were almost
   entirely in *that* layer, not the media layer.
5. **The migration carries a hard native cutover and a young SDK.** `@livekit/react-native@3.0.0`
   shipped 2026-09-11 — five weeks old. Its WebRTC fork (`@livekit/react-native-webrtc@144.2.0`)
   is on WebRTC **M144** while upstream `react-native-webrtc` is now on **M155** and this app is on
   **M124**. Both packages export the same native symbols, so they cannot coexist: adopting LiveKit
   means *removing* the working `react-native-webrtc@124.0.7`.
6. **The web-parity argument for an SFU is empirically wrong for this repo.**
   `web-test/` is a working browser peer running the *same* custom P2P pipeline against the *same*
   Convex deployment, and its README says so explicitly. Browsers were never blocked from this
   pipeline.

Everything below is the evidence for those six claims, and the specifics of what to do instead.

---

## 1. What we actually have

### 1.1 The pipeline, as it stands

| Layer | Implementation | Where |
|---|---|---|
| Media | `react-native-webrtc@124.0.7` (WebRTC **M124**), 1:1 peer-to-peer | `WebRTCCallScreen.tsx:534` |
| ICE servers | `stun:stun.l.google.com:19302` only. **No TURN, no TURN/TCP, no TURN/TLS** | `WebRTCCallScreen.tsx:62-64` |
| Signalling | Convex `callSignals` rows: `offer` / `answer` / `ice`, polled by `useQuery`, deleted by `consumeSignals` | `convex/calls.ts:510-562` |
| Call records | Convex `calls` table, strictly 1:1 (`callerId` + single `calleeId`), `finishCall` is the single writer | `convex/calls.ts:79-96`, `convex/schema.ts` |
| Connection lifecycle | `advanceLink` state machine: per-phase armed deadlines, bounded recovery ladder (2 attempts × 20 s), ICE restart | `callSetup.ts:385-498` |
| Network handover | `CallNetworkModule` (ConnectivityManager) reports the *current* network's identity → triggers recovery | `WebRTCCallScreen.tsx:396-428` |
| ICE restart | `restartIce()` + `createOffer({ iceRestart: true })`, guarded by `canRestartIce` | `WebRTCCallScreen.tsx:289-317`, `callSetup.ts:520-524` |
| Audio | `CallAudioModule.kt`: `MODE_IN_COMMUNICATION` with **no** routing override, `preferredCommunicationDevice` ordering (BT SCO → wired → USB → earpiece), `ownsAudioMode`/`ownsRoute` acquired-not-inferred | `CallAudioModule.kt:357-510` |
| Background survival | Notifee foreground service overridden to `foregroundServiceType="phoneCall"`, with `FOREGROUND_SERVICE_PHONE_CALL` + `MANAGE_OWN_CALLS` | `ongoingCall.ts:69`, `AndroidManifest.xml` |
| Ringing | Two channels (ring `incoming_call_v5` / silent `ongoing_call_v1`), full-screen intent → `IncomingCallActivity`, foreground ring with a single module-scope owner keyed by `callId` | `callNotifications.ts`, `foregroundRinging.ts`, `IncomingCallActivity.kt` |
| Ongoing call | Chronometer anchored to `answeredAt - clockOffset`, Mute/Speaker/End actions dispatched outside React into `callMediaState` | `ongoingCall.ts:61-115`, `callStore.ts` |
| Telemetry | **None.** No `getStats()`, no candidate-pair type, no connect-rate, no duration analytics | — |

**Architectural constraints that matter for this decision:**

- RN 0.81.4, `newArchEnabled=true`, Hermes, `minSdk 24`, `targetSdk 36`.
- The `calls` table has a single `calleeId`. **Group calls are not representable in the current
  schema.** LiveKit rooms would require a schema migration before a three-person call could exist.
- There is a `web-test/` Next.js 15 harness that already speaks this exact pipeline from a browser.

### 1.2 What the previous audits concluded, and what has changed since

`docs/call-pipeline-audit.md` (and `docs/audit/14-livekit-alternatives.md`, three days old) both
recommended LiveKit. Those recommendations were made against an **earlier, broken** version of this
codebase, and the reasons they gave have largely evaporated:

| Audit 13/14's reason for LiveKit | Status today |
|---|---|
| CometChat's JS call packages are proprietary with a competitive-use prohibition | **Moot.** Commit `7535aef` "Remove CometChat entirely". Nothing proprietary remains in the call path. |
| "Not viable for web — browsers need an SFU; a pure Convex-signalled P2P mesh does not work through NAT" | **Contradicted by the repo.** `web-test/lib/callEngine.ts` is a browser peer on the same Convex signalling, and its README says "There is no LiveKit, no CometChat media SDK and no server-side relay". |
| No ICE restart, no reconnect ladder, no connection state (audit findings #5, #6, #7, #8) | **Fixed.** `advanceLink`, `restartIce`, `CallNetworkModule`, `connectionStatusLabel`. |
| Bluetooth ignored, audio dropped out of voice-call mode on resume (findings #18, #19) | **Fixed.** `useDefaultRoute`, `preferredCommunicationDevice`, `hasOngoingCall()` gate before release. |
| Foreground ringing with no sound owner (finding #28 context) | **Fixed.** `foregroundRinging.ts` module-scope ownership + handover. |

The remaining audit finding that is still true is **#9: no TURN**. That is the finding this document
is about.

---

## 2. Is LiveKit viable for React Native today?

### 2.1 The package, version, licence, maturity

| | Fact | Source |
|---|---|---|
| RN SDK | `@livekit/react-native` **3.0.0**, Apache-2.0, published **2026-09-11** | [npm](https://registry.npmjs.org/@livekit/react-native/latest) |
| Required peers | `livekit-client ^2.19.0`, `@livekit/react-native-webrtc ^144.2.0` (both hard peers) | npm manifest |
| RN WebRTC fork | `@livekit/react-native-webrtc@144.2.0`, MIT, WebRTC **M144** | [npm](https://registry.npmjs.org/@livekit/react-native-webrtc/latest), [README](https://github.com/livekit/react-native-webrtc) |
| Core client | `livekit-client@2.22.4`, Apache-2.0 | [npm](https://registry.npmjs.org/livekit-client/latest) |
| Server | `livekit/livekit`, Apache-2.0, 21.5k stars | [GitHub](https://github.com/livekit/livekit) |
| RN SDK repo | 290 stars, 41 open issues, last push 2026-10-15 (active) | [GitHub API](https://api.github.com/repos/livekit/client-sdk-react-native) |
| Fork repo | **25 stars, 22 open issues** | [GitHub API](https://api.github.com/repos/livekit/react-native-webrtc) |

**Maturity verdict: workable, not settled.** 3.0.0 is five weeks old. The WebRTC fork it depends on
is a 25-star project that upstream's own README says "shouldn't be used independently." Open issues
worth naming, all against Android/Hermes — the exact stack here:

- [`#468`](https://github.com/livekit/client-sdk-react-native/issues/468) — `new Room()` throws
  `Cannot read property 'prototype' of undefined` on **Hermes/Android**, no stack frame inside the library.
- [`#437`](https://github.com/livekit/client-sdk-react-native/issues/437) — Android background subscription stalls after a remote participant rejoins.
- [`#451`](https://github.com/livekit/client-sdk-react-native/issues/451) — long-idle connections degrade: subscribed tracks stop binding, cascading renegotiation failures, internal-resume races.

None of these are disqualifying. All of them are the kind of thing you find in week three, not week one.

### 2.2 Android incoming calls and locked-screen handling — **LiveKit provides none of this**

This is the finding that most changes the arithmetic, so it is worth stating bluntly.

LiveKit's own RN documentation, [Background Processing](https://github.com/livekit/client-sdk-react-native#background-processing):

> ### Android
> To support staying connected to LiveKit in the background, you will need a foreground service on
> Android. The example app uses `@supersami/rn-foreground-service` for this.

…followed by four `FOREGROUND_SERVICE_*` permissions and two `<service>` declarations you must write
yourself.

For incoming calls, the RN SDK says nothing. On iOS it points at `react-native-callkeep`/CallKit. On
Android it points at a foreground service. **There is no LiveKit equivalent of `IncomingCallActivity`,
no full-screen intent, no ring channel, no ringtone resolution, and no ring-owner handover.**

This app already has all of that, built and debugged across five channel generations
(`incoming_call_v2` → `_v5`, each bump forced by Android's immutable-channel rule). It is roughly
1,000 lines of Kotlin and TS whose entire job is to ring a phone on Android, and it is the layer
where the most recent real bugs lived. **None of it is replaced by adopting LiveKit.**

### 2.3 Audio: a genuine, concrete improvement

LiveKit RN does ship something the audit flagged as missing — `AudioSession`, wrapping Android's
`AudioManager`, configured once at startup via
`LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())` in `MainApplication.kt`, with
`configureAudio({ android: { preferredOutputList, audioTypeOptions, audioFocusMode } })`.

That is a real win over the current arrangement, where `CallAudioModule` and libwebrtc's
`JavaAudioDeviceModule` are two owners of one global audio slot (audit finding #20) and every bug
from "the next incoming call never sounds" to "the headset stopped working" came from that
ambiguity. LiveKit makes the SDK the single owner from process start.

But: we have *already* made ownership explicit and correct (`ownsAudioMode`, `ownsRoute`,
`useDefaultRoute`, `preferredCommunicationDevice`). The marginal gain is removing a class of bug we
have already stopped having, not adding a capability.

### 2.4 New Architecture

| | Status |
|---|---|
| `@livekit/react-native` | `codegenConfig: null`, no `src/specs/` → runs on the legacy interop layer, not TurboModule/Fabric-native |
| Fabric request | Issue [#134](https://github.com/livekit/client-sdk-react-native/issues/134) closed `not_planned`; maintainer: "the interop layer should still work with the new architecture in the meantime" |
| Upstream `react-native-webrtc` | Also interop-only (issue [#1557](https://github.com/react-native-webrtc/react-native-webrtc/issues/1557)) |

**This is a wash, and that matters.** Every option on the table — including the current one — runs
`react-native-webrtc`-derived native modules through the interop layer under `newArchEnabled=true`.
LiveKit does not add a new architectural risk here; it swaps the module already sitting under it.

### 2.5 The finding that undercuts the single biggest technical argument for LiveKit

`livekit-client` sets `continualGatheringPolicy: 'gather_continually'` so that a network change
yields fresh candidates without renegotiation — the exact thing `call-pipeline-audit.md` finding #6
says this app cannot do. **But on React Native it is silently dropped.** Checked at the source, not
the docs:

- `livekit/react-native-webrtc` `src/RTCPeerConnection.ts` (M144): declares `iceServers` and
  `iceTransportPolicy`; **no `continualGatheringPolicy`**.
- `react-native-webrtc` `src/RTCPeerConnection.ts` (`master`, i.e. **M155**): **also no
  `continualGatheringPolicy`.**

So `gather_once` is a property of the react-native-webrtc JS surface, in both the upstream project
and LiveKit's fork. LiveKit on RN does not fix it either.

What LiveKit *does* have, that we do not, is a **signal channel it owns end to end**. Its client
sees its own WebSocket drop the instant the network changes and runs `triggerIceRestart()` /
`restartConnection()` on its own two-tier ladder, instead of waiting for libwebrtc's consent-freshness
timeout. That is a real difference — and it is precisely the difference `CallNetworkModule` was
written to close by hand, from `ConnectivityManager`, with a one-shot comment saying exactly why ICE
cannot be left to notice. We have already built the detection half of the mechanism LiveKit would
give us.

### 2.6 Hard cutover, and what else moves

Both packages define the same native module (`WebRTCModule`) and the same symbol set. They cannot be
autolinked into one build. Adopting LiveKit means **removing** `react-native-webrtc@124.0.7`, which
means the WebRTC stack moves **M124 → M144**. That is an upgrade, and it is also the single highest-
risk item in the whole migration.

Manifest delta required by the fork's
[Android Installation guide](https://github.com/livekit/react-native-webrtc/blob/master/Documentation/AndroidInstallation.md),
against what this app declares today:

| Permission | Present? |
|---|---|
| `MODIFY_AUDIO_SETTINGS` | **No** — add |
| `CHANGE_NETWORK_STATE` | **No** — add |
| `BLUETOOTH_CONNECT` (+ legacy BT pair, `maxSdkVersion=30`) | **No** — add |
| `CAMERA`, `RECORD_AUDIO`, `ACCESS_NETWORK_STATE`, `INTERNET` | Yes |

`minSdk 24` is satisfied (the fork requires ≥24; this app is 24).

---

## 3. The gap analysis: our pipeline vs a managed SFU/SDK

This is the question the document exists to answer. Each row is a class of problem, with an honest
verdict on whether LiveKit closes it and how big it actually is.

| # | Class of problem | Our status | Does LiveKit close it? | Magnitude |
|---|---|---|---|---|
| 1 | **No TURN** | Not addressed. STUN only | **Yes — but only if you adopt LiveKit wholesale.** LiveKit Cloud ships TURN automatically; self-hosted LiveKit ships an embedded TURN server. Its TURN is gated on a LiveKit signal connection, so it cannot be borrowed by this client | **Large and real.** RFC 8835 §3.3 makes TURN a MUST for endpoint-dependent (symmetric) NATs and for UDP-blocking networks. Two phones on consumer mobile data usually connect; corporate/hospitality Wi-Fi with symmetric NAT, some MVNO CGNAT pools, VPN clients, and APNs that throttle UDP **will not connect, at all** — P2P ICE is all-or-nothing |
| 2 | **Reconnection across handovers** | Fixed: `advanceLink` ladder, `restartIce`, `CallNetworkModule` | Yes, but with a different mechanism (its own signal socket) — and **not** by fixing `gather_once`, which is unavailable on RN either way | **Small now.** We already detect the handover in ~1 s instead of ICE's tens of seconds, and re-arm per phase. LiveKit's advantage here is architectural elegance, not capability |
| 3 | **Signalling can lose a candidate, with no recovery** | Still true. Each candidate is an independent Convex mutation, fire-and-forget, no retry, no sequence number, no end-of-candidates marker | **Yes, genuinely.** One persistent WebSocket with `lastMessageSeq` per participant and resumable re-delivery (`resendReliableMessagesForResume`) | **Moderate.** A single lost candidate is usually survivable; the design cannot *notice* or repair it. Real, but it is a rare-event failure, not a daily one |
| 4 | **Connect/transport health is unbounded** | Fixed. `CONNECT_TIMEOUT_MS` armed per phase, no clock armed while connected | Yes | **None.** Already done |
| 5 | **Connection state a user can read** | Fixed. Five-value phase machine, `connectionStatusLabel` shows "Reconnecting…" | Yes | **None.** Already done |
| 6 | **Audio routing / focus ownership** | Fixed, with the ownership bug class explicitly designed out | **Yes, and better** — one owner from process start via `AudioSession` | **Small.** Removes residual ambiguity; adds no capability |
| 7 | **Background / locked-screen call reliability** | Working: `phoneCall` foreground service, FSI permission check + prompt, `IncomingCallActivity`, ongoing notification with chronometer and actions | **No.** LiveKit RN requires *you* to write a foreground service; it has no incoming-call or lock-screen UI at all | **Zero — and migrating risks it.** All of this survives a migration, but none of it is provided by one |
| 8 | **Call quality metrics / telemetry** | **Nothing.** No `getStats()`, no candidate-pair type, no connect-rate, no per-network breakdown | Yes — `Room.connectionQuality`, Cloud dashboard, webhooks; Analytics API on Scale | **Real, but it does not require the SDK.** `pc.getStats()` exists in the installed `react-native-webrtc` (`lib/typescript/RTCPeerConnection.d.ts:82`) and returns the selected candidate-pair. `candidate-pair` → `localCandidateId`/`remoteCandidateId` → candidate `candidateType` (`host`/`srflx`/`prflx`/`relay`) is ~20 lines and tells you exactly how often TURN would be needed |
| 9 | **Group calls** | Not supported. Schema is 1:1 (`callerId` + single `calleeId`) | **Yes** — this is the SFU's actual reason to exist | **Large, but only if group is a requirement.** It is not currently a stated one. A schema migration is needed regardless of media choice |
| 10 | **Media cost scales as n−1** | Irrelevant at n=2 | Yes | **None now.** A mesh maths fact, not a bug |

### 3.1 The honest summary of the table

- **One row (#1) is a real class of problem we cannot close ourselves.** TURN. And it is the only one.
- **One row (#3) is a real design weakness** whose fix happens to be bundled with the SFU.
- **Two rows (#8, #9) are capabilities, not bugs**, and #8 is obtainable today for free.
- **Six rows are already fixed**, and #7 is not something LiveKit provides in the first place.

If a migration delivered rows #1, #3, #8 and #9 and left #7 alone, that is the honest scope of what
LiveKit buys: **NAT traversal, a better signalling transport, telemetry, and the option of group
calls.** Everything else in the "managed SFU" pitch is replacing code we already got right.

---

## 4. What it would cost, architecturally

### 4.1 Signalling moves from Convex rows to rooms + webhooks

**Today:** `signal` inserts a row; `signals` returns them; `consumeSignals` deletes them
(`convex/calls.ts:510-562`). Six mutations per call for the handshake plus one per candidate.

**With LiveKit:**

1. **Token minting in Convex.** A LiveKit access token is a JWT (HS256) whose `iss` is the API key
   and whose `video` grant carries `room`, `roomJoin`, `canPublish`, `canSubscribe`
   ([Access tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants)). This is
   ~15 lines of `node:crypto` in a Convex query — **no new server dependency required**. A 1-hour
   TTL, `identity` = an opaque user id (LiveKit explicitly warns against putting PII in `identity`
   or room name: both are logged and are not covered by PII redaction), `room` = the Convex `callId`.
2. **`callSignals` is deleted** from the schema. The whole 3-function signalling surface goes.
3. **A webhook receiver** — Convex HTTP actions — handling `participant_joined`,
   `participant_left`, `room_started`, `room_finished`, with signature verification. Convex keeps
   being the source of truth for call records; LiveKit tells it what the media plane observed.
4. **`calls.get` stops being the connection-state oracle.** Today the screen's status line is a
   blend of a Convex row status and live `RTCPeerConnection` state. With LiveKit, connection state
   comes from the Room and the row status comes from Convex; they can disagree, and you need an
   explicit rule for which wins.

### 4.2 Call state and history

- Convex **can** remain authoritative — this is the good news and it is genuinely good news.
- `finishCall` as single writer (`convex/calls.ts:79`) survives intact.
- The abandoned-row problem gets *better*: LiveKit emits `room_finished`, so a call killed by a
  process death is closed out by the server rather than by the `ACTIVE_CALL_TTL_MS` sweep.
- **Token refresh changes the model.** LiveKit proactively reissues tokens mid-session; expiry
  impacts the initial connection, not reconnects.
- **Token revocation is Cloud-only.** Self-hosted, removing a participant does not invalidate their
  existing token, and LiveKit's own guidance is to mint short-TTL tokens instead. That is a real
  security regression to weigh against self-hosting.
- **Group calls still need a schema migration.** `calleeId: v.id("users")` becomes a participants
  list or a join table. Independent of the media choice.

### 4.3 What does *not* change

This is the important list, because it is most of the code and all of the recently fixed bugs:

| Kept as-is | Where |
|---|---|
| `IncomingCallOverlay`, ring/notification ownership and handover | `foregroundRinging.ts`, `IncomingCallOverlay.tsx` |
| `IncomingCallActivity`, full-screen intent, `canRingOverLockScreen` prompt | `IncomingCallActivity.kt`, `CallIntentModule.kt` |
| Both notification channels, ringtone resolution, `timeoutAfter` bound | `callNotifications.ts` |
| Ongoing-call foreground service, chronometer, Mute/Speaker/End | `ongoingCall.ts` |
| `callStore` / `callMediaState` | `callStore.ts`, `callMediaState.ts` |
| FCM data-only push + terminal pushes + stale-ring reconcile | `convex/push.ts`, `background.ts` |
| `calls` table, `finishCall`, `history`, `talkDurationMs`, Profile totals | `convex/calls.ts`, `convex/lib/callTiming.ts` |
| `CallNetworkModule` (becomes unnecessary — LiveKit has its own detection) | `CallNetworkModule.kt` |
| `advanceLink`, `connectionStatusLabel`, the tests for both | `callSetup.ts` + tests |
| `web-test/` harness — or a second engine behind a flag | `web-test/lib/callEngine.ts` |

### 4.4 Dependency and code delta

| | Today | With LiveKit |
|---|---|---|
| Native WebRTC | `react-native-webrtc@124.0.7` (M124), 1.47 MB unpacked | `@livekit/react-native-webrtc@144.2.0` (M144), 1.89 MB unpacked — **replaces, not adds** |
| JS | — | `@livekit/react-native@3.0.0` (0.65 MB) + `livekit-client@2.22.4` (**12 MB** unpacked, incl. `.map` files) |
| APK | baseline | Larger: M144 `.so` files × 4 ABIs (`armeabi-v7a, arm64-v8a, x86, x86_64`) + `livekit-client` bundle. Worth measuring before committing — consider dropping to `arm64-v8a,armeabi-v7a` |
| RN SDK pulls `@livekit/components-react@^2.9.17` as a **runtime** dependency | — | A web-only React component library in a native app's dependency tree. Likely dead weight; verify it is tree-shaken |
| JS deleted | — | ~250 lines: SDP/ICE signalling, candidate queue, signal consumption, `advanceLink` |
| JS added | — | ~150 lines: token plumbing, `LiveKitRoom` wrapper, `registerGlobals()`, `MainApplication.kt` setup |

**Note:** `livekit-client` at 12 MB unpacked is source + maps. The shipped Metro contribution is
much smaller. Measure, don't guess.

### 4.5 Effort estimate

One engineer, including device testing. Estimates, not measurements.

| Work item | Days | Risk |
|---|---|---|
| Remove `react-native-webrtc`, install the LiveKit stack, get RN 0.81.4 + new arch + Hermes to boot, resolve Hermes issue #468 if it bites | 1–2 | **High** — the native cutover |
| `LiveKitReactNative.setup()` in `MainApplication.kt`, `registerGlobals()`, manifest deltas, verify `CallAudioModule`/`CallPackage` still register cleanly | 0.5–1 | Medium — we have custom Kotlin in the same package |
| Convex: mint access tokens; delete `callSignals`; add webhook receiver + signature verification | 1–2 | Low |
| Rewrite `WebRTCCallScreen` on `Room`; port mute/camera/flip/hang-up/status-line | 2–3 | Low — the state is well understood now |
| Call-state reconciliation (Room state vs Convex row; `room_finished` closes abandoned rows) | 1–2 | Medium — this is where subtle bugs live |
| Audio: adopt `AudioSession`, retire the routing half of `CallAudioModule`, keep the ring half | 0.5–1 | Low |
| Device testing: 2 devices, backgrounded call, screen off, lock screen, handover, TURN-forced path | 2–3 | Medium — this is where you find out |
| `web-test/` harness, or an explicit decision to leave it on the P2P engine | 0.5–1 | Low |
| **Total** | **9–15** | |

**The largest single line is the native module swap — which is the one item LiveKit does not help
with and the one most likely to consume the schedule.**

---

## 5. Pricing and operational reality

Read from [livekit.com/pricing](https://livekit.com/pricing),
[Quotas & limits](https://docs.livekit.io/deploy/admin/quotas-and-limits), and
[Billing](https://docs.livekit.io/deploy/admin/billing) on 2026-10-16.

### 5.1 The free tier exists, and it is a hard cap

| Resource | **Build (free)** | Ship ($50/mo) | Scale ($500/mo) |
|---|---|---|---|
| WebRTC participant-minutes | **5,000 included** | 150,000, then $0.0005/min | 1.5M, then $0.0004/min |
| Concurrent connections | **100** | 1,000 | 5,000 |
| Downstream data transfer | **50 GB** | 250 GB, then $0.12/GB | 3 TB, then $0.10/GB |
| Uptime | 99.99% | 99.99% | 99.99% |
| Analytics API | — | — | Yes |
| Token revocation | Yes | Yes | Yes |

**Two operational facts that matter more than the headline price:**

1. **"On the free Build plan, the included allowance acts as a hard cap — after you exceed it, new
   requests fail rather than incurring overage charges."** Crossing 5,000 participant-minutes/month
   does not bill you; it **breaks your calls**. A beta that outgrows the free tier fails at exactly
   the moment it starts succeeding. `14-livekit-alternatives.md` recorded this as "no overage rate
   published, so you must upgrade" — that is right in spirit and understated: it is a hard stop.
2. **Billing granularity is per second, with a 10-second minimum per WebRTC session** — a 10-second
   call bills 10 seconds, not 1 minute. (This is *better* than the older audit recorded, which said
   1-minute minimum increments.)

### 5.2 Cost at this app's volumes

Assume a 3-minute 1:1 call, two participants, one upstream + one downstream copy.

| | Per call | Per month at 1,000 calls | At 10,000 calls |
|---|---|---|---|
| Participant-minutes | 6 | 6,000 | 60,000 |
| Build (free) | free until 5,000 min, then **calls fail** | **~$830/month of calls would fail** | unusable |
| Ship | ~$0.003 + data | $50/mo plan + a few dollars | $50/mo + ~$30 overage + data |

Downstream data is the larger line for video: a 3-minute 640×480 video call is roughly 100–250 MB
downstream, so ~2,500 calls/month is the 50 GB free allowance and ~12,500 calls is the 250 GB Ship
allowance. At Ship rates, data is $0.12/GB.

**Bottom line: $50/month, and it is not the money.** $50/mo is the entire Cloud bill for a small
product. The money is the engineering days and the native cutover risk.

### 5.3 Self-hosting

| | Self-hosted | LiveKit Cloud |
|---|---|---|
| Licence | Apache-2.0, free forever, no caps | Per-plan quotas |
| Architecture | Single-home SFU, one server per room | Global edge mesh |
| TURN | **Embedded, integrated auth** — `turn: { enabled: true, udp_port: 443, tls_port: 443 }` | Included |
| Who runs it | You | LiveKit |
| Max users/room | ~3,000 | No limit |
| Analytics | Custom or external | Dashboard; Analytics API on Scale |
| Token revocation | **Not available** (Cloud-only) | Included |
| Uptime target | None | 99.99% |

Self-hosting requirements, verbatim from the
[deployment guide](https://docs.livekit.io/transport/self-hosting/deployment): a domain with a
trusted (not self-signed) TLS cert, HTTPS termination with a load balancer or reverse proxy, a
**separate domain and certificate for TURN**, UDP 50000–60000, and "we recommend running production
setups on 10Gbps ethernet or faster" with "compute-optimized instance types". Redis is recommended
for production.

That is a real service to run and to keep patched. For a team of this size it is the wrong default.

---

## 6. The LiveKit credentials in `.env.local` — what I verified

The task brief is right to be suspicious. Here is what could and could not be established from this
machine on 2026-10-16. **No secret was printed and no state was mutated**; the API calls attempted
were read-only (`ListRooms` / `ListParticipant`).

| Check | Result |
|---|---|
| `LIVEKIT_URL` host | `synomilo-l9e77ahr.livekit.cloud` — a real, per-project Cloud hostname |
| DNS | Resolves: `143.223.94.107`, `143.223.94.99` |
| TCP 443 | Connects |
| `GET https://<host>/` | **HTTP 200, body `OK`** — the LiveKit node's health response |
| `POST /twirp/livekit.RoomService/ListRooms` with the real key/secret | **401** |
| Same call with no auth, and with a garbage bearer | **401** (identical) — so the 401 does not discriminate; LiveKit's node returns 200 for *unknown* paths, meaning path existence tells us nothing |
| `api.livekit.io` DNS | Does not resolve from this environment, so the Cloud management API could not be reached |

**Conclusions, stated at the confidence they deserve:**

- **High confidence: a LiveKit Cloud project named `synomilo-l9e77ahr` exists and its server is
  live and serving on 443.** A key in `.env.local` is not the same thing as a running project, and
  this is the check that distinguishes them.
- **No confidence either way about the API key and secret.** They could not be validated from here.
  401 with valid-looking credentials is indistinguishable from 401 with garbage, because the
  project node rejects all twirp auth. **Treat them as unverified.**

**What must be verified before any decision depends on them** — all of it is a five-minute exercise
in the LiveKit Cloud dashboard (`https://cloud.livekit.io`):

1. Sign in as the project owner and confirm the project is still there and not suspended.
2. **Confirm the plan tier.** Build vs Ship vs Scale, and whether it is on a trial that expires.
   This decides whether 5,000 participant-minutes is a cap or a floor.
3. **Regenerate and re-read the API key and secret** from the dashboard; compare against
   `.env.local`. A revoked or rotated key looks exactly like "the app does nothing" — which is the
   current state of this integration.
4. **Confirm TURN is enabled for the project.** Cloud projects get TURN by default, but a regional
   or pinned project can differ.
5. **Mint one token and join one room from a browser** at
   `https://cloud.livekit.io` → the project's "try it" / `lk room join`. If that works, the
   credentials are live.
6. Delete or rotate anything that turns out to be dead. `LIVEKIT_API_SECRET` sitting in a
   `.env.local` that nothing consumes is a credential with no owner and no rotation schedule.

**Worth saying plainly: nothing in the app has ever used these keys.** There is no code path, no
deployment, and no history of a call that touched LiveKit. Whether they work is currently
unknowable from the repository.

---

## 7. Migration risk, and the smallest safe way to find out

### 7.1 How risky is swapping the media layer mid-flight?

High, and structurally so:

- **It is a hard native cutover, not an additive install.** `react-native-webrtc` and
  `@livekit/react-native-webrtc` define the same native module. There is no configuration in which
  both are present and only one is used. For any period where both code paths must exist, they must
  be **two builds**, not two runtime flags.
- **It moves the WebRTC stack M124 → M144** underneath an app whose call pipeline was only just
  debugged on M124. Every "fix" in the recent history was a fix against a specific libwebrtc
  behaviour (`MediaStreamTrack.stop()` being JS-only, `restartIce()` deferring to the next local
  description, `gather_once` semantics). Those diagnoses were verified *against M124's source*. Some
  will not apply, and some will have changed shape.
- **It replaces the layer with the newest tests and the least operational history.** A user-visible
  regression in a shipping messenger is the worst possible place to meet an unfamiliar library.
- **It does not simplify the app.** Webhooks, token lifecycle, two state sources to reconcile, a
  vendor dependency, a new failure vocabulary (`ConnectionState` vs our `LinkPhase`), and an SDK
  release cadence to track — all of that is added, and none of the ringing/notification work
  disappears.

### 7.2 The smallest safe way to evaluate it

**A behind-a-flag prototype cannot work here, and that is worth knowing before anyone proposes one.**
Because the native module swap is compile-time, "flag" has to mean "separate build flavour":

```
productFlavors {
    livekit { ... }   // @livekit/react-native + @livekit/react-native-webrtc, no react-native-webrtc
    webrtc  { ... }   // today's stack
}
```

So the honest shape is a **third variant of the app, installable side by side with the shipping one**,
sharing the Convex backend. That is genuinely safe: the shipping APK is untouched, both use the same
`calls` table, and the evaluation is done with real devices on real networks.

Proposed sequence, each step cheap and independently abandonable:

**Step 0 — before writing a line (½ day, no code).** Verify the credentials per §6. Load the app on
two devices on a real mobile network and on hotel/corporate Wi-Fi and **measure the current connect
rate**. This is the baseline. Without it you cannot tell whether LiveKit improved anything, and §5's
"5,000 free minutes then calls fail" makes guessing dangerous. Instrument with `pc.getStats()` and
the selected candidate-pair type — about 20 lines, available today.

**Step 1 — the spike (2–3 days, throwaway branch).** Install the LiveKit stack, remove
`react-native-webrtc`, confirm RN 0.81.4 + new arch + Hermes boots (watch issue #468), connect to a
Cloud Build room on a physical device, and **hold a 2-minute call with the app backgrounded and the
screen off**. Pin `livekit-client` to a version including the `AbortSignal.any` fix
([client-sdk-js#1700](https://github.com/livekit/client-sdk-js/pull/1700)), which was reported
against this exact RN version.

**Step 2 — the honest comparison (2–3 days).** On the **same two devices, same networks**, with the
livekit variant side by side with the shipping one, measure: connect rate by network type; time to
first media; whether a Wi-Fi→LTE handover survives (ours now has a bounded ladder; does theirs?)
and how long; audio on a Bluetooth headset; audio after background/foreground; audio after a phone
call interrupts. Five minutes of measurement beats a week of opinion.

**Step 3 — decide.** Total ~5–8 days for a defensible answer. If the spike shows LiveKit's connect
rate is materially better *on the networks that are failing today* and nothing else regressed, the
migration is justified and you know exactly why. If not, you have spent a week instead of a quarter.

**Never** do this as a single cutover PR against a shipping app.

### 7.3 What is NOT worth prototyping

- **Incoming-call ringing.** LiveKit does not do it. There is nothing to prototype.
- **Background call survival.** LiveKit makes you write the foreground service. We already wrote it.
- **Call history and durations.** Identical either way; `convex/calls.ts` does not change.
- **The web harness.** It already works on the current pipeline.

---

## 8. Recommendation

### 8.1 If you only do one thing, do this

**Add TURN to the pipeline you already have.**

Not LiveKit. TURN. It is the only remaining gap we cannot close ourselves, and it is closable in
**one to two days** without touching the media layer, the signalling protocol, the call schema, or
a single line of the ringing and notification code that took five channel generations to get right.

Concretely:

1. **Mint short-lived TURN credentials in Convex.** A Convex query returning
   `{ urls, username, credential }` for a TURN server you control, HMAC-signed over an expiry
   (~1 hour). Never in the APK. Returned alongside the existing `calls.get` payload.
2. **Assemble the ICE config per call** instead of the module-level `ICE_SERVERS` constant at
   `WebRTCCallScreen.tsx:62-64`: `{ stun: [google, cloudflare], turn: <signed from server> }`, passed
   into `new RTCPeerConnection(...)` at `WebRTCCallScreen.tsx:534`.
3. **Advertise TURN/UDP on 443 and TURN/TLS on 443.** UDP-on-443 gets through QUIC-shaped allowlists;
   **TURN/TLS on 443 is the only thing that reaches a network that blocks UDP outright.** LiveKit's
   own deployment guide makes the identical recommendation.
4. **Leave `iceTransportPolicy: 'all'`.** `'relay'` would force every call through the relay and add
   cost and latency to the ~95% of sessions that connect directly.
5. **Start with a managed provider** (Cloudflare Calls TURN, Twilio Network Traversal, Metered,
   Xirsys, Nextcloud). Move to self-hosted `coturn` once the relay bill is material. **The
   client-side change is byte-identical either way** — which is the whole reason to do it this way.
6. **Do NOT try to borrow LiveKit's TURN.** It is authenticated by the LiveKit JWT and gated on an
   established signal connection ([deployment docs](https://docs.livekit.io/transport/self-hosting/deployment)),
   so it is unreachable by a client that has not joined a room.

### 8.2 Do this second (½ day, no risk)

**Add `pc.getStats()` reporting of the selected candidate-pair type.** It exists in the installed
`react-native-webrtc` today (`RTCPeerConnection.d.ts:82`). Report `host` / `srflx` / `relay` per call,
plus connect rate and time-to-first-media, bucketed by network type.

This is the cheapest TURN business case that exists: it tells you the real percentage of calls that
*would* have needed a relay, on your users' actual networks, instead of the estimate. It also gives
you the before/after numbers that make any future migration decision defensible — and it is
~20 lines with no new dependency.

### 8.3 Then, honestly reconsidered

Re-open the LiveKit question when one of these becomes true:

- **Group calls are a requirement.** That is the SFU's reason to exist and the one thing here that
  is genuinely large. It needs a `calls` schema migration either way; do the migration once, and
  do it to a model with rooms.
- **Measurement from step 2 shows a materially worse connect rate than you expected** — i.e. TURN
  does not close the gap, because the failure is not NAT.
- **The web app becomes a real product** rather than a test harness. (Today it is not blocked; the
  `web-test` peer proves the pipeline crosses to a browser. A real web app would want
  `gather_continually`, which browsers do have.)

If that day comes, the migration is the right move — and it should be done as the phased,
per-variant programme in §7.2, not as a cutover.

### 8.4 What I would tell the owner, in one paragraph

> The calls work now, and the things that were broken have been fixed properly rather than
> papered over. What is left is one real gap — we have no TURN, so on some Wi-Fi and some mobile
> networks a call simply will not connect, and no amount of clever code fixes that, because you need
> a server in the middle for those cases. A full LiveKit migration is about two weeks of work with a
> real risk of breaking calls that currently work, and it would not touch the part of calling that
> is actually hard on Android — the ringing, the lock screen, the notification — because that part
> is not LiveKit's job and you have already built it. LiveKit also would not fix everything it is
> credited with on React Native: its own React Native WebRTC fork has the same
> `gather_once` limitation we have. So: add TURN this week for one or two days of work, measure
> connect rates for half a day, and then let the numbers decide whether anything bigger is worth
> doing.

---

## Sources

**LiveKit — SDK and repository**
- https://registry.npmjs.org/@livekit/react-native/latest — v3.0.0, Apache-2.0, peers, published 2026-09-11
- https://registry.npmjs.org/@livekit/react-native-webrtc/latest — v144.2.0, MIT
- https://registry.npmjs.org/livekit-client/latest — v2.22.4, Apache-2.0
- https://registry.npmjs.org/livekit-server-sdk/latest — v2.19.1, Apache-2.0
- https://github.com/livekit/client-sdk-react-native — README, `AudioSession`, background processing, `LiveKitReactNative.setup`
- https://github.com/livekit/react-native-webrtc — fork README (M144, "shouldn't be used independently"); `Documentation/AndroidInstallation.md` (permissions, `minSdk 24`)
- `livekit/react-native-webrtc` `src/RTCPeerConnection.ts` — **no `continualGatheringPolicy`**
- `react-native-webrtc` `master` `src/RTCPeerConnection.ts` (v155.0.0) — **no `continualGatheringPolicy`**
- https://github.com/api/repos/livekit/client-sdk-react-native — 290 stars, 41 issues
- https://github.com/api/repos/livekit/react-native-webrtc — 25 stars, 22 issues
- https://github.com/api/repos/react-native-webrtc/react-native-webrtc/releases — 155.0.0 (2026-10-14), 124.0.8 (2026-07-21), 124.0.7 (2025-10-09)
- https://github.com/livekit/client-sdk-react-native/issues/134 — Fabric/New Arch, closed `not_planned`
- https://github.com/livekit/client-sdk-react-native/issues/468 — `new Room()` throws on Hermes/Android
- https://github.com/livekit/client-sdk-react-native/issues/437 — Android background subscription stalls
- https://github.com/livekit/client-sdk-react-native/issues/451 — long-idle connections degrade
- https://github.com/react-native-webrtc/react-native-webrtc/issues/1557 — upstream New Arch is interop-only too
- https://github.com/livekit/client-sdk-js/pull/1700 — `AbortSignal.any` fix for RN 0.81.4

**LiveKit — docs**
- https://docs.livekit.io/transport/sdk-platforms/react-native — RN quickstart, install, `registerGlobals()`
- https://docs.livekit.io/frontends/reference/tokens-grants — JWT structure, `video` grant, token refresh, Cloud-only revocation, "don't put PII in identity or room name"
- https://docs.livekit.io/intro/basics/rooms-participants-tracks — rooms/participants/tracks
- https://docs.livekit.io/reference/internals/livekit-sfu — SFU internals
- https://docs.livekit.io/reference/internals/client-protocol — signalling protocol, `lastMessageSeq`

**LiveKit — pricing and operations**
- https://livekit.com/pricing — plan matrix; Build 5,000 min / 100 concurrent / 50 GB; Ship $50 with $0.0005/min and $0.12/GB overage
- https://docs.livekit.io/deploy/admin/quotas-and-limits — "**on the free Build plan, the included allowance acts as a hard cap … new requests fail**"; metered resources table
- https://docs.livekit.io/deploy/admin/billing — per-second metering, 10-second minimum per WebRTC session, rounding
- https://docs.livekit.io/transport/self-hosting — self-host vs Cloud; token revocation Cloud-only; ~3,000 users/room
- https://docs.livekit.io/transport/self-hosting/deployment — **embedded TURN with integrated auth**, TURN/UDP-443 and TURN/TLS-443, 10Gbps recommendation

**Standards**
- https://www.rfc-editor.org/rfc/rfc8835 — WebRTC MUST support TURN (§3.3), TURN/TCP and TURN/TLS
- https://www.rfc-editor.org/rfc/rfc8656 — TURN; "best to use … only when a direct communication path cannot be established"
- https://datatracker.ietf.org/doc/html/rfc8445 — ICE candidate types (§5.1.1)
- https://www.rfc-editor.org/rfc/rfc5128 — symmetric NAT, endpoint-dependent mapping (§2.4)
- https://w3c.github.io/webrtc-pc/#dom-rtcpeerconnection-addicecandidate — `addIceCandidate` rejects with null `remoteDescription`

**This repo**
- `src/components/calls/WebRTCCallScreen.tsx` — ICE config (62-64), ICE restart (289-317), link tick (336-361), network watch (396-428), PC setup (534), candidate queue + flush (659-743), ongoing notification (842-880)
- `src/components/calls/callSetup.ts` — `advanceLink` (385-498), `canRestartIce` (520-524), `connectionStatusLabel` (166-216)
- `src/components/calls/callStore.ts` — live call state outside React; `hasOngoingCall`
- `src/components/calls/callSetup.test.ts`, `callScreenRecovery.test.ts`, `callLinkRecovery.test.ts`
- `src/notifications/foregroundRinging.ts` — single ring owner keyed by `callId`
- `src/notifications/callNotifications.ts` — `incoming_call_v5` / `ongoing_call_v1`, ringtone resolution
- `src/notifications/ongoingCall.ts` — `phoneCall` foreground service, chronometer anchor, notification actions
- `android/app/src/main/java/com/rajofearth/synomilo/CallAudioModule.kt` — `useDefaultRoute` (440-477), `preferredCommunicationDevice` (495-510), `ownsAudioMode`/`ownsRoute` (357-375)
- `android/app/src/main/java/com/rajofearth/synomilo/CallNetworkModule.kt`, `IncomingCallActivity.kt`
- `convex/calls.ts` — `signal`/`signals`/`consumeSignals` (510-562), `finishCall` (79-96)
- `convex/schema.ts` — `calls` (1:1 `callerId`/`calleeId`), `callSignals`
- `node_modules/react-native-webrtc/lib/typescript/RTCPeerConnection.d.ts:82` — `getStats()` available today
- `web-test/lib/callEngine.ts` + `web-test/README.md` — browser peer on the same Convex P2P pipeline; "There is no LiveKit… no server-side relay"
- `docs/call-pipeline-audit.md`, `docs/audit/13-call-architecture-proposal.md`, `docs/audit/14-livekit-alternatives.md`
- `.env.local` — `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` present, unused by any code path
