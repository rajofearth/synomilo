# Audit 01 - Incoming-call ringing path

Scope: `index.js`, `src/notifications/*`, `src/utils/CometChatPushV2.ts`,
`src/components/calls/IncomingCallOverlay.tsx`, `App.tsx`, `convex/push.ts`,
`convex/calls.ts`, `convex/users.ts`, `convex/schema.ts`, Android manifest/gradle/res,
iOS AppDelegate/Info.plist/entitlements, plus the CometChat push package in `node_modules`
where its behaviour is the only thing that can explain an observed symptom.

User bug: *"if I call somebody, sometimes their phone rings, sometimes it doesn't, or it only
rings when I have the app open"* + *"a notification is shown but it is a vague normal notification
rather than a WhatsApp-style full-screen incoming-call UI."*

---

## Root cause summary

### 1. The call push is a `notification`+`data` payload, so Play Services draws it - the client's full-screen ring code is not on the critical path.

`convex/calls.ts:85` schedules `internal.push.sendToTokens`, and `convex/push.ts:45-61` puts a real
`notification: { title, body }` block **and** `android.priority: "high"` in the same message. Per FCM
semantics, a message carrying a `notification` block is rendered by the system tray when the app is
backgrounded or killed; the app's own handlers are a secondary path. Git confirms this was a
deliberate change:

```
git show e63d82d -- convex/calls.ts
-      await ctx.scheduler.runAfter(0, internal.push.sendDataToTokens, {
+      await ctx.scheduler.runAfter(0, internal.push.sendToTokens, {
         tokens: [callee.pushToken],
+        title: me.displayName,
+        body: type === "video" ? "Incoming video call" : "Incoming voice call",
+        tag: `call:${callId}`,
+        channelId: "incoming_call_v2",
```
> *"Call pushes are notification+data on the call channel so Play services displays them even when
> the app cannot wake"*

Consequence: the produced notification is a plain heads-up on channel `incoming_call_v2`
(`convex/calls.ts:90`). It has **no** `fullScreenAction`, **no** `category: call`, **no** Accept/Decline
actions and **no** loop - i.e. exactly the "vague normal notification" the user describes.
`internal.push.sendDataToTokens` (`convex/push.ts:80-101`) - the data-only sender the whole
Notifee full-screen design depends on - is now **dead code**; `rg` finds zero callers.

### 2. Even when the Notifee path *does* run, its "full screen" is a `MainActivity` launch on an activity that was deliberately stripped of `showWhenLocked`/`turnScreenOn`.

`src/notifications/callNotifications.ts:72` uses `fullScreenAction: { id: 'accept-call', launchActivity: 'default' }`.
`launchActivity: 'default'` resolves through `PackageManager.getLaunchIntentForPackage` to the single
launcher activity (`docs/ux-research/notifee-sound-actions.md:141-151`), i.e.
`com.rajofearth.synomilo.MainActivity`. That activity has **no** `android:showWhenLocked` and **no**
`android:turnScreenOn` (`android/app/src/main/AndroidManifest.xml:27-39`) - both were removed in the
same commit `e63d82d` (*"Removed showWhenLocked/turnScreenOn so the app never bypasses the keyguard"*).
There is **no dedicated ringing activity in this app's manifest at all** (only the CometChat library's
`CallRingingActivity`, which Notifee does not target). So on a locked screen the FSI launches an
ordinary React Native activity behind the keyguard: a blank/unusable screen.

### 3. `USE_FULL_SCREEN_INTENT` is declared but unverifiable at runtime, and Android 14+ silently downgrades it to a sticky heads-up - which is what the user is actually seeing.

`android/app/src/main/AndroidManifest.xml:14` declares it, but `android/build.gradle:6` sets
`targetSdkVersion = 36`, where it is *Special app access*, user-revocable and Play-revocable.
Notifee 9.1.8 exposes no way to check it (`docs/ux-research/notifee-sound-actions.md:155,256`). When it
is not granted, AOSP converts the FSI into a sticky HUN with a system "Dismiss" pill
(`docs/ux-research/notifee-sound-actions.md:110`). No code in this repo detects or surfaces that.

**Honourable mention (rank 4, and the other half of "sometimes it just doesn't ring"):**
`App.tsx:167-180` refuses to even fetch/store the FCM token if the permission prompt returns
non-granted, while `convex/calls.ts:84` silently sends nothing when `callee.pushToken` is falsy -
no error, no log. A user who dismissed the Android 13+ prompt once is permanently unreachable.

---

## Findings

### 1. [CRITICAL] Incoming-call push is `notification`+`data`; the system, not the app, draws the background ring

* **Evidence:** `convex/calls.ts:84-98` -> `internal.push.sendToTokens`; `convex/push.ts:45-61`
  (`notification: { title, body }`, `android.priority: "high"`, `android.notification.channelId`).
  Commit `e63d82d` switched `calls.start` away from `sendDataToTokens`.
  `src/notifications/background.ts:28-40` / `src/notifications/callNotifications.ts:47-84` are the
  intended data-only -> FSI path and are unreachable in the background/killed case.
* **Impact:** Background/killed callers get an auto-displayed tray notification with the *channel's*
  sound (API 26+ ignores the per-message `sound: "default"` at `convex/push.ts:54`) played **once** -
  no `loopSound`, no FSI, no actions. This is the reported symptom.
* **Fix:** Revert `convex/calls.ts:85` to `internal.push.sendDataToTokens` (`convex/push.ts:80-101`,
  already correct: data-only, `priority: high`, `ttlMs`). Add a *separate* terminal-state data push
  (see finding 7) so a caller hanging up stops the ring.

### 2. [CRITICAL] No ringing `Activity`; the FSI target cannot show over the keyguard

* **Evidence:** `src/notifications/callNotifications.ts:72-73` (`launchActivity: 'default'`);
  `android/app/src/main/AndroidManifest.xml:27-39` has a single `MainActivity`, `launchMode="singleTask"`,
  **no** `showWhenLocked` / `turnScreenOn`; `rg -n "showWhenLocked|turnScreenOn" android/app/src` returns
  nothing (removed in `e63d82d`). No app-owned `FullScreenActivity` / `CallRingingActivity` exists -
  only `com.cometchat.pushnotification.reactnative.CallRingingActivity`, which Notifee never targets
  (`docs/ux-research/notifee-sound-actions.md:141-151`).
* **Impact:** FSI over the lock screen launches a keyguard-obscured RN activity. Users see nothing;
  taps fall through to the RN activity, not to the accept/decline UI.
* **Fix:** Add a dedicated `CallRingingActivity` (own task, `showWhenLocked`, `turnScreenOn`,
  `singleTop`, `excludeFromRecents`, no-launcher theme), read the payload from its intent extra, render
  caller + Accept/Decline, and point both `fullScreenAction.launchActivity` and `pressAction` at it.

### 3. [CRITICAL] `fullScreenAction.id` is `'accept-call'` - the full-screen intent itself accepts the call

* **Evidence:** `src/notifications/callNotifications.ts:72`
  `fullScreenAction: { id: 'accept-call', launchActivity: 'default' }`, against the project's own
  guidance: *"the full-screen intent must open the ringing screen, **never the accept action**, or a
  locked-screen call would auto-answer"* (`docs/ux-research/original-call-notifications.md:200-201`).
* **Impact:** Whenever FSI actually fires (Android 11/12, or FSI granted on 14+), the ringing screen is
  an **accept** button. Locking the phone during an incoming call answers it.
* **Fix:** `fullScreenAction: { id: 'open-call', launchActivity: 'CallRingingActivity' }` once
  finding 2's activity exists.

### 4. [CRITICAL] `USE_FULL_SCREEN_INTENT` cannot be verified at runtime on `targetSdk 36`; silent downgrade to a sticky HUN

* **Evidence:** declared at `android/app/src/main/AndroidManifest.xml:14`; `android/build.gradle:6`
  (`targetSdkVersion = "36"`); Notifee 9.1.8 has no `canUseFullScreenIntent` API
  (`docs/ux-research/notifee-sound-actions.md:155,256`); downgrade behaviour described at
  `docs/ux-research/notifee-sound-actions.md:110` and `docs/ux-research/notifee-call-notifications.md:431,487`.
  The research doc explicitly prescribes *"add a tiny native `canUseFullScreenIntent()` check"*
  (`docs/ux-research/notifee-call-notifications.md:487`) - **not implemented**.
* **Impact:** On most real devices the "full-screen" experience is a 60-second sticky HUN, i.e. exactly
  "a vague normal notification".
* **Fix:** Add a ~15-line native module exposing `canUseFullScreenIntent()`; on false, deep-link to
  `Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`. Alternatively migrate to
  `react-native-notify-kit@10.8.0`, whose `getNotificationSettings().android.fullScreenIntent` covers this
  (`docs/ux-research/notifee-call-notifications.md:13,49`).

### 5. [CRITICAL] Two `FirebaseMessagingService`s claim `com.google.firebase.MESSAGING_EVENT`; token-refresh and message routing are undefined

* **Evidence (source manifests):**
  `node_modules/@react-native-firebase/messaging/android/src/main/AndroidManifest.xml:12-15` and
  `node_modules/@cometchat/push-notifications-react-native/android/src/main/AndroidManifest.xml:43-48`.
  **Proof in the built app:** `android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml:139-145`
  and `:233-239` both carry `<action android:name="com.google.firebase.MESSAGING_EVENT" />`.
  The CometChat manifest comment says so itself: *"Android allows only ONE FirebaseMessagingService:
  if the app has its own, remove/override this and call CometChatPushInternal from that service instead."*
* **Impact:** Whichever service the OS binds is the one that gets `onMessageReceived`/`onNewToken`. If
  RNFB's loses, `App.tsx:181-185 onTokenRefresh` never fires, `convex/users.ts:21` is never updated
  after the first token rotation, and the callee silently stops receiving calls. The project never
  applied the documented `tools:node="remove"` override.
* **Fix:** Keep one. Simplest for this architecture: remove `CometChatFcmService` with
  `<service android:name="com.cometchat.pushnotification.reactnative.CometChatFcmService"
  tools:node="remove"/>` (it has no role once finding 6 is resolved), or delegate
  `CometChatFcmService.handleMessage/handleNewToken` from `ReactNativeFirebaseMessagingService`.

### 6. [HIGH] The CometChat native ring engine is a *third* ringer for this app's own Convex pushes

* **Evidence:** `CometChatFcmService.kt:42-43` returns true for `data["type"] == "call"`;
  `convex/calls.ts:92` sends `type: "call"` with **no** `callAction`, so
  `CometChatFcmService.kt:78` takes the `null ->` branch -> `IncomingCallService.kt:92
  IncomingCallService.start(ctx, data)` -> `startForeground(FOREGROUND_SERVICE_TYPE_PHONE_CALL)` +
  `CallRingingActivity` FSI (`IncomingCallService.kt:67-103`). The only thing suppressing it in the
  foreground is `ringInForeground: false` (`src/utils/CometChatPushV2.ts:132`) - **background is not
  suppressed**. On answer it calls `CometChat.acceptCall(info.sessionId)`
  (`CometChatPushNotifications.ts:338-361`) for a `sessionId` this app never created.
* **Impact:** In the background the callee can get *two* notifications and *two* ring sources; the
  CometChat half then fails its accept and tears itself down
  (`CometChatPushNotifications.ts:350-355`). Non-deterministic, and a maintenance landmine.
* **Fix:** Remove this listener of Convex's push (finding 5) - the app is plain WebRTC over Convex
  signalling (`src/components/calls/WebRTCCallScreen.tsx:15-22,115-131`), not CometChat Calls.

### 7. [HIGH] No push is sent when a ringing call is cancelled, ended or times out

* **Evidence:** `convex/calls.ts:197-213` (`end`), `convex/calls.ts:187-195` (`markTimedOut`) and the
  auto-reject loop at `convex/calls.ts:66-68` contain **no** `internal.push` call. The only cancel paths
  are client-side (`src/components/calls/WebRTCCallScreen.tsx:69`,
  `src/components/calls/IncomingCallOverlay.tsx:52,77,85`, `src/notifications/background.ts:101,117`),
  which only run where JS is alive.
* **Impact:** Caller hangs up -> callee's phone keeps ringing for the full
  `timeoutAfter: 60000` (`src/notifications/callNotifications.ts:69`) / `RING_TIMEOUT_MS = 60000`
  (`convex/calls.ts:8`). The project docs call this out as a requirement:
  `docs/ux-research/original-call-notifications.md:402-404,410-412`.
* **Fix:** Emit `internal.push.sendDataToTokens({ data: { type: 'call', callId, callAction: 'cancelled' } })`
  from `end` and `markTimedOut`; teach `src/notifications/background.ts:28-40` to
  `dismissCallNotification` on terminal actions. (This is also what
  `CometChatFcmService.kt:95-105` does for real CometChat pushes.)

### 8. [HIGH] The FCM token is never stored if the permission prompt is not granted - and the server fails silently

* **Evidence:** `App.tsx:167-180`:
  ```ts
  const granted = await requestPushPermission();
  if (cancelled || !granted) { return; }          // <- returns BEFORE getFcmToken()
  const fcmToken = await getFcmToken();
  if (fcmToken) { setPushToken({ token: sessionToken, pushToken: fcmToken })... }
  ```
  `src/notifications/push.ts:4-27` returns `false` if `POST_NOTIFICATIONS` is denied (Android 13+).
  `convex/calls.ts:84` - `if (callee.pushToken) { ... }` - no `else`, no log.
* **Impact:** A single dismissed system prompt makes a device permanently unringable, with zero signal
  on either side. Also: the token write is gated behind a full permission-dialog round trip, so a call
  placed in the first seconds after a cold start may find `pushToken` still `undefined`.
* **Fix:** Persist the token *regardless* of the permission result (permission gates *display*, not
  *registration*); add an `else { console.warn('call push skipped: callee has no token', ...) }` and a
  dashboard/metric on `sendToTokens` failures (`convex/push.ts:62-71` already logs, nothing consumes it).

### 9. [HIGH] The push token is never cleared on sign-out

* **Evidence:** `src/auth/SessionProvider.tsx:81-92` - `signOut` calls `logoutMutation`,
  `CometChatPushNotifications.unregister()` and `clearCometChatSession()`, but never
  `setPushToken({ token, pushToken: null })`; `convex/users.ts:21` supports `null` via
  `v.union(v.string(), v.null())`.
* **Impact:** After sign-out the device keeps receiving the previous user's incoming calls; after
  another user signs in, the first user's row still holds this device's token.

### 10. [HIGH] One push token per user, last-write-wins - ringing device N+1 kills device N

* **Evidence:** `convex/schema.ts:11` - `pushToken: v.optional(v.string())`, a scalar column on `users`;
  `convex/users.ts:19-22` patches that single field; `convex/calls.ts:86` - `tokens: [callee.pushToken]`.
  Compare `convex/messages.ts:246-255`, which at least fans out over a `tokens: string[]` array.
* **Impact:** Logging in on a tablet silently un-rings the phone. Only one device can ever ring.
* **Fix:** `pushTokens` table `(userId, token, platform, lastSeenAt)` with a `by_user` index;
  `setPushToken` upserts + inserts; `calls.start` reads `by_user` and passes the array; prune tokens
  FCM reports as `UNREGISTERED`/`INVALID_ARGUMENT` (`convex/push.ts:62-71`).

### 11. [HIGH] Two competing tap routers, both of which auto-accept; the pure-FSI cold-start route is dead

* **Evidence:**
  * System (Play-drawn) notification tap -> `src/notifications/push.ts:44-62`
    (`onNotificationOpenedApp` + `getInitialNotification`) -> `App.tsx:194-204`: a plain body tap calls
    `acceptCall(...)` **then** `navigate('CallScreen')`. Auto-accept on body tap.
  * Notifee notification tap -> `App.tsx:276-304`: `EventType.PRESS` also auto-accepts (`:287-302`).
  * Notifee headless -> `src/notifications/background.ts:105-118` defers accept via AsyncStorage
    (the *correct* behaviour).
  * **FSI cold start is broken:** `src/notifications/background.ts:92-96` reads
    `detail?.notification?.data`, and a FSI intent carries no notification extras
    (`docs/ux-research/notifee-call-notifications.md:374,453`). `if (!callId) return` bails, so
    `rememberPendingCall` (`:110-116`) never runs and `App.tsx:239-259 consumePendingCall()` finds
    nothing. Accept-from-lock-screen is dead.
* **Note on the SDK-session question (Q9):** the accept on tap is a **Convex** mutation
  (`convex/calls.ts:156-170`), not `CometChat.acceptCall`, so no CometChat session is required - the
  session-liveness worry does not apply to *this* accept. Navigation is safe on cold start only because
  `src/navigation/NavigationService.ts:22-35` queues and `:37-45` drains on `onReady`
  (`src/navigation/RootStackNavigator.tsx:76-78`).
* **Fix:** Persist the pending call **before** `displayNotification` (as
  `docs/ux-research/notifee-call-notifications.md:236,453` prescribes), and make `pressAction` open the
  ringing activity (`open-call`) rather than auto-accepting.

### 12. [MEDIUM] Registration race: push is wired before `CometChatUIKit.init` / `ensureCometChatSession` finish

* **Evidence:** `App.tsx:311-316` runs `setupPushOnLogin()` keyed only on `isLoggedIn`, while
  `App.tsx:112-142` (`CometChatUIKit.init`) and `App.tsx:148-152` (`ensureCometChatSession`) are
  independent async effects with no ordering. Inside:
  * `src/utils/CometChatPushV2.ts:121-144` -> `chatInitSettings()`
    (`node_modules/@cometchat/push-notifications-react-native/src/internal/chatSdk.ts:65-79`) returns
    `{}` when `CometChat.getAppId()` is still unset -> the native engine saves no appId -> a killed-app
    CometChat ring cannot re-init the SDK
    (`.../src/registerBackgroundCallTask.ts:99-105`).
  * Token registration retries 5 x 3 s then gives up (`.../src/constants.ts:62-64`,
    `.../src/CometChatPushNotifications.ts:322-335`).
* **Also:** `AppConstants.fcmProviderId = ''` and `apnsProviderId = ''` (`src/utils/AppConstants.tsx:4-5`)
  are passed to `CometChatPushNotifications.init` (`src/utils/CometChatPushV2.ts:122-123`), so the
  CometChat-side `registerPushToken` (`.../src/CometChatPushNotifications.ts:161-170`) registers against
  an empty provider id.
* **Fix:** Gate `setupPushOnLogin()` on `hasValidAppCredentials && CometChatUIKit.loggedInUser`.

### 13. [MEDIUM] `CometChat.addCallListener` is registered before the SDK is initialised, unguarded

* **Evidence:** `App.tsx:321-322` runs in a `useEffect(..., [])` (`App.tsx:393`) that executes during the
  first render pass, long before the awaited `CometChatUIKit.init` at `App.tsx:128`. There is no
  `try/catch` around the `addCallListener` call; a throw aborts the effect and silently drops
  `onIncomingCallReceived` / `onOutgoingCallRejected` / `onIncomingCallCancelled` / `ccCallEnded`
  (`App.tsx:325-387`).
* **Fix:** Move registration into the effect that awaits init, or wrap in `try/catch` + retry.

### 14. [MEDIUM] Foreground/background divergence - the "good" ring only exists in the foreground

* **Evidence:** the foreground path is `App.tsx:222-226` -> `messaging().onMessage` ->
  `src/notifications/background.ts:28-40` -> `showIncomingCallNotification`. Play Services suppresses the
  `notification` block while the app is foregrounded, so in the foreground the Notifee FSI ring is the
  **only** thing that fires. In the background the good path depends entirely on RNFB's receiver
  starting `ReactNativeFirebaseMessagingHeadlessService`
  (`node_modules/@react-native-firebase/messaging/.../ReactNativeFirebaseMessagingReceiver.java`), which
  can throw the documented *"Background messages only work if the message priority is set to 'high'"*
  `IllegalStateException` on Android 12+, and which has a 60 s headless budget.
* **Additional divergence:** the foreground listener at `App.tsx:222` is registered inside `AppInner`'s
  mount effect, i.e. it does not exist at all until after `isInitializing`/`sessionLoading` clear
  (`App.tsx:469-478`); the background handler is registered at module scope in `index.js:18-25` and is
  always present.
* **Impact:** This is the literal inversion of the user's phrasing - the *only* state that produces the
  WhatsApp-style UI is the one where it matters least.
* **Fix:** Unify on data-only pushes (finding 1) so both states go through the identical code path.

### 15. [MEDIUM] The channel id the *server* names is created only by the *client*, as a duplicated literal

* **Evidence:** `convex/calls.ts:90` hardcodes `channelId: "incoming_call_v2"`;
  `src/notifications/callNotifications.ts:8` declares `CALL_CHANNEL_ID = 'incoming_call_v2'`; the channel
  is created only from `src/notifications/callNotifications.ts:26-34`, reached from `App.tsx:221` and
  `callNotifications.ts:50`. Default fallback channel is `default`
  (`android/app/src/main/AndroidManifest.xml:41-44`).
* **Impact:** On a fresh install where the Play-delivered notification arrives before any JS has run,
  the named channel may not exist -> Play falls back to `default` (importance HIGH, `vibration: true`,
  **no sound** - `callNotifications.ts:20-25`), so the call does not ring at all. Any future rename of
  the channel must be made in two places.
* **Fix:** After finding 1, remove the server-side `channelId` entirely (data-only messages carry no
  channel). Until then, generate the channel id at build time from one shared constant.

### 16. [MEDIUM] `IncomingCallOverlay` cancels every ringing call notification on mount

* **Evidence:** `src/components/calls/IncomingCallOverlay.tsx:83-87`
  ```ts
  useEffect(() => { if (!incoming) { dismissAllCallNotifications(); } }, [incoming?._id]);
  ```
  The dependency is the **id**, the body reads the **value**: on the first run `incoming` is `undefined`,
  so it cancels every `call:*` notification. The component mounts whenever `isLoggedIn`
  (`App.tsx:500`), so a sign-in that races an incoming call kills the ring.
* **Fix:** Depend on `[incoming]` (or on a boot-vs-ready sentinel) and guard the mount-time run.

### 17. [MEDIUM] No `AppState` reconciliation - nothing stops or refreshes the ring on background/resume

* **Evidence:** the only `AppState` listener in the ring path is `App.tsx:261-265`, which re-runs
  `routePending()` on `'active'`. Nothing listens for `'background'`/`'inactive'`, nothing reconciles
  `notifee.getDisplayedNotifications()` against `api.calls.incoming` on resume.
* **Impact:** A stale `call:*` notification (callee offline, call already `missed`) survives until
  `timeoutAfter` fires 60 s later. Answering it then fails with *"This call is no longer ringing"*
  (`convex/calls.ts:164-166`) and surfaces an Alert (`App.tsx:292-302`).
* **Fix:** On `'active'`, cancel any `call:*` notification whose `callId` is not in `calls.incoming`.

### 18. [MEDIUM] Dead / orphaned code inflating the ringing surface

* **Evidence:**
  * `convex/push.ts:80-101` `sendDataToTokens` - **zero callers** after commit `e63d82d`.
  * `index.js:34` `registerBackgroundCallTask()` -> `.../src/registerBackgroundCallTask.ts:93-119` calls
    `CometChat.rejectCall(sessionId)` for a CometChat session this app never creates, and prewarms JS
    for a ring this app never produces.
  * `App.tsx:485-493` `<CometChatIncomingCall>` + the whole `App.tsx:321-393` call listener are
    unreachable: every real call goes `convex/calls.ts:27` `start` -> `src/components/calls/WebRTCCallScreen.tsx`.
    The only remaining `CometChat.initiateCall` is in the legacy CometChat UIKit screen
    `src/components/conversations/screens/UserInfo.tsx:158`.
  * `App.tsx:35,311-316` + `src/utils/CometChatPushV2.ts` register an entire push engine whose
    call-push path can never fire.
* **Fix:** Delete the CometChat call/push surface (findings 5, 6, 12, 13 all collapse into this).
  Keeps one ring system instead of three.

### 19. [LOW] iOS never gets any call UI

* **Evidence:** `convex/push.ts:58-60` sets `apns.payload.aps.sound = "default"` with **no**
  `contentAvailable: 1`, so iOS shows a banner and never wakes the app. Notifee's call path
  (`src/notifications/callNotifications.ts:47-84`) is Android-only in practice
  (`docs/ux-research/notifee-call-notifications.md:4`). Both entitlement files pin
  `aps-environment` to `development`
  (`ios/SampleAppWithPushNotifications/SampleAppWithPushNotifications.entitlements:5-6`,
  `...Release.entitlements:5-6`), and `Info.plist:53-58` claims `voip` without
  `com.apple.developer.pushkit.unrestricted-voip`.
* **Fix:** `contentAvailable: 1` in `sendToTokens`, use `$(APS_ENVIRONMENT)` in entitlements, and either
  declare PushKit properly or drop `voip`.

### 20. [LOW] Headless budget and per-decline client construction

* **Evidence:** `src/notifications/background.ts:42-55` constructs a new `ConvexHttpClient` per decline
  (no keepalive) inside a 60 s Notifee headless task
  (`docs/ux-research/notifee-call-notifications.md:385`) and swallows all errors (`:52-54`).
  `src/notifications/background.ts:14` `PENDING_CALL_TTL_MS = 120000` is **double** the server's
  `RING_TIMEOUT_MS = 60000` (`convex/calls.ts:8`), so a stale pending call can outlive the call it
  refers to and fail with *"This call is no longer ringing"*.
* **Fix:** Hoist the Convex client to a module singleton; set the TTL to 60 s; log instead of swallow.

### 21. [LOW] README overstates behaviour

* **Evidence:** `README.md:61` - *"Call notifications use the device's default ringtone and a
  full-screen intent so the phone rings like a normal call."* Neither the FSI nor the ring reaches the
  locked screen (findings 2-4). `android/app/src/main/res/drawable/ic_notification2.png`,
  `ic_notification4.png` and `res/raw/ringtone.wav` exist but are referenced nowhere
  (`src/utils/CometChatPushV2.ts:126` uses `ic_notification`, which does exist).

---

## Live push paths

An incoming call is `convex/calls.ts:27 start` -> a **Convex** row + (at most) **one** FCM message. Every
other notification in the app is a *different* consumer of that same message. Nothing here involves
CometChat's servers - the app never creates a CometChat call.

| # | Path | Trigger condition | Fires? | Notification style | Blocked by |
|---|---|---|---|---|---|
| 1 | **Play-drawn system tray notification** - `convex/push.ts:45-61` `notification` block on channel `incoming_call_v2` (`convex/calls.ts:90`) | any incoming call, any app state except foreground | **YES - this is the primary path** | Plain heads-up / tray notification, sound once (channel sound), `tag: call:<id>`, **no FSI, no actions, no loop** | Nothing. Works even with the app killed (unless force-stopped / OEM killer). |
| 2 | **RNFB headless -> Notifee FSI ring** - `index.js:18-25` -> `background.ts:28-40` -> `callNotifications.ts:47-84` | app backgrounded/killed **and** RNFB's receiver manages to start `ReactNativeFirebaseMessagingHeadlessService` | **PARTIAL / unreliable** | `category: CALL`, `loopSound`, `ongoing`, Accept/Decline, `fullScreenAction` | `timeoutAfter: 60 s`; Android 12+ `IllegalStateException` path; duplicate of #1; FSI downgraded to sticky HUN (finding 4); FSI target is keyguard-obscuring `MainActivity` (finding 2) |
| 3 | **`messaging().onMessage` foreground -> Notifee FSI ring** - `App.tsx:222-226` | app **foregrounded** | **YES** | Same Notifee ring as #2 | Only exists after `isInitializing`/`sessionLoading` clear (`App.tsx:469-478`). Rings while the user is looking at the app. |
| 4 | **CometChat native ring engine** - `CometChatFcmService.kt:42-43` matches `type == "call"` -> `IncomingCallService.kt:92` | same payload, **app backgrounded/killed** (foreground suppressed by `ringInForeground: false`, `src/utils/CometChatPushV2.ts:132`) | **CONDITIONALLY - a duplicate ring** | `phoneCall` foreground service + `CallRingingActivity` FSI with Answer/Decline | Service-dispatch conflict (finding 5); answer calls `CometChat.acceptCall` on a non-existent `sessionId` and self-destructs (`CometChatPushNotifications.ts:350-355`) |
| 5 | **In-app `IncomingCallOverlay`** - `src/components/calls/IncomingCallOverlay.tsx:29-39`, live Convex query `api.calls.incoming` | app open (WebSocket) | **YES** | Full-screen in-app card, Accept/Decline | App process only |
| 6 | **`CometChatIncomingCall` (UIKit)** - `App.tsx:485-493` | `CometChat.addCallListener.onIncomingCallReceived` (`App.tsx:325`) | **NEVER** | - | No CometChat call is ever created (calls are Convex + `react-native-webrtc`) |
| 7 | **CometChat server-side call push** | CometChat detects a call on its servers | **NEVER** | - | The app never calls `CometChat.initiateCall` outside the legacy `UserInfo` screen |
| 8 | **Terminal push (caller hung up / timed out)** | `calls.end` / `markTimedOut` | **NEVER SENT** | - | `convex/calls.ts:187-213` contain no `internal.push` call (finding 7) |
| 9 | **`internal.push.sendDataToTokens`** | - | **DEAD CODE** | - | Zero callers after commit `e63d82d` |

**Token registration, resolved (Q4):** *both* happen, and both are worthless for different reasons.

| Registry | Where | Provider id | Verdict |
|---|---|---|---|
| **Convex** `users.pushToken` | `App.tsx:177,182` -> `convex/users.ts:17-24` | n/a (FCM HTTP v1 via `convex/push.ts:10-29`) | **This is the one that matters** - it is what `convex/calls.ts:86` reads. Gated behind the permission dialog (finding 8), never cleared on logout (finding 9), one per user (finding 10), and never refreshed if RNFB's service loses dispatch (finding 5). |
| **CometChat** `CometChatNotifications.registerPushToken` | `src/utils/CometChatPushV2.ts:121-133` -> `.../src/CometChatPushNotifications.ts:301-336,161-170` | `fcmProviderId = ''`, `apnsProviderId = ''` (`src/utils/AppConstants.tsx:4-5`) | **Yes, it happens - and it is useless.** CometChat's push service only has something to send for a CometChat call, and this app never creates one (path #7). Empty provider id would make it undeliverable anyway. |

---

## Missing vs docs/intent

### `docs/ux-research/notifee-call-notifications.md`

| Documented intent | Line | Implemented? | Reality |
|---|---|---|---|
| *"send **data-only** messages ... Avoid mixed `notification`+`data` payloads"* | :479 | **NO** | `convex/calls.ts:85` -> `sendToTokens`, which sends `notification` + `data` (`convex/push.ts:47`). This single deviation is the root cause. |
| *"Always persist the pending call ... treat it as the source of truth on cold start"* | :236, :453, :488 | **NO** | `rememberPendingCall` is called **only** from `src/notifications/background.ts:110`, i.e. *after* a press event - and a pure FSI launch emits none (`:374`, `:453`), so `:92-96` bails first. Accept-from-lock-screen never restores. |
| `MainActivity` needs `android:showWhenLocked="true" android:turnScreenOn="true"` | :404-415 | **NO - deliberately removed** | `android/app/src/main/AndroidManifest.xml:27-39`; commit `e63d82d` removed both. |
| Channel: `sound: 'ringtone'` from `res/raw/ringtone.mp3`, `bypassDnd: true`, `lights`, `lightColor`, `badge: false`, `description` | :190-204 | **PARTIAL** | `src/notifications/callNotifications.ts:26-34` uses `content://settings/system/ringtone` and omits `bypassDnd`/`lights`/`lightColor`/`badge`/`description`. `res/raw/ringtone.wav` ships unused. |
| `fullScreenAction: { id: 'default' }` (opens a **ringing screen**, never accepts) | :263, :452 | **NO - inverted** | `src/notifications/callNotifications.ts:72` uses `id: 'accept-call'`. Auto-accept. |
| Ring timeout `45_000` | :231, :402-404 | **NO** | `src/notifications/callNotifications.ts:69` `timeoutAfter: 60000`; `convex/calls.ts:8` `RING_TIMEOUT_MS = 60000`. |
| Cold-start `getInitialNotification()` handling for FSI/press | :315-341 | **NO** | `notifee.getInitialNotification()` is never called anywhere in the repo (only `messaging().getInitialNotification()` at `src/notifications/push.ts:53-60`). |
| *"add a tiny native `canUseFullScreenIntent()` check"* / HUN-fallback design | :429-434, :487 | **NO** | Nothing detects FSI denial; the app cannot tell it is in fallback. |
| Cold-start reconcile with `getDisplayedNotifications()` | :488, :502 | **NO** | Only `dismissAllCallNotifications` (`src/notifications/callNotifications.ts:94-105`), called from `IncomingCallOverlay.tsx:85`. |
| Register both handlers at the very top of `index.js` | :474-478 | **YES** | `index.js:18-25,28-30`. |

### `docs/ux-research/original-call-notifications.md`

| Documented intent | Line | Implemented? | Reality |
|---|---|---|---|
| FSI must open a ringing screen, **never** the accept action | :200-201, :388-390 | **NO - inverted** | `src/notifications/callNotifications.ts:72`. |
| Dedicated ringing screen with Accept/Decline, `showWhenLocked`/`turnScreenOn`, `singleTop`, `excludeFromRecents` | :212-250, :206-210 | **NO** | No such activity in `android/app/src/main/AndroidManifest.xml:18-61`. |
| `phoneCall` foreground service while ringing | :177-204 | **NO (not the app's)** | Only the CometChat library ships one; this app has none. |
| Explicit cancel on **every** terminal event, and three things torn down (notification, full-screen UI, in-app overlay) | :402-412 | **NO** | Only two exist (notification, in-app overlay) and neither is driven by a push (finding 7). |
| Caller name as title, `Incoming <audio\|video> call` as body, consistent everywhere | :313-325, :380-382 | **PARTIAL** | Notifee ring: title = caller, body = `Incoming video call` (`callNotifications.ts:53-55`). Play notification: title = caller, body = `Incoming video call` (`convex/calls.ts:88`). Two spellings still exist in-repo. |
| "Never let two incoming UIs stack" | :408-409 | **NO** | Findings 6 and 14 stack up to **three** UIs for one call. |
| Loop the in-app ringtone, pause on accept/decline/cancel/timeout/unmount | :398-401 | **NO** | `IncomingCallOverlay` plays no sound at all (`src/components/calls/IncomingCallOverlay.tsx:83-113` animates a pulsing ring only). |

---

## Recommended fix order

1. **Make the call push data-only again** - `convex/calls.ts:85`: `internal.push.sendToTokens` ->
   `internal.push.sendDataToTokens`, drop `title`/`body`/`tag`/`channelId` (finding 1). This alone makes
   the Notifee full-screen ring the *only* path, in every app state, and removes the duplicate
   notification. Highest value per line changed.
2. **Remove the duplicate `FirebaseMessagingService` conflict** (finding 5) - add
   `tools:node="remove"` for `CometChatFcmService` in `android/app/src/main/AndroidManifest.xml`, or
   delegate to it from RNFB's service. Until this is deterministic, step 1's behaviour cannot be reasoned
   about, and token refresh may be dead.
3. **Add a real ringing Activity + point FSI at it** (findings 2, 3) - `CallRingingActivity` with
   `showWhenLocked`/`turnScreenOn`/`singleTop`/`excludeFromRecents`; `fullScreenAction: { id: 'open-call' }`.
4. **Detect and surface `canUseFullScreenIntent()`** (finding 4) - tiny native module + deep link to
   `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`; consider `react-native-notify-kit` as the drop-in that
   already exposes it.
5. **Make token registration unconditional and failure-visible** (findings 8, 9) - store the FCM token
   even when permission is denied; clear it on sign-out; `else`-log in `convex/calls.ts:84`.
6. **Multi-device token table** (finding 10) - `pushTokens` table + fan-out in `calls.start`; prune
   FCM-reported dead tokens.
7. **Terminal push on cancel/end/timeout** (finding 7) - required before the ring can be trusted to
   stop; pairs with finding 17 (resume reconciliation) and 16 (`IncomingCallOverlay` mount cancel).
8. **Persist the pending call before displaying** (finding 11) and make `pressAction` open the ringing
   screen rather than auto-accepting.
9. **Delete the CometChat call/push surface** (finding 18, absorbing 12, 13, 6) -
   `CometChatPushV2.ts`, `setupPushOnLogin`, `registerBackgroundCallTask`, the `addCallListener` effect,
   `CometChatIncomingCall`, `OngoingCallScreen`, `CallHistory`, `fcmProviderId`/`apnsProviderId`.
10. **Housekeeping** - `RING_TIMEOUT_MS` alignment (finding 20), iOS `contentAvailable` + entitlements
    (finding 19), README correction (finding 21).

**Do not** start with step 9 or 10: removing the CometChat surface before step 1 is in place will look
like it fixes the bug (the duplicate ring disappears) while the background experience stays a plain tray
notification.

---

*Related: `docs/audit/04-convex-backend.md` section "Push" (items 29-34) covers token storage shape,
secret handling and multicast chunking from the server side; this document covers the client side of the
same path.*
