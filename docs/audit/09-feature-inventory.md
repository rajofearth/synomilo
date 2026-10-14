# 09 — Feature Inventory (synomiló RN 0.81.4 → Next.js parity requirements)

Read-only audit. Source of truth is the code, not the previous dev's docs.
Repo: `P:\Projects\cometchat-sample-app` · commit `ca7587c` · Convex deployment `glad-capybara-533`.

**Status legend**

| Status | Meaning |
|---|---|
| `LIVE` | Reachable from the running app through the registered route graph and wired to Convex. |
| `PARTIAL` | Reachable, but the implementation is incomplete or the backend does not honour it. |
| `DEAD-CODE` | Code exists and compiles but nothing in the live navigation graph can reach it. |
| `NOT-BUILT` | Never implemented — no code, no Convex function. |

**Web parity verdict legend**

| Verdict | Meaning |
|---|---|
| `NATIVE-DIRECT` | Browser has a first-class equivalent (`<input type=file>`, Clipboard API, Web Share, `getUserMedia`, CSS). Port is mechanical. |
| `WEB-HARD` | Browser is possible but materially more work: WebRTC call UI, Web Push + service worker, Notification actions, visibility-driven call state, secure token storage, dynamic colour approximation. |
| `MOBILE-ONLY` | No browser equivalent: battery-optimisation prompt, APK sideload updater, lock-screen call UI, contact sync, device metadata. |

---

## Route graph

### Root stack — `src/navigation/RootStackNavigator.tsx`

`Stack.Navigator` `initialRouteName` is computed from auth state (`RootStackNavigator.tsx:83-91`):

```
isLoggedIn            → "BottomTabNavigator"
!isLoggedIn && __DEV__ && hasCredentials → "SampleUser"
!isLoggedIn && __DEV__ && !hasCredentials → "AppCredentials"
!isLoggedIn && !__DEV__                   → "Login"
```

All stack screens use `headerShown: false`, `gestureEnabled: true`, `animation: 'slide_from_right'`
(`CallScreen` overrides to `'fade'`) — `RootStackNavigator.tsx:92-96, 191-195`.

| # | Route name | Component | File | Params (from `types.ts`) | Reachable? |
|---|---|---|---|---|---|
| 1 | `Login` | `Login` | `components/login/Login.tsx` | — | ✅ release |
| 2 | `SignUp` | `SignUp` | `components/login/SignUp.tsx` | — | ✅ from Login |
| 3 | `AppCredentials` | `AppCredentials` | `components/login/AppCredentials.tsx` | — | ⚠️ `__DEV__` only (`:107-118`) |
| 4 | `SampleUser` | `SampleUser` | `components/login/SampleUser.tsx` | — | ⚠️ `__DEV__` only |
| 5 | `BottomTabNavigator` | `BottomTabNavigator` | `navigation/BottomTabNavigator.tsx` | `NavigatorScreenParams<BottomTabParamList>` | ✅ |
| 6 | `Users` | `Users` (legacy UIKit) | `components/users/Users.tsx` | — | ❌ dead (nothing navigates to the *stack* `Users`) |
| 7 | `Groups` | `GroupsList` (Convex) | `components/convex/GroupsList.tsx` | — | ✅ from Chats-tab FAB |
| 8 | `AIAgents` | `AIAgents` | `components/AIAgent/AIAgents.tsx` | — | ❌ dead |
| 9 | `SavedMessages` | `SavedMessages` | `components/conversations/screens/SavedMessages.tsx` | — | ❌ dead |
| 10 | `PinnedMessages` | `PinnedMessages` | `components/conversations/screens/PinnedMessages.tsx` | `{user?, group?}` | ❌ dead |
| 11 | `Conversation` | `Conversations` (legacy UIKit list) | `components/conversations/screens/Conversations.tsx` | — | ❌ dead |
| 12 | `CreateConversation` | `CreateConversation` | `components/conversations/screens/CreateConversation.tsx` | — | ❌ dead |
| 13 | **`Messages`** | **`ChatScreen`** (Convex) | `components/convex/ChatScreen.tsx` | `{conversationId, title?}` (+ 8 legacy optional params) | ✅ **primary chat** |
| 14 | `ThreadView` | `ThreadView` | `components/conversations/screens/ThreadView.tsx` | `{message, user?, group?, highlightMessageId?}` | ❌ dead |
| 15 | `SearchMessages` | `SearchMessages` | `components/conversations/screens/SearchMessages.tsx` | `{user?, group?}` | ❌ dead |
| 16 | `ForwardMessage` | `ForwardMessageScreen` | `components/convex/ForwardMessageScreen.tsx` | `{message: {_id, kind, body, fileName, mimeType, size, storageId, sender:{displayName}}}` | ✅ from chat + viewer |
| 17 | `ChatInfo` | `ChatInfoScreen` | `components/convex/ChatInfoScreen.tsx` | `{conversationId, title?}` | ✅ group only |
| 18 | `ContactInfo` | `ContactInfoScreen` | `components/convex/ContactInfoScreen.tsx` | `{conversationId}` | ✅ DM only |
| 19 | `Profile` | `ProfileScreen` | `components/convex/ProfileScreen.tsx` | — | ✅ from Chats header avatar |
| 20 | `Settings` | `SettingsScreen` | `components/convex/SettingsScreen.tsx` | — | ✅ from Profile |
| 21 | `UserInfo` | `UserInfo` (legacy) | `components/conversations/screens/UserInfo.tsx` | `{user: CometChat.User}` | ❌ dead |
| 22 | `GroupInfo` | `GroupInfo` (legacy) | `components/conversations/screens/GroupInfo.tsx` | `{group: CometChat.Group}` | ❌ dead |
| 23 | `AddMember` | `AddMember` (legacy) | `components/conversations/screens/AddMember.tsx` | `{group}` | ❌ dead |
| 24 | `TransferOwnershipSection` | `TransferOwnership` (legacy) | `components/conversations/screens/TransferOwnership.tsx` | `{group}` | ❌ dead |
| 25 | `BannedMember` | `BannedMember` (legacy) | `components/conversations/screens/BannedMember.tsx` | `{group}` | ❌ dead |
| 26 | `ViewMembers` | `ViewMembers` (legacy) | `components/conversations/screens/ViewMembers.tsx` | `{group}` | ❌ dead |
| 27 | **`CallScreen`** | **`WebRTCCallScreen`** | `components/calls/WebRTCCallScreen.tsx` | `{callId, type:'audio'\|'video', role:'caller'\|'callee', peerName}` | ✅ chat / contact / history / push / overlay |
| 28 | `OngoingCallScreen` | `OngoingCallScreen` (UIKit Calls SDK) | `components/conversations/screens/OngoingCallScreen.tsx` | `{sessionId, callType?} \| {call}` | ❌ dead in practice |
| 29 | `CallLogs` | `Calls` (duplicate of tab) | `components/calls/Calls.tsx` | — | ❌ dead duplicate |
| 30 | `CallDetails` | `CallDetails` (legacy) | `components/calls/CallDetails.tsx` | `{call}` | ❌ dead |
| 31 | `QRScreen` | `QRScreen` | `components/conversations/screens/qr_screen.tsx` | — | ❌ dead |

**Note on route 13.** `components/conversations/screens/Messages.tsx` (the full CometChat UIKit chat)
is **not imported by the navigator at all** — the `Messages` route resolves to the Convex
`ChatScreen`. It is orphaned source.

### Bottom tabs — `src/navigation/BottomTabNavigator.tsx`

`config.json` declares four tabs (`["chats","calls","users","groups"]`) but
`BottomTabNavigator.tsx:99` **filters out `groups`**, and `TAB_COMPONENTS` (`:84-91`) has no entry
for it. Result: **3 visible tabs**. `Groups` is reachable only via the FAB on the Chats tab.

| Tab label (`SCREEN_CONSTANTS`) | Component | File | Reachable |
|---|---|---|---|
| `Chats` | `ConversationsList` | `components/convex/ConversationsList.tsx` | ✅ |
| `Calls` | `Calls` | `components/calls/Calls.tsx` | ✅ |
| `Users` | `UsersList` | `components/convex/UsersList.tsx` | ✅ |

Tab chrome: M3 expressive pill indicator (56×32, radius 16) animated with
`Animated.spring(stiffness 380, damping 26, mass 0.9)` — `:45-82`; bar height 76, top radii 24
— `:159-162`; bar hides while the keyboard is visible — `:97, 106`. Labels are
`t(route.name.toUpperCase())` from the CometChat i18n bundle — `:136`.

### Live navigation edges

```
[App shell]  → Messages (push tap)                     App.tsx:186-192
             → CallScreen (call push tap)               App.tsx:194-204
             → CallScreen (pending-call handoff)        App.tsx:234-267
             → CallScreen (notifee fg action)           App.tsx:287-302
[Chats tab]  → Messages | Profile | Groups             ConversationsList.tsx:69,125,276
[Messages]   → ForwardMessage | ChatInfo | ContactInfo | CallScreen
              ChatScreen.tsx:658,712,729
[ContactInfo]→ CallScreen | ChatInfo                    ContactInfoScreen.tsx:39,122
[Profile]    → Settings                                 ProfileScreen.tsx:486
[Calls tab]  → CallScreen (call back)                   Calls.tsx:87
[Overlay]    → CallScreen (accept)                      IncomingCallOverlay.tsx:54
```

### Legacy navigation edges (all originate from dead screens)

```
Conversations.tsx:199,228,242,257,325  → SearchMessages, CreateConversation, AIAgents,
                                          SavedMessages, QRScreen
Messages.tsx:449,457,468,565,604        → GroupInfo, UserInfo, SearchMessages,
                                          PinnedMessages, ThreadView
GroupInfo.tsx:171,313,342,373          → TransferOwnershipSection, AddMember, ViewMembers,
                                          BannedMember
SavedMessages.tsx:68,81 / PinnedMessages.tsx:55,68 → ThreadView, Messages
helper.ts:226 (push thread)            → ThreadView
CometChatPushV2.ts:80                  → OngoingCallScreen
```

---

## Convex data-capability inventory

Deployment: `https://glad-capybara-533.convex.cloud` (`src/config/convexConfig.ts`).
Auth model: opaque bearer token in the `sessions` table; **every** query and mutation takes
`{ token }` and calls `requireUser` (`convex/lib/helpers.ts:9-31`), which also heartbeats
`session.lastSeenAt` every 30 s.

### Tables (`convex/schema.ts`)

| Table | Fields | Indices |
|---|---|---|
| `users` | `username, displayName, passwordHash, salt, avatarUrl?, pushToken?, createdAt` | `by_username` |
| `sessions` | `token, userId, createdAt, lastSeenAt` | `by_token`, `by_user` |
| `conversations` | `type:'dm'\|'group', name?, emoji?, avatarUrl?, dmKey?, createdBy, createdAt, updatedAt, lastMessageAt?, lastMessagePreview?, lastMessageSender?` | `by_dmKey`, `by_updatedAt` |
| `members` | `conversationId, userId, role:'owner'\|'member', joinedAt, lastReadAt, typingAt?, muted?` | `by_conversation`, `by_user`, `by_user_conversation` |
| `messages` | `conversationId, senderId, kind:'text'\|'image'\|'video'\|'audio'\|'file', body?, storageId?, fileName?, mimeType?, size?, replyToId?, forwardedFrom?, deletedAt?, createdAt` | `by_conversation_createdAt` |
| `reactions` | `messageId, userId, emoji, createdAt` | `by_message`, `by_message_user` |
| `calls` | `callerId, calleeId, type:'audio'\|'video', status:'ringing'\|'active'\|'rejected'\|'missed'\|'ended', createdAt, answeredAt?, endedAt?` | `by_callee_status`, `by_caller`, `by_callee` |
| `callSignals` | `callId, fromUserId, toUserId, kind:'offer'\|'answer'\|'ice', payload, createdAt` | `by_call_to` |
| `updateCache` | `version, storageId, size?, notes?, createdAt` | `by_version` |

There is **no** `sessions` cleanup, **no** message edit/pin/save table, **no** block/report table,
**no** message-receipts table, **no** thread (`parentMessageId`) concept, and **no** group-call table.

### `convex/auth.ts`

| Function | Kind | Signature | Notes |
|---|---|---|---|
| `register` | mutation | `{username, password, displayName}` | `/^[a-z0-9_.-]{3,32}$/`, password ≥ 6, name ≥ 2; PBKDF2-SHA256 210 000 iters (WebCrypto) or 20 000 (fallback); creates session |
| `login` | mutation | `{username, password}` | constant-ish compare of hex hash; creates session |
| `logout` | mutation | `{token}` | deletes the session row |
| `me` | query | `{token}` | resolves session → `publicUser`, `null` when invalid |
| `updateProfile` | mutation | `{token, displayName?, avatarUrl?}` | **duplicate** of `users.updateProfile`, used by nothing in the app |

### `convex/users.ts`

| Function | Kind | Signature | Notes |
|---|---|---|---|
| `list` | query | `{token}` | all users except self, sorted by `displayName`, `publicUser` shaped |
| `setPushToken` | mutation | `{token, pushToken: string\|null}` | called on login + token refresh |
| `updateProfile` | mutation | `{token, displayName?, username?, avatarUrl?}` | name 2–40, username `/^[a-z0-9_]{3,20}$/` + uniqueness, avatar must start with `http` |

### `convex/conversations.ts`

| Function | Kind | Signature | Notes |
|---|---|---|---|
| `list` | query | `{token}` | per-membership row: `title, emoji, avatarUrl, otherUserId, memberCount, lastMessageAt, lastMessagePreview, unreadCount, typingName, muted`; sorted `lastMessageAt` desc |
| `get` | query | `{token, conversationId}` | title/avatar + full `members[]` with `role` |
| `createDM` | mutation | `{token, otherUserId}` | `dmKey = sorted(a,b).join(':')`, idempotent |
| `createGroup` | mutation | `{token, name, emoji?, memberIds[]}` | creator becomes `owner`, default emoji `💍` |
| `addMembers` | mutation | `{token, conversationId, memberIds[]}` | any member may add |
| `removeMember` | mutation | `{token, conversationId, userId}` | **owner only** |
| `updateGroup` | mutation | `{token, conversationId, name?, avatarUrl?}` | **owner only**, name 2–50 |
| `deleteGroup` | mutation | `{token, conversationId}` | **owner only**; cascades messages + reactions + members |
| `markRead` | mutation | `{token, conversationId}` | patches `members.lastReadAt` |
| `leave` | mutation | `{token, conversationId}` | deletes the membership row (works for DMs too) |
| `setTyping` | mutation | `{token, conversationId, typing}` | `typingAt = now | 0`, **no throttle** — fires on every keystroke |
| `typing` | query | `{token, conversationId}` | names with `typingAt > now - 4000` |
| `setMuted` | mutation | `{token, conversationId, muted}` | stored but **never consulted by `messages.send`** |
| `sharedContent` | query | `{token, conversationId}` | last **300** messages → `{photos[], files[], links[]}`; links extracted with `/(https?:\/\/[^\s]+)/gi` and de-duped |

### `convex/messages.ts`

| Function | Kind | Signature | Notes |
|---|---|---|---|
| `list` | query | `{token, conversationId, before?, limit?}` | `limit` clamped to `Math.min(limit ?? 50, 100)`; returns `{messages[], hasMore, receipts[]}`; per message: sender, grouped reactions with `mine`, `fileUrl` (skipped when deleted), `replyTo` projection, `forwardedFrom`; `receipts[]` = `{userId, lastReadAt, lastSeenAt}` for every other member |
| `send` | mutation | `{token, conversationId, body?, kind?, storageId?, fileName?, mimeType?, size?, replyToId?, forwardedFrom?}` | trims body, updates `lastMessageAt/Preview/Sender`, patches own `lastReadAt`, fans out FCM to members with a `pushToken` (label `📷 Photo`/`🎬 Video`/`🎧 Audio`/`📄 File`, tag = conversationId, `data.type='message'`) |
| `remove` | mutation | `{token, messageId}` | **sender only**; soft delete → sets `deletedAt`, clears `body/fileName/mimeType/size/replyToId/storageId`, deletes reactions |
| `latestForConversation` | query | `{token, conversationId}` | unused by the app |

### `convex/reactions.ts`

| Function | Kind | Signature | Notes |
|---|---|---|---|
| `toggle` | mutation | `{token, messageId, emoji}` | deletes **all** of the user's reactions on that message, then re-adds `emoji` if it was not already present; emoji sliced to 8 chars |

### `convex/calls.ts` · `RING_TIMEOUT_MS = 60000`

| Function | Kind | Signature | Notes |
|---|---|---|---|
| `start` | mutation | `{token, calleeId, type}` | cannot self-call; auto-expires own stale ringing calls; rejects own ringing-as-callee; `throw "You are already in a call"` if an active/ringing call exists; schedules `markTimedOut`; pushes FCM `data.type='call'` with `channelId: incoming_call_v2` |
| `incoming` | query | `{token}` | newest ringing call younger than 60 s |
| `get` | query | `{token, callId}` | participant-gated; `{status, answeredAt, role, peer}` |
| `accept` | mutation | `{token, callId}` | callee only, `ringing` only |
| `reject` | mutation | `{token, callId}` | callee only |
| `markTimedOut` | internalMutation | `{callId}` | `ringing → missed` after 60 s |
| `end` | mutation | `{token, callId}` | `ringing → missed/rejected`, `active → ended` |
| `history` | query | `{token}` | caller ∪ callee, **top 100** newest |
| `signal` | mutation | `{token, callId, kind, payload}` | payload truncated to 20 000 chars |
| `signals` | query | `{token, callId}` | ordered ascending |
| `consumeSignals` | mutation | `{token, signalIds[]}` | deletes rows addressed to caller |

There is **no group-call entity, no call-recording entity, and no call-duration field**.

### `convex/files.ts`

| Function | Kind | Signature |
|---|---|---|
| `generateUploadUrl` | mutation | `{token}` → Convex storage upload URL |
| `url` | query | `{token, storageId}` → signed URL (used after avatar upload so the URL is resolvable before it is patched) |

### `convex/push.ts` · `convex/updates.ts`

| Function | Kind | Notes |
|---|---|---|
| `push.sendToTokens` | internalAction | `firebase-admin` multicast; android channel + `sound:'default'`, apns sound; logs failures |
| `push.sendDataToTokens` | internalAction | data-only high-priority push (call signalling); **never called** |
| `updates.publish` | mutation | **maintainer only** (`username === "yashraj"`); wipes previous rows + blobs |
| `updates.getLatest` | internalQuery | newest `updateCache` row |
| `updates.removePublished` | internalMutation | unused |
| `updates.check` | action | `{currentVersion}` → `{version, notes, url, size}` or `null`; semver compare |

### Effective server-side side effects the web app inherits

1. `messages.send` → FCM to every member holding a `pushToken`.
2. `calls.start` → FCM `type:'call'` to the callee, plus a 60 s scheduler job.
3. `requireUser` → `sessions.lastSeenAt` heartbeat every 30 s (drives the "delivered" tick heuristic).
4. `users.setPushToken` is the only place a web-push endpoint would be registered — the field is a
   single flat `pushToken?: string`, so **multi-device web + mobile push per user is not modelled**.

---

## Feature matrix

262 rows. `file:line` is the primary implementation site.

### 1 · App shell, platform services, and cross-cutting behaviour (28)

| # | Feature | Route / surface | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| A1 | Global error boundary + "Retry" fallback card | app root | `AppErrorBoundary.tsx:14-64`, wired `index.js:57-63` | LIVE | RN `getDerivedStateFromError` / `componentDidCatch` | — | **NATIVE-DIRECT** — Next.js `app/error.tsx` + `reset()` |
| A2 | Fatal + unhandled-rejection logging | app root | `index.js:36-55` | LIVE | RN `ErrorUtils` + `process.on('unhandledRejection')` | — | **NATIVE-DIRECT** — `window.onerror` / `unhandledrejection` |
| A3 | App-credentials screen (App ID / Auth Key / region US·EU·IN, persisted, SDK re-init) | `AppCredentials` (DEV only) | `login/AppCredentials.tsx:32-425` | PARTIAL | AsyncStorage + `CometChatUIKit.init` | — | **NATIVE-DIRECT** — but drop: the browser build has no CometChat UIKit to initialise |
| A4 | Sample-user quick login (remote sample JSON grid + UID field) | `SampleUser` (DEV only) | `login/SampleUser.tsx:98-145` | PARTIAL | `CometChatUIKit.login` | — | **MOBILE-ONLY** — drop; Convex auth replaces it |
| A5 | CometChat SDK bootstrap (calls-only background session, `SUBSCRIPTION_TYPE_ALL_USERS`) | app root | `App.tsx:112-142`, `auth/cometchatSession.ts:6-23` | LIVE | native Chat SDK | — | **WEB-HARD** — remove on web; WebRTC signalling already runs over Convex |
| A6 | FCM token registration + refresh → server | app root | `App.tsx:158-185`, `notifications/push.ts:29-42` | LIVE | `@react-native-firebase/messaging` | `users.setPushToken` | **WEB-HARD** — Web Push: service worker + `PushManager.subscribe` + VAPID/FCM-Web |
| A7 | Notification permission request | app root | `notifications/push.ts:4-27` | LIVE | Android 13 `POST_NOTIFICATIONS` + `requestPermission()` | — | **WEB-HARD** — `Notification.requestPermission()`, must be from a user gesture |
| A8 | Notification tap → open conversation | app root | `App.tsx:186-192` | LIVE | `getInitialNotification` / `onNotificationOpenedApp` | `conversations.get`, `messages.list` | **WEB-HARD** — SW `notificationclick` → `router.push('/messages/:id')` |
| A9 | Notification tap → accept + join call | app root | `App.tsx:194-204` | LIVE | same | `calls.accept` | **WEB-HARD** — needs a queued route, same as A8 |
| A10 | Notifee channels: "Messages" (HIGH + vibrate) and "Incoming calls" (HIGH, system ringtone, 400/800 pulse, PUBLIC) | app root | `notifications/callNotifications.ts:15-39` | LIVE | Android notification channels | — | **WEB-HARD** — no per-channel config on web; one OS-level notification behaviour only |
| A11 | Headless FCM data handler → full-screen incoming-call notification | app root / SW task | `notifications/background.ts:28-40`, `index.js:18-25` | LIVE | Notifee `fullScreenAction` + `AndroidCategory.CALL` | triggered by `calls.start` | **WEB-HARD** — SW `showNotification`; **no full-screen intent on web** |
| A12 | Call notification Accept/Decline actions, incl. decline while the app is killed | app root / headless | `callNotifications.ts:74-80`, `background.ts:42-119`, `index.js:28-34` | LIVE | Notifee actions + `ConvexHttpClient` from headless JS | `calls.accept`, `calls.reject` | **WEB-HARD** — Notification `actions` array, Chromium-only (no Safari) |
| A13 | Pending-call handoff from notification into `CallScreen` on AppState `active` | app root | `App.tsx:234-267`, `background.ts:57-83` | LIVE | AsyncStorage + `AppState` | `calls.accept` | **WEB-HARD** — `document.visibilitychange` + SW `message` |
| A14 | Foreground call-notification action handler | app root | `App.tsx:272-305` | LIVE | `notifee.onForegroundEvent` | `calls.accept`, `calls.reject` | **WEB-HARD** |
| A15 | CometChat push-package setup (token auto-register, tap/call-accepted/call-ended handlers) | app root | `utils/CometChatPushV2.ts:49-141` | LIVE | native push package | — | **WEB-HARD** — remove on web |
| A16 | SDK incoming-call listener + `CometChatIncomingCall` overlay (second, parallel ring path) | app root overlay | `App.tsx:321-393, 485-493` | PARTIAL | `CometChat.addCallListener` | none | **WEB-HARD** — Convex never notifies CometChat, so this path is effectively inert even on mobile |
| A17 | Busy-call auto-reject (reject an incoming call while already in one) | app root | `App.tsx:332-348` | LIVE | `CometChat.rejectCall(BUSY)` | — | **WEB-HARD** — replace with the `calls.start` "already in a call" guard |
| A18 | Card message action dispatcher (`openUrl` / `copyToClipboard` / `downloadFile`) | app root | `App.tsx:436-467` | **DEAD-CODE** | `Linking.openURL`, `@react-native-clipboard` | none | **NATIVE-DIRECT** — **do not replicate** |
| A19 | Battery-optimisation prompt ("Keep calls reliable" dialog) | app root dialog | `App.tsx:395-433, 501-519`; `InstallerModule.kt:55-94` | LIVE | Android `PowerManager` native module | — | **MOBILE-ONLY** |
| A20 | APK update checker (60 s poll + on-foreground, release notes, progress, download, install, unknown-sources permission) | app root dialog | `updater/UpdateChecker.tsx:32-240`, `InstallerModule.kt:27-169` | LIVE | native `Installer` module + `DeviceEventEmitter` | `updates.check` | **MOBILE-ONLY** |
| A21 | Material You dynamic colour bootstrap (Android 12+ system tonal palettes) | app root theme | `theme/dynamicTheme.ts:176-195`, `DynamicColorModule.kt` | LIVE | custom Kotlin native module | — | **WEB-HARD** — web has no system tonal palette; approximate with a seeded generator |
| A22 | M3 theme → CometChat palette bridge + config typography | app root | `App.tsx:66-79, 100-105`, `utils/themeTypography.ts:51` | LIVE | Paper + `CometChatThemeProvider` | — | **NATIVE-DIRECT** — CSS variables |
| A23 | Session token persistence + automatic sign-out on invalid token | app root | `auth/SessionProvider.tsx:44-92` | LIVE | AsyncStorage | `auth.me`, `auth.logout` | **WEB-HARD** — use an HttpOnly SameSite cookie, not `localStorage` |
| A24 | Multi-device sessions + `lastSeenAt` presence heartbeat | app root / backend | `convex/schema.ts:15-22`, `lib/helpers.ts:25-29` | LIVE | Convex sessions table | `sessions` | **NATIVE-DIRECT** — one token per device, cookie per browser |
| A25 | M3 shape language (28 dp dialogs, 24 dp top sheets, 16 dp cards, pill buttons) | all Paper screens | `ChatInfoScreen.tsx:763-767`, `ChatScreen.tsx:1710` | LIVE | Paper MD3 | — | **NATIVE-DIRECT** |
| A26 | Spring motion (menu open 380/26/0.9, reaction press 420/16, tab indicator 380/26/0.9) | chat + tabs | `ChatScreen.tsx:348-361, 211-227`, `BottomTabNavigator.tsx:49-57` | LIVE | `Animated.spring` | — | **NATIVE-DIRECT** — CSS transitions / WAAPI |
| A27 | Light + dark scheme following the OS | app root | `App.tsx:528-547`, `theme/dynamicTheme.ts:34-54` | LIVE | `useColorScheme()` | — | **NATIVE-DIRECT** — `prefers-color-scheme` + `color-scheme` |
| A28 | Error surfacing (RN `Alert.alert` + inline toast bars) | every screen | e.g. `ConversationsList.tsx:97`, `ProfileScreen.tsx:541-547` | LIVE | RN `Alert` / custom `View` | — | **NATIVE-DIRECT** |

### 2 · Authentication (6)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| B1 | Log in (username + password, validation, spinner, inline error toast, submit-on-enter) | `Login` | `login/Login.tsx:71-99, 203-262` | LIVE | `TextInput` | `auth.login` | **NATIVE-DIRECT** |
| B2 | Sign up (full name + username + password, client-side regex, error toast) | `SignUp` | `login/SignUp.tsx:79-125` | LIVE | `TextInput` | `auth.register` | **NATIVE-DIRECT** |
| B3 | Sign out (+ confirm dialog, two entry points) | `Profile`, `Settings` | `SessionProvider.tsx:81-92`, `ProfileScreen.tsx:513-539`, `SettingsScreen.tsx:34-45` | LIVE | Paper `Dialog` | `auth.logout` | **NATIVE-DIRECT** |
| B4 | Change password | — | not present in `convex/auth.ts` | NOT-BUILT | — | — | **NATIVE-DIRECT** if added |
| B5 | Delete account | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** if added — needs a cascade + rate limit |
| B6 | Forgot password / email verification | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |

### 3 · Bottom tabs (3)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| C1 | Tab bar, 3 visible tabs (`groups` filtered out at `BottomTabNavigator.tsx:99`) | `BottomTabNavigator` | `BottomTabNavigator.tsx:84-152` | LIVE | `@react-navigation/bottom-tabs` | — | **NATIVE-DIRECT** |
| C2 | M3 expressive tab indicator animation | same | `:45-82, 156-163` | LIVE | `Animated.spring` | — | **NATIVE-DIRECT** |
| C3 | Tab bar auto-hide while the keyboard is open | same | `:97, 106` | LIVE | `Keyboard` listeners | — | **NATIVE-DIRECT** |

### 4 · Conversation list — Chats tab (16)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| D1 | Conversation rows — avatar (uploaded image, else initials; round for DM, rounded-square for group), title, last-message preview, relative timestamp | `Chats` tab | `convex/ConversationsList.tsx:163-263` | LIVE | `FlatList` | `conversations.list` | **NATIVE-DIRECT** |
| D2 | Unread badge, capped at `99+` | same | `:248-259` | LIVE | Convex reactive query | `conversations.list.unreadCount` | **NATIVE-DIRECT** |
| D3 | Typing indicator replacing the row preview | same | `:220-230` | LIVE | Convex | `conversations.list.typingName` | **NATIVE-DIRECT** |
| D4 | Live reactive row updates (no manual refresh) | same | `:60-63` | LIVE | Convex realtime | `conversations.list` | **NATIVE-DIRECT** |
| D5 | Long-press → **Leave conversation** confirm dialog (native `Alert` on failure) | same | `:170, 85-102, 278-312` | LIVE | Paper `Dialog` + `Alert` | `conversations.leave` | **NATIVE-DIRECT** |
| D6 | Tap row → `Messages` | same | `:67-75` | LIVE | — | `conversations.get` | **NATIVE-DIRECT** |
| D7 | Header avatar button → `Profile` | same | `:120-130` | LIVE | — | `auth.me` | **NATIVE-DIRECT** |
| D8 | FAB → `Groups` | same | `:266-277` | LIVE | Paper `FAB` | `conversations.list` | **NATIVE-DIRECT** |
| D9 | Empty state ("No conversations yet" + hint) | same | `:137-156` | LIVE | — | — | **NATIVE-DIRECT** |
| D10 | Loading state (`ActivityIndicator` while the query is `undefined`) | same | `:133-136` | LIVE | — | — | **NATIVE-DIRECT** |
| D11 | Pull-to-refresh | same | `:161-162` (`onRefresh={() => {}}`, `refreshing={false}`) | **DEAD-CODE** | no-op | — | **NATIVE-DIRECT** — omit |
| D12 | Mute state on the row | same | `:34` (field consumed), never rendered | PARTIAL | — | `conversations.list.muted`, `conversations.setMuted` | **WEB-HARD** — the flag exists but `messages.send` still pushes to muted members |
| D13 | Conversation search / filter bar | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| D14 | Pin conversation | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| D15 | Archive conversation | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| D16 | Delete / hide conversation for one user | — | only `conversations.leave` exists | PARTIAL | Paper `Dialog` | `conversations.leave` | **NATIVE-DIRECT** |

### 5 · Chat screen — `Messages` route, `components/convex/ChatScreen.tsx` (59)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| E1 | Text composer + send (multiline, disabled until non-empty, spinner while sending) | `Messages` | `ChatScreen.tsx:1342-1371, 450-499` | LIVE | `TextInput` | `messages.send` | **NATIVE-DIRECT** |
| E2 | Typing signal on every keystroke (cleared after 3 s) | same | `:383-408` | LIVE | Convex mutation per keystroke | `conversations.setTyping` | **NATIVE-DIRECT** — throttle client-side, the server does not |
| E3 | Header typing indicator (`X is typing…` / `N people are typing…`) | same | `:1118-1130` | LIVE | Convex | `conversations.typing` | **NATIVE-DIRECT** |
| E4 | Group member-count subtitle | same | `:1130-1140` | LIVE | — | `conversations.get` | **NATIVE-DIRECT** |
| E5 | `markRead` on open and whenever the message count changes | same | `:323-332` | LIVE | Convex | `conversations.markRead` | **NATIVE-DIRECT** |
| E6 | Cancel this conversation's local notifications on open | same | `:328-330` (`NativeModules.Installer.cancelNotifications`) | LIVE | custom native module | — | **WEB-HARD** — `Notification` has no per-tag cancel in browsers |
| E7 | Inverted message list, single 60-message page (`limit: 60`) | same | `:253-258, 1180-1210` | LIVE | inverted `FlatList` | `messages.list` | **NATIVE-DIRECT** |
| E8 | Date separators — `Today` / `Yesterday` / weekday / `MMMM D, YYYY` | same | `:111-123, 763-787` | LIVE | `dayjs` | — | **NATIVE-DIRECT** |
| E9 | Sender name above the bubble in groups | same | `:815-825` | LIVE | — | — | **NATIVE-DIRECT** |
| E10 | Image messages — 220×220 cover thumbnail, tap → viewer | same | `:900-907` | LIVE | `Image` | `messages.list.fileUrl` | **NATIVE-DIRECT** |
| E11 | Video messages — paused/muted `react-native-video` preview, play overlay, filename pill | same | `:908-935` | LIVE | `react-native-video` | `messages.list.fileUrl` | **NATIVE-DIRECT** — `<video preload="metadata" muted playsinline>` |
| E12 | File / audio rows — icon by kind, filename, human-readable size | same | `:936-976, 98-109` | LIVE | — | `messages.list` | **NATIVE-DIRECT** |
| E13 | Full-screen media viewer (image contain / video with controls / audio player / file info card with size+mime+date), close + forward buttons | same | `:1440-1580` | LIVE | RN `Modal` + `react-native-video` | — | **NATIVE-DIRECT** — full-screen dialog + `<video controls>` |
| E14 | Attach sheet — Photo / Video / Document | same | `:1375-1438` | LIVE | RN `Modal` bottom sheet | — | **NATIVE-DIRECT** |
| E15 | Photo picker (multi-select) | same | `:501-520` | LIVE | `react-native-image-picker` `launchImageLibrary` | — | **NATIVE-DIRECT** — `<input type="file" accept="image/*" multiple>` |
| E16 | Video picker (multi-select) | same | `:522-541` | LIVE | same | — | **NATIVE-DIRECT** |
| E17 | Document picker (multi-select, `keepLocalCopy`, mime → `kind` classification) | same | `:543-601` | LIVE | `@react-native-documents/picker` | — | **NATIVE-DIRECT** |
| E18 | Pending-attachment tray (thumbnail, filename, per-item remove) | same | `:1215-1274, 410-412` | LIVE | horizontal `FlatList` | — | **NATIVE-DIRECT** |
| E19 | Upload pipeline — `generateUploadUrl` → POST blob → `messages.send` | same | `:414-448` | LIVE | `XMLHttpRequest` blob bridge | `files.generateUploadUrl`, `messages.send` | **NATIVE-DIRECT** — `File` object posts directly |
| E20 | Reply — long-press → Reply → reply bar above composer → send with `replyToId` | same | `:639-645, 1275-1321, 462-471` | LIVE | Convex | `messages.send.replyToId` | **NATIVE-DIRECT** |
| E21 | Reply quote block in the bubble, tap to scroll to the original + 1.2 s border highlight | same | `:864-899, 692-706` | LIVE | `scrollToIndex` + `onScrollToIndexFailed` retry | `messages.list.replyTo` | **NATIVE-DIRECT** |
| E22 | Forward — long-press → Forward → `ForwardMessage` route | same | `:655-661` | LIVE | — | — | **NATIVE-DIRECT** |
| E23 | Forward straight from the media viewer | same | `:749-756, 1468-1477` | LIVE | — | — | **NATIVE-DIRECT** |
| E24 | "Forwarded from X" caption on forwarded bubbles | same | `:826-844` | LIVE | — | `messages.send.forwardedFrom` | **NATIVE-DIRECT** |
| E25 | Copy text (text messages only, long-press → Copy) | same | `:621-625, 647-653, 1733-1739` | LIVE | `@react-native-clipboard/clipboard` | — | **NATIVE-DIRECT** — `navigator.clipboard.writeText` |
| E26 | Delete own message → anchored confirm card (`Delete message?` / "for everyone") | same | `:670-690, 1585-1650` | LIVE | RN `Alert`-style card | `messages.remove` | **NATIVE-DIRECT** |
| E27 | Soft-delete tombstone ("You deleted this message" / "This message was deleted"), reactions hidden, timestamp kept | same | `:845-862, 1012` | LIVE | — | `messages.remove` | **NATIVE-DIRECT** |
| E28 | Quick-reaction row in the menu — 6 hard-coded emoji `👍 ❤️ 😂 🎉 🙏 🔥` | same | `:47, 1717-1725` | LIVE | spring-scale press feedback | `reactions.toggle` | **NATIVE-DIRECT** |
| E29 | Reaction chips with counts, tap to toggle my own | same | `:1012-1044` | LIVE | Convex | `reactions.toggle`, `messages.list.reactions` | **NATIVE-DIRECT** |
| E30 | Message info card (sender display name + full timestamp) | same | `:663-668, 1651-1702` | LIVE | — | `messages.list` | **NATIVE-DIRECT** — sender + timestamp only, **no per-recipient receipts** |
| E31 | Delivery state ticks — `sent` ✓ / `delivered` ✓✓ / `read` ✓✓ (blue) | same | `:307-321, 1001-1008` | LIVE | — | `messages.list.receipts` (`lastReadAt`, `lastSeenAt`) | **NATIVE-DIRECT** |
| E32 | Long-press anchored action menu — viewport-aware x/y clamp, spring scale 0.8→1 + fade, tap-outside to dismiss | same | `:342-381, 1066-1091, 1703-1759` | LIVE | RN `Animated` + `Pressable` backdrop | — | **NATIVE-DIRECT** — popover anchored to the bubble rect |
| E33 | Header: back, title/body → info, audio call + video call (**DM only**), info button | same | `:1097-1173` | LIVE | — | `calls.start` | **WEB-HARD** — call buttons lead to the WebRTC screen |
| E34 | Send failure → restores the draft text + `Alert` | same | `:465-479` | LIVE | RN `Alert` | — | **NATIVE-DIRECT** |
| E35 | Empty state ("No messages yet", counter-flipped) | same | `:1197-1208` | LIVE | — | — | **NATIVE-DIRECT** |
| E36 | Loading state (`ActivityIndicator` while unsubscribed) | same | `:1175-1178` | LIVE | — | — | **NATIVE-DIRECT** |
| E37 | **Load-more / pagination** — `messages.list` accepts `before` + returns `hasMore`, but the UI never passes `before` and has no `onEndReached` | same | `:253-258` vs `convex/messages.ts:15-43, 164` | PARTIAL | — | `messages.list` | **NATIVE-DIRECT** — hook `hasMore`/`before` into an infinite scroll |
| E38 | Audio message **sending** — documents with `audio/*` mime become `kind:'audio'`, but there is **no recorder**; playback only inside the viewer | same | `:570-576, 1499-1520` | PARTIAL | — | `messages.send` | **NATIVE-DIRECT** — `MediaRecorder` |
| E39 | In-chat unread divider / "jump to first unread" chip | same | not present (spec `chat-ux-spec.md` §9) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E40 | Sticky floating date pill | same | not present (planned P2) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E41 | Link preview (OG) cards inside bubbles | same | not present — URLs are only extracted into the Chat info Links tab | NOT-BUILT | — | — | **WEB-HARD** — server-side unfurl + cache + SSRF guard |
| E42 | URL auto-linkification in bubble text | same | not present (plain `<Text>`) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E43 | Mentions (`@user`, `@all`) + mention autocomplete + mention highlighting | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** — needs a `mentions` array on `messages` |
| E44 | Edit message | same | not present (no `editedAt`, no `messages.edit`) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E45 | Pin message | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E46 | Save message (to Saved Messages) | same | not present in the Convex chat | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E47 | Search within a conversation | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** — needs a Convex search index on `messages.body` |
| E48 | Voice-note recording | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** — `MediaRecorder` + waveform |
| E49 | Polls / whiteboard / collaborative document / stickers | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E50 | Message privately to a group member | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** — `conversations.createDM` already exists |
| E51 | Mark as unread (per message) | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E52 | Report / flag a message | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** — needs a `reports` table |
| E53 | Native share sheet (system share, not in-app forward) | same | not present — `share-variant` icon is in-app Forward | NOT-BUILT | — | — | **NATIVE-DIRECT** — `navigator.share`, mobile browsers only |
| E54 | Haptics | — | no haptics anywhere in the repo | NOT-BUILT | — | — | **WEB-HARD** — `navigator.vibrate` (Android only, no desktop) |
| E55 | Message translation | same | not present | NOT-BUILT | — | — | **WEB-HARD** — needs a translation provider |
| E56 | "You are no longer a member" banner | same | not present (only in the dead UIKit `Messages.tsx:658-677`) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E57 | Blocked-user banner + unblock | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E58 | Full emoji keyboard / "who reacted" list / configurable emoji set | same | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| E59 | Multi-select forward | same | not present (planned P2) | NOT-BUILT | — | — | **NATIVE-DIRECT** |

### 6 · Chat info (group) — `ChatInfo` route, `components/convex/ChatInfoScreen.tsx` (27)

Reached only when `conversation.type === 'group'` (`ChatScreen.tsx:712-715`).

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| F1 | `Appbar.Header` + back action | `ChatInfo` | `ChatInfoScreen.tsx:443-446` | LIVE | Paper Appbar | — | **NATIVE-DIRECT** |
| F2 | Hero — group avatar image or initials avatar, name, `{N} members` / "Direct message" | same | `:454-491` | LIVE | Paper `Avatar.Text` | `conversations.get` | **NATIVE-DIRECT** |
| F3 | Change group photo (camera badge on the hero, owner only, upload spinner, snackbar result) | same | `:469-485, 213-237, 130-149` | LIVE | `launchImageLibrary` | `files.generateUploadUrl`, `files.url`, `conversations.updateGroup` | **NATIVE-DIRECT** |
| F4 | Mute / Unmute quick action (optimistic with rollback) | same | `:344-345, 170-183` | LIVE | Convex | `conversations.setMuted` | **NATIVE-DIRECT** |
| F5 | "Media" quick action — jumps to the Photos tab | same | `:346` | LIVE | — | `conversations.sharedContent` | **NATIVE-DIRECT** |
| F6 | Edit group name (owner only, dialog with validation `length >= 2`) | same | `:349, 194-211, 572-602` | LIVE | Paper `Dialog` | `conversations.updateGroup` | **NATIVE-DIRECT** |
| F7 | Members list — first 5 + "See all", avatar initials, `@username`, `Owner` chip | same | `:504-514, 406-439` | LIVE | Paper `List.Item` / `Chip` | `conversations.get` | **NATIVE-DIRECT** |
| F8 | Add members (owner only) — bottom sheet, multi-select checkboxes, "Everyone is already in this group" empty state, spinner while adding | same | `:515-527, 674-712, 253-281` | LIVE | RN `Modal` slide + Paper `Checkbox` | `users.list`, `conversations.addMembers` | **NATIVE-DIRECT** |
| F9 | Remove member (owner only) — per-row ✕ + confirm dialog + snackbar | same | `:429-436, 239-251, 604-625` | LIVE | Paper `IconButton` + `Dialog` | `conversations.removeMember` | **NATIVE-DIRECT** |
| F10 | Segmented tabs — Photos / Files / Links | same | `:531-548` | LIVE | Paper `SegmentedButtons` | `conversations.sharedContent` | **NATIVE-DIRECT** |
| F11 | Photos grid — 3-column, 9 + "See all", play overlay on videos, tap opens the file URL | same | `:352-372` | LIVE | `Linking.openURL` | `conversations.sharedContent.photos` | **NATIVE-DIRECT** — `window.open` / `<a download>` |
| F12 | Files list — 5 + "See all", icon by mime, `{size} · {MMM D, YYYY}`, tap opens URL | same | `:374-385, 56-61` | LIVE | `Linking.openURL` | `conversations.sharedContent.files` | **NATIVE-DIRECT** |
| F13 | Links list — 5 + "See all", URL + date, tap opens in the browser | same | `:387-398` | LIVE | `Linking.openURL` | `conversations.sharedContent.links` | **NATIVE-DIRECT** |
| F14 | Per-tab empty states (`No media yet` / `No files yet` / `No links yet`) | same | `:314-318` | LIVE | — | — | **NATIVE-DIRECT** |
| F15 | Delete group (owner only) — confirm dialog, "cannot be undone", cascades server-side | same | `:552-568, 650-671, 297-309` | LIVE | Paper `Dialog` | `conversations.deleteGroup` | **NATIVE-DIRECT** |
| F16 | Leave group (non-owner) — confirm dialog, then `popToTop()` | same | `:552-568, 627-648, 283-295, 185-192` | LIVE | Paper `Dialog` | `conversations.leave` | **NATIVE-DIRECT** |
| F17 | Snackbar feedback (3 s) for every mutation result | same | `:714-720` | LIVE | Paper `Snackbar` | — | **NATIVE-DIRECT** — MUI `Snackbar` |
| F18 | Loading state while `conversations.get` is unresolved | same | `:448-451` | LIVE | — | — | **NATIVE-DIRECT** |
| F19 | Mute actually suppressing push | — | `convex/messages.ts:240-279` never reads `members.muted` | PARTIAL | — | `messages.send` | **WEB-HARD** — server change required before the toggle is honest |
| F20 | Transfer ownership | — | not present in Convex (only the dead UIKit `GroupInfo`) | NOT-BUILT | — | — | **NATIVE-DIRECT** — `members.role` already has `owner` |
| F21 | Banned members list + unban | — | not present in Convex (only the dead UIKit route) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| F22 | Promote / demote (admin role) | — | schema has only `owner \| member` | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| F23 | Kick vs remove distinction; moderator delete of another member's message | — | `messages.remove` is sender-only (`convex/messages.ts:293-295`) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| F24 | Clear conversation / delete all messages | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| F25 | "Read by N of M" in chat info | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| F26 | Search shortcut inside chat info | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| F27 | Group emoji picker | — | `conversations.emoji` exists in the schema, never edited by any screen | NOT-BUILT | — | — | **NATIVE-DIRECT** |

### 7 · Contact info (DM) — `ContactInfo` route, `components/convex/ContactInfoScreen.tsx` (12)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| G1 | Hero — initials avatar, display name, `@username` | `ContactInfo` | `ContactInfoScreen.tsx:97-103` | LIVE | Paper `Avatar.Text` | `conversations.get` | **NATIVE-DIRECT** |
| G2 | "Audio call" button (green, loading state) | same | `:105-108, 53-67, 33-47` | LIVE | Convex | `calls.start` | **WEB-HARD** |
| G3 | "Video call" button (violet) | same | `:105-108` | LIVE | Convex | `calls.start` | **WEB-HARD** |
| G4 | "Media, files & links" row → `ChatInfo` (shares the same tabs) | same | `:112-123` | LIVE | — | `conversations.sharedContent` | **NATIVE-DIRECT** |
| G5 | Info rows — Username, Type = "Direct message" | same | `:127-130` | LIVE | Paper `List.Item` | `conversations.get` | **NATIVE-DIRECT** |
| G6 | Loading state | same | `:91-94` | LIVE | — | — | **NATIVE-DIRECT** |
| G7 | Online / last-seen | — | `sessions.lastSeenAt` reaches the client only inside `messages.list.receipts` (`convex/messages.ts:140-160`) and is never rendered | PARTIAL | — | `messages.list.receipts` | **WEB-HARD** — presence needs its own query + heartbeat budget |
| G8 | Block / unblock a user | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| G9 | Report a user | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| G10 | Mute a DM | — | not present (`setMuted` exists, no UI) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| G11 | Delete chat (per user) | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| G12 | Online presence dot | — | not present | NOT-BUILT | — | — | **WEB-HARD** — needs realtime presence |

### 8 · Forward message — `ForwardMessage` route, `components/convex/ForwardMessageScreen.tsx` (7)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| H1 | "Forward to" picker — every conversation, initials avatar, title, last-message preview | `ForwardMessage` | `ForwardMessageScreen.tsx:105-147, 203-219` | LIVE | `FlatList` + Paper `Appbar` | `conversations.list` | **NATIVE-DIRECT** |
| H2 | Client-side search over conversations by title | same | `:68-76, 186-195` | LIVE | Paper `Searchbar` | `conversations.list` | **NATIVE-DIRECT** |
| H3 | Preview card — icon by kind + "Forwarding from {sender}" + snippet | same | `:161-185, 41-55` | LIVE | — | route params | **NATIVE-DIRECT** |
| H4 | Tap a row to forward immediately (reuses the original `storageId`, sets `forwardedFrom`), `Alert` confirm, `goBack()` | same | `:78-103` | LIVE | RN `Alert` | `messages.send` | **NATIVE-DIRECT** |
| H5 | Per-row in-flight spinner, whole list disabled while sending | same | `:107-142` | LIVE | `ActivityIndicator` | — | **NATIVE-DIRECT** |
| H6 | Empty state "No conversations found" | same | `:211-217` | LIVE | — | — | **NATIVE-DIRECT** |
| H7 | Multi-select forward | — | not present (planned P2) | NOT-BUILT | — | — | **NATIVE-DIRECT** |

### 9 · Users tab — `convex/UsersList.tsx` (9)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| I1 | User rows — avatar image or initials, display name, `@username` | `Users` tab | `convex/UsersList.tsx:128-183` | LIVE | `FlatList` | `users.list` | **NATIVE-DIRECT** |
| I2 | Client-side search by display name or username | same | `:46-57, 100-118` | LIVE | `TextInput` | `users.list` | **NATIVE-DIRECT** |
| I3 | Tap user → `createDM` (idempotent) → `Messages` | same | `:59-84` | LIVE | Convex | `conversations.createDM` | **NATIVE-DIRECT** |
| I4 | Empty state — "No other users yet" / "No users found" | same | `:184-206` | LIVE | — | — | **NATIVE-DIRECT** |
| I5 | Loading state | same | `:120-123` | LIVE | — | — | **NATIVE-DIRECT** |
| I6 | Per-row spinner while the DM is created; whole list disabled | same | `:112, 179-181` | LIVE | — | — | **NATIVE-DIRECT** |
| I7 | Contacts / phone-book import | — | not present | NOT-BUILT | — | — | **MOBILE-ONLY** |
| I8 | Block a user from the list | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| I9 | Invite link / share invite | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |

### 10 · Groups — `Groups` route, `components/convex/GroupsList.tsx` (7)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| J1 | Group rows — avatar image or initials (rounded square), name, `{N} members · {preview}` | `Groups` | `convex/GroupsList.tsx:171-228` | LIVE | `FlatList` | `conversations.list` (filtered to `type === 'group'`) | **NATIVE-DIRECT** |
| J2 | Create group — bottom sheet with name input + multi-select member checklist + create button; navigates straight into the new chat | same | `:232-346, 81-107` | LIVE | RN `Modal` slide | `conversations.createGroup`, `users.list` | **NATIVE-DIRECT** |
| J3 | Empty state + "Create a group" CTA | same | `:138-166` | LIVE | — | — | **NATIVE-DIRECT** |
| J4 | "No other users yet" empty state inside the create sheet | same | `:318-327` | LIVE | — | `users.list` | **NATIVE-DIRECT** |
| J5 | Group avatar at creation time | — | not present (can only be set later from Chat info) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| J6 | Join / leave / discover public groups | — | not present (groups are invite-only via `createGroup`) | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| J7 | Group search | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |

### 11 · Profile — `Profile` route, `components/convex/ProfileScreen.tsx` (15)

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| K1 | View profile — avatar, display name, `@username` | `Profile` | `convex/ProfileScreen.tsx:207-253` | LIVE | Paper `Avatar` | `auth.me` | **NATIVE-DIRECT** |
| K2 | Edit profile — display name + username form, save/cancel, loading | same | `:255-301, 115-142` | LIVE | Paper `TextInput` + `Button` | `users.updateProfile` | **NATIVE-DIRECT** |
| K3 | Avatar upload from the photo library (camera badge, upload spinner) | same | `:144-172, 219-242, 68-86` | LIVE | `launchImageLibrary` | `files.generateUploadUrl`, `files.url`, `users.updateProfile` | **NATIVE-DIRECT** |
| K4 | Username validation helper ("3-20 characters: a-z, 0-9, _") | same | `:274` | LIVE | — | `users.updateProfile` | **NATIVE-DIRECT** |
| K5 | Account section rows (Username, Display name) | same | `:304-327` | LIVE | Paper `List` | `auth.me` | **NATIVE-DIRECT** |
| K6 | About section — Version `(build)`, Platform (OS + OS version), Signed in as | same | `:329-386, 92-93` | LIVE | `react-native-device-info` | — | **MOBILE-ONLY** — web must read a build-time env constant / manifest |
| K7 | Links — GitHub, Source code, Email (`mailto:`) | same | `:388-469` | LIVE | `Linking.openURL` | — | **NATIVE-DIRECT** |
| K8 | Preferences section → `Settings` | same | `:475-487` | LIVE | — | — | **NATIVE-DIRECT** |
| K9 | Sign out button (opens the confirm dialog) | same | `:490-508` | LIVE | Paper `Button` | `auth.logout` | **NATIVE-DIRECT** |
| K10 | **Custom accent colour picker** | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** — CSS custom properties |
| K11 | **Theme switch (light / dark / system, manual)** | — | not present; `App.tsx:528-529` reads `useColorScheme()` only | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| K12 | Custom status / "Away" / "Busy" | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| K13 | Bio / about me | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| K14 | Blocked users list | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| K15 | Online status indicator on the profile | — | not present | NOT-BUILT | — | — | **WEB-HARD** — needs presence |

### 12 · Settings — `Settings` route, `components/convex/SettingsScreen.tsx` (9)

The settings screen is deliberately tiny — four rows.

| # | Feature | Route | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| L1 | "App notification settings" → deep-link to OS settings | `Settings` | `convex/SettingsScreen.tsx:70-84, 47-49` | LIVE | `Linking.openSettings()` | — | **WEB-HARD** — no per-app settings page; re-prompt `Notification.requestPermission()` |
| L2 | Battery-optimisation row with live state ("Allowed" / "Restricted, calls may be delayed") + deep link | same | `:93-113, 14-32` | LIVE | `NativeModules.Installer` | — | **MOBILE-ONLY** |
| L3 | About row — app name + version/build | same | `:122-135` | LIVE | `react-native-device-info` | — | **MOBILE-ONLY** |
| L4 | Sign out row + native confirm `Alert` | same | `:140-153, 34-45` | LIVE | RN `Alert` | `auth.logout` | **NATIVE-DIRECT** |
| L5 | Notification preferences / DND / per-conversation push toggles | — | not present | NOT-BUILT | — | — | **WEB-HARD** — needs schema + per-channel push suppression |
| L6 | Privacy settings | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| L7 | **Language selection** — `CometChatI18nProvider` is mounted (`App.tsx:484`) but nothing exposes a picker; all Convex UI copy is hard-coded English | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** — `next-intl` |
| L8 | Clear cache / storage usage | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |
| L9 | Dark-mode toggle inside settings | — | not present | NOT-BUILT | — | — | **NATIVE-DIRECT** |

### 13 · Calls (39)

| # | Feature | Route / surface | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| M1 | Outgoing 1:1 **audio** call from the chat header (DM only) | `CallScreen` | `convex/ChatScreen.tsx:1144-1153, 718-743` | LIVE | `calls.start` → WebRTC | `calls.start` | **WEB-HARD** |
| M2 | Outgoing 1:1 **video** call from the chat header (DM only) | same | `ChatScreen.tsx:1154-1163` | LIVE | same | `calls.start` | **WEB-HARD** |
| M3 | Start a call from Contact info | same | `ContactInfoScreen.tsx:53-67, 33-47` | LIVE | same | `calls.start` | **WEB-HARD** |
| M4 | Call back from the Calls history list | same | `calls/Calls.tsx:75-103` | LIVE | same | `calls.start` | **WEB-HARD** |
| M5 | Incoming-call overlay — pulsing avatar ring, caller initials, Accept / Decline, "Incoming voice/video call" | app overlay (`App.tsx:500`) | `calls/IncomingCallOverlay.tsx:25-208` | LIVE | Convex reactive query + animation | `calls.incoming`, `calls.accept`, `calls.reject` | **WEB-HARD** |
| M6 | Full-screen ringing notification with Accept + Decline actions, looping ringtone, 60 s timeout | system UI | `notifications/callNotifications.ts:47-84` | LIVE | Notifee + FCM | `calls.start` triggers it | **WEB-HARD** |
| M7 | Ongoing-call screen — remote `RTCView` full-bleed, local mirrored picture-in-picture preview | `CallScreen` | `calls/WebRTCCallScreen.tsx:316-373` | LIVE | `react-native-webrtc` | `calls.signals` | **WEB-HARD** |
| M8 | Audio-only call screen — large initials avatar on a plain backdrop | same | `:322-340` | LIVE | — | — | **WEB-HARD** |
| M9 | Mute / unmute microphone | same | `:259-267, 376-392` | LIVE | `MediaStreamTrack.enabled` | — | **WEB-HARD** |
| M10 | Camera on / off (video calls only) | same | `:269-277, 394-412` | LIVE | `MediaStreamTrack.enabled` | — | **WEB-HARD** |
| M11 | Flip camera (front ↔ back) | same | `:279-284, 413-425` | LIVE | `videoTrack._switchCamera()` | — | **WEB-HARD** — `facingMode`, absent on desktop |
| M12 | Hang up (ends the call server-side, then `goBack`) | same | `:83-88, 429-434` | LIVE | Convex | `calls.end` | **WEB-HARD** |
| M13 | Status label — `Ringing…` / `Connecting…` / live `mm:ss` / `Call ended` | same | `:237-246, 286-301, 343-356` | LIVE | `setInterval` | `calls.get` | **NATIVE-DIRECT** |
| M14 | Caller-side 60 s unanswered timeout → auto hang-up | same | `:248-257` | LIVE | `setTimeout` | — | **NATIVE-DIRECT** |
| M15 | Ringback tone for the outgoing caller | same | `:307-315` (`src/assets/sounds/ringback.wav`) | LIVE | `react-native-video` audio loop | — | **WEB-HARD** — WebAudio; mobile autoplay policy blocks it until a gesture |
| M16 | Auto-teardown when the remote rejects / misses / ends | same | `:228-235` | LIVE | Convex | `calls.get` | **WEB-HARD** |
| M17 | Auto-teardown on `connectionState` failed/closed | same | `:138-143` | LIVE | WebRTC | — | **WEB-HARD** |
| M18 | Runtime permission prompt for CAMERA + RECORD_AUDIO | same | `:95-100` | LIVE | `PermissionsAndroid` | — | **WEB-HARD** — `getUserMedia` prompt |
| M19 | Local media acquisition (video `640×480@24`, `facingMode: 'user'`) | same | `:101-113` | LIVE | `mediaDevices.getUserMedia` | — | **WEB-HARD** |
| M20 | WebRTC signalling — offer / answer / ICE candidates through Convex | same | `:122-131, 147-156, 174-225` | LIVE | Convex reactive query | `calls.signal`, `calls.signals` | **WEB-HARD** — keep this exact model, it already works browser-side |
| M21 | Signal consumption (rows deleted once applied) | same | `:221-223`; `convex/calls.ts:288-299` | LIVE | Convex | `calls.consumeSignals` | **WEB-HARD** |
| M22 | ICE server config — **STUN only** (`stun:stun.l.google.com:19302`) | same | `:28-30` | LIVE | — | — | **WEB-HARD** — add TURN; symmetric-NAT corporate networks will fail without it |
| M23 | Call history list — peer initials, name, timestamp, direction/type/missed label, status icon | `Calls` tab | `calls/Calls.tsx:105-190` | LIVE | `FlatList` | `calls.history` | **NATIVE-DIRECT** |
| M24 | Missed-call labelling (`Missed voice/video call`, red icon) | same | `:50-60, 159-171` | LIVE | — | `calls.history.status` | **NATIVE-DIRECT** |
| M25 | Call history empty state (`No calls yet`) | same | `:209-234` | LIVE | — | — | **NATIVE-DIRECT** |
| M26 | Call-log persistence — top 100, statuses `ringing/active/rejected/missed/ended` | backend | `convex/calls.ts:215-246` | LIVE | Convex | `calls.history` | **NATIVE-DIRECT** |
| M27 | "You are already in a call" guard + stale-ring cleanup on `start` | backend | `convex/calls.ts:44-68` | LIVE | Convex | `calls.start` | **NATIVE-DIRECT** |
| M28 | Call detail screen with Participants / Recordings / History tabs, status icon, duration | `CallDetails` | `calls/CallDetails.tsx:30-35, 407-442` | **DEAD-CODE** | UIKit Calls SDK | — | **WEB-HARD** — not reachable in the live app |
| M29 | Call recordings list + download + open | inside M28 | `calls/CallRecordings.tsx:20-234` | **DEAD-CODE** | `NativeModules.FileManager` (module does not exist) | — | **MOBILE-ONLY** — do not replicate |
| M30 | Persisted call duration | — | schema has `answeredAt`/`endedAt` but no duration and nothing writes a duration | NOT-BUILT | — | — | **NATIVE-DIRECT** — schema field |
| M31 | Call statistics / data-usage report | — | `react-native-callstats` is a dependency but is never imported | NOT-BUILT | — | — | **MOBILE-ONLY** |
| M32 | Group calls | — | schema is strictly `callerId`/`calleeId` | NOT-BUILT | — | — | **WEB-HARD** |
| M33 | Screen share | — | not present | NOT-BUILT | — | — | **WEB-HARD** — `getDisplayMedia` |
| M34 | Picture-in-picture / floating call window | — | not present | NOT-BUILT | — | — | **WEB-HARD** — Document PiP |
| M35 | Ongoing-call bar when navigating away from `CallScreen` | — | not present | NOT-BUILT | — | — | **WEB-HARD** |
| M36 | Background audio while the call runs | — | not present | NOT-BUILT | — | — | **WEB-HARD** — browsers may suspend the tab |
| M37 | DTMF keypad | — | not present | NOT-BUILT | — | — | **WEB-HARD** |
| M38 | Live call-quality stats | — | not present | NOT-BUILT | — | — | **WEB-HARD** — `getStats()` polled into a HUD |
| M39 | Speaker / audio-route toggle | — | not present in the Convex call screen | NOT-BUILT | — | — | **NATIVE-DIRECT** — `HTMLMediaElement.setSinkId` |

### 14 · Built-but-unreachable (CometChat UIKit legacy layer) (25)

Everything here compiles and is registered (where noted) but **cannot be reached from the running
app**. The Convex chat never emits a CometChat message, so no CometChat push notification, thread
reply, or UIKit session event is ever produced.

| # | Feature | Route registered | file:line | Status | Mobile mechanism | Convex deps | Web parity verdict |
|---|---|---|---|---|---|---|---|
| N1 | Legacy CometChat conversation list + avatar tooltip menu (Create Conversation / AI Assistants / Saved Messages / user row / Logout / version / Builder QR / Reset to Default) | `Conversation` | `components/conversations/screens/Conversations.tsx:39-344` | **DEAD-CODE** | `CometChatConversations` + `TooltipMenu` | none | **NATIVE-DIRECT** — do not replicate |
| N2 | Legacy UIKit chat screen — threads, mention formatter, AI assistant drawer, smart replies, conversation starters, pinned button, search option, block/unblock banner, translate, polls, mark-as-unread, AI assistant tools | **not registered** | `components/conversations/screens/Messages.tsx:53-786` | **DEAD-CODE** | `CometChatMessageHeader/List/Composer` | none | **NATIVE-DIRECT** — orphaned source |
| N3 | Create-conversation wizard (Users / Groups tabs) | `CreateConversation` | `CreateConversation.tsx:22-101` | **DEAD-CODE** | `CometChatUsers` | none | **NATIVE-DIRECT** |
| N4 | Saved Messages panel (cross-conversation, jump-to-message) | `SavedMessages` | `SavedMessages.tsx:14-99` | **DEAD-CODE** | `CometChatSavedMessages` | none | **NATIVE-DIRECT** |
| N5 | Pinned Messages panel (per-conversation) | `PinnedMessages` | `PinnedMessages.tsx:14-88` | **DEAD-CODE** | `CometChatPinnedMessages` | none | **NATIVE-DIRECT** |
| N6 | Search messages (conversations + messages, `goToMessageId`) | `SearchMessages` | `SearchMessages.tsx:23-176` | **DEAD-CODE** | `CometChatSearch` | none | **NATIVE-DIRECT** |
| N7 | Thread view (replies, thread header, compact composer, unblock banner) | `ThreadView` | `ThreadView.tsx:49-423` | **DEAD-CODE** | `CometChatThreadHeader/List` | none | **WEB-HARD** — threads need a new Convex entity, so only worth it if you actually want threads |
| N8 | Legacy user info (block/unblock, delete chat, audio/video call, online + last-seen) | `UserInfo` | `UserInfo.tsx:37-445` | **DEAD-CODE** | `CometChat.Avatar` + SDK | none | **NATIVE-DIRECT** |
| N9 | Legacy group info (add/view members, banned members, leave, delete & exit, transfer ownership) | `GroupInfo` | `GroupInfo.tsx:45-536` | **DEAD-CODE** | SDK | none | **NATIVE-DIRECT** |
| N10 | Add-member UIKit picker (multi-select + add + system action message) | `AddMember` | `AddMember.tsx:42-281` | **DEAD-CODE** | `CometChat.addMembersToGroup` | none | **NATIVE-DIRECT** |
| N11 | Banned-members list + unban | `BannedMember` | `BannedMember.tsx:46-231` | **DEAD-CODE** | `CometChat.BannedMembersRequestBuilder` | none | **NATIVE-DIRECT** |
| N12 | View-members UIKit list (kick / ban / promote / demote) | `ViewMembers` | `ViewMembers.tsx:16-68` | **DEAD-CODE** | `CometChatGroupMembers` | none | **NATIVE-DIRECT** |
| N13 | Transfer ownership | `TransferOwnershipSection` | `TransferOwnership.tsx:20-130` | **DEAD-CODE** | `CometChat.transferGroupOwnership` | none | **NATIVE-DIRECT** |
| N14 | Stack-level `Users` route (UIKit `CometChatUsers`, limit 30, sorted by name) | `Users` | `components/users/Users.tsx:11-45` | **DEAD-CODE** | `CometChatUsers` | none | **NATIVE-DIRECT** |
| N15 | Legacy `Groups` list + `GroupHelper` (create-group dialog, join/leave, members) | imported only by N3 | `components/groups/Groups.tsx`, `GroupHelper.tsx` | **DEAD-CODE** | SDK | none | **NATIVE-DIRECT** |
| N16 | `OngoingCallScreen` (UIKit `CometChatOngoingCall` + `CometChatCalls.OngoingCallListener`) | `OngoingCallScreen` | `components/conversations/screens/OngoingCallScreen.tsx:15-95` | **DEAD-CODE** | Calls SDK | none | **WEB-HARD** — only the CometChat native push SDK can reach it, and no CometChat call is ever created |
| N17 | `CallLogs` duplicate route (same component as the Calls tab) | `CallLogs` | `RootStackNavigator.tsx:200` | **DEAD-CODE** | — | `calls.history` | **NATIVE-DIRECT** |
| N18 | **AI Agents screen** — `CometChatUsers` filtered to role `@agentic`; tap → `Messages` with a `CometChat.User` | `AIAgents` | `components/AIAgent/AIAgents.tsx:11-62` | **DEAD-CODE** | `CometChatUsers` + `UsersRequestBuilder.setRoles(['@agentic'])` | none | **NATIVE-DIRECT** — see note below |
| N19 | QR / Builder config scanner — VisionCamera QR + EAN-13 scan, torch toggle, animated scan line + progress, fetches `https://apivcb.cometchat.io/v1/builders/{id}`, hot-swaps `config/store.ts` | `QRScreen` | `components/conversations/screens/qr_screen.tsx:34-580` | **DEAD-CODE** | `react-native-vision-camera` | none | **WEB-HARD** (`BarcodeDetector`) but pointless on web |
| N20 | `AuthContext` (`setIsLoggedIn`) — **no provider is ever mounted** | — | `navigation/AuthContext.tsx:8-11` | **DEAD-CODE** | — | none | **NATIVE-DIRECT** |
| N21 | `ActiveChatContext` provider (mounted in `index.js`) but read only by the dead N2 | — | `utils/ActiveChatContext.tsx:15-32` | **DEAD-CODE** | — | none | **NATIVE-DIRECT** |
| N22 | `useGroupMemberStatus` hook + `GroupListeners` helper — only used by the dead N2 | — | `hooks/useGroupMemberStatus.ts`, `components/conversations/helper/GroupListeners.ts` | **DEAD-CODE** | SDK | none | **NATIVE-DIRECT** |
| N23 | `TooltipMenu` — used only by the dead N1 | — | `utils/TooltipMenu.tsx` | **DEAD-CODE** | — | none | **NATIVE-DIRECT** |
| N24 | Builder config store — `config.json` + Zustand + AsyncStorage. `layout.tabs` **is** read by the tab navigator (`:95`); every other flag is read only by dead UIKit screens | — | `config/store.ts:143-201`, `config/config.json` | PARTIAL | AsyncStorage | none | **NATIVE-DIRECT** — flatten it into a static web config or drop it |
| N25 | CometChat user auto-provision on Convex sign-in (`CometChatUIKit.createUser`, swallowed on failure) | app root | `auth/cometchatSession.ts:14-16` | LIVE | native SDK | none | **MOBILE-ONLY** — remove on web |

---

## Shipped vs planned

Diff of the previous dev's own specs against the code. `docs/ux-research/` was written against the
**pre-Convex** app; the Convex fork landed in commits `9c28d80 … ca7587c`. Most of the gap list in
`original-app-features.md` §7 was closed; a significant amount of the UIKit surface was left behind
as dead code.

### `original-app-features.md` — feature-by-feature verdict

| Claimed / analysed feature | Doc verdict | Actual | Now |
|---|---|---|---|
| Reactions (toggle, chips, counts) | PARTIAL | ✅ shipped — `reactions` table, grouped counts + `mine` | `LIVE` |
| "Who reacted" list | PARTIAL | ❌ never built | `NOT-BUILT` |
| Configurable emoji set | PARTIAL | ❌ 6 hard-coded emoji (`ChatScreen.tsx:47`) | `PARTIAL` |
| Copy text | PARTIAL | ✅ shipped — long-press → Copy, text only | `LIVE` |
| Share (native share sheet) | PARTIAL | ❌ the `share-variant` icon is in-app **Forward**, not a share sheet | `NOT-BUILT` |
| Mark as unread | PARTIAL | ❌ never built (the flag existed only in dead UIKit code) | `NOT-BUILT` |
| Reply / quote | **NO** → needs `replyToId` | ✅ `messages.replyToId`, reply bar, quoted block, jump + highlight | `LIVE` |
| Reply in thread / follow thread | **NO** → needs `parentMessageId`, `threadSubscriptions` | ❌ never built on Convex; UIKit `ThreadView` is dead code | `NOT-BUILT` |
| Report / flag | **NO** → needs `reports` | ❌ never built | `NOT-BUILT` |
| Message privately | PARTIAL | ❌ never built | `NOT-BUILT` |
| Edit message | **NO** → needs `editedAt`, `messages.edit` | ❌ never built | `NOT-BUILT` |
| Message info | **NO** → needs per-recipient receipts | ⚠️ sender + timestamp only | `PARTIAL` |
| Pin / unpin | **NO** | ❌ never built | `NOT-BUILT` |
| Save / unsave | **NO** | ❌ never built (only the dead UIKit panel) | `NOT-BUILT` |
| Delete | PARTIAL → needs `deletedAt` soft delete | ✅ sender-only soft delete + tombstone | `LIVE` |
| Moderator delete of others' messages | not claimed | ❌ `messages.remove` is sender-only | `NOT-BUILT` |
| Translate | **NO** | ❌ never built | `NOT-BUILT` |
| Forward | n/a in v5.5.1 | ✅ shipped with `forwardedFrom` | `LIVE` |
| Date separators | YES | ✅ shipped | `LIVE` |
| Media tabs (Members / Photos / Videos / Files / Links / Docs) | PARTIAL | ✅ Photos + Files + Links shipped; **Videos tab and Docs tab were dropped** — videos are folded into Photos, Docs was not built | `PARTIAL` |
| Mute | **NO** → needs `mutedUntil` | ⚠️ `members.muted` shipped and is writable, but `messages.send` ignores it | `PARTIAL` |
| Search (message search) | **NO** → needs a search index | ❌ never built | `NOT-BUILT` |
| Block / unblock | **NO** | ❌ never built | `NOT-BUILT` |
| Delete chat (per user) | **NO** | ⚠️ only `conversations.leave` exists | `PARTIAL` |
| Online / last-seen status | **NO** | ⚠️ `sessions.lastSeenAt` is computed and returned inside `messages.list.receipts` but never rendered | `PARTIAL` |
| Unread badges | PARTIAL | ✅ shipped (count + 99+ cap) | `LIVE` |
| Read receipts / delivery ticks | PARTIAL/NO | ✅ shipped as a coarse heuristic from `lastReadAt` + `lastSeenAt`; no per-message receipts table | `LIVE` (coarse) |
| Typing indicators | **NO** | ✅ `members.typingAt` + `setTyping` + `typing` query + 4 s expiry | `LIVE` |
| Threads | **NO** | ❌ not built | `NOT-BUILT` |
| Pinned & saved messages | **NO** | ❌ not built on Convex | `NOT-BUILT` |
| Mentions | **NO** | ❌ never built | `NOT-BUILT` |
| Voice notes | **YES** once a recorder exists | ⚠️ the `kind:'audio'` send path exists; **no recorder UI** | `PARTIAL` |
| Composer rich features (polls, whiteboard, doc, stickers) | **NO** | ❌ never built on Convex | `NOT-BUILT` |
| Group calls | **NO** | ❌ schema is 1:1 only | `NOT-BUILT` |
| Call recordings | **NO** | ❌ dead UIKit panel, unusable native module | `DEAD-CODE` |
| Call detail tabs (Participants / History / Recordings) | **NO** | ❌ dead UIKit screen | `DEAD-CODE` |
| Change password | **NO** | ❌ not built | `NOT-BUILT` |
| Delete account | **NO** | ❌ not built | `NOT-BUILT` |
| Notification preferences / DND | **NO** | ❌ not built | `NOT-BUILT` |
| Wallpaper / per-chat theme | **NO** | ❌ not built | `NOT-BUILT` |
| Blocked users list | **NO** | ❌ not built | `NOT-BUILT` |
| Profile & settings pages | "the original app did not have them" | ✅ **both were built from scratch** (`ProfileScreen`, `SettingsScreen`) — a genuine addition over the original | `LIVE` |

### `chat-ux-spec.md` — phasing verdict

| Phase | Item | Verdict |
|---|---|---|
| **P0** | Date separators | ✅ shipped |
| P0 | Long-press **bottom sheet** → replaced with a spring **anchored popup menu** (spec §2 explicitly said the anchored popup "is not used for messages"; the implementation chose the popup) | ✅ shipped, different presentation |
| P0 | Reply bar + quoted block + jump/highlight | ✅ shipped |
| P0 | Tombstone delete | ✅ shipped |
| P0 | Read/delivered ticks | ✅ shipped (coarse) |
| P0 | Typing indicator (header + list row) | ✅ shipped |
| P0 | Unread list polish | ✅ badge + preview colour shipped; row **timestamp is not recoloured** and there is no unread divider |
| P0 | Single forward + picker | ✅ shipped |
| P1 | Conversation info screen (Photos / Files / Links + members) | ✅ shipped; **Docs tab dropped** |
| P1 | DM contact-info hero | ✅ shipped |
| P1 | Mute | ⚠️ UI shipped; backend does not honour it |
| P1 | Sticky-lite date pill | ❌ not built |
| P1 | In-chat unread divider | ❌ not built |
| P2 | Multi-select forward | ❌ not built |
| P2 | Delete-for-me (local hide) | ❌ not built (correctly dropped) |
| P2 | Anchored emoji row before the sheet | ❌ dropped in favour of the in-menu emoji row |
| P2 | Blob cleanup with ref-counting | ❌ not built |
| P2 | "Read by N of M" in message info | ❌ not built |

### `material-ui-plan.md` (research → what actually shipped)

| Plan item | Verdict |
|---|---|
| Adopt `react-native-paper@5.15.3` + scoped MDI icons | ✅ done |
| `PaperProvider` at the root | ✅ `App.tsx:551` |
| `adaptNavigationTheme` coexistence | ❌ not used; `RootStackNavigator.tsx:57-63` hand-builds the theme |
| Babel `react-native-paper/babel` production plugin (bundle trim) | ❌ `babel.config.js` is preset-only |
| Migration order 1–6 (Settings → Profile → Details → Chat list → Chat) | ✅ **all five screens were migrated** |
| `SegmentedButtons` for the details tabs | ✅ `ChatInfoScreen.tsx:531` |
| `Searchbar` | ✅ `ForwardMessageScreen.tsx:186` (not in the chat list — see D13) |
| `Badge` for unread | ⚠️ custom `View` pill instead (`ConversationsList.tsx:248`) |
| `Menu` for the long-press context menu | ❌ hand-rolled anchored popup instead |
| `FAB` for new chat | ✅ `ConversationsList.tsx:266` (it opens **Groups**, not a new DM) |
| Ripple mitigation for issue #4810 | ⚠️ not addressed — relies on Paper defaults |
| `Switch` for settings toggles | ❌ no settings toggles exist at all |
| `List.Accordion` for advanced settings | ❌ not used |

### `m3-expressive-spec.md` (design doc → what actually shipped)

| Spec item | Verdict |
|---|---|
| Corner-radius scale (dialog 28, sheet 28 top, cards 12, FAB 16) | ✅ shipped |
| Spring constants (`expressiveDefaultSpatial` 380/29) | ✅ shipped (380/**26**/0.9 — close enough) |
| Typography emphasis (600 weights on labels/titles) | ⚠️ **not applied**; the theme keeps the stock MD3 fonts |
| FAB press scale 0.94 + radius morph 16→12 | ❌ not built |
| Shape-morphing loading indicator | ❌ not built (stock `ActivityIndicator`) |
| Tab/nav indicator morph on one axis | ✅ shipped (scaleX pill) |
| Rim light on dark floating surfaces | ❌ not built |
| Dynamic colour from a **seed** via `material-color-utilities` | ❌ not built (this is the one gap vs the design doc) |
| Split button, button groups, FAB menu, carousel, toolbars, pickers | ❌ out of scope, never built |

### `dynamic-color.md` (design doc → what actually shipped)

| Spec item | Verdict |
|---|---|
| `DynamicColorModule.kt` reading `system_accent{1,2,3}_*` | ✅ shipped (file exists, registered in `MainApplication.kt`) |
| `DynamicColorPackage.kt` | ✅ shipped |
| `TurboModuleRegistry` second lookup path | ✅ shipped (`dynamicTheme.ts:63-66`) |
| Silent fallback to the static theme on API < 31 | ✅ shipped |
| Tone mapping table (accent1_80 → primary, etc.) | ✅ shipped |
| Derived `elevation.level1..5` from the neutral surface (to kill the purple cast) | ❌ **not shipped** — `buildDynamicColors` spreads the static base and never touches `elevation` |
| `surfaceDisabled` / `onSurfaceDisabled` derived from neutral1 | ❌ not shipped |
| Wire `buildPaperTheme()` into `App.tsx` | ✅ shipped — and improved: it now takes a `scheme` argument and covers **both light and dark** (the doc was dark-only) |
| CometChat provider fed the same palette | ✅ done (`App.tsx:97-106` + `buildCometChatPalette`) — the doc listed this as an open caveat |
| Live refresh on wallpaper change | ❌ not built (palette is read once per scheme change) |

### Explicitly requested items and where they stand

| Requested item | Where it lives | Status |
|---|---|---|
| **Voice notes** | `ChatScreen.tsx:570-576` classifies `audio/*` documents as `kind:'audio'`; the viewer plays them (`:1499-1520`). **There is no recorder.** | `PARTIAL` |
| **Load-more / pagination** | Backend supports it (`messages.list.before`, `.hasMore`); the UI calls `messages.list` with a constant `limit: 60` and has no `onEndReached`. | `PARTIAL` |
| **Card messages** (`ccCardActionClicked` handled in `App.tsx`) | The **handler** is at `App.tsx:436-467` and supports `openUrl`, `copyToClipboard`, `downloadFile`. **Nothing anywhere sends a card message**: `messages.send` accepts only `text\|image\|video\|audio\|file`, the schema has no custom-message table, and a repo-wide search for `card`/`CustomMessage` returns only that handler. | `DEAD-CODE` |
| **QR screen** (`qr_screen.tsx`) | It is **not** a user QR-code feature. It is a **Builder "Live Preview" scanner**: it scans a QR containing a `builderId`, fetches `https://apivcb.cometchat.io/v1/builders/{builderId}`, and hot-swaps `config/store.ts` with the returned feature-flag config. Only entry point was the dead tooltip menu. | `DEAD-CODE` |
| **AI Agent** (`AIAgents.tsx`) | A 65-line wrapper around UIKit `CometChatUsers` filtered to CometChat role `@agentic`. **Not wired up** — nothing navigates to `AIAgents`, and there is **no AI entity in the Convex schema**. It would not work with a Convex account. | `DEAD-CODE` |
| **Pinned messages** | Dead UIKit panel only. No Convex pin. | `NOT-BUILT` |
| **Saved messages** | Dead UIKit panel only. No Convex save. | `NOT-BUILT` |
| **Search messages** | Dead UIKit `CometChatSearch` only. No Convex search index. | `NOT-BUILT` |
| **Custom accent colour** | Not present anywhere. | `NOT-BUILT` |
| **Language** | `CometChatI18nProvider` is mounted but no picker; all Convex UI copy is hard-coded English. | `NOT-BUILT` |
| **Banned members / report / block / privacy / notification prefs** | Not present on Convex. | `NOT-BUILT` |
| **Account deletion** | Not present. | `NOT-BUILT` |
| **Multi-device behaviour** | Supported implicitly: one `sessions` row per login, token in AsyncStorage, `lastSeenAt` heartbeat. No device-management UI, no "logout this device only" list, no per-device push-token tracking (a single `users.pushToken` field is overwritten by the last login). | `LIVE` (thin) / `PARTIAL` |

---

## Dead features to not replicate

Reaching any of these from the running app would require navigating to a route from a screen that
itself cannot be reached. None of them is part of the product.

### Routes and components to delete outright

| Item | Route / import | Why |
|---|---|---|
| `components/conversations/screens/Messages.tsx` (786 lines) | **never imported by the navigator** | The `Messages` route resolves to `convex/ChatScreen.tsx`. Fully orphaned. |
| `components/conversations/screens/Conversations.tsx` | `Conversation` | Replaced by `convex/ConversationsList.tsx`. Its tooltip menu is the only caller of `CreateConversation`, `AIAgents`, `SavedMessages` and `QRScreen`. |
| `components/conversations/screens/CreateConversation.tsx` | `CreateConversation` | Only reachable from the dead tooltip menu. |
| `components/conversations/screens/SavedMessages.tsx` | `SavedMessages` | CometChat-only data source; nothing produces saved messages. |
| `components/conversations/screens/PinnedMessages.tsx` | `PinnedMessages` | CometChat-only data source. |
| `components/conversations/screens/SearchMessages.tsx` | `SearchMessages` | CometChat `CometChatSearch` over a message store the app no longer writes to. |
| `components/conversations/screens/ThreadView.tsx` | `ThreadView` | CometChat threads. Reachable in theory from `helper.ts:226` (push thread) but no CometChat message notification is ever produced. |
| `components/conversations/screens/UserInfo.tsx` + `UserInfoStyles.tsx` | `UserInfo` | Superseded by `convex/ContactInfoScreen.tsx`. |
| `components/conversations/screens/GroupInfo.tsx` + `GroupInfoStyles.tsx` | `GroupInfo` | Superseded by `convex/ChatInfoScreen.tsx`. |
| `components/conversations/screens/AddMember.tsx` + `AddMemberStyles.tsx` | `AddMember` | Superseded by the Chat info bottom sheet. |
| `components/conversations/screens/BannedMember.tsx` + `BannedMemberStyles.tsx` | `BannedMember` | No Convex ban model exists. |
| `components/conversations/screens/ViewMembers.tsx` | `ViewMembers` | Superseded by the Chat info member list. |
| `components/conversations/screens/TransferOwnership.tsx` + `TransferOwnershipStyles.tsx` | `TransferOwnershipSection` | No Convex transfer mutation exists. |
| `components/users/Users.tsx` | stack `Users` | Superseded by `convex/UsersList.tsx`. Note the **name collision**: the tab route is also `Users`, the stack route is a different component. |
| `components/groups/Groups.tsx`, `GroupHelper.tsx`, `styles.ts` | — | Imported only by the dead `CreateConversation`. |
| `components/AIAgent/AIAgents.tsx` | `AIAgents` | Not wired up; `@agentic` is a CometChat role with no Convex counterpart. |
| `components/conversations/screens/qr_screen.tsx` (581 lines) | `QRScreen` | Builder live-preview scanner; a dev tool, not a product feature. |
| `components/calls/CallDetails.tsx`, `CallHistory.tsx`, `CallParticipants.tsx`, `CallDetailHelper.tsx`, `CallLogDetailHeader.tsx` | `CallDetails` | Not reachable — the live Calls tab has no detail affordance. |
| `components/calls/CallRecordings.tsx` | (inside `CallDetails`) | Dead **and** broken: it calls `NativeModules.FileManager`, which does not exist in this app. |
| `components/conversations/screens/OngoingCallScreen.tsx` | `OngoingCallScreen` | Only the CometChat native push SDK can reach it; Convex calls never notify CometChat. |
| `components/conversations/helper/GroupListeners.ts` | — | Only used by the dead `Messages.tsx`. |
| `hooks/useGroupMemberStatus.ts` | — | Only used by the dead `Messages.tsx`. |
| `navigation/AuthContext.tsx` | — | **No provider is mounted anywhere.** Superseded by `auth/SessionProvider.tsx`. |
| `utils/TooltipMenu.tsx` | — | Only used by the dead `Conversations.tsx`. |
| `utils/ActiveChatContext.tsx` | mounted in `index.js:59` | Provider is live but its only consumer is the dead `Messages.tsx`; the state is never set. |
| `convex/auth.ts:172-195` `auth.updateProfile` | — | Duplicate of `users.updateProfile`; no client calls it. |
| `convex/messages.ts:316-350` `messages.latestForConversation` | — | No client calls it. |
| `convex/push.ts:80-102` `push.sendDataToTokens` | — | No caller; `calls.start` uses `sendToTokens`. |
| `convex/updates.ts:79-88` `updates.removePublished` | — | No caller. |

### Behaviours to not replicate

| Item | Where | Why |
|---|---|---|
| **Card-message action dispatcher** (`openUrl` / `copyToClipboard` / `downloadFile`) | `App.tsx:436-467` | Nothing sends card messages. The handler has **no producer**. |
| **CometChat SDK bootstrap + parallel SDK call ring** | `App.tsx:112-142, 321-393, 485-493`; `auth/cometchatSession.ts` | Two call stacks coexist. The Convex WebRTC stack (`CallScreen` + `IncomingCallOverlay`) is the real one; the SDK stack is inert because no CometChat call is ever created. |
| **`setupPushOnLogin` CometChat push wiring** | `utils/CometChatPushV2.ts` | Wires the CometChat native push package for a chat backend the app no longer uses. |
| **`CallLogs` duplicate route** | `RootStackNavigator.tsx:200` | Same component as the Calls tab. |
| **Pull-to-refresh no-op** | `ConversationsList.tsx:161-162` | `onRefresh={() => {}}` with `refreshing={false}`. |
| **`Config` feature-flag indirection** (Builder / low-code) | `config/store.ts`, `config/config.json` | Only `layout.tabs` is consumed, and `groups` is then filtered out anyway. Everything else is dead weight. |
| **Docs tabs** (Videos as its own tab, Docs) | `chat-ux-spec.md` §7 | Deliberately merged into Photos / dropped before shipping. Keep it that way. |
| **`REACTION_EMOJIS` hard-coded set** | `ChatScreen.tsx:47` | Keep the 6 emoji for parity, but make it a config constant, not a literal, if you want to change it. |

---

## WEB-HARD backlog

Ordered by risk. Items 1–6 are the difference between "the web app works" and "the web app is
broken for a subset of users", and each is a prerequisite for shipping calls at all.

| # | Item | Approach hint |
|---|---|---|
| **1** | **WebRTC 1:1 audio/video calling** (M1–M4, M7–M22) — the single largest parity risk | The signalling model already ports 1:1: keep `calls.signal` / `calls.signals` / `calls.consumeSignals` exactly as they are and use `RTCPeerConnection` + `MediaStream` directly. Use **`livekit-client`** (self-hosted LiveKit server) or **`simple-peer` + `ws`**; do **not** try to reuse `react-native-webrtc`. Render remote video with `<video autoplay playsInline>` and attach the local stream with `srcObject`. **Add a TURN server** — the mobile app is STUN-only (`WebRTCCallScreen.tsx:28-30`) and that is acceptable on a phone but fails on symmetric-NAT corporate networks. Cross-check `docs/audit/11-web-stack-research.md` §"Calls on web". |
| **2** | **Web Push for message notifications** (A6, A7) | `Notification.requestPermission()` must be called from a user gesture. Register a service worker, `PushManager.subscribe()` with a VAPID key, and store the endpoint where you currently store the FCM token. **Backend change required:** `users.pushToken` is a single flat string — a user on phone *and* desktop will overwrite each other. Move to an `endpoints[]` table keyed by user, or a `pushTargets` table. Convex `push.sendToTokens` (firebase-admin) has no web branch. |
| **3** | **Incoming-call notification with Accept / Decline** (A11, A12, A6) | Service worker `showNotification` with `requireInteraction: true` and `actions: [{action:'accept'},{action:'decline'}]`, handled in `notificationclick`. **There is no full-screen intent on the web** — the mobile app's `AndroidCategory.CALL` + `fullScreenAction` behaviour cannot be matched; document that as a known gap. Notification `actions` are **Chromium-only** — Safari users get a plain notification. Send a separate data-only push for calls vs. a display push for messages so Safari does not show two notifications. |
| **4** | **Call state across tab switches / backgrounding** (A13, M16, M35) | Use `document.visibilitychange` and the Page Visibility API, plus `navigator.mediaDevices` devicechange. WebRTC survives a background tab on desktop, but **mobile Safari and Chrome may throttle or suspend a backgrounded call** — test it, and keep a service-worker `message` channel for the pending-call handoff that replaces the mobile `AsyncStorage` + `AppState` pattern (`App.tsx:234-267`). Consider `navigator.wakeLock` to hold the screen on. |
| **5** | **Session token storage** (A23) | The mobile app puts a bearer token in AsyncStorage. In a browser, an XSS turns `localStorage` into account takeover. Issue an **HttpOnly, SameSite=Lax, Secure** cookie instead, and gate the Convex `ConvexHttpClient` behind a Next.js route handler / server action. This forces a real auth refactor — `every` Convex function takes `{ token }` as an explicit arg (`convex/lib/helpers.ts`), so you need a server-side wrapper that injects it. |
| **6** | **Ringback / call audio under the browser autoplay policy** (M15) | `WebRTCCallScreen.tsx:307-315` loops a local `ringback.wav` from the app bundle. In a browser, `AudioContext` starts suspended and only resumes on a user gesture — and an **incoming** call has no gesture. Start the ringtone from a `pointerdown`/`keydown` listener registered once at app start, or accept that the outgoing ringtone is desktop-with-gesture-only. |
| **7** | **Camera flip** (M11) | `_switchCamera()` has no browser equivalent. Use `facingMode: { ideal: 'user' }` / `{ ideal: 'environment' }` and re-acquire the track; hide the control when only one device exists (`navigator.mediaDevices.enumerateDevices`). |
| **8** | **Secure / private token and CORS plumbing for Convex** | `convexConfig.ts` hardcodes the deployment URL. Convex React works in Next.js, but the `token` arg must be threaded server-side (see #5). Set the deployment's allowed origins for the web origin. |
| **9** | **Material You dynamic colour** (A21) | Android exposes `system_accent1_*` through a custom Kotlin module (`DynamicColorModule.kt`). The web has no equivalent. Either ship the static `paperTheme` palette as CSS variables, or generate a scheme in JS from a seed with `@material/material-color-utilities`. Also note `dynamicTheme.ts` never overrides `elevation` — the doc's "kill the purple cast" goal is unmet even on mobile. |
| **10** | **Per-conversation notification cancellation** (E6) | `ChatScreen.tsx:328-330` calls a native module to cancel the notifications tagged with the conversation id. Browsers give you `ServiceWorkerRegistration.getNotifications()` and can only `close()` them one at a time — tag on the client and close on open. |
| **11** | **Mute that actually mutes** (D12, F19) | `members.muted` is stored but `convex/messages.ts:240-279` never filters on it. Until the backend filters, the Mute toggle is cosmetic. |
| **12** | **Presence / online + last-seen** (G7, G12, K15) | `sessions.lastSeenAt` is already heartbeated every 30 s by `requireUser`, and the data even reaches the client inside `messages.list.receipts`. Add a small `presence` query + throttled heartbeat, or use Convex presence. Budget the query — it will be polled by every open chat. |
| **13** | **Link previews** (E41) | Needs a server-side unfurl (fetch the URL, read `og:*` / `twitter:*`, cache). **SSRF guard required** — block private IP ranges and cap the response size and time. Do not fetch from the browser (CORS). |
| **14** | **Haptics** (E54) | `navigator.vibrate` is Android-only and absent on desktop. Treat as progressive enhancement. |
| **15** | **Notification preferences / DND** (L5) | The mobile app has none; if you add them the web version has the same "channels don't exist" problem — a global toggle plus per-conversation, enforced server-side in `messages.send`. |
| **16** | **Message translation** (E55) | Same on both platforms: needs a translation provider and a cache table. Not a browser problem — flagged only because it is easy to mistake for one. |
| **17** | **Call detail / recordings** (M28, M29) | Do **not** port. The mobile implementation is unreachable and broken (missing `FileManager` native module). If web calls need a detail view, build a new one from `calls.history` + `calls.get`, and skip recordings entirely — the `calls` table has no recording entity. |
| **18** | **QR / Builder scanner** (N19) | `BarcodeDetector` is Chromium-only and the feature is a dev tool. Drop it. |
| **19** | **Group calls, screen share, PiP, background audio, DTMF, quality stats** (M32–M38) | All `NOT-BUILT` on mobile, so parity means "do not build". If they become requirements they are each a WEB-HARD project: SFU for group calls (LiveKit), `getDisplayMedia()`, Document Picture-in-Picture, and `RTCPeerConnection.getStats()` polling respectively. |
| **20** | **Deep links / share links** | The mobile app has no universal-link or `Linking` config for deep entry beyond push payloads. If the web app should be linkable (`/messages/:conversationId`), add shareable URLs — but note that `conversationId` is a Convex id, so expose an opaque share token rather than the raw id. |

### Things that are easy to get wrong and are worth calling out

- **Typosquatting risk:** nothing, but note that `AppConstants.tsx:6-7` ships a **live CometChat app id and auth key in source**. The web app should not carry these at all (see `docs/audit/08-native-secrets.md`). Do not copy `AppConstants.tsx` to the web.
- **`setTyping` is unthrottled** (`ChatScreen.tsx:389-393` fires on every keystroke). On the web that is a mutation per keypress — throttle it client-side.
- **`reactions.toggle` deletes all of your reactions on a message** before re-adding one (`convex/reactions.ts:34-45`). Tapping a second emoji replaces the first rather than adding to it. That is the mobile behaviour; replicate it deliberately rather than "fixing" it by accident.
- **`conversations.sharedContent` hard-caps at 300 messages** (`convex/conversations.ts:468`). Media/Files/Links tabs silently truncate on long conversations.
- **`calls.history` hard-caps at 100** (`convex/calls.ts:229`).
- **`messages.list` clamps `limit` to 100** (`convex/messages.ts:34`); the chat asks for 60 and never paginates.
- **`updates.publish` is gated on `username === "yashraj"`** (`convex/updates.ts:49`) — a maintainer backdoor that is part of the public mutation surface.

---

## Count summary

**262 features catalogued.**

### By status

| Status | Count |
|---|---|
| `LIVE` | **157** |
| `PARTIAL` | **10** |
| `DEAD-CODE` | **27** |
| `NOT-BUILT` | **68** |
| **Total** | **262** |

### By web-parity verdict

| Verdict | Count |
|---|---|
| `NATIVE-DIRECT` | **192** |
| `WEB-HARD` | **60** |
| `MOBILE-ONLY` | **10** |
| **Total** | **262** |

### Breakdown by area

| Area | Rows | LIVE | PARTIAL | DEAD-CODE | NOT-BUILT |
|---|---|---|---|---|---|
| 1 · App shell & platform services | 28 | 24 | 3 | 1 | 0 |
| 2 · Authentication | 6 | 3 | 0 | 0 | 3 |
| 3 · Bottom tabs | 3 | 3 | 0 | 0 | 0 |
| 4 · Conversation list | 16 | 10 | 2 | 1 | 3 |
| 5 · Chat screen | 59 | 36 | 2 | 0 | 21 |
| 6 · Chat info (group) | 27 | 18 | 1 | 0 | 8 |
| 7 · Contact info (DM) | 12 | 6 | 1 | 0 | 5 |
| 8 · Forward message | 7 | 6 | 0 | 0 | 1 |
| 9 · Users tab | 9 | 6 | 0 | 0 | 3 |
| 10 · Groups | 7 | 4 | 0 | 0 | 3 |
| 11 · Profile | 15 | 9 | 0 | 0 | 6 |
| 12 · Settings | 9 | 4 | 0 | 0 | 5 |
| 13 · Calls | 39 | 27 | 0 | 2 | 10 |
| 14 · Unreachable UIKit legacy | 25 | 1 | 1 | 23 | 0 |
| **Total** | **262** | **157** | **10** | **27** | **68** |

### Headline numbers for planning

- **192 of 262 features (73%) are `NATIVE-DIRECT`** — a mechanical port. The real chat product
  (conversations, chat, chat info, contact info, forward, users, groups, profile, settings) is
  **100% `NATIVE-DIRECT`**.
- **Every `WEB-HARD` item except three is in calls or push.** The three exceptions are
  token storage, dynamic colour, and link previews.
- **All 10 `MOBILE-ONLY` items** are things the web app should simply not build: the
  battery-optimisation prompt (A19), the APK updater (A20), DeviceInfo version/platform rows
  (K6, L2, L3), the contact importer (I7), CometChat call statistics (M31), the call-recordings
  downloader (M29), and the two CometChat-only bootstrap paths (A4, N25).
- **Convex surface to port: 9 modules, 36 public functions** (see the data-capability section). No
  schema migration is required for the 192 `NATIVE-DIRECT` features — the schema already covers
  them.
- **Schema work is only needed for the `NOT-BUILT` items you choose to add**: message edit
  (`editedAt`), pin (`pinnedAt`/`pinnedBy`), saves, blocks, reports, mentions, threads
  (`parentMessageId`), call duration, group calls, and a multi-endpoint push-target table.
