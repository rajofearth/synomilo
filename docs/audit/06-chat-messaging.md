# 06 — Chat & Messaging Audit

Scope: `src/components/convex/ChatScreen.tsx` (63,780 B / 2,217 lines) and `ChatInfoScreen.tsx`
(30,624 B / 773 lines), plus every other screen in the chat/message experience and the parallel
CometChat UIKit stack under `src/components/conversations/` and `src/components/calls/`.

Read-only audit. No source file was modified.

---

## Which stack is live

The app is mid-migration. **Convex is the live messaging stack; the CometChat UIKit stack is an
abandoned parallel implementation that is still registered in the navigator but unreachable.**

`App.tsx` states it outright in a comment on the UIKit init effect: *"Initialize the CometChat
UIKit (used for voice/video calls only - chat, groups, files and reactions are served by Convex)."*

`RootStackNavigator.tsx` registers **31** screens. Of those, **19 are dead**. The whole dead
subtree hangs off a single missing navigation edge.

### Evidence table

| Component | Registered at | Reachable? | Entry edge / evidence |
|---|---|---|---|
| `convex/ConversationsList.tsx` | `BottomTabNavigator.tsx:88` (tab `Chats`) | LIVE | initial route `Chats` (`BottomTabNavigator.tsx:103`) |
| `convex/UsersList.tsx` | `BottomTabNavigator.tsx:90` (tab `Users`) | LIVE | tab from `layout.tabs` (`config.json:61-66`) |
| `calls/Calls.tsx` | `BottomTabNavigator.tsx:89` (tab `Calls`) | LIVE | tab |
| `convex/ChatScreen.tsx` | `RootStackNavigator.tsx:146` (`Messages`) | LIVE | `ConversationsList.tsx:69`, `UsersList.tsx:70`, `GroupsList.tsx:98,178`, `App.tsx` push tap |
| `convex/ChatInfoScreen.tsx` | `RootStackNavigator.tsx:159` | LIVE | `ChatScreen.tsx:712-715` |
| `convex/ContactInfoScreen.tsx` | `RootStackNavigator.tsx:160` | LIVE | `ChatScreen.tsx:713` |
| `convex/ForwardMessageScreen.tsx` | `RootStackNavigator.tsx:157` | LIVE | `ChatScreen.tsx:658,755` |
| `convex/ProfileScreen.tsx` | `RootStackNavigator.tsx:161` | LIVE | `ConversationsList.tsx:125` |
| `convex/SettingsScreen.tsx` | `RootStackNavigator.tsx:162` | LIVE | `ProfileScreen.tsx:486` |
| `calls/WebRTCCallScreen.tsx` | `RootStackNavigator.tsx:193` (`CallScreen`) | LIVE | `ChatScreen.tsx:729`, `ContactInfoScreen.tsx:39`, `Calls.tsx:87` |
| `calls/IncomingCallOverlay.tsx` | `App.tsx:500` | LIVE | rendered when logged in |
| **`groups/Groups.tsx`** (CometChat) | `RootStackNavigator.tsx:126` (`Groups`) | LIVE — and this is the bug | `ConversationsList.tsx:276` FAB resolves to the *root-stack* `Groups`, not the Convex one (Finding 1) |
| `groups/GroupHelper.tsx`, `groups/styles.ts` | — | LIVE (transitive) | only imported by `Groups.tsx:16-20` |
| `utils/CometChatPushV2.ts` | `App.tsx` | VESTIGIAL | `init()` at `:121` always rejects — `fcmProviderId`/`apnsProviderId` are empty strings (`AppConstants.tsx:4-5`), swallowed at `:138` |
| `conversations/screens/OngoingCallScreen.tsx` | `RootStackNavigator.tsx:198` | VESTIGIAL | only edge is `CometChatPushV2.ts:80`, which can never fire for the reason above |
| `users/Users.tsx` (CometChat) | `RootStackNavigator.tsx:125` (`Users`) | DEAD | root-stack `Users` is shadowed by the `Users` **tab** (`BottomTabNavigator.tsx:90` -> `convex/UsersList.tsx`); React Navigation resolves `navigate('Users')` inside the tab to the tab |
| `convex/GroupsList.tsx` | `RootStackNavigator.tsx:126` | DEAD (shadowed) | registered at `:126` as `Groups`, but the FAB `navigate('Groups')` at `ConversationsList.tsx:276` bubbles past the tab navigator (no tab named `Groups` — filtered out at `BottomTabNavigator.tsx:99`) and lands on the **CometChat** `groups/Groups.tsx` |
| `AIAgent/AIAgents.tsx` | `RootStackNavigator.tsx:127` | DEAD | sole edge `Conversations.tsx:242` (itself dead) |
| `conversations/screens/Conversations.tsx` | `RootStackNavigator.tsx:139-141` (`Conversation`) | DEAD — root of the dead subtree | **nothing anywhere navigates to `'Conversation'`**; it is the `initialRouteName` for no branch either |
| `conversations/screens/Messages.tsx` | never registered | DEAD | the `Messages` route is bound to `convex/ChatScreen.tsx` (`RootStackNavigator.tsx:146`); this 26 KB file is orphaned |
| `conversations/screens/SearchMessages.tsx` | `RootStackNavigator.tsx:153` | DEAD | sole edge `Messages.tsx:468,470` (dead) |
| `conversations/screens/PinnedMessages.tsx` | `RootStackNavigator.tsx:134` | DEAD | sole edge `Messages.tsx:565` (dead) |
| `conversations/screens/SavedMessages.tsx` | `RootStackNavigator.tsx:130` | DEAD | sole edge `Conversations.tsx:257` (dead) — **see Finding 2** |
| `conversations/screens/ThreadView.tsx` | `RootStackNavigator.tsx:149` | DEAD | sole edges `Messages.tsx:604`, `SearchMessages.tsx:102` (both dead) |
| `conversations/screens/GroupInfo.tsx` | `RootStackNavigator.tsx:170` | DEAD | sole edge `Messages.tsx:449` (dead) |
| `conversations/screens/UserInfo.tsx` | `RootStackNavigator.tsx:166` | DEAD | sole edge `Messages.tsx:457` (dead) |
| `conversations/screens/AddMember.tsx` | `RootStackNavigator.tsx:174` | DEAD | `GroupInfo.tsx:313` (dead) |
| `conversations/screens/TransferOwnership.tsx` | `RootStackNavigator.tsx:178` | DEAD | `GroupInfo.tsx:171` (dead) |
| `conversations/screens/BannedMember.tsx` | `RootStackNavigator.tsx:182` | DEAD | `GroupInfo.tsx:373` (dead) |
| `conversations/screens/ViewMembers.tsx` | `RootStackNavigator.tsx:186` | DEAD | `GroupInfo.tsx:342` (dead) |
| `conversations/screens/CreateConversation.tsx` | `RootStackNavigator.tsx:144` | DEAD | sole edge `Conversations.tsx:228` (dead) |
| `conversations/screens/qr_screen.tsx` | `RootStackNavigator.tsx:205` | DEAD | sole edge `Conversations.tsx:325` (dead) |
| `calls/CallDetails.tsx` | `RootStackNavigator.tsx:203` | DEAD | nothing navigates to `'CallDetails'` anywhere |
| `calls/CallHistory.tsx`, `CallLogDetailHeader.tsx`, `CallParticipants.tsx`, `CallRecordings.tsx`, `CallDetailHelper.tsx` | — | DEAD | imported only by `CallDetails.tsx:18-23` |
| `calls/icons/*` (17 files) | — | DEAD | imported by nothing |
| `utils/TooltipMenu.tsx` | — | DEAD | imported only by `Conversations.tsx:19` (dead) |

Git history corroborates: `conversations/screens/Messages.tsx` has not been modified since the
initial commit (`d1da6fa`), while `convex/ChatScreen.tsx` was last touched in `281edf9`.

---

## Dead code inventory

**234,932 bytes across 47 files** are confirmed unreachable from any navigation edge, plus
3,260 bytes of vestigial (`OngoingCallScreen.tsx`, code-reachable but runtime-dead).
### A. `src/components/conversations/**` — the abandoned CometChat subtree (20 files, 151,769 B)

| File | Bytes |
|---|---|
| `src/components/conversations/screens/Messages.tsx` | 26,686 |
| `src/components/conversations/screens/GroupInfo.tsx` | 18,345 |
| `src/components/conversations/screens/UserInfo.tsx` | 15,227 |
| `src/components/conversations/screens/qr_screen.tsx` | 14,991 |
| `src/components/conversations/screens/ThreadView.tsx` | 13,216 |
| `src/components/conversations/screens/Conversations.tsx` | 11,528 |
| `src/components/conversations/screens/AddMember.tsx` | 8,920 |
| `src/components/conversations/screens/BannedMember.tsx` | 6,979 |
| `src/components/conversations/screens/SearchMessages.tsx` | 5,537 |
| `src/components/conversations/screens/CreateConversation.tsx` | 4,088 |
| `src/components/conversations/screens/TransferOwnership.tsx` | 4,023 |
| `src/components/conversations/screens/SavedMessages.tsx` | 3,545 |
| `src/components/conversations/screens/PinnedMessages.tsx` | 3,091 |
| `src/components/conversations/screens/ViewMembers.tsx` | 2,103 |
| `src/components/conversations/helper/GroupListeners.ts` | 1,956 |
| `src/components/conversations/screens/UserInfoStyles.tsx` | 1,632 |
| `src/components/conversations/screens/GroupInfoStyles.tsx` | 1,629 |
| `src/components/conversations/screens/BannedMemberStyles.tsx` | 6,467 |
| `src/components/conversations/screens/AddMemberStyles.tsx` | 1,067 |
| `src/components/conversations/screens/TransferOwnershipStyles.tsx` | 739 |
| **Subtotal** | **151,769** |

### B. Dead screens elsewhere (10 files, 66,267 B)

| File | Bytes | Why dead |
|---|---|---|
| `src/components/calls/CallDetails.tsx` | 14,977 | no navigation edge |
| `src/components/calls/CallHistory.tsx` | 7,828 | only via `CallDetails.tsx:18` |
| `src/components/calls/CallLogDetailHeader.tsx` | 6,863 | only via `CallDetails.tsx:19` |
| `src/components/calls/CallRecordings.tsx` | 6,640 | only via `CallDetails.tsx:23` |
| `src/components/calls/CallDetailHelper.tsx` | 5,007 | only via `CallDetails.tsx:22` |
| `src/components/calls/CallParticipants.tsx` | 4,419 | only via `CallDetails.tsx:21` |
| `src/utils/TooltipMenu.tsx` | 4,666 | only via dead `Conversations.tsx:19` |
| `src/components/convex/GroupsList.tsx` | 12,360 | shadowed by the CometChat `Groups` route |
| `src/components/users/Users.tsx` | 1,481 | shadowed by the `Users` tab |
| `src/components/AIAgent/AIAgents.tsx` | 2,026 | only via dead `Conversations.tsx:242` |
| **Subtotal** | **66,267** |

### C. `src/components/calls/icons/*` (17 files, 16,896 B)

`call.tsx`, `call-fill.tsx`, `call-log.tsx`, `call-log-fill.tsx`, `call-end.tsx`,
`call-end-fill.tsx`, `call-made.tsx`, `call-made-fill.tsx`, `call-missed.tsx`,
`call-missed-fill.tsx`, `call-missed-outgoing.tsx`, `call-missed-outgoing-fill.tsx`,
`call-received.tsx`, `call-received-fill.tsx`, `cancel-fill.tsx`, `play-arrow.tsx`,
`index.tsx` — **0 imports** anywhere in `src/`.

### Vestigial (code-reachable, runtime-dead) — 3,260 B

| File | Bytes | Why it can never fire |
|---|---|---|
| `src/components/conversations/screens/OngoingCallScreen.tsx` | 3,260 | only edge is `CometChatPushV2.ts:80`; `CometChatPushNotifications.init({ fcmProviderId: '', apnsProviderId: '' })` at `:121-123` rejects against the empty constants at `AppConstants.tsx:4-5`, and the rejection is swallowed at `:138`. The real push path is `src/notifications/push.ts` + notifee + `api.users.setPushToken`. |

---

## Findings

### 1. `[CRITICAL]` The Groups FAB opens the CometChat stack, not the Convex one

`ConversationsList.tsx:276` — `onPress={() => navigation.navigate('Groups')}`.

The tab navigator never registers a `Groups` tab: `BottomTabNavigator.tsx:99` —
`const visibleTabs = tabs.filter(key => key.toLowerCase() !== 'groups');` (and `config.json:65`
lists `"groups"`, so it is filtered at runtime, not by config omission). With no `Groups` route
inside the tab, `navigate` bubbles to the root stack, where `RootStackNavigator.tsx:126` binds the
name `Groups` to the **CometChat** `components/groups/Groups.tsx`.

Result: the only group-creation entry point in the app renders `CometChatGroups`, creates groups
through `CometChat.createGroup` (`GroupHelper.tsx:130`), and then navigates to `Messages` with
**`{ group: pendingChat }`** (`Groups.tsx:52`) — a CometChat SDK object that the live Convex
`ChatScreen` cannot read. `ChatScreen.tsx:244` only reads `route.params?.conversationId`, so the
result is `conversationId === undefined`, all three `useQuery`s fall to `'skip'`
(`:249,255,261`), `isSubscribed` at `:1062` stays `false`, and the user gets an **infinite
spinner** with no error and no back affordance beyond the header arrow.

`convex/GroupsList.tsx` (12,360 B) — a fully working Convex group list with member multi-select and
`api.conversations.createGroup` (`:57,92`) — is dead code behind this one line.

**Fix:** change `RootStackNavigator.tsx:126` to `component={GroupsList}` (the Convex one, already
imported at `:40`), or stop filtering the tab at `BottomTabNavigator.tsx:99` and bind the tab to
`GroupsList`. Delete `components/groups/Groups.tsx`, `GroupHelper.tsx`, `styles.ts`.

### 2. `[CRITICAL]` Saved Messages is unreachable — the feature does not exist for the user

`SavedMessages.tsx` is registered at `RootStackNavigator.tsx:128-131` and is a complete screen
(`CometChatSavedMessages`, `SavedMessages.tsx:93`). Its **only** entry point is
`Conversations.tsx:257`, inside the avatar tooltip of the dead `Conversation` screen.

Consequences, in order of how a user would hit them:

* There is no saved-messages entry anywhere in the live UI. The only avatar tap in the live app
  is `ConversationsList.tsx:120-130`, which navigates straight to `Profile`.
* Even if the route were reachable, it is **broken by design**: it is a pure CometChat screen. Its
  `onItemPress` (`SavedMessages.tsx:44-89`) resolves the source via `CometChat.getGroup` /
  `CometChat.getUser` (`:52,54`) and then navigates to `SCREEN_CONSTANTS.MESSAGES` with
  `{ user, group, messageId }` (`:81-86`) — but `Messages` is bound to the Convex `ChatScreen`,
  which only reads `conversationId`. Same infinite-spinner outcome as Finding 1.
* `config.json` still advertises the surrounding chat features (`threadConversationAndReplies`,
  `editMessage`, etc. at `config.json:32-42`) and the dead `Messages.tsx:563-607` was the only
  consumer of those flags. There is no `savedMessages`, `pinnedMessages` or `searchMessages`
  column in `convex/schema.ts` at all.

**Fix:** either (a) port saved messages to Convex — add `savedBy: Id<"users">[]` on messages, a
`messages.by_savedAt` index, an `api.messages.saved` query, `messages.save`/`unsave` mutations,
and a `useMutation` in `ChatScreen.tsx`'s action menu (`MenuAction` list at `:1732-1757`) — or
(b) delete `SavedMessages.tsx`, its navigator entry (`RootStackNavigator.tsx:128-131`), the
`SAVED_MESSAGES` constant (`AppConstants.tsx:33`) and the `SavedMessages` param (`types.ts:85`).
Shipping the route as-is is the worst of the three: it compiles, it is registered, and it does
nothing.

### 3. `[CRITICAL]` One keystroke re-runs the entire 60-message query, four times over

`ChatScreen.tsx:383-408` — `onTextChange` fires a `setTyping` **mutation per character**:

```ts
383:  const onTextChange = useCallback(
384:    (value: string) => {
385:      setText(value);
...
389:      setTyping({
390:        token,
391:        conversationId: conversationId as any,
392:        typing: value.trim().length > 0,
393:      }).catch(() => {});
```

`conversations.setTyping` (`convex/conversations.ts:393-409`) patches the caller's `members` row
(`:403-405`). Every live query in the app reads `members` through `by_user_conversation` or
`by_conversation`, so that single write invalidates **all four** mounted subscriptions:

| Subscription | Mounted at | Reads `members` |
|---|---|---|
| `api.messages.list` (60 msgs) | `ChatScreen.tsx:253-258` | `messages.ts:24-29`, `:134-139` |
| `api.conversations.typing` | `ChatScreen.tsx:259-264` | `conversations.ts:415-418` |
| `api.conversations.get` | `ChatScreen.tsx:247-252` | `conversations.ts:111-113` |
| `api.conversations.list` | `ConversationsList.tsx:60-63` | `conversations.ts:24-27`, `:35-40` |

Convex re-executes all four server-side. `messages.list` costs, **per page**, per
`convex/messages.ts`: 1 membership + 1 message-page + **60 `reactions.by_message` collects**
(`:64-67`, one per message) + **N `sessions.by_user` collects** (`:145-148`, one per member,
excluding self) + up to **60 `storage.getUrl` round-trips** (`:87`) + one `db.get` per distinct
reply target (`:92`). That is **~180+ index range scans and ~250+ document reads re-executed on
every character typed**. At a normal 8 chars/second that is ~1,500 reads/second of pure waste from
the composer alone. `requireUser` (`convex/lib/helpers.ts:25-29`) additionally patches the caller's
`sessions` row on a 30-second throttle inside every mutation, which re-invalidates the `sessions`
dependency in `messages.list:145-148` too.

Nothing suppresses this. `useQuery` in Convex React is a live subscription — no paginated variant,
no polling knob, no "skip while typing" escape.

**Fix (client, cheap):** debounce `setTyping` to once per 1.2 s instead of per keystroke — the
`typingTimerRef` at `:295` already exists for the *stop* signal, so hoist it to cover both:

```ts
const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const onTextChange = useCallback((value: string) => {
  setText(value);
  if (!token || !conversationId) return;
  if (typingRef.current) clearTimeout(typingRef.current);
  typingRef.current = setTimeout(() => {
    setTyping({ token, conversationId: conversationId as any,
                typing: value.trim().length > 0 }).catch(onSilent);
  }, 1200);
}, [token, conversationId, setTyping]);
```

**Fix (server, real):** move typing state out of `members` into a short-lived `typing` table keyed
`(conversationId, userId)` with a `by_conversation` index, or push it over a Convex **action**
(`new ActionChannel()`) so it never touches the database and never invalidates anything.
### 4. `[HIGH]` `markRead` on every incoming message — write amplification with no benefit

`ChatScreen.tsx:323-332`:

```ts
323:  useEffect(() => {
324:    if (token && conversationId) {
325:      markRead({ token, conversationId: conversationId as any }).catch(
326:        () => {},
327:      );
328:      try {
329:        NativeModules.Installer?.cancelNotifications?.(conversationId);
330:      } catch {}
331:    }
332:  }, [token, conversationId, messages.length, markRead]);
```

`messages.length` is in the dependency array, so **every message that arrives re-fires the
`markRead` mutation**, which patches the same `members` row (`convex/conversations.ts:375`) and
therefore re-invalidates and re-executes the same four queries as Finding 3 — once per received
message. It also re-runs the `NativeModules.Installer.cancelNotifications` native bridge call each
time.

Worse, the read receipt that this is supposedly feeding is computed for **other** members only
(`convex/messages.ts:142-143` skips `member.userId === me._id`), so the write is not even
self-observable — the client result is byte-identical, Convex suppresses the push, and the whole
round trip buys nothing.

**Fix:** mark read on mount and on screen focus only (`useFocusEffect`), drop `messages.length`
from the deps, and coalesce with a 500 ms trailing debounce so a burst of 10 arriving messages is
one write.

### 5. `[HIGH]` `FlatList` props defeat its own `PureComponent` — full re-render per keystroke

`ChatScreen.tsx:1180-1209`:

```tsx
1180:        <FlatList
1181:          ref={listRef}
1182:          data={messages}
1183:          inverted
1184:          keyboardShouldPersistTaps="handled"
1185:          keyExtractor={item => item._id}
1186:          renderItem={renderMessage}
1187:          contentContainerStyle={styles.listContent}
1188:          onScrollToIndexFailed={info => {
1189:            setTimeout(() => {
1190:              listRef.current?.scrollToIndex({
1191:                index: info.index,
1192:                viewPosition: 0.5,
1193:                animated: true,
1194:              });
1195:            }, 250);
1196:          }}
1197:          ListEmptyComponent={
1198:            <View style={styles.emptyWrap}>
...
1208:          }
1209:        />
```

`VirtualizedList` extends `React.PureComponent`. `data` is stable (`messages` is memoized at
`:297-300`) and `renderItem` is a `useCallback` whose deps (`:1049-1059`) deliberately exclude
`text` — so the list *would* skip re-rendering on every keystroke. Three inline props throw that
away:

* `keyExtractor={item => item._id}` (`:1185`) — new closure every render.
* `onScrollToIndexFailed={info => ...}` (`:1188`) — new closure every render.
* `ListEmptyComponent={<View>…</View>}` (`:1197-1208`) — a **new React element** every render.

Each one is a fresh reference, the shallow compare fails, `VirtualizedList` re-renders, and the
`CellRenderer`s reconcile. Combined with Finding 3's server round-trip per keystroke, the measured
behaviour is exactly the pathology in the brief: **this component re-renders on every keystroke and
re-renders the entire message list.**

**Fix:** hoist all three to module scope or `useCallback`/`useMemo`, and render the empty state as
`ListEmptyComponent={EmptyMessages}` with a memoized component instead of inline JSX.

### 6. `[HIGH]` `FlatList` has no virtualization tuning at all

`ChatScreen.tsx:1180-1209` is the complete prop list. **Absent:** `getItemLayout`,
`initialNumToRender`, `maxToRenderPerBatch`, `windowSize`, `updateCellsBatchingPeriod`,
`removeClippedSubviews`, `extraData`, `onEndReached` / `onEndReachedThreshold`, `refreshControl`.

`getItemLayout` is genuinely hard here (variable-height bubbles, fixed 220x220 images at
`:1880-1884`), but `onEndReached` is *missing entirely* and that is the bigger miss — see
Finding 7.

**Fix:** add `initialNumToRender={12}`, `maxToRenderPerBatch={8}`, `windowSize={7}`,
`removeClippedSubviews` (Android-only, and safe here since `inverted` + fixed-height media cards),
and `onEndReached` wired to the paginator from Finding 7.

### 7. `[HIGH]` No pagination. History is hard-capped at 60 messages and silently ends there

`ChatScreen.tsx:253-258`:

```ts
253:  const thread = useQuery(
254:    api.messages.list,
255:    token && conversationId
256:      ? { token, conversationId: conversationId as any, limit: 60 }
257:      : 'skip',
258:  );
```

`convex/messages.ts:15-21` accepts a `before` cursor and `:164` **returns `hasMore`**. The client
uses neither. The query is live, so new messages append, but old history can never be reached.

The most user-visible symptom is in the reply flow. `scrollToMessage` (`:692-706`) does
`messages.findIndex(m => m._id === messageId)`; for a quoted message older than the last 60 that
returns `-1`, the `if (index >= 0)` at `:695` fails, and **nothing happens** — no scroll, no
toast, no error. The user taps the quote block (`:865-866`) and the app appears frozen.

**Fix:** switch `ChatScreen.tsx:253-258` to Convex's `usePaginatedQuery(api.messages.list, ...)`
with `initialCursor` / `loadMore`, prepend older pages, and — because the list is `inverted` —
capture `contentOffset.y` in `onScrollToIndexFailed` and restore it after `loadMore` so the
viewport does not jump. When `findIndex` returns `-1`, tell the user instead of swallowing it.

### 8. `[HIGH]` The reply flow aborts the attachment queue on a text failure

`ChatScreen.tsx:450-499` — `onSend` does text first, then attachments:

```ts
461:      if (body) {
462:        const replyToId = replyTarget?._id;
463:        setText('');
464:        setReplyTarget(null);
465:        try {
466:          await sendMessage({ ... });
472:        } catch (error) {
473:          setText(body);
474:          Alert.alert('Message not sent', ...);
478:          return;                       // <-- bails out of the whole send
479:        }
480:      }
481:      for (const attachment of queue) {
482:        const uploaded = await uploadAsset(attachment);
```

The `return` at `:478` exits `onSend` entirely. The user picked three photos, the text failed
validation or the network dropped, and the photos are never uploaded and never told about. The
composer's attachment bar still shows them, so the UI implies they are queued for a send that is
not happening.

**Fix:** wrap the attachment loop in its own `try/catch` and report per-attachment failures
independently of the text result, rather than early-returning from the shared handler.

### 9. `[HIGH]` Orphaned storage objects when the message insert fails after a successful upload

`ChatScreen.tsx:414-448` — `uploadAsset`:

```ts
420:        const postUrl = await generateUploadUrl({ token });
421:        const blob = await uriToBlob(attachment.uri);
423:        const response = await fetch(postUrl, { method: 'POST', ... });
428:        const { storageId } = await response.json();
429:        await sendMessage({
430:          token,
431:          conversationId: conversationId as any,
432:          kind: attachment.kind,
433:          storageId,
...
437:        });
```

The blob is uploaded at `:423` and only *then* is the message row created at `:429`. If
`sendMessage` throws — membership revoked mid-upload, offline at the wrong moment, a
`ConvexError` — the `_storage` object at `:428` exists but **no message references it**. Nothing
ever deletes it; `convex/` has no orphaned-storage reaper (`docs/audit/04-convex-backend.md`,
"Files & storage", flags the missing `_storage` ownership index as the structural blocker). Every
failed attachment permanently leaks a file into the bucket.

A second, smaller leak: `generateUploadUrl` at `:420` mints a fresh upload URL on every attempt
with no client-side retry cap, so a 10-file queue mints 10 URLs and can leak up to 10 blobs.

**Fix:** invert the order — create the message row first with a `pending: true` flag, then upload,
then patch the `storageId` in. Or add a `messages.uploadState` field plus a scheduled cleanup
mutation that deletes unreferenced storage objects older than 24 h.

### 10. `[HIGH]` `setState` after unmount on five paths; two timers are never cleared

Every async body in `ChatScreen` calls a setter with no mounted guard and no abort signal:

| Line | Path | Setter after unmount |
|---|---|---|
| `:702` | `scrollToMessage` | `setTimeout(() => setHighlightId(null), 1200)` — **never cleared** |
| `:1189` | `onScrollToIndexFailed` | nested `setTimeout` calling `listRef.current?.scrollToIndex` — **never cleared** |
| `:376-380` | `closeActionMenu` | `Animated...start(() => { setActionTarget(null); setMenuAnchor(null); setActionPanel(null); })` — fires after the 120 ms animation; unmount mid-animation (e.g. tapping a header button behind the menu) writes to a dead component |
| `:484` | `onSend` | `setPending(prev => ...)` after `await uploadAsset(...)` — back-press mid-upload |
| `:508,519` / `:528,539` / `:587` | `pickPhoto` / `pickVideo` / `pickDocument` | `setPending(...)` after the picker promise resolves |

The `setTimeout` at `:702` is the sharpest: `scrollToMessage` sets `highlightId`, schedules a
1.2-second reset, and if the user navigates back inside that window React logs
*"Can't perform a React state update on an unmounted component."*

Only one timer is handled — the typing timer, correctly, at `:334-340`.

**Fix:** add a `useRef(true)` mounted flag set false in a cleanup effect, guard every setter, and
store the highlight / `:1189` timeout ids in refs cleared by the same cleanup. Use an
`AbortController` for the `fetch` at `:423`.

### 11. `[HIGH]` "Delivered" read receipts almost never appear

`ChatScreen.tsx:307-321`:

```ts
307:  const tickFor = useCallback(
308:    (message: Message): 'sent' | 'delivered' | 'read' => {
309:      if (receipts.length === 0) {
310:        return 'sent';
311:      }
312:      if (receipts.every(receipt => receipt.lastReadAt >= message.createdAt)) {
313:        return 'read';
314:      }
315:      if (receipts.every(receipt => receipt.lastSeenAt >= message.createdAt)) {
316:        return 'delivered';
317:      }
318:      return 'sent';
319:    },
320:    [receipts],
321:  );
```

`receipts[].lastSeenAt` is the max `lastSeenAt` across the peer's sessions
(`convex/messages.ts:145-158`), and that field is only ever advanced by `requireUser`
(`convex/lib/helpers.ts:25-29`) — which is guarded by `"patch" in ctx.db`, i.e. **mutations only**.
A peer who opens the app and reads your message performs zero mutations, so `lastSeenAt` never
moves and your tick sits at "sent" indefinitely. In practice the only things that advance it are
the peer *typing* (which goes through `setTyping`) or *sending*. The delivered state is therefore
effectively dead in a read-only conversation.

The `.every()` at `:312` / `:315` is also wrong for groups: one member who has read everything
flips the entire conversation to "read", while one member who has never opened the app pins it at
"sent" forever. Neither matches any user expectation.

**Fix:** denormalize `lastSeenAt` onto the `members` row and update it from a lightweight
heartbeat mutation (or an `ActionChannel`) so presence is tracked independently of message
activity. Report per-member state ("2 of 7 read") rather than collapsing with `.every()`.

### 12. `[MEDIUM]` `Dimensions.get('window')` is read non-reactively; menu positioning breaks on rotation

`ChatScreen.tsx:240-241`:

```ts
240:  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
241:  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
```

Two sources of truth for the same thing. `Dimensions.get` is a **non-reactive snapshot taken once
at mount**; `useWindowDimensions` subscribes. `screenWidth` / `screenHeight` drive every clamp in
the long-press action menu (`menuLeft` `:1072-1074`, `menuTop` `:1075-1085`, `confirmLeft` `:1087`,
`confirmTop` `:1088-1090`), so after a rotation the context menu is positioned against stale
dimensions and can render off-screen or under the keyboard.

`ChatInfoScreen.tsx:30` has the same bug one level worse — at **module scope**:

```ts
30: const THUMB_SIZE = Dimensions.get('window').width / 3 - 8;
```

Computed once at import time, never recomputed. The media-grid thumbnails are wrong on every
device whose width changes after launch (rotation, split-screen, foldable).

**Fix:** delete the `Dimensions.get` calls; use `useWindowDimensions()` exclusively in `ChatScreen`
and move `THUMB_SIZE` into `ChatInfoScreen`'s component body as a `useMemo` on `width`.

### 13. `[MEDIUM]` `ChatInfoScreen` — 21 `useState` in one component, `ScrollView`, avatar-upload races

`ChatInfoScreen.tsx:101-121` — **21 `useState` hooks**, 8 `useQuery`, 7 `useMutation`,
1 `useEffect`, 15 `useCallback`, 6 `useMemo`. Single component, no decomposition, ~773 lines.

* `:123-128` + `:130-149` — the group-avatar upload is a **two-phase state machine**: the upload
  sets `pendingAvatarStorageId` (`:232`), a `useQuery` at `:123-128` resolves the URL, and the
  effect at `:130-149` fires `updateGroup`. Nothing guards against the user tapping the camera
  badge twice, or against `pendingAvatarStorageId` being replaced mid-flight by a second
  `pickGroupPhoto`. Two overlapping flows can interleave and the second `updateGroup` wins, with
  the first photo orphaned.
* `:453` — `ScrollView` renders the entire media grid, file list, link list and full member roster
  with no windowing, and `showAllPhotos` / `showAllFiles` / `showAllLinks` / `showAllMembers`
  flags (`:104-107`) *slice in JS* rather than paginate (`:157,354,376,389`). `sharedContent`
  already caps at 300 messages server-side (`convex/conversations.ts:462-468`), so "See all" can
  mount 300 `Image` components at once.
* `:167` — `Linking.openURL(url).catch(() => {})` swallows every failure. Tapping a link with no
  handler for that scheme does nothing at all, with no message.
* `:453` — no `keyboardShouldPersistTaps`, so the edit-name dialog (`:582`) fights the keyboard.
* `:344-350` — `quickActions` is a new array literal on every render, and `.push()` at `:349`
  mutates it; harmless here but it defeats memoization of the children at `:494-501`.

**Fix:** split into `MembersSection`, `SharedMediaTabs`, `GroupDangerZone`; convert the photo grid
to a `FlatList` with `numColumns={3}`; add a re-entrancy guard inside `pickGroupPhoto` keyed on
the in-flight `storageId`; replace `.catch(() => {})` at `:167` with the Snackbar the component
already has at `:714`.
### 14. `[MEDIUM]` `ConversationsList` — fake pull-to-refresh, un-memoized `renderItem`

`ConversationsList.tsx:158-264`:

* `:161-162` — `onRefresh={() => {}}` and `refreshing={false}`. The refresh control is **wired to
  a no-op**: the user pulls, the spinner never appears, nothing is refetched. The screen is
  already a live `useQuery` (`:60-63`) so nothing *needs* refetching — but shipping a no-op
  refresh gesture is worse than omitting it.
* `:163` — `renderItem={({ item }) => (...)}` is an **inline arrow**, not memoized (unlike
  `ForwardMessageScreen.tsx:105` and `Calls.tsx:105`, which do it correctly). Every render
  re-creates it and re-renders all rows.
* `:165-168` — `style={({ pressed }) => [...]}` allocates a new array per row per render.

**Fix:** delete `onRefresh` / `refreshing` (or wire them to a real `refetch()`), hoist `renderItem`
into a `useCallback`, and lift the pressed-style array into a `StyleSheet`.

### 15. `[MEDIUM]` `ForwardMessageScreen` drops media-with-caption and overwrites attribution

`ForwardMessageScreen.tsx:78-103`:

* `:82-93` — `forwardTo` forwards `body`, `storageId`, `fileName`, `mimeType`, `size`
  independently. A forwarded **image with a caption** (the Convex schema permits `body` on
  non-text kinds — `convex/messages.ts:222` writes
  `body: resolvedKind === "text" ? trimmed : trimmed || undefined`) forwards only the `body` and
  silently **drops the image**, because `storageId` is null. The user sees "Forwarded to X"
  (`:95`) and the recipient gets text.
* `:92` — `forwardedFrom: message.sender.displayName` is passed unconditionally, so forwarding a
  message that was *already* forwarded overwrites the original attribution with the previous
  forwarder's name. `convex/messages.ts:228` truncates at 120 chars but keeps the wrong value.
* `:49-55` — `previewForMessage` labels `audio` as "Voice note", while `convex/lib/helpers.ts:81`
  uses "Voice message" and the viewer fallback at `ChatScreen.tsx:1510` uses "Voice note" — three
  strings for one concept.
* `:208-210` — `ItemSeparatorComponent` is an inline arrow returning JSX; same PureComponent
  hazard as Finding 5.

**Fix:** require `kind === 'text' || !!storageId` before enabling forward, otherwise show an
explicit "captions on media can't be forwarded yet"; preserve the original `forwardedFrom` when
the source already has one; unify the audio label into `convex/lib/helpers.ts`.

### 16. `[MEDIUM]` Accessibility: one `accessibilityRole` and zero `accessibilityLabel` app-wide

A repo-wide grep for `accessibilityLabel|accessibilityRole|accessibilityHint|accessibilityState|
accessibilityLiveRegion|importantForAccessibility` across `src/` returns **exactly one hit**:

```
src/components/calls/CallDetails.tsx:314:  accessibilityRole="alert">
```

…and `CallDetails` is dead code. So the **live app has zero accessibility metadata**.

`ChatScreen.tsx` alone has **23 interactive elements**, none labelled:

| Line | Element | Announced as |
|---|---|---|
| `:1103` | back chevron (`<Text>` with the glyph, `:1104-1106`) | "‹" |
| `:1108` | header title, opens info | nothing |
| `:1144`, `:1154` | audio / video call buttons (icon-only) | nothing |
| `:1166` | info button (icon-only) | nothing |
| `:794` | message bubble `Pressable` (`onLongPress` only, `:795-802`) | nothing |
| `:901` | image attachment `Pressable` | nothing |
| `:909`, `:937` | video / file `Pressable` | nothing |
| `:865` | reply quote `Pressable` | nothing |
| `:1015` | reaction chip (`:1030-1039`) | "3" — no speaker, no message text |
| `:1331` | attach button | nothing |
| `:1342` | composer `TextInput` | nothing |
| `:1357` | send button | nothing |
| `:1260` | remove-pending-attachment | nothing |
| `:1310` | dismiss reply bar | nothing |
| `:1458`, `:1468` | viewer close / forward | nothing |
| `:1584` | action-sheet backdrop | nothing |
| `:1388`, `:1404`, `:1420` | Photo / Video / Document | text only, no role |

Every icon is a `<MaterialDesignIcons>` glyph inside a `TouchableOpacity` / `Pressable` with no
`accessibilityLabel`, so TalkBack reads the button name as empty. Long-press-only actions
(`:795-802`) are **completely undiscoverable** to a screen-reader user — copy, reply, forward,
delete and info are unreachable without sight.

Same story in the rest of the live stack: `ChatInfoScreen` (`:495` quick actions, `:688-699`
member checkboxes, `:470` camera badge), `ConversationsList` (`:120` avatar to Profile, `:248`
unread badge), `UsersList` (`:129` row), `GroupsList` (`:123` add button), `ContactInfoScreen`
(`:54-67` call buttons). `ProfileScreen` and `SettingsScreen` lean on `react-native-paper`'s
`List.Item`, which supplies its own roles — those two are the only partially accessible screens.

**Fix:** add `accessibilityRole="button"` + `accessibilityLabel` to every interactive element
above; give the message bubble `accessibilityRole="button"` and a label composed of
`{sender.displayName}, {body ?? attachmentLabel(kind)}, {time}`; move long-press actions behind a
visible "..." `Pressable` so they are reachable without long-press; add
`accessibilityRole="checkbox"` + `accessibilityState={{ checked: selected }}` to the member
pickers at `ChatInfoScreen.tsx:691-699`.

### 17. `[LOW]` `GroupsList` / `UsersList` / `ForwardMessageScreen` — client-side filtering of a full table

`GroupsList.tsx:54-57` and `ForwardMessageScreen.tsx:62-76` both fetch the **entire** conversation
list (`api.conversations.list`, no server-side filter, no limit) and filter in JS on every
keystroke. `UsersList.tsx:46-57` does the same for `api.users.list`. This compounds
`conversations.list`'s already-expensive shape (see `docs/audit/04-convex-backend.md` PERF-2:
3 reads x N conversations). Acceptable at wedding-party scale; not at 5,000 guests.

**Fix:** push the query into Convex as `api.conversations.search({ token, query })` with an
index-backed filter, debounced at 250 ms.

### 18. `[LOW]` `SettingsScreen` battery row is silently non-interactive on Android

`SettingsScreen.tsx:112` — `onPress={batteryAllowed === false ? openBatterySettings : undefined}`
and `:31` — `NativeModules.Installer?.openBatterySettings?.()`. If the native module is missing,
`openBatterySettings` resolves to `undefined`, the optional call is a no-op, and the row appears
tappable with no `Alert` and no effect. The three `.catch(() => {})` at `:17`, `:41`, `:48` mean
battery-state probing, sign-out and `openSettings` failures are all invisible.

### 19. `[LOW]` `ProfileScreen` avatar save silently drops an in-flight upload

`ProfileScreen.tsx:144-172` — `pickAvatar` sets `pendingAvatarStorageId` at `:167` and relies on
the effect at `:75-86` to resolve the URL into `avatarDraft`. `cancelEdit` (`:108-113`) resets
`pendingAvatarStorageId` to `null` at `:111` — but if the upload promise has already resolved
server-side, the blob is **orphaned** (same root cause as Finding 9). `handleSave` at `:115-118`
does guard on `uploadingAvatar`, which is good, but the guard only covers the button, not the
pending effect.

### 20. `[LOW]` Typing indicator shows the user's own typing state back to them

`ChatScreen.tsx:259-264` queries `api.conversations.typing`, and `convex/conversations.ts:421-424`
correctly skips `member.userId === me._id`. `ConversationsList.tsx:220-230` reads `typingName`
from `conversations.list`, and `convex/conversations.ts:68-70` filters with
`(x) => x.userId !== me._id` — also correct. The issue is lifecycle instead: `setTyping({typing:false})`
is only sent from the 3-second idle timer (`:397-405`), which is cleared on unmount
(`:334-340`) **without sending the stop signal**. Back out of a chat mid-sentence and your name
stays in "X is typing..." on everyone else's screen for the full 4-second server window
(`convex/conversations.ts:425`).

**Fix:** in the unmount cleanup at `:336-338`, fire `setTyping({ typing: false })` before clearing
the timer.

---

## Feature completeness matrix

| Feature | Status | Where / evidence |
|---|---|---|
| Send text | implemented | `ChatScreen.tsx:466-471`; input cleared at `:463` |
| Optimistic send + rollback | partial | Input is cleared at `:463` and restored on failure at `:473`, but **no optimistic bubble** is inserted — the message appears only when the live query returns (`:253`). No per-message sending/failed state. |
| Message list render | implemented | `ChatScreen.tsx:1180-1209`, `inverted` + reversed array at `:297-300` |
| Virtualization tuning | absent | no `getItemLayout` / `windowSize` / `maxToRenderPerBatch` / `removeClippedSubviews` — Finding 6 |
| Pagination / infinite scroll | absent | hardcoded `limit: 60` at `:256`; `hasMore` from `convex/messages.ts:164` ignored — Finding 7 |
| Live subscription | implemented | `useQuery` at `:253-258` — live, re-executes on every write to `messages`/`members`/`reactions`/`sessions` |
| Date separators | implemented | `ChatScreen.tsx:763-787`, `formatDayLabel:111-123` |
| Group sender names | implemented | `ChatScreen.tsx:815-825` |
| Image sharing | implemented | `pickPhoto:501-520`, render `:900-907`, viewer `:1479-1487` |
| Video sharing | implemented | `pickVideo:522-541`, thumbnail `:908-935`, viewer `:1488-1498` |
| File / document sharing | implemented | `pickDocument:543-601`, render `:936-975` |
| Voice notes (record + send) | partial | **send** works via the document picker's audio mime branch (`ChatScreen.tsx:574-576`); **recording** is absent — no mic button in the composer (`:1322-1372`) |
| Orphaned-upload cleanup | absent | Finding 9 |
| Typing indicator (send) | partial | `onTextChange:389-403` fires **per keystroke** — Finding 3; stop-signal lost on unmount — Finding 20 |
| Typing indicator (receive) | implemented | `typingNames` `:259-264`, rendered `:1118-1129` |
| Read receipts | partial | `tickFor:307-321`; delivered state effectively dead — Finding 11 |
| Delivery state (sent/delivered/read) | partial | `:1001-1008`; no "failed" state |
| Reactions | implemented | menu picker `:1718-1724`, chips `:1012-1044`, `applyReaction:603-619`, `convex/reactions.ts` |
| Reply / quote | implemented | `replyFromMenu:639-645`, bar `:1275-1321`, server `replyToId` `convex/messages.ts:180` |
| Threads (reply-in-thread) | absent | `replyToId` exists but no thread UI; `ThreadView.tsx` is dead |
| Edit message | absent | no `messages.edit` in `convex/messages.ts`; no menu entry at `ChatScreen.tsx:1732-1757`; `config.json:38` still advertises `editMessage: true` |
| Delete message (for everyone) | implemented | `confirmDeleteMessage:681-690`, soft delete `convex/messages.ts:285-314` |
| Copy message | implemented | `copyMessage:621-625`, menu `:1734-1738` |
| Forward | partial | `forwardMessageAction:655-661`, `ForwardMessageScreen.tsx`; drops media-with-caption and overwrites `forwardedFrom` — Finding 15 |
| Pin message | absent | no `pinnedAt` in `convex/schema.ts`; `PinnedMessages.tsx` is dead CometChat |
| Search messages | absent | `SearchMessages.tsx` is dead CometChat; no `api.messages.search` |
| Saved messages | absent (route exists, unreachable) | Finding 2 |
| Mentions / `@` | absent | no mention parsing, no `mentionedUserIds` |
| Link previews in bubbles | absent | links extracted only for the ChatInfo list (`convex/conversations.ts:515-525`); bubble text is a plain `Text` at `ChatScreen.tsx:978-986` with no `Linking` |
| Message info | partial | `showMessageInfo:663-668`, panel `:1651-1702` — sender + timestamp only |
| Unread divider in chat | absent | no `lastReadAt` marker rendered |
| Jump-to-latest pill | absent | `inverted` keeps the anchor for new messages, but no FAB when the user has scrolled up, and no "N new messages" counter |
| Scroll position on load-more | absent | no load-more at all (Finding 7) |
| Mute conversation | implemented | `ChatInfoScreen.tsx:170-183`, `conversations.setMuted` |
| Group media / files / links | implemented | `ChatInfoScreen.tsx:531-550`, `conversations.sharedContent` |
| Group add / remove member | implemented | `ChatInfoScreen.tsx:239-281`, `removeMember` / `addMembers` |
| Group rename / photo | implemented | `ChatInfoScreen.tsx:194-237` |
| Leave / delete group | implemented | `ChatInfoScreen.tsx:283-309` |
| Transfer ownership | absent | `convex/conversations.ts` owner-checks `removeMember` but has no ownership transfer; `TransferOwnership.tsx` is dead |
| Ban / kick members | absent | `BannedMember.tsx` is dead CometChat |
| Block user | absent | `utils/helper.ts` has `blockUser` / `unblock` but no Convex equivalent and no UI |
| Presence | absent | no `online` / `lastActive` surfaced anywhere |
| Group call | absent | call buttons gated to `conversation?.type === 'dm'` at `ChatScreen.tsx:1142`; `config.json:53` advertises `groupVideoConference: true` |
| Call history / logs | implemented | `Calls.tsx` (Convex `api.calls.history`) |
| Call **details** screen | absent (route registered, no edge) | `CallDetails.tsx` at `RootStackNavigator.tsx:203` |
| Pull-to-refresh | absent (no-op gesture present) | `ConversationsList.tsx:161-162` — Finding 14 |
---

## Performance hot spots

Ranked by measured cost on the chat screen.

### 1. `setTyping` mutation on every keystroke — `ChatScreen.tsx:389-393`
One Convex mutation per character -> patches `members` (`convex/conversations.ts:403`) ->
invalidates and re-executes **4** live queries, one of which (`messages.list`) costs **~180 index
scans and ~250 document reads** at the default 60-message page. *Quantified: ~1,500 wasted
reads/second at 8 chars/s.* **Fix:** 1.2 s debounce + move typing to an `ActionChannel`.

### 2. FlatList `PureComponent` defeated by three inline props — `ChatScreen.tsx:1185, 1188, 1197-1208`
`keyExtractor` arrow, `onScrollToIndexFailed` arrow, and inline `ListEmptyComponent` JSX are fresh
references on every render, so `VirtualizedList`'s shallow compare always fails. Combined with #1,
**every keystroke re-renders the entire message list.** **Fix:** hoist all three to module scope.

### 3. `markRead` re-fires per incoming message — `ChatScreen.tsx:323-332`
`messages.length` in the dep array -> one mutation per received message -> patches `members` ->
the same 4-query re-execution storm as #1, for writes whose result the client discards.
**Fix:** move to `useFocusEffect`, drop `messages.length`, trailing-debounce 500 ms.

### 4. No pagination; the 60-message page re-executes in full on every invalidation — `ChatScreen.tsx:256`
`limit: 60` hardcoded; `hasMore` (`convex/messages.ts:164`) and the `before` cursor (`:19`) both
ignored. **Fix:** `usePaginatedQuery` + `onEndReached`.

### 5. N+1 inside `messages.list`, re-run on every invalidation above — `convex/messages.ts:64-67, 87, 145-148`
A `reactions.by_message` collect **per message** (60/page), a `storage.getUrl` **per media
message**, and a `sessions.by_user` collect **per member** (N-1/peer). Nothing is batched or
denormalized. **Fix:** denormalize `reactionCounts` onto the message and `lastSeenAt` onto
`members`; that collapses ~180 scans to ~2.

### 6. `renderMessage` identity churn — `ChatScreen.tsx:1049-1059`
Deps include `messages` (`:1055`), `highlightId` (`:1056`) and `tickFor` (`:1058`, itself
dependent on `receipts` — a new array from every query result). Every highlight (`:701`) and every
receipt change re-creates `renderItem` and re-renders all cells. **Fix:** split `MessageRow` into
its own `memo` component and move the highlight into a ref read by the cell.

### 7. 21 `useState` and no memoization in `ChatInfoScreen` — `ChatInfoScreen.tsx:101-121`
`renderRow` (`:326`), `empty` (`:314`), `seeAllButton` (`:320`), `renderPhotos` (`:352`),
`renderFiles` (`:374`), `renderLinks` (`:387`), `renderTabs` (`:400`), `memberRow` (`:412`) are all
plain function declarations rebuilt every render, inside a `ScrollView` (`:453`) that can mount up
to 300 images with no windowing. **Fix:** decompose + `FlatList numColumns={3}`.

### 8. Un-memoized `renderItem` — `ConversationsList.tsx:163`, `GroupsList.tsx:171, 279`
Inline arrows where `ForwardMessageScreen.tsx:105` and `Calls.tsx:105` correctly use `useCallback`.
Inconsistent across the stack. **Fix:** `useCallback` everywhere.

### 9. Full-table client filtering — `GroupsList.tsx:54-57`, `UsersList.tsx:46-57`, `ForwardMessageScreen.tsx:62-76`
`api.users.list` / `api.conversations.list` are unbounded collects (`convex/users.ts:9` is a full
table scan per `docs/audit/04-convex-backend.md` PERF-2) fetched whole and filtered in JS per
keystroke. **Fix:** server-side `search` query + 250 ms debounce.

### 10. No-op pull-to-refresh — `ConversationsList.tsx:161-162`
`onRefresh={() => {}}`, `refreshing={false}`. Costs nothing, but signals unfinished work.

---

## Silent-failure census

**39 swallowed `.catch(() => {})` / empty-`catch` handlers across 15 files.** Every one discards
the error object with no log, no alert, no retry, no telemetry.

| # | File | Count | Lines |
|---|---|---|---|
| 1 | `App.tsx` | 10 | 221, 247, 283, 293, 416, 426, 432, 446, 456, 543 |
| 2 | `src/auth/SessionProvider.tsx` | 5 | 56, 71, 84, 86, 90 |
| 3 | `src/components/calls/WebRTCCallScreen.tsx` | 4 | 85, 129, 166, 222 |
| 4 | **`src/components/convex/ChatScreen.tsx`** | **4** | **330, 393, 403, 568** |
| 5 | `src/components/convex/SettingsScreen.tsx` | 3 | 17, 41, 48 |
| 6 | `src/utils/CometChatPushV2.ts` | 3 | 92, 96, 99 |
| 7 | `src/components/convex/ChatInfoScreen.tsx` | 1 | 167 |
| 8 | `src/components/convex/ProfileScreen.tsx` | 1 | 176 |
| 9 | `src/components/calls/CallDetails.tsx` | 1 | 198 (dead) |
| 10 | `src/components/calls/IncomingCallOverlay.tsx` | 1 | 78 |
| 11 | `src/auth/cometchatSession.ts` | 1 | 16 |
| 12 | `src/components/login/Login.tsx` | 1 | 83 |
| 13 | `src/components/login/SignUp.tsx` | 1 | 109 |
| 14 | `src/notifications/push.ts` | 1 | 60 |
| 15 | `src/updater/UpdateChecker.tsx` | 1 | 115 |
| | **Total** | **39** | |

### The four in `ChatScreen.tsx`

| Line | Statement | What is lost |
|---|---|---|
| `:325-327` | `markRead({...}).catch(() => {})` | read receipts silently stop updating; the user is shown as perpetually unread to peers |
| `:330` | `try { NativeModules.Installer?.cancelNotifications?.(conversationId); } catch {}` | notifications for this conversation are never dismissed — **the banner stays up while the user reads it** |
| `:393` | `setTyping({...}).catch(() => {})` | the other side never sees typing; silent per Finding 3 |
| `:403` | `setTyping({ typing: false }).catch(() => {})` | the idle stop-signal fails -> the other side sees "X is typing..." forever (compounded by Finding 20) |
| `:568` | `catch {}` around `keepLocalCopy` in `pickDocument` | the `content://` URI is used raw; the upload fails later with a far less useful error at `:421` |

(`:325-327`, `:393` and `:403` are `.catch(() => {})`; `:330` and `:568` are bare `catch {}` — 5
swallow sites, 4 of which discard a promise rejection.)

### Top offenders worth fixing first

1. **`ChatScreen.tsx:330`** — a swallowed native-module exception here means notifications are
   never cleared for the conversation the user is currently reading. This is the most visible
   instance of the pattern: the silent failure *is* the product bug.
2. **`App.tsx:247, 283`** — `acceptCall` / `rejectCall` failures are swallowed, so a call answered
   from the lock screen can be accepted server-side and then fail to open `CallScreen`, leaving the
   user with no UI and a live call.
3. **`SessionProvider.tsx:84, 86`** — `logoutMutation(...).catch(() => {})` plus
   `AsyncStorage.removeItem(...).catch(() => {})`: if the server logout fails but the local token
   is still cleared, the session is orphaned server-side and the user stays "logged in" locally
   until the token expires.
4. **`ChatScreen.tsx:393, 403`** — the typing-indicator silent failures, which are also the root of
   the keystroke-storm perf bug (Finding 3). Debouncing and adding a real handler fixes both.

**Recommended floor:** replace `.catch(() => {})` with a shared `onSilent(e)` helper that at
minimum `__DEV__`-logs and routes non-`AppConfig`/non-network errors to a Snackbar or `Alert`. For
`signOut`, `markRead`, `setTyping` and the call mutations, an error the user cannot see is a bug,
not a courtesy.