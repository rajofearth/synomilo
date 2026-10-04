# Original CometChat App / UIKit UX — Feature Inventory

Status: research. Purpose: catalog the UX the original CometChat React Native Sample App
(`SampleAppWithPushNotifications` v5.5.1, UIKit v5.5.1) shipped with, so the Convex-backed
fork can decide what to restore. For each feature: what it does, which component/file
implements it, and whether the current Convex backend supports it.

Sources (primary = repo):

- Original app screens: `src/components/conversations/screens/*`, `src/components/{users,groups,calls}`,
  `src/navigation/*`.
- UIKit source (v5.5.1): `node_modules/@cometchat/chat-uikit-react-native/src/**`.
- Current Convex backend: `convex/schema.ts`, `convex/messages.ts`, `convex/conversations.ts`,
  `convex/reactions.ts`, `convex/calls.ts`, `convex/auth.ts`.
- Docs: cometchat.com/docs/ui-kit/react-native (`message-list`, `message-header`, `message-composer`),
  and `ui-kit/react-native/v4/group-details` for the Details component that v5 removed.
- Existing Convex UX spec (complementary): `docs/ux-research/chat-ux-spec.md`.

Status legend: **YES** = current Convex schema/API already supports it; **PARTIAL** = derivable with
current tables (query/UI work only); **NO** = needs schema/backend extensions (listed inline).

Architecture context that matters:

- RN UIKit v5 is modular: the app stitches `CometChatMessageHeader` + `CometChatMessageList` +
  `CometChatCompactMessageComposer` (`src/components/conversations/screens/Messages.tsx:560-628`).
- v5 removed v4's composite `CometChatDetails` (user/group details). The sample app therefore ships
  **custom** `UserInfo.tsx` / `GroupInfo.tsx` screens; there is no media-tab details UI anywhere in
  the RN kit.
- Current Convex chat (`src/components/convex/ChatScreen.tsx`) implements only: text send,
  photo/video/document attach, long-press → 6-emoji reaction picker, reaction chips, markRead.
  No date separators, no reply/edit/delete/info/forward, no receipts/typing/pin/save/search.

---

## 1. Message long-press context menu

### 1.1 Presentation

Long-press a bubble opens a `CometChatBottomSheet` (`MessageOptionsSheet.tsx:66`) with up to three
layers, top to bottom:

1. **Quick reactions row** — `CometChatQuickReactions` (`MessageOptionsSheet.tsx:113-128`). Defaults
   👍 ❤️ 😂 😢 🙏 + an "add reaction" button that opens the full emoji keyboard
   (`CometChatQuickReactions.tsx:52`). Hidden when `hideReactionOption` or moderation status is
   `disapproved`.
2. **Quick action tiles** — `MessageQuickActions` (`MessageOptionsSheet.tsx:134-138`), only rendered
   when Pin/Save are available: `Reply` · `Pin|Unpin` · `Save|Unsave` (2–3 equal-width tiles;
   `MessageQuickActions.tsx:18-58`). With neither feature on, the row is absent and Reply stays in
   the list.
3. **Action list** — `CometChatActionSheet` with icon + title rows (`MessageOptionsSheet.tsx:143-148`).

Extension panels (Polls, Stickers, Whiteboard, Collaborative Doc) and the embedded **Message
Information** view (`CometChatMessageInformation`, `MessageOptionsSheet.tsx:96-107`) replace the
sheet body when chosen. Destructive/removal actions raise modals (`MessageModals.tsx`): delete
confirm (always), unpin/unsave confirm (only removals confirm), and the report dialog with reason +
optional remark.

On the bubble itself, reactions render as chips (`CometChatReactions`, `CometChatMessageList.tsx:4428`);
tap toggles, long-press opens `CometChatReactionList` ("who reacted") in a modal.

### 1.2 Action inventory and applicability

Source of truth: `MessageDataSource.tsx` — `getTextMessageOptions` (L628), `getCommonOptions` (L1209),
`getMessageOptions` (L957), `validateOption` (L1042). "DM vs group" is enforced by `validateOption`;
group roles use owner/admin/moderator = scope ≠ participant (`L1106-1118`).

| Action | Shown when | DM | Group | UIKit implementation | Convex status / needed extension |
|---|---|---|---|---|---|
| React (emoji row) | message not deleted, reactions not hidden | ✅ | ✅ | QuickReactions + EmojiKeyboard + ReactionList | **YES** reactions table + `reactions.toggle`; missing "who reacted" list and configurable emoji set (currently hardcoded 6 in `ChatScreen.tsx:41`) |
| Reply / quote | always | ✅ | ✅ | `getReplyOption` L428; reply preview in composer; quoted block in bubble | **NO** — needs `messages.replyToId` (+ reply projection in `messages.list`); see chat-ux-spec §3 |
| Reply in thread | root message only (`parentMessageId` empty) | ✅ | ✅ | `getReplyInThreadOption` L447 | **NO** — needs thread parent/root concept + Thread view (see §6.6) |
| Follow/unfollow thread | default ON since 5.5.0 (`ThreadSubscriptionConfig`) | ✅ | ✅ | `getThreadSubscriptionOption` L476 | **NO** — needs `threadSubscriptions` table |
| Share | Text or Media message | ✅ | ✅ | `getShareOption` L522 (native share sheet) | **PARTIAL** — client-only for loaded messages; sharing needs no schema |
| Copy | Text messages only | ✅ | ✅ | `getCopyOption` L541 (clipboard) | **PARTIAL** — client-only; needs `body` (present) |
| Mark as unread | received messages only | ✅ | ✅ | `getMarkAsUnreadOption` L561; sample enables via `showMarkAsUnreadOption={true}` (`Messages.tsx:620`) | **PARTIAL** — roll `members.lastReadAt` back to just before the message; no unread-marker per message |
| Report / Flag | received messages only | ✅ | ✅ | `getReportOption` L502 + `CometChatReportDialog` | **NO** — needs `reports` table + moderation pipeline |
| Message privately | group, message not own | ❌ | ✅ | `getPrivateMessageOption` L607; opens DM via `openChat` | **PARTIAL** — `conversations.createDM` exists; UI flow missing |
| Edit | own message OR owner/admin/moderator | ✅ | ✅ | `getEditOption` L255; media caption edit via `pushCaptionEditOption` L842 | **NO** — needs `messages.editedAt` + `messages.edit` mutation |
| Message info | own messages only | ✅ | ✅ | `getInformationOption` L587 + `CometChatMessageInformation` (sent/delivered/read per recipient, L177-179) | **NO** — needs per-recipient delivery/read tracking (see §6.2) |
| Pin / Unpin | dashboard-gated + eligible message; server enforces RBAC (`canPin` is a no-op local gate, `PinSaveHelper.ts:343`) | ✅ | ✅ | `getPinOption` L303 / `getUnpinOption` L323; unpin confirms | **NO** — needs `messages.pinnedAt/pinnedBy` (or pinned table) |
| Save / Unsave | dashboard-gated + eligible; private to user | ✅ | ✅ | `getSaveOption` L344 / `getUnsaveOption` L364; unsave confirms | **NO** — needs `savedMessages` table |
| Delete | own message OR owner/admin/moderator; always confirms | ✅ | ✅ | `getDeleteOption` L275; `CometChatConfirmDialog` | **PARTIAL** — `messages.remove` exists but hard-deletes own messages only. Original shows a tombstone (`CometChatDeletedBubble`); needs `deletedAt` soft delete + moderator delete |
| Translate | text messages; extension decorator | ✅ | ✅ | `extensions/MessageTranslation/MessageTranslationDecorator.tsx:66-122`; result cached in metadata | **NO** — needs translation API integration (+ optional cache table) |
| Forward | **not available in v5.5.1** — `getForwardOption` is commented out (`MessageDataSource.tsx:580-586`) | — | — | — | (chat-ux-spec §4 plans a forward flow; needs `forwardedFrom` metadata only) |
| Download all | defined but **not wired** into any options list (`getDownloadAllOption` L824, unreferenced) | — | — | — | n/a |

Presentation details: sheet max height 52% screen (90% for message info), quick reactions hidden on
disapproved messages, delete/report modals deferred until sheet dismiss animation on iOS
(`MessageOptionsSheet.tsx:69-92`).

---

## 2. Date/time separators

Rules (device-local, from `shared/helper/LocalizedDateHelper.ts`):

| Context | Today | Yesterday | Within last 7 days | Older |
|---|---|---|---|---|
| **In-list date separator** (`dayDateFormat`, L219-248) | `Today` | `Yesterday` | weekday name (`dddd`, e.g. Monday) | `D MMM, YYYY` |
| **Conversation list row date** (`conversationDate`, L174-214) | time (`h:mm A` / `HH:mm`) | `Yesterday` | locale numeric date via `Intl.DateTimeFormat` | same |
| **Message info receipts** (`dayDateTimeFormat`, L253-282) | `Today {time}` | `Yesterday {time}` | `{weekday} {time}` | `D MMM, YYYY {time}` |
| **Call bubble / call log** (L304-310) | `D MMM, h:mm A` (or `HH:mm`) | same | same | same |
| **Message timestamp** (`timeFormat`, L121-135) | 12-hour `h:mm A` for en/en-US/en-GB/hi/ms, else 24-hour `HH:mm` | | | |

Implementation: separator is rendered inline by `MessageListItem.tsx:87-91` with
`pattern="dayDateFormat"` whenever the calendar day changes; overridable per-list via the
`dateSeperatorPattern` prop (`message-list` docs). Conversation rows use the `conversationDate`
pattern. `CometChatDate` / `CometChatDateSeparator` are the render primitives.

Convex: **YES** — `messages.createdAt` (ms) is enough; format client-side with `dayjs`. No schema
change. (chat-ux-spec §1 already specifies the same Today/Yesterday/weekday/date rules and the
inverted-FlatList insertion mechanics.)

---

## 3. Conversation / chat details ("chat card")

Reality check: **RN UIKit v5 has no `CometChatDetails` component** (it existed in v4 and was
removed; docs: `ui-kit/react-native/v4/group-details`, `upgrading-from-v4`). The original sample
app implements details as two custom screens reached from the chat header ⋮ menu
(`Messages.tsx:435-478`):

### 3.1 Group details (`src/components/conversations/screens/GroupInfo.tsx`)

- Hero: group avatar, name, `{N} members` (`GroupInfo.tsx:260-302`).
- Action boxes: **Add Members** (owner/admin only), **View Members** (`CometChatGroupMembers` with
  search, kick/ban/promote-demote, presence — `ViewMembers.tsx:53-64`), **Banned Members**
  (owner/admin/moderator) (`GroupInfo.tsx:304-401`).
- Destructive: **Delete Chat** (per-user conversation delete), **Leave Group** (owner with >1 member
  is redirected to Transfer Ownership first), **Delete and Exit** (owner/admin deletes group)
  (`GroupInfo.tsx:404-483`).
- Live updates: group listener + UI events refresh scope/member count (`GroupInfo.tsx:79-126`).

### 3.2 User details (`UserInfo.tsx`) — see §4.

### 3.3 Media tabs (Members / Photos / Videos / Files / Links / Docs)

Not present in the RN kit or the original sample app. The tabs the user remembers are a
WhatsApp/Telegram pattern (also present in some CometChat web kits, not RN). If restored, all data
is derivable from the current schema:

| Tab | Data | Convex support |
|---|---|---|
| Members | `members` join `users`, roles | **PARTIAL** — tables exist; need a members query with user profiles (exists in `conversations.get`) |
| Photos | `messages.kind === 'image'` (+ `video` thumbnails) | **PARTIAL** — query `by_conversation_createdAt` desc and filter by kind (add `by_conversation_kind` index if slow) |
| Videos | `kind === 'video'` | **PARTIAL** — same |
| Files | `kind === 'file' | 'audio'` | **PARTIAL** — same |
| Links | URLs extracted from `kind === 'text'` bodies | **PARTIAL** — server-side regex extraction |
| Docs | files whose `mimeType` matches pdf/word/excel/ppt/text/csv | **PARTIAL** — same as Files + mime filter |

Buttons commonly expected on this screen: **Mute** — not in the original app and no backend support
(**NO**: add `members.mutedUntil`); **Block** — lives in UserInfo for DMs (**NO** block table, see
§4); **Leave group** — exists (`conversations.leave`); **Search** — original app has a separate
`CometChatSearch` screen (`SearchMessages.tsx`), not a details button (**NO** for message search,
needs search query/index).

---

## 4. User profile card (tap chat header / header menu)

The chat header (`CometChatMessageHeader`, `Messages.tsx:560-587`) itself shows: back button, avatar,
name, status/typing subtitle, voice + video call buttons (feature-gated), and a ⋮ menu. Menu options
in the original app (`Messages.tsx:435-478`): **User Info** (hidden if blocked-by-me) or **Group
Info**, **Search**, plus **Pinned Messages** (`showPinnedMessagesButton`,
`Messages.tsx:563-566`). Tapping the header body does not navigate; the menu does.

`UserInfo.tsx` content:

| Element | Detail | File | Convex status |
|---|---|---|---|
| Avatar + name | `CometChatAvatar` | L262-280 | **PARTIAL** — `users.displayName/avatarUrl`; avatars exist |
| Status | `Online` or `Last seen …` (`getLastSeenTime`) | L281-292 | **NO** — users table has no `status`/`lastActiveAt` |
| Audio / video call | permission-gated 1:1 calls, outgoing-call overlay | L129-174 | **YES** — `calls.start` + `CallScreen`; no group calls |
| Block / Unblock | confirm dialog; blocked state also replaces the composer with an "unblock" banner (`Messages.tsx:678-713`) | L176-186, L346-400 | **NO** — no `blocks` table; messages currently flow both ways |
| Delete chat | confirm dialog, deletes the conversation for the current user and pops back | L188-211 | **NO** — `conversations` has no per-user delete/hide (`leave` only covers groups) |

Blocked user effects in the original: header hides User Info, composer replaced by banner, status
hidden. Group "no longer a member" banner (`GROUP_NO_LONGER_MEMBER`) is also implemented
(`Messages.tsx:658-677`).

---

## 5. Profile & Settings pages

The original sample app has **no dedicated settings/profile screen**. What it exposes:

- Conversations side menu (tap own avatar, `Conversations.tsx:224-337`): **Create Conversation**,
  **AI Assistants**, **Saved Messages**, the logged-in user's name row (no-op), **Logout**,
  app version, and either **Builder Live Preview** (QR screen) or **Reset to Default** when a QR
  config is active.
- Login-side developer settings (`AppCredentials.tsx`): App ID / Region / Auth Key stored in
  AsyncStorage, subscription type (`SUBSCRIPTION_TYPE_ALL_USERS`), push provider IDs
  (`AppConstants.tsx`), and `SampleUser.tsx` user picker.
- QR screen (`qr_screen.tsx`): scans a Builder config that populates `config/store.ts` feature
  flags (tabs, core messaging, calls, group management, moderator controls) — i.e. feature toggles,
  not end-user preferences.

Things the user listed that the original app did **not** have: notification preferences, wallpaper,
privacy settings, blocked-user management screen, change password, delete account. Assessment:
- Change password: **NO** — `auth.ts` has register/login/logout/updateProfile (displayName/avatar),
  no password-change mutation (hash/salt already stored).
- Delete account: **NO** — no delete-user mutation; would need cascade (messages, members, reactions,
  sessions).
- Notification preferences / DND: **NO** — only `users.pushToken` + `setPushToken` exist.
- Wallpaper / theme per chat: **NO** — no storage; purely client-side if added.
- Blocked users list: **NO** — no `blocks` table.

---

## 6. Extras

### 6.1 Unread badges
Original: `CometChatBadge` count on each conversation row (`CometChatConversations.tsx:1434`), cleared
on read; count is capped/rendered as a pill. Convex: **PARTIAL** — unread = messages with
`createdAt > members.lastReadAt`; `markRead` exists but `conversations.list` does not currently
return unread counts (add a per-conversation count query or store `unreadCount` on `members`).

### 6.2 Read receipts / delivery status
Original: `CometChatReceipt` renders **WAIT** (clock), **SENT** (single tick), **DELIVERED** (double
grey tick), **READ** (double blue tick), **ERROR** (`CometChatReceipt.tsx:37-97`). Shown on own
bubbles, on the last message in the conversation row, and in `CometChatMessageInformation` per
recipient with timestamps (`CometChatMessageInformation.tsx:111-181`). Convex: **PARTIAL/NO** —
`members.lastReadAt` gives coarse "read up to" for read ticks; **delivery is not tracked at all**
(no `deliveredAt`). Per-message info needs a `messageReceipts` table (`messageId`, `userId`,
`deliveredAt`, `readAt`) or per-message `deliveredAt/readAt` for DMs.

### 6.3 Typing indicators
Original: SDK typing events; `CometChatMessageHeader` subtitle shows typing, and conversation rows
swap the preview for a typing label (`CometChatConversations.tsx:628-667, 1307-1316`). Convex:
**NO** — no typing table. Cheapest: `members.typingAt` + `conversations.setTyping` (chat-ux-spec
§6), expiry ~4s; Convex presence/websocket ephemeral state is the alternative.

### 6.4 Message reactions row
Original: reaction chips under the bubble with counts, tap toggles, long-press → who-reacted list;
quick reaction defaults 👍❤️😂😢🙏 plus emoji keyboard. Convex: **PARTIAL** — `reactions` table,
`toggle`, grouped counts + `mine` already returned by `messages.list`; missing reaction list and
configurable emoji set.

### 6.5 Conversation list (filters/tabs)
Original `CometChatConversations`: search bar (opens `CometChatSearch`, `Conversations.tsx:193-203`),
unread badge, last-message preview (text or `📷 Photo`/`🎬 Video`/`🎧 Audio`/`📄 File`), receipt
status on the last message, typing indicator, conversation date, pin indicator; group events and
message events update rows live. **No unread/all tabs/filters** in the RN sample. Convex:
**PARTIAL** — `conversations.list` has title/preview/lastMessageAt; needs unread counts, receipts,
typing, pin flag.

### 6.6 Threads
Original: reply count on bubbles; `ThreadView.tsx` composes `CometChatThreadHeader` (parent bubble +
reply count) + `CometChatMessageList` (`parentMessageId`) + composer; search/pinned/saved results
route thread replies to ThreadView (`PinnedMessages.tsx:47-76`). Convex: **NO** — needs
`messages.parentMessageId` (thread root), reply-count projection, and the thread screen.

### 6.7 Pinned & Saved messages
Original: `CometChatPinnedMessages` per conversation (header ⋮ entry) and `CometChatSavedMessages`
cross-conversation (side menu); both jump to the message with highlight. Convex: **NO** — needs
`pinnedAt/pinnedBy` and a `savedMessages` table.

### 6.8 Search
Original: `CometChatSearch` searches conversations and messages, scoped in-chat (`uid`/`guid`),
supports keyword highlight and `goToMessageId` jump (`SearchMessages.tsx`). Convex: **NO** — needs
message search (Convex search index on `messages.body`, or a client-side scan at small scale).

### 6.9 Message composer
Original (`CometChatMessageComposer`, gated per feature flag in `Messages.tsx:716-742`): text +
emoji, mentions (`@user`, `@all`), rich text formatting, attachments (camera, image, video, audio,
file, polls, collaborative doc, whiteboard, stickers), voice recording, reply/edit preview tray,
multi-attachment staging tray with per-kind fan-out, typing events, send button. Convex current:
text + photo/video/document picker only (`ChatScreen.tsx`), no mentions/reply/edit/voice. Schema
impact: mentions would need `mentions` metadata or parsing; voice notes reuse `kind:'audio'` +
`storageId` (**YES** once recorder UI exists).

### 6.10 Calls
Original: 1:1 voice/video (`UserInfo` + header buttons), call logs (`CometChatCallLogs`), call
details with **Participants / History / Recordings** tabs (`CallDetails.tsx:48,411-440`), incoming/
outgoing call overlays. Convex: **PARTIAL** — `calls` + `callSignals` support 1:1 WebRTC signaling
(start/accept/reject/end/history/signal); **no group calls**, **no recordings**, no call-detail
tabs.

### 6.11 AI extras (original-only)
Conversation starters on empty chats (`CometChatConversationStarter`), smart replies, AI assistant
chat + history drawer (`Messages.tsx:631-656`), AI conversation summary. Convex: **NO** (out of
scope for parity; starters/smart replies are client+API work only).

---

## 7. Consolidated Convex gap list

Schema additions (all optional, non-breaking):

```ts
// messages
replyToId: v.optional(v.id("messages")),
parentMessageId: v.optional(v.id("messages")),   // threads (or reuse replyToId + isThread)
editedAt: v.optional(v.number()),
deletedAt: v.optional(v.number()),
deletedBy: v.optional(v.id("users")),
pinnedAt: v.optional(v.number()),
pinnedBy: v.optional(v.id("users")),
forwardedFrom: v.optional(v.object({ userId: v.id("users"), displayName: v.string() })),

// members
mutedUntil: v.optional(v.number()),
typingAt: v.optional(v.number()),
unreadCount: v.optional(v.number()),             // optional denormalization

// users
status: v.optional(v.union(v.literal("online"), v.literal("offline"))),
lastActiveAt: v.optional(v.number()),

// conversations
deletedAtBy: v.optional(v.array(v.id("users"))), // or a conversationHides table
```

New tables:

```ts
messageReceipts: (messageId, userId, deliveredAt?, readAt?)   // delivery/read + message info
blocks:          (userId, blockedUserId, createdAt)           // block/unblock + enforcement
savedMessages:   (userId, messageId, savedAt)                 // cross-conversation saves
threadSubscriptions: (userId, rootMessageId)                  // follow/unfollow thread
reports:         (messageId, reporterId, reason, remark?, createdAt)
translations:    (messageId, language, text)                  // optional cache
typing:          (conversationId, userId, updatedAt)          // if not members.typingAt
```

Backend function gaps: `messages.edit`, soft-delete in `messages.remove` + moderator rights,
`messages.forward`, pin/unpin/save/unsave mutations, message search query, unread counts in
`conversations.list`, `conversations.delete` (per-user), `auth.changePassword`, `auth.deleteAccount`,
notification preferences, and read-receipt/delivery writes (`markDelivered`).

Feature → status summary:

| Feature | Status | Primary extension |
|---|---|---|
| Reactions, copy, share, date separators | YES/PARTIAL | client only (reaction list + emoji config optional) |
| Reply, threads, thread subscription | NO | `replyToId`, `parentMessageId`, `threadSubscriptions` |
| Edit, delete tombstone, moderator delete | NO | `editedAt`, `deletedAt/deletedBy` |
| Message info, read/delivered ticks | NO | `messageReceipts` (or `deliveredAt/readAt`) |
| Pin, save | NO | `pinnedAt/pinnedBy`, `savedMessages` |
| Typing | NO | `members.typingAt` or `typing` table |
| Unread badges | PARTIAL | unread count query over `lastReadAt` |
| Block/unblock, delete chat, mute | NO | `blocks`, per-user conversation delete, `mutedUntil` |
| Media tabs, members list | PARTIAL | kind/mime queries over existing `messages` |
| Search | NO | Convex search index on `messages.body` |
| Mentions, voice notes, rich composer | NO | mentions metadata; voice = `kind:'audio'` (already) |
| Group calls, recordings | NO | new call model (current `calls` is 1:1 only) |
| Translate | NO | translation API + optional cache |
| Forward | n/a in v5.5.1 | `forwardedFrom` if implemented |
