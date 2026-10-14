# 08 - Native Secrets, Android & iOS Configuration Audit

Repo: `P:\Projects\cometchat-sample-app` - React Native 0.81.4 "synomilo", Android + iOS.
Audit date: 2026-10-13. Read-only. No source file was modified.

Scope: (A) secrets/credentials committed to git, (B) Android manifest/gradle/proguard/native modules,
(C) iOS Podfile/AppDelegate/entitlements/Info.plist, plus a concrete call-ringing blocker checklist.

---

## CRITICAL: committed secrets

| # | Artefact | What it unlocks | Who can exploit it | Remediation |
|---|---|---|---|---|
| **C1** | `synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json` (repo root) - **deleted in `f01025d`/`c0e6aa1` but still in history** | Full Firebase Admin SDK service-account **PEM private key** for GCP project `synomilo-92580`. Service account `firebase-adminsdk-fbsvc@synomilo-92580.iam.gserviceaccount.com`. This is the exact same JSON the backend feeds to `firebase-admin` via `FCM_SERVICE_ACCOUNT` (`convex/push.ts:18-26`), i.e. the credential that sends **every push notification and call ring** for this app. | Anyone who can `git clone` the repo, plus every GitHub fork/mirror, cache and CI log. Full admin over project `synomilo-92580`: read/write FCM topics, read all Realtime Database / Firestore / Storage under that project, mint OAuth tokens for the SA, abuse any other resource bound to the project. Remote is the public URL `https://github.com/rajofearth/synomilo.git`. | **Rotate immediately.** In GCP Console: IAM -> `firebase-adminsdk-fbsvc` -> Keys -> delete the leaked key id, create a replacement, set it as the Convex `FCM_SERVICE_ACCOUNT` env var, redeploy. (`scripts/rotate-fcm.mjs` exists for exactly this.) Then **purge from history** (`git filter-repo --path ... --invert-paths` or BFG) and force-push; assume the old key is burned even after purge. Add secret scanning (gitleaks/trufflehog) to CI. |
| **C2** | `cometchat_team_messanger.jks` (repo root) **and** `android/app/cometchat_team_messanger.jks` - byte-identical (SHA-256 `E871060C95B7...`), tracked since the initial commit | A real, long-lived **PKCS12 release signing keystore**. `keytool -list -v` confirms: alias `cometchat`, owner `CN=cometchat, O=CometChat, L=Denver, ST=Colorado`, valid **2024-10-16 -> 2049-10-10**. The store password is the guessable string `cometchat`. | Anyone with repo access. Confirmed usable: `keytool -list -v -keystore cometchat_team_messanger.jks -storepass cometchat` opens it. Any party can produce APKs signed with this identity, and anything that pins/trusts that cert accepts them. It is a publicly-known CometChat sample key, so it is also a cross-tenant risk for other CometChat sample apps built from the same template. | **Remove both copies from the working tree and from history.** Add `*.jks` and `*.p12` to `.gitignore` (currently only `*.keystore` is ignored - see A3). Treat alias `cometchat` as compromised; do not ship it. Nuance: this keystore is *not* referenced by the current build (see C3), so no shipped synomilo APK depends on it. |
| **C3** | `android/app/build.gradle:116` - `signingConfig keystoreProperties['storeFile'] ? signingConfigs.release : signingConfigs.debug` | **Release builds silently fall back to the DEBUG signing config** (`storeFile debug.keystore`, `storePassword 'android'`, `keyAlias 'androiddebugkey'`, `keyPassword 'android'` - all hardcoded at `android/app/build.gradle:96-101`, and `android/app/debug.keystore` is tracked). If `android/keystore.properties` is missing - a fresh clone, a contributor, or a CI job whose secret injection silently failed - `assembleRelease` still succeeds and emits an APK signed with the **well-known Android debug key**. | Everyone. The Android debug keystore password is published in AOSP, and `android/app/debug.keystore` is committed right here. Local dev builds already install with it, so the key is in the trust store of every dev/test device. | **Make the fallback a hard build failure**: throw `GradleException("release signing not configured")` inside the `release` build type when `keystoreProperties['storeFile']` is absent. Rotate the real `synomilo` alias if any debug-signed build was ever distributed. |
| **C4** | `src/utils/AppConstants.tsx:6-7` - CometChat `authKey` + `appId` hardcoded in tracked source | `authKey` is a **CometChat REST API key**. CometChat's client SDK is *designed* to hold it client-side, but it is a full-app credential: anyone can extract it from the JS bundle and authenticate against App `1683794f9fd14c574`, reading/creating users and groups and calling endpoints outside the UI. It also ships inside the release APK's Hermes bundle, so every user has it. | Anyone with the app binary, any MITM on a debug build, any repo reader. | Decide the threat model explicitly. If CometChat supports App-Side / user-scoped auth, migrate to it; otherwise scope the key to the minimum API surface and rotate it. At minimum stop treating it as non-secret in review and document the risk in the README. |
| **C5** | `ios/SampleAppWithPushNotifications/SampleAppWithPushNotifications.entitlements:6` and `...Release.entitlements:6` - `aps-environment` hardcoded to `development` | Not a credential, but it has the same blast radius as one: it **is the direct cause of "calls don't ring on TestFlight/App Store builds"**. See iOS finding I1. | Not attacker-exploitable; a release-blocking defect. | Set `aps-environment` per-configuration (Xcode normally injects `production` for distribution profiles) and wire the Release entitlements file to the target. |
| **C6** | `ios/SampleAppWithPushNotifications.xcodeproj/project.pbxproj:298,328` - `PRODUCT_BUNDLE_IDENTIFIER = com.cometchat.internal.reactnative.ios`, `DEVELOPMENT_TEAM = T9F7QDSC2S` | The iOS app still uses **CometChat's internal demo bundle identifier**, not a synomilo-owned one. Another developer with the same bundle ID can produce a conflicting build; pushes keyed to the bundle ID can be intercepted or impersonated; App Store / TestFlight submission will fail or be rejected. | Any CometChat employee holding team `T9F7QDSC2S` credentials. | Change to a bundle ID owned by this project before any TestFlight/App Store build, and update the Firebase `CFBundleURLSchemes` entry in `Info.plist:28-32` to match. |

**Verified clean (no secret present):**

- `.env.local` - **not tracked**, correctly ignored by `.gitignore:81`. Contains exactly three variable
  *names*: `CONVEX_DEPLOYMENT`, `CONVEX_URL`, `CONVEX_SITE_URL`. **No JWT signing secret, no FCM server
  key, no CometChat API key.** Values were not printed during this audit.
- `google-services.json` (repo root) and `android/app/google-services.json` - **not tracked**, correctly
  ignored by `.gitignore:80` (`**/google-services.json`). Both reference project `synomilo-92580`,
  package `com.rajofearth.synomilo`. The `api_key` entry has **no restriction block at all** (only a
  `current_key` field - no `restrictions`, no `android_client`, no package scoping), so the key is
  unrestricted on the Google Cloud side. Firebase client API keys are normally public, but an
  unrestricted one is trivially abused for quota burn against the project.
- `android/keystore.properties` - **not tracked**, ignored by `.gitignore:78`. Holds `storeFile`,
  `storePassword`, `keyAlias`, `keyPassword`. Values not printed.
- `android/app/synomilo-release.keystore` - **not tracked**, ignored by `.gitignore:34` (`*.keystore`).
  This is the *real* release key (alias `synomilo`) and a **different** key from the committed `.jks`.
- `.github/workflows/android-release.yml` - **no hardcoded secrets.** Lines 47-58 inject
  `GOOGLE_SERVICES_JSON`, `KEYSTORE_BASE64` and `KEYSTORE_PROPERTIES` from `${{ secrets.* }}`. No APK
  signing key is in Actions plaintext. Permissions are scoped to `contents: write` (line 10). One gap: if
  a secret is unset the step still "succeeds" with an empty file and the build falls through to the
  debug-key fallback (C3).
- `ios/GoogleService-Info.plist` - tracked, which is normal and expected for a React Native app.

---

## Git history secrets

The repo is **public** (`origin = https://github.com/rajofearth/synomilo.git`). Its history is linear but
**every commit is duplicated** (each change was committed twice: `0c209b3`/`d1da6fa`, `c0e6aa1`/`f01025d`,
`3c6523c`/`ea124dc`, `6f3d2dd`/`0b0ff55`, `02d0116`/`c9481d6`, `0eb9672`/`9c28d80`, `85d8768`/`83c7f48`,
`d1bf15d`/`281edf9`, `2bcfed2`/`e63d82d`; 19 commits total across all refs, plus tags `v1.0.0`,
`v1.0.3`, `v1.0.6`).

**What a fresh `git clone` of this repo hands an attacker:**

1. **The complete Firebase Admin SDK service-account private key** for GCP project `synomilo-92580`, at
   two locations: `0c209b3:synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json` and
   `d1da6fa:synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json`. Deleting the file in
   `c0e6aa1`/`f01025d` did **not** remove it - the blobs are still reachable from `origin/main`
   (`ca7587c`) and from tags **v1.0.3** (`85d8768`) and **v1.0.6** (`2bcfed2`). Recoverable with a single
   `git show 0c209b3:<path>`.
2. **The CometChat release signing keystore**, twice, at `0c209b3` and `d1da6fa`:
   `cometchat_team_messanger.jks` and `android/app/cometchat_team_messanger.jks`.
3. **The Android debug keystore**, `android/app/debug.keystore`, with password `android` hardcoded in
   `android/app/build.gradle:98-100`. Universal, but listed because it is a tracked signing key.
4. **The CometChat `authKey` and `appId`** in `src/utils/AppConstants.tsx:6-7`.
5. **The full FCM server path in the open**: `convex/push.ts` (the `FCM_SERVICE_ACCOUNT` consumption site)
   and `convex/_generated/server.js:101` (`export const env = process.env`, which re-exports the entire
   Convex deployment environment including `FCM_SERVICE_ACCOUNT` and any JWT secret - standard Convex
   codegen, but it widens accidental exposure; LOW).
6. **Every other source file** - `src/`, `android/`, `ios/`, `convex/`, `package-lock.json`, plus
   `screen1..10.png` screenshots, `metro.log`, and CometChat branding/app-icon assets that have no
   business being in version control.
7. **A rotation tool that documents the attack surface**: `scripts/rotate-fcm.mjs` (added `ca7587c`)
   references the service-account key-management API endpoints, confirming how the key is managed.

**Notably absent** from history: no `.env.local`, no `google-services.json`, no `keystore.properties`, no
`synomilo-release.keystore`. The `.gitignore` hardening in `f01025d`/`c0e6aa1` works going forward, but
history was never rewritten.

---

## Android findings

### Signing-key `.gitignore` coverage

- **A3 [CRITICAL] `*.jks` and `*.p12` are NOT in `.gitignore`.** `.gitignore:34` lists only `*.keystore`
  (with `!debug.keystore` on line 35). `git check-ignore -v` confirms **neither**
  `cometchat_team_messanger.jks` **nor** `android/app/cometchat_team_messanger.jks` matches any pattern -
  they are tracked and completely unprotected. Any new `.jks` dropped in the tree will be committed
  without complaint. Add `*.jks`, `*.p12`, `*.pfx` alongside `*.keystore`.
- **A4 [OK]** `.gitignore:78-82` correctly covers `android/keystore.properties`,
  `*firebase-adminsdk*.json`, `**/google-services.json`, `.env.local`, `.env.*.local` - all verified
  ignored via `git check-ignore`.
- **A5 [LOW]** The pattern `*firebase-adminsdk*.json` only matches filenames containing the literal
  `firebase-adminsdk`. A key downloaded under a different name (e.g. `synomilo-92580-admin-xxx.json`)
  would slip through. Broaden to `*service*account*.json` / `*-admin-*.json`.

### Permissions

App-declared (`android/app/src/main/AndroidManifest.xml`):

| Line | Permission | Verdict |
|---|---|---|
| 5 | `INTERNET` | OK |
| 6 | `WRITE_EXTERNAL_STORAGE` | **MEDIUM** - no-op, ignored on API 29+. No `maxSdkVersion` set. |
| 7 | `READ_EXTERNAL_STORAGE` | **MEDIUM** - same; ignored on API 33+. |
| 8 | `VIBRATE` | OK |
| 9 | `CAMERA` | OK (runtime) |
| 10 | `RECORD_AUDIO` | OK (runtime) |
| 11 | `POST_NOTIFICATIONS` | **PRESENT and correct** - required for Android 13+ ringing. Requested at `src/notifications/push.ts:11-13`. Not a blocker. |
| 12 | `FOREGROUND_SERVICE` | OK |
| 13 | `WAKE_LOCK` | OK |
| 14 | `USE_FULL_SCREEN_INTENT` | **PRESENT** - required for the lock-screen ring. Not a blocker. |
| 15 | `REQUEST_INSTALL_PACKAGES` | **HIGH (store policy)** - used only by the self-updater (`InstallerModule.kt:42-52,152-169`). Play requires a Declaration Form and restricts it to approved use cases. High rejection risk. |
| 16 | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | **MEDIUM (store policy)** - Play restricts direct prompts. Defensively wrapped with a settings-list fallback (`InstallerModule.kt:71-94`). |

Merged in from libraries - confirmed present in the shipped release manifest
(`android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`):
`MODIFY_AUDIO_SETTINGS` (24), `BLUETOOTH_CONNECT` (25), `ACCESS_NETWORK_STATE` (26),
`ACCESS_WIFI_STATE` (27), **`FOREGROUND_SERVICE_PHONE_CALL` (28)**, **`MANAGE_OWN_CALLS` (36)**,
`RECEIVE_BOOT_COMPLETED` (52), `c2dm.permission.RECEIVE` (59),
`providers.gsf.permission.READ_GSERVICES` (60), `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (63/66),
**`SCHEDULE_EXACT_ALARM` (67)**, `finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` (74).

- **Android-1 [OK]** `POST_NOTIFICATIONS`, `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE_PHONE_CALL`,
  `MANAGE_OWN_CALLS`, `SCHEDULE_EXACT_ALARM` and `RECEIVE_BOOT_COMPLETED` all reach the final manifest.
  The Android 14+ `foregroundServiceType="phoneCall"` requirement **is** satisfied - but only by the
  library, nothing in this repo (`merged_manifests/release/...:254-255` declares `IncomingCallService`
  with `android:foregroundServiceType="phoneCall"`). Do not remove the dependency that supplies these.
- **Android-2 [MEDIUM]** `WRITE_EXTERNAL_STORAGE` / `READ_EXTERNAL_STORAGE` have no
  `android:maxSdkVersion` and are dead on every supported level. Add `maxSdkVersion="28"` or delete.
- **Android-3 [HIGH]** `REQUEST_INSTALL_PACKAGES` - Play declaration required; treat as a shipping blocker.

### Components, exported flags, activities, FCM

- **Android-4 [OK]** The app declares exactly one activity, `MainActivity`
  (`AndroidManifest.xml:27-39`): `exported="true"` (line 34), correct `MAIN`/`LAUNCHER` intent-filter
  (35-38), `launchMode="singleTask"` (32), full `configChanges` (31). No unexported component lacks
  `android:exported`.
- **Android-5 [OK]** The app declares no `directBootAware` (correct). The library's FCM service is
  `directBootAware="true"` (`merged_manifests/release/...:496`), which is intended for boot-time push.
- **Android-6 [OK] No declared-but-missing activity - the ring does not crash.** The app manifest does
  **not** declare a `CallActivity`/`IncomingCallActivity`, and does not need to:
  `fullScreenAction.launchActivity: 'default'` (`src/notifications/callNotifications.ts:72-73,78`)
  intentionally targets `MainActivity`, which exists. The dedicated ringing screen
  `CallRingingActivity` is contributed by `@cometchat/push-notifications-react-native` and **does**
  exist as a real Kotlin class
  (`node_modules/@cometchat/push-notifications-react-native/android/src/main/java/.../CallRingingActivity.kt`),
  merged at `merged_manifests/release/...:259-262` with `showWhenLocked="true"`, `turnScreenOn="true"`,
  `excludeFromRecents="true"`, `exported="false"`. Same for `IncomingCallService`,
  `CometChatPushTrampolineActivity`, `CallActionReceiver`, `CometChatHeadlessTaskService` - all present
  as real classes. Also confirmed the launcher intent-filter does **not** need `MESSAGING_EVENT`: FCM
  binds services, not activities.
- **Android-7 [CRITICAL] THREE services claim `com.google.firebase.MESSAGING_EVENT`** in the shipped
  release manifest:
  - `merged_manifests/release/...:139-145` - `io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService`
  - `merged_manifests/release/...:233-239` - `com.cometchat.pushnotification.reactnative.CometChatFcmService`
  - `merged_manifests/release/...:494-501` - `com.google.firebase.messaging.FirebaseMessagingService` (`android:priority="-500"`)

  Android guarantees only **one** `FirebaseMessagingService`. The library's own manifest comments
  (`node_modules/@cometchat/push-notifications-react-native/android/src/main/AndroidManifest.xml:47-52`)
  explicitly warn: *"Android allows only ONE FirebaseMessagingService: if the app has its own,
  remove/override this and call CometChatPushInternal from that service instead."* This app has **two**
  app-level claimants plus the SDK base class, so delivery is nondeterministic - a push can be routed to
  a service that silently ignores it. **Strongest Android-side candidate for "sometimes it doesn't ring".**

### SDK / Gradle levels

- **Android-8 [OK]** `android/build.gradle:2-10`: `minSdkVersion 24`, `compileSdkVersion 36`,
  `targetSdkVersion 36`, `buildToolsVersion "36.0.0"`, `ndkVersion "27.1.12297006"`. The app is already
  on API 36 (Android 16), so every API 34/35 foreground-service and exact-alarm rule is in force - and
  per Android-1 the required permissions and `foregroundServiceType` are present via the library.
- **Android-9 [MEDIUM] `usesCleartextTraffic` placeholder is undeclared.** `AndroidManifest.xml:25`
  uses `${usesCleartextTraffic}` but no `manifestPlaceholders` block exists anywhere in
  `android/app/build.gradle`. It resolves only because the RN Gradle plugin supplies a default: the last
  release build resolved it to `false` (`merged_manifests/release/...:88`), debug to `true`
  (`merged_manifest/debug/...:91`). Declare it explicitly in `defaultConfig` so the value is never
  plugin-version-dependent.

### ProGuard / R8

- **Android-10 [HIGH] Minification is OFF for release.** `android/app/build.gradle:67` ->
  `def enableProguardInReleaseBuilds = false`, consumed at line 117
  (`minifyEnabled enableProguardInReleaseBuilds`).
- **Android-11 [CRITICAL, latent] `android/app/proguard-rules.pro` is completely empty** (10 lines, all
  comments, ending at line 10 with *"Add any project specific keep options here"*). There are **zero**
  `-keep` rules for `@cometchat/*`, Notifee, `react-native-webrtc`, RN Firebase, `react-native-video`,
  `react-native-vision-camera`, or new-architecture TurboModule/codegen classes. Today this is masked
  because `minifyEnabled false` means R8 never runs. **The moment anyone flips line 67 to `true` - the
  standard hardening step, and an obvious "let's secure this" change - every reflection-based native
  module breaks at runtime in release only**, producing a crash that cannot be reproduced on debug.
  Fix *before* enabling: `-keep class com.cometchat.** { *; }`, `-keep class io.invertase.** { *; }`,
  `-keep class org.webrtc.** { *; }`, `-keep class com.rajofearth.synomilo.** { *; }`, plus the standard
  new-arch `-keep class * extends com.facebook.react.** { *; }`.

### Notification channels - duplicate / conflicting ringing paths

- **Android-12 [HIGH] Two competing ringing engines.**
  1. **JS / Notifee path** - `src/notifications/callNotifications.ts:20-39` creates channels `default`
     ("Messages") and `incoming_call_v2` ("Incoming calls", `SYSTEM_RINGTONE_URI`, `importance HIGH`,
     `PUBLIC`, custom vibration pattern). `showIncomingCallNotification` (lines 47-84) posts
     `loopSound: true`, `ongoing: true`, `timeoutAfter: 60000`, and a `fullScreenAction` whose
     `launchActivity` is `'default'` i.e. **`MainActivity`** (lines 72-73, 78). Handlers registered in
     `index.js:18-30` (`setBackgroundMessageHandler`, `onBackgroundEvent`).
  2. **Native / library path** - `@cometchat/push-notifications-react-native` posts its own full-screen
     ring via `IncomingCallService` + `CallRingingActivity` (`showWhenLocked`, `turnScreenOn`) and routes
     taps through `CometChatPushTrampolineActivity`.

  A call can ring via the notifee notification *and* via the library activity, or (given Android-7) be
  handled by neither consistently. There is no single owner of the ringing UX.
  **Recommendation: pick one engine.** If the library's native ring is authoritative, delete the notifee
  call-notification path (`showIncomingCallNotification`, `CALL_CHANNEL_ID`, and the `accept-call` /
  `decline-call` actions in `src/notifications/background.ts`) so there is exactly one full-screen intent
  per call.
- **Android-13 [MEDIUM] Channel `incoming_call_v2` is created only in JS.** Once created, Android
  **ignores all further `createChannel` mutations** (importance / sound / vibration are immutable).
  `ensureNotificationChannels()` guards with an in-memory `channelsReady` flag (lines 13-18) that resets
  on every cold start, so a channel whose settings were ever wrong is permanently stuck until the user
  clears app data. Future channel tuning will silently not apply - a classic "I changed it and it still
  rings wrong" trap.
- **Android-14 [INFO] Inconsistent small-icon keys across three code paths**:
  `AndroidManifest.xml:46-48` uses `ic_stat_message`, `src/notifications/callNotifications.ts:71` uses
  `ic_stat_call`, `src/utils/CometChatPushV2.ts:126` uses `ic_notification`. Verify the one actually
  used resolves to a valid drawable, or the notification renders with a missing/blank icon.
- **Android-15 [OK]** The `default` channel referenced by
  `com.google.firebase.messaging.default_notification_channel_id` (`AndroidManifest.xml:41-44`) is created
  by `ensureNotificationChannels()` (`callNotifications.ts:20-25`) - consistent, no conflict. Both
  `ic_stat_call.png` and `ic_stat_message.png` exist in all five density buckets
  (`drawable-hdpi` .. `drawable-xxxhdpi`).

### Native modules

- **Android-16 [OK]** All six Kotlin files exist and are consistent:
  `MainActivity.kt`, `MainApplication.kt`, `DynamicColorModule.kt`, `DynamicColorPackage.kt`,
  `InstallerModule.kt`, `InstallerPackage.kt`. `MainApplication.kt:21-22` registers
  `DynamicColorPackage()` and `InstallerPackage()` manually (not autolinkable).
  `getName()` returns `"Installer"` (`InstallerModule.kt:25`) and `"DynamicColor"`
  (`DynamicColorModule.kt:15`) - matching the JS lookups.
- **Android-17 [OK] `NativeModules.Installer` on iOS / when missing**: the read paths are all
  optional-chained and degrade safely.
  - `App.tsx:408-411` - `const installer = NativeModules.Installer; if (!installer?.isIgnoringBatteryOptimizations) { return; }`
  - `App.tsx:431` - `NativeModules.Installer?.openBatterySettings?.()`
  - `src/components/convex/SettingsScreen.tsx:15` - `NativeModules.Installer?.isIgnoringBatteryOptimizations?.()`
  - `src/components/convex/SettingsScreen.tsx:31` - `NativeModules.Installer?.openBatterySettings?.()`

  On iOS the module is `undefined`, every call is a no-op, `batteryAllowed` stays `null`, and the
  battery-optimisation card in `SettingsScreen` renders in a permanent neutral state. **No crash** - but
  this is untested behaviour, not intended behaviour: the screen does not guard on `Platform.OS`, so an
  iOS user sees a dead battery row with no explanation. Gate it the way `src/theme/dynamicTheme.ts:75`
  gates `DynamicColor`.
- **Android-18 [MEDIUM] `src/updater/UpdateChecker.tsx` is NOT optional-chained.** Lines 112, 115, 128,
  134 use bare `NativeModules.Installer.canInstall()` / `.openInstallSettings()` / `.download()` /
  `.install()`. On iOS (or if the module fails to register) `NativeModules.Installer` is `undefined` and
  line 112 throws `TypeError: Cannot read properties of undefined`. It is only survivable if the caller
  wraps it in try/catch - verify `UpdateChecker.tsx:105-140`.
- **Android-19 [HIGH] `InstallerModule.download()` has no integrity or signature check**
  (`InstallerModule.kt:97-149`). It fetches an arbitrary URL with `instanceFollowRedirects = true`
  (line 107) into `filesDir/updates/`; `install()` (lines 152-169) then launches it via `ACTION_VIEW`
  with no hash or signature verification. Combined with C3 (debug-key release fallback), an attacker who
  can MITM the update URL or reach the `updates` endpoint can push arbitrary APKs the app will offer to
  install. Add SHA-256 pinning of the downloaded APK against a value signed by your release key, and
  enforce HTTPS with a pinned host.
- **Android-20 [LOW] Over-broad FileProvider + unvalidated URL.** `file_paths.xml:5`
  (`<external-path name="external_files" path="." />`) exposes the **entire** external-storage root to the
  FileProvider, far wider than the `updates/` directory the app needs. `InstallerModule.kt:106` builds a
  URL from an unvalidated JS-supplied string with no scheme allowlist.
- **Android-21 [INFO]** `MainActivity.kt:13` correctly calls `super.onCreate(null)` (required by
  `react-native-screens`), `android/gradle.properties:35` `newArchEnabled=true`,
  `:39` `hermesEnabled=true`, `:28` all four ABIs built by default but CI overrides to two.

---

## iOS findings

- **iOS-1 [CRITICAL] `aps-environment` is hardcoded to `development` in the only entitlements file the
  target uses.** `SampleAppWithPushNotifications.entitlements:5-6` and
  `SampleAppWithPushNotificationsRelease.entitlements:5-6` both contain
  `<key>aps-environment</key><string>development</string>`, and `project.pbxproj:282` and `:313` both set
  `CODE_SIGN_ENTITLEMENTS = SampleAppWithPushNotifications/SampleAppWithPushNotifications.entitlements`.
  **This is the most likely cause of "calls don't ring on iOS when the app is killed but do on dev
  builds".** A build signed against the *development* APNs endpoint cannot receive *production* APNs
  tokens, and `convex/push.ts:58-60` sends via the production `firebase-admin` default APNs host. The
  library is careful here: `CometChatPushKit.start()` creates the `PKPushRegistry` with
  `desiredPushTypes = [.voIP]` (`CometChatPushNotificationsBridge.swift:686-688`), and the token it gets
  back is exactly what CometChat dials. A production backend dialling a development-environment VoIP token
  gets silence.
  **Fix:** replace the hardcoded value with `$(APS_ENVIRONMENT)` and define `APS_ENVIRONMENT = development`
  for Debug / `production` for Release-App Store in `project.pbxproj`. Verify the packaged binary with
  `codesign -d --entitlements - Payload/App.app`.
- **iOS-2 [HIGH] `SampleAppWithPushNotificationsRelease.entitlements` is a dead file.** Nothing in
  `project.pbxproj` references it (grep for `CODE_SIGN_ENTITLEMENTS` returns only `:282` and `:313`, both
  pointing at the non-Release file). It is a decoy giving the false impression Release signing is
  configured. Wire it into the Release configuration or delete it.
- **iOS-3 [HIGH] PushKit entitlement is absent.** Neither entitlements file declares
  `com.apple.developer.pushkit.unrestricted-voip` - verified: **zero** `pushkit` matches across every
  `.plist` and `.entitlements` under `ios/`, and zero PushKit/`SystemCapabilities` capability entries in
  `project.pbxproj`. `UIBackgroundModes` does include `voip` (`Info.plist:53-58`), which is necessary but
  not sufficient. The package uses `PKPushRegistry` with `.voIP` for real background/terminated calls;
  enable the **Push Notifications** capability in Xcode and ensure the App ID carries the PushKit
  entitlement. Without it, VoIP push registration can fail or be rejected, and iOS terminates the app
  for an "unhandled VoIP push" in the killed state.
- **iOS-4 [OK] `UIBackgroundModes` is correct** (`Info.plist:53-58`): `audio`, `voip` and
  `remote-notification` are all present - the correct trio for WebRTC + PushKit + APNs.
- **iOS-5 [LOW] `fetch` background mode is absent** (`Info.plist:53-58`). Not required for PushKit-based
  calls, since PushKit wakes the app on its own - informational, not a defect.
- **iOS-6 [OK] The PushKit/CallKit registration race is correctly handled - the one unambiguous pass.**
  `AppDelegate.swift:28-31` calls `CometChatPushNotificationsAppDelegate.registerForVoIPPushes()`
  **before** `factory.startReactNative(...)` (line 39), with a comment explaining why: a call that wakes a
  killed app must reach CallKit within ~5s. The package backs this up:
  `CometChatCallKit` is a `CXProviderDelegate` singleton owned independently of the RN bridge
  (`CometChatPushNotificationsBridge.swift:284-285`); events are buffered before RN is up and drained via
  `CometChatCallKit.shared.drain()` (line 109); the `PKPushRegistry` is created on a dedicated
  *background* queue (`CometChatPushKit.start()`, lines 676-688) rather than main; and it refuses to
  start if another component already owns a `PKPushRegistry` (lines 734-738), preventing double delivery.
  `AppDelegate.swift:50-56` and `:65-72` correctly forward the APNs token and remote notification, and
  `:33-35` documents why the app does not set its own `UNUserNotificationCenter` delegate.
- **iOS-7 [INFO] CallKit is SDK-internal only.** No `import CallKit` or `CXProvider` appears anywhere in
  this repo; all of it lives in `@cometchat/push-notifications-react-native` (`CometChatCallKit` with
  `perform: CXAnswerCallAction` / `CXEndCallAction`, lines 563-590). There is no app-side
  `CXCallController` to race - but equally, nothing app-side to fix if the package's ring regresses.
- **iOS-8 [OK] ATS is correctly configured** (`Info.plist:38-44`): `NSAllowsArbitraryLoads = false`,
  `NSAllowsLocalNetworking = true`. The CometChat sample default of `true` would have been an App Store
  rejection; this is the right posture. No permissive ATS exceptions found anywhere.
- **iOS-9 [MEDIUM] `NSLocationWhenInUseUsageDescription` is an empty string** (`Info.plist:47-48`). Apple
  rejects builds with an empty purpose string. Nothing in `src/` requests location - this is CometChat
  template residue. Write a real string or delete the key.
- **iOS-10 [MEDIUM] Missing usage-description strings.** `react-native-vision-camera`
  (`package.json:51`), `react-native-image-picker` (`:43`) and
  `@react-native-community/datetimepicker` (`:21`) ship, but `Info.plist` has no
  `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription` and no
  `NSBluetoothAlwaysUsageDescription`. Access will hard-crash with `NSInvalidArgumentException` at
  runtime. Add the strings and gate the features on the permission check.
- **iOS-11 [HIGH] Bundle identifier is CometChat's, not synomilo's.** `project.pbxproj:298` and `:328` set
  `PRODUCT_BUNDLE_IDENTIFIER = com.cometchat.internal.reactnative.ios` with
  `DEVELOPMENT_TEAM = T9F7QDSC2S` (`:284`, `:315`). See C6 - must change before any distribution build,
  together with the Firebase URL scheme in `Info.plist:28-32`.
- **iOS-12 [INFO] Cosmetic branding drift.** `Info.plist:7-8` `CFBundleDisplayName` is still
  `"sampleapp"`, while Android uses `"synomiló"` (`android/app/src/main/res/values/strings.xml:2`) and
  `app.json` `displayName` matches neither. The home-screen name is wrong on iOS.
- **iOS-13 [OK]** `ios/.xcode.env` (11 lines) is the stock template:
  `export NODE_BINARY=$(command -v node)`. No secrets, no hardcoded absolute paths.
  `ios/.xcode.env.local` is correctly gitignored (`.gitignore:23`).
- **iOS-14 [INFO]** `Podfile` (57 lines): `platform :ios, min_ios_version_supported` (line 9),
  `use_frameworks! :linkage => :static` (line 11), and a `post_install` hook (28-56) that patches
  `fmt/base.h` to disable `FMT_USE_CONSTEVAL` for Xcode 26+ (45-55). That patch mutates files inside
  `installer.sandbox.pod_dir('fmt')` and runs on every `pod install`; it throws rather than skips on a
  machine without write access to the sandbox. No secrets. `IPHONEOS_DEPLOYMENT_TARGET = 15.1`
  (`project.pbxproj:287`, `:317`); `Info.plist:61-64` requires `arm64`.

---

## Call-ringing config blockers

Ranked by expected impact on "sometimes it doesn't ring". Each item names the exact manifest/plist
entries that must change.

### Android

- [ ] **A1 - Collapse the three `MESSAGING_EVENT` services to one.**
      `android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`
      declares `ReactNativeFirebaseMessagingService` (:139-145), `CometChatFcmService` (:233-239) and
      `com.google.firebase.messaging.FirebaseMessagingService` (:494-501), all bound to
      `com.google.firebase.MESSAGING_EVENT`. Android guarantees only one. Remove the
      `com.google.firebase.messaging` intent-filter from one app-level claimant with a manifest-merger
      `tools:node="remove"` in `android/app/src/main/AndroidManifest.xml`, and add
      `tools:replace="android:priority"` if the base-class priority is required.
- [ ] **A2 - Choose one ringing engine.** Both the Notifee JS path
      (`src/notifications/callNotifications.ts:47-84`, `fullScreenAction.launchActivity: 'default'` ->
      `MainActivity`) and the library's native path (`IncomingCallService` + `CallRingingActivity`,
      `showWhenLocked` / `turnScreenOn`) can ring for the same call. Delete one path so there is exactly
      one full-screen intent per call.
- [ ] **A3 - Declare `manifestPlaceholders` for `usesCleartextTraffic`.** `AndroidManifest.xml:25`
      references an undefined placeholder; assert `false` for release in
      `android/app/build.gradle` `defaultConfig`.
- [ ] **A4 - Drop `REQUEST_INSTALL_PACKAGES`** (`AndroidManifest.xml:15`) unless a Play Declaration Form
      is filed, and narrow `file_paths.xml:5` `<external-path path="." />` to `updates/`.
- [ ] **A5 - Write `proguard-rules.pro` before enabling R8.** `android/app/build.gradle:67` is `false` and
      `android/app/proguard-rules.pro` is empty; flipping that flag as-is is a guaranteed release-only
      crash.
- [ ] **A6 - Pin and verify the updater download.** `InstallerModule.kt:97-169` fetches and installs APKs
      with no integrity check; add SHA-256 verification against a release-key-signed manifest.

### iOS

- [ ] **B1 - Fix `aps-environment`.** Change `development` to `$(APS_ENVIRONMENT)` in
      `SampleAppWithPushNotifications.entitlements:6` and
      `SampleAppWithPushNotificationsRelease.entitlements:6`; define `APS_ENVIRONMENT = production` for
      Release/App Store in `project.pbxproj` (near `:282` and `:313`). Verify with
      `codesign -d --entitlements - Payload/App.app`. **Until this lands, production APNs (including
      VoIP) pushes cannot reach a released iOS build.**
- [ ] **B2 - Wire up the Release entitlements file.** `SampleAppWithPushNotificationsRelease.entitlements`
      is unreferenced by `project.pbxproj`; point the Release configuration's `CODE_SIGN_ENTITLEMENTS`
      at it (currently only `:282`/`:313` exist, both pointing at the Debug-side file).
- [ ] **B3 - Enable the Push Notifications capability** in Xcode and confirm the App ID carries the
      PushKit entitlement, so `PKPushRegistry(desiredPushTypes: [.voIP])`
      (`CometChatPushNotificationsBridge.swift:686-688`) is authorised. Neither `.entitlements` file
      declares `com.apple.developer.pushkit.unrestricted-voip`.
- [ ] **B4 - Change `PRODUCT_BUNDLE_IDENTIFIER`** from `com.cometchat.internal.reactnative.ios`
      (`project.pbxproj:298`, `:328`) to a synomilo-owned ID, and update the Firebase
      `CFBundleURLSchemes` entry (`Info.plist:28-32`) to match. A reused demo bundle ID invalidates push
      routing assumptions and will not pass review.

### Cross-platform

- [ ] **C1 - Make missing release signing a build failure.** Replace the debug-signing fallback at
      `android/app/build.gradle:116` with a thrown `GradleException`, and add a CI assertion that
      `.github/workflows/android-release.yml:52-58` received non-empty `KEYSTORE_BASE64` /
      `KEYSTORE_PROPERTIES` before running `assembleRelease`.
- [ ] **C2 - Verify `POST_NOTIFICATIONS` is actually granted at runtime.** It is correctly declared
      (`AndroidManifest.xml:11`) and requested (`src/notifications/push.ts:11-13`), but a denial is
      silent - `requestPushPermission()` returns `false` and nothing blocks call setup. Surface the denial
      in `SettingsScreen` so it is visible rather than presenting as "the phone is broken".
- [ ] **C3 - Guard the battery-optimisation UI on `Platform.OS`.**
      `src/components/convex/SettingsScreen.tsx:14-32` shows a battery row that is permanently inert on
      iOS because `NativeModules.Installer` is undefined there. Gate it, and guard the unchained
      `UpdateChecker.tsx:112` calls the same way.
- [ ] **C4 - Add a ringing regression test on real hardware** across three states (foreground,
      backgrounded, force-stopped) x two platforms, asserting the full-screen intent / CallKit report
      appears. Android-1 (library-supplied `phoneCall` FGS) and iOS-6 (PushKit before RN) are currently
      correct by construction and would regress silently if the package or the manifest merger changes.
