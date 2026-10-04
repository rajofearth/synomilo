# synomiló

A private chat app for two people and their wedding group. Convex is the backend; the UI is React Native with Material 3.

## What it does

- Direct messages and wedding groups, text and attachments
- Voice and video calls over WebRTC, signaled through Convex
- Push notifications: message notifications per chat, full-screen incoming call ringing
- Read receipts, typing indicators, replies, forwarding, soft-delete tombstones
- Group management for owners: rename, picture, add and remove members
- Light and dark themes that follow the system, with wallpaper accent colors on Android 12+
- Self-hosted updates: the app checks Convex for a new build, downloads it, and starts the installer

## Stack

- React Native 0.81, new architecture, Hermes
- Convex: auth, data, files, call signaling, update distribution
- react-native-paper 5 with Material Design 3, MDI icons
- notifee for call notifications, react-native-webrtc for media
- firebase-admin (v14 modular API) for FCM push from Convex actions

## Layout

- `convex/`: backend functions (auth, users, conversations, messages, reactions, files, calls, push, updates)
- `src/components/convex/`: the chat screens (list, chat, info, profile, settings, forwarding)
- `src/components/calls/`: call screen and incoming call overlay
- `src/notifications/`: push handling, call notifications, headless call actions
- `src/updater/`: in-app update checker and installer UI
- `android/`: native project, including the DynamicColor and Installer modules
- `scripts/publish-release.mjs`: uploads an APK to Convex and marks it as the latest release

## Development

```
npm install
npx convex dev
npm start
npm run android
```

Push credentials and signing live outside version control: `android/keystore.properties`, `android/app/synomilo-release.keystore`, and `android/app/google-services.json`. The Convex deployment reads `FCM_SERVICE_ACCOUNT` for push, and `GITHUB_TOKEN` plus `GITHUB_REPO` are no longer needed by the updater.

## Building and releasing

1. Bump `versionCode` and `versionName` in `android/app/build.gradle`.
2. Build the signed dual-ABI APK: `run-build-release-both.bat` (or `cd android && gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a`).
3. Publish it to Convex so installed apps can update:

```
node scripts/publish-release.mjs 1.0.5 android/app/build/outputs/apk/release/app-release.apk "Release notes"
```

4. Optionally attach the same APK to a GitHub release with `gh release create`.

Installed apps poll every minute, show a dialog when a newer version appears, download the APK, and hand it to the Android installer. If install permission is missing, the app opens the system settings for it.

## Notes

- The app forces no theme; it follows the system scheme and derives accent colors from the Android wallpaper palette when available.
- Call notifications use the device's default ringtone and a full-screen intent so the phone rings like a normal call.
