# Audit 15 — Removing every `@cometchat/*` package

**Repo:** `P:\Projects\cometchat-sample-app` ("synomiló")
**Stack:** RN 0.81.4 bare CLI · New Architecture (`newArchEnabled=true`) · Hermes · TS 5.8 · React 19.1
**Snapshot:** `HEAD=ca7587ccecfce936bfc3c46643f2c515f17ed8c7` · working-tree `git status --short` sha256 prefix `D37DC4507E32` (92 entries) · 2026-10-14 16:01 local

> ⚠️ **The working tree was being edited by another agent while this audit ran.** `src/components/convex/UsersList.tsx` was deleted and `src/components/convex/AddContactScreen.tsx` was added mid-analysis, and the Chats/Calls/Profile tab set changed. Every `file:line` below is against the snapshot above. Re-run the greps in *Part 1 §0* before acting; the file *set* may have moved, the *findings* will not.

**Method.** Reverse-dependency graph built from a BFS over every `import` / `require()` / `import()` specifier in every `.ts/.tsx/.js/.jsx`, rooted at `index.js`. Route reachability established separately from `navigate()` call sites. Bundle sizes are **measured**, not estimated: read from the real release source map (`android/app/build/generated/sourcemaps/react/release/index.android.bundle.map`, 2,767 modules) and the real release APK (`android/app/build/outputs/apk/release/app-release.apk`).

---

## TL;DR

Removing all four packages — plus seven transitive peers that exist only to serve them — is **safe and worthwhile**. Roughly **45 % of the app's JS source** is CometChat, and the app's actual chat and calling stack is Convex + `react-native-webrtc` + notifee. Nothing the user can reach depends on CometChat except two things, both of which are already broken or dead.

- The **CometChat Calls SDK is dead weight.** `CometChatCalls.init()` has **zero call sites**. Nothing in this repo ever creates a CometChat call (`CometChat.initiateCall` appears once, in `UserInfo.tsx`, a nav-unreachable screen). Media is `react-native-webrtc` in `WebRTCCallScreen.tsx`.
- The **CometChat push package is dead weight.** `fcmProviderId` and `apnsProviderId` are both `''` (`AppConstants.tsx:4-5`), so `registerPushToken` can never succeed, so the CometChat app never addresses this device. Real push is `@react-native-firebase/messaging` + notifee + Convex.
- The UIKit is providing exactly four things to live code: **a theme object** (11 files), **three translation keys** (1 file), **a login/logout round-trip that nothing consumes**, and **an incoming-call screen that can never fire**.
- **Keep `react-native-paper`.** It is already installed, already MD3, already the monochrome source of truth. Swapping it for gluestack/tamagui/unistyles/nativewind would be a downgrade disguised as an upgrade.

---

# PART 1 — Measured surface area

## §0 Re-run these before you start

```bash
# every file still importing @cometchat
rg -l "@cometchat/" --glob '!node_modules' --glob '!package-lock.json' --glob '!docs' .

# which of those are actually reachable from index.js
#   (this audit used a BFS over import specifiers; re-run it)

# which routes are actually navigated to
rg -o -n 'navigate\(\s*.([A-Za-z]+)' src App.tsx
```

## §1 Where the bytes are

Measured from the real release source map (`sourcesContent` byte counts) and the real release APK.

| Package | JS source in release bundle | Module count | Share of 12,889 KB |
|---|---:|---:|---:|
| `@cometchat/chat-uikit-react-native` | **3,332.8 KB** | 210 | 25.9 % |
| `@cometchat/calls-sdk-react-native` | **1,236.0 KB** | 1 (`dist/index.js`) | 9.6 % |
| `@cometchat/chat-sdk-react-native` | **529.2 KB** | 1 (`CometChat.js`) | 4.1 % |
| `@cometchat/cards-react-native` *(transitive of UIKit)* | 137.2 KB | 6 | 1.1 % |
| `@cometchat/push-notifications-react-native` | 32.7 KB | 8 | 0.3 % |
| **CometChat subtotal** | **5,267.9 KB** | 226 | **40.9 %** |
| `react-native-callstats` *(Calls SDK peer, 598.8 KB)* | 598.8 KB | 3 | 4.6 % |
| `react-native-svg` *(UIKit peer only — no live importer)* | 248.6 KB | 31 | 1.9 % |
| `@react-native-community/{netinfo,datetimepicker}` *(Calls/UIKit peers only)* | 23.8 KB | 9 | 0.2 % |
| `react-native-url-polyfill` *(only `index.js:1`, for CometChat's crypto)* | 20.7 KB | 6 | 0.2 % |
| `react-native-localize` *(UIKit i18n only)* | 2.8 KB | 2 | <0.1 % |
| `react-native-background-timer` *(Calls SDK peer only)* | 2.5 KB | 2 | <0.1 % |
| **Total removable JS** | **≈ 6,165 KB** | 279 | **47.8 %** |

**Native: CometChat contributes zero `.so` bytes.** Verified against the real merged native libs and the release APK:

- `@cometchat/chat-sdk-react-native` ships **no `android/` directory at all** — it is pure JS (`CometChat.js`) talking to the CometChat REST/WebSocket API. No AAR, no JNI.
- The UIKit's gradle pulls only `androidx.appcompat`, `com.google.android.material:material:1.5.0`, `kotlin-stdlib` — dex, not `.so`.
- `lib/arm64-v8a/` in the release APK contains 20 entries and **not one of them is CometChat or CallStats**.

The one genuine native saving is **`libreact_codegen_rnsvg.so`** (729,064 B arm64 / 516,484 B armv7 / 955,032 B x86 / 816,400 B x86_64 = **3,016,980 B**), which goes away with `react-native-svg`.

## §2 Bundle → APK arithmetic

`assets/index.android.bundle` is **STORED, not DEFLATE-compressed** in the release APK (verified: `Length == CompressedLength == 7,397,360`). **Every byte off the bundle is a byte off the APK download, 1:1.**

Audit 10 measured the source→minified→Hermes chain for the UIKit + Calls SDK as `4,678,451 B source → 2,371,150 B minified → 3,314,868 B Hermes` (ratio **0.7086** source→Hermes). Applying it to the 6,165 KB above:

| | Bytes | |
|---|---:|---|
| JS bundle removed | **≈ 4,368,000** | 4.2 MB, stored uncompressed → 1:1 APK |
| `libreact_codegen_rnsvg.so` removed | **3,016,980** | 3.0 MB in a 4-ABI APK; **729,064** in an arm64-only AAB |
| Dex (`appcompat` / `material` / Kotlin classes) | unmeasured | small, single-digit thousands of source files' worth |

| Baseline | Value |
|---|---:|
| Release APK today | 121.04 MB (4 ABIs, incl. x86 + x86_64) |
| `index.android.bundle` | 7,397,360 B (6.2 % of the APK) |
| **Realistic saving** | **≈ 5.1 MB (4-ABI APK) · ≈ 3.0 MB (arm64-only AAB)** |
| **JS-only saving as % of bundle** | **≈ 59 %** |

Against audit 10's 70.4 MB baseline (an APK without the x86 ABIs) the JS half alone is 4,368,000 / 70,416,066 = **6.2 %**.

## §3 Capability → import site table

**Live** = reachable from `index.js` *and* reachable by a real `navigate()`.
**Nav-dead** = imported by `RootStackNavigator.tsx` as a `<Stack.Screen component={…}>` registration only, with no `navigate()` caller anywhere.
**Dev-dead** = behind `__DEV__ && React.lazy(...)`.

### Capability A — Theme (`useTheme`, `CometChatThemeProvider`, `CometChatTheme`)

| Import site | Status | Tokens read |
|---|---|---|
| `App.tsx:11-19` `CometChatThemeProvider`, `CometChatTheme` | live | builds palette (`:73-86`), wraps tree (`:737`) |
| `App.tsx:35` `DeepPartial` from `…/src/shared/helper/types` | live | type only |
| `src/components/convex/ChatScreen.tsx:29` | **live** | `textPrimary`, `textSecondary`, `textTertiary`, `background1/2/3`, `borderDefault`, `borderLight`, `primary`, `error`, `extendedPrimary50` |
| `src/components/convex/ChatInfoScreen.tsx:4` | **live** | `body.medium`, `caption1.medium`, `heading3.bold` |
| `src/components/convex/ContactInfoScreen.tsx:4` | **live** | `body.medium/regular`, `caption1.medium`, `heading3.bold` |
| `src/components/convex/ForwardMessageScreen.tsx:3` | **live** | same set as ChatScreen |
| `src/components/convex/GroupsList.tsx:15` | **live** | `primary`, `textPrimary/Secondary/Tertiary`, `background1/2/3`, `borderDefault/Light`, `extendedPrimary50`, `error`, `heading1.bold`, `heading3.bold` |
| `src/components/calls/IncomingCallOverlay.tsx:15` | **live** | 8 `theme.color.*` reads |
| `src/components/calls/WebRTCCallScreen.tsx:15` | **live** | 16 `theme.color.*` reads |
| `src/components/login/Login.tsx:15` | **live** | `background2`, `borderLight`, `primary`, `staticWhite`, `error`, `primaryButtonBackground`, `textPrimary/Secondary`, `heading1.bold`, `heading3.bold`, `body.medium/regular`, `button.medium`, `caption1.medium` |
| `src/components/login/SignUp.tsx:15` | **live** | same as Login |
| `src/navigation/RootStackNavigator.tsx:18` | **live** | `background1`, `background2`, `error`, `staticWhite`, `caption1.medium` |
| `src/components/conversations/screens/{AddMember,BannedMember,BannedMemberStyles,Conversations,CreateConversation,GroupInfo,OngoingCallScreen,PinnedMessages,SavedMessages,SearchMessages,ThreadView,TransferOwnership,UserInfo,ViewMembers,qr_screen}.tsx` | **nav-dead** | — |
| `src/components/calls/{CallDetailHelper,CallDetails,CallHistory,CallLogDetailHeader,CallParticipants,CallRecordings}.tsx` | **nav-dead** | — |
| `src/components/{AIAgent/AIAgents,users/Users,groups/GroupHelper,groups/Groups}.tsx` | **nav-dead / unreachable** | — |
| `src/components/login/{AppCredentials,SampleUser}.tsx` | **dev-dead** | — |
| `src/utils/TooltipMenu.tsx` | **nav-dead** (only importer is nav-dead `Conversations.tsx:19`) | — |

### Capability B — Icons (`Icon`, `ICONS`, `CometChatAvatar`, `CometChatCallButtons`)

| Import site | Status |
|---|---|
| `src/components/calls/CallDetails.tsx:20,25` `Icon`, `ICONS` from `…/src/shared/icons/icon-mapping` | nav-dead |
| `src/components/calls/{CallHistory,CallLogDetailHeader,CallRecordings}.tsx` `Icon` | nav-dead |
| `src/components/conversations/screens/{AddMember,BannedMember,Conversations,CreateConversation,GroupInfo,ThreadView,TransferOwnership,UserInfo}.tsx` `Icon` | nav-dead |
| `src/components/login/SampleUser.tsx:22` `Icon`, `CometChatAvatar` | dev-dead |
| `src/components/{groups/GroupHelper,users/Users,conversations/screens/UserInfo,GroupInfo,Conversations}.tsx` `CometChatAvatar` | nav-dead / unreachable |
| `src/components/calls/CallLogDetailHeader.tsx:7` `CometChatCallButtons` | nav-dead |

**Live icon usage: ZERO.** Every live screen already uses `@react-native-vector-icons/material-design-icons` (`IncomingCallOverlay`, `WebRTCCallScreen`, `OngoingCallBar`, `ConversationsList`, `SettingsScreen`, `Calls`, `GroupsList`, `ChatInfoScreen`, `ProfileScreen`).

### Capability C — i18n (`CometChatI18nProvider`, `useCometChatTranslation`, `getCometChatTranslation`)

| Import site | Status | Detail |
|---|---|---|
| `App.tsx:11,738,775` `CometChatI18nProvider` | **live** | wraps the whole tree |
| `src/navigation/BottomTabNavigator.tsx:14,96,136` `useCometChatTranslation` | **live** | `t(route.name.toUpperCase())` → exactly **3 keys: `CHATS`, `CALLS`, `PROFILE`** |
| `src/components/calls/CallDetailHelper.tsx:4` `getCometChatTranslation` | nav-dead | |
| 12 other nav-dead/dev-dead screens | nav-dead | ~60 further `t('…')` keys, all unreachable |

**Live i18n surface: 1 file, 3 keys, English-only.**

### Capability D — Chat SDK session (`CometChatUIKit.init/login/logout/createUser`, `CometChat.*`)

| Import site | Status | What it does |
|---|---|---|
| `App.tsx:28,193-199` `CometChatUIKit.init` | **live** | reads `AppConstants.appId/authKey/region` (hardcoded `AppConstants.tsx:6-8`) |
| `App.tsx:28,572-646` `CometChat.addCallListener`, `CometChatUIEventHandler`, `CometChat.getLoggedinUser`, `CometChat.getActiveCall`, `CometChat.rejectCall`, `CometChatUIEventHandler.emitUIEvent` | **live but unreachable** | listens for CometChat call events; none are ever produced |
| `App.tsx:11,15,602,634,692` `CometChatUIEventHandler`, `CometChatUIEvents` | **live but unreachable** | card-action listener for CometChat messages; the Convex chat screen renders its own cards inline |
| `src/auth/cometchatSession.ts:1-2` `CometChatUIKit.login/createUser/logout`, `CometChat.User`, `CometChat.logout` | **live** | keeps a second session alive for "voice and video" |
| `src/auth/SessionProvider.tsx:12,14,281,285` `CometChatPushNotifications.unregister`, `clearCometChatSession` | **live** | logout path |
| `src/components/login/Login.tsx:23,136` / `SignUp.tsx:23,143` `ensureCometChatSession` | **live** | blocks login on the result; surfaces a banner |
| `src/navigation/RootStackNavigator.tsx:23-26,94-125` `getCometChatSessionError`, `subscribeCometChatSessionError` | **live** | `CallsUnavailableBanner` |
| `src/navigation/types.ts:2` `CometChat` | **live** | type only |
| `src/utils/helper.ts:1` `CometChat`, `:12` `CometChatUIEventHandler/CometChatUIEvents/CometChatUIKit/MessageEvents` | **reachable but unreachable** | sole importer is `CometChatPushV2.ts:22` |
| `src/utils/CometChatPushV2.ts:13,92,98` | **live but unreachable** | `CometChat.endCall`, `CometChat.clearActiveCall` |
| 20 nav-dead / dev-dead screens | dead | |

### Capability E — Call UI (`CometChatIncomingCall`, `CometChatOngoingCall`, `CometChatCalls`, `CometChatCallButtons`, `CometChatCallLogs`)

| Import site | Status |
|---|---|
| `App.tsx:12,740-746` `<CometChatIncomingCall>` | **live but unreachable** — rendered only when `callReceived && incomingCall.current`, set exclusively by the `CometChat.addCallListener` in the same file |
| `src/components/conversations/screens/OngoingCallScreen.tsx:2,4,5,50,53,72,89` `CometChatOngoingCall`, `CometChatCalls.OngoingCallListener`, `CometChatCalls.CallSettingsBuilder` | **nav-dead** — only `navigate('OngoingCallScreen')` is `CometChatPushV2.ts:80` |
| `src/components/calls/CallLogDetailHeader.tsx:7` `CometChatCallButtons` | nav-dead |
| `src/components/calls/{CallDetails,CallHistory,CallRecordings}.tsx` `CometChat.CallLogRequestBuilder` | nav-dead |

**The app's own call UI is 100 % independent:** `IncomingCallOverlay.tsx` + `WebRTCCallScreen.tsx` + `OngoingCallBar.tsx` + `callStore.ts`, driven by `src/notifications/*` (notifee), `IncomingCallActivity.kt`, and `react-native-webrtc`.

### Capability F — UI events (`CometChatUIEventHandler`, `CometChatUIEvents`)

Covered in D. Sites: `App.tsx:15-16,602,613,634,644,692,719`; `src/utils/helper.ts:12`; `src/hooks/useGroupMemberStatus.ts:4` (nav-dead); `src/components/conversations/screens/{AddMember,BannedMember,GroupInfo,ThreadView,TransferOwnership,UserInfo}.tsx` (nav-dead); `src/components/groups/Groups.tsx:11` (nav-dead).

### Capability G — Push (`@cometchat/push-notifications-react-native`)

| Import site | Status |
|---|---|
| `index.js:7,34` `registerBackgroundCallTask()` | **live** |
| `App.tsx:32,558-563` `setupPushOnLogin()` | **live** |
| `src/utils/CometChatPushV2.ts:15-18` `CometChatPushNotifications.{onMessageReceived,onNotificationTap,onCallAccepted,onCallEnded,init}`, `CometChatPNHelper.{requestNotificationPermission,requestCallPermissions}` | **live but unreachable** |
| `src/auth/SessionProvider.tsx:12,281` `CometChatPushNotifications.unregister()` | **live** |
| `src/components/conversations/screens/Conversations.tsx:1,123` | nav-dead |
| `ios/SampleAppWithPushNotifications/AppDelegate.swift:31,55,70` `CometChatPushNotificationsAppDelegate` | **live native** — 3 call sites |
| `jest.setup.js:115` `jest.mock('@cometchat/push-notifications-react-native', …)` | test |

---

## §4 Are the Calls SDK and the push package load-bearing?

### `@cometchat/calls-sdk-react-native` — **NO. Dead weight.**

Evidence, strongest first:

1. **`CometChatCalls.init()` has zero call sites.** `rg -n "CometChatCalls"` over the repo returns exactly 5 hits: the import at `CometChatPushV2.ts:14`, the import at `OngoingCallScreen.tsx:4`, `endSession()` at `CometChatPushV2.ts:95` and `OngoingCallScreen.tsx:53`, and `CallLogRequestBuilder` at `CallHistory.tsx:33` (via `CallingPackage`). The SDK is never initialised, so its media session, its ongoing-call service and its call log cannot function.
2. **No CometChat call is ever created.** `CometChat.initiateCall` appears exactly once, `src/components/conversations/screens/UserInfo.tsx:158`, in a nav-dead screen. `convex/calls.ts start` is the only place a call object is made, and it is a Convex document — CometChat is never told about it.
3. **The Calls tab does not use it.** `src/components/calls/Calls.tsx` imports `useQuery`/`useMutation` from `convex/react` and `react-native-paper` only. Same for `WebRTCCallScreen.tsx` (media = `react-native-webrtc`), `IncomingCallOverlay.tsx`, `OngoingCallBar.tsx`.
4. Its peers are installed solely for it: `react-native-callstats` (598.8 KB of JS, 0 live importers), `react-native-background-timer` (0 live importers), `@react-native-community/netinfo` (0 live importers).

### `@cometchat/push-notifications-react-native` — **NO. Dead weight, with one correction to the prior audit.**

**CORRECTION to `docs/audit/06-chat-messaging.md:126` and `docs/audit/02-call-outgoing-ongoing.md`:15.** Both assert that `CometChatPushNotifications.init({ fcmProviderId: '', apnsProviderId: '' })` "rejects against the empty constants" and that the rejection is swallowed. **That is wrong for the installed version.** Reading `node_modules/@cometchat/push-notifications-react-native/src/CometChatPushNotifications.ts:108-158`: `init()` performs **no validation of `fcmProviderId`/`apnsProviderId` at all**. It calls `Native.configure(...)`, attaches listeners, drains cold-start state, and resolves. The empty provider ids only surface later, inside `registerToken` → `CometChatNotifications.registerPushToken(token, platform, providerId)` (`:161-170`), where the server rejects; that failure is caught and retried `TOKEN_MAX_RETRIES` times, then logged as a single `console.warn` (`:322-335`).

**The conclusion is unchanged; the mechanism is different, and the weaker mechanism matters:**

| | Prior audit said | Actually |
|---|---|---|
| `init()` | rejects | **succeeds** — native FCM/VoIP registration *is* live |
| Token registration | never happens | is attempted, fails server-side on the empty provider id, warns, gives up |
| `onCallAccepted` | can never fire | **still can never fire** — a CometChat VoIP push requires the CometChat app to have a registered token for this user and a call object. Neither exists. |

So the package is not inert (it does hold an OS registration and a `CallListener`), it is just **unreachable at the one point that matters**. The real push path is `src/notifications/push.ts` + `messaging()` + notifee + `api.users.setPushToken` (`App.tsx:234-283`), which is untouched by any of this.

### Verdict on prior audits 01, 02 and 10 — what holds and what does not

| Claim | Verdict |
|---|---|
| `01`: Convex + notifee + `IncomingCallActivity.kt` replaced CometChat's ring | ✅ **holds** — verified: `App.tsx:504-552` consumes `NativeModules.CallIntent`; the Kotlin activity exists at `android/app/src/main/java/com/rajofearth/synomilo/IncomingCallActivity.kt` |
| `02`: `CometChatCalls.init()` has 0 call sites | ✅ **holds** |
| `02`: `OngoingCallScreen` "would fail without `init()`" | ✅ **holds**, and it is nav-dead anyway |
| `06`/`02`: `CometChatPushNotifications.init()` rejects on empty provider ids | ❌ **wrong** — corrected above |
| `09`/`10`: `OngoingCallScreen` is "Live — targeted by `CometChatPushV2.ts:80`" | ⚠️ **code-reachable, runtime-dead**. `CometChatPushV2.ts:80` sits inside `onCallAccepted`, which requires a CometChat VoIP push, which cannot exist. The only other inbound edge (`CometChatPushV2.ts:102`) is a read, not a navigation. **Treat as dead.** |
| `10` Phase 5.3: the live CometChat surface is `init/login/logout/createUser`, `CometChatThemeProvider`, `CometChatI18nProvider`, `useTheme`, `Icon`, `getCometChatTranslation`, `CometChatUIEventHandler`, `CometChatIncomingCall`, `CometChatOngoingCall` | ⚠️ **over-scoped by three.** Live today it is only: `init/login/logout/createUser`, `CometChatThemeProvider`, `CometChatI18nProvider`, `useTheme`, `useCometChatTranslation`, `CometChatUIEventHandler`, `CometChatIncomingCall`. **`Icon` and `getCometChatTranslation` have no live caller** (they are nav-dead), and **`CometChatOngoingCall` is nav-dead**. The concurrent edit already removed `users/Users.tsx` from the graph, which audit 10 had listed as live. |
| `10` Phase 5.3 sizing: "~2,371,150 B minified ≈ 3,314,868 B Hermes (~4.7 %)" | ✅ **method holds and reproduces.** Adding the Chat SDK, `cards-react-native`, the push package, callstats, `react-native-svg` and the small peers gives ≈ **4,368,000 B of Hermes**, ~6.2 % of audit 10's 70.4 MB baseline. |

---

# PART 2 — Replacement research (state as of 2026-10-14)

## 2.1 Theme

### Recommendation: **keep `react-native-paper` MD3. No migration.**

This is not a close call. The app has already done the hard part: `src/theme/dynamicTheme.ts` + `src/theme/paperTheme.ts` build an achromatic MD3 theme from Android `DynamicColor` and iOS system colours, `App.tsx:785-789` mounts `PaperProvider`, and 11 of the ~20 screens already read `useTheme()` from Paper. CometChat is a **second, parallel, redundant theme system** that happens to be seeded from Paper (`App.tsx:73-86 buildCometChatPalette`). Removing it is a deletion, not a migration.

| Option | RN 0.81 + New Arch | Verdict |
|---|---|---|
| **`react-native-paper` MD3 5.15.3** (MIT, published 2026-05-26) — peers `react: *`, `react-native: *`, `react-native-safe-area-context: *`. 702.8 KB already in the bundle. | ✅ Already shipping, already working, zero native code | ✅ **WIN** — already installed, MD3-native, matches the monochrome brief |
| `gluestack-ui` 5.0.3 (MIT, 2026-06-25) | ✅ | ❌ v5 stable requires **NativeWind v5, which is still `5.0.0-preview.4`**, plus Tailwind v4, `react-native-css`, a `postcss.config.js`, a rewritten `metro.config.js`, a `lightningcss@1.30.1` pin, and re-adding every component from a `main-v5` branch. `@gluestack-ui/themed` (the actual runtime) last published **2025-04-08**. Dropped Next.js support. Highest risk, highest cost, zero benefit here. |
| `tamagui` 3.0.9 (MIT, 2026-10-14 — very active) | ✅ peers `react >=19`, `react-native-safe-area-context: *`; 70+ transitive packages | ❌ A full styling compiler + design-token pipeline replacing an already-correct MD3 theme. Insane cost for zero visible gain. |
| `react-native-unistyles` 3.5.3 (MIT, 2026-10-13) | ✅ peers `react-native >=0.81.0` — but also **requires** `react-native-nitro-modules`, `react-native-reanimated`, `react-native-edge-to-edge`, `@react-native/normalize-colors` | ❌ Three new native dependencies to replace a theme that works. It is a styling layer, not a component library — you would still render Paper components inside it. |
| `nativewind` 4.2.7 (MIT, 2026-09-14) | ✅ | ❌ Tailwind utility-class rewrite of every style in the app; conflicts with Paper's MD3 theming. gluestack v5 is already forcing you onto the *preview* of the next version of this. |

### CometChat `CometChatTheme` → Paper MD3 token map

`App.tsx:73-86` already defines the mapping. Expand it once and the whole migration is a `useTheme` swap. Tokens still read by **live** code, with the MD3 target:

| CometChat token | Live files reading it | Paper MD3 target |
|---|---:|---|
| `color.background1` | 7 | `theme.colors.background` |
| `color.background2` | 6 | `theme.colors.surface` (or `colors.elevation.level1`) |
| `color.background3` | 4 | `theme.colors.surfaceVariant` |
| `color.textPrimary` | 8 | `theme.colors.onSurface` |
| `color.textSecondary` | 8 | `theme.colors.onSurfaceVariant` |
| `color.textTertiary` | 5 | `theme.colors.outline` |
| `color.borderDefault` | 3 | `theme.colors.outlineVariant` |
| `color.borderLight` | 5 | `theme.colors.outlineVariant` |
| `color.primary` | 7 | `theme.colors.primary` |
| `color.error` | 3 | `theme.colors.error` |
| `color.extendedPrimary50` | 5 | `theme.colors.primaryContainer` |
| `color.primaryButtonBackground` | 2 | `theme.colors.primary` |
| `color.staticWhite` | 3 | literal `'#FFFFFF'` (Paper has no equivalent) |
| `color.neutral900` | 1 (`TooltipMenu`, itself nav-dead — drop) | — |

Tokens with **no live reader**: `borderHighlight`, `iconPrimary`, `iconSecondary`, `iconHighlight`, `iconTertiary`, `primaryButtonText`, `success`, `textHighlight`, `neutral300`.

Typography — 16 live variants across 4 scales. Paper MD3 fonts are flat, not nested (`fonts.bodyMedium` is one object; CometChat's is `theme.typography.body.medium`). Map once:

| CometChat | Paper MD3 |
|---|---|
| `heading1.bold` | `fonts.headlineLarge` (or `displaySmall` for tighter fit) |
| `heading3.bold` | `fonts.titleLarge` |
| `heading4.regular` | `fonts.titleMedium` (nav-dead only) |
| `body.medium` | `fonts.bodyMedium` |
| `body.regular` | `fonts.bodyMedium` |
| `caption1.medium` / `caption1.regular` | `fonts.labelMedium` / `fonts.bodySmall` |
| `caption2` / `caption2.regular` | `fonts.labelSmall` |
| `button.medium` | `fonts.labelLarge` |

All live screens already have a Paper import in scope, so this is a mechanical `{ useTheme }` → `{ useTheme }` change from a different module plus a `theme.color.X` → `theme.colors.Y` rename. **Effort S, risk low.**

## 2.2 Icons

### Recommendation: **keep `@react-native-vector-icons/material-design-icons`.**

| Option | RN 0.81 + New Arch | Size | Effort |
|---|---|---|---|
| **`@react-native-vector-icons/material-design-icons` 13.1.5** (MIT, 2026-10-12) — peers `react: *`, `react-native: *`. Font-based: one 1.28 MB TTF, `@react-native-vector-icons/common`, **zero native code of its own**. Already installed, already in 9 live screens. | ✅ New Arch safe by construction — `Text` + a bundled font, no legacy view manager | 34.1 KB JS + 1.28 MB font asset | **none** |
| `lucide-react-native` 1.57.0 (ISC, 2026-10-14) — peers `react ^16.5||…||^19`, `react-native-svg ^12||^13||^14||^15` | ⚠️ Safe, but it's **SVG**, not a font | 1,941 icons × SVG nodes. Ships `react-native-svg`, which costs 248.6 KB JS **and 3.0 MB of `libreact_codegen_rnsvg.so` across 4 ABIs** | **L** — every icon name changes, all colour/size props change |
| `@iconify/react-native` | ❌ **Does not exist on npm** (404 for `@iconify/react-native`, `@iconify/icons`, `iconify-react-native`). The `@iconify/*` scope is web-only; `iconify-icon` 3.0.3 is a DOM custom element. | — | — |

**Note the irony:** switching to lucide would *re-introduce* `react-native-svg`, the very dependency the CometChat cleanup lets you delete and that costs 3 MB of native binaries. Keep RNVI.

Bonus win available while you are here: `@react-native-vector-icons/lucide` is a font-backed Lucide set, if you ever want Lucide's glyph shapes without the SVG cost.

## 2.3 i18n

### Recommendation: **a ~40-line in-repo string table. Not i18next.**

The live surface is **3 keys in 1 file** (`BottomTabNavigator.tsx:136`, resolving to `CHATS`, `CALLS`, `PROFILE`). The other ~60 `t('…')` keys live in screens that this cleanup deletes anyway. Committing to i18next to translate three tab labels is the tail wagging the dog — and it is precisely the decision that cannot be undone cheaply later, because every `t()` call site is a permanent shape.

| Option | RN 0.81 + New Arch | Size | Effort |
|---|---|---|---|
| **In-repo table** (`src/i18n/en.ts` exporting `const t = (k) => STRINGS[k] ?? k`) | ✅ no dependency | ~1 KB | **S** — 3 lines changed |
| `i18next` 26.4.4 (MIT, 2026-10-12) + `react-i18next` 17.0.16 (MIT, 2026-10-06) — pure JS, zero native, no RN version constraint | ✅ | i18next ~40 KB min + react-i18next ~15 KB | **M** — provider, hook, ICU-style plural/date handling, a `I18nextProvider` at the root, and a real decision about namespaces and fallbacks |
| `i18n-js` 4.5.4 (MIT, 2026-10-06) — no peers, but drags `lodash`, `make-plural`, `bignumber.js` | ✅ | ~60 KB + 3 deps for the same 3 strings | **S–M**, strictly worse than the table |

**What does not block future languages:** a named-string function with the key as the fallback. `t('CALLS')` returning `'CALLS'` until `en.ts` has the key means adding Spanish later is *adding a file and a lookup*, not a refactor. What *does* block them is adopting i18next now, because that choice propagates into `react-i18next`'s `useTranslation` hook shape, plural categories, and date-format pipeline across the whole codebase.

## 2.4 Animation

### Recommendation: **add nothing. `react-native`'s own `Animated` already covers the live app.**

The UIKit's animations die with the UIKit. What remains is already working: `IncomingCallOverlay.tsx` (12 `Animated`/`Easing` references), `ChatScreen.tsx` (26), `BottomTabNavigator.tsx:50-57` (`Animated.spring` with `useNativeDriver: true`). None of it needs Reanimated today.

If a future gesture-driven UI forces the question:

| Option | RN 0.81 + New Arch | Install cost |
|---|---|---|
| `react-native-reanimated` **4.x** | ✅ **New Architecture only** — the docs state "Reanimated 4 works only with the React Native New Architecture"; v3 is unmaintained. This app is New Arch, so that is fine. **For RN 0.81 the newest supported line is 4.3.x** (compat table: 4.3.x is the last minor with RN 0.81 = yes; 4.4.x requires ≥0.82). | `react-native-reanimated@^4.3.4` + **`react-native-worklets@^0.5.2`** (0.5.x is the pairing for 4.3.x; 0.6.0 and 0.6.1 also exist but 4.4+ wants 0.7.x). `react-native-worklets` is a **build-time** package with a `react-native` peer pin — `worklets@0.13.0` declares `react-native: "0.86 - 0.88"`, so **you must pin the 0.5.x line, not take latest.** Add `'react-native-worklets/plugin'` to `babel.config.js` (currently just `module:@react-native/babel-preset`). Native build for both. |
| `react-native-gesture-handler` **2.28.0** (already installed) | ✅ New Arch first-class; 259.9 KB already in the bundle | zero — but it is a *gesture recogniser*, not an animator. It pairs with Reanimated; it does not replace it. |

There is a real trap here: `react-native-worklets`' latest will **refuse to install** against RN 0.81 and will hard-fail the Podspec (`assert_minimal_react_native_version`) if you let npm resolve it. Pin both explicitly.

## 2.5 Call UI

### Recommendation: **delete `CometChatIncomingCall`, `CometChatOngoingCall`, `CometChatCallButtons`, `CometChatCallLogs` and `OngoingCallScreen` outright.**

Nothing needs replacing — the replacement already shipped and is already live:

| Capability | CometChat component | App's own, already working |
|---|---|---|
| Ring while foregrounded | `CometChatIncomingCall` (`App.tsx:740`) | `IncomingCallOverlay.tsx` (`App.tsx:754`) — subscribes to `api.calls.incoming`, uses `acceptCall` / `rejectCall` mutations |
| Ring while backgrounded / locked | `CometChatPushNotifications.init({ ringInForeground: … })` | `IncomingCallActivity.kt` + notifee full-screen intent + `NativeModules.CallIntent` (`App.tsx:504-552`) |
| In-call screen | `CometChatOngoingCall` (`OngoingCallScreen.tsx:89`) | `WebRTCCallScreen.tsx` — `react-native-webrtc`, registered as route `CallScreen` |
| Minimised-call indicator | — | `OngoingCallBar.tsx` (`App.tsx:755`) + `callStore.ts` |
| Call history | `CometChatCalls.CallLogRequestBuilder` (`CallHistory.tsx:33`) | `api.calls.history` in `Calls.tsx:59-62` |
| Call-back | — | `api.calls.start` in `Calls.tsx:63-95` |

`App.tsx:326-344` explicitly documents why the two must not coexist: `IncomingCallOverlay` already shows a full-screen Accept/Decline card, so the CometChat system ring produced "two racing Accept buttons". The app already made this decision; it just never deleted the loser.

---

# PART 3 — Migration plan

**Verification oracle for every step** (the repo ships it):
```bash
bash scripts/verify-cleanup.sh      # 1: Metro production bundle (hard-fails on any unresolved import)
                                    # 2: npx tsc --noEmit, own-code errors must not exceed baseline 17
npx tsc --noEmit                   # run alone for a readable error list
```
`scripts/verify-cleanup.sh` resolves the **entire** module graph, so an unresolved import is a hard exit-1, not a warning. Treat its `OK bundle=… delta …` line as the running byte tally. The script's default `BASE_BYTES=8746133` is stale relative to the current 7,397,360-byte release bundle — pass the current number explicitly as `$1` on the first run to get a meaningful delta.

## Ordered steps

### Step 1 — Delete the nav-dead screens (safe immediately, zero live importers)
**Files deleted (27):**
`src/components/conversations/screens/` → `AddMember.tsx`, `AddMemberStyles.tsx`, `BannedMember.tsx`, `BannedMemberStyles.tsx`, `Conversations.tsx`, `CreateConversation.tsx`, `GroupInfo.tsx`, `GroupInfoStyles.tsx`, `OngoingCallScreen.tsx`, `PinnedMessages.tsx`, `SavedMessages.tsx`, `SearchMessages.tsx`, `ThreadView.tsx`, `TransferOwnership.tsx`, `TransferOwnershipStyles.tsx`, `UserInfo.tsx`, `UserInfoStyles.tsx`, `ViewMembers.tsx`, `qr_screen.tsx`
`src/components/conversations/helper/GroupListeners.ts`
`src/components/calls/` → `CallDetailHelper.tsx`, `CallDetails.tsx`, `CallHistory.tsx`, `CallLogDetailHeader.tsx`, `CallParticipants.tsx`, `CallRecordings.tsx`
`src/components/groups/` → `Groups.tsx`, `GroupHelper.tsx`, `styles.ts`
`src/components/AIAgent/AIAgents.tsx`, `src/components/users/Users.tsx`, `src/hooks/useGroupMemberStatus.ts`, `src/utils/TooltipMenu.tsx`

**Files edited:** `src/navigation/RootStackNavigator.tsx` — remove 14 `<Stack.Screen>` registrations and their imports; `src/navigation/types.ts` — remove the matching param-list entries; `src/utils/AppConstants.tsx` — drop `CONVERSATION`, `CREATE_CONVERSATION`, `SEARCH_MESSAGES`, `SAVED_MESSAGES`, `PINNED_MESSAGES`, `USER_INFO`, `GROUP_INFO`, `ADD_MEMBER`, `TRANSFER_OWNERSHIP`, `BANNED_MEMBER`, `VIEW_MEMBER`, `QR_SCREEN`, `AI_AGENTS`, `CALL_DETAILS`, `CALL_LOGS`, `ONGOING_CALL_SCREEN`.

**Breaks:** `verify-cleanup.sh` step 1 exits 1 if you delete a file but leave a `<Stack.Screen component={…}>` or an `SCREEN_CONSTANTS.X` reference. `tsc` reports unresolved-module errors in `RootStackNavigator` and `types.ts`. The AndroidManifest still declares `CAMERA` (for `qr_screen`) — remove it here; `vision-camera` can be uninstalled in Step 7.

**Expected bundle delta:** −400 KB to −500 KB source (the nav-dead UIKit-heavy screens pull in the UIKit's message list, composer, emoji table and rich-text formatter).

### Step 2 — Delete the dev-only screens
**Files deleted:** `src/components/login/AppCredentials.tsx`, `src/components/login/SampleUser.tsx`, `src/components/login/Skeleton.tsx`, and the `sampleData` block + 5 hero-PNG imports in `src/utils/helper.ts:2-6,190-201`.
**Files edited:** `src/navigation/RootStackNavigator.tsx:81-86` (`React.lazy` + `__DEV__` blocks) and `:259-270` (the `!__DEV__` alias-to-Login pad — **keep this**, it is what stops a stray `resetTo('SampleUser')` becoming a blank screen).

**Breaks:** `helper.ts::sampleData` is imported by `SampleUser.tsx:29` — both go together.

### Step 3 — Unwire the Calls SDK and the push package
**Files deleted:** `src/utils/CometChatPushV2.ts`.
**Files edited:**
- `App.tsx` — delete `:32` (`setupPushOnLogin` import), `:39` (`ensureCometChatSession`), `:90-92` (`incomingCall` ref), `:95-98` (`busyRejectTimers`), `:164-171` (the `theme` memo), `:173-207` (`CometChatUIKit.init` effect), `:213-217` (`ensureCometChatSession` effect), `:554-563` (`setupPushOnLogin` effect), `:565-647` (the whole `CometChat.addCallListener` + `CometChatUIEventHandler` effect), `:689-721` (the card-action `addUIListener` effect), `:739-747` (`<CometChatIncomingCall>`)
- `index.js` — delete `:7` and `:34` (`registerBackgroundCallTask`)
- `src/auth/SessionProvider.tsx` — delete `:12`, `:14`, `:281`, `:285`
- `ios/SampleAppWithPushNotifications/AppDelegate.swift` — delete `:31`, `:55`, `:70` (`CometChatPushNotificationsAppDelegate.*`)
- `src/navigation/RootStackNavigator.tsx:16,357-359` — remove the `OngoingCallScreen` import and route
- `jest.setup.js:115` — remove the `jest.mock('@cometchat/push-notifications-react-native', …)`; `jest.config.js:5` — drop `@cometchat` from `transformIgnorePatterns`

**Breaks / how to detect:** this is the **highest-risk step** and the only one that touches shipped native code. On Android, `verify-cleanup.sh` will still pass (it is JS-only) — it will *not* catch a stale native call. Detect with `./gradlew assembleRelease`, which fails to link if `AppDelegate.swift`/Kotlin still references a removed class. On device, verify: **answer an incoming call from the lock screen** (exercises `IncomingCallActivity.kt` → `MainActivity` → `NativeModules.CallIntent` → `App.tsx:504-552`), and **decline one from a notification while the app is killed**.

### Step 4 — Remove the Chat SDK session
**Files deleted:** `src/auth/cometetchatSession.ts`.
**Files edited:**
- `App.tsx:94` (`hasValidAppCredentials` state) and `:188-195` (its set), `:750` (the prop passed to `RootStackNavigator`) — `hasValidAppCredentials` exists **only** to feed `__DEV__`-only credential routing; Step 2 removed that, so the state is now dead weight
- `App.tsx` `:102` (`paperTheme` is still needed for the early-return background), delete `:209-217`
- `src/navigation/RootStackNavigator.tsx` — delete `:16` (the `OngoingCallScreen` import, if not already), `:23-26` (`getCometChatSessionError`, `subscribeCometChatSessionError`), `:94-125` (`CallsUnavailableBanner`), `:361` (its render), `:127` (`hasValidAppCredentials: _hasValidAppCredentials` prop), `:216-219` (the `__DEV__` initial-route branch — now `isLoggedIn ? TAB : LOGIN`)
- `src/components/login/Login.tsx:23,136-…` and `SignUp.tsx:23,143-…` — delete the `ensureCometChatSession` call and the banner/toast it drives; the Convex session result already covers login success/failure
- `src/navigation/types.ts:2` — delete the `CometChat` import

**Breaks / how to detect:** `Login`/`SignUp` currently *await* the CometChat session before navigating. If you delete the call but leave the `await`, login silently never proceeds — `tsc` will **not** catch it. Verify on device: **sign in fresh with a new account, and sign up**, both cold.

### Step 5 — Swap the theme (this is the whole remaining CometChat surface)
**Files edited (11):** `src/components/calls/IncomingCallOverlay.tsx:15`, `src/components/calls/WebRTCCallScreen.tsx:15`, `src/components/convex/ChatScreen.tsx:29`, `ChatInfoScreen.tsx:4`, `ContactInfoScreen.tsx:4`, `ForwardMessageScreen.tsx:3`, `GroupsList.tsx:15`, `src/components/login/Login.tsx:15`, `SignUp.tsx:15`, `src/navigation/RootStackNavigator.tsx:18`, `src/navigation/BottomTabNavigator.tsx:14`.

For each: change the import to `react-native-paper`, apply the token map in §2.1. In `RootStackNavigator.tsx:134-140`, replace the `useTheme()`-driven `NavigationTheme` with `MD3LightTheme`/`MD3DarkTheme` extended by `colors.background`.
Then in `App.tsx`: delete `:35` (`DeepPartial`), `:73-86` (`buildCometChatPalette`), `:164-171` (the theme memo), `:737` and `:776` (`<CometChatThemeProvider>`), `:738` and `:775` (`<CometChatI18nProvider>`).

**Breaks / how to detect:** pure mechanical rename. `tsc` catches every missed `theme.color.X`. Visual regressions are invisible to both oracles — **this is the step that needs eyes on a device**, not a green build. Walk every screen in both light and dark.

### Step 6 — Replace `useCometChatTranslation`
**Files edited:** `src/navigation/BottomTabNavigator.tsx:14,96,136`. Delete the hook; use the in-repo table (§2.3) or literal labels.

**Breaks:** three tab labels become `CHATS`/`CALLS`/`PROFILE` if you forget the table. Visible on launch.

### Step 7 — Uninstall
```bash
npm uninstall @cometchat/chat-uikit-react-native @cometchat/chat-sdk-react-native \
              @cometchat/calls-sdk-react-native @cometchat/push-notifications-react-native \
              react-native-callstats react-native-background-timer \
              @react-native-community/netinfo @react-native-community/datetimepicker \
              react-native-svg react-native-localize react-native-url-polyfill \
              react-native-vision-camera
cd android && ./gradlew clean && cd ios && pod deintegrate && pod install
```
**Files edited:** `ios/Podfile` — delete the two `pod 'SPTPersistentCache'` / `pod 'DVAssetLoaderDelegate'` lines (they exist only for the UIKit's `VideoCaching` subspec). `android/app/proguard-rules.pro:88-91` — delete the `com.CometChatCalls.**` keep/dontwarn rules. `android/app/build.gradle` — drop `WRITE_EXTERNAL_STORAGE`/`READ_EXTERNAL_STORAGE`/`CAMERA` if nothing else needs them.

**Breaks / how to detect:** `pod deintegrate` + `pod install` is where the iOS Swift pod `react-native-cometchat-ui-kit` (with its `SPTPersistentCache` + `DVAssetLoaderDelegate` modular-header workaround) finally goes away. A stale `SPTPersistentCache` reference in `project.pbxproj` breaks the x86_64 iOS build only — build with `--configuration Release -sdk iphonesimulator` to catch it.

### Final `package.json` dependencies

```jsonc
{
  "dependencies": {
    "@noble/hashes": "^2.4.0",                              // keep — convex/auth.ts
    "@notifee/react-native": "^9.1.8",
    "@react-native-async-storage/async-storage": "^2.2.0",
    "@react-native-clipboard/clipboard": "^1.16.3",
    "@react-native-firebase/app": "^23.4.0",
    "@react-native-firebase/auth": "^23.4.0",
    "@react-native-firebase/database": "^23.4.0",
    "@react-native-firebase/messaging": "^23.8.8",
    "@react-native-vector-icons/material-design-icons": "^13.1.4",
    "@react-native/new-app-screen": "0.81.4",
    "@react-navigation/bottom-tabs": "^7.4.7",
    "@react-navigation/native": "^7.1.17",
    "@react-navigation/native-stack": "^7.14.12",
    "@react-navigation/stack": "^7.4.8",                      // drop if only ThreadView/@react-navigation/stack used it
    "convex": "^1.46.0",
    "dayjs": "^1.11.18",
    "firebase-admin": "^14.5.0",
    "react": "19.1.0",
    "react-native": "0.81.4",
    "react-native-device-info": "^14.1.1",
    "react-native-gesture-handler": "^2.28.0",
    "react-native-image-picker": "^8.2.1",
    "react-native-paper": "^5.15.3",
    "react-native-safe-area-context": "^5.6.1",
    "react-native-screens": "^4.16.0",
    "react-native-video": "^6.16.1",
    "react-native-webrtc": "^124.0.7",
    "zustand": "^5.0.8"
  }
}
```
`@react-native-documents/picker` was left off the list above only because it was added after this snapshot was taken — **keep it** (`ChatScreen.tsx` imports it).

**18 dependencies removed, 30 kept.** (Note `react-native-screens` is a required peer of `@react-navigation/native-stack` even though nothing imports it directly; and `react-native-video`, `react-native-gesture-handler`, `react-native-clipboard`, `react-native-device-info`, `@react-native-async-storage/async-storage`, `dayjs`, `zustand` are all still live.)

### Do this FIRST (zero live importers, zero risk)

- All 27 nav-dead screens in Step 1. No live file imports any of them.
- `src/utils/TooltipMenu.tsx` — its only importer is nav-dead `Conversations.tsx`.
- `src/hooks/useGroupMemberStatus.ts` — only importer is nav-dead `ThreadView`.
- `src/components/users/Users.tsx` — **already has zero importers** in this snapshot; the concurrent editor removed its route.
- `src/components/login/{AppCredentials,SampleUser,Skeleton}.tsx` — dev-only behind `React.lazy`.
- `src/utils/CometChatPushV2.ts` — once `App.tsx:562` is removed, nothing imports it.

### Do this LAST (risky, ordered by blast radius)

1. **Step 4 (Chat SDK session)** — touches the **login path**. A half-removed `await` fails silently, not loudly. Highest functional risk.
2. **Step 3 (Calls + push)** — the only step that edits **native** code (`AppDelegate.swift`, `proguard-rules.pro`, `Podfile`). `verify-cleanup.sh` cannot see it. Wrong move here kills incoming calls, which is the app's whole reason to exist.
3. **Step 7 (uninstall + pods)** — irreversible dependency removal; `pod deintegrate` can surface latent iOS build problems that were previously masked.
4. **Step 5 (theme)** — zero build risk, but every visual regression is invisible to both oracles. Needs human eyes.

---

# PART 4 — Verdict

Removing all four `@cometchat/*` packages is safe and clearly worthwhile. The app's chat, groups, files and calling all run on Convex, `react-native-webrtc` and notifee; the only things CometChat still provides to reachable code are a redundant theme object in 11 files, three tab labels in one file, and an `init`/`login`/`logout` round-trip whose result nothing consumes — and the Calls SDK is never even initialised, so it cannot work by construction. The win is roughly 45 % of the app's JS source, about **4.2 MB off the uncompressed Hermes bundle plus 3.0 MB of `rnsvg` native code** (~5.1 MB of a 4-ABI APK, ~3.0 MB of an arm64 AAB). **The single biggest risk is Step 3: it is the only step that changes native iOS/Android code, and `verify-cleanup.sh` is JS-only, so a stale `CometChatPushNotificationsAppDelegate` call or a half-removed push handler passes every automated check and silently breaks incoming calls on a device.** Before that step, record a device smoke run — login cold, sign in, receive a call from the lock screen and decline it, receive a call with the app foregrounded and accept it, place an outgoing call from the Calls tab, send and receive a message — and replay exactly that after each of Steps 3, 4 and 5. Before Step 7, build `assembleRelease` and an iOS Release simulator build, because that is the only thing that exercises the pod and proguard changes.

---

## References

**CometChat (current state)**
- `@cometchat/push-notifications-react-native` 1.0.0 source, `CometChatPushNotifications.init` — `node_modules/@cometchat/push-notifications-react-native/src/CometChatPushNotifications.ts:108-158`, `registerToken` `:161-170`, retry `:301-336`. Peers: `react-native >= 0.78.0`.
- npm: <https://www.npmjs.com/package/@cometchat/push-notifications-react-native> · <https://www.npmjs.com/package/@cometchat/chat-uikit-react-native> · <https://www.npmjs.com/package/@cometchat/calls-sdk-react-native> · <https://www.npmjs.com/package/@cometchat/chat-sdk-react-native>
- CometChat RN UI Kit — RN CLI integration (peer `react-native >= 0.77.0`): <https://www.cometchat.com/docs/ui-kit/react-native/react-native-cli-integration>
- CometChat RN UI Kit overview: <https://www.cometchat.com/docs/ui-kit/react-native/overview>
- v4 → v5 upgrade (the `CometChatTheme` class → `CometChatThemeProvider` change, `CometChatI18nProvider` split-out): <https://www.cometchat.com/docs/ui-kit/react-native/upgrading-from-v4>
- v4 getting started, **known New-Architecture issue on RN 0.76/0.77 (video player on Android)**: <https://cometchat-013b37f0.mintlify.app/ui-kit/react-native/v4/getting-started>
- New-Architecture support claim: <https://www.linkedin.com/posts/antant2209/im-excited-to-share-that-cometchats-react-activity-7323783108078514176-Bqbp>
- UIKit repo (RN 0.77+): <https://github.com/cometchat/cometchat-uikit-react-native>

**Theme**
- `react-native-paper` 5.15.3 — MIT, published 2026-05-26, peers `react: *` / `react-native: *` / `react-native-safe-area-context: *`: <https://www.npmjs.com/package/react-native-paper> · <https://github.com/callstack/react-native-paper>
- gluestack-ui v5.0.3 stable (2026-06-25) — requires **NativeWind v5 (`5.0.0-preview.4`)** + Tailwind v4 + `react-native-css` + `postcss.config.js` + `metro.config.js` rewrite + `lightningcss@1.30.1` pin; drops Next.js: <https://github.com/gluestack/gluestack-ui/releases/tag/v5.0.0> · <https://gluestack.io/ui/docs/guides/more/upgrade-to-v5> · <https://gluestack.io/ui/docs/changelog/v5-alpha-release>
- `@gluestack-ui/core` 5.0.15 (2025-06-25) / `@gluestack-ui/themed` last published 2025-04-08: <https://www.npmjs.com/package/@gluestack-ui/core>
- tamagui 3.0.9 — MIT, published 2026-10-14, peers `react >=19` / `react-native-safe-area-context: *`, 70+ transitive packages: <https://www.npmjs.com/package/tamagui>
- react-native-unistyles 3.5.3 — MIT, published 2026-10-13, peers `react-native >=0.81.0` **plus required** `react-native-nitro-modules`, `react-native-reanimated`, `react-native-edge-to-edge`, `@react-native/normalize-colors`: <https://www.npmjs.com/package/react-native-unistyles>
- nativewind 4.2.7 — MIT, published 2026-09-14: <https://www.npmjs.com/package/nativewind>

**Icons**
- `@react-native-vector-icons/material-design-icons` 13.1.5 — MIT, published 2026-10-12; font-based (1.28 MB TTF), deps only `@react-native-vector-icons/common`; per-set packages, `/static` import for dev builds: <https://www.npmjs.com/package/@react-native-vector-icons/material-design-icons> · <https://github.com/oblador/react-native-vector-icons> · <https://github.com/oblador/react-native-vector-icons/blob/master/docs/SETUP-REACT-NATIVE.md>
- lucide-react-native 1.57.0 — ISC, published 2026-10-14, peers `react ^16.5…^19`, **`react-native-svg ^12||^13||^14||^15`**: <https://www.npmjs.com/package/lucide-react-native>
- `@iconify/react-native` — **not published on npm** (404 for `@iconify/react-native`, `@iconify/icons`, `iconify-react-native`); `iconify-icon` 3.0.3 is a DOM custom element, `@iconify/react` 6.0.2 is web-only: <https://www.npmjs.com/package/iconify-icon> · <https://www.npmjs.com/package/@iconify/react>
- `react-native-svg` 15.15.5 (MIT, 2026-05-11): <https://www.npmjs.com/package/react-native-svg>

**i18n**
- i18next 26.4.4 — MIT, published 2026-10-12, zero runtime dependencies: <https://www.npmjs.com/package/i18next>
- react-i18next 17.0.16 — MIT, published 2026-10-06, peers `i18next >= 26.2.0`, `react >= 16.8.0`: <https://www.npmjs.com/package/react-i18next>
- i18n-js 4.5.4 — MIT, published 2026-10-06, deps `lodash` + `make-plural` + `bignumber.js`: <https://www.npmjs.com/package/i18n-js>

**Animation**
- Reanimated compatibility table — "Reanimated 4 works only with the React Native New Architecture"; RN 0.81 is supported by **4.0.x–4.3.x only** (4.4.x requires ≥0.82); worklets pairing 4.3.x ↔ 0.4.x/0.5.x: <https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility/>
- Reanimated 4.0.0 release notes (New Arch only, "Support for React Native 0.80 and 0.81", legacy arch code removed): <https://github.com/software-mansion/react-native-reanimated/releases/tag/4.0.0>
- Reanimated 4.3.0 (RN 0.81 TS fixes; "Bump minimal React Native version to 0.81"): <https://github.com/software-mansion/react-native-reanimated/releases/tag/4.3.0> · <https://swmansion.com/changelog/reanimated-4-3-0/>
- Known failure mode (worklets `react-native` peer mismatch failing `pod install`): <https://github.com/software-mansion/react-native-reanimated/issues/8963>
- `react-native-worklets` 0.13.0 peer `react-native: "0.86 - 0.88"` — must be pinned to the 0.5.x line for RN 0.81: <https://www.npmjs.com/package/react-native-worklets>
- `react-native-gesture-handler` 3.3.0 (MIT, 2026-09-11) — app is on 2.28.0: <https://www.npmjs.com/package/react-native-gesture-handler>

**Internal measurements (this repo)**
- `android/app/build/outputs/apk/release/app-release.apk` — 121.04 MB; `assets/index.android.bundle` 7,397,360 B, **stored uncompressed** (raw == compressed); 20 `.so` per ABI, **none CometChat**
- `android/app/build/generated/sourcemaps/react/release/index.android.bundle.map` — 2,767 modules, `sourcesContent` byte counts
- `android/app/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib/arm64-v8a/` — 20 `.so`, 248,062 KB; `libreact_codegen_rnsvg.so` 9,861 KB debug / 729,064 B in the release APK
- `node_modules/@cometchat/chat-sdk-react-native/` — **no `android/` directory**, no AAR (pure JS)
- `ios/Podfile.lock:3,7,1818-1830,2890` — `react-native-cometchat-ui-kit (5.5.1)` with `Video` + `VideoCaching` subspecs, `SPTPersistentCache (1.1.0)`, `DVAssetLoaderDelegate (0.3.3)`, `cometchat-calls-sdk-react-native (4.4.1)`
- `scripts/verify-cleanup.sh` — the bundle + tsc oracle (baseline `BASE_BYTES=8746133`, `BASELINE_TSC=17`)