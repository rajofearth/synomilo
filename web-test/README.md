# web-test — browser test harness for the phone

A single-page, self-contained harness for verifying the **custom peer-to-peer
WebRTC call flow** and **push notifications** between a browser and the real
Android app.

It talks to the *same* Convex deployment as the phone
(`https://glad-capybara-533.convex.cloud`, hardcoded in `lib/api.ts` and
mirrored from `src/config/convexConfig.ts`). There is no LiveKit, no CometChat
media SDK and no server-side relay: SDP and ICE travel through the
`callSignals` table, exactly as they do on the phone.

Everything on the page exists so a failing call can be told apart from a
working one: a loud state readout, a mandatory error box, and a timestamped
event log of every signal sent, signal received, poll result and exception.

---

## 1. Install

```bash
cd web-test
npm install
```

Node 20 or newer. The only runtime dependencies are `convex`, `next`, `react`
and `react-dom` — `convex` is pinned to the same `^1.46.0` as the root project.

## 2. Run

```bash
cd web-test
npm run dev        # http://localhost:3100
```

Production build (this is the one to use when you want to be sure the harness
itself is not the problem):

```bash
npm run build
npm run start      # http://localhost:3100
```

Type check:

```bash
npx tsc --noEmit
```

> **Open it at `http://localhost:3100`, not at `http://192.168.x.x:3100`.**
> `navigator.mediaDevices` is `undefined` outside a secure context, so
> `getUserMedia` simply does not exist on a plain-HTTP LAN address and every
> call fails with no useful error. On Chrome, `localhost` is treated as secure;
> on other hosts you need HTTPS (e.g. `npx localtunnel --port 3100`, or a
> reverse proxy with TLS). The page detects the insecure case and says so in a
> red box rather than failing silently.

## 3. Accounts

Use **two different accounts**:

| Where | Who |
| --- | --- |
| Android phone | **User A** — the account that is signed in on the device |
| This browser | **User B** — any *other* account on the same deployment |

Sign in as **User B** on this page. The phone stays signed in as User A. You
cannot call yourself: `calls.start` rejects it, and `users.findByUsername`
returns `null` for your own username.

## 4. Before you start: unlock audio

The **Enable audio / Start** button at the top is not decoration. Browsers block
audio playback until the page has seen a real user gesture, so a WebRTC call
can connect perfectly and still be completely silent. Click that button first,
every time you load the page.

It calls `getUserMedia` from inside the click handler, pushes the stream through
a media element to unlock playback for the whole document, then releases the
tracks so the microphone indicator goes out. Allow the microphone prompt when it
appears.

---

## 5. Manual test script

Numbered, in order. Keep the event log visible on a second screen (or in a second
window on a wide monitor) — every step below says what the log should show.

**Preparation**

1. Phone signed in as User A, app open, on a normal network connection.
2. Browser at `http://localhost:3100`, signed in as User B.
3. Click **Enable audio / Start**. The badge changes to `audio unlocked`.
4. Press **Show poll noise** in the event log so you see the raw traffic.

**A. Messaging / push notification (do this first — it is the fastest signal)**

5. Look up User A's username. The card shows their name, avatar and id.
6. Press **Start chat**. The panel goes to `open` with a conversation id.
7. **Put the phone in the background** (home button) or lock the screen.
8. Type a message in the browser and press **Send**.
9. The bubble shows `you` / time / `delivered` once the server accepts it.
   The event log shows `api.messages.send` → `message accepted by the server`.
10. **The phone must show a notification from User B.** If it does not, the
    problem is push registration or FCM, not this harness — stop here and
    investigate there.
11. Unlock the phone, open the message, reply from the phone. Within ~2s the
    browser list shows an incoming bubble marked `received`.

**B. Browser → phone (the browser is the caller)**

12. With the phone still unlocked, press **Call voice** on the contact card.
13. The call screen appears immediately:
    - state badge goes `calling`
    - event log: `api.calls.start`, then `offer created, local description set`,
      then `offer posted to signalling`, then `<- ice candidate received` rows
14. The **phone rings** (full-screen intent). This is the FCM path again — the
    harness sends no notification of its own.
15. Accept on the phone.
16. Watch the log on the browser:
    - `<- answer received`
    - `peer connection: connected`
    - state badge goes `connecting` → `connected`, and a duration timer starts
17. **Speak.** You must hear User A and they must hear you.
18. On the phone, confirm the remote video/audio appears.
19. Press **Mute mic**, speak again (you should be silent), press again.
20. Hang up from the browser. The phone shows *Call ended* and the browser shows
    an `ended` state with the `Last outcome` notice.

**C. Phone → browser (the browser is the callee)**

21. On the phone, open User B's profile and start a **video** call.
22. Within ~3s the browser shows the unmissable **Incoming call** panel with a
    ring tone (a synthesised beep — it needs the page to have been clicked once).
    The event log shows `calls.incoming -> video call from <name>`.
23. Press **Accept**.
24. Log should show: `start video call as callee`, then `<- offer received`,
    then `answer created, local description set`, `answer posted to signalling`,
    then `remote stream: video, audio`.
25. The remote video fills the large box; your own camera is the small mirrored
    preview in the corner.
26. Press **Camera off** / **Camera on** on the browser and confirm the phone's
    local preview reacts.
27. Hang up from the phone. The browser shows `ended` and the reason.

**D. Decline and missed-call paths**

28. From the phone, call the browser again. Press **Decline** in the browser.
    The phone should stop ringing immediately and show *Call declined*.
29. From the phone, call the browser again and let it ring without answering.
    After 60s the browser shows `No answer` (server-side timeout).
30. Place a call from the browser and hang up before the phone picks up. The
    phone should stop ringing and record a cancelled/missed call.

**E. Negative tests (these are the ones that catch real bugs)**

31. Place a call from the browser, then revoke microphone permission in the
    browser's address bar while ringing. The error box must go white-on-black
    and the state badge must read `failed` — not go blank.
32. Place a call from the browser and turn the phone's Wi-Fi off. Both ends must
    end the call with a visible reason rather than hanging forever.
33. Reload the page mid-call. The call must not be left stranded in `active`:
    press Hang up, or start a new call, and confirm `calls.start` succeeds.

---

## 6. What each section is

| Section | What it exercises |
| --- | --- |
| 1 · Sign in | `api.auth.login`, token persisted in `localStorage` under `webtest.token`, session revalidated with `api.auth.me` on load |
| 2 · Pick a contact | `api.users.findByUsername`, with an automatic fall back to scanning `api.users.list` when the exact lookup returns `null` (which is also what "that is you" returns) |
| 3 · Call screen | Local + remote media, mute, camera toggle, hang up, the state badge, the error box and the clock-corrected duration |
| 4 · Incoming call | `api.calls.incoming` polled every 3s, `api.calls.accept` / `api.calls.reject` |
| 5 · Text chat | `api.conversations.createDM`, `api.messages.send`, `api.messages.list` polled every 2s |
| 6 · Event log | Everything above, timestamped |

### State readout

`idle → calling → ringing → connecting → connected → ended | failed`

* `calling` — we are the caller and the call is still `ringing` server-side.
* `ringing` — we are the callee; the call is ringing, not yet answered.
* `connecting` — the call is `active` but the peer connection is not yet up.
* `connected` — `RTCPeerConnection.connectionState === 'connected'`.
* `ended` — a terminal server status, or a `Last outcome` notice is showing.
* `failed` — an error happened during setup or signalling. The red box has the reason.

### Reading the log

Levels: `debug` (poll noise), `info`, `signal` (SDP/ICE), `good`, `warn`,
`error`. `error` rows are inverted white-on-black.

| What you see | What it means |
| --- | --- |
| `calls.signals -> 0 pending` forever after an offer | The callee never answered, or its signal went to a different `callId` |
| `<- ice candidate received` then `buffered until remote description` | Normal before the answer lands; it is a problem if it never stops buffering |
| `Peer connection failed or closed` | ICE/DTLS never completed. There is **no TURN server** here or in the app — only `stun:stun.l.google.com:19302`. Symmetric NAT or a blocking firewall will stop a call that looks fine everywhere else |
| `Insecure context` box | The page is not on HTTPS or localhost; `getUserMedia` does not exist |
| `Could not start your camera and microphone` | Permission denied, or no camera for a video call |
| `play() rejected` | The autoplay unlock at the top was skipped or blocked |
| `callee has no push token registered` (server log) | The phone never registered an FCM token — a push problem, not a harness problem |

---

## 7. Protocol fidelity

`lib/callEngine.ts` is a line-by-line port of the signalling half of
`src/components/calls/WebRTCCallScreen.tsx`. The parts that must not drift:

1. **One `RTCPeerConnection` per call**, created after `getUserMedia`, with every
   local track added via `addTrack(track, stream)`.
2. **The caller sends its offer while the call is still `ringing`** — before the
   callee accepts. The phone is not in the call yet; it picks the offer up once
   it accepts.
3. **Only the callee creates an answer**, and only in response to a received
   offer. It never creates an offer.
4. **Remote ICE candidates are buffered** until a remote description exists, then
   flushed (on answer) or added immediately.
5. **Signals are applied once each**, keyed by `_id`, then deleted with
   `api.calls.consumeSignals` in a batch after the pass.
6. **Signals seen before the peer connection exists are not consumed**, so they
   survive to the next poll.
7. `connectionstatechange` of `failed`/`closed` hangs the call up and records a
   reason rather than closing silently.
8. The 60s caller-side ring timeout mirrors `RING_TIMEOUT_MS`.
9. STUN-only `iceServers`, identical to the app.

### Deliberate divergences

| Divergence | Why |
| --- | --- |
| `toJSON()` is used before `JSON.stringify` for SDP and ICE payloads | `RTCSessionDescription` / `RTCIceCandidate` are WebIDL platform objects in a browser: a bare `JSON.stringify` returns `{}`. `toJSON()` is spec-defined and implemented by Chrome/Firefox/Safari, and produces exactly the shape React Native produced |
| `api.calls.signals` is both a live Convex subscription and a 1s poll | The mobile app relies on the reactive query alone. The harness adds a poll so a dropped subscription degrades to *slow* rather than to *dead*, and so the spec's "poll this" is literally visible in the log. Signals are deduplicated by `_id`, so this is safe |
| The clock offset is sampled **once** per call, from `calls.get`'s `serverNow` | As specified. The mobile screen re-samples on every `serverNow` change, which also absorbs drift |
| The incoming-call panel polls `api.calls.incoming` every 3s instead of holding a live query | As specified. It is what the log's `poll` lines are showing |
| No ringback tone for outgoing calls, no ongoing-call notification, no call history | Those are mobile OS concerns. The incoming ring tone is synthesised with Web Audio |
| React Strict Mode is off | It double-invokes effects in development, which would build a second `RTCPeerConnection` and fire a second offer |
| No React context / generated Convex API | `web-test` is outside the Convex project, so `lib/api.ts` builds each function reference with `makeFunctionReference`. `ConvexReactClient` is used imperatively so every call can be logged |

---

## 8. What is NOT verified

**No real call has been made from this harness.** It was written and built
somewhere with no Android device, no microphone, no second human and no push
notifications in reach. Specifically, these are unproven until you run the script
above:

* that two `RTCPeerConnection`s negotiate across a real network
* that audio actually flows in both directions
* that video renders from the phone's stream
* that the phone's full-screen call intent fires on `calls.start`
* that an FCM message notification arrives for `messages.send`
* that mute / camera toggles are honoured by `react-native-webrtc` on the other end
* NAT traversal in general (there is no TURN server)

What *is* verified: `npx tsc --noEmit` is clean, `npm run build` succeeds, the
page server-renders without error (HTTP 200), and the Convex function references
in `lib/api.ts` resolve against the live deployment — a probe against
`users:findByUsername` returns the deployment's real
`Your session has expired. Please log in again.` rather than
`Could not find public function`, which means the names and argument shapes
match `convex/`.

---

## 9. File map

```
web-test/
  app/            layout, page, monochrome stylesheet
  components/     the six UI sections plus the audio gate
  lib/
    api.ts        Convex URL, hand-written function references, response types
    callEngine.ts the RTCPeerConnection and its signalling ordering
    useCallSession.ts  React lifecycle around one call
    eventLog.ts   the timestamped log store
    duration.ts   clock-offset maths, ported from src/utils/callDuration.ts
    hooks.ts      subscription and polling helpers
```
