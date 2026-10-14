# 14 — LiveKit Alternatives & Licensing Audit

**Question this answers:** (1) "Is LiveKit free?" (2) "Can we do this without LiveKit?"

**Status:** research only. No source file was modified.

**Facts verified:** 2026-10-13. Licences and versions read directly from the npm registry
(`registry.npmjs.org/<pkg>/latest`) and the GitHub REST API, not from blog posts or pricing
aggregators. Pricing read from `livekit.com/pricing.md` and vendor pricing pages.

**Context that changes the maths:** this repo already ships `react-native-webrtc@^124.0.7`
(`package.json`) and already has Convex-based SDP/ICE signalling in production. Any option that
reuses those two things is cheaper to adopt than the raw numbers suggest.

---

## Direct answers

### Is LiveKit free?

Yes, in two clearly different senses, and the difference matters. The **software is free forever**:
the server (`livekit/livekit`) is Apache-2.0, the client SDKs (`livekit-client`,
`livekit-server-sdk`, `@livekit/components-react`, `@livekit/react-native`) are Apache-2.0, and
there is no usage cap, per-seat fee, or feature gate in the licence, so self-hosting costs you
nothing but your own VM and bandwidth. The **hosted service is free with limits**: LiveKit Cloud's
$0/mo "Build" plan includes 5,000 WebRTC participant-minutes, 100 concurrent connections and 50 GB
of downstream transfer per month, and critically it publishes **no overage rate** for WebRTC minutes
on Build, so exceeding 5,000 minutes forces an upgrade to the $50/mo "Ship" plan rather than billing
you per minute. The thing you most wanted to know: **LiveKit Cloud charges no per-user or per-end-user
licence fee.** It meters infrastructure only (participant-minutes, downstream GB, concurrent
connections). Your app's end users are never individually licensed or billed, which is the opposite
of the CometChat arrangement we are escaping.

### Can we do this without LiveKit?

Yes, technically, and the licence-cleanest option is mediasoup (ISC, self-hosted, explicitly
signalling-agnostic so Convex fits). But the honest answer is that "without LiveKit" mostly means
trading a licensed SDK problem for an infrastructure problem: either you run and operate an SFU
yourself (mediasoup, LiveKit self-hosted), or you give up the SFU entirely and ship peer-to-peer
media that collapses somewhere around 4-5 video participants. There is no third option that is
simultaneously free, no-ops, and group-capable. Of the seven alternatives evaluated below, four are
disqualified outright (GPL-3.0 copyleft, or a proprietary paid backend we would be adding), and the
three survivors are LiveKit, mediasoup, and keep-what-we-have P2P. **Recommendation: LiveKit, and
the reason is not the licence, it is that it is the only option where one signalling model and one
media object model serve React Native and Next.js from the same package.**

---

## LiveKit facts

### Licensing

Every figure below read from the npm registry or GitHub API on 2026-10-13.

| Component | Package / repo | Current version | Licence |
|---|---|---|---|
| Core client SDK | `livekit-client` | 2.22.4 | **Apache-2.0** |
| Server SDK (Node) | `livekit-server-sdk` | 2.19.1 | **Apache-2.0** |
| Server SDK (Kotlin) | `livekit/server-sdk-kotlin` | repo | **Apache-2.0** |
| Web UI components | `@livekit/components-react` | 2.9.24 | **Apache-2.0** |
| RN SDK | `@livekit/react-native` | 3.0.0 | **Apache-2.0** |
| RN native WebRTC fork | `@livekit/react-native-webrtc` | 144.2.0 | **MIT** |
| RN CallKit bridge | `@livekit/react-native-callkeep` | 4.3.16 | **ISC** |
| RN UI component kit | `@livekit/components-react-native` | **does not exist** | n/a |
| SFU server | `livekit/livekit` (Go, Pion) | repo | **Apache-2.0** |
| Wire protocol | `livekit/protocol` | repo | **Apache-2.0** |
| Expo config plugin | `livekit/client-sdk-react-native-expo-plugin` | repo | **Apache-2.0** |

Answers to the specific questions:

- **Is the client SDK MIT/Apache?** Apache-2.0. `livekit-client` is the shared core; `@livekit/react-native`
  depends on it as a peer, so RN and web run the *same* media engine.
- **Is the server also open source?** Yes. Apache-2.0, Go, single binary / Docker / Helm charts.
- **There is no `@livekit/components-react-native`.** The package does not exist on npm (404). RN UI
  is assembled from `useTracks` / `RoomAudioRenderer` / `<VideoTrack>` exported by `@livekit/react-native`.
  Confirms `13-call-architecture-proposal.md` §1.

Repo-name corrections (the obvious names 404): the web components live in `livekit/components-js`,
the RN SDK in `livekit/client-sdk-react-native`, the Node server SDK in `livekit/node-sdks`.

### Free tier, precisely

LiveKit Cloud **Build, $0/mo**, no credit card required:

| Resource | Build (free) allowance |
|---|---|
| WebRTC participant-minutes | **5,000 / month** |
| Concurrent participant connections | **100** (total, across all rooms) |
| Downstream data transfer | **50 GB / month** |
| US local phone numbers | 1 free |
| US local inbound minutes | 50 |
| Third-party SIP minutes | 1,000 |
| Transcode minutes (import/record/export) | 60 |
| Ingress / Egress concurrent requests | 2 each |

Billing granularity: time bills in **1-minute minimum increments** (a 10-second connection bills as
1 minute, 70 seconds bills as 2), data in 0.01 GB.

**The Build plan publishes no overage rate.** The Participants row for Build reads "5,000 minutes
included" with no "then $X/min", unlike Ship and Scale. Overrunning Build means upgrading, not
metering.

### What it costs past free

| Plan | Price | WebRTC minutes | Concurrent | Downstream | Overage |
|---|---|---|---|---|---|
| Build | **$0/mo** | 5,000 | 100 | 50 GB | none published |
| Ship | **$50/mo** | 150,000 | 1,000 | 250 GB | $0.0005/min + $0.12/GB |
| Scale | $500/mo | 1.5M | 5,000 | 3 TB | $0.0004/min + $0.10/GB |
| Enterprise | custom | custom | custom | custom | custom |

**Cheapest paid plan is Ship at $50/mo.** No monthly subscription exists below it.

Worked example, 8 people in a 10-minute video call: 80 participant-minutes. On Ship overage that is
$0.04 of media plus a few cents of downstream data, so **under $0.10 per call**. The same call on
Daily or Twilio is $0.32. LiveKit is roughly 8x cheaper per call at Ship rates, and free until
5,000 minutes a month.

### Does Cloud charge per end user?

**No.** This is the clearest and most important fact in this section. The pricing matrix has a
section headed "Participants — *Allow end users to connect to realtime sessions*" and it meters them
in **WebRTC minutes and concurrent connection count**, never in seats or MAU. There is no
per-user licence, no per-end-user fee, and no charge for registering or inviting your own users.
Compare: Daily bills per participant-minute, Twilio per participant-minute, and both remain
seat-less but still scale with your user count in a way LiveKit's entry tier does not.

### Self-hosting

| | Self-hosted | LiveKit Cloud |
|---|---|---|
| Licence fee | none, Apache-2.0 | n/a |
| Usage caps in licence | **none** | per plan |
| Max users per room | up to ~3,000 | no limit |
| Architecture | single-home SFU (one server per room) | global mesh SFU |
| Who runs it | you | LiveKit |
| Uptime target | none | 99.99% |
| Access-token revocation | not available | included |
| Analytics / telemetry | custom or external | dashboard, API on Scale |

Self-host is genuinely free forever. It is bounded by your own hardware, egress and TURN, not by
any vendor limit. Operationally it is a real service to run.

### React Native and the New Architecture — concrete status

This is the part most likely to be quoted from marketing, so here is the raw evidence.

**What is verified:**

1. `@livekit/react-native@3.0.0` has peer dependencies `@livekit/react-native-webrtc ^144.2.0` and
   `livekit-client ^2.19.0`. The WebRTC fork is a **hard** peer dependency.
2. Its `package.json` has **`codegenConfig: null`**, and there is no `src/specs/` directory. There
   are no TurboModule specs and no Fabric components. **It is not New-Architecture-native.**
3. Issue `livekit/client-sdk-react-native#134` "support fabric new architecture" was closed
   **not_planned**. Maintainer davidliu, 2025-02-18: *"We heavily depend on react-native-webrtc, which
   hasn't completed its migration to the new architecture. This probably won't move to the new
   architecture until that migration is completed first... The interop layer should still work with
   the new architecture in the meantime."* Same maintainer, 2025-10-21: *"yes, the library works when
   using the new architecture. There's no extra steps needed."*
4. Issue `#255`: `expo-doctor` reports **"Unsupported on New Architecture: @livekit/react-native,
   @livekit/react-native-webrtc"**. This is a package-metadata gap, not a runtime failure; the
   reporter confirms the library works. Still being reported against Expo SDK 54.
5. Issue `#305` "Unable to connect to Livekit Room in New Architecture 0.79": hangs in
   `connectionStateChanged: connecting`, never reaches connected, no error thrown. Closed by the
   reporter after one day, so **unconfirmed** — but it is a real report against a New Arch app.
6. Issue `livekit/livekit#4014`: `AbortSignal.any is not a function` on **React Native 0.81.4**
   (our exact version) with `livekit-client@2.15.11`. Fixed by `livekit/client-sdk-js#1700`, merged
   2025-10-20. So there is a **version floor** on `livekit-client`; do not pin an old one.

**The hard cutover.** `livekit/react-native-webrtc` is a *fork* of `react-native-webrtc` built on
WebRTC **M144** (upstream 124 is on **M124**). It exports the same symbols (`RTCPeerConnection`,
`RTCSessionDescription`, `MediaStream`, `registerGlobals`). Both cannot be autolinked into one
build. Adopting LiveKit on RN means **removing `react-native-webrtc@124.0.7`**. The fork's own
README says it "shouldn't be used independently."

**The finding that changes the risk framing.** `react-native-webrtc` upstream is *also* not
New-Architecture-native. Issue `react-native-webrtc/react-native-webrtc#1557` "New Architecture -
Considerations/Discussion" states that new arch means TurboModules in C++ and *"we can't do that
here. So well the minimum compatibility thing [is to] keep using the [interop layer]."* In other
words **the interop-layer exposure is shared by every react-native-webrtc-based option on this
decision, including keeping what we already have.** LiveKit does not add New Architecture risk; it
adds a native-module swap that must be done under that same interop regime. RN 0.82+ cannot disable
New Architecture, so the interop path is the only path for this ecosystem, for us and for LiveKit,
alike.

---

## Alternatives compared

All licence data read from the npm registry and GitHub API on 2026-10-13.

| Option | Licence | Browser client | RN client | Works with **our** Convex signalling | Self-hostable | Effort | Verdict |
|---|---|---|---|---|---|---|---|
| **LiveKit** | Apache-2.0 (SDKs + server) | Yes (`@livekit/components-react`) | Yes (`@livekit/react-native@3.0.0`), New Arch via interop only | Yes, replace SDP/ICE with a token mint; Convex stays authoritative | Yes, free forever | **Medium** | **Recommended** |
| **mediasoup + mediasoup-client** | **ISC** (both) | Yes | **Yes, officially** via `registerGlobals()` + `ReactNative106` handler (needs react-native-webrtc ≥ 106; we have 124) | **Yes, by design** — "signaling agnostic: do not mandate any signaling protocol" | Yes, free forever | **Very high** | Licences and signalling fit perfectly; you become the video team |
| **Raw WebRTC P2P, no SFU** | MIT (`react-native-webrtc@124.0.8`) | Yes, native | Yes, already installed | **Yes, already built** (`convex/calls.ts` signal/consumeSignals) | n/a | **Low** | Fine for 1:1; does not survive group video |
| **simple-peer / PeerJS** | MIT (both) | Yes | Yes, via `get-browser-rtc` shim over our existing module | Yes, with a PeerJS server or your own broker | Yes (`peers/peerjs-server`, MIT) | Low–medium | Same mesh ceiling as above, plus a broker to run |
| **Jitsi Meet** | Apache-2.0 (`jitsi-meet`, `@jitsi/react-sdk@1.4.4`, `@jitsi/react-native-sdk@13.2.0`) | Yes, iframe | Yes, but as a **WebView** | No — brings its own Prosody/XMPP signalling | Yes | Low to start, high to make ours | Rejected: it is an embeddable meeting room, not our call feature |
| **Daily.co** | SDKs BSD-2-Clause (`@daily-co/daily-js@0.93.0`, `@daily-co/react-native-daily-js@0.88.0`); **service proprietary** | Yes | Yes | No — requires their cloud backend | No (proprietary SaaS) | Low | Rejected: ~8x the per-call cost, and it is a second paid backend |
| **Agora** | SDK MIT (`agora-rtc-sdk-ng@4.24.9`); **service proprietary** | Yes | Yes | No | No | Low–medium | Rejected: 10,000 free min/mo, then $0.99–$3.99/1000 min; force-UDP/TCP proxy adds a $500/mo floor |
| **Twilio Video** | SDK BSD-3-Clause (`twilio-video@2.36.1`); **service proprietary** | Yes | Yes | No | No | Low–medium | Rejected: $0.004/participant/min with **no free tier**, and capped at 50 participants |
| **Janus WebRTC Gateway** | **GPL-3.0** | No maintained modern SDK | **None** | Yes, but low-level plugin API | Yes | Very high | Rejected on licence and on absence of any RN client |

### Notes on the interesting rows

**mediasoup is the best licence and the best signalling fit in the table.** It is ISC (permissive,
attribution-only), explicitly signalling-agnostic so Convex is a first-class citizen, and it is the
*only* option with a documented, first-class React Native path. That RN path needs
`registerGlobals()` before creating a `Device`, and selects the `ReactNative106` handler. What you
give up: mediasoup is deliberately "super low level" and hands you routers, direct/transports,
producers, consumers, codec negotiation and bandwidth estimation as raw API. That is weeks of work
before the first call connects, and then you own an SFU forever. Community is also thin
(~84k weekly downloads client, ~38k server) compared with LiveKit's ecosystem.

**Janus is GPL-3.0 and that is disqualifying for a closed-source app.** Running Janus as a separate
network service is arguably mere aggregation, so the risk is not automatic. But there is no
first-party React Native client at all, the bundled `janus.js` is a legacy artefact, and the plugin
API is low-level. You would be taking licence ambiguity *and* the largest build for the worst
outcome.

**Jitsi is the trap.** It is genuinely Apache-2.0 and genuinely has both an SDK, so it looks like the
free answer. But `@jitsi/react-native-sdk` renders the whole Jitsi Meet web app in a WebView, so you
cannot make it look like your call screen, and its own documentation says *"Dependency conflicts may
occur between RNSDK and your app. If that is the case, please run `npm i @jitsi/react-native-sdk
--force`."* It also drags in a Prosody/XMPP signalling backend we would not control.

**Raw P2P already exists here.** Convex already carries our SDP/ICE. What breaks is arithmetic, not
software: in a full mesh every participant uploads one copy of its stream to every other
participant, so uplink scales with n-1. At 720p that is a few hundred kbps per stream. A phone on a
mobile connection manages 1:1 comfortably, degrades badly at 3-4 senders, and is unusable for group
video past ~5. Audio-only mesh holds up to roughly 6-8 people. There is also no selective
subscription, no server-side recording, and no simulcast to save the uplink.

---

## Shortlist

Three options survive. Push ringing and the ongoing-call indicator are **media-plane-independent**
and identical in all three, so they are excluded from the column totals and tracked separately in
`01-call-incoming-ringing.md` / `02-call-outgoing-ongoing.md` Phase 0 (~5-7 pd, common to every
path). Do not let that shared work justify a media decision.

Effort is person-days for one engineer, including review and device testing.

| Capability | **LiveKit** (Cloud Build → Ship) | **mediasoup self-hosted** | **Raw WebRTC P2P** (keep current) |
|---|---|---|---|
| (i) 1:1 audio+video, RN **and** web | **8–12 pd** | 18–25 pd | **5–8 pd** |
| (ii) Group calls to ~8 participants | **+2 pd** (rooms are built for it) | +12–18 pd (router/transport/producer/consumer) | **Not achievable for video.** Audio-only to ~6: +3 pd |
| (iii) Ringing push on mobile | 3–4 pd *(shared — identical in all three)* | 3–4 pd *(shared)* | 3–4 pd *(shared)* |
| (iv) Ongoing-call indicator | 2–3 pd *(shared — identical in all three)* | 2–3 pd *(shared)* | 2–3 pd *(shared)* |
| **Media-plane total** | **~10–14 pd** | **~30–43 pd** | **~5–11 pd** (1:1 + audio groups only) |
| Ongoing ops burden | none on Cloud; real if self-hosted | **permanent** — SFU, TURN, Redis, upgrades | none |
| Ceiling | thousands per room | high | ~4-5 video senders |

Reading the numbers: LiveKit's 8-12 pd is dominated by the native module swap, not by the calling
feature. `13-call-architecture-proposal.md` estimated 5-7 pd for the RN-side swap alone; the extra
is the Next.js app, which that document did not cost.

---

## Recommendation

**Adopt LiveKit, starting on LiveKit Cloud's free Build plan, with self-hosting documented as the
escape hatch.**

The deciding factor is not licence and not price. It is that LiveKit is the only option where a
single signalling model and a single media object model (`Room`, `Participant`, `Track`,
`LocalTrackPublication` from `livekit-client`) serve both React Native and Next.js. That is what
makes the web app a rendering variant instead of a second implementation. Every other free option
either requires us to operate an SFU (mediasoup, ~30-43 pd plus permanent ops), collapses at group
size (P2P), or hands us someone else's UI (Jitsi). And the licence question that started this
investigation is settled cleanly: Apache-2.0 throughout, **no per-end-user fee of any kind**, free
forever if self-hosted, and free to ~5,000 participant-minutes a month on Cloud. At Ship rates an
8-person 10-minute call is under $0.10, about 8x cheaper than Daily or Twilio.

**Start on Cloud, not self-hosted.** Build is $0 with no credit card, which covers the entire
development phase and a small beta. The self-host escape hatch is a URL and an API key change
because the client code is identical, so there is no reason to take on media ops before we know we
need to.

### The single biggest risk

**The React Native native-module cutover under the New Architecture.** `@livekit/react-native@3.0.0`
has `codegenConfig: null` and no `src/specs/` directory, so it runs on the legacy interop layer
rather than New-Architecture-native TurboModules; the upstream Fabric request was closed
`not_planned`; `expo-doctor` still flags it as New-Arch-unsupported; and issue `#305` reports a room
stuck in `connecting` with no error on a New Arch app. Complicating it, the SDK hard-depends on
`@livekit/react-native-webrtc@^144.2.0`, a WebRTC-M144 fork that defines the same symbols as our
current `react-native-webrtc@124.0.7` and therefore **cannot coexist with it** — this is a hard
cutover of the media module, not an additive install.

The mitigating fact, and the reason this is a risk rather than a blocker: upstream
`react-native-webrtc` is equally interop-only (issue `#1557`), so every option on this page carries
the same New Arch exposure. We are not adding a new architectural risk, we are swapping the module
that already sits under it. **Therefore: run a 2-3 day spike on a branch before committing** —
install `@livekit/react-native`, remove `react-native-webrtc`, confirm RN 0.81.4 boots, connect to
a Cloud Build room on a physical device, and hold a 2-minute call with the app backgrounded. If it
passes, the decision is safe. Also pin `livekit-client` to a version that includes the
`AbortSignal.any` fix (`livekit/client-sdk-js#1700`), which was reported against our exact RN
version.

**Second-order risk to plan for:** Build publishes no overage rate for WebRTC minutes, so crossing
5,000 participant-minutes/month forces the $50/mo Ship upgrade rather than billing per minute.
Budget for Ship before any public beta.

---

## Sources

LiveKit pricing, licensing, quotas
- https://livekit.com/pricing.md — canonical plan matrix, participant minutes, concurrency, downstream GB
- https://livekit.com/pricing — public pricing page
- https://docs.livekit.io/home/cloud/quotas-and-limits — Build plan free allowances
- https://docs.livekit.io/deploy/admin/quotas-and-limits.md — quotas and limits (markdown)
- https://docs.livekit.io/home/cloud/billing — billing units and minimum increments
- https://docs.livekit.io/transport/self-hosting — self-hosted vs Cloud comparison, ~3,000 users/room
- https://docs.livekit.io/transport/self-hosting.md — same, markdown source
- https://docs.livekit.io/transport/self-hosting/local/ — running the server locally
- https://github.com/livekit/livekit — Apache-2.0 server (Go/Pion), Docker, single binary
- https://github.com/livekit/livekit/blob/master/LICENSE — Apache License 2.0 text
- https://github.com/livekit/livekit/blob/master/README.md — "LiveKit server is licensed under Apache License v2.0"
- https://github.com/livekit/protocol — wire protocol, Apache-2.0
- https://github.com/livekit/client-sdk-js — `livekit-client`, Apache-2.0
- https://github.com/livekit/components-js — `@livekit/components-react`, Apache-2.0
- https://github.com/livekit/node-sdks — `livekit-server-sdk`, Apache-2.0
- https://github.com/livekit/server-sdk-kotlin — Kotlin server SDK, Apache-2.0
- https://registry.npmjs.org/livekit-client/latest — version 2.22.4, Apache-2.0
- https://registry.npmjs.org/livekit-server-sdk/latest — version 2.19.1, Apache-2.0
- https://registry.npmjs.org/@livekit/components-react/latest — version 2.9.24, Apache-2.0
- https://registry.npmjs.org/@livekit/react-native/latest — version 3.0.0, Apache-2.0
- https://registry.npmjs.org/@livekit/react-native-webrtc/latest — version 144.2.0, MIT
- https://registry.npmjs.org/@livekit/react-native-callkeep/latest — version 4.3.16, ISC
- https://registry.npmjs.org/@livekit/components-react-native/latest — 404, package does not exist

LiveKit React Native / New Architecture
- https://github.com/livekit/client-sdk-react-native — RN SDK repo, Apache-2.0
- https://github.com/livekit/client-sdk-react-native/issues/134 — "support fabric new architecture", closed not_planned; maintainer on interop layer
- https://github.com/livekit/client-sdk-react-native/issues/255 — expo-doctor "Unsupported on New Architecture"
- https://github.com/livekit/client-sdk-react-native/issues/305 — "Unable to connect to Livekit Room in New Architecture 0.79"
- https://github.com/livekit/react-native-webrtc — WebRTC M144 fork of react-native-webrtc
- https://github.com/livekit/client-sdk-react-native-expo-plugin — Expo config plugin
- https://github.com/livekit/livekit/issues/4014 — `AbortSignal.any is not available in React Native`, RN 0.81.4
- https://github.com/livekit/client-sdk-js/pull/1700 — the fix for the above
- https://github.com/react-native-webrtc/react-native-webrtc — upstream, MIT, WebRTC M124
- https://github.com/react-native-webrtc/react-native-webrtc/issues/1557 — "New Architecture - Considerations/Discussion"
- https://github.com/react-native-webrtc/react-native-webrtc/pull/1590 — upstream New Arch migration tracking
- https://github.com/react-native-webrtc/react-native-webrtc/blob/master/README.md — M124, Unified Plan ≥106, Simulcast ≥111
- https://registry.npmjs.org/react-native-webrtc/latest — version 124.0.8, MIT
- https://docs.expo.dev/guides/new-architecture — New Architecture always on from RN 0.82

mediasoup
- https://mediasoup.org/documentation/v3/mediasoup-client/react-native — RN setup: `registerGlobals()`
- https://mediasoup.org/documentation/v3/mediasoup-client/api/ — `ReactNative106` handler, react-native-webrtc ≥ 106
- https://mediasoup.org/documentation/v3/ — "signaling agnostic: do not mandate any signaling protocol"
- https://github.com/versatica/mediasoup — SFU, ISC, ~7.4k stars
- https://github.com/versatica/mediasoup-client — client, ISC
- https://registry.npmjs.org/mediasoup/latest — version 3.29.0, ISC
- https://registry.npmjs.org/mediasoup-client/latest — version 3.24.5, ISC
- https://github.com/versatica/mediasoup-client/issues/5 — react-native-webrtc MediaStream limitations

Janus
- https://github.com/meetecho/janus-gateway — GPL-3.0, ~9.2k stars

PeerJS / simple-peer
- https://github.com/peers/peerjs — PeerJS, MIT, ~13.5k stars
- https://registry.npmjs.org/peerjs/latest — version 1.5.5, MIT
- https://registry.npmjs.org/peerjs-server/latest — server 0.2.9, MIT
- https://registry.npmjs.org/simple-peer/latest — version 9.11.1, MIT

Jitsi
- https://github.com/jitsi/jitsi-meet — Apache-2.0, ~30k stars
- https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-react-sdk/ — `@jitsi/react-sdk`, iframe-based
- https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-react-native-sdk/ — RN SDK; "Dependency conflicts may occur ... use --force"
- https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe/ — IFrame API
- https://registry.npmjs.org/@jitsi/react-sdk/latest — version 1.4.4, Apache-2.0
- https://registry.npmjs.org/@jitsi/react-native-sdk/latest — version 13.2.0, Apache-2.0

Commercial providers
- https://www.daily.co/pricing/video-sdk/ — 10,000 free participant-min/mo, then $0.004/participant-min; audio-only $0.00099
- https://registry.npmjs.org/@daily-co/daily-js/latest — version 0.93.0, BSD-2-Clause
- https://registry.npmjs.org/@daily-co/react-native-daily-js/latest — version 0.88.0, BSD-2-Clause
- https://www.twilio.com/en-us/video/pricing — $0.004/participant/min, no free tier, max 50 participants
- https://registry.npmjs.org/twilio-video/latest — version 2.36.1, BSD-3-Clause
- https://www.agora.io/en/pricing/video-calling — 10,000 free min/mo, $0.99–$3.99/1000 min
- https://docs.agora.io/en/3.x/interactive-live-streaming/introduction/pricing — Agora unit pricing
- https://registry.npmjs.org/agora-rtc-sdk-ng/latest — version 4.24.9, MIT
