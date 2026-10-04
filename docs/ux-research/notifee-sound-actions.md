# Notifee 9.1.8 (Android) — sound, loopSound, actions, fullScreenAction, channel immutability

Research only. No app code was modified.

## Method / evidence

- Installed package: `P:\Projects\cometchat-sample-app\node_modules\@notifee\react-native` (9.1.8, see `package.json`).
- The RN package's `android/src/main/java/io/invertase/notifee/*` is only a bridge; every method delegates to `app.notifee.core.Notifee` (e.g. `NotifeeApiModule.java:114-119, 166-171`). The implementation ships precompiled and R8-obfuscated in the bundled AAR:
  `node_modules/@notifee/react-native/android/libs/app/notifee/core/202108261754/core-202108261754.aar`
  (see `android/build.gradle:95-100`). I decompiled `classes.jar` with `javap`; the obfuscated classes `n.o.t.i.f.e.e.r` (ResourceUtils), `app.notifee.core.a` (ChannelManager) and `app.notifee.core.c` (NotificationManager) match the upstream source below line-for-line.
- Upstream source read at the exact release tag: `@notifee/react-native@9.1.8`, commit `f00a8e2702ea980455362ac18f84080093dcf32d` (GitHub `invertase/notifee`). Citations below use those upstream files, which are the code that produced the installed AAR.
- Current app config read (not modified): `src/notifications/callNotifications.ts`.

---

## 1. How `AndroidNotification.sound` is resolved natively

`app.notifee.core.utility.ResourceUtils#getSoundUri` — `android/src/main/java/app/notifee/core/utility/ResourceUtils.java:285-307`:

```java
public static @Nullable Uri getSoundUri(String sound) {
    Context context = ContextHolder.getApplicationContext();
    if (sound == null) {
      return null;
    } else if (sound.contains("://")) {
      return Uri.parse(sound);
    } else if (sound.equalsIgnoreCase("default")) {
      return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    } else {
      // The API user is attempting to set a sound by file name, verify it exists
      int soundResourceId = getResourceIdByName(sound, "raw");
      if (soundResourceId == 0 && sound.contains(".")) {
        soundResourceId = getResourceIdByName(sound.substring(0, sound.lastIndexOf('.')), "raw");
      }

      if (soundResourceId == 0) {
        return null;
      }

      // Use the actual sound name vs the resource ID, to obtain a stable URI, Issue #341
      return Uri.parse("android.resource://" + context.getPackageName() + "/raw/" + sound);
    }
}
```

Supported values, exactly:

| Input | Result | Lines |
| --- | --- | --- |
| Any string containing `://` | `Uri.parse(input)` — arbitrary URI, including `content://settings/system/ringtone` | 289-290 |
| `'default'` (case-insensitive) | `RingtoneManager.getDefaultUri(TYPE_NOTIFICATION)` — the **default notification sound**, **not** the ringtone | 291-292 |
| Raw resource name (e.g. `ringtone`) | `android.resource://<pkg>/raw/<name>`, only if `getIdentifier(name, "raw", pkg) != 0`; extension is optional for validation but the returned URI keeps whatever you passed (`ringtone.wav` → `.../raw/ringtone.wav`) | 294-305 |
| anything else / missing resource | `null` | 300-302 |

- Channel path: `ChannelManager.java:73-91` calls `ResourceUtils.getSoundUri(...)`. If it returns `null` notifee logs `"Unable to retrieve sound for channel, sound was specified as: ..."` and does **not** call `setSound` (channel keeps whatever it had).
- Notification path: `NotificationManager.java:187-198` (`builder.setSound(soundUri)`); on Android 8+ the channel's sound governs, notification-level sound only matters on API < 26.
- `getSoundName()` (reverse mapping, used by `getChannel`) warns that resource-id based sound URIs break across app builds: *"New app builds will fail to play sound. Create a new channel to resolve. Issue #341"* — `ResourceUtils.java:251-283`.

## 2. How `loopSound` is implemented

`NotificationManager.java:585-593`:

```java
// build notification
Notification notification = Objects.requireNonNull(builder).build();
...
NotificationAndroidModel androidBundle = notificationModel.getAndroid();
if (androidBundle.getLoopSound()) {
  notification.flags |= Notification.FLAG_INSISTENT;
}
```

- It is **`Notification.FLAG_INSISTENT`** on the built notification, nothing else. Default is `false` (`NotificationAndroidModel.java:373-375`).
- It does not attach a sound. It makes the sound the system is already playing for that notification (on Android 8+ = the **channel** sound) repeat until the notification is cancelled. If the channel is silent, `loopSound` does nothing.
- Whether the system actually loops the channel sound is platform/OEM-dependent (see uncertainty).

## 3. Actions (`addAction`), limits and hiding

`NotificationManager.java:350-424` (`actionsContinuation`):

```java
ArrayList<NotificationAndroidActionModel> actionBundles = androidModel.getActions();
if (actionBundles == null) { return builder; }

for (NotificationAndroidActionModel actionBundle : actionBundles) {
  PendingIntent pendingIntent = null;
  int targetSdkVersion = ...getApplicationInfo().targetSdkVersion;
  if (targetSdkVersion >= Build.VERSION_CODES.S && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    pendingIntent = NotificationPendingIntent.createIntent(...);   // :366-375
  } else {
    pendingIntent = ReceiverService.createIntent(...);              // :376-383
  }
  ...
  NotificationCompat.Action.Builder actionBuilder =
      new NotificationCompat.Action.Builder(
          iconCompat, TextUtils.fromHtml(actionBundle.getTitle()), pendingIntent);
  ...
  builder.addAction(actionBuilder.build());                         // :420
}
```

- **Notifee-side limit: none.** Every entry in `android.actions` is added, regardless of `fullScreenAction`, sound, channel, or `ongoing`. There is no code path that hides actions.
- JS validation only requires `title` + a valid `pressAction`; icons are optional (`dist/validators/validateAndroidAction.js:13-51`, `validateAndroidNotification.js:54-70`).
- Platform limit: Android renders up to **3** action buttons (notifee docs, Interaction → Quick Actions; Android design docs). Notifee does not enforce this; extras are dropped by SystemUI.
- On Android 12+ (targetSdk 31+ / API 31+) actions without `launchActivity` are delivered via `NotificationPendingIntent`/`ReceiverService` as broadcasts and fire `ACTION_PRESS`; they still render normally.
- Notifee-specific pitfalls that can make actions disappear:
  1. Re-posting `displayNotification` for the **same notification id** without `actions` replaces the notification and removes the buttons.
  2. An action with a missing/invalid `pressAction` throws at JS validation time (no notification at all).
  3. Missing icon is fine on Android 7+ (text-only), but some OEM skins render text-only actions inconsistently (device-specific, unverified here).
- Why only a system **Dismiss** button can appear: on Android 14+ the platform, not notifee, takes over. When a notification requests a full-screen intent but the app does not hold `USE_FULL_SCREEN_INTENT`, SystemUI converts it into a *sticky heads-up notification* ("HUN with pill buttons for 60s", AOSP `source.android.com/docs/core/permissions/fsi-limits`) and supplies a system dismiss affordance. AOSP `NotificationEntry.java` implements this via `FLAG_FSI_REQUESTED_BUT_DENIED` (`isStickyAndNotDemoted()`). This app targets SDK 36 (`android/build.gradle:6`), so the restriction applies. This is platform behavior; notifee has no API to change it.

## 4. `fullScreenAction` → notification, and `launchActivity: 'default'`

`NotificationManager.java:299-344`:

```java
if (androidModel.hasFullScreenAction()) {
  NotificationAndroidPressActionModel fullScreenActionBundle = androidModel.getFullScreenAction();
  String launchActivity = fullScreenActionBundle.getLaunchActivity();
  Class launchActivityClass = IntentUtils.getLaunchActivity(launchActivity);
  if (launchActivityClass == null) {
    Logger.e(TAG, String.format("Launch Activity for full-screen action does not exist ('%s').", launchActivity));
    return builder;
  }

  Intent launchIntent = new Intent(getApplicationContext(), launchActivityClass);
  if (fullScreenActionBundle.getLaunchActivityFlags() != -1) {
    launchIntent.addFlags(fullScreenActionBundle.getLaunchActivityFlags());
  }
  ...
  PendingIntent fullScreenPendingIntent =
      PendingIntent.getActivity(
          getApplicationContext(),
          notificationModel.getHashCode(),
          launchIntent,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
  builder.setFullScreenIntent(fullScreenPendingIntent, true);
}
```

- `'default'` resolution — `IntentUtils.java:91-98`:

```java
if (launchActivity != null && !launchActivity.equals("default")) {
  activity = launchActivity;
} else {
  activity = getMainActivityClassName();
}
```

  `getMainActivityClassName()` uses `PackageManager.getLaunchIntentForPackage(packageName)` (`IntentUtils.java:125-135`). In this app that is `com.rajofearth.synomilo.MainActivity` (`android/app/src/main/AndroidManifest.xml:26`).
- `setFullScreenIntent(..., true)` = high-priority FSI.
- Android 11/12 caveats in code: none specific; the only version branch is the targetSdk≥31 action-PendingIntent routing (`:366-367`). Platform caveats:
  - FSI only auto-launches when the screen is locked/off; while unlocked it is a heads-up notification (Android docs).
  - Android 14+ (targetSdk 34+, this app is 36): `USE_FULL_SCREEN_INTENT` is revoked by Play for non-calling/alarm apps and is user-toggleable under Special App Access. If not granted, the FSI never launches and the sticky-HUN/"Dismiss" behavior above occurs. Notifee 9.1.8 exposes no `canUseFullScreenIntent()` check; that must be added natively (e.g. `NotificationManager.canUseFullScreenIntent()` + `Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` with a `package:` data URI).
  - The launched activity should declare `android:showWhenLocked="true" android:turnScreenOn="true"`.

## 5. Channel immutability — changing sound requires a NEW channel id

`ChannelManager.java:43-96`:

```java
NotificationChannel channel =
    new NotificationChannel(channelModel.getId(), channelModel.getName(), channelModel.getImportance());
...
if (channelModel.getSound() != null) {
  Uri soundUri = ResourceUtils.getSoundUri(channelModel.getSound());
  if (soundUri != null) {
    AudioAttributes audioAttributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build();
    channel.setSound(soundUri, audioAttributes);
  } else { Logger.w(...); }
} else {
  channel.setSound(null, null);
}

NotificationManagerCompat.from(ContextHolder.getApplicationContext())
    .createNotificationChannel(channel);      // :92-93 — always called, even if channel exists
```

- Notifee always calls `createNotificationChannel`, but **Android ignores changes to sound/importance/vibration/etc. for an existing channel** (only metadata like name/description can be updated). Notifee docs: *"Once the channel has been created only metadata values such as the name can be updated"* (`docs/react-native/android/channels.mdx:66`).
- Notifee itself relies on this: `ResourceUtils.java:257-260` tells users to *"Create a new channel to resolve. Issue #341"* when a channel's sound URI is stale.
- Conclusion: to change/fix the sound, create a **new channel id** (e.g. `incoming_call_v2`). `notifee.deleteChannel('incoming_call_v1')` also works but resets user settings; a new id is the standard fix.

---

## 6. Recommended configuration

Current app (read-only reference): channel `incoming_call_v1` with `sound: 'ringtone'` (`src/notifications/callNotifications.ts:25-33`); notification with `loopSound: true` (`:65`) and a single `Decline` action with no `launchActivity` (`:73`). `android/app/src/main/res/raw/ringtone.wav` exists (132 KB), so `'ringtone'` resolves — if the channel is silent, the most likely causes are channel immutability (channel first created silent / with a stale resource-id URI, or user/OEM muted it), not the URI mapping.

```ts
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';

// MUST be a new id: Android ignores sound changes on an existing channel.
export const CALL_CHANNEL_ID = 'incoming_call_v2';

export async function ensureCallChannel(): Promise<void> {
  await notifee.createChannel({
    id: CALL_CHANNEL_ID,
    name: 'Incoming calls',
    importance: AndroidImportance.HIGH,
    // Device's default RINGTONE (any string containing "://" is parsed as a URI,
    // ResourceUtils.java:289-290). notifee's 'default' is only TYPE_NOTIFICATION
    // (ResourceUtils.java:291-292); use this URI for the actual ringtone.
    sound: 'content://settings/system/ringtone',
    vibration: true,
    vibrationPattern: [400, 800, 400, 800],
    visibility: AndroidVisibility.PUBLIC,
  });
}

// ...in showIncomingCallNotification:
await notifee.displayNotification({
  id: callNotificationId(call.callId),
  title: call.type === 'video' ? 'Incoming video call' : 'Incoming voice call',
  body: `${call.callerName} is calling…`,
  data: { type: 'call', callId: call.callId, callType: call.type, callerName: call.callerName },
  android: {
    channelId: CALL_CHANNEL_ID,
    category: AndroidCategory.CALL,
    importance: AndroidImportance.HIGH,
    loopSound: true,        // FLAG_INSISTENT repeats the channel sound (NotificationManager.java:590-593)
    ongoing: true,
    autoCancel: false,
    visibility: AndroidVisibility.PUBLIC,
    smallIcon: 'ic_stat_call',
    fullScreenAction: { id: 'accept-call', launchActivity: 'default' },
    pressAction: { id: 'accept-call', launchActivity: 'default' },
    actions: [
      { title: 'Decline', pressAction: { id: 'decline-call' } },
      { title: 'Accept', pressAction: { id: 'accept-call', launchActivity: 'default' } },
    ],
  },
});
```

Why this satisfies the requirements:

- **Loud ring**: the sound lives on the (new) channel, which is the only thing Android 8+ plays. `content://settings/system/ringtone` is the canonical device default ringtone URI and is accepted by `getSoundUri`. `loopSound: true` adds `FLAG_INSISTENT`, repeating it until the notification is cancelled.
- **Fallback**: if the ringtone URI fails on a specific OEM (see uncertainty), use `sound: 'default'` (default notification tone) or keep the bundled `ringtone` raw resource (long WAV + `loopSound`).
- **Full-screen**: `fullScreenAction` with `launchActivity: 'default'` → `setFullScreenIntent(..., true)`; ensure `USE_FULL_SCREEN_INTENT` is granted at runtime (Android 14+) and that `MainActivity` has `showWhenLocked`/`turnScreenOn`.
- **Two actions**: notifee adds both unconditionally; `Accept` carries `launchActivity: 'default'` so pressing it opens the app (and fires `ACTION_PRESS` with `id: 'accept-call'`). Keep `pressAction` on the body too.
- **Sanity checks after deploy**: `notifee.getChannel(CALL_CHANNEL_ID)` should show `soundURI` and `importance`; `notifee.isChannelBlocked(CALL_CHANNEL_ID)` should be false. If the old `incoming_call_v1` is still referenced anywhere, retire it.

## Uncertainty / caveats

1. `content://settings/system/ringtone` is the standard AOSP default-ringtone URI and SettingsProvider resolves it for playback, but behavior on heavily customized OEM builds is not guaranteed; test on the target devices. `'default'` (TYPE_NOTIFICATION) and a bundled raw loop are the safest fallbacks.
2. `FLAG_INSISTENT` looping of a *channel* sound is known to be OEM-dependent; if a device does not loop it, truly phone-like ringing requires native `AudioManager`/`Ringtone` playback in a foreground service (outside notifee 9.1.8).
3. The exact rendering of Android 14+'s sticky-HUN/FSI-denied presentation (whether the app's actions are shown as pills alongside the system Dismiss) is SystemUI/OEM behavior. The notifee source attaches all actions unconditionally, so if `Decline` is truly absent in the shade, verify the displayed notification actually contains `actions` (e.g. inspect `notifee.getDisplayedNotifications()`), that no later update re-posted the same id without actions, and that FSI permission is granted.
4. Notifee 9.1.8 has no `NotificationManager.canUseFullScreenIntent()` / `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` helper; the Android 14+ FSI permission check must be implemented natively.
