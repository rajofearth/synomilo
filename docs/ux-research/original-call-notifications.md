# Original CometChat incoming-call & call-notification implementation

Status: research only. Purpose: document exactly how the **original CometChat sample app** honors
incoming calls and call notifications, so the Convex fork can mirror it instead of the current
Notifee-based UX. No app code was changed for this doc.

Sources read (all paths relative to `P:\Projects\cometchat-sample-app`):

| # | Source | What it is |
|---|---|---|
| 1 | `node_modules/@cometchat/push-notifications-react-native/**` (README + `android/src/main/java/.../*.kt` + `AndroidManifest.xml`, skim of `ios/*.swift`) | The native "display engine": FCM/VoIP receipt, system notification, full-screen ringing screen, Accept/Decline, timeout |
| 2 | `src/utils/CometChatPushV2.ts`, `App.tsx`, `src/utils/AppConstants.tsx` | How the repo consumes call pushes and shows `CometChatIncomingCall` (the in-app original path) |
| 3 | `node_modules/@cometchat/chat-uikit-react-native/src/calls/CometChatIncomingCall/**` | In-app incoming-call UI the user wants to match: labels, layout, ring behavior |
| 4 | `node_modules/@cometchat/calls-sdk-react-native/android/src/main/java/com/CometChatCalls/CallNotificationService.java` | Calls SDK notification helper (ongoing-call notification, channel/sound) |
| — | `src/notifications/*.ts`, `src/components/calls/IncomingCallOverlay.tsx` | The **current** Convex/Notifee path, quoted only for contrast |

There are two original layers, and both matter:

1. **In-app (foreground, WebSocket)** — Chat SDK `CallListener` + UIKit `CometChatIncomingCall` + `CometChatSoundManager`.
2. **System-level (background/killed, FCM/CallKit)** — `@cometchat/push-notifications-react-native`'s Kotlin/Swift display engine.

---

## (a) End-to-end original ring flow

### A1. Foreground / app open — WebSocket path (UIKit)

`App.tsx:296-367` registers a Chat SDK call listener; on an incoming call it checks for an already
active call, hides any open bottom sheet, stores the call and flips `callReceived`, which mounts the
UIKit overlay (`App.tsx:422-430`):

```tsx
// App.tsx:299-332 (abridged)
onIncomingCallReceived: async (call: CometChat.Call) => {
  ...
  const activeCall = CometChat.getActiveCall();
  if (activeCall) {
    setTimeout(() => {
      CometChat.rejectCall(call.getSessionId(), CometChat.CALL_STATUS.BUSY)
      ...
    }, 2000);
  } else {
    CometChatUIEventHandler.emitUIEvent(CometChatUIEvents.ccToggleBottomSheet,
      { isBottomSheetVisible: false });
    incomingCall.current = call;
    setCallReceived(true);
  }
},
onOutgoingCallRejected: () => { incomingCall.current = null; setCallReceived(false); },
onIncomingCallCancelled: () => { incomingCall.current = null; setCallReceived(false); },
```

```tsx
// App.tsx:422-430
{isLoggedIn && callReceived && incomingCall.current ? (
  <CometChatIncomingCall
    call={incomingCall.current}
    onDecline={() => { incomingCall.current = null; setCallReceived(false); }}
  />
) : null}
```

The overlay rings (looped `incomingcall.wav` via `CometChatSoundManager`) and offers
**Decline** / **Accept**. The push package's own `ringInForeground` is turned **off** so the native
engine does not ring twice while the UI Kit screen is up (`src/utils/CometChatPushV2.ts:127-133`):

```ts
await CometChatPushNotifications.init({
  fcmProviderId: AppConstants.fcmProviderId,
  apnsProviderId: AppConstants.apnsProviderId,
  notificationSmallIcon: 'ic_notification',
  showInForeground: true,
  // The UI Kit shows its own incoming-call screen while the app is open, so the
  // system call UI doesn't ring too.
  ringInForeground: false,
});
```

### A2. Background / killed — FCM path (native display engine)

`CometChatFcmService.onMessageReceived` → `handleMessage()` → `handleCall()` when
`data["type"] == "call"` (`CometChatPushConstants.PushTypes.CALL`):

```kotlin
// CometChatFcmService.kt:75-107 (abridged)
private fun handleCall(ctx: Context, data: Map<String, String>) {
  when (data["callAction"]?.lowercase()) {
    CallActions.INITIATED, CallActions.ONGOING, null -> {
      ...
      if (!cfg.voip) return
      // Foreground service → full-screen ringing activity, in any app state.
      IncomingCallService.start(ctx, data)
      CometChatPushInternal.prewarmJs(ctx) // so a Decline can reject before the call ends
    }
    CallActions.CANCELLED, CallActions.ENDED, CallActions.UNANSWERED,
    CallActions.BUSY, CallActions.REJECTED -> {
      IncomingCallService.stop(ctx) // dismiss the ringing UI
      CometChatPushInternal.cancelCall(ctx, data)
      CometChatPushInternal.emitLive(Events.CALL_ENDED, ...)
    }
  }
}
```

Flow, step by step:

1. FCM delivers a data push; `type=call`, `callAction=initiated` (or `ongoing`/absent).
2. `IncomingCallService.start()` (foreground service, `startForegroundService` on O+;
   falls back to a plain notification if the phoneCall FGS is refused).
3. `IncomingCallService.handleShow()` immediately calls `startForeground()` with a
   `CATEGORY_CALL` notification whose `fullScreenIntent` opens `CallRingingActivity`; it also
   best-effort `startActivity(CallRingingActivity)` directly. A 45 s watchdog
   (`RING_TIMEOUT_MS`) dismisses the activity + service if no terminal push arrives.
4. `CallRingingActivity` (full-screen, over lock screen) shows caller + type + round
   Accept/Decline (`IncomingCallService.kt:112-142`, `CallRingingActivity.kt:51-118`).
5. **Answer** → `onAccept()` unlocks if needed, launches the app, emits `CALL_ANSWERED`;
   JS (`CometChatPushNotifications.onCallAnswered`) calls `CometChat.acceptCall(sessionId)` and the
   app navigates to `OngoingCallScreen` (`CometChatPushNotifications.ts:338-361`,
   `src/utils/CometChatPushV2.ts:78-84`).
6. **Decline** → `CallActionReceiver` or `CallRingingActivity.onDecline()` →
   `deliverCallDeclined()`: if JS is alive emit `CALL_DECLINED` (JS rejects via SDK); if killed,
   start the headless task (`CometChatPNBackgroundCall`, action `decline`) **before** dismissing the
   ring, while the FGS is still up, then `dismissRing()`.
7. **Caller cancels / unanswered / busy / rejected push** → `IncomingCallService.stop()` +
   `cancelCall()` (and `CALL_ENDED`).
8. **WebSocket ends the ring without a push** — the package's JS `attachCallListener()` catches
   `onIncomingCallCancelled` / `onCallEndedMessageReceived` / `onOutgoingCallRejected` and calls
   `Native.endCallUI(sessionId)` (`CometChatPushNotifications.ts:242-265`).

Token registration: `onNewToken` → `CometChatPushInternal.onToken` → `TOKEN_RECEIVED` → JS
`CometChatNotifications.registerPushToken(token, FCM_REACT_NATIVE_ANDROID, fcmProviderId)`
(`CometChatPushNotifications.ts:22-54, 301-336`). Registration is retried up to
`TOKEN_MAX_RETRIES`; `unregister()` must run before `CometChat.logout()` (README:117-125).

### A3. iOS (for parity awareness)

PushKit VoIP → `CometChatCallKit.handleIncomingVoIP` → `CXProvider.reportNewIncomingCall(...)` with
`update.localizedCallerName = data["senderName"] ?? data["title"] ?? "Incoming call"`
(`ios/CometChatPushNotificationsBridge.swift:460`); CallKit system UI provides Answer/Decline;
`CXAnswerCallAction` → accept through the same JS handoff. CXProvider config is localized `"Calls"`.

---

## (b) Ringtone playback, full-screen, Accept/Decline — quoted

### B1. Android call notification + ringtone (native engine)

Channel creation — this is the ringtone setup (default **system ringtone**, not a one-shot sound),
plus the insistent flag that makes it loop:

```kotlin
// CometChatPushInternal.kt:193-211
fun ensureChannels(context: Context, cfg: Config) {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
  val mgr = manager(context)
  mgr.createNotificationChannel(
    NotificationChannel(cfg.channelId, cfg.channelName, NotificationManager.IMPORTANCE_HIGH),
  )
  val call = NotificationChannel(CALL_CHANNEL_ID, "Calls", NotificationManager.IMPORTANCE_HIGH).apply {
    setSound(
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
      android.media.AudioAttributes.Builder()
        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build(),
    )
    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    enableVibration(true)
  }
  mgr.createNotificationChannel(call)
}
```

`CALL_CHANNEL_ID = "cometchat_calls"`, default message channel `"cometchat_messages"` /
`"Messages"` (`CometChatPushConstants.kt:92-94`).

The ringing FGS notification (`IncomingCallService.kt:112-142`):

```kotlin
return NotificationCompat.Builder(this, CALL_CHANNEL_ID)
  .setSmallIcon(CometChatPushInternal.smallIcon(this, cfg))
  .setContentTitle(caller)                 // senderName ?: title ?: "Incoming call"
  .setContentText("Incoming $kind call")   // kind = "video" | "audio"
  .setPriority(NotificationCompat.PRIORITY_MAX)
  .setCategory(NotificationCompat.CATEGORY_CALL)
  .setFullScreenIntent(fsPending, true)    // → CallRingingActivity
  .setOngoing(true)
  .setAutoCancel(false)
  .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
  .addAction(0, "Answer", CometChatPushInternal.answerActionIntent(this, data))
  .addAction(0, "Decline", CometChatPushInternal.declineActionIntent(this, data))
  .build()
  // Repeat the ringtone until the call is answered, declined, cancelled or times out —
  // each of those removes this notification. Without it the ringtone plays once.
  .apply { flags = flags or Notification.FLAG_INSISTENT }
```

Fallback plain notification (used when the FGS cannot start), same text/actions plus
`.setTimeoutAfter(RING_TIMEOUT_MS)` and the same `FLAG_INSISTENT`
(`CometChatPushInternal.kt:238-277`). Note the safety comment: the full-screen intent must open the
ringing screen, **never the accept action**, or a locked-screen call would auto-answer.

Timeout: `RING_TIMEOUT_MS = 45_000L` (`CometChatPushConstants.kt:90`); the service watchdog
(`IncomingCallService.kt:84-88`) and the fallback's `setTimeoutAfter` both use it.

Manifest pieces that make it work (`android/src/main/AndroidManifest.xml`): `POST_NOTIFICATIONS`,
`USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE(_PHONE_CALL)`, `MANAGE_OWN_CALLS`, `WAKE_LOCK`,
`RECORD_AUDIO`, `CAMERA`, `BLUETOOTH_CONNECT`; `IncomingCallService` with
`foregroundServiceType="phoneCall"`; `CallRingingActivity` with
`showWhenLocked`/`turnScreenOn`/`singleTop`/`excludeFromRecents`.

### B2. Full-screen ringing screen (quoted structure)

```kotlin
// CallRingingActivity.kt:146-176 (abridged)
private fun onAccept() {
  // Ask to unlock only now, while this screen still shows...
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    (getSystemService(KEYGUARD_SERVICE) as? KeyguardManager)?.requestDismissKeyguard(this, null)
  }
  CometChatPushInternal.launchAppIntent(applicationContext)?.let { startActivity(it) }
  CometChatPushInternal.deliverCallAnswered(applicationContext, data) // stops the ring service
  finish()
}

private fun onDecline() {
  CometChatPushInternal.deliverCallDeclined(applicationContext, data) // stops the ring service
  finish()
}

private fun setupLockScreenFlags() {
  // Show over the lock screen without unlocking it — onAccept() asks for the unlock.
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
    setShowWhenLocked(true)
    setTurnScreenOn(true)
  } else {
    window.addFlags(
      WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
    )
  }
}
```

UI structure (`CallRingingActivity.buildUi`, lines 51-118): white background; top block centered —
caller name 28sp bold `#000000`, subtitle 14sp `#757575`, then a 120 dp circle avatar `#6851D6`
with initials (36sp bold white); bottom row — 72 dp round buttons, Decline `#E53935` with the phone
glyph rotated **135°**, 40 dp gap, Accept `#43A047` (white phone glyph), 56 dp bottom padding.
Status/nav bar insets are applied via `ViewCompat.setOnApplyWindowInsetsListener`.

### B3. Accept/Decline delivery to JS

```kotlin
// CometChatPushInternal.kt:372-393
fun deliverCallAnswered(context: Context, data: Map<String, String>) {
  dismissRing(context, data)
  val info = callInfo(data)
  if (!emitLive(Events.CALL_ANSWERED, info)) {
    storeInitial(context, PrefKeys.INITIAL_CALL, info)  // cold-start replay
  }
}

fun deliverCallDeclined(context: Context, data: Map<String, String>) {
  if (!emitLive(Events.CALL_DECLINED, callInfo(data))) {
    startBackgroundCall(context, TASK_ACTION_DECLINE, data)  // headless reject
  }
  dismissRing(context, data)
}
```

`dismissRing()` clears the whole ring: `CallRingingActivity.dismiss()`,
`IncomingCallService.stop()` and `cancelCall()` (`CometChatPushInternal.kt:429-433`).

### B4. In-app ringtone (UIKit JS, foreground path)

`CometChatIncomingCall.tsx:158-166` starts a looped ringtone on mount and pauses it on
accept/decline/unmount. The manager plays `incomingcall.wav` with `setNumberOfLoops(-1)`:

```js
// node_modules/@cometchat/chat-uikit-react-native/src/shared/resources/CometChatSoundManager/CometChatSoundManager.js:22-58
static onPlay = async (resource, loop, isRequire) => {
  try {
    let otherAudioPlaying = await CometChatSoundModule.checkOtherAudioPlaying();
    if (otherAudioPlaying) {
      Vibration.vibrate(consts.PATTERN, loop);
    } else {
      if (CometChatSoundManager.audio != null) { CometChatSoundManager.pause(); }
      ...
      CometChatSoundManager.audio.setCategory('playback', true);
      CometChatSoundManager.audio.setVolume(1);
      CometChatSoundManager.audio.setCurrentTime(0);
      setTimeout(() => {
        if (loop) { CometChatSoundManager.audio.setNumberOfLoops(-1); }
        CometChatSoundManager.audio.play((e) => { console.log({ e }) });
      }, 500);
    }
  } catch (error) { ... }
};

static async play(sound, customSound, isRequire = false) { /* 'incomingCall' → onPlay(resource, true) */ }
static pause() { /* audio.pause(); Vibration.cancel(); audio.release(); */ }
```

Sound assets: `incomingcall.wav` (plus message/outgoing variants) in
`.../CometChatSoundManager/resources/`. `CometChatIncomingCall` also listens for
`onIncomingCallCancelled` → `CometChatSoundManager.pause()` (`CometChatIncomingCall.tsx:168-176`).

---

## (c) Exact notification text formats

| Layer | Title | Body / subtitle | Actions |
|---|---|---|---|
| Native engine, FCM ring notification (`IncomingCallService.kt:115,129`) | caller name (`senderName` → `title` → `"Incoming call"`) | `Incoming <audio\|video> call` | `Answer`, `Decline` (both with no icon) |
| Native engine, plain fallback (`CometChatPushInternal.kt:242-258`) | same | same | `Answer`, `Decline` |
| Native ringing screen (`CallRingingActivity.kt:45-48`) | caller name (28sp bold) | `Incoming <Voice\|Video> call` (capital V — slight inconsistency with the notification's lowercase) | round green accept / red decline |
| iOS CallKit (`CometChatPushNotificationsBridge.swift:460`) | — | `localizedCallerName` = `senderName`/`title`, fallback `"Incoming call"` | CallKit native |
| UIKit in-app overlay (`CometChatIncomingCall.tsx:267-309`) | sender `name` (fallback `t("INCOMING_CALL")` = `"Incoming Call"`) | phone icon + `Incoming audio call` / `Incoming video call` | text buttons `Decline`, `Accept` |
| Calls SDK ongoing-call notification (`CallNotificationService.java:32-45`) | `Ongoing Call` | `Tap to return to the call`; channel `CALL_NOTIFICATION_CHANNEL` = "Call Notification Service" | none (tap returns) |
| **Current Convex/Notifee (for contrast)** `src/notifications/callNotifications.ts:50-76` | `Incoming video call` / `Incoming voice call` | `${callerName} is calling…` | `Decline` only (plus FSI `accept-call` press action) |

Key takeaway: the original convention is **caller name as the title**, `Incoming audio/video call`
as the body — the current Convex path inverts this. Notification ids are keyed by `sessionId`/call id
so repeats update in place, and the ring notification is `ongoing` + `autoCancel=false`.

---

## (d) In-app incoming screen — exact labels & structure

`CometChatIncomingCall` (UIKit v5.5.1), default render (`CometChatIncomingCall.tsx:257-313`):

```
SafeAreaView (styles.overlay: absolute, top:0 left:10 right:10 bottom:0, zIndex 99999)
└─ View containerStyle (background3, padding 20, borderRadius 12,
     shadow 0/6/0.37/7.49, elevation 12, width 100%)
   ├─ topRow (row, center, space-between)
   │  ├─ LeadingView(call)                     [optional]
   │  ├─ View
   │  │  ├─ TitleView or <Text titleTextStyle> sender.name ?? t("INCOMING_CALL")
   │  │  │    → "Incoming Call" fallback; heading2 bold, textPrimary
   │  │  └─ rowInline: <Icon name='call-fill' size={16}/> + <Text subtitleTextStyle>
   │  │       call.type === audio ? t("INCOMING_AUDIO_CALL") : t("INCOMING_VIDEO_CALL")
   │  │       → "Incoming audio call" / "Incoming video call"; heading4 regular, textSecondary
   │  └─ TrailingView or <CometChatAvatar name image/>  (48×48)
   └─ bottomRow (row, gap 10, space-between, marginTop 16)
      ├─ TouchableOpacity declineCallButtonStyle (flex 1, error bg, py 12, radius 8)
      │    <Text>{t("DECLINE")}</Text>  → "Decline"
      └─ TouchableOpacity acceptCallButtonStyle (flex 1, success bg, py 12, radius 8)
           <Text>{t("ACCEPT")}</Text>  → "Accept"
```

Translations (`.../CometChatLocalizeNew/resources/en/translation.json:158-162`):

```json
"INCOMING_AUDIO_CALL": "Incoming audio call",
"INCOMING_VIDEO_CALL": "Incoming video call",
"DECLINE": "Decline",
"ACCEPT": "Accept",
"INCOMING_CALL": "Incoming Call",
```

Behavior summary: sound loops while mounted (incomingcall.wav); `Decline` →
`CometChat.rejectCall(sessionId, CALL_STATUS.REJECTED)` + pause sound; `Accept` →
`CometChatSoundManager.pause()` + `CometChat.acceptCall(sessionId)` then renders
`CometChatOngoingCall`; cancel → pause sound; unmount → remove listeners + pause
(`CometChatIncomingCall.tsx:103-145, 226-232`). No animation beyond the standard RN render; the
"ring" is the looped sound + vibration.

Contrast — current Convex overlay (`src/components/calls/IncomingCallOverlay.tsx`): dark
full-screen backdrop (`rgba(10,10,16,0.96)`), big centered 120 dp circle avatar, 26 pt name,
96 dp round action buttons with emoji glyphs (`📵` + `Decline`, `📞` + `Accept`), driven by a Convex
`calls.incoming` query rather than a call event. That is the layout to move away from if matching
the original.

---

## (e) What we should mirror (Convex-based implementation)

1. **Caller name is the title; type is the subtitle.** System notification: title = caller
   displayName, body = `Incoming voice call` / `Incoming video call` (pick one casing and keep it
   identical everywhere). Replace `"Incoming video call" / "<name> is calling…"`.
2. **Dedicated high-importance call channel with ringtone + loop.** Channel named `Calls`
   (original id `cometchat_calls`), importance HIGH, sound = system ringtone (`TYPE_RINGTONE`,
   usage `NOTIFICATION_RINGTONE`), `loopSound: true`/`FLAG_INSISTENT` so it rings until handled.
   Current Convex uses a custom `ringtone` raw resource on `incoming_call_v1` — same idea, but the
   loop + terminal cancel contract must be airtight.
3. **Full-screen takeover on lock, heads-up when unlocked.** Full-screen intent → a ringing
   screen/activity that only offers Accept/Decline; never let the FSI itself accept. Request the
   Android 14 FSI declaration. `showWhenLocked` + `turnScreenOn`, keyguard dismissed only on Accept.
4. **Two actions, in the original order: Decline (red/left) then Accept (green/right).** System
   notification labels: `Answer` / `Decline`; in-app labels: `Accept` / `Decline`; in-app buttons
   are wide rounded-rectangles (flex 1, radius 8), not 96 dp circles with emoji.
5. **In-app layout to match:** white/neutral card (`background3`, radius 12, padding 20, elevation
   ~12) with caller name (bold, ~heading2), a phone icon + `Incoming audio/video call` subtitle,
   avatar on the trailing edge (~48 dp), and the Decline/Accept row beneath — instead of the current
   dark full-screen overlay with initials circle and emoji buttons.
6. **Loop the in-app ringtone** (the UIKit uses `incomingcall.wav`, `setNumberOfLoops(-1)`) and
   pause it on accept, decline, remote cancel, timeout, and unmount. Keep it separate from the
   system notification ring so the foreground path doesn't double-ring
   (`ringInForeground: false` equivalent already in place).
7. **45 s local ring timeout as the safety net** (`RING_TIMEOUT_MS`), enforced system-side
   (`setTimeoutAfter`) so the ring stops even if JS is dead; plus explicit cancel on every terminal
   event (accept/decline/cancel/ended/busy/rejected).
8. **Decline must work headlessly** (reject via Convex without opening the UI); Accept may launch
   the app then accept. Original prewarms JS on ring so a later Decline can reject in time — worth
   copying if the Convex reject path is latency-sensitive.
9. **Reject with BUSY when already in an active call** (original: after a 2 s grace), and never let
   two incoming UIs stack.
10. **One notification/interaction identity per call** (`sessionId`/`callId` hashed into the
    notification id) and dismiss *both* the notification and any ringing screen/overlay on end —
    three separate things must be torn down: notification, full-screen UI, in-app overlay.

Doc created for research only; no application code was modified.
