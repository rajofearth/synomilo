# Chat UX Spec — WhatsApp/Telegram-style interactions

Status: implementation-ready spec. Scope: Convex-backed chat (`src/components/convex/ChatScreen.tsx`, `conversations.ts`, `messages.ts`). Dark theme via CometChat theme tokens. Single account per device; two-account test app.

Ground rules
- Use existing deps only: RN `Modal` + `Animated` (no bottom-sheet lib), `dayjs`, `@react-native-clipboard/clipboard`, `react-native-video`, Convex reactive queries.
- Theme tokens: `theme.color.{primary,background1,background2,background3,borderDefault,borderLight,textPrimary,textSecondary,textTertiary,extendedPrimary50,error}`, `theme.typography.{heading3,heading4,body,caption1,caption2}`.
- Message list is an **inverted FlatList** of chronological messages (`ChatScreen.tsx:509`). Any inserted row (date separator, unread divider) goes at `index + 1` of the anchor message in the data array so it renders visually **above** it.
- Single account per device: no cross-device sync logic; Convex reactive queries push deletes/typing/read state to the other account automatically.

---

## 1. Date separators

Rules (device-local timezone via `dayjs`)
| Condition | Label | Example |
|---|---|---|
| `createdAt` is today | `Today` | `Today` |
| yesterday | `Yesterday` | `Yesterday` |
| 2–6 days ago | weekday name `dddd` | `Monday` |
| older | `MMMM D, YYYY` | `March 3, 2025` |

- Group by `dayjs(ts).format('YYYY-MM-DD')`. A separator renders once per day, above the first message of that day.
- Inverted-list insertion: after each message `i`, if `day(m[i+1]) !== day(m[i])`, insert `{type:'date', label}` at `i+1`. Skip insert when day unchanged. First item of a day at the very bottom of history gets its separator via the same rule (no special case).
- Style: centered pill, `height 24`, `borderRadius 12`, `backgroundColor background3`, `caption1.regular`, `textSecondary`, `marginVertical 8`, `alignSelf center`.
- Sticky: **not sticky in v1.** P2 "sticky-lite": floating pill absolutely positioned `top: 8`; track top-most visible item with `onViewableItemsChanged`; show floating pill only when that item is not the first message of its day (its inline separator has scrolled off). No extra queries.
- Tombstones (`deletedAt`) still participate in grouping by their original `createdAt`.
- The render array must carry `type: 'message' | 'date' | 'unread'`; keep a `messageId → renderIndex` map for `scrollToIndex` (reply jump).
- Day boundary is calendar-day local time, not 24h windows (`dayjs().isSame(ts,'day')`).

## 2. Long-press context menu

Trigger: long-press on any non-deleted message bubble (replaces current reaction-only modal at `ChatScreen.tsx:323`).

Presentation (Android)
- Single Material-style **bottom sheet** via `Modal transparent animationType="slide"`: backdrop `rgba(0,0,0,0.4)` dismiss on tap; sheet `background1`, top radius 16, drag handle 32×4 `background3`.
- Row 1: emoji row — the existing 6 quick reactions `👍 ❤️ 😂 🎉 🙏 🔥` (`REACTION_EMOJIS`), 44px tap targets; tapping toggles via `reactions.toggle` and closes.
- Rows 2+: 52px rows, icon + label, `body.medium`; destructive row in `theme.color.error`.
- Rationale vs anchored popup: reliable across OEMs/screens, one-handed reach, matches modern WhatsApp Android context menu. Anchored popup (existing `TooltipMenu`) is not used for messages.
- A floating emoji row pinned near the bubble before the sheet opens is P2; skip.

Item list and behavior (in order)
| Item | Shown when | Behavior |
|---|---|---|
| React (emoji row) | not deleted | `reactions.toggle`; optimistic via Convex; close sheet |
| Reply | not deleted | sets reply target; composer reply bar appears; close sheet |
| Copy | `kind === 'text' && body` | `Clipboard.setString(body)`; Android `ToastAndroid.SHORT` "Copied to clipboard" (iOS: silent, optional snackbar); close sheet |
| Forward | not deleted | navigate `FORWARD_MESSAGE` with message snapshot; close sheet |
| Delete | `senderId === me` only | `Alert` confirmation (below); close sheet first |
| Info | any (including tombstone: Info only) | opens Message Info sheet; close sheet |

- Deleted tombstone: long-press shows only **Info** (no react/reply/copy/forward/delete). Or no menu at all — pick Info-only.
- Single-account model: no "also delete on my other devices" messaging needed; both accounts see updates live.

Delete confirmation (Alert)
- Title: `Delete message?`
- Body: `This will delete the message for everyone.`
- Buttons: `Cancel` (cancel), `Delete` (style destructive) → `messages.remove`.
- No "delete for me" option in v1 (see §5).

Message Info sheet (bottom sheet, same style)
- Title `Message info`.
- Rows: `Sent` → `Mar 3, 2026, 10:42 AM`; own messages only: `Delivered` → `10:42 AM`; `Read` → `10:44 AM` (DM) or `Read by 2 of 4` (group) derived from `members.lastReadAt` (coarse; a later `lastReadAt` counts earlier messages as read — acceptable for test app).
- Others' messages: Sent time only.

## 3. Reply UX

State
- `replyTarget: Message | null` in `ChatScreen`. Cleared on: send success, cancel (✕), conversation change.
- Send: pass `replyToId` to `messages.send`.

Reply bar above composer
- Layout: full-width row above the composer input, `background2`, top hairline `borderDefault`, height ~52.
- Left accent: 3px vertical bar `theme.color.primary` (full height, radius 2).
- Text block: sender display name `caption1.bold` in `theme.color.primary`; snippet `caption1.regular textSecondary`, `numberOfLines={1}`.
- Right: `✕` button (`Close` icon, 40px target) cancels.
- Snippet rules (shared builder with server preview): text → `body` first 120 chars; image → `📷 Photo`; video → `🎬 Video`; audio → `🎧 Audio`; file → `📄 {fileName}`; deleted → `This message was deleted`.
- If the target is deleted while composing: bar snippet switches to `This message was deleted`; reply still sends with `replyToId`.
- Composer placeholder while replying stays `Type your message...`.

Quoted block inside bubble
- Renders above bubble content, inside bubble padding, width up to bubble width, `marginBottom 4`.
- Container: `borderRadius 8`, `backgroundColor rgba(0,0,0,0.18)` on own (primary) bubbles, `rgba(255,255,255,0.06)` on theirs; left accent bar 3px `theme.color.primary` (or bubble-contrast color on own bubble: `#fff` at 60%).
- Sender name line only in groups (`caption1.bold`); snippet `caption1.regular`, `numberOfLines={2}`.
- Deleted target: snippet `This message was deleted`, italic, no sender name; tapping does nothing (or scrolls to tombstone if loaded).
- Tapping quote → jump.

Jump to original
- Look up target id in `messageId → renderIndex` map. If found: `listRef.scrollToIndex({index, viewPosition: 0.5, animated: true})`; then highlight.
- Highlight: overlay `View` with `backgroundColor theme.color.primary`, opacity animated `0.28 → 0` over 800ms, same `borderRadius` as bubble; track `highlightedId` state; auto-clear after 1s.
- If target not loaded: paginate older pages (`messages.list` `before = oldest.createdAt`) up to 5 pages (250 msgs); if still missing, `ToastAndroid` "Message is in older history" and stop. No new "around" query in v1.
- `onScrollToIndexFailed` fallback: `scrollToOffset` approximation then retry once.

## 4. Forward UX

Entry: context menu `Forward` → route `FORWARD_MESSAGE` (new screen), params `{ message }` snapshot (id, kind, body, fileName, mimeType, size, storageId, senderName).

Picker screen ("Forward to…")
- Header: back `‹`, title `Forward to…`.
- Preview card under header: message icon + snippet (same snippet builder), `background2`, radius 12. Shows what will be sent.
- Search field: placeholder `Search conversations`; client-side filter over `conversations.list` by `title.toLowerCase().includes(query)`.
- List rows: reuse conversation-row layout (avatar/emoji, title, last message preview); tap → forward immediately, `navigation.goBack()`, toast `Forwarded`.
- Empty search state: `No conversations found`.
- Forwarding media: reuse the **same `storageId`** (no re-upload); copy `kind/body/fileName/mimeType/size`; pass `forwardedFrom: { userId: originalSenderId, displayName: originalSenderName }`.
- Forwarding text: body copied verbatim, `kind: 'text'`, with `forwardedFrom`.
- Forward to the same conversation is allowed.
- No confirmation step for single forward (matches WhatsApp); the preview card is the confirmation.

Forwarded bubble rendering
- Caption above content: `Forwarded from {displayName}` (`caption1.regular`, `textTertiary`; `textPrimary` at 70% on own bubble), then normal bubble content.
- Forwards of forwards keep the **original** `forwardedFrom` (copy it through on subsequent forwards).

Multi-select forward: **P2, not now.** When added: long-press "Select" mode, checkboxes, bottom action bar `Forward (N)`, picker gains multi-select + `Send` button. Schema already supports it (one message per send).

## 5. Delete UX

Decision: **delete-for-everyone only, sender-only, soft delete with tombstone.**
- Only own messages show Delete. Recipients have no delete action in v1.
- Sender delete = for everyone (single-account-per-device model; no per-recipient variants).
- Tombstone chosen over hard delete because:
  1. Replies keep a valid anchor (`replyToId` never dangles) — quote shows `This message was deleted`.
  2. List doesn't jump/renumber; date grouping stays stable.
  3. Matches WhatsApp ("This message was deleted"); Telegram's no-mark delete is the outlier.
  4. Trivial with reactive queries: patch `deletedAt`, both devices update live.
- Semantics: `messages.remove` becomes soft delete → patch `{ deletedAt: Date.now() }` and clear `body`, `fileName`, `mimeType`, `size`; **keep `storageId`** so forwarded copies that share the blob still render; delete reactions on the message; delete the blob only in a later cleanup pass that checks for other messages referencing the same `storageId` (skip in v1).
- `messages.list` skips `storage.getUrl` when `deletedAt` is set.
- Tombstone UI: bubble same width constraints, no content, italic text `caption1`; mine → `You deleted this message`, theirs → `This message was deleted`; color `textTertiary`; timestamp still shown; reactions row hidden.
- Conversation preview: if the deleted message is the conversation's last (`conversations.lastMessageAt === msg.createdAt`), patch `lastMessagePreview` to `You: This message was deleted` / `{senderName}: This message was deleted`.
- Unread counts exclude deleted messages (no badge for tombstone-only).
- "Delete for me" (local hide) is P2; would need per-user hidden set — not worth it for 2 accounts.

## 6. Read receipts & typing indicators

Read receipts (no new schema)
- Need other members' `lastReadAt` in payloads: add `lastReadAt` to `conversations.get` members and `conversations.list` rows (server payload change only; `publicUser` stays clean).
- Own bubble status, right of timestamp:
  - pending (mutation in flight): `◌` `textTertiary`.
  - delivered (committed): `✓✓` `textTertiary` (#8A8A8A-ish).
  - read: `✓✓` `theme.color.primary`.
- DM read rule: `otherMember.lastReadAt >= message.createdAt`.
- Group read rule: read when **all** other members have `lastReadAt >= message.createdAt`; otherwise delivered. No partial blue ticks in v1.
- Group Info sheet shows `Read by N of M` (count of other members with `lastReadAt >= createdAt`).
- Existing `conversations.markRead` is called on message-length change (`ChatScreen.tsx:116`); additionally call it on screen focus (`useFocusEffect`) so badges clear on return.
- Note: `lastReadAt` is coarse (no per-message receipts). Acceptable; don't add a receipts table for the test app.

Typing (cheap)
- Schema: `members.typingAt: v.optional(v.number())` (no new table; reuses membership, fine at 2 users). Alternative: dedicated `typing` table — unnecessary here.
- Mutation `conversations.setTyping({token, conversationId})`: membership check, patch `typingAt = Date.now()`.
- Client: in `onChangeText`, if text non-empty and >2s since last call, fire `setTyping`. No stop event.
- Expiry: considered typing when `now - typingAt < 4000`.
- UI:
  - Chat header subtitle (currently only group member count): DM → `typing…`; group 1 typer → `Alice is typing…`; 2 → `Alice and Bob are typing…`; 3+ → `Several people are typing…`. Replaces member count while active; returns after expiry.
  - Conversation list row: preview replaced by `typing…` in `theme.color.primary`, italic; expires with the same rule. Add `otherTypingAt` to `conversations.list` payload.
  - Never trigger push notifications for typing.

## 7. Conversation info / details screen

Entry: tap chat header title/avatar area (currently not pressable) → route `CHAT_INFO`.
- DM → Contact info (profile card hero, §8) + shared content tabs.
- Group → Group info.

Layout (group)
1. Header: back `‹`, title `Group info`.
2. Hero: 96px avatar (emoji or initials, `extendedPrimary50` bg), group name `heading3.bold`, subtitle `{N} members`, created date optional.
3. Quick actions row (circular icon buttons, label under): `Mute` (bell toggle; schema `members.muted`), `Search` (navigate existing `SEARCH_MESSAGES`), `Media` (jumps to Photos tab). Group owner extra: `Add member` (existing `ADD_MEMBER`).
4. Members section: first 5 member rows (avatar, name, `@username`, role badge `Admin`/`Owner`) + `View all` → existing `VIEW_MEMBER`.
5. Segmented tabs: `Photos | Files | Links | Docs`, active underline `theme.color.primary`.
   - **Photos**: 3-column grid, square tiles, `kind === 'image'`; videos (`kind === 'video'`) also included with a play overlay (call the tab Photos but include video thumbnails). Tap → open `fileUrl` (existing `Linking.openURL`).
   - **Files**: all `kind === 'file' | 'audio'` rows desc: doc icon by mime, `fileName`, `size` + date; tap → open URL.
   - **Links**: URLs extracted from `kind === 'text'` bodies via `/(https?:\/\/[^\s]+)/g`; dedupe by normalized URL; row shows host + URL + message date; tap → `Linking.openURL`.
   - **Docs**: convenience filter of Files where `mimeType` matches `pdf|msword|officedocument|excel|powerpoint|text/plain|csv`; same row UI. (Overlaps Files by design; merge later if it confuses testers.)
   - Empty states: `No photos yet`, `No files yet`, `No links yet`, `No docs yet`.
- Backend: one query `conversations.sharedContent({token, conversationId, section, cursor?})` scanning `by_conversation_createdAt` desc with `.take(50)`, returning `{items, nextCursor}`; links extraction server-side. Fine at test-app scale.

## 8. User profile card

Entry: tap chat header in a DM → Contact info screen whose hero is the profile card.

Card content
- 96px avatar (`avatarUrl` else initials on `extendedPrimary50`).
- `displayName` `heading3.bold`; `@username` `body.medium textSecondary`.
- Actions: two pill/circular buttons `Audio` and `Video` (existing `handleStartCall('audio'|'video')`, reuse); optionally a `Search` shortcut to `SEARCH_MESSAGES`.
- Below hero: the same `Photos | Files | Links | Docs` tabs as §7 (shared-media shortcut), using the DM's `conversationId`.
- No "block/report" in v1.
- Same component (`UserProfileCard`) reused for group member tap (existing `USER_INFO` flow) with actions hidden for self.

## 9. Unread counts

Conversation list (already partially implemented in `ConversationsList.tsx`)
- Badge: existing pill `min(count, 99)` + `+` when >99; `theme.color.primary` bg, white `caption1.bold`; hidden when 0.
- Unread row: title `body.medium` (bump to bold if a bold variant exists), preview `textPrimary` (already), timestamp `theme.color.primary` instead of `textTertiary`.
- Read row: preview/timestamp `textSecondary`/`textTertiary` as today.
- Typing overrides preview with `typing…` (primary) — badge unaffected.
- Unread count source stays `conversations.list.unreadCount`; exclude `deletedAt` messages.

In-chat unread divider (P1, optional)
- On screen mount, **before** `markRead` fires, capture `lastReadAt` from `conversations.get` (needs `lastReadAt` in payload) and compute `firstUnreadId` = first message with `createdAt > lastReadAt && senderId !== me`.
- Render divider row `Unread messages` (`caption1.bold`, `theme.color.primary`, centered with hairline rules) visually above `firstUnreadId` using the inverted insertion rule (`index + 1`).
- Suppress if unread count > 40 or `lastReadAt === 0` (new member); instead show a floating `Jump to first unread ↓` chip that scrolls to `firstUnreadId`.
- Divider stays for the session; disappears next open (markRead already fired).

## 10. Schema & backend diff

Schema additions (all optional, non-breaking)
```ts
// messages
replyToId: v.optional(v.id("messages")),
deletedAt: v.optional(v.number()),
forwardedFrom: v.optional(v.object({
  userId: v.id("users"),
  displayName: v.string(), // denormalized for render without extra query
})),

// members
typingAt: v.optional(v.number()),
muted: v.optional(v.boolean()),
```
No new tables required. (Typing table only if member-doc churn becomes an issue — it won't at this scale.)

Backend changes
- `messages.send`: accept `replyToId` (validate: same conversation, exists), `forwardedFrom` (copy-through allowed); no change to push except skip tokens for members with `muted === true`.
- `messages.list`: include `replyTo` projection (`{_id, senderId, senderName, kind, snippet, deleted}` via `db.get(replyToId)` regardless of pagination), `deletedAt`, `forwardedFrom`; skip storage URL when `deletedAt`.
- `messages.remove` → soft delete as in §5; also patch conversation preview when it was the last message.
- `conversations.get` / `conversations.list`: add `lastReadAt` (members) and `typingAt`/`muted` payload fields; `list` adds `otherTypingAt`.
- New `conversations.setTyping`.
- New `conversations.sharedContent` (§7).
- Unread query: add `.filter(q => q.eq(q.field("deletedAt"), undefined))` or filter in handler.

Navigation additions (`RootStackNavigator.tsx`)
- `CHAT_INFO` → new `ConversationInfo` (Convex) screen; keep existing CometChat `USER_INFO`/`GROUP_INFO` routes untouched.
- `FORWARD_MESSAGE` → new `ForwardMessage` screen.
- Message Info is a sheet inside `ChatScreen`, no route.

Shared helpers
- One `messageSnippet(message)` on client (reply bar, quote, forward preview, file rows) mirroring server `previewFor` labels: `Photo`, `Video`, `Voice message`/`Audio`, `File`, plus `This message was deleted`.

## 11. Edge cases

| Case | Behavior |
|---|---|
| Reply to deleted message | Quote renders `This message was deleted`, no tap jump; reply sends fine |
| Delete a message others replied to | Tombstone stays; replies' quotes show tombstone text; anchors valid |
| Delete last message in conversation | Conversation preview becomes `…: This message was deleted`; unread badge excludes it |
| Forward a file, original later deleted | Forwarded copy keeps working (blob retained; `storageId` reused) |
| Forward to same chat | Allowed |
| Forward a deleted message | Not offered (no Forward item on tombstone) |
| Long-press tombstone | Info only |
| Reply target scrolled out of loaded page | Auto-load older pages (max 5), then toast if still missing |
| Date separator + unread divider same position | Divider renders below the date pill (date first in render array) |
| Messages crossing midnight | Split by local calendar day, not 24h delta |
| Typing while app backgrounded | No heartbeat → indicator expires after 4s |
| Group read receipts with many members | Blue ticks only when all others read; Info shows `Read by N of M` |
| Copy on media message | Copy hidden (no body caption copy in v1) |
| Very long text in reply bar | `numberOfLines={1}` ellipsis; quote `numberOfLines={2}` |
| Marking read on open | Capture unread boundary before `markRead` so the divider can render |

## 12. Phasing

- **P0**: date separators; long-press bottom sheet (emoji + Reply/Copy/Forward/Delete/Info); reply bar + quoted block + jump/highlight; tombstone delete; ticks/read receipts; typing indicator; unread list polish; single forward + picker.
- **P1**: Conversation info screen (Photos/Files/Links/Docs + members); DM profile card hero; mute; sticky-lite date pill; in-chat unread divider.
- **P2**: multi-select forward; delete-for-me (local hide); anchored emoji row before sheet; blob cleanup with ref-counting; "Read by N of M" in bubble long-press info.

## References (behavior verified)

- WhatsApp: delete for everyone replaces with "This message was deleted"; 2-day window; received messages only "delete for me"; group admins can delete others'. https://faq.whatsapp.com/1370476507114859/
- WhatsApp: quotes of a deleted message can remain / show deleted state; deletion can't be guaranteed on recipients. https://www.airdroid.com/app-tips/whatsapp-delete-for-everyone-after-long-time/
- Telegram: delete for both sides in 1:1, no mark left in chat; forwarded messages show "Forwarded from"; replies reference original. https://telegram.org/faq
- Sticky date separator behavior (WhatsApp-style sticky pill on scroll). https://stackoverflow.com/questions/60380315/
