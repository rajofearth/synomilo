# Audit 02 — Outgoing + Ongoing Call Lifecycle

Scope: `src/components/calls/WebRTCCallScreen.tsx`, `src/components/conversations/screens/OngoingCallScreen.tsx`, `src/components/calls/Calls.tsx`, `CallDetails.tsx`, `CallHistory.tsx`, `src/navigation/RootStackNavigator.tsx`, `src/navigation/NavigationService.ts`, `convex/calls.ts`, `src/notifications/callNotifications.ts`, `src/notifications/background.ts`, `src/notifications/push.ts`, `App.tsx`, plus `docs/ux-research/notifee-sound-actions.md` and `docs/ux-research/original-call-notifications.md`.

Read-only audit. No source file was modified.

---

## Root cause summary

### Ongoing-call notification gap (user bug a)

1. **[CRITICAL] There is no ongoing-call notification. Ever.** `notifee.displayNotification` is called exactly once in the whole app — `src/notifications/callNotifications.ts:51` — inside `showIncomingCallNotification`, which is only reachable from `src/notifications/background.ts:34` (`handleDataMessage`), which returns early unless `data.type === 'call'` (`background.ts:31`). That push is only ever sent to the **callee** (`convex/calls.ts:84-97`, `tokens: [callee.pushToken]`). Nothing in the app ever posts a notification when a call becomes `active`, and nothing posts one for an outgoing call at all. So when the caller minimizes the app mid-call there is *no* notification of any kind — only the chat-style tray notification the user is complaining about is the incoming ringing one, and it is already gone by then (cancelled at `WebRTCCallScreen.tsx:68-70`, `App.tsx:248`, `App.tsx:295`, `IncomingCallOverlay.tsx:52`, or by `IncomingCallOverlay.tsx:83-87`).

2. **[CRITICAL] The exact notification the user is asking for already ships inside a dependency and is never switched on.** `node_modules/@cometchat/calls-sdk-react-native/android/src/main/java/com/CometChatCalls/CallNotificationService.java:32-45` builds it: `CATEGORY_CALL` (`:33`), `setOngoing(true)` (`:39`), `setWhen(startingTime)` + `setUsesChronometer(true)` (`:40-41`), `setAutoCancel(false)` (`:42`), `setOnlyAlertOnce(true)` (`:44`), as a `startForeground` service (`:47-53`). It is started by `CometChatCalls.init()` (`dist/index.js`, ~@1150900: `CallNotificationService.startService()`), and `CometChatCalls.init()` is **never called anywhere in this repo** — the only `CometChatCalls.*` calls are `endSession()` at `CometChatPushV2.ts:95` and `OngoingCallScreen.tsx:53`.

3. **[HIGH] None of the required ongoing-notification attributes exist in app code.** `onlyAlertOnce`, chronometer/`timestamp`, and mute/hold/speaker/end actions are all absent: the app's sole notification options object is `callNotifications.ts:62-82` (ringing only — `loopSound: true`, `timeoutAfter: 60000`, Decline+Accept). The only `ongoing: true` in `src` is that ringing notification (`callNotifications.ts:67`). No `progress`, no `onlyAlertOnce`, no `timestamp` anywhere.

4. **[HIGH] No call state survives backgrounding and there is no resume UI.** `WebRTCCallScreen.tsx` contains no `AppState` listener. The only zustand store in the app is `src/config/store.ts:174` (`useConfigStore`, theme config) — there is no call store. All live call state is local `useState` and dies with the component: `pcReady` (`:60`), `localURL`/`remoteURL` (`:61-62`), `muted` (`:63`), `cameraOff` (`:64`), `leaving` (`:65`), `elapsed` (`:66`). The app's four `AppState` listeners (`App.tsx:261`, `UpdateChecker.tsx:83`, `SettingsScreen.tsx:22`, `Messages.tsx:212`) render nothing call-related, and no in-call banner / mini-player component exists.

5. **[HIGH] No background survival strategy at all.** `react-native-background-timer` is declared at `package.json:39` but is **never imported** anywhere in `src/`, `App.tsx`, or `index.js` (0 hits). No foreground service is started by JS (`CallNotificationService` is the only one, and it is never started). `MainActivity.kt` has no `onUserLeaveHint`/`onPictureInPictureModeChanged`, so Android never offers PiP.

### Duration bug (user bug c)

6. **[HIGH] The timer is anchored to a *server* clock and read against a *device* clock.** `convex/calls.ts:167` writes `answeredAt: Date.now()` on the Convex server; `WebRTCCallScreen.tsx:242` computes `(Date.now() - call.answeredAt!)/1000` with the **device** clock. Any skew drives the elapsed value negative and `formatElapsed` (`:286-292`) renders it verbatim — `-1:-3`.

7. **[HIGH] `elapsed` is never seeded, so the first active second paints `00:00`.** `WebRTCCallScreen.tsx:66` initialises `useState(0)`; the interval's first tick is `+1000 ms` after the effect runs (`:241-244`). For a call accepted from a notification — the *received call* case the user reported — the screen paints `00:00` and then jumps to the real value.

8. **[MEDIUM] The screen paints "Call ended" while the call is still connecting.** `statusLabel` (`WebRTCCallScreen.tsx:294-301`) falls through to `'Call ended'` for *every* status that is not `active`/`ringing` — including the initial `call === undefined` window before `useQuery(api.calls.get)` (`:42-45`) delivers its first value.

9. **[MEDIUM] No hours segment.** `formatElapsed` (`:286-292`) emits `mm:ss`, so a 2 h call shows `122:00` rather than `2:00:00`.

10. **[LOW] The legacy CometChat surfaces can render `NaN min  NaN sec`.** `CallDetails.tsx:261-266` and `CallHistory.tsx:156-161` call `convertMinutesToTime(item.getTotalDurationInMinutes())` with no guard; the Calls SDK `CallLog` constructor is `function O(R){Object.assign(this,R)}` with no default for `totalDurationInMinutes` (`node_modules/@cometchat/calls-sdk-react-native/dist/index.js`, CallLog block ~@1251739), so a payload without that key yields `undefined` → `Math.round(undefined*60)` → `NaN`. Both screens are registered in the stack (`RootStackNavigator.tsx:201-204`) but never navigated to from app code.

---

## Findings

### 1. [CRITICAL] No ongoing-call notification is ever posted

**Evidence.** The only `displayNotification` call site is `src/notifications/callNotifications.ts:51`, inside `showIncomingCallNotification` (`:47-84`). Its single caller is `handleDataMessage` (`src/notifications/background.ts:28-40`), gated on `data.type !== 'call'` → early return (`:31`). The server sends that payload only to the callee (`convex/calls.ts:84-97`). Nothing posts on `status → 'active'`, nothing posts for `role === 'caller'`, and nothing re-posts on `AppState` change.

`WebRTCCallScreen.tsx` imports exactly one notification helper — `dismissCallNotification` (`:26`), called once on mount (`:68-70`). There is no `show*` import.

**Fix.** Add `showOngoingCallNotification({ callId, peerName, type, startedAt })` to `callNotifications.ts`, called from `WebRTCCallScreen` when `call?.status === 'active' && call?.answeredAt` (mirroring the timer effect at `:237-246`), using a *new* channel id (see `docs/ux-research/notifee-sound-actions.md:158-185` — Android channel sound/importance is immutable, so use `ongoing_call_v1`, `importance: LOW`, `sound: null`, `ongoing: true`, `autoCancel: false`, `onlyAlertOnce: true`, `chronometer: true`, `timestamp: call.answeredAt`, `pressAction: { id: 'open-call', launchActivity: 'default' }`) and actions `mute / hold / speaker / end`. Cancel it in `hangUp` and in the lifecycle `leave()` at `:232-234`. Cheapest interim alternative: call `CometChatCalls.init(...)` once on login so `CallNotificationService.java:32-45` runs, but that only works for SDK-initiated calls, not the Convex path.

### 2. [CRITICAL] No call state store; nothing survives backgrounding

**Evidence.** `WebRTCCallScreen.tsx:60-66` — all seven pieces of live call state are `useState`. No `AppState` import anywhere in the file (the file's only React import is `useCallback, useEffect, useRef, useState`, `:1`). The repo's only zustand store is `src/config/store.ts:174`.

Grep for an in-call banner/mini-player (`mini.?player|incall|in-call|banner`) in `src`: 0 hits.

**Fix.** Create `src/calls/callStore.ts` (`create<CallStore>`) holding `{ callId, role, peerName, type, muted, cameraOff, startedAt, status }`, written from `WebRTCCallScreen` and read by a persistent `<OngoingCallBar />` mounted in `App.tsx` next to `<IncomingCallOverlay />` (`App.tsx:500`). Tapping the bar re-navigates to `CallScreen`.

### 3. [HIGH] Background/resume is unhandled

**Evidence.** No `AppState` in `WebRTCCallScreen.tsx`. No `useFocusEffect`. `RootStackNavigator.tsx:92-96` sets `gestureEnabled: true` globally and `CallScreen` overrides only `animation` (`:194`), so the screen can be dismissed without any code running. `AndroidManifest.xml:27-39` — `MainActivity` has no `showWhenLocked`/`turnScreenOn`.

**Fix.** `AppState.addEventListener('change', ...)` in the call store: on `background`, persist the call snapshot and start/refresh the ongoing notification; on `active`, re-read it. Set `options={{ gestureEnabled: false, animation: 'fade' }}` on `CallScreen` and register a `beforeRemove` guard that requires an explicit hangup.

### 4. [HIGH] Two CallScreens can be stacked

**Evidence — four independent accept→navigate paths, none deduplicated:**
- `App.tsx:194-204` (`openFromData`) → `acceptCall` + `navigate('CallScreen')`.
- `App.tsx:247-254` (`routePending`, also on every `AppState` `'active'`, `App.tsx:261-265`) → same.
- `App.tsx:292-302` (notifee foreground `ACTION_PRESS`/`PRESS`) → same.
- `IncomingCallOverlay.tsx:45-59` → same.

The first three are reachable *while the app is in the foreground*: `App.tsx:222-227` runs `messaging().onMessage` → `handleDataMessage` → `showIncomingCallNotification`, which posts a CALL-category notification **with `fullScreenAction`/`pressAction` = `accept-call`** (`callNotifications.ts:72-73`) even though the app is visible. So the user sees `IncomingCallOverlay` *and* a full-screen call notification, and can press Accept on either.

Server-side there is no guard: `convex/calls.ts:156-170 accept` checks only `status !== "ringing"` (`:164`) — it does **not** check whether the callee is already in an `active` call. Only `start` has such a guard, and it is broken for active calls (Finding 6).

`NavigationService.navigate` (`NavigationService.ts:22-35`) forwards straight to `navigationRef.navigate` with no dedupe and no in-call guard; `Calls.tsx:87`, `ChatScreen.tsx:729`, `ContactInfoScreen.tsx:39` bypass the service entirely with `navigation.navigate` and are equally unguarded.

**Impact.** Two `RTCPeerConnection`s (`WebRTCCallScreen.tsx:115`), two `getUserMedia` streams (`:101`), two SDP offers (`:147-156`), two Convex signal rows per peer, and a duplicated `elapsed` interval (two independent timers, each correct, so no double-speed — but two confusing timers). `acceptCall` is called twice; the second throws `This call is no longer ringing` (`convex/calls.ts:165`), swallowed by `.catch(() => {})` at `App.tsx:195/247` — but `IncomingCallOverlay.tsx:60-64` surfaces it as a spurious `Alert` "Could not answer / The call may have ended." while the call is actually connected.

**Fix.** Add a `busy` guard in `convex/calls.ts accept`: reject if the callee already has an `active` call (mirror `start`'s `by_callee` query at `:60-68`). Add a module-level `activeCallId` guard in `NavigationService.navigate` that turns any `CallScreen` navigation into a no-op while one is mounted.

### 5. [HIGH] Hangup is incomplete and leaks a peer connection

**Evidence.**
- Only `hangUp` (`:83-88`) calls `endCall`. The swipe-back/gesture path (`RootStackNavigator.tsx:93`) and the Android back button never call it, so the Convex row stays `active` forever and the peer is never told. There is no `beforeRemove`/`usePreventRemove`/`BackHandler` in `WebRTCCallScreen.tsx`.
- `leave` (`:72-81`) sets `leaving` → `hangUp` identity changes → the **media effect's dep `hangUp` (`:171`) changes** → its cleanup (`:162-170`) closes the peer connection and stops the local tracks, then the effect **re-runs from scratch**: a second `mediaDevices.getUserMedia` (`:101`), a second `RTCPeerConnection` (`:115`), and for `role === 'caller'` a **second SDP offer** written to Convex (`:147-156`) for a call that is being ended.
- `pcAny.addEventListener('connectionstatechange', …)` (`:138-143`) calls `hangUp()` on `failed` **or `closed`**. The cleanup's own `pcRef.current?.close()` (`:165`) synchronously emits `closed`, so `hangUp` fires again during teardown → a **second `navigation.goBack()`**, popping one screen too far.
- The handles returned by `addEventListener` at `:122`, `:132`, `:138` are never stored or removed.
- The remote `MediaStream` (`:132-137`) is only kept as a `toURL()` string; its tracks are never stopped on unmount.
- `calls.end` (`convex/calls.ts:197-213`) patches the row but **schedules no push** — contrast `start` (`:84-97`). A peer with the app backgrounded is never notified.

**Tear-down matrix on hangup**

| Resource | Torn down? | Evidence |
|---|---|---|
| Local media tracks | Yes | `:167-169` |
| `RTCPeerConnection` | Yes (but immediately re-created — see above) | `:165`, `:171` |
| Duration `setInterval` | Yes | `:245` |
| Ring `setTimeout` | Yes | `:256` |
| Ringback `<Video>` | Yes (status flip / unmount) | `:307-315` |
| PC event listeners | **No** (handles discarded) | `:122`, `:132`, `:138` |
| Remote stream tracks | **No** | `:132-137` |
| Ongoing notification | **N/A — never created** | Finding 1 |
| Incoming notification | Only on mount, not on end | `:68-70` |
| `CometChatCalls.endSession()` / `CometChat.clearActiveCall()` | **No** | contrast `CometChatPushV2.ts:92-99` |
| Nav screen | Yes, but can double-pop | `:78`, `:138-143` |
| Convex row | Only via the hangup button | `:85`, `:197-213` |
| Push to peer | **No** | `convex/calls.ts:197-213` |

**Fix.** Store listener handles and `removeEventListener` in the cleanup; guard the cleanup with a `disposed` flag already in scope (`:92`, `:108`, `:163`) so `close()` cannot re-trigger `hangUp`; remove `hangUp` from the media effect's deps (use a ref); add `calls.end` → `internal.push.sendToTokens` with `callAction: 'ended'` so the peer is notified even when backgrounded.

### 6. [MEDIUM] The "already in a call" guard is ineffective for active calls

**Evidence.** `convex/calls.ts:49-55` throws only when `(call.status === "ringing" || call.status === "active") && now - call.createdAt < RING_TIMEOUT_MS` (60000, `:8`). An `active` call that started five minutes ago has `now - createdAt > 60000`, so the guard passes and a **second call row is inserted**. The user only gets protection against a call that started less than a minute ago.

**Fix.** Guard on `status === "active"` unconditionally; only apply the age test to `ringing`.

### 7. [MEDIUM] Caller ring timeout is foreground-only

**Evidence.** `WebRTCCallScreen.tsx:249-257` — `setTimeout(..., 60000)`. That is a JS timer; it does not run while the app is backgrounded. The server-side backstop is `RING_TIMEOUT_MS = 60000` (`convex/calls.ts:8`), scheduled at `:78-82` and executed by `markTimedOut` (`:187-195`, which only patches when `status === "ringing"`, `:191`). So backgrounding during ringing leaves the caller hanging on "Ringing…" until they return; the row silently flips to `missed` and `leave()` (`:232-234`) fires on the next render.

**Timeout value: 60000 ms, both client (`:255`) and server (`convex/calls.ts:8`).**

### 8. [MEDIUM] Foreground incoming calls double-ring

**Evidence.** `App.tsx:222-227` displays the ringing notification for *foreground* messages. `IncomingCallOverlay.tsx:125-207` renders a second full-screen Accept/Decline UI above the navigator (`App.tsx:500`, `IncomingCallOverlay.tsx:212-217` `...StyleSheet.absoluteFillObject, zIndex: 100`). `IncomingCallOverlay` plays **no audio at all** — grep for `Video|Sound|SoundManager` in that file: 0 hits — so the ring comes entirely from the notifee `loopSound` notification (`callNotifications.ts:66`).

This is precisely the double-ring `docs/ux-research/original-call-notifications.md:398-401` tells you not to build, and it leaves the user with two Accept buttons racing each other (Finding 4).

**Fix.** In `handleDataMessage`, skip `showIncomingCallNotification` when the app is foregrounded (the overlay owns the foreground ring), or drop `IncomingCallOverlay` and let the notification own both cases.

### 9. [MEDIUM] `CometChatCalls` is never initialised; four parallel call stacks coexist

**Evidence.**
- `CometChatCalls.init()` — 0 call sites. Only `endSession()` (`CometChatPushV2.ts:95`, `OngoingCallScreen.tsx:53`).
- `OngoingCallScreen.tsx` renders `CometChatOngoingCall` (`:88-93`) with a `CallSettingsBuilder` (`:71-76`); it is reachable only from `CometChatPushV2.ts:80` and would fail without `init()`. Its listeners reset the nav stack to `BottomTabNavigator` (`:52-58`, `:62-66`) — a *different* teardown convention from the Convex screen's `navigation.goBack()`.
- `CallDetails.tsx` and `CallHistory.tsx` are registered (`RootStackNavigator.tsx:201-204`) but never navigated to; they read CometChat-dashboard call logs, not the Convex `calls` table.
- `UserInfo.tsx:151-172` + `:415-441` is a **fourth** outgoing path (`CometChat.initiateCall` + `CometChatOutgoingCall`), reachable from `Messages.tsx:457`, backed by a completely different server (CometChat dashboard).
- The app's own recents (`Calls.tsx:66-69`, `convex/calls.ts:215-246`) show **no duration at all** — `Calls.tsx:53-60` and `:159-171` render direction/type only.

**Fix.** Pick one call stack. If it is Convex: delete the SDK init dependency from the call path, remove `OngoingCallScreen`/`CallDetails`/`CallHistory`, and add a duration column to `Calls.tsx` computed from `answeredAt`/`endedAt` (`convex/schema.ts:95-96`).

### 10. [MEDIUM] `IncomingCallOverlay` is not suppressed during an active call

**Evidence.** `App.tsx:500` renders `<IncomingCallOverlay />` unconditionally whenever `isLoggedIn`. Its backing query (`convex/calls.ts:104-128`) only filters on `calleeId + status === 'ringing'` — it has no "am I already in a call" condition. Combined with the missing guard in `accept` (`convex/calls.ts:156-170`), accepting a second call while one is live is possible.

**Fix.** Add an `activeCallId` to the session/call store and return `null` from `IncomingCallOverlay` when it is set; reject in `convex/calls.ts accept`.

### 11. [LOW] `formatElapsed` has no hours and no negative guard

**Evidence.** `WebRTCCallScreen.tsx:286-292`. `Math.floor(-3/60) = -1`, `(-3) % 60 = -3`, `(-1).toString().padStart(2,'0') = "-1"` → `"-1:-3"`. And 7200 s → `m = 120` → `"120:00"`.

**Fix.** `const s = Math.max(0, Math.floor(seconds))`, then emit `h:mm:ss` when `seconds >= 3600`.

### 12. [LOW] `convertMinutesToTime` can emit `NaN min  NaN sec`

**Evidence.** `CallDetails.tsx:261-266`, `CallHistory.tsx:156-161`; SDK constructor `function O(R){Object.assign(this,R)}` with no `totalDurationInMinutes` default (`node_modules/@cometchat/calls-sdk-react-native/dist/index.js`, ~@1251739). Also the template has a double space: `` `${minutes} min  ${seconds} sec` ``.

**Fix.** `Number.isFinite(m) ? ... : '—'`.

---

## Call state machine

| State | Who knows about it | What the UI shows | What the notification shows | Where it is stored |
|---|---|---|---|---|
| *initiating* (pre-insert) | nobody | nothing | nothing | **does not exist** — `convex/calls.ts:70-76` inserts directly as `ringing` |
| `ringing` — caller | Convex `calls.status='ringing'` (`schema.ts:88`, set at `convex/calls.ts:74`); push to callee only (`:84-97`) | `WebRTCCallScreen` "Ringing…" (`WebRTCCallScreen.tsx:297-300`) + looped ringback (`:307-315`) | **nothing** | Convex row; local `call` from `useQuery` (`:42-45`) |
| `ringing` — callee | Convex row + `calls.incoming` (`convex/calls.ts:104-128`) | `IncomingCallOverlay` full-screen, silent (`IncomingCallOverlay.tsx:125-207`), rendered above the navigator (`App.tsx:500`) | title = caller name, body = "Incoming voice/video call", `ongoing`, `loopSound`, Decline+Accept, `fullScreenAction` (`callNotifications.ts:51-83`) | Convex row |
| `active` — caller | Convex `status='active'`, `answeredAt` (`convex/calls.ts:167`) | `mm:ss` (`WebRTCCallScreen.tsx:286-296`) + mute/camera/flip/hangup (`:375-435`) | **nothing — this is bug (a)** | Convex row; `elapsed`/`muted`/`cameraOff` local `useState` (`:60-66`), no zustand |
| `active` — callee (received) | same | same, but `elapsed` starts at `0` (`:66`) and paints `00:00` for the first second | nothing | same |
| `rejected` (callee declined) | Convex `convex/calls.ts:181` | `leave()` → `goBack` (`:232-234`, `:78`); **no "declined" message** | nothing | Convex row |
| `missed` (callee never answered / caller cancelled) | Convex `convex/calls.ts:57`, `:192`, `:205` | same silent `goBack` | nothing | Convex row |
| `ended` (peer hung up) | Convex `convex/calls.ts:209`; **no push is sent** (`:197-213`) | same silent `goBack`, but only on the next foreground render | nothing | Convex row |
| *busy* | **not a state** — `ConvexError('You are already in a call')` (`convex/calls.ts:54`) | `Alert` "Call failed" (`Calls.tsx:94-97`, `ChatScreen.tsx:735-740`, `ContactInfoScreen.tsx:40-42`) | nothing | nowhere |
| *unavailable / offline* | **not modelled** — no presence check in `convex/calls.ts` | none; rings for the full 60 s | nothing | — |
| *media setup failed* | **not modelled** — errors only `console.log` (`WebRTCCallScreen.tsx:157-159`) | spinner forever (`:437-441`), no error, no retry | nothing | — |
| *peer disconnected by network* | **not modelled** — only `pc.connectionState === 'failed' | 'closed'` (`:138-143`); `disconnected` ignored | silently hangs up | nothing | — |
| *rejected elsewhere* | **not modelled** | none | nothing | — |
| **backgrounded mid-call** | nothing local | nothing — no banner, no mini-player, no notification, no FGS, no PiP | **nothing** | nowhere |

**Outgoing-state summary:** the server models exactly five states (`convex/schema.ts:87-93`: `ringing | active | rejected | missed | ended`). Of the eleven states in the brief, `initiating`, `busy`, `unavailable`, `failed`, `disconnected`, and `rejected-elsewhere` have **no representation at all**. `busy` is the only one with *any* user-visible output, and it is a thrown `ConvexError` rendered as a generic `Alert`, not a call state.

---

## Timer arithmetic

### Every timer / clock in the call path

| Location | Kind | Purpose | Notes |
|---|---|---|---|
| `WebRTCCallScreen.tsx:241-244` | `setInterval` 1000 ms | call duration | delta-based, self-correcting |
| `WebRTCCallScreen.tsx:245` | `clearInterval` | teardown | on unmount only |
| `WebRTCCallScreen.tsx:242` | `Date.now()` | duration anchor | **device** clock |
| `convex/calls.ts:167` | `Date.now()` | `answeredAt` written | **server** clock |
| `WebRTCCallScreen.tsx:249-256` | `setTimeout` 60000 ms | caller ring timeout | foreground-only |
| `convex/calls.ts:8,78-82,187-195` | `ctx.scheduler.runAfter(60000)` | server ring timeout | survives background |
| `convex/calls.ts:42,115,181,192,206,209` | `Date.now()` | row timestamps | server |
| `src/notifications/background.ts:76` | `Date.now()` | pending-accept TTL (120000) | not call duration |

`react-native-background-timer` (`package.json:39`) is **never imported** — 0 hits in `src/`, `App.tsx`, `index.js`. Nothing in this call path keeps running while backgrounded.

### Q4 checklist

| # | Check | Answer | Evidence |
|---|---|---|---|
| i | Interval cleared on unmount? | **Yes** | `:245` |
| ii | Cleared on blur? | **No** — no blur concept, no `useFocusEffect`, no `AppState` | whole file; `RootStackNavigator.tsx:92-96` |
| iii | Can multiple intervals stack? | **No for the duration interval** — deps are the primitives `call?.status` and `call?.answeredAt` (`:246`), so React tears the old one down before creating the new one; there is no `2x` timer. **Yes for the media effect** — its dep `hangUp` (`:171`) changes identity whenever `leaving` flips (`:74-81`), re-running `getUserMedia` + `createOffer` (`:101`, `:147-156`) | `:171`, `:74-81`, `:147-156` |
| iv | `Date.now()` delta or increment counter? | **`Date.now()` delta** — `Math.floor((Date.now() - call.answeredAt!) / 1000)` | `:242` |
| v | Seconds-vs-milliseconds unit error? | **None in `WebRTCCallScreen`** — exactly one `/1000`, then one `/60`. The real defect is **mixing server time with device time** (Finding 6). `convertMinutesToTime` (`CallDetails.tsx:261-266`) converts decimal-minutes → seconds correctly but has no `NaN` guard | `:242`, `:286-292`; `CallDetails.tsx:261-266` |
| vi | `react-native-background-timer` used? | **No** — declared, never imported, so it does **not** keep running in background | `package.json:39`; 0 imports |

### Worked example A — a 65-second call

Let the call be accepted at wall-clock `T0` (server). `convex/calls.ts:167` stores `answeredAt = T0`.

1. The screen mounts after the accept round-trip + Convex subscription latency; call it `Δ`. During `Δ`, `call` is `undefined`, so `statusLabel` (`:294-301`) falls through to **`"Call ended"`**.
2. When `call` arrives with `status === 'active'`, the effect at `:237-246` creates the interval. `elapsed` is still its initial `0` (`:66`) → painted value `formatElapsed(0)` = `floor(0/60)=0 → "00"`, `0%60=0 → "00"` → **`"00:00"`** — for a full second, despite `Δ` s of real call time already elapsed.
3. First tick at `+1000 ms`: device time ≈ `T0 + Δ + 1000`. `elapsed = floor((T0 + Δ + 1000 − T0)/1000) = 1 + floor(Δ/1000)`. With `Δ = 400 ms` → `1` → **`"00:01"`**. The counter *snaps* from `00:00` to `00:01`; with a slower path (`Δ = 8 s`, e.g. `IncomingCallOverlay.tsx:51` await + slow subscription) it snaps from **`"00:00"` to `"00:08"`**. That jump is the "weird duration" on received calls.
4. Steady state at true 65 s: `elapsed = floor(65) = 65`. `m = floor(65/60) = 1 → "01"`, `s = 65 % 60 = 5 → "05"` → **`"01:05"` — correct.**

### Worked example B — a 3700-second call (~61 min 40 s)

1. `elapsed = floor((T0 + 3_700_000 − T0)/1000) = 3700`.
2. `m = Math.floor(3700/60) = Math.floor(61.666…) = 61` → `"61"`.
3. `s = 3700 % 60 = 3700 − 61×60 = 3700 − 3660 = 40` → `"40"`.
4. Rendered: **`"61:40" — arithmetically correct`**, but WhatsApp/Google Duo show `1:01:40` (`:286-292` has no hours branch). A 7200 s call renders `"120:00"`.

**Conclusion for B:** the arithmetic is right; the *format* is the defect.

### Backgrounded 5 minutes (rehydration)

- Android suspends the JS thread, so `setInterval` at `:241` does not fire. Because it is a `Date.now()` **delta** and not an increment counter, there is **no drift**: on resume, the next tick recomputes `floor((now − T0)/1000)`. At `now = T0 + 300 s` → `elapsed = 300` → `m = 5`, `s = 0` → **`"05:00"`, correct.** The *number* survives; the *notification*, the in-app banner, the PiP and the tick-while-backgrounded do not.
- **Where the start timestamp lives:** exclusively in the Convex row (`convex/schema.ts:95`, `answeredAt: v.optional(v.number())`), written once at `convex/calls.ts:167` and read via `api.calls.get` (`convex/calls.ts:149`, `answeredAt: call.answeredAt ?? null`). It is **persisted server-side and recomputed on every tick**, so it is robust — the problem is purely (a) it is never mirrored into a notification chronometer (`timestamp`/`chronometer` are absent from `callNotifications.ts`) and (b) the client clock used to subtract it is not the clock that wrote it.
- **Failure mode:** if the device clock trails the Convex server clock by more than the elapsed time, `Date.now() - answeredAt < 0`; e.g. `-3` → `m = Math.floor(-0.05) = -1` → `"-1"`, `s = -3 % 60 = -3` → `"-3"` → the screen literally renders **`"-1:-3"`**.

---

## Feature gaps vs WhatsApp

| Feature | Status | Evidence |
|---|---|---|
| Ongoing-call notification while backgrounded | **ABSENT** | `callNotifications.ts:47-84` is the only `displayNotification`; incoming-only |
| Notification chronometer / live duration | **ABSENT** | no `chronometer`/`timestamp` in `src/notifications/*` |
| Persistent notification actions (mute/hold/speaker/end) | **ABSENT** | only `Decline`/`Accept` (`callNotifications.ts:74-80`) |
| Foreground service during call | **ABSENT** | `CallNotificationService.startService()` only via `CometChatCalls.init()`, never called |
| In-call banner / mini-player on resume | **ABSENT** | no `AppState` in `WebRTCCallScreen.tsx`; no banner component in `src` |
| Call-state store that survives backgrounding | **ABSENT** | only store is `useConfigStore` (`src/config/store.ts:174`) |
| Speaker toggle | **ABSENT** | controls are mute/camera/flip/hangup only (`WebRTCCallScreen.tsx:375-435`) |
| Bluetooth / wired-headset routing | **ABSENT** | no `BLUETOOTH_CONNECT` in `AndroidManifest.xml:5-16`; no `BluetoothHeadset`/`AudioDevice` reference in `src` |
| Audio focus / `AudioSession` / `AVAudioSession` configuration | **ABSENT** | 0 hits for `AudioSession|activateAudioSession|setAudioSession` in `src`; the Calls SDK's `AudioModeModule.java` / `PictureInPictureModule.requestAudioFocus()` are only wired by `CometChatCalls.init()`, never called |
| Screen stays on during call | **ABSENT** | no `keep-awake` dependency (`package.json:12-54`), no `KeepAwake` component, no `FLAG_KEEP_SCREEN_ON`, no `MainActivity.onUserLeaveHint` (`MainActivity.kt` is 31 lines) |
| Picture-in-picture on minimize | **ABSENT** | `PictureInPictureModule.java` ships in the SDK and `dist/index.js` calls `setPictureInPictureEnabled(true)` on init, but init is never called and `MainActivity` has no `onPictureInPictureModeChanged`; `android:configChanges` (`AndroidManifest.xml:31`) does not include `screenLayout|smallestScreenSize` PiP keys beyond the default set |
| Group calls | **ABSENT** | one `calleeId` per row (`convex/schema.ts:83-97`), `assertParticipant` is 1:1 (`convex/calls.ts:21-25`), `signal` targets one `toUserId` (`:259-267`) |
| Per-participant tiles | **ABSENT** | single remote `RTCView` + small local preview (`WebRTCCallScreen.tsx:316-373`) |
| Upgrade audio ⇄ video mid-call | **ABSENT** | `type` is fixed at `start` (`convex/calls.ts:73`) and read once from `route.params` (`WebRTCCallScreen.tsx:35-40`); `toggleCamera` (`:269-277`) only flips `track.enabled` on a track that was never added in an audio call (`:103-106`) |
| Camera flip | **PRESENT** | `:279-284`, `:413-425` |
| Mute | **PRESENT** (in-screen only, not from a notification) | `:259-267`, `:376-392` |
| Hold | **ABSENT** | no hold in `:375-435` |
| DTMF / keypad | **ABSENT** | 0 hits in `src/components/calls` |
| Add to Recents | **PARTIAL** | the Convex `calls` table is the recents (`Calls.tsx:66-69`) but shows **no duration** (`Calls.tsx:53-60`, `:159-171`); the CometChat `CallDetails`/`CallHistory` surfaces that do show duration are unreachable (`RootStackNavigator.tsx:201-204`) |
| Network quality / connection indicator | **ABSENT** | `pc.connectionState` is read only for `failed`/`closed` (`:138-143`); no `getStats` |
| Call encryption notice | **ABSENT** | only a Google public STUN server (`:28-30`); no TURN, no `iceServers` fallback, no lock/e2ee indicator in the UI (`:342-356`) |
| Caller-side ringback | **PRESENT** (foreground JS only) | `:307-315`, stops on status flip/unmount |
| Callee-side in-app ringback | **ABSENT** | `IncomingCallOverlay.tsx` has no audio; relies on the notifee `loopSound`, which also fires in the foreground (`App.tsx:222-227`) |
| Ring timeout | **PRESENT** | client 60000 ms (`:249-257`) + server 60000 ms (`convex/calls.ts:8`) |
| "Callee is busy / unavailable / offline" states | **ABSENT** | `convex/schema.ts:87-93` has no `busy`/`unavailable`; only a throw at `convex/calls.ts:54` |
| Call-ended push to a backgrounded peer | **ABSENT** | `convex/calls.ts:197-213` schedules no push |
| Lock-screen / full-screen takeover | **PARTIAL** | `fullScreenAction` present (`callNotifications.ts:72`) but `MainActivity` declares no `showWhenLocked`/`turnScreenOn` (`AndroidManifest.xml:27-39`), and `USE_FULL_SCREEN_INTENT` is Android-14+ revocable (see `docs/ux-research/notifee-sound-actions.md:110, 155`) |

---

## Severity counts

| Severity | Count | Findings |
|---|---|---|
| CRITICAL | 2 | 1, 2 |
| HIGH | 3 | 3, 4, 5 |
| MEDIUM | 5 | 6, 7, 8, 9, 10 |
| LOW | 2 | 11, 12 |
| **Total** | **12** | |