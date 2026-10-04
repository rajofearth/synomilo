# Incoming call UX with Notifee — implementation research (React Native 0.81.4 / bridgeless / Android)

Status: research complete, facts verified against npm, notifee.app docs, the archived notifee source (tag 9.1.8 / `main`), the notify-kit fork (10.8.0), and Android/AOSP docs.
App context: Android-only, `com.rajofearth.synomilo`, New Architecture ENABLED (bridgeless), Hermes, RN 0.81.4 (targets Android 16 / API 36), React 19.1.

---

## 0. TL;DR decision

| Option | Version | Verdict |
|---|---|---|
| `@notifee/react-native` | **9.1.8** (latest; Dec 20 2024) | Works, but **unmaintained**. Repo archived Apr 7 2026. Known new-arch flakiness + Gradle/Maven resolution issues on modern RN. Only pick if you accept these risks. |
| `react-native-notify-kit` | **10.8.0** (actively released, Oct 2026) | **Recommended.** API-identical drop-in fork, New-Arch-only TurboModules (min RN 0.73, dev target 0.84), compiles core from source, fixes cold-start `getInitialNotification`, adds `getNotificationSettings().android.fullScreenIntent`, RNFB tap-handler opt-out. One-line import swap. |
| `expo-notifications` | n/a | Invertase's own recommendation, but a bigger migration; overkill for this Android-only feature set. |

All code below is written for `@notifee/react-native` and is **byte-for-byte API compatible** with `react-native-notify-kit` — switch by changing the import specifier.

---

## 1. Library version & New Architecture compatibility

### Exact version to install
```bash
# Requested stack (risk accepted):
npm i @notifee/react-native@9.1.8

# Recommended maintained drop-in:
npm i react-native-notify-kit@10.8.0
```

### Verified facts
- `@notifee/react-native@9.1.8` is the newest npm version (last published Dec 2024). The GitHub repo was **archived Apr 7 2026**; README now says "no longer actively maintained" and recommends `expo-notifications` or the community fork `react-native-notify-kit` ([repo](https://github.com/invertase/notifee), [issue #1254](https://github.com/invertase/notifee/issues/1254)).
- New Architecture support exists since 9.1.4 (`fix another new architecture issue ... null ReactContext, #1176`). Notifee's headless task detects bridgeless via `DefaultNewArchitectureEntryPoint.getBridgelessEnabled()` and starts `ReactHost` with reflection — i.e. it can run on RN 0.81 bridgeless (verified in `HeadlessTask.java`, shipped tarball).
- BUT 9.1.8 predates RN 0.81 (Aug 2025) by ~8 months and has open reports:
  - [#1221](https://github.com/invertase/notifee/issues/1221): notifications "super flaky" on New Arch; killed-app notifications not received; Foreground Service partially reliable. (Closed *not planned*.)
  - [#1279](https://github.com/invertase/notifee/issues/1279): `onBackgroundEvent` not triggered when pressing a push notification in background/quit (Dec 2025).
  - [#1284](https://github.com/invertase/notifee/issues/1284): Android build fails resolving `app.notifee:core:+` (JitPack timeout) — the library injects a local Maven repo into `rootProject.allprojects`, which conflicts with RN 0.74+ `dependencyResolutionManagement` ([#1079](https://github.com/invertase/notifee/issues/1079), [#1226](https://github.com/invertase/notifee/issues/1226), [#1262](https://github.com/invertase/notifee/issues/1262)).
  - The pinned native core AAR (`android/libs/app/notifee/core/202108261754`) and library `compileSdk 34` are older than RN 0.81's API 36 baseline; expect AGP warnings or failures depending on your AGP version.

### Required steps for `@notifee/react-native@9.1.8`
1. Install + autolink only (RN ≥ 0.60). No pod steps (Android-only app). Rebuild: `npx react-native run-android`.
2. Gradle: if the build fails with `Could not resolve app.notifee:core` / `FAIL_ON_PROJECT_REPOS` / JitPack timeout, you must work around the repo injection (e.g. remove `dependencyResolutionManagement FAIL_ON_PROJECT_REPOS`, or add `maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }` to your app's `android/build.gradle`). There is no upstream fix — this is the fork's #1 motivation.
3. Manifest + permission changes (section 4).
4. Rebuild the app after adding the ringtone and icon resources.

### Why notify-kit removes that friction (verified in its tarball, 10.8.0)
- Core is compiled from source inside the RN bridge module — no Maven coordinate, no repo injection, no stale-AAR cache issue.
- New Architecture only (TurboModules), Android bridge rewritten in Kotlin, module `compileSdk/targetSdk 35`, requires **JDK 17+**.
- Fixes on top of 9.1.8 (fork README table): `getInitialNotification()` null on cold start, killed-app trigger/FSI display failures, FGS ANR, and adds `setNotificationConfig()` so RNFB tap handlers keep working on iOS (Android never had this problem).

---

## 2. Exact TypeScript API shapes (from `@notifee/react-native@9.1.8` `.d.ts`; identical in notify-kit 10.8.0)

```ts
// Module methods used here
createChannel(channel: AndroidChannel): Promise<string>;
displayNotification(notification: Notification): Promise<string>;
cancelNotification(notificationId: string, tag?: string): Promise<void>;
cancelDisplayedNotification(notificationId: string, tag?: string): Promise<void>;
requestPermission(permissions?: IOSNotificationPermissions): Promise<NotificationSettings>;
openNotificationSettings(channelId?: string): Promise<void>;
onForegroundEvent(observer: (event: Event) => void): () => void;   // returns unsubscribe
onBackgroundEvent(observer: (event: Event) => Promise<void>): void; // Promise required
getInitialNotification(): Promise<InitialNotification | null>;
```

```ts
interface AndroidChannel {
  id: string;
  name: string;
  importance?: AndroidImportance;        // default DEFAULT (3)
  sound?: string;                        // raw resource name, no extension; 'default' = system
  vibration?: boolean;                   // default true
  vibrationPattern?: number[];           // even count; API 26+ set on channel, immutable
  bypassDnd?: boolean;                   // API 29+; only honored with DND policy access
  visibility?: AndroidVisibility;        // default PRIVATE (0)
  lights?: boolean;
  lightColor?: AndroidColor | string;
  badge?: boolean;                       // default true
  description?: string;                  // API 28+
  groupId?: string;
  readonly soundURI?: string;
}
```

```ts
interface Notification {
  id?: string;                 // stable id; same id updates the same notification
  title?: string;
  subtitle?: string;
  body?: string;
  data?: { [key: string]: string | object | number };
  android?: NotificationAndroid;
  ios?: NotificationIOS;
}

interface NotificationAndroid {
  actions?: AndroidAction[];               // up to 3 buttons
  autoCancel?: boolean;                    // default true
  category?: AndroidCategory;              // CALL = "call"
  channelId?: string;
  color?: AndroidColor | string;
  fullScreenAction?: NotificationFullScreenAction;
  importance?: AndroidImportance;          // only matters API < 26
  loopSound?: boolean;                     // sets FLAG_INSISTENT
  ongoing?: boolean;                       // sets FLAG_NO_CLEAR, not swipeable
  pressAction?: NotificationPressAction;
  showTimestamp?: boolean;                 // needs timestamp
  smallIcon?: string;                      // drawable resource name; default 'ic_launcher'
  smallIconLevel?: number;
  timeoutAfter?: number;                   // ms; system auto-cancel
  timestamp?: number;                      // ms
  vibrationPattern?: number[];             // only matters API < 26
  visibility?: AndroidVisibility;          // only matters API < 26
  // also: asForegroundService, foregroundServiceTypes, flags, onlyAlertOnce, style, progress…
}

interface AndroidAction {
  title: string;
  pressAction: NotificationPressAction;    // required
  icon?: string;                           // http URL or local; newer Androids may hide it
  input?: true | AndroidInput;
}

interface NotificationPressAction {
  id: string;                              // read in event.detail.pressAction.id
  launchActivity?: string;                 // 'default' = app's launcher activity
  launchActivityFlags?: AndroidLaunchActivityFlag[];
  mainComponent?: string;                  // advanced; requires native getMainComponentName override
}

interface NotificationFullScreenAction {
  id: string;                              // 'default' auto-maps launchActivity to 'default'
  launchActivity?: string;
  launchActivityFlags?: AndroidLaunchActivityFlag[];
  mainComponent?: string;
}
```

```ts
enum AndroidImportance { NONE = 0, MIN = 1, LOW = 2, DEFAULT = 3, HIGH = 4 }
enum AndroidVisibility { PRIVATE = 0, PUBLIC = 1, SECRET = -1 }
enum AndroidCategory { ALARM = 'alarm', CALL = 'call', MESSAGE = 'msg', /* … */ }
enum AndroidForegroundServiceType { /* DATA_SYNC, MEDIA_PLAYBACK, PHONE_CALL, MICROPHONE, … */ }
enum AndroidLaunchActivityFlag { NO_HISTORY = 0, SINGLE_TOP = 1, NEW_TASK = 2, CLEAR_TOP = 3, /* … */ }
```

```ts
enum EventType {
  UNKNOWN = -1, DISMISSED = 0, PRESS = 1, ACTION_PRESS = 2,
  DELIVERED = 3, APP_BLOCKED = 4, CHANNEL_BLOCKED = 5,
  CHANNEL_GROUP_BLOCKED = 6, TRIGGER_NOTIFICATION_CREATED = 7, FG_ALREADY_EXIST = 8,
}
interface Event { type: EventType; detail: EventDetail }
interface EventDetail {
  notification?: Notification;
  pressAction?: NotificationPressAction;   // only for PRESS / ACTION_PRESS
  input?: string;
  channel?: NativeAndroidChannel;
  channelGroup?: NativeAndroidChannelGroup;
  blocked?: boolean;
}
interface InitialNotification {
  notification: Notification;
  pressAction: NotificationPressAction;
  input?: string;
}
```

**`smallIcon` — custom drawable:** put the file at `android/app/src/main/res/drawable/ic_stat_call.png` (or use Android Studio: right-click `app/src/main` → New → Image Asset → **Notification Icons**). Then `smallIcon: 'ic_stat_call'` — the **file name without extension**. Vector XML drawables work too. Must be white-on-transparent; Android tints it with `color`.

**Custom ringtone:** `android/app/src/main/res/raw/ringtone.mp3` (`.mp3` only, local files only), then channel `sound: 'ringtone'` — **name without extension**. If the file is missing, the system default plays. API 26+ sound is set on the channel and is **immutable after creation** → bump the channel id (`incoming_call_v1` → `v2`) to change ringtone.

---

## 3. Implementation-ready code

### 3.1 Channel setup (`src/notifications/callChannel.ts`)

```ts
import notifee, {
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';

export const INCOMING_CALL_CHANNEL_ID = 'incoming_call_v1';

export async function ensureIncomingCallChannel(): Promise<string> {
  return notifee.createChannel({
    id: INCOMING_CALL_CHANNEL_ID,
    name: 'Incoming calls',
    description: 'Ringing, vibration and full-screen alerts for incoming calls',
    importance: AndroidImportance.HIGH,
    sound: 'ringtone',                       // res/raw/ringtone.mp3
    vibration: true,
    vibrationPattern: [0, 700, 700, 700, 700, 700],
    bypassDnd: true,                         // best-effort; see §4.6
    lights: true,
    lightColor: '#22C55E',
    visibility: AndroidVisibility.PUBLIC,    // shown in full on secure lock screen
    badge: false,
  });
}
```

### 3.2 Display incoming call (`src/notifications/incomingCall.ts`)

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  type Notification,
} from '@notifee/react-native';
import { ensureIncomingCallChannel, INCOMING_CALL_CHANNEL_ID } from './callChannel';

export interface IncomingCall {
  callId: string;
  callerId: string;
  callerName: string;
  callType?: 'audio' | 'video';
}

export const PENDING_CALL_KEY = 'pendingIncomingCall';
export const callNotificationId = (callId: string) => `call:${callId}`;

export async function displayIncomingCall(
  call: IncomingCall,
  ringTimeoutMs = 45_000,
): Promise<string> {
  await ensureIncomingCallChannel();

  // FSI cold start on upstream 9.1.8 may not deliver notification extras, so persist state.
  await AsyncStorage.setItem(PENDING_CALL_KEY, JSON.stringify(call));

  const notification: Notification = {
    id: callNotificationId(call.callId),
    title: 'Incoming call',
    body: call.callType === 'video'
      ? `${call.callerName} · Video call`
      : `${call.callerName} is calling`,
    data: {
      kind: 'incoming-call',
      callId: call.callId,
      callerId: call.callerId,
    },
    android: {
      channelId: INCOMING_CALL_CHANNEL_ID,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,     // pre-API-26 fallback
      loopSound: true,                        // FLAG_INSISTENT: ringtone loops
      ongoing: true,                          // not swipeable / not "Clear all"-able
      autoCancel: false,                      // we cancel explicitly on accept/decline/timeout
      timeoutAfter: ringTimeoutMs,            // system auto-cancel; stops the loop even if JS dies
      showTimestamp: true,
      timestamp: Date.now(),
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: 'ic_stat_call',              // res/drawable/ic_stat_call.png
      color: '#22C55E',
      pressAction: { id: 'open-call', launchActivity: 'default' },
      fullScreenAction: { id: 'default' },    // validator adds launchActivity:'default'
      actions: [
        // No launchActivity => handled entirely in headless JS; the app does NOT open.
        { title: 'Decline', pressAction: { id: 'decline' } },
        // launchActivity 'default' => opens the app, then the in-app call screen handles it.
        { title: 'Accept', pressAction: { id: 'accept', launchActivity: 'default' } },
      ],
    },
  };

  return notifee.displayNotification(notification);
}

export async function cancelIncomingCall(callId: string): Promise<void> {
  await notifee.cancelNotification(callNotificationId(callId));
  await AsyncStorage.removeItem(PENDING_CALL_KEY);
}
```

### 3.3 Decline-in-background + event routing (`index.js`, top-level, before `AppRegistry`)

```js
import { AppRegistry } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';

notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;
  const callId = notification?.data?.callId;

  if (type === EventType.ACTION_PRESS && pressAction?.id === 'decline' && callId) {
    // Runs in Headless JS: app stays closed. AsyncStorage + fetch/WebSocket are available.
    await AsyncStorage.setItem(`call:declined:${callId}`, String(Date.now()));
    await notifee.cancelNotification(notification.id); // stops ringtone/vibration now
    // optional: await api.declineCall(callId)              // must finish within 60s (§5.4)
  }

  if (type === EventType.DISMISSED) {
    // Not fired for cancelNotification/timeout; safety net only.
    if (notification?.data?.kind === 'incoming-call') {
      await AsyncStorage.setItem(`call:missed:${callId}`, String(Date.now()));
    }
  }
});

AppRegistry.registerComponent(appName, () => App);
```

> Register the background handler at module scope. Notifee registers its own headless task (`app.notifee.notification-event`) during JS module evaluation, and events are queued until the handler exists. A killed app will boot the JS bundle headlessly to run this.

### 3.4 Cold-start routing (`App.tsx`)

```tsx
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { EventType } from '@notifee/react-native';
import { PENDING_CALL_KEY } from './src/notifications/incomingCall';

export default function App() {
  // Cold start: notification press / action press / FSI launch.
  useEffect(() => {
    let alive = true;
    (async () => {
      const initial = await notifee.getInitialNotification();
      const actionId = initial?.pressAction?.id; // 'accept' | 'open-call' | 'decline'

      if (actionId === 'accept' || actionId === 'open-call') {
        // Opened by tapping the notification body or Accept.
        routeToCall(initial?.notification?.data);
      } else {
        // FSI launch on upstream 9.1.8 may return null (see §5.5) — fall back to persisted state.
        const pending = await AsyncStorage.getItem(PENDING_CALL_KEY);
        if (pending && alive) routeToCall(JSON.parse(pending));
      }
    })();
    return () => { alive = false; };
  }, []);

  // Warm/foreground events (app running, visible).
  useEffect(() => {
    return notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'accept') {
        routeToCall(detail.notification?.data);
      }
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'decline') {
        endCallInApp(detail.notification?.data?.callId);
      }
      if (type === EventType.PRESS && detail.notification?.data?.kind === 'incoming-call') {
        routeToCall(detail.notification?.data);
      }
    });
  }, []);

  /* … */
}
```

> Note: `getInitialNotification()` consumes the sticky initial-notification on first call. Call it once in your bootstrap and cache the result.

---

## 4. Event flow — what fires where (verified against notifee native source)

| Scenario | Native path | JS events | `getInitialNotification()` |
|---|---|---|---|
| App foreground, tap notification body | `NotificationReceiverActivity` | `PRESS` → `onForegroundEvent` | n/a |
| App foreground, tap Action | `NotificationReceiverActivity` | `ACTION_PRESS` → `onForegroundEvent` | n/a |
| App background (alive) or killed, tap **Decline** (no `launchActivity`) | `ReceiverService` → headless | `ACTION_PRESS` → `onBackgroundEvent` (headless). **App does not open.** | Sticky initial event posted; available if app is opened later |
| App background/killed, tap **Accept** (`launchActivity: 'default'`) | `PendingIntent.getActivities([launch, receiver])` | Activity opens; `ACTION_PRESS` delivered once JS is up (foreground/headless depending on state) | Yes (sticky event) |
| App killed, **FSI** launches (auto on lock, or tap full-screen UI) | `PendingIntent.getActivity` built from `fullScreenAction` | **No PRESS/ACTION_PRESS event.** | **May be `null`** upstream (FSI intent carries no `notification` extra unless `mainComponent` is set). Use persisted state. |
| User swipes notification away | dismiss intent | `DISMISSED` | n/a |
| `cancelNotification` / `timeoutAfter` | — | **No `DISMISSED`** (documented) | n/a |

Important source-level details:
- Action without `launchActivity`/`mainComponent` → `createLaunchActivityIntent()` returns `null`; the PendingIntent targets `ReceiverService` → **headless event, app stays closed**. This is exactly how "Decline without opening the app" works.
- Action with `launchActivity: 'default'` → `getLaunchIntentForPackage()` resolves `MainActivity`; PendingIntent launches `[MainActivity, NotificationReceiverActivity]` → app opens **and** event is emitted.
- Press/action handlers post a sticky `InitialNotificationEvent` before dispatching, hence `getInitialNotification()` works for those paths.
- `fullScreenAction: { id: 'default' }` is rewritten in JS validation to `launchActivity: 'default'`.

### Headless JS constraints (measured from tarball source)
- Hard timeout: **60 000 ms** (`HeadlessTask.java`, `TASK_TIMEOUT = 60000`); task name `app.notifee.notification-event`; bridgeless supported via `ReactHost` reflection.
- No UI/React context. AsyncStorage, fetch, WebSockets, and `notifee.*` calls all work.
- The handler **must return a Promise**; notifee resolves the headless task when it settles. Keep work short (< 60 s); do network calls opportunistically and persist locally first.
- If another library (e.g. RNFirebase messaging) already warmed the React context, notifee reuses it (`createReactContextAndScheduleTask` checks first).

---

## 5. Android platform requirements & behavior

### 5.1 `AndroidManifest.xml` (app module)

Notifee's own manifest only adds an init `ContentProvider` — none of the permissions below are merged automatically. Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.VIBRATE" />
```

Activity flags (required for FSI on lock screen + screen wake):
```xml
<activity
  android:name=".MainActivity"
  android:launchMode="singleTask"
  android:showWhenLocked="true"
  android:turnScreenOn="true"
  android:exported="true"
  android:windowSoftInputMode="adjustResize">
  <!-- existing intent-filter stays -->
</activity>
```
`showWhenLocked` / `turnScreenOn` are API 27+; both solved natively on Android 11+ (no window-flag fallback needed).

Runtime notification permission (Android 13+, i.e. all of your devices once targetSdk 36):
```ts
await notifee.requestPermission(); // native side requests POST_NOTIFICATIONS on API 33+
```
(Verified in `NotifeeApiModule.java`: API < 33 resolves settings; API ≥ 33 calls `requestPermissions(POST_NOTIFICATIONS)` on the current activity. Call it from a visible screen; from headless it degrades to a settings read.)

### 5.2 Behavior by Android version

| | Android 11 / 12 (test devices) | Android 13 | Android 14+ (targetSdk ≥ 34; your target is 36) |
|---|---|---|---|
| Notification permission | Granted by default | **Runtime `POST_NOTIFICATIONS`** required, else nothing displays (no FSI, no sound) | Same as 13 |
| `USE_FULL_SCREEN_INTENT` | Normal permission, auto-granted at install | Same | **Special app access.** Auto-granted only to apps whose core function is calling/alarms. Play revokes it for others; user must enable *Settings → Special app access → Full screen intents*. Play Console **declaration required** |
| FSI granted | Full-screen activity over lock screen; heads-up when device unlocked/in use | Same | Same (locked/off/AOD → FSI; unlocked → persistent heads-up with buttons) |
| FSI denied | n/a (auto) | n/a (auto) | Locked/off/AOD → **heads-up with buttons up to 60 s** instead of full screen (AOSP FSI limits) |
| Notification cooldown (15/16) | n/a | n/a | Does not mute incoming calls |

Consequences for this app: even if the Play declaration is approved (call functionality), any end-user can revoke FSI; design the flow to work in HUN fallback (buttons still work) and detect/handle denial.

### 5.3 Does `loopSound` + channel sound give a continuous ringtone?
Yes. `loopSound: true` sets `Notification.FLAG_INSISTENT` (verified in `NotificationManager.java`: `notification.flags |= Notification.FLAG_INSISTENT`), and Android repeats the notification audio (channel sound on API 26+) until the notification is cancelled or the notification shade is opened. The sound must be on the **channel** (`res/raw/ringtone.mp3`), because per-notification `android.sound` is ignored on API 26+.

### 5.4 Does `timeoutAfter` stop the sound?
Yes. `timeoutAfter` maps to `Notification.setTimeoutAfter(ms)` (verified in `NotificationManager.java`), a **system-side** auto-cancel. On cancel, insistent audio stops and the notification disappears. This also means the ring stops reliably even if JS/Hermes was killed after display — prefer it over a JS `setTimeout`.

Cancellation APIs:
```ts
await notifee.cancelNotification('call:123');          // works from foreground or headless
await notifee.cancelDisplayedNotification('call:123'); // displayed-only variant
```
`cancelNotification` does not cancel Foreground Service notifications; it does cancel displayed + trigger notifications for that id. Use one stable id (`call:<callId>`) from every code path (FCM handler, socket event, headless decline) so cancellation is always reliable.

### 5.5 FSI over lock screen, visibility, and Accept auto-launch
- FSI **does** display over the lock screen when the permission is granted: `fullScreenAction` + `MainActivity` `showWhenLocked`/`turnScreenOn`. While the device is unlocked and in use, Android shows a heads-up notification instead of a full-screen takeover (platform behavior, not a bug).
- `visibility: AndroidVisibility.PUBLIC` on the **channel** controls notification content on secure lock screens (immutable after creation). It is not what makes the FSI activity full screen — the activity attributes do that.
- The **Accept** action can auto-launch the activity: `pressAction: { id: 'accept', launchActivity: 'default' }` (verified: launch intent is built from `getLaunchIntentForPackage`, delivered via `PendingIntent.getActivities`). **Decline** omits `launchActivity`, so it is handled by `ReceiverService` in headless JS and never opens the activity.
- The FSI itself is a separate `PendingIntent.getActivity` over the launch intent. On upstream 9.1.8 the FSI intent does **not** carry the notification bundle (only `mainComponent` paths attach extras), so a pure FSI cold start may yield `getInitialNotification() === null`. **Always persist the pending call** (see §3.2) and treat it as the source of truth on cold start; verify on device. The fork's bug-fix table claims a cold-start fix — re-verify if you adopt notify-kit.

### 5.6 Other platform gotchas
- **`bypassDnd`**: Android only honors it for apps holding DND policy access (`NotificationManager.isNotificationPolicyAccessGranted`) and only while the channel has not been user-modified. Treat as best-effort; never rely on it for emergency ringing.
- **Vibration loop**: channel pattern vibrates on alert; `FLAG_INSISTENT` explicitly repeats *audio*. Some OEMs may not repeat vibration indefinitely — verify on your Android 11/12 devices; when the in-app call screen is visible, drive `Vibration.vibrate(pattern, true)` yourself and cancel it on accept/decline.
- **Channel immutability**: `sound`, `vibrationPattern`, `visibility`, `bypassDnd`, `importance` (lowering only) cannot be changed after creation. Version channel ids when you need changes.
- **R8 / `shrinkResources true`**: release builds can strip the ringtone/icon. Keep them:
  ```xml
  <!-- android/app/src/main/res/raw/keep.xml -->
  <resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@raw/ringtone,@drawable/ic_stat_call" />
  ```
- **Force-stop**: after the user force-stops the app (or Android 15+ auto-stop), the app cannot receive pushes until it is manually reopened; Android 15 also cancels pending intents. Notify/ux should treat force-stop as unsupported.
- **OEM background killers** (Xiaomi/Huawei/Oppo etc.) may delay/kill FCM and headless work. If test coverage includes those, an active call Foreground Service is the reliable path — but on Android 14+ that requires declaring `foregroundServiceType` on `app.notifee.core.ForegroundService` + `FOREGROUND_SERVICE_PHONE_CALL`/`MANAGE_OWN_CALLS` and Play policy compliance; out of scope for this notification-only design.

---

## 6. Notifee + RNFirebase messaging coexistence

- On **Android**, notifee does **not** intercept RNFB's `onNotificationOpenedApp` / `getInitialNotification`; that breakage is iOS-only ([#912](https://github.com/invertase/notifee/issues/912); release notes explicitly say events "on Android will continue to work as normal"). Your app is Android-only, so no workaround needed. (notify-kit adds `setNotificationConfig()` for the iOS case.)
- Both libraries use separate Headless JS task keys — notifee: `app.notifee.notification-event` (and `app.notifee.foreground-service-headless-task`); RNFirebase registers its own messaging task. No collision; notifee reuses an already-created React context.
- Register both handlers at the very top of `index.js`:
  ```js
  messaging().setBackgroundMessageHandler(onMessageReceived); // RNFB (data-only FCM)
  notifee.onBackgroundEvent(handler);                          // notifee events
  ```
- Recommended FCM pattern (also notifee's documented pattern): send **data-only** messages; in `onMessageReceived` (killed/background) and `messaging().onMessage` (foreground) persist the call and call `notifee.displayNotification(...)` from §3.2. Avoid mixed `notification`+`data` payloads — the Android system auto-displays those and notification extras can be sealed in the tap PendingIntent, breaking data recovery.
- 60-second headless budget applies to the RNFB background handler too; persist first, display second, network last.

---

## 7. Risks & mitigations (ranked)

1. **Unmaintained dependency** (9.1.8, repo archived; flakiness on New Arch #1221, background-event gaps #1279, Gradle resolution #1284). *Mitigation:* use `react-native-notify-kit@10.8.0` (same API, same snippets) or budget time for a migration to `expo-notifications` later.
2. **FSI permission on Android 14+/targetSdk 36** (Play Console declaration; user grant; HUN fallback). *Mitigation:* declare in manifest, complete Play Console declaration, design for HUN fallback, detect state with notify-kit's `settings.android.fullScreenIntent` (upstream 9.1.8 has **no** JS API for this — it only exposes `alarm`), or add a tiny native `canUseFullScreenIntent()` check.
3. **Cold-start race on FSI** (`getInitialNotification()` may be null). *Mitigation:* persisted pending-call state + `getDisplayedNotifications()` reconciliation; clear state on all terminal paths.
4. **Channel immutability / user-disabled channel or app notifications**. *Mitigation:* version channel ids; check `getNotificationSettings()`/`getChannel()` and guide the user via `openNotificationSettings()`.
5. **`bypassDnd` needs policy access; vibration loop OEM-dependent.** *Mitigation:* best-effort only; in-app vibration + in-app ringtone once the call screen is visible.
6. **Force-stop / OEM killers.** *Mitigation:* documented limitation; `timeoutAfter` ensures stale rings stop; consider FGS later if reliability demands it.

---

## 8. Test matrix (suggested, on real devices)

For each of Android 11, 12, 13, 14 (and one OEM skin if available), app state = foreground / background / killed / locked:
1. Display: full-screen over lock screen (FSI granted), heads-up when unlocked, ringtone loops, vibration.
2. Decline from shade → app does **not** open; ring stops; headless log shows `ACTION_PRESS decline`.
3. Accept from shade → app opens; call screen connects; ring stops.
4. FSI tap → app opens; pending call restored via AsyncStorage (verify `getInitialNotification` value; expect null on upstream).
5. Remote cancel (callee hangs up / caller cancels) → `cancelNotification` stops ring in foreground, background, and killed (via FCM data handler + headless).
6. Ring timeout with app killed → notification auto-cancels and audio stops.
7. Android 13+ fresh install → permission dialog flow; Android 14 → revoke FSI in Special app access → HUN fallback with working buttons.
8. FCM data-only push while killed → notification appears (RNFB headless + notifee display).
9. Release build with `shrinkResources` → ringtone/icon survive.

---

## 9. Sources

- npm: `@notifee/react-native@9.1.8` (latest; Dec 2024); `react-native-notify-kit@10.8.0` (tarballs inspected: `.d.ts`, native Java/Kotlin sources, manifests, build.gradle).
- GitHub: [invertase/notifee archived](https://github.com/invertase/notifee) + [issue #1254](https://github.com/invertase/notifee/issues/1254); issues [#1077](https://github.com/invertase/notifee/issues/1077), [#1128](https://github.com/invertase/notifee/issues/1128), [#1221](https://github.com/invertase/notifee/issues/1221), [#1279](https://github.com/invertase/notifee/issues/1279), [#1284](https://github.com/invertase/notifee/issues/1284); [marcocrupi/react-native-notify-kit](https://github.com/marcocrupi/react-native-notify-kit).
- Notifee docs: [Channels](https://notifee.app/react-native/docs/android/channels), [Behaviour (loopSound, timeoutAfter, full-screen)](https://notifee.app/react-native/docs/android/behaviour), [Interaction (actions, launchActivity)](https://notifee.app/react-native/docs/android/interaction), [Events](https://notifee.app/react-native/docs/events), [FCM integration](https://notifee.app/react-native/docs/integrations/fcm), [Appearance (smallIcon)](https://notifee.app/react-native/docs/android/appearance), [Installation](https://notifee.app/react-native/docs/installation).
- Native source verified: `HeadlessTask.java` (60 s timeout, bridgeless), `NotificationManager.java` (setFullScreenIntent, setTimeoutAfter, FLAG_INSISTENT, flags), `NotificationReceiverHandler.java` / `ReceiverService.java` / `NotificationPendingIntent.java` (action vs launch paths, sticky initial notification), `Notifee.java` (`getInitialNotification` fallback), `NotifeeApiModule.java` (`POST_NOTIFICATIONS`).
- Android: [Behavior changes 14+ (FSI)](https://developer.android.com/about/versions/14/behavior-changes-14), [AOSP FSI limits + permission table](https://source.android.com/docs/core/permissions/fsi-limits), [NotificationChannel.setBypassDnd](https://developer.android.com/reference/android/app/NotificationChannel#setBypassDnd(boolean)), [Play FSI declaration](https://support.google.com/googleplay/android-developer/answer/13392821).
- RN 0.81: [release blog — defaults to targetSdk/API 36](https://reactnative.dev/blog/2025/08/12/react-native-0.81).
