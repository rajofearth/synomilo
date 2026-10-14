# Audit 10 - Bloat & Dead Code

**Repo:** `P:\Projects\cometchat-sample-app` ("synomilo") - RN 0.81 / Hermes, Convex backend
**Scope:** `src/`, `App.tsx`, `index.js`, repo-root artifacts
**Method:** reverse-dependency graph built from a BFS over every `import` / `require()` / `import()` specifier in every tracked `.ts/.tsx/.js/.jsx`, rooted at the true entry points (`index.js` -> `App.tsx` -> `AppErrorBoundary.tsx` -> `src/navigation/*` -> screens). Bundle sizes are **measured**, not estimated: they come from the real release source map at `android/app/build/generated/sourcemaps/react/release/index.android.bundle.map` (2,768 modules) and the real Hermes artefact `android/app/build/intermediates/assets/release/mergeReleaseAssets/index.android.bundle` (7,389,644 B).

## TL;DR

The hypothesis in the brief is **correct, and then some**. The fork left behind the entire original CometChat UIKit screen stack. Two distinct tiers exist:

- **Tier A - provably dead:** 8 files, zero importers anywhere in the repo. Already absent from the release bundle.
- **Tier B - nav-unreachable:** 76 more files, still bundled into every APK, reachable only by a `<Stack.Screen>` *registration* in `RootStackNavigator.tsx` and never by a `navigate()` call from any live code.

Together: **84 files / 536,415 bytes** of dead source, and **~535 KB of minified JS (~750 KB of Hermes bytecode) plus ~223 KB of raster assets, ~= 970 KB off the release APK**, without touching a single live behaviour. There is a further **~3.3 MB** prize if the CometChat UIKit + Calls SDK can be retired entirely - but that is a separate, much riskier project (Phase 5.3).

---

## Dead code inventory

### Tier A - zero importers (8 files, 34,900 bytes)

Proven dead by an exhaustive `from '...'` / `require('...')` / `import('...')` sweep over `src/`, `convex/`, `App.tsx`, `AppErrorBoundary.tsx`, `index.js` and `__tests__/`, plus SHA-256 content hashing of every icon. **None of these files appears in the release source map** - they cost repo size, not APK size.

| Path | Bytes | Why it is dead |
|---|---:|---|
| `src/components/conversations/screens/Messages.tsx` | 26,686 | **Zero importers.** The `Messages` route in `RootStackNavigator.tsx:146` is wired to `src/components/convex/ChatScreen`, not to this file. Nothing anywhere imports it. Largest single piece of dead code in the repo. |
| `src/assets/icons/Info.tsx` | 1,195 | Zero importers. Byte-identical (SHA-256 `04EC1465...`) to `InfoIcon.tsx` - a pure case-variant duplicate. Its only would-be importer was the already-dead `Messages.tsx`. |
| `src/assets/icons/GroupFill.tsx` | 1,452 | Zero importers. Case-variant sibling of the live `Group.tsx`; same `Mask/Path/G` filled-glyph shape as `calls/icons/call-log-fill.tsx`. |
| `src/assets/icons/Chatfill.tsx` | 1,317 | Zero importers. Lower-case-`f` duplicate naming; geometrically a "chat bubble filled" glyph with no consumer. |
| `src/assets/icons/Chat.tsx` | 1,114 | Zero importers. Outline twin of `Chatfill.tsx`; no consumer. |
| `src/assets/icons/PersonFill.tsx` | 1,098 | Zero importers. Filled twin of `Person.tsx`; no consumer. |
| `src/assets/icons/CallFill.tsx` | 1,021 | Zero importers. Byte-identical to `src/components/calls/icons/call-fill.tsx`, which the barrel already re-exports as `CallFill`. Pure duplication. |
| `src/assets/icons/Person.tsx` | 1,017 | Zero importers. Outline twin of `PersonFill.tsx`; no consumer. |
| **TOTAL** | **34,900** | |

> `src/declarations.d.ts` (83 B) also reports zero importers. **It is NOT dead** - it is an ambient module declaration picked up by `tsconfig.json`, not by an import edge. Keep.

### Tier B - nav-unreachable (76 files, 501,515 bytes)

Each of these *is* imported by `src/navigation/RootStackNavigator.tsx`, but only as `<Stack.Screen component={...}>`. A grep of every `navigate(`, `navigation.navigate(`, `navigation.push(`, `StackActions.push`, `CommonActions.reset` and `dispatch(` in the repo shows **no live caller targets any of these route names**. The only inbound edges are between Tier B files themselves, so the whole cluster is unreachable from the running app.

| Path | Bytes | Why it is dead |
|---|---:|---|
| `src/components/conversations/screens/GroupInfo.tsx` | 18,345 | Route `GroupInfo` only navigated to from the already-dead `Messages.tsx:449`. The live stack routes to `ChatInfo` instead (`ChatScreen.tsx:713`). |
| `src/components/calls/CallDetails.tsx` | 14,977 | Route `CallDetails`. **Nothing in the repo navigates to it.** The Convex `Calls.tsx` is a flat list with call-back; it never opens a detail screen. |
| `src/components/conversations/screens/UserInfo.tsx` | 15,227 | Route `UserInfo` only from dead `Messages.tsx:457`. The live stack routes to `ContactInfo`. |
| `src/components/conversations/screens/qr_screen.tsx` | 14,991 | Route `QRScreen` only from dead `Conversations.tsx:325`. Sole consumer of `react-native-vision-camera` and of `cometchat_sync_img.png`. |
| `src/components/groups/GroupHelper.tsx` | 14,395 | Imported only by dead `groups/Groups.tsx`; pulls `Group`, `GroupAdd` and `groups/styles.ts`. |
| `src/components/conversations/screens/Conversations.tsx` | 11,528 | Route `Conversation`. **No `navigate('Conversation')` exists anywhere** - the Chats tab is the Convex `ConversationsList`. |
| `src/components/conversations/screens/AddMember.tsx` | 8,920 | Route `AddMember` only from dead `GroupInfo.tsx:313`. |
| `src/components/calls/CallHistory.tsx` | 7,828 | Imported only by dead `CallDetails.tsx`. |
| `src/components/conversations/screens/BannedMember.tsx` | 6,979 | Route `BannedMember` only from dead `GroupInfo.tsx:373`. |
| `src/components/calls/CallLogDetailHeader.tsx` | 6,863 | Imported only by dead `CallDetails.tsx`. |
| `src/components/calls/CallRecordings.tsx` | 6,640 | Imported only by dead `CallDetails.tsx`. Sole consumer of `PlayArrow` and of `NativeModules.FileManager`. |
| `src/components/conversations/screens/BannedMemberStyles.tsx` | 6,467 | Imported only by dead `BannedMember.tsx`. |
| `src/components/conversations/screens/SearchMessages.tsx` | 5,537 | Route `SearchMessages` only from dead `Messages.tsx` / `Conversations.tsx`. |
| `src/components/calls/CallDetailHelper.tsx` | 5,007 | Imported only by `CallDetails` / `CallHistory` / `CallParticipants` / `CallRecordings` - all dead. Sole consumer of `CallMade`, `CallMissedOutgoingFill`, `CallReceived`. |
| `src/components/groups/Groups.tsx` | 5,069 | Imported only by dead `CreateConversation.tsx`. The live `Groups` route is the Convex `GroupsList`. |
| `src/components/calls/CallParticipants.tsx` | 4,419 | Imported only by dead `CallDetails.tsx`. |
| `src/utils/TooltipMenu.tsx` | 4,666 | Imported only by dead `Conversations.tsx`. |
| `src/components/conversations/screens/TransferOwnership.tsx` | 4,023 | Route `TransferOwnershipSection` only from dead `GroupInfo.tsx:171`. |
| `src/components/conversations/screens/CreateConversation.tsx` | 4,088 | Route `CreateConversation` only from dead `Conversations.tsx:228`. |
| `src/components/conversations/screens/SavedMessages.tsx` | 3,545 | Route `SavedMessages` only from dead `Conversations.tsx:257`. |
| `src/components/conversations/screens/PinnedMessages.tsx` | 3,091 | Route `PinnedMessages` only from dead `Messages.tsx:565`. |
| `src/components/AIAgent/AIAgents.tsx` | 2,026 | Route `AIAgents` only from dead `Conversations.tsx:242`. A second `CometChatUsers` instance. |
| `src/components/conversations/screens/ViewMembers.tsx` | 2,103 | Route `ViewMembers` only from dead `GroupInfo.tsx:342`. |
| `src/components/conversations/helper/GroupListeners.ts` | 1,956 | Imported only by dead `GroupInfo.tsx`. |
| `src/components/conversations/screens/UserInfoStyles.tsx` | 1,632 | Imported only by dead `UserInfo.tsx`. |
| `src/components/conversations/screens/GroupInfoStyles.tsx` | 1,629 | Imported only by dead `GroupInfo.tsx`. |
| `src/components/groups/styles.ts` | 1,449 | Imported only by dead `GroupHelper.tsx` / `Groups.tsx`. |
| `src/components/users/Users.tsx` | 1,481 | Route `Users` on the **stack**. Nothing navigates to it; the bottom tab named `Users` is the Convex `UsersList`. A route-name collision. |
| `src/components/conversations/screens/AddMemberStyles.tsx` | 1,067 | Imported only by dead `AddMember.tsx`. |
| `src/components/conversations/screens/TransferOwnershipStyles.tsx` | 739 | Imported only by dead `TransferOwnership.tsx`. |
| `src/navigation/AuthContext.tsx` | 284 | Imported only by dead `Conversations.tsx`. An unused `React.createContext` with a default object - no `Provider` is ever mounted. |
| `src/components/calls/icons/index.tsx` | 909 | Barrel imported only by dead `CallDetailHelper.tsx` / `CallRecordings.tsx`. |
| `src/components/calls/icons/call-log-fill.tsx` | 1,514 | Only the dead barrel imports it; no consumer by name anywhere. |
| `src/components/calls/icons/call-log.tsx` | 1,417 | idem. |
| `src/components/calls/icons/cancel-fill.tsx` | 1,456 | idem. |
| `src/components/calls/icons/call-end-fill.tsx` | 1,126 | idem. |
| `src/components/calls/icons/call-missed-outgoing-fill.tsx` | 1,128 | Only `CallDetailHelper.tsx` (dead) imports `CallMissedOutgoingFill`. |
| `src/components/calls/icons/call-fill.tsx` | 1,021 | idem. Byte-identical to dead `assets/icons/CallFill.tsx`. |
| `src/components/calls/icons/call-missed-fill.tsx` | 1,108 | idem. |
| `src/components/calls/icons/call-end.tsx` | 980 | idem. |
| `src/components/calls/icons/call.tsx` | 900 | idem. Byte-identical to `assets/icons/Call.tsx`. |
| `src/components/calls/icons/call-made-fill.tsx` | 962 | idem. |
| `src/components/calls/icons/call-received-fill.tsx` | 960 | idem. |
| `src/components/calls/icons/call-missed.tsx` | 754 | idem. |
| `src/components/calls/icons/call-missed-outgoing.tsx` | 743 | idem. |
| `src/components/calls/icons/call-received.tsx` | 647 | Only `CallDetailHelper.tsx` (dead) imports `CallReceived`. |
| `src/components/calls/icons/call-made.tsx` | 646 | Only `CallDetailHelper.tsx` (dead) imports `CallMade`. |
| `src/components/calls/icons/play-arrow.tsx` | 625 | Only dead `CallRecordings.tsx` imports `PlayArrow`. |
| `src/assets/icons/AiIcon.tsx` | 2,493 | Only dead `Conversations.tsx`. |
| `src/assets/icons/UserEmptyIcon.tsx` | 1,677 | Only dead `BannedMember.tsx`. |
| `src/assets/icons/Builder.tsx` | 1,955 | Only dead `Conversations.tsx`. |
| `src/assets/icons/AccountCircle.tsx` | 1,381 | Only dead `Conversations.tsx`. |
| `src/assets/icons/Group.tsx` | 1,432 | Only dead `GroupInfo.tsx` / dead `GroupHelper.tsx`. |
| `src/assets/icons/GroupAdd.tsx` | 1,417 | Only dead `GroupHelper.tsx`. |
| `src/assets/icons/PersonAdd.tsx` | 1,371 | Only dead `GroupInfo.tsx`. |
| `src/assets/icons/Delete.tsx` | 1,101 | Only dead `GroupInfo.tsx` / `UserInfo.tsx`. |
| `src/assets/icons/InfoIcon.tsx` | 1,195 | Only dead `Conversations.tsx` / dead `Messages.tsx`. |
| `src/assets/icons/Call.tsx` | 900 | Only dead `UserInfo.tsx`. Byte-identical to `calls/icons/call.tsx`. |
| `src/assets/icons/Logout.tsx` | 1,022 | Only dead `Conversations.tsx`. |
| `src/assets/icons/Block.tsx` | 994 | Only dead `BannedMember.tsx` / `GroupInfo.tsx` / `UserInfo.tsx`. |
| `src/assets/icons/AddComment.tsx` | 929 | Only dead `Conversations.tsx`. |
| `src/assets/icons/CheckFill.tsx` | 892 | Only `login/SampleUser.tsx` (a `__DEV__`-only screen - see Phase 3). |
| `src/assets/icons/Reset.tsx` | 834 | Only dead `Conversations.tsx`. |
| `src/assets/icons/ArrowBack.tsx` | 722 | Only dead `AddMember` / `CreateConversation` / `GroupInfo` / `TransferOwnership` / `UserInfo`. |
| `src/assets/icons/Close.tsx` | 714 | Only dead `BannedMember.tsx`. |
| `src/assets/icons/Flash.tsx` | 680 | Only dead `qr_screen.tsx`. |
| `src/assets/icons/VideoCam.tsx` | 648 | Only dead `UserInfo.tsx`. |
| `src/assets/icons/PersonOff.tsx` | 1,212 | Only dead `GroupInfo.tsx`. |
| `src/assets/icons/cometchat_sync_img.png` | 165,611 | Only dead `qr_screen.tsx:17`. **Ships as `drawable-mdpi/src_assets_icons_cometchat_sync_img.png` (161.7 KB) in every APK.** |
| `src/assets/icons/bug.png` | 31,076 | **Zero references anywhere.** Not in the bundle, not in any drawable dir. |
| `src/assets/icons/google.png` | 19,819 | **Zero references anywhere.** Not in the bundle. |
| **TOTAL (76 files)** | **501,515** | |

**Grand total: 84 files, 536,415 bytes of dead source.**

### Deliberately NOT in the dead set (read this before deleting)

| Path | Bytes | Why it must stay |
|---|---:|---|
| `src/components/conversations/screens/ThreadView.tsx` | 13,216 | **Runtime-reachable from a live module.** `src/utils/helper.ts:226` does `StackActions.push(SCREEN_CONSTANTS.THREAD_VIEW, ...)`, and `helper.ts` is imported by `src/utils/CometChatPushV2.ts`, which `App.tsx` calls on every login. It is legacy and *broken* (it renders a `CometChat.Message`; the Convex chat does not), but it is **not dead**. |
| `src/hooks/useGroupMemberStatus.ts` | 4,055 | Imported by `ThreadView.tsx` (kept) as well as by dead `Messages.tsx`. |
| `src/utils/CommonUtils.ts` | 1,438 | Imported by `ThreadView.tsx` (kept) as well as by dead files. |
| `src/utils/helper.ts` | 11,286 | **Live** (`CometChatPushV2.ts`). Only its `sampleData` export and the 5 hero-PNG imports are dead weight - see Phase 3. |
| `src/components/conversations/screens/OngoingCallScreen.tsx` | 3,260 | **Live** - targeted by `CometChatPushV2.ts:80` on `onCallAccepted`. It is the only surviving consumer of `CometChatOngoingCall` / `CometChatCalls`. |
| `src/components/calls/Calls.tsx`, `IncomingCallOverlay.tsx`, `WebRTCCallScreen.tsx` | 30,034 | Live (Calls tab, `App.tsx`, `CallScreen` route). |
| `src/components/login/{AppCredentials,SampleUser,Skeleton}.tsx` | 36,038 | Registered behind `{__DEV__ && ...}` in `RootStackNavigator.tsx:107-118`. **Metro does not tree-shake `__DEV__` branches out of the graph** - all three are present in the release source map and contribute 12,945 minified bytes to the shipped bundle. See Phase 3. |

### Measured bundle / APK contribution

| Bucket | Minified JS | Notes |
|---|---:|---|
| Dead app-side JS (Tier A + Tier B screens / icons / helpers) | **0 / 100,288** | Tier A is already absent from the bundle; Tier B is not. |
| CometChat UIKit feature modules reachable **only** from Tier B screens (`CometChatMessageList`, `CometChatCompactMessageComposer`, `extensions`, `CometChatMessageComposer`, `CometChatSearch`, `CometChatConversations`, `CometChatGroupMembers`, `CometChatNotificationFeed`, `CometChatPinnedMessages`, `CometChatAIAssistantChatHistory`, `CometChatMessageHeader`, `CometChatSavedMessages`, `CometChatGroups`, `CometChatUsers`, `CometChatMessageInformation`, `CometChatRichTextEditor`) | 404,297 | Conservative: `CometChatThreadHeader` (3,834 B) excluded because `ThreadView` is kept. |
| `react-native-vision-camera` (29 modules) - sole consumer is dead `qr_screen.tsx` | 29,511 | Also drops CameraX / ML-Kit **native** libs (not measured here). |
| **Total minified JS** | **534,096** | **10.1 % of the 5,284,113-byte minified bundle.** |
| **Hermes bytecode in `index.android.bundle`** (7,389,644 B, x1.398) | **~ 746,786 B** | **~ 10.1 % of the JS shipped in the APK.** |
| Raster assets dropped from the APK (`cometchat_sync_img.png` 165,611 + 5 hero PNGs 57,573) | 223,184 | Confirmed present in `android/app/build/generated/res/createBundleReleaseJsAndAssets/drawable-mdpi/`. |
| **Total APK saving** | **~ 969,970 B (~948 KB)** | vs. the shipped `synomilo-v1.0.6-release.apk` at 70,416,066 B -> **~ 1.4 %**. |

> **Scale factor:** 7,389,644 (Hermes) / 5,284,113 (attributed minified) = **1.398**. The minified figure is derived by decoding the VLQ `mappings` of the release source map and attributing each generated span to its originating module - it is measured, not estimated.

---

## Duplicated features

Every chat / group / call feature is implemented twice: once against the **CometChat UIKit** (old) and once against **Convex** (new). The old one is dead in every row.

| Feature | Old impl (UIKit) | New impl (Convex) | Live | Action |
|---|---|---|---|---|
| Conversation list | `conversations/screens/Conversations.tsx` (wraps `CometChatConversations`) | `convex/ConversationsList.tsx` | **Convex** | Delete old. |
| Message list / chat | `conversations/screens/Messages.tsx` (wraps `CometChatMessageList`) - **already unreferenced** | `convex/ChatScreen.tsx` | **Convex** | Delete old (0 risk, no importers). |
| Thread view | `conversations/screens/ThreadView.tsx` (wraps `CometChatMessageList` with `parentMessageId`) | *(none - Convex chat has flat replies only)* | **Old** | **Port or fix first. Do not delete.** |
| Call history list | *(none)* | `calls/Calls.tsx` (Convex) | **Convex** | Single impl already. |
| Call detail (timeline + participants + recordings) | `calls/CallDetails.tsx` + `CallHistory` + `CallParticipants` + `CallRecordings` + `CallLogDetailHeader` + `CallDetailHelper` | *(none - the Convex `Calls.tsx` is a flat call-back list)* | **Old but unreachable** | Delete, but note the **lost behaviour**: per-session call detail, participant list and **call-recording download** (via `NativeModules.FileManager`) exist nowhere in the Convex stack. |
| Group list + create group | `groups/Groups.tsx` + `groups/GroupHelper.tsx` (wraps `CometChatGroups`) | `convex/GroupsList.tsx` (create-group modal, member picker, emoji, avatar upload) | **Convex** | Delete old. |
| Group info / management | `GroupInfo.tsx` + `AddMember` + `BannedMember` + `ViewMembers` + `TransferOwnership` + `GroupListeners` | `convex/ChatInfoScreen.tsx` (mute, rename, avatar upload, add/remove member, leave, delete-group, owner chip, shared-content tabs) | **Convex** | Delete old **after** porting: **banned-members list**, **promote/demote (transfer ownership)**, **kick-with-reason**, **real-time group member/kick listeners**. |
| User info | `UserInfo.tsx` (block/unblock, delete conversation, audio + video call buttons) | `convex/ContactInfoScreen.tsx` (call button, link to `ChatInfo`) | **Convex** | Delete old **after** porting: **block / unblock user**. |
| Users list | `users/Users.tsx` (`CometChatUsers`) | `convex/UsersList.tsx` | **Convex** | Delete old. Also remove the **stack** route named `Users` - it collides with the tab route of the same name. |
| AI Agents list | `AIAgent/AIAgents.tsx` (`CometChatUsers` with an agents request-builder) | *(none)* | **Old but unreachable** | Delete. Feature is dropped; nothing links to it. |
| Saved messages | `SavedMessages.tsx` (`CometChatSavedMessages`) | *(none)* | **Old but unreachable** | Delete. Feature is dropped. |
| Pinned messages | `PinnedMessages.tsx` (`CometChatPinnedMessages`) | *(none)* | **Old but unreachable** | Delete. Feature is dropped. |
| In-app message search | `SearchMessages.tsx` | *(none)* | **Old but unreachable** | Delete. Feature is dropped. |
| QR / builder-config scanner | `qr_screen.tsx` (`react-native-vision-camera`) | *(none)* | **Old but unreachable** | Delete **and** drop `react-native-vision-camera` from `package.json` - that is where the 29.5 KB of JS *and* the CameraX native weight come from. |
| Theme | `src/theme/paperTheme.ts` + `src/theme/dynamicTheme.ts` + `src/utils/themeTypography.ts` (react-native-paper MD3 + native `DynamicColor` module) | CometChat `CometChatThemeProvider` in `App.tsx` | **Both** | Keep both. Note the Convex screens read `useTheme()` from the **UIKit**, not from Paper - see Phase 5.3. |
| i18n | `CometChatI18nProvider` + `getCometChatTranslation()` / `useCometChatTranslation` | Hard-coded English literals in every `src/components/convex/*` screen | **UIKit only** | Keep. Note: **there is no i18n on the Convex screens at all** - a product gap, not dead code. |
| Avatars | `sampleData` hero PNGs in `utils/helper.ts` | Convex `initialsFor(...)` in every screen | **Convex (runtime)** / hero PNGs dead | Delete `sampleData` (Phase 3.2). |
| Call icons | `assets/icons/{Call,CallFill,VideoCam}.tsx` | `components/calls/icons/*` (17 files) | **Neither** (only dead consumers) | Delete both sets - `Calls.tsx`, `ChatScreen.tsx` and `WebRTCCallScreen.tsx` use `MaterialDesignIcons` string names instead. |

**Behaviour that would be lost on a naive delete-and-ship** (ranked by user impact):

1. **Call recordings** (`CallRecordings.tsx`) - nowhere else.
2. **Block / unblock user** (`UserInfo.tsx`) - the Convex schema has no block concept.
3. **Banned members, kick-with-reason, promote/demote, transfer ownership** (`BannedMember` / `TransferOwnership` / `GroupListeners`) - `ChatInfoScreen` has add / remove / leave / delete only.
4. **Deep-link from a CometChat push notification** - already broken (see below); deleting `ThreadView` would make it worse.
5. **Saved messages, pinned messages, in-chat search, AI Agents, QR scanner** - genuinely dropped; confirm that is acceptable.

> **Latent bug found while tracing this.** `src/utils/helper.ts` is **live** (imported by `CometChatPushV2.ts`, called from `App.tsx`). On a CometChat push tap it does `StackActions.push(SCREEN_CONSTANTS.MESSAGES, { group })` or `{ user }` (lines 289 / 324-325). But the `Messages` route now renders `convex/ChatScreen.tsx`, which reads **only** `route.params.conversationId` (line 244) - so it receives `undefined` and opens an empty chat. The same path then pushes the legacy `ThreadView`. **Tapping a CometChat chat notification is broken today.** Fixing this is Phase 5.1 and must land **before** `ThreadView` can be deleted.

---

## Unused icons

`src/assets/icons/**` = 30 `.tsx` + 14 raster. `src/components/calls/icons/**` = 17 `.tsx` (16 glyphs + 1 barrel). **61 icon files, 334,790 bytes.**

### Strictly unused - zero references anywhere (9 files, 59,109 bytes)

| File | Bytes |
|---|---:|
| `src/assets/icons/Info.tsx` | 1,195 |
| `src/assets/icons/CallFill.tsx` | 1,021 |
| `src/assets/icons/Chat.tsx` | 1,114 |
| `src/assets/icons/Chatfill.tsx` | 1,317 |
| `src/assets/icons/GroupFill.tsx` | 1,452 |
| `src/assets/icons/Person.tsx` | 1,017 |
| `src/assets/icons/PersonFill.tsx` | 1,098 |
| `src/assets/icons/bug.png` | 31,076 |
| `src/assets/icons/google.png` | 19,819 |
| **Subtotal** | **59,109** |

### Case-differing / geometric duplicates (proved by SHA-256 + SVG path-data hashing)

| Pair | Bytes each | Note |
|---|---:|---|
| `Info.tsx` vs `InfoIcon.tsx` | 1,195 / 1,195 | **Byte-identical.** |
| `Call.tsx` vs `calls/icons/call.tsx` | 900 / 900 | **Byte-identical.** |
| `CallFill.tsx` vs `calls/icons/call-fill.tsx` | 1,021 / 1,021 | **Byte-identical.** |

The remaining "smell" pairs are geometric near-duplicates produced by the same Figma export (identical `Mask/Path/G` filled-glyph scaffold and identical `Path fill='#D9D9D9' d='M0 0h24v24H0z'` mask): `Person` / `PersonFill`, `Chat` / `Chatfill`, `Group` / `GroupFill`, `Call` / `CallFill`, `Info` / `InfoIcon`. Because the fill variants have no importer, **the entire fill half of every pair is dead** - the live half is whichever the outline screen imports.

### Used only by dead code - 43 files, 206,076 bytes

- **`src/components/calls/icons/**` - all 17 (16,896 B).** The barrel `index.tsx` exports 16 glyphs; only **4** are ever imported, and all 4 by dead files (`CallMade`, `CallMissedOutgoingFill`, `CallReceived` <- `CallDetailHelper.tsx`; `PlayArrow` <- `CallRecordings.tsx`). The other **12 glyphs are unused even inside the dead stack** - they are un-referenced exports of a barrel that only dead code imports. This is the most self-contained deletion in the repo.
- **`src/assets/icons/**` - 20 files (23,569 B).** Listed in the Tier B table above.
- **`cometchat_sync_img.png` - 165,611 B.** Sole consumer is dead `qr_screen.tsx`.

### Live-imported but runtime-dev-only - 5 files, 57,573 bytes

`ironman.png`, `captainamerica.png`, `spiderman.png`, `wolverine.png`, `cyclops.png` are statically imported at the **top level of the live module** `src/utils/helper.ts` (lines 2-6), solely to build `export const sampleData`, which is consumed **only** by `src/components/login/SampleUser.tsx:143` - a screen registered behind `{__DEV__ && ...}`. Because the imports are unconditional ESM at module scope, **Metro bundles all five PNGs into every release APK** (confirmed: `drawable-mdpi/src_assets_icons_{ironman,captainamerica,spiderman,wolverine,cyclops}.png`, 56.3 KB total). 56 KB of superhero avatars shipping to production users.

### Icon totals

| Bucket | Files | Bytes |
|---|---:|---:|
| Strictly unused (zero references) | 9 | 59,109 |
| Used only by dead code | 43 | 206,076 |
| **Provably dead / zero-live-usage total** | **47** | **265,185** |
| Live-imported, dev-only at runtime | 5 | 57,573 |
| **All removable** | **52** | **322,758** |
| Live icons (kept) | 5 | 11,847 |

---

## Complexity hotspots

Top 15 by line count (`src/`, `App.tsx`, `convex/`, excluding generated files). "Minified" = measured contribution to the release bundle.

| # | File | Lines | Bytes | Minified in APK | What is in it | Verdict |
|---:|---|---:|---:|---:|---|---|
| 1 | `src/components/convex/ChatScreen.tsx` | **2,156** | 63,780 | 24,004 | The entire chat surface: message list + day separators, composer, reply preview, 6-emoji reaction picker with popover animation, long-press action sheet (delete/info), attachment sheet (`react-native-image-picker` + `@react-native-documents/picker`), optimistic pending-message queue, inline video playback, image full-screen viewer, read receipts, throttled typing indicator, forward, quick call buttons, dayjs formatting. | **God-component. 1.4x the next-largest file, 4.5 % of the whole JS bundle by itself.** Split into `useChatComposer`, `MessageRow`, `AttachmentSheet`, `ReactionPicker`, `useTypingIndicator`. |
| 2 | `src/components/convex/ChatInfoScreen.tsx` | 720 | 30,624 | 16,594 | Chat/group info: 3 shared-content tabs (photos/files/links), mute toggle, add/remove member sheet, rename, avatar upload + pending-upload polling, leave group, delete group, owner chip, snackbar - all in one function body with ~30 `useState`. | **God-component.** Split into `SharedContentTabs`, `MemberSheet`, `DangerZone`, `useGroupAvatarUpload`. |
| 3 | `src/components/convex/ProfileScreen.tsx` | 607 | 19,045 | 8,444 | Profile view, avatar upload, display-name edit, link to Settings, sign-out confirm dialog. **Duplicates the sign-out flow already implemented in `SettingsScreen.tsx`.** | Split; fold the duplicate sign-out into one shared component. |
| 4 | `convex/conversations.ts` | 505 | 15,551 | n/a (server) | Every conversation query/mutation: list, get, createDM, createGroup, add/removeMembers, rename, leave, delete, mute, markRead, typing, sharedContent. | Server god-file. Split into `conversations.ts` + `membership.ts` + `sharedContent.ts`. Lower priority than the UI. |
| 5 | `src/components/conversations/screens/GroupInfo.tsx` *(dead)* | 506 | 18,345 | 7,971 | UIKit group management: owner actions, leave, add/ban/view members, transfer ownership, group event listeners. | **Delete** (Phase 1/2) after porting banned / kick / promote. |
| 6 | `App.tsx` | 529 | 18,129 | 7,840 | Nine `useEffect`s in one component: UIKit init, CometChat session keep-alive, FCM registration + tap routing, notification channels + foreground handler, pending-call routing on `AppState`, notifee foreground actions, `@cometchat/push-notifications` setup, CometChat call listener, card-message action dispatcher, battery-optimisation prompt. | **God-component.** Extract `useCallLifecycle`, `usePushRegistration`, `useBatteryPrompt`, `useCardActions` into `src/notifications/`. |
| 7 | `src/components/login/SampleUser.tsx` *(dev-only)* | 516 | 15,995 | 5,676 | Dev "pick a sample user" grid fed by `helper.ts::sampleData` (the 5 hero PNGs), with a 3-second fake skeleton. | Gate behind a real dev menu or delete (Phase 3). |
| 8 | `src/components/calls/WebRTCCallScreen.tsx` | 494 | 14,725 | 7,279 | Full WebRTC call: `RTCPeerConnection` lifecycle, ICE candidate buffering, offer/answer, remote + local video tracks, mute/speaker/video toggle, call timer, ringback sound, Convex signalling consume loop. | Extract a `useCallSession()` hook - the component body should be ~120 lines of JSX. |
| 9 | `src/components/login/AppCredentials.tsx` *(dev-only)* | 470 | 15,784 | 5,221 | Dev-only CometChat credential form: app id / auth key / region inputs, region flag picker (`US/EU/India` PNGs), light/dark preview. | Delete (Phase 3); ships 5.2 KB for a screen users never see. |
| 10 | `src/components/groups/GroupHelper.tsx` *(dead)* | 438 | 14,395 | 5,995 | UIKit group app-bar options + create-group bottom sheet + styles. | **Delete** (Phase 1/2). |
| 11 | `src/components/convex/GroupsList.tsx` | 437 | 12,360 | 4,983 | Group list + create-group modal (name, member picker, emoji, avatar upload). | Acceptable. Consider extracting the create-group modal. |
| 12 | `src/components/convex/ConversationsList.tsx` | 433 | 11,654 | 4,703 | Chat list, unread badges, typing preview, leave dialog, profile shortcut, groups FAB, ~150 lines of `StyleSheet`. | Acceptable. |
| 13 | `src/components/calls/CallDetails.tsx` *(dead)* | 429 | 14,977 | 5,994 | UIKit call detail with 3 tabs (history / participants / recordings). | **Delete** (Phase 1/2) - note the lost recordings. |
| 14 | `src/components/conversations/screens/UserInfo.tsx` *(dead)* | 413 | 15,227 | 7,107 | UIKit user info: block/unblock, delete conversation, audio/video call, permission gating. | **Delete** (Phase 1/2) after porting block. |
| 15 | `src/components/conversations/screens/ThreadView.tsx` *(live but legacy)* | 397 | 13,216 | 5,199 | UIKit threaded message list + real-time group-kicked/ban detection. | **Fix or replace** (Phase 5.2). Currently reachable only from a CometChat push tap, and it renders the wrong data model. |

**Honourable mentions:** `src/config/store.ts` (201 lines, 13 hand-written interfaces that belong in a `.d.ts`); `src/utils/helper.ts` (305 lines mixing CometChat last-seen / block / leaveGroup helpers with `navigateToConversation` and a deepClone utility); `src/updater/UpdateChecker.tsx` (248 lines, polls Convex **every 60 s** forever - add exponential backoff); `src/navigation/types.ts` (95 lines still declaring param types for **15 routes being deleted**).

---

## Stray artifacts

### Tracked in git - bloats every clone (confirmed with `git ls-files`)

| Path | Bytes | Sensitivity |
|---|---:|---|
| `screen1.png` ... `screen10.png` (10 files, repo root) | **678,004** | None, but scratch screenshots at the repo root. `.gitignore` has no rule for them. |
| `metro.log` (repo root) | 5,334 | **Leaks absolute developer paths.** Lines 61-62 contain `P:\Projects\cometchat-sample-app\node_modules\react-native-webrtc\node_modules\event-target-shim\...`. Also leaks the device fingerprint `CPH2421 - 11 - API 30` and the app id. `.gitignore` covers only `npm-debug.log` / `yarn-error.log` - **a bare `metro.log` is not matched.** |
| `cometchat_team_messanger.jks` (repo root) | 2,702 | **A committed third-party demo signing key.** `.gitignore` has `*.keystore` + `!debug.keystore`, which does **not** match `.jks`. |
| `android/app/cometchat_team_messanger.jks` | 2,702 | The same key, committed a second time. Dead - the release config uses `android/app/synomilo-release.keystore` + `android/keystore.properties`. |
| `android/app/debug.keystore` | 2,257 | Intentional RN-template debug key. Fine. |
| `.bundle/config` | 61 | Ruby bundler config; machine-specific, harmless. |
| `ios/GoogleService-Info.plist` | - | Contains the APNs/FCP sender ids and the Google App ID. Expected in a client app, but confirm it is the intended (non-restricted) file. |
| `ios/Resources/Fonts/*` **vs** `ios/SampleAppWithPushNotifications/Resources/Fonts/*` | **3,220,412 duplicated** | All 9 files are byte-identical (9/9 SHA-256 matches). A whole font set is committed twice. Android holds a third copy at `android/app/src/main/assets/fonts/`. |
| `android/app/src/main/assets/fonts/*` | 3,220,412 | Only `roboto_*` is selected (`src/config/config.json` -> `typography.font: "roboto"`). `inter_*` (2,049,600 B) and `times_new_roman_*` (1,016,880 B) ship for a font the app never selects - **~ 2.35 MB of dead weight in the APK.** Note `store.ts` hydrates the config from AsyncStorage, so a remote builder *could* switch the font. **Do not delete without pinning the font.** |

### Present on disk, correctly gitignored (confirmed via `git status --porcelain --ignored`)

`.gitignore` lines 84-88 already cover these:

- `build-install.log` (79,012 B) - leaks `C:\Users\<developer>\.gradle\caches\8.14.3\transforms\...` (developer home dir + local Gradle cache paths) and `P:\Projects\cometchat-sample-app\android\app\build\intermediates\cxx\...`.
- `release-build.log` (99,167 B) - the same developer-home Gradle-cache leak.
- `release-build-both.log` (106,942 B) - `P:\Projects\cometchat-sample-app\...` paths only.
- `.build-outputs/` - **55 files: 4 release APKs at 70.3-70.4 MB each (~281 MB) plus 51 screenshots**, including a 0-byte `release-4-login.png` (failed build) and a 1.0 MB `release-3-login.png`. Gitignored - correct - but ~281 MB of dead disk. Move it outside the repo.
- `.env.local` (232 B), `google-services.json` (679 B), `android/app/google-services.json`, `android/keystore.properties` (131 B), `android/app/synomilo-release.keystore` (2,748 B) - all correctly ignored (`.gitignore` lines 77-82).

### Credential sweep (results reported without values)

A regex sweep for `apikey|api_key|secret|password|passwd|token|credential|authkey|AIza...|sk-...|BEGIN ... PRIVATE KEY|storePassword|keyPassword|keystore` across all four logs returned **zero hits**. **No credentials are leaked in the logs.** What *is* leaked is developer identity and local filesystem layout: the Windows user directory `C:\Users\<developer>\.gradle\...` (username present in `build-install.log` and `release-build.log`), the repo root `P:\Projects\cometchat-sample-app`, and Gradle cache hashes.

Two real credential findings outside the logs:

1. **`src/utils/AppConstants.tsx` lines 6-7 hard-code a live CometChat App ID and Auth Key in source control.** (Values intentionally not reproduced here.) This is a CometChat client key by design, but it is a live credential in git history - rotate it if the repo is ever shared outside the team.
2. **`android/keystore.properties` holds `storePassword` and `keyPassword` in plaintext** (gitignored, present locally; injected from GitHub `secrets.KEYSTORE_PROPERTIES` in CI - that part is correct).

`.github/workflows/android-release.yml` handles secrets correctly: all credentials arrive via `secrets.*` and are written to gitignored paths at build time. `*.keystore` is ignored while `android/app/debug.keystore` is explicitly whitelisted - the intended policy. It simply missed `.jks`.

---

## Slimming plan

Ordered, reversible, and each phase independently shippable. **Every phase must be verified on a physical device** - `npm test` will not catch a regression (see *Test coverage verdict*).

Legend: **[NOW]** = provably dead, delete immediately | **[PORT]** = delete only after porting behaviour X | **[KEEP]** = not dead.

### Phase 0 - De-risk first (no deletions)

| # | What | Saving | Risk | How to verify nothing broke |
|---|---|---:|---|---|
| 0.1 | **[KEEP]** Write a 6-step manual smoke script and run it on the current build: login -> chats list -> open DM -> send text + image -> open ChatInfo (group) -> make a call -> receive a push. Record a screen recording. | 0 | none | This is the regression oracle for Phases 1-4. Without it nothing below is verifiable. |
| 0.2 | Fix `npm test`: add `transformIgnorePatterns` for `convex`, `@notifee`, `dayjs`, `@noble/hashes`, `@cometchat/*`, plus a `jest.setup.js` mocking `react-native-webrtc`, `@react-native-firebase/messaging`, `@notifee/react-native`, `react-native-vision-camera` and `NativeModules.Installer`. Replace the assert-free test with real assertions. | 0 | low | `npm test` must go from red/unknown to green **before** any deletion lands. |

### Phase 1 - Delete now, provably dead (zero behaviour change)

| # | What | Saving | Risk | How to verify nothing broke |
|---|---|---:|---|---|
| 1.1 | **Delete `src/components/conversations/screens/Messages.tsx`.** Zero importers; already absent from the release bundle. | 26,686 B repo / **0 B APK** | **none** | `npx tsc --noEmit`. Bundle size unchanged - proof it was dead. |
| 1.2 | **Delete the 9 strictly-unused icons** (`Info.tsx`, `CallFill.tsx`, `Chat.tsx`, `Chatfill.tsx`, `GroupFill.tsx`, `Person.tsx`, `PersonFill.tsx`, `bug.png`, `google.png`). | 59,109 B repo / 0 B APK | none | `npx tsc --noEmit`; `npx eslint src`. |
| 1.3 | **Delete `src/components/calls/icons/**` (all 17 files, 16,896 B).** Only dead code imports the barrel, and only 4 of the 16 glyphs are imported even there. | 16,896 B repo / **11,299 B minified** | none | `npx tsc --noEmit`; rebuild and confirm the JS bundle drops by ~16 KB. |
| 1.4 | **Delete the 20 `src/assets/icons/*.tsx` used only by dead screens** + `cometchat_sync_img.png` (165,611 B). | 189,180 B repo / **12,889 B minified + 161.7 KB drawable** | none | `npx tsc --noEmit`; confirm `drawable-mdpi/src_assets_icons_cometchat_sync_img.png` is gone from the merged assets. |
| 1.5 | **Untrack the repo junk:** `git rm --cached` + `.gitignore` additions for `metro.log`, `*.log`, `screen*.png`, `*.jks`, `.bundle/`. Delete `cometchat_team_messanger.jks` (both copies) and `screen1-10.png` from the working tree. | **688,802 B repo** | none (no code references any of them) | `git status` clean; `git ls-files \| grep -Ei 'jks\|\.log\|screen'` returns nothing. |
| 1.6 | Remove the duplicate `ios/Resources/Fonts/` set (keep whichever path `project.pbxproj` actually references - grep before removing). | **3,220,412 B repo** | low | `npx pod-install` / iOS build still links the fonts. |

**Phase 1 total: ~ 4,161,000 B off the clone, ~ 161,700 B off the APK.**

### Phase 2 - Delete nav-unreachable screens [NOW, with one port gate]

All of these exist in `RootStackNavigator.tsx` only as `<Stack.Screen>` registrations with no `navigate()` caller. Deleting a file **requires** deleting the matching `<Stack.Screen>` in the same commit.

| # | What | Saving | Risk | How to verify nothing broke |
|---|---|---:|---|---|
| 2.0 | **PORT GATE.** Decide on `block/unblock user`, `banned-members list`, `kick-with-reason`, `promote/demote`, `transfer ownership` and `group member/kick real-time events`. Each exists only in the old UIKit screens. Either add the Convex mutations + `ChatInfoScreen` UI (recommended - these are real product features), or accept the loss explicitly. | - | - | A product decision, not an engineering one. Block 2.5 on it. |
| 2.1 | **Delete the Conversations-list cluster:** `Conversations.tsx`, `AuthContext.tsx`, `TooltipMenu.tsx`; remove the `Conversation` route and the `CONVERSATION` constant. | 16,478 B repo | low | Smoke test 0.1. This also removes the UIKit **logout** entry point - the Convex `ProfileScreen` / `SettingsScreen` already have one. |
| 2.2 | **Delete the QR-scanner cluster:** `qr_screen.tsx`, `Flash.tsx`, `cometchat_sync_img.png`; remove the `QRScreen` route; **`npm uninstall react-native-vision-camera`** (drops ~29,511 B minified plus the CameraX / ML-Kit native weight). | ~ 181,000 B repo / **29,511 B minified + native libs** | medium | `npx tsc --noEmit`; `./gradlew assembleRelease` and compare APK size - expect a visible native-library drop. Remove `CAMERA` from `AndroidManifest.xml` if nothing else needs it. |
| 2.3 | **Delete the call-detail cluster:** `CallDetails.tsx`, `CallHistory.tsx`, `CallLogDetailHeader.tsx`, `CallParticipants.tsx`, `CallRecordings.tsx`, `CallDetailHelper.tsx`; remove the `CallDetails` route. | 45,734 B repo / **19,105 B minified** | low | Smoke test: the Calls tab still lists history and call-back still works. **Accepted loss: call recordings.** |
| 2.4 | **Delete the AI-Agents / old-users cluster:** `AIAgent/AIAgents.tsx`, `users/Users.tsx`; remove the `AIAgents` route and the **stack** `Users` route (keep the tab `Users`). | 3,507 B repo / **3,850 B minified** | low | Smoke test: the Users tab still works; no stack route named `Users` remains. |
| 2.5 | **Delete the group-management cluster** (gated on 2.0): `GroupInfo.tsx`, `GroupInfoStyles.tsx`, `AddMember.tsx`, `AddMemberStyles.tsx`, `BannedMember.tsx`, `BannedMemberStyles.tsx`, `TransferOwnership.tsx`, `TransferOwnershipStyles.tsx`, `ViewMembers.tsx`, `GroupListeners.ts`, `groups/Groups.tsx`, `groups/GroupHelper.tsx`, `groups/styles.ts`, `CreateConversation.tsx`, `SearchMessages.tsx`, `SavedMessages.tsx`, `PinnedMessages.tsx`; remove 9 routes. | 152,306 B repo / **53,145 B minified** | **medium** | Smoke test: create a group (Convex `GroupsList`), open `ChatInfo`, mute / rename / add member / remove member / leave. |
| 2.6 | **[KEEP]** `ThreadView.tsx`, `useGroupMemberStatus.ts`, `CommonUtils.ts`, `helper.ts`, `OngoingCallScreen.tsx`, `src/components/calls/{Calls,IncomingCallOverlay,WebRTCCallScreen}.tsx` - all live. | - | - | Do not touch. |

**Phase 2 total: ~ 480,000 B off the clone + ~ 117,500 B minified JS (~164,000 B of Hermes bytecode) plus the vision-camera native weight.**

### Phase 3 - Dev-only and demo leftovers [NOW]

| # | What | Saving | Risk | How to verify nothing broke |
|---|---|---:|---|---|
| 3.1 | **Delete `src/components/login/{AppCredentials,SampleUser,Skeleton}.tsx`** and the `{__DEV__ && ...}` block in `RootStackNavigator.tsx:107-118`. These **are in the release bundle** (12,945 B minified) because Metro does not shake `__DEV__` branches. If a dev credential screen is still wanted, re-introduce it behind a dynamic `import()` so it never enters the release graph. | 36,038 B repo / **12,945 B minified** | low | Confirm no release-critical path depends on `SCREEN_CONSTANTS.APP_CRED`. Note `SampleUser` is the only consumer of `helper.ts::sampleData`. |
| 3.2 | **Delete `sampleData` and the 5 hero-PNG imports from `src/utils/helper.ts` (lines 2-6 and 190-201).** They ship 5 avatar PNGs into every release APK for a dev-only screen. | 57,573 B repo / **56.3 KB drawable** | none | `npx tsc --noEmit`; confirm the 5 `drawable-mdpi/src_assets_icons_*.png` files vanish. Also drop `Dark/Light/EU/US/India.png` if 3.1 landed. |
| 3.3 | **Delete `src/assets/sounds/ringback.wav`** *only if* `WebRTCCallScreen.tsx:309` no longer plays it. It is a 264,644 B raw asset in the APK. | up to 264,644 B APK | medium | Actually listen to an incoming call. Do not delete blind. |
| 3.4 | Clear `.build-outputs/` (281 MB of APKs + screenshots) and relocate it outside the repo. | 281 MB disk | none | `.gitignore` already covers it. |

### Phase 4 - Font bloat (needs a product decision)

| # | What | Saving | Risk | How to verify nothing broke |
|---|---|---:|---|---|
| 4.1 | `src/config/config.json` sets `typography.font: "roboto"`, but all three families (inter / roboto / times = 3,209,834 B) are bundled. `store.ts` hydrates the config from AsyncStorage, which a remote *builder* could change. **Either** pin the font to one family and delete the other 6 files from `android/app/src/main/assets/fonts/` and `ios/**/Resources/Fonts/`, **or** leave them. | up to **2,351,292 B APK** (2.35 MB - the single biggest asset win in this document) | **medium** - removing a family breaks rendering if a builder config selects it | Confirm with the builder owner whether `typography.font` is still remotely switchable. If not, pin `roboto` in `themeTypography.ts` and shrink `FONT_MAP` to one entry. |

### Phase 5 - Fix the two live bugs first, then unlock the biggest win

| # | What | Saving | Risk | How to verify nothing broke |
|---|---|---:|---|---|
| 5.1 | **Fix `src/utils/helper.ts` `navigateToConversation`.** It pushes `SCREEN_CONSTANTS.MESSAGES` with `{ group }` / `{ user }`, but the `Messages` route now renders `convex/ChatScreen.tsx`, which reads only `conversationId`. Tapping a CometChat chat notification opens an empty chat today. Rewrite it to resolve the CometChat conversation to a Convex `conversationId` and push `{ conversationId, title }`. | 0 (correctness) | medium | Tap a chat push on a cold-started app; the right conversation opens with its history. |
| 5.2 | **Fix or replace `ThreadView.tsx`.** Once 5.1 no longer needs it, port thread-reply navigation into `ChatScreen` (`api.messages.list` already accepts a parent filter) and delete `ThreadView.tsx` + `useGroupMemberStatus.ts` + `CommonUtils.ts` + the `CometChatThreadHeader` dependency. | 18,709 B repo / **+3,834 B minified** | medium | Tap a thread-reply push; the thread opens inside the Convex chat. |
| 5.3 | **[KEEP for now]** The live surface of `@cometchat/chat-uikit-react-native` is only: `CometChatUIKit.init/login/logout/createUser` (`App.tsx`, `auth/cometchatSession.ts`), `CometChatThemeProvider`, `CometChatI18nProvider`, `useTheme`, `Icon`, `getCometChatTranslation`, `CometChatUIEventHandler`, `CometChatIncomingCall`, `CometChatOngoingCall`. **Retiring it entirely** - moving to `useTheme` from `react-native-paper` (which every Convex screen already imports) and dropping `@cometchat/calls-sdk-react-native` + `react-native-callstats`, since WebRTC is already hand-rolled in `WebRTCCallScreen.tsx` - would save **2,371,150 B minified ~= 3,314,868 B of Hermes bytecode (~4.7 % of the APK)** plus the Calls SDK native libs. | **~ 3.3 MB APK** | **high** - a real project, not a cleanup | Only after Phases 1-4 ship and the manual smoke suite is solid. `react-native-webrtc` must stay (it is the live media stack). |

### Phase 6 - Cleanup, non-code

| # | What | Saving | Risk | How to verify nothing broke |
|---|---|---:|---|---|
| 6.1 | Add `*.log`, `screen*.png`, `*.jks`, `.bundle/` to `.gitignore`; drop the now-dead `SCREEN_CONSTANTS` entries (`CONVERSATION`, `CREATE_CONVERSATION`, `SEARCH_MESSAGES`, `SAVED_MESSAGES`, `PINNED_MESSAGES`, `USER_INFO`, `GROUP_INFO`, `ADD_MEMBER`, `TRANSFER_OWNERSHIP`, `BANNED_MEMBER`, `VIEW_MEMBER`, `QR_SCREEN`, `AI_AGENTS`, `CALL_DETAILS`) and their entries in `src/navigation/types.ts`. | - | none | `npx tsc --noEmit`. `types.ts` currently declares param types for 15 routes that will no longer exist - a standing trap for the next developer. |
| 6.2 | Rotate the CometChat App ID / Auth Key hard-coded in `src/utils/AppConstants.tsx`; move them to a gitignored config. Confirm `cometchat_team_messanger.jks` was never used to sign anything shipped. | - | low | - |
| 6.3 | Lazy-load heavy media deps: replace the top-level `import` of `react-native-video`, `react-native-image-picker` and `@react-native-documents/picker` in `ChatScreen.tsx` with `import()` inside the handlers so Metro can split them out of the initial bundle. | not measured | low | Measure `index.android.bundle` before/after. |

### Cumulative projection

| Phase | Clone (bytes) | Release APK (bytes) |
|---|---:|---:|
| Baseline | - | **70,416,066** |
| Phase 1 | -4,161,000 | -161,700 |
| Phase 2 | -480,000 | -164,000 + vision-camera native libs |
| Phase 3 | -93,611 | -56,300 drawable (+ up to -264,644 if the ringback goes) |
| **Phases 1-4 combined** | **-7,085,903** | **~ -970,000 to -1,234,000 (-1.4 % ... -1.8 %)** |
| Phase 5.3 (optional) | - | **~ -3,314,868 more (-4.7 %) + native Calls SDK libs** |

---

## Test coverage verdict

**`npm test` is meaningless. It provides zero regression protection for any change in this document.**

`__tests__/App.test.tsx` is **13 lines / 267 bytes** and contains exactly one test:

```tsx
test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
```

**What it actually asserts: nothing.** There is no `expect(...)`, no snapshot, no assertion of any kind. At best it is a smoke test that fails if the module graph throws during import or first render. It would equally "pass" for a blank `<View/>`.

Whether it even *reaches* that assertion is doubtful:

- `jest.config.js` is three lines: `{ preset: 'react-native' }`. No `setupFiles`, no `setupFilesAfterEach`, no `moduleNameMapper`, no mocks.
- `App.tsx` at import time pulls in `convex/react`, `@notifee/react-native`, `@react-native-firebase/messaging`, `@cometchat/push-notifications-react-native`, `@cometchat/calls-sdk-react-native`, `react-native-webrtc`, `react-native-video`, `react-native-vision-camera`, `AsyncStorage` and `NativeModules.Installer`. **None are mocked.**
- There is no `transformIgnorePatterns`, so ESM-only packages (`convex`, `@notifee/react-native`, `dayjs`, `@noble/hashes`) will fail to transform.
- `AppInner`'s first `useEffect` calls `CometChatUIKit.init(...)`, which reaches a native module; `SessionProvider` / `cometchatSession` hit `AsyncStorage`. All unmocked.
- `__tests__/` contains **exactly one file**. There is **no test anywhere** for:
  - **`convex/`** - all 11 backend modules (auth, users, conversations, messages, reactions, files, calls, push, updates, schema, helpers). **Zero.**
  - **Calls** - `WebRTCCallScreen.tsx` (494 lines of WebRTC), `IncomingCallOverlay.tsx`, `Calls.tsx`, `callNotifications.ts`. **Zero.**
  - **Auth** - `SessionProvider.tsx`, `Login.tsx`, `SignUp.tsx`, `convex/auth.ts`. **Zero.**
  - **Push** - `notifications/push.ts`, `notifications/background.ts`, `utils/CometChatPushV2.ts`. **Zero.** (This is the exact path carrying the latent bug above - and it is untested.)
  - **The Convex layer** - no component under `src/components/convex/` has a single test.

**Consequences for this slimming project:**

1. Every deletion in Phases 1-4 must be validated by a **hand-written device smoke script** (Phase 0.1). There is no automated safety net.
2. Ship deletions **one phase per PR**, not as one big bang. Phases 1 and 3 are safe to batch; Phase 2 needs the port gate.
3. Fix `npm test` (Phase 0.2) *before* Phase 2, so at least "the app still mounts and every registered route still resolves" is machine-checked. Even a smoke test that walks `RootStackParamList` would have caught the dead-route problem this audit found.
4. Do **not** treat a green `npm test` as evidence that anything works. It currently would not detect a broken import.
