# 07 - Global State Architecture & Performance Audit

**Repo:** `cometchat-sample-app` ("synomilo") | React Native 0.81.4 | Hermes | New Architecture ON
**Date:** 2026-10-13 | **Scope:** `src/` (18,038 lines TS/TSX) + `App.tsx` + `index.js` + `convex/`
**Reference build:** `synomilo-v1.0.6-release.apk` = **67.15 MB**

---

## Architecture

### 1. What the "global store" actually is

`src/config/store.ts` is 201 lines and holds **exactly one key**. The app's real state is spread across
six independent systems:

| # | System | What it owns | Lifetime |
|---|---|---|---|
| 1 | **zustand** (`useConfigStore`, `src/config/store.ts`) | `config` - one key holding the CometChat-CometBuilder feature-flag/style document from `config.json` | app |
| 2 | **React Context** `SessionProvider` (`src/auth/SessionProvider.tsx`) | `token` (Convex session), `user`, `isLoading`, `signIn`, `signOut` | app |
| 3 | **Convex live queries** (`convex/react`) | *Everything real*: conversations, messages, receipts, users, groups, calls, typing, files | per-screen subscription |
| 4 | **CometChat SDK singleton** (`CometChat`, `CometChatUIKit`) | `loggedInUser`, call/UI event bus, its own conversations/messages cache | process |
| 5 | **AsyncStorage** | `@app_config`, `synomilo.convex.token`, `synomilo.pendingCall`, `appCredentials`, `synomilo.batteryPrompted`, `@config_updated` | disk |
| 6 | **Local `useState`** | everything else: composer text, menus, highlight, pending attachments, filters | per-component |

`useActiveChat` (`ActiveChatContext`, mounted at `index.js:59`) is a **7th** system with exactly one writer
(`conversations/screens/Messages.tsx:160` - a module that is imported by nothing).

### 2. `src/config/store.ts` - complete map

```
State      config: AppConfig                     // the ONLY state key
Actions    updateConfig(Partial<AppConfig>)      // 0 call sites -> DEAD
           resetConfig()                         // 1 call site, inside an unreachable screen
Selectors  useConfigStore                        // raw store (used via .getState()/.setState())
           useConfig<T>(sel) => useConfigStore(s => sel(s.config))   // bound selector helper
```

**Persistence:** *hand-rolled*, not the `persist` middleware.
`initializeConfig()` (`store.ts:143-171`) reads `@app_config` from AsyncStorage, `JSON.parse`s it,
then duck-types **three** shapes (`parsed.data.settings` -> `parsed.settings` -> default). It is fired
at **module scope** (`store.ts:192`) and resolves into `useConfigStore.setState(...)`.

**Findings on the store itself:**

- **No `version`, no `migrate`, no `partialize`.** There is no migration path. The only "migration" is the
  three-branch duck-type at `store.ts:151-160`, which validates presence (`settings && builderId`) but
  **not shape**. A persisted config missing `settings.layout.tabs` or `settings.style.typography.font` passes
  validation and is fed straight into `App.tsx:100` (`styleConfig.typography.font`) - an unguarded property
  chain that throws during render.
- **`@app_config` is only ever written by `qr_screen.tsx:112-115`** - a dev-only builder-preview screen that
  is registered in the navigator but has no reachable entry point in a release build. In production the key
  is always absent and `initializeConfig()` always falls through to `config.json`.
- **No TOKEN or password is written by the store**, but see Finding 1 (`AppConstants.authKey`) and Finding 2
  (Convex session token in plaintext AsyncStorage).
- **All 63 `useConfig()` call sites** return stable sub-references from `state.config`, so zustand's
  `useSyncExternalStore` identity check is satisfied - **no selector-induced render loop**. This is the one
  thing the store gets right. `useStore(` without a selector: **0 occurrences** anywhere in `src/`.

### 3. Dual / triple sources of truth

| Fact | Where it lives | Count | Sync | Failure mode |
|---|---|---|---|---|
| **Current user** | (1) `SessionProvider.user` (Convex `auth.me`) (2) `CometChatUIKit.loggedInUser` (3) `App.tsx:92` `isLoggedIn` derived from (1) (4) `AuthContext.isLoggedIn` (`src/navigation/AuthContext.tsx`) | **4** | none - (2) is set asynchronously by `ensureCometChatSession()` (`App.tsx:148-152`) | On a cold start where CometChat login is slow or fails, (2) is `null` while (1) is populated, so `CallDetailHelper.tsx:50`, `GroupHelper` and `helper.ts:170` all read `null` and mis-render. `AuthContext` (4) is never provided by anyone, so it silently returns the default `isLoggedIn:false` forever. |
| **Conversations list** | (1) Convex `api.conversations.list` (used by the live tabs) (2) CometChat SDK cache via `CometChatConversations` in `conversations/screens/Conversations.tsx` | **2** | none | Both are subscribed in the same process. The CometChat one renders CometChat `Conversation` objects into a navigator whose `Messages` route is bound to the Convex `ChatScreen`. |
| **Unread count** | (1) Convex `unreadCount` on `conversations.list` (2) `markRead` mutation from `ChatScreen.tsx:325` (3) CometChat SDK receipts / `ccMessageRead` emitted from `helper.ts:264-308` | **3** | partial: (2)->(1) only | Tapping a push runs the CometChat read path (3) while the visible list reads (1). The badge does not clear. |
| **Chat read state** | (1) `ChatScreen.tsx:323-332` fires `markRead` whenever `messages.length` changes (2) CometChat `markConversationAsRead` from the push handlers | **2** | none | Two independent writers to the same server field. |
| **Incoming call** | (1) `IncomingCallOverlay` <- Convex `api.calls.incoming` (2) `App.tsx:321-393` `CometChat.addCallListener` + `CometChatIncomingCall` (3) Notifee full-screen notification (`callNotifications.ts:51`) | **3** | none | **All three can ring for one call.** `IncomingCallOverlay` (absolute fill, z-index 100) and `CometChatIncomingCall` both mount; whichever mounts last wins visually. |
| **Mute state** | (1) Convex `rows[].muted` (2) `ChatInfoScreen.tsx:102` `mutedOverride` local state | **2** | optimistic + rollback | Rollback happens only on throw (`:177`); a successful-but-stale (1) wins the next render and the toggle appears stuck. |
| **Theme** | (1) `PaperProvider` (MD3, `App.tsx:551`) (2) `CometChatThemeProvider` (`App.tsx:483`) (3) Android `DynamicColor` native module | **3** | async, one-way | (3) resolves *after* first paint (Finding 12) -> visible flash. |
| **Active chat** | (1) `ActiveChatContext` (2) `ChatScreen`'s own `conversationId` route param | **2** | none | (1) has no readers in the live app. |
| **App credentials** | (1) `AppConstants.authKey` hardcoded at `AppConstants.tsx:6` (2) `AsyncStorage['appCredentials']` | **2** | `??` fallback at `App.tsx:118-120` | The storage value silently overrides the hardcoded one; the user cannot tell which is live. |

**Bottom line:** *current user* (4x), *incoming call* (3x), *unread* (3x) and *conversations* (2x) are each
duplicated with no synchronisation mechanism. This is the dominant source of stale-UI bugs in this app.

---
## Findings

### 1. `[CRITICAL]` CometChat **Auth Key** is hardcoded in the app bundle
`src/utils/AppConstants.tsx:6`
```ts
authKey: 'ee2fe34b0ca0817cdb650aa4f8b985fb07ed1245',
```
The CometChat **Auth Key** is a server-side secret (REST-API admin-equivalent access). It is embedded in
`index.android.bundle` and extractable from any installed APK. It is also mirrored to
`AsyncStorage['appCredentials']` (`AppCredentials.tsx:160`).
**Fix:** rotate the key; remove it from `AppConstants.tsx`; have `CometChatUIKit.init` consume a per-build
`buildConfigField` or a first-run server exchange. Never commit it.

### 2. `[CRITICAL]` Convex session token stored in plaintext AsyncStorage
`src/auth/SessionProvider.tsx:15,50,77,86` - `synomilo.convex.token` is a non-expiring bearer token.
AsyncStorage is an unencrypted file readable on a rooted device or via a backup extraction.
No Android Keystore / iOS Keychain wrapper exists anywhere in the repo.
**Fix:** wrap with `react-native-keychain` and store an opaque key id.

### 3. `[CRITICAL]` CometChat push handlers navigate to the Convex `ChatScreen` with CometChat params -> permanent spinner
`src/utils/CometChatPushV2.ts:63-74` -> `src/utils/helper.ts:289 / 324` -> `StackActions.push('Messages', {user, group})`.
The `Messages` route is bound to `src/components/convex/ChatScreen.tsx` (`RootStackNavigator.tsx:146`),
which reads `route.params?.conversationId` (`ChatScreen.tsx:244`). With CometChat params there is no
`conversationId`, so all three `useQuery`s pass `'skip'`, `thread === undefined`, and
`isSubscribed === false` (`ChatScreen.tsx:1062`) -> the screen renders an **unconditional `ActivityIndicator`**
(`:1175-1178`) forever. The user taps a notification and the app appears to hang.
**Fix:** delete the `@cometchat/push-notifications-react-native` tap path (`CometChatPushV2.ts:63-74`,
`helper.ts:245-331`) - FCM + Notifee already handle every notification in `App.tsx` - or map the CometChat
`conversationId` to a Convex id before navigating.

### 4. `[CRITICAL]` `theme` object is rebuilt on **every** `AppInner` render, invalidating 28 `useTheme()` consumers
`App.tsx:97-106` -> passed to `CometChatThemeProvider theme={theme}` at `App.tsx:483`.
`buildCometChatPalette()` runs **2x** and `createTypography()` **2x** per render (each allocates an 11-key
typography object - `themeTypography.ts:52-84`). `AppInner` re-renders on `isInitializing`, `sessionLoading`,
`callReceived`, `hasValidAppCredentials`, `batteryPromptVisible`, session changes, and Convex
mutation-hook identity changes. Each of those produces a brand-new `theme` object, so the CometChat theme
context value changes and **all 28 `useTheme()` call sites re-render**, each rebuilding every inline
`style={[..., theme.typography.x, {color: ...}]}` array.
**Fix:** wrap in `useMemo(() => ({ light: {...}, dark: {...} }), [paperTheme, font])` and call
`createTypography` **once**, reusing the result for both schemes.

### 5. `[HIGH]` `NavigationContainer theme` is a fresh object every render
`src/navigation/RootStackNavigator.tsx:57-63` and `:74-79`. `RootStackNavigator` is a child of `AppInner`, so
it re-renders on every Finding-4 trigger. A new `theme` identity on `NavigationContainer` invalidates React
Navigation's theme context and forces a re-render of the **entire navigator tree** (stack + tabs + mounted
screens).
**Fix:** `const NavigationTheme = useMemo(() => ({...}), [theme.color.background1, scheme]);`

### 6. `[HIGH]` ~4,000 lines of unreachable legacy screens are eagerly imported and evaluated at startup
`src/navigation/RootStackNavigator.tsx:9-43` statically imports 18 screen modules. Only `Groups` (`:40`),
`Messages`/`ChatScreen` (`:21`), `Profile`, `Settings`, `ChatInfo`, `ContactInfo`, `ForwardMessage`,
`CallScreen` and the auth screens have any reachable entry point in a release build. Never reached from any
`navigate()`/`push()` call in the codebase: `Conversation`, `CreateConversation`, `SavedMessages`,
`PinnedMessages`, `UserInfo`, `AddMember`, `BannedMember`, `ViewMembers`, `GroupInfo`, `TransferOwnership`,
`SearchMessages`, `QRScreen`, `CallLogs`, `CallDetails`, `AIAgents`, `Users`.
Total in the unreachable set: **6,888 lines / 38% of `src/`**. Metro evaluates all of them at startup (they
are in `App.tsx`'s import graph), including `qr_screen.tsx` (551 lines, pulls `react-native-vision-camera`) and
`CallDetails.tsx` (429 lines, pulls the Calls SDK + `FileManager`).
`conversations/screens/Messages.tsx` (731 lines) is imported by *nothing* - dead but not bundled.
**Fix:** delete the unreachable screens; for anything kept, use `React.lazy(() => import(...))`.

### 7. `[HIGH]` zustand `updateConfig` is dead; `resetConfig` is dead-in-practice
`src/config/store.ts:179` (`updateConfig`) - **0 call sites** across `src/`, `App.tsx`, `index.js`.
`src/config/store.ts:185` (`resetConfig`) - 1 call site, `conversations/screens/Conversations.tsx:71`, inside a
screen with no reachable route (Finding 6).
**Fix:** delete both actions; reduce `ConfigStore` to `{ config }` + the `useConfig` selector helper.

### 8. `[HIGH]` `useConfig` has no schema/version guard; a malformed persisted config crashes render
`src/config/store.ts:151-165` validates only `settings && builderId`. `App.tsx:88` guards
`state?.settings?.style`, but `App.tsx:100` immediately dereferences `styleConfig.typography.font`.
A persisted document with `settings` present but `settings.style` absent -> `TypeError` on the first render
of `AppInner`, caught by `AppErrorBoundary` -> **"Something went wrong" screen**, unrecoverable without
reinstalling.
**Fix:** replace the duck-type with zustand `persist` + `version`/`migrate`, and validate with a single
`assertConfig()` that falls back to `config.json` on any failure.

### 9. `[HIGH]` `ChatScreen` `renderItem` depends on the whole `messages` array and on `theme`
`src/components/convex/ChatScreen.tsx:1049-1059`. `messages` is a `useMemo` over `thread` (`:297-300`); the
Convex `api.messages.list` result identity changes on **any** mutation touching the conversation - a reaction,
a read receipt, a typing tick. Combined with `theme` (Finding 4) this re-creates `renderItem` and forces
FlatList to re-render every visible cell.
**Fix:** depend only on `[conversation?.type, user?._id, highlightId, tickFor, scrollToMessage]`, read
`messages[index+1]` from a ref, and wrap the row in `React.memo`.

### 10. `[HIGH]` FlatList `renderItem` is an inline arrow in 5 of 9 lists
`ConversationsList.tsx:163`, `UsersList.tsx:128`, `GroupsList.tsx:171`, `GroupsList.tsx:279`,
`ChatScreen.tsx:1231`. A new function identity each parent render makes `VirtualizedList` invalidate its
`renderItem` and re-render all mounted cells.
`keyExtractor` is stable **everywhere** (`item._id` / `item.id`) except three legacy call-detail lists
(`CallHistory.tsx:233`, `CallParticipants.tsx:142`, `CallRecordings.tsx:229`) which use
`item.sessionId + '_' + index` - an index in the key forces full remounts on prepend.
**Fix:** hoist each to `useCallback`; drop `+ '_' + index`; add `React.memo` to the row component.
No list sets `getItemLayout` (variable-height rows make it unsafe - acceptable) and none sets
`removeClippedSubviews` (Android-only; safe on the three fixed-height lists).

### 11. `[HIGH]` ScrollView footguns - the whole user table rendered non-virtually
- `src/components/convex/ChatInfoScreen.tsx:687-700` - `ScrollView` with `candidates.map(...)` over **every
  user in the deployment** (`api.users.list` -> `ctx.db.query("users").collect()`, `convex/users.ts:9`,
  unbounded). 500 users = 500 `TouchableOpacity` + `Checkbox` mounted at once.
- `src/components/login/SampleUser.tsx:204`, `AppCredentials.tsx:192`, `Login.tsx:111`, `SignUp.tsx:137`,
  `ProfileScreen.tsx:203` - `ScrollView` with inline `style={[...]}` object literals rebuilt every render.

**Fix:** replace `ChatInfoScreen`'s `ScrollView` + `map` with a `FlatList`; hoist the style objects.

### 12. `[HIGH]` Flash-of-wrong-theme on cold start (Android 12+)
`App.tsx:530-547` + `src/theme/dynamicTheme.ts:176-195`.
1. `useState(() => staticFallbackTheme(scheme))` -> **paint 1** with the static palette.
2. `useEffect` sets `staticFallbackTheme(scheme)` again (an extra guaranteed re-render with an
   identical-but-new object).
3. `buildPaperTheme(scheme)` awaits `DynamicColor.getSystemColors()` - a bridge call into
   `DynamicColorModule.kt`, which performs **60** `Resources.getIdentifier` lookups - and resolves a frame
   later -> **paint 2** with the wallpaper-derived palette.

So on Android 12+ users see a full-screen colour transition on every cold start. Below API 31 the native
module resolves `null` and the fallback is returned, but the promise round-trip still costs one commit.
**Fix:** persist the resolved palette in `AsyncStorage` and seed `useState` synchronously from it,
refreshing in the background.

### 13. `[HIGH]` Daylight/date formatting runs inside `FlatList` item renderers
- `src/components/convex/ChatScreen.tsx:764` - `dayjs(older.createdAt).isSame(item.createdAt,'day')` (2 `dayjs` allocations)
- `ChatScreen.tsx:999` - `dayjs(item.createdAt).format('h:mm A')`
- `ChatScreen.tsx:784` -> `formatDayLabel` (`:111-123`) - **4 more** `dayjs()` calls (`dayjs()`,
  `dayjs().subtract(1,'day')`, `dayjs().subtract(6,'day')`)

A 60-message conversation allocates **~7 `dayjs` objects per cell render** (~1-2 us each, so ~0.5-1 ms per
full list pass), multiplied by every re-render caused by Findings 4/5/9.
`ConversationsList.tsx:37-47` and `Calls.tsx:37-40` do the same inside `renderItem`. `initialsFor()`
(`ConversationsList.tsx:49`, `UsersList.tsx:28`, `GroupsList.tsx:39`, `ForwardMessageScreen.tsx:36`,
`ContactInfoScreen.tsx:12`, `ChatInfoScreen.tsx:43`) runs `split(/\s+/).filter().slice().map().join()` -
5 array allocations per row.
**Fix:** precompute a `useMemo`'d `Map<messageId, {dayLabel, timeLabel, showDay}>` alongside `messages`;
add a module-scope `initialsCache`.

### 14. `[HIGH]` `<Video>` components are instantiated inside `FlatList` cells
`src/components/convex/ChatScreen.tsx:913-919` - every video message in the visible window mounts a full
`react-native-video` `ExoPlayer` instance (`paused muted resizeMode="cover"`). ExoPlayer allocates a codec
surface and takes audio focus per instance regardless of `paused`. ~10 visible cells = 10 players.
**Fix:** render a static `<Image>` poster in the cell; mount the player inside the viewer `Modal` that
already exists (`ChatScreen.tsx:1489`).

### 15. `[MEDIUM]` `markRead` fires on every message-count change
`src/components/convex/ChatScreen.tsx:323-332` - deps `[token, conversationId, messages.length, markRead]`.
Any incoming message increments `messages.length` -> an extra `markRead` mutation -> a server round-trip ->
a `members.lastReadAt` patch -> a new `conversations.list` result -> a `ConversationsList` re-render. A busy
group amplifies this into a loop.
**Fix:** debounce it, or fire only when the screen regains focus (`useFocusEffect`).

### 16. `[MEDIUM]` Two independent awaits gate the first paint
`src/config/store.ts:192-198` runs `initializeConfig().then(c => useConfigStore.setState(...))` at module
import time. `App.tsx:469-478` then blocks the entire first paint until `CometChatUIKit.init` resolves, and
`SessionProvider.tsx:48-65` blocks again until AsyncStorage returns (surfaced as `sessionLoading`).
**Fix:** render the app shell immediately; gate only the navigator.

### 17. `[MEDIUM]` `screenOptions` allocates a fresh object per call in `BottomTabNavigator`
`src/navigation/BottomTabNavigator.tsx:99` - `tabs.filter(...)` allocates a new array each render;
`:104-140` - the `screenOptions` **function** returns a fresh object literal each call, including a new
`tabBarStyle` array and new `tabBarIcon`/`tabBarLabel` closures.
**Fix:** `const visibleTabs = useMemo(() => tabs.filter(...), [tabs]);` and hoist the static parts.

### 18. `[MEDIUM]` `Dimensions.get('window')` and `useWindowDimensions()` are both used; several are stale
`src/components/convex/ChatScreen.tsx:240-241` - both, in the same component. `ChatInfoScreen.tsx:30`
evaluates `Dimensions.get('window').width / 3 - 8` **at module scope**; `Skeleton.tsx:6` and
`SampleUser.tsx:49` do the same - module-scope reads never update on rotation/tablet.
`AppCredentials.tsx:47` and `SignUp.tsx` call `Dimensions.get('window')` **inside the component body**.
**Fix:** use `useWindowDimensions()` everywhere; hoist `THUMB_SIZE` into a `useMemo`.

### 19. `[MEDIUM]` Uploads buffer the entire file in the JS heap - 3 duplicated copies
`ChatScreen.tsx:153-161`, `ChatInfoScreen.tsx:46-54`, `ProfileScreen.tsx:42-50` each re-implement the same
`uriToBlob()` XHR shim. `xhr.responseType = 'blob'` then `fetch(postUrl, {body: blob})` holds the **entire**
file as a JS heap object. A 50 MB video = 50 MB of heap plus a copy inside the RN networking layer -> OOM on
mid-range Android.
**Fix:** pass the `content://`/`file://` URI straight to an OkHttp-backed upload, or expose a native upload
module.

### 20. `[MEDIUM]` 94 `console.log` / `console.warn` calls ship to production
**94** across 31 files. `__DEV__` guards exist in only **3** spots (`CometChatPushV2.ts:57,64,79,87`).
Worst offenders, all unguarded: `src/utils/helper.ts` (12), `conversations/screens/UserInfo.tsx` (9),
`utils/CometChatPushV2.ts` (9), `conversations/screens/Messages.tsx` (6),
`conversations/screens/GroupInfo.tsx` (5), `App.tsx` (4), `index.js` (3 - the **global** error handlers at
`index.js:40,53`), `notifications/*` (7). `index.js:40` serialises every uncaught error - including the Convex
token carried in the error context - to logcat on every device.
**Fix:** strip `console.*` in release via `babel-plugin-transform-remove-console`, or route to Sentry with a
scrubbing `beforeSend`.

### 21. `[MEDIUM]` Remote `Image`s have no placeholder and default cross-fade - 9 instances
`ChatScreen.tsx:902,1239,1480`, `ConversationsList.tsx:180`, `UsersList.tsx:144`, `GroupsList.tsx:185`,
`ChatInfoScreen.tsx:360,457`, `ProfileScreen.tsx:210`.
**Good news:** every one is explicitly sized (`styles.rowAvatarImage {width:'100%',height:'100%'}`, etc.), so
the "un-sized remote image -> layout thrash" anti-pattern is **absent** - **0 instances found**.
`resizeMode` is explicit on only 3 of 9 (`ChatScreen.tsx:905,1486`). None sets `defaultSource`, so every scroll
re-triggers RN's default 300 ms cross-fade.
**Fix:** add a `defaultSource`/placeholder to the 9 and `fadeDuration={0}` inside lists.

### 22. `[MEDIUM]` `config.json` is imported and spread synchronously at module scope on the critical path
`src/config/store.ts:2` and `:176` - the document is inlined into the bundle and parsed before
`AppRegistry.registerComponent`. ~2 KB today.
**Fix:** negligible now, but move it behind a lazy `require()` inside `initializeConfig` if it grows.

### 23. `[LOW]` `AuthContext` is a context with no provider and no readers
`src/navigation/AuthContext.tsx` - consumed only at `Conversations.tsx:41` (an unreachable screen); nothing
ever renders `<AuthContext.Provider>`. **Delete.**

### 24. `[LOW]` `react-native-background-timer` is installed, autolinked, and never used
0 imports in `src/`. It appears in the generated `PackageList.java` (`com.ocetnik.timer.BackgroundTimerPackage`),
so it is compiled and dexed on every build. It *would* bypass JS timers and drain battery, but nothing calls
it, so today it is pure bloat.

### 25. `[LOW]` `UpdateChecker` polls every 60 s for the app's entire lifetime
`src/updater/UpdateChecker.tsx:82`. The interval is correctly cleared (`:89`), but a `useAction` round-trip
every minute while foregrounded is pure wakeup cost.
**Fix:** poll on mount + `AppState -> active` (already wired at `:83`) and drop the interval, or raise it to 6 h.

### 26. `[LOW]` `Intl` option objects rebuilt per `toLocale*` call
`src/utils/helper.ts:76-90` constructs two fresh `Intl.DateTimeFormatOptions` objects per invocation. Only in
the (unreachable) `getLastSeenTime` helper. Hoist to module scope.

### 27. `[LOW - actually a strength]` `useEffect` hygiene is clean
An automated scan of all 47 `useEffect` hooks across `src/`, `App.tsx` and `AppErrorBoundary.tsx` found
**zero** with a missing dependency array and **zero** with object/array/arrow literals in the deps. This is a
real strength of the codebase and should be preserved.

---

## Perf hot spots

| # | Rank | Location | Issue | Est. impact | One-line fix |
|---|---|---|---|---|---|
| 1 | **P0** | `App.tsx:97-106` | `theme` object + 4 palette/typography builds per render -> 28 `useTheme()` consumers re-render | ~4-9 ms + full-subtree reconcile on every `AppInner` render; triggers during init, session load, battery prompt, incoming call | Wrap in `useMemo` keyed on `[paperTheme, font]`; call `createTypography` once |
| 2 | **P0** | `RootStackNavigator.tsx:57-63` | New `NavigationContainer theme` object per render -> whole navigator tree re-renders | Same order as #1, multiplied across tabs + mounted screens | `useMemo(..., [theme.color.background1, scheme])` |
| 3 | **P0** | `RootStackNavigator.tsx:9-43` | 18 eagerly-imported screens, 16 unreachable (~4,000 LOC) evaluated at startup | ~150-400 ms added to cold start (module eval of CometChat UIKit subtrees + vision-camera + calls SDK) | Delete unreachable screens; `React.lazy` the rest |
| 4 | **P1** | `ChatScreen.tsx:913` | `<Video>` per video cell | 8-12 ExoPlayer instances per screen; 20-60 MB extra RSS, jank on scroll | Poster `<Image>` in cell; player only in the viewer `Modal` |
| 5 | **P1** | `ChatScreen.tsx:1049-1059` | `renderItem` deps include `messages` + `theme` | Every Convex push (receipt/reaction/typing) re-renders all visible cells | Drop `messages` from deps; `React.memo` the row |
| 6 | **P1** | `ConversationsList.tsx:163`, `UsersList.tsx:128`, `GroupsList.tsx:171,279`, `ChatScreen.tsx:1231` | Inline `renderItem` arrows | New identity each render -> `VirtualizedList` invalidation | `useCallback` |
| 7 | **P1** | `ChatScreen.tsx:764,784,999`; `ConversationsList.tsx:37`; `Calls.tsx:37` | 2-6 `dayjs()` per cell | ~0.5-1 ms per 60-row pass; amplified by #1/#2/#5 | Precompute labels in one `useMemo` keyed on `thread` |
| 8 | **P1** | `App.tsx:469-478`, `SessionProvider.tsx:48-65` | Two sequential awaits gate first paint | Full blank frame until `CometChatUIKit.init` **and** AsyncStorage resolve | Paint the shell; gate only the navigator |
| 9 | **P2** | `App.tsx:530-547` | Theme flash (paint 1 -> paint 2) | Visible full-screen colour transition on every Android 12+ cold start | Persist the resolved palette; render it synchronously |
| 10 | **P2** | `ChatInfoScreen.tsx:687-700` | All users `.map()` inside a `ScrollView` | 500 nodes mounted at once | `FlatList` |
| 11 | **P2** | `ChatScreen.tsx:323-332` | `markRead` on every `messages.length` change | Mutation + `conversations.list` invalidation per incoming message | Debounce / fire on focus |
| 12 | **P2** | `ChatScreen.tsx:153`, `ChatInfoScreen.tsx:46`, `ProfileScreen.tsx:42` | `uriToBlob()` copies the whole file into the JS heap (x3 duplicated) | OOM on >20 MB attachments | Stream the URI natively |
| 13 | **P2** | `UpdateChecker.tsx:82` | 60 s `setInterval` for the app's lifetime | 1 network wakeup/min while foregrounded | Poll on focus only |
| 14 | **P3** | `BottomTabNavigator.tsx:99,104-140` | New arrays/objects in `screenOptions` per render | Small, but defeats React Navigation's option memoisation | `useMemo` |
| 15 | **P3** | `ChatScreen.tsx:240`, `ChatInfoScreen.tsx:30`, `Skeleton.tsx:6` | Redundant / stale `Dimensions.get` | Rotation bugs + a per-render bridge read | `useWindowDimensions()` |
| 16 | **P3** | 94 `console.log` across 31 files | Unguarded logs in release | Logcat I/O on the hot path; `index.js:40` serialises errors incl. tokens | Strip via babel in release |

---

## Leak census

**10 confirmed leaks.** Every Convex subscription, `CometChat.add*Listener`,
`CometChatUIEventHandler.add*Listener`, `Notifee.onForegroundEvent`,
`messaging().onMessage` / `onNotificationOpenedApp` / `onTokenRefresh`, `AppState.addEventListener`,
`Keyboard.addListener`, `BackHandler.addEventListener`, `DeviceEventEmitter.addListener`, and every
`setInterval`/`setTimeout` declared **inside an effect** **is** correctly released. The leaks are the
resources that have no subscription API to begin with.

| # | File:line | Resource | Symptom |
|---|---|---|---|
| L1 | `src/components/conversations/screens/qr_screen.tsx:63-80` | `Animated.loop(...).start()` - **no cleanup returned** | An infinite 2 s-pulsing animation keeps driving the UI thread at ~60 fps for the rest of the process lifetime after unmount. Worst leak in the app. |
| L2 | `AppErrorBoundary.tsx:33` | `Appearance.addChangeListener` in `componentDidMount` - **no `componentWillUnmount`** | The boundary is effectively permanent so benign today, but every remount stacks a listener that calls `setState` on a dead instance. |
| L3 | `App.tsx:334` | `setTimeout(..., 2000)` inside `onIncomingCallReceived` | Never cleared. Two calls while a call is active stack two timers, each firing `CometChat.rejectCall` plus a `console.log`. Timers outlive an unmount. |
| L4 | `src/components/convex/ChatScreen.tsx:702` | `setTimeout(() => setHighlightId(null), 1200)` | Uncancelled; on fast back-then-forward navigation it clears the *new* screen's highlight 1.2 s early - a stale-state bug, not just a leak. |
| L5 | `src/components/convex/ChatScreen.tsx:1189` | `setTimeout(..., 250)` in `onScrollToIndexFailed` | Uncancelled; scrolls a list that is already torn down. |
| L6 | `src/components/login/Login.tsx:68` | `setTimeout(() => setToastMessage(null), 2800)` | `setState` after unmount on every failed login. |
| L7 | `src/components/login/SignUp.tsx:76` | `setTimeout(() => setToastMessage(null), 2800)` | Same. |
| L8 | `src/components/login/AppCredentials.tsx:126` | `setTimeout(() => setToastMessage(null), 2500)` | Same. |
| L9 | `src/components/calls/CallDetails.tsx:196` | `setTimeout(() => setToastMessage(null), 3000)` | Same, inside a CometChat listener - can fire repeatedly. |
| L10 | `src/components/calls/WebRTCCallScreen.tsx:115-171` | `RTCPeerConnection` + 3 `pc.addEventListener` handlers | Race: `disposed` is checked at `:108` **before** `new RTCPeerConnection` at `:115`. If the effect cleanup runs while `getUserMedia` is in flight, the peer connection created afterwards is never `close()`d and its tracks are never stopped -> **held camera + microphone + ICE thread**. |

**Verified correctly cleaned up (for the record):** `App.tsx:209-213, 266, 305, 389-392, 464-466`;
`SettingsScreen.tsx:27`; `UpdateChecker.tsx:88-91, 136`; `useIsKeyboardVisible.ts:21-24`;
`useGroupMemberStatus.ts:119-122`; `IncomingCallOverlay.tsx:110-112`; `ChatScreen.tsx:334-340`;
`WebRTCCallScreen.tsx:245, 256`; `GroupHelper.tsx:90, 341`; `Groups.tsx:55`; `Skeleton.tsx:103`;
`UserInfo.tsx:115-118, 227`; `Messages.tsx:213, 248, 352-361`; `ThreadView.tsx:137-138`;
`GroupInfo.tsx:118-124, 141`; `AddMember.tsx:59, 79`; `ViewMembers.tsx:47`; `CallRecordings.tsx:61-65`;
`AppCredentials.tsx:120`; `setupPushOnLogin` (`CometChatPushV2.ts:140`).
`index.js:18, 28, 34` register headless handlers at module scope - correct and intentional (one per JS context).

---

## Dependency bloat

`package.json` declares **42 runtime dependencies**. Each was grepped against `src/`, `App.tsx`, `index.js`,
and the `babel` / `metro` / `gesture-handler` configs.

### Unused - **10 of 42** (24%)

| Package | JS imports | Autolinked native package (compiled into the APK) | node_modules | Verdict |
|---|---|---|---|---|
| `@react-native-community/datetimepicker` | **0** | `RNDateTimePickerPackage` | 15.8 MB | **Remove.** Dex + resource bloat for nothing. |
| `@react-native-community/netinfo` | **0** | `NetInfoPackage` | 6.3 MB | **Remove.** |
| `@react-native-firebase/auth` | **0** | `ReactNativeFirebaseAuthPackage` -> pulls `play-services-auth`, `recaptcha`, `play-services-fido` (all visible as `.properties` in the shipped APK) | 8.7 MB | **Remove.** Confirmed present in the APK. |
| `@react-native-firebase/database` | **0** | `ReactNativeFirebaseDatabasePackage` -> `firebase-database-collection` | 8.2 MB | **Remove.** Confirmed present in the APK. |
| `react-native-background-timer` | **0** | `BackgroundTimerPackage` | 5.1 MB | **Remove** (Finding 24). |
| `react-native-localize` | **0** | `RNLocalizePackage` | 6.7 MB | **Remove** (the CometChat UIKit ships its own i18n). |
| `@react-native/new-app-screen` | **0** | - (JS only) | 0.1 MB | **Remove.** RN template leftover. |
| `firebase-admin` | **0** | - | 13.4 MB | **Remove from `dependencies`.** A Node/Convex-side package with no business being an RN runtime dep; it bloats `npm ci` on every CI run. |
| `@noble/hashes` | **0 in app code** - used only by `convex/auth.ts` (Convex server runtime) | - | 0.7 MB | **Keep but relocate** to a server-side manifest; it should not be an RN runtime dep. |
| `react-native-callstats` | **0** | not autolinked (no RN package) | 0.6 MB | **Remove.** Dead sample-app leftover. |

### Used, but only from an unreachable screen - **1**

| Package | JS imports | Note |
|---|---|---|
| `react-native-vision-camera` | 1 - `conversations/screens/qr_screen.tsx:10` | `libVisionCamera.so` (0.26 MB x2 ABIs) plus **MLKit barcode scanning** (`play-services-mlkit-barcode-scanning.properties` is in the APK) for a screen with **no reachable route** (Finding 6). Removing the screen removes a large dex slice. |

### Retained (32) - verified in use

`@cometchat/{calls-sdk-react-native, chat-sdk-react-native, chat-uikit-react-native, push-notifications-react-native}`,
`@notifee/react-native`, `@react-native-async-storage/async-storage`,
`@react-native-clipboard/clipboard`, `@react-native-documents/picker`, `@react-native-firebase/app`
(peer of messaging), `@react-native-firebase/messaging`,
`@react-native-vector-icons/material-design-icons`,
`@react-navigation/{bottom-tabs, native, native-stack, stack}`, `convex`, `dayjs`, `react`, `react-native`,
`react-native-device-info`, `react-native-gesture-handler`, `react-native-image-picker`,
`react-native-paper`, `react-native-safe-area-context`, `react-native-screens` (required by
`@react-navigation/*`; not imported directly), `react-native-svg`, `react-native-url-polyfill`,
`react-native-video`, `react-native-webrtc`, `zustand`.

> `react-native-url-polyfill` is **required**: `index.js:1` and again at `notifications/background.ts:1`,
> which runs in the headless JS context where the polyfill has not been applied. Do not remove it.

### APK composition (`synomilo-v1.0.6-release.apk`, 67.15 MB)

| Slice | Size | Detail |
|---|---|---|
| `lib/` (2 ABIs) | **40.92 MB** | `libjingle_peerconnection_so.so` **10.86 MB x2 = 21.7 MB** (react-native-webrtc), `libreactnative.so` 5.61, `libhermes.so` 2.04, `libappmodules.so` 1.46, `libc++_shared.so` 1.23, `libreact_codegen_rnscreens.so` 0.82, `libreact_codegen_rnsvg.so` 0.70, `libVisionCamera.so` 0.26 |
| `classes*.dex` (x4) | **30.97 MB** | 8.46 + 8.88 + 7.97 + 5.66 - dominated by Firebase / Play-Services / MLKit / CometChat |
| `assets/` | **11.37 MB** | JS bundle **7.05 MB**, `MaterialDesignIcons.ttf` 1.25 MB, Inter x3 = 1.99 MB, Times New Roman x3 = 0.68 MB, Roboto x3 = 0.40 MB |
| `res/` | 4.27 MB | includes the 5 Marvel PNGs replicated across mdpi/xhdpi/xxhdpi/xxxhdpi |
| `resources.arsc` | 1.75 MB | |

**Estimated savings:** enabling **ABI splits** (`arm64-v8a` only) removes ~16 MB of `lib/`; removing the 9
unused native packages removes an estimated **6-9 MB of dex**; `React.lazy`-ing the unreachable screens
removes an estimated **1.5-2.5 MB** of the JS bundle.
**Realistic target: 67 MB -> ~44 MB (-35%).**

---

## Slimming plan

Ordered by benefit/risk. Each step is independently shippable.

| # | Change | Expected benefit | Risk |
|---|---|---|---|
| **1** | **Rotate the CometChat Auth Key and delete `authKey` from `src/utils/AppConstants.tsx:6`.** Stop mirroring it to `AsyncStorage['appCredentials']`. | Removes a shipped server secret. Not a size win - a security win. | Low (one key rotation + a per-build secret path). **Do this first.** |
| **2** | **Remove the 9 unused dependencies** (`datetimepicker`, `netinfo`, `firebase/auth`, `firebase/database`, `background-timer`, `localize`, `new-app-screen`, `callstats`; move `firebase-admin` + `@noble/hashes` to a server manifest). | **-6 to -9 MB APK** (dex) · -64 MB `npm ci` · one fewer `PackageList` entry | Low - zero JS imports; rebuild and smoke-test. |
| **3** | **Enable ABI splits / `arm64-v8a` only** in `android/app/build.gradle` (`splits.abi` + `universalApk = false`), or ship an AAB. | **-16 MB APK** | Low. Play Store delivery via AAB makes this a no-op. |
| **4** | **Delete the 16 unreachable screens** and their styles/helpers: `Conversations`, `CreateConversation`, `SavedMessages`, `PinnedMessages`, `UserInfo(+Styles)`, `AddMember(+Styles)`, `BannedMember(+Styles)`, `ViewMembers`, `GroupInfo(+Styles)`, `TransferOwnership(+Styles)`, `SearchMessages`, `qr_screen`, `CallLogs`, `CallDetails` + `CallHistory`/`CallParticipants`/`CallRecordings`/`CallDetailHelper`/`CallLogDetailHeader`, `AIAgents`, `Users`, `conversations/screens/Messages`, `useGroupMemberStatus`, `CommonUtils`, `AuthContext`. | **-1.5 to -2.5 MB JS bundle** · 150-400 ms faster cold start · removes vision-camera + MLKit from the APK | **Medium** - confirm each route has no deep-link / intent-filter entry first. Keep `ThreadView` and `OngoingCallScreen` (both reachable via `CometChatPushV2`). |
| **5** | **`useMemo` the CometChat theme** (`App.tsx:97-106`) **and the NavigationContainer theme** (`RootStackNavigator.tsx:57-63`). | Removes the largest re-render source in the app; measurably smoother typing in `ChatScreen` | Very low - behaviour-preserving. |
| **6** | **Move the Convex session token to Keychain / Android Keystore** (Finding 2). | Closes a plaintext-bearer-token hole; costs ~0.3 MB (`react-native-keychain`). | Low. Keep an AsyncStorage fallback for the headless `background.ts` reject path, or route that through the keystore too. |
| **7** | **Stop the CometChat push-tap navigation into the Convex `ChatScreen`** (Finding 3) - remove `CometChatPushV2.ts:63-74` and `helper.ts:245-331`; FCM + Notifee already own every notification path. | Eliminates an infinite-spinner hang from notification taps; -600 LOC | Low-med. Verify push-tap routing still lands on `Messages`/`CallScreen` via `App.tsx:186-206`. |
| **8** | **Memoize every `renderItem`** (5 lists) and the `ChatScreen` row; drop `messages`/`theme` from `renderMessage`'s deps. | -30-50% time in the message list on push; fixes typing jank | Low. |
| **9** | **Replace `<Video>` in `ChatScreen` cells with a poster `<Image>`**; mount the player only in the existing viewer `Modal`. | **-20-60 MB RSS**, much smoother scroll | Low-med. |
| **10** | **Precompute date labels + initials** for list rows (one `useMemo` per list). | -0.5-1 ms per list pass; compounds with #5/#8 | Very low. |
| **11** | **Drop the `UpdateChecker` 60 s interval**; poll on mount + `AppState -> active` only. | Removes 1 network wakeup/min while foregrounded | Very low. |
| **12** | **Enable `react-native-screens`' `enableFreeze` / `enableScreens`** and add `detachInactiveScreens` to navigator `screenOptions`. | Frees native views for background tabs | Low. |
| **13** | **Strip `console.*` in release** via `babel-plugin-transform-remove-console` (or `__DEV__`-guard the unguarded ones). | Removes logcat I/O; stops `index.js:40` serialising tokens into logs | Very low - explicitly guard the security-relevant ones: `index.js:40,53`, `App.tsx:136,340`, `cometchatSession.ts:19,21`, `CometChatPushV2.ts:57,64`. |
| **14** | **Fix the 10 leaks** (L1-L10); in particular stop `qr_screen.tsx:63`'s `Animated.loop` and close the WebRTC peer connection on the `disposed` race. | Stops a permanent 60 fps animation and a held camera/mic | Very low. L1 disappears entirely with step #4. |
| **15** | **Fix the theme flash**: persist the resolved dynamic palette in `AsyncStorage`, seed `useState` from it synchronously, refresh in the background. | Removes a visible full-screen colour transition on every Android 12+ cold start | Low. |
| **16** | **Stream uploads natively** instead of `uriToBlob()` + `fetch(body: blob)` (3 duplicated copies). | Removes OOM on large attachments | Medium - needs a small native upload module. |
| **17** | **Bound `api.users.list` and `api.conversations.list` server-side** (`convex/users.ts:9` does `ctx.db.query("users").collect()`). Today every client pulls the entire user table on every screen that lists people. | Cuts Convex bandwidth + decode cost linearly; removes the O(n) `ScrollView` in `ChatInfoScreen` | Low-med - add cursor pagination plus a `searchUsers` query. |

**Projected after steps 1-13: APK 67 MB -> ~44 MB (-35%), cold start -200-400 ms, list scrolling and
typing materially smoother, and one shipped-secret rotation done.**

---

### Notes on what was checked and found clean

Recorded so the next audit does not repeat the work:

- **`useEffect` dependency hygiene** - 47 hooks scanned, 0 missing dep arrays, 0 literal deps. Clean.
- **`useStore(` without a selector** - 0 occurrences. All zustand reads go through `useConfig`.
- **`react-native-background-timer`** is installed and autolinked but has **0 JS call sites** (Finding 24).
  The "it bypasses JS timers and drains battery" risk therefore does not apply today - it is pure bloat.
- **`NetInfo.addEventListener`** - `@react-native-community/netinfo` has 0 imports, so there is nothing to leak.
- **Remote `Image` sizing** - all 9 remote images are explicitly sized. No layout thrash. Missing
  `defaultSource`/`resizeMode` on 6 of 9 (Finding 21, LOW impact).
- **`keyExtractor`** - stable (`item._id` / `item.id`) on all 6 Convex lists; index-suffixed on 3 legacy
  call-detail lists that are unreachable (Finding 10).
- **Convex / Notifee / FCM / AppState / Keyboard / BackHandler / DeviceEventEmitter subscriptions** - all
  correctly released. See the verified list at the end of the Leak census.
- **`Dimensions.get('window')`** at module scope in three files - stale on rotation/tablet (Finding 18).
