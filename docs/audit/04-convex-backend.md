

## Performance findings

### Index-to-query map (every `withIndex` / `filter` / full scan in `convex/`)

| Query site | Pattern | Index used | Status |
|---|---|---|---|
| `auth.ts:96` | `users` by `username` | `by_username` | ✅ |
| `auth.ts:126` | `users` by `username` | `by_username` | ✅ |
| `auth.ts:144`, `auth.ts:158`, `helpers.ts:15` | `sessions` by `token` | `by_token` | ✅ |
| `users.ts:58` | `users` by `username` | `by_username` | ✅ |
| **`users.ts:9`** | **all users** | **none — `.collect()`** | ❌ full table scan, unbounded |
| `conversations.ts:158` | `conversations` by `dmKey` | `by_dmKey` | ✅ |
| **`conversations.ts:26`** | `members` by `userId` | `by_user` | ✅ (but unbounded) |
| `conversations.ts:37,112,251,357,417` | `members` by `conversationId` | `by_conversation` | ✅ |
| `conversations.ts:14`, `messages.ts:26,201,322`, `reactions.ts:19` | `members` by `(userId, conversationId)` | `by_user_conversation` | ✅ |
| `messages.ts:37,331`, `conversations.ts:61,341,464` | `messages` by `(conversationId, createdAt)` | `by_conversation_createdAt` | ✅ |
| `messages.ts:66`, `conversations.ts:348`, `messages.ts:298` | `reactions` by `messageId` | `by_message` | ✅ |
| `reactions.ts:29` | `reactions` by `(messageId, userId)` | `by_message_user` | ✅ |
| `calls.ts:47` | `calls` by `callerId` | `by_caller` | ⚠️ unbounded collect |
| `calls.ts:62,110` | `calls` by `(calleeId, status)` | `by_callee_status` | ✅ |
| `calls.ts:221` | `calls` by `callerId` | `by_caller` | ⚠️ unbounded collect |
| `calls.ts:225` | `calls` by `calleeId` | `by_callee` | ⚠️ unbounded collect |
| `calls.ts:278` | `callSignals` by `(callId, toUserId)` | `by_call_to` | ⚠️ unbounded collect |
| `messages.ts:147` | `sessions` by `userId` | `by_user` | ⚠️ inside an N+1 |
| **`updates.ts:75`** | `updateCache` ordered desc, `.first()` | **none** | ❌ full scan + sort |

**Dead / missing indexes**
* ❌ `conversations.by_updatedAt` (`schema.ts:38`) is **never referenced anywhere in `convex/`** —
  grep returns only the declaration. The conversation list instead sorts `lastMessageAt` in JS at
  `conversations.ts:93`, after materializing every one of the user's memberships.
* ❌ `updateCache.by_version` (`schema.ts:121`) is **never referenced**, while
  `updates.getLatest` (`updates.ts:75`) does an unindexed `.order("desc").first()`.
* ❌ **Missing `conversations.by_lastMessageAt`** — this is the index that would let
  `conversations.list` stop being a per-membership loop.
* ❌ **Missing `messages.by_conversation_createdAt_deletedAt`** — soft-deleted rows are filtered in JS
  (`conversations.ts:492`, `messages.ts:120-129`), so a page of 100 can contain 90 tombstones and
  yield 10 real messages while `hasMore` reports `true` (`messages.ts:164`).
* ❌ **Missing `calls.by_caller_createdAt` / `by_callee_createdAt`** — `calls.history` collects
  everything then sorts in JS (`calls.ts:227-229`).
* ❌ **No `_storage` ownership index** — this is the structural reason CRITICAL-3 is unfixable
  without a join table.

### [PERF-1] `messages.list` — 500-member group ⇒ ~600+ index range scans per page
`convex/messages.ts:15-168`. Three independent N+1s stack:
1. `:64-67` — a `reactions.by_message` collect **per message in the page** (up to 100) = 100 index
   range scans just to group emojis.
2. `:134-160` — the read-receipts loop: for **every member of the conversation** it runs a
   `sessions.by_user` collect (`:145-148`) and then iterates that user's sessions.
   *Quantified, 500-member group: 1 (membership) + 1 (messages page) + 100 (reactions) + 500
   (sessions) = **602 index range scans and ~650+ document reads per single page load**, plus up to
   100 `storage.getUrl` round-trips at `:87`.* Convex's limit is ~16,384 documents / 8 MiB, so a
   500-member group with ~1,500 messages of receipts is already at the edge and the chat screen
   silently stops opening.
3. The `senderCache` map at `:46` correctly de-dupes sender lookups — good — but nothing de-dupes the
   reaction queries.

*Fix:* batch the reaction query (`by_conversation` on reactions, or denormalize a `reactionCounts`
array onto the message), and drop the per-member `sessions` lookup in favour of a single
`lastSeenAt` denormalized on the `members` row.

### [PERF-2] `conversations.list` — 3 reads × N conversations + unbounded unread
`convex/conversations.ts:20-96`. Worst offender is covered as CRITICAL-7. Secondary costs:
* `:31` `ctx.db.get(m.conversationId)` and `:35-40` a full `members.by_conversation` collect,
  **per membership**. *Quantified, 50 conversations × 500 members = 25,050 document reads in one
  query.* The member list is fetched solely to compute `memberCount` (`:84`) and, for DMs, to find
  the one other participant (`:47`) — neither needs the full roster.
* `:49` an extra `ctx.db.get` for the DM peer and `:73` another for the typing user.
* No `Promise.all` is used anywhere in `convex/` — every dependent read is strictly sequential, so
  each of these loops also serializes its round-trips.

*Fix:* denormalize `memberCount`, `lastMessagePreview`, `lastMessageAt` and `unreadCount` onto the
`members` row; the whole query becomes one indexed `by_user` collect.

### [PERF-3] `messages.send` — N+1 over the member list on the hot write path
`convex/messages.ts:240-255`: for every member, `ctx.db.get(member.userId)` just to read
`pushToken`. *Quantified, 500-member group: 500 sequential document reads per message sent*, before
the FCM fan-out. The `pushToken` belongs on the `members` row (or a `pushTokens` table — see
[OTHER-6]) and would eliminate the loop entirely.

### [PERF-4] `conversations.deleteGroup` — nested loop, 20k+ scans, 100k writes
`convex/conversations.ts:345-354`. Quantified in CRITICAL-8. Also note `callSignals` and storage
blobs are **not** cleaned up: `deleteGroup` never deletes the `_storage` objects referenced by the
messages it removes, and never deletes `callSignals` rows. Deleting a group therefore **orphans every
attachment blob** permanently.

### [PERF-5] `calls.history` — two unbounded collects, then N+1 peer lookups
`convex/calls.ts:219-243`. `.collect()` at `:222` and `:226` read the user's whole call history
(both directions), sort in JS, slice to 100 (`:227-229`), and then run a `ctx.db.get(peerId)` per
row (`:234`). With a `by_caller_createdAt` index and `.take(100)` on each direction this becomes
100 indexed reads.

### [PERF-6] `conversations.sharedContent` — up to 300 sequential URL resolutions
`convex/conversations.ts:462-526`. `.take(300)` (`:468`) then a serial
`ctx.storage.getUrl(msg.storageId)` at `:499` and `:511` for every media message in the window. A
media-heavy 300-message window = 300 sequential storage round-trips inside one query. Also
`URL_REGEX` (`:452`) runs a global regex over every text body in the window — CPU, not IO, but it is
the kind of work that should be done once at write time.

### [PERF-7] Unbounded `.collect()` inventory
| Site | Table | Bound |
|---|---|---|
| `users.ts:9` | `users` | **entire table** — no index, no take |
| `conversations.ts:27` | `members` | all of the caller's memberships (fine, bounded by user) |
| `conversations.ts:40,113,252,360,418` | `members` | all members of a conversation (500+) |
| `conversations.ts:65` | `messages` | **all unread messages — no `take`** (CRITICAL-7) |
| `conversations.ts:344` | `messages` | every message in the conversation |
| `messages.ts:67` | `reactions` | per message, ×100 |
| `messages.ts:139` + `:148` | `members`, `sessions` | ×500 (PERF-1) |
| `messages.ts:245` | `members` | per send (PERF-3) |
| `calls.ts:48,65,113,281` | `calls`/`callSignals` | unbounded; `:281` is every signal for a call |
| `calls.ts:222,226` | `calls` | user's entire history (PERF-5) |
| `updates.ts:56,82` | `updateCache` | unbounded, but bounded by publish count |

**There is no `take: 10000` and no `ctx.db.paginate` anywhere** — good, that particular anti-pattern
is absent. But the 13 sites above are all unbounded reads, and one of them (`conversations.ts:65`)
is on the single most-called query in the app.

### Pagination status
Only **`messages.list` is properly paginated** (`before`/`limit`, capped at 100 by
`messages.ts:34`, with a `hasMore` flag at `:164`). `conversations.sharedContent` caps at 300 with no
cursor. Everything else is either unbounded or slices after collecting.

### Good news
* `senderCache` in `messages.list` (`messages.ts:46`) is a correct de-dup of sender lookups.
* `createDM` uses the `by_dmKey` index to make DM creation idempotent (`conversations.ts:155-162`) —
  the right pattern.
* `messages.list` caps `limit` with `Math.min(limit ?? 50, 100)` (`messages.ts:34`) so a client
  cannot ask for the whole table — this is the pattern the other list functions need.

## Other findings

### Token verification & session management

1. **[HIGH] No Convex Auth / JWT anywhere.** `getUserIdFromToken`, `ctx.auth.getUserIdentity()` and
   `ctx.auth` appear **zero times** in `convex/`. Authentication is a hand-rolled DB lookup in
   `requireUser` (`lib/helpers.ts:9-31`). `requireUser` **is** called at the top of all 36 handlers
   that use it — it is not merely imported — and it **throws** `ConvexError` at `helpers.ts:17-19`,
   so there is no silent-`null` execution path in mutations. The only silent-`null` path is the
   read-only `auth.me` query (`auth.ts:161-163`), which is safe.
2. **[MEDIUM] Sessions never expire.** `sessions` (`schema.ts:15-22`) has `createdAt`/`lastSeenAt` but
   no `expiresAt`, and `requireUser` (`helpers.ts:13-19`) never compares `createdAt` to a TTL. Every
   login mints a permanent credential (`auth.ts:58-71`); `logout` (`auth.ts:140-152`) revokes exactly
   one. There is no "sign out everywhere" and no server-side revocation on password change (there is
   no password-change function at all).
3. **[GOOD] Token entropy is fine.** `genToken` uses 24 bytes from `crypto.getRandomValues`
   (`helpers.ts:43-49`) → 192 bits, 48 hex chars. `genSalt` uses 16 bytes (`helpers.ts:51-57`).
4. **[MEDIUM] Non-constant-time password comparison.** `if (hash !== user.passwordHash)`
   (`auth.ts:132`) is an ordinary string compare. Use `crypto.subtle` timing-safe compare or
   compare in fixed time.
5. **[MEDIUM] Weak PBKDF2 fallback.** The primary path uses 210,000 iterations (`auth.ts:18,44`), but
   the `@noble/hashes` fallback uses only 20,000 (`auth.ts:19,52`) — 10.5× weaker, and silently so
   if `globalThis.crypto.subtle` is unavailable (`auth.ts:30-31`). If the fallback ever engages,
   existing hashes become the weak kind and nothing records which was used. Add a hash-version field
   to `users` and re-hash on next login.
6. **[MEDIUM] Username-enumeration oracles.** `auth.ts:99` ("That username is taken") and
   `auth.ts:129` ("No account found with that username") are distinct, and `register` vs `login`
   timings differ (register runs PBKDF2, login does not when the user is absent).
7. **[MEDIUM] Password policy is 6 characters minimum** (`auth.ts:86`). No complexity, no breach check.
8. **[LOW] `displayName` has no upper bound in `register`.** `auth.ts:90-92` enforces only `>= 2`,
   while `users.updateProfile` correctly caps at 40 (`users.ts:43`). A 1 MB display name is storable
   via the register path and is then echoed into every push notification body
   (`messages.ts:272`, `calls.ts:87`).
9. **[LOW] `register` and `login` do not check for an existing session**, so an already-signed-in
   user can accumulate sessions indefinitely.

### Messages

10. **[GOOD] No edit function exists at all.** There is no `messages.edit` — the #1 requested
    authorization question resolves cleanly: **it is impossible to edit someone else's message
    because editing does not exist.** `messages.remove` (`:285`) correctly enforces
    `message.senderId !== me._id` (`:293`).
11. **[MEDIUM] Soft delete is real and mostly correct.** `messages.remove` (`:303-311`) sets
    `deletedAt` and clears `body`/`storageId`/`fileName`/`mimeType`/`size`/`replyToId`. `messages.list`
    nulls those fields on read (`:120-123`). No hard-delete of the message row exists — good for
    moderation, but see [OTHER-14] for the orphaned blob.
12. **[LOW] `messages.remove` does not re-verify membership.** It checks `senderId` only (`:293`).
    A user removed from a group earlier can still delete their own old messages — arguably correct,
    but it is an inconsistency with every other message function, which all check membership.
13. **[LOW] Reactions on a soft-deleted message are permitted.** `reactions.toggle` (`reactions.ts:5`)
    never checks `message.deletedAt` (`:13-16`), and `messages.list` renders reactions regardless
    (`:130`). You can attach an emoji to a message the sender has erased.
14. **[MEDIUM] `removeReaction` race — non-issue, but `toggle` has a logic bug.** Convex mutations are
    serializable with OCC retry, so the read at `reactions.ts:27-32` and the deletes/insert at
    `:34-43` are atomic; there is no interleaving. However the comparison `r.emoji === emoji` at
    `:33` uses the **full, un-truncated** client string while the stored value was truncated to 8
    chars at `:41` — so any emoji longer than 8 UTF-16 units can never be "found", and every tap
    deletes-then-reinserts the same 8-char prefix, making the reaction impossible to remove.
15. **[LOW] No `messages.edit`/`messages.deleteForEveryone` and no server-side retention.** Nothing
    enforces a retention window; `deleteGroup` is the only purge path and it fails on large
    conversations (CRITICAL-8).

### Conversations / groups

16. **[MEDIUM] No ownership transfer and no owner-must-remain invariant.** There is no
    `transferOwnership`. `removeMember` (`:274`) lets the owner remove themselves, and `leave`
    (`:381`) lets the sole owner leave. Both orphan the group: `deleteGroup`, `updateGroup` and
    `removeMember` all require `role === "owner"`, and `addMembers` requires membership — so once
    the only owner is gone, **no one can add members, rename it, or delete it**. It becomes a
    permanent zombie.
17. **[MEDIUM] No group-size cap.** `createGroup` accepts an unbounded `memberIds` array
    (`:194`, loop at `:219-231`) and `addMembers` likewise (`:240`, loop at `:254-269`) — each
    iteration is a `db.get` + `db.insert`. This directly amplifies CRITICAL-6.
18. **[MEDIUM] Group name has no max length on create.** `createGroup` validates only `>= 2`
    (`:199`); `updateGroup` correctly caps at 50 (`:315`). Inconsistent — create can produce a 1 MB
    group name, which is then copied into every push notification body (`messages.ts:271`).
19. **[LOW] No "leave" safety for DMs.** `leave` (`:381`) is permitted on `type: "dm"` conversations,
    which can desynchronise the two participants' views of a DM that `createDM` will never recreate
    correctly (the `dmKey` row survives at `:156-162`, so a later `createDM` returns the stale,
    half-membership conversation id at `:161`).
20. **[LOW] `deleteGroup` is a hard delete with no audit trail** (`:364`), and as noted in PERF-4 it
    leaves storage blobs and `callSignals` orphaned.

### Calls

21. **[GOOD] Callee-only checks exist and are correct.** `calls.accept` (`:161-163`) and
    `calls.reject` (`:177-179`) both assert `call.calleeId !== me._id` and throw otherwise. **A third
    party cannot accept or reject someone else's call.** `calls.end` uses `assertParticipant`
    (`:202`, helper at `:21-25`), and `calls.get` (`:138-140`) and `calls.signal` (`:258`) are
    participant-scoped. `calls.consumeSignals` asserts per-signal `toUserId === me._id` (`:294`).
    This is the best-secured file in the backend.
22. **[GOOD] The state machine is guarded on accept.** `accept` requires `status === "ringing"`
    (`:164-166`), so you cannot accept an already-ended, rejected or missed call. The
    `markTimedOut` scheduled job (`:78-82`, `:187-195`) only patches when still `ringing`, so under
    OCC the accept-vs-timeout race resolves to exactly one winner with no double state.
23. **[MEDIUM] `calls.signal` has no call-status gate and no role gate on `kind`.** (`:248-270`)
    * Any participant can push signals into a call that is already `ended` (the row is never
      deleted, and `signal` never reads `call.status`).
    * The **caller** may send `kind: "answer"` (`:252` permits any participant to claim any kind), so
      a caller can inject a forged SDP answer to its own peer — a WebRTC spoofing/hijack primitive
      inside an already-authorized channel.
    * There is no rate limit on `signal`, and the `callSignals` rows are **never garbage-collected**
      except by the client voluntarily calling `consumeSignals` (`:288-300`). A call left `active`
      forever accumulates ICE rows unbounded, and `calls.signals` (`:276-281`) collects them all.
24. **[MEDIUM] `active` calls never time out.** Only `ringing` is scheduled for cleanup
    (`:78-82`). `end` (`:197`) must be called by a participant; if both clients die, the row stays
    `active` forever, `calls.start`'s guard at `:50-55` only blocks calls younger than 60 s, so the
    stale `active` row silently stops blocking new calls while still leaking into `history`.
25. **[LOW] `calls.start` allows calling any user ID with no relationship check** (`:33-41`) and no
    per-target cooldown. Combined with `users.list` returning every user ID (`users.ts:5`), this is a
    ready-made targeted-harassment tool. Needs a block/mute list and a cooldown.

### Files & storage

26. **[MEDIUM] `files.ts` is 19 lines: `generateUploadUrl` and `url`.** `generateUploadUrl` (`:5-11`)
    authenticates and discards the user, then returns `ctx.storage.generateUploadUrl()` with **no
    content-type, no size limit, no per-user quota and no rate limit** — unbounded storage-spend
    abuse. `url` (`:13-19`) is CRITICAL-3. Together they are a complete, unauthenticated-by-ownership
    file store bolted onto every user.
27. **[GOOD] Convex storage URLs are signed, not public.** `ctx.storage.getUrl()` returns a signed
    URL scoped to the object, so the URLs are not a flat public bucket. The leak is the **IDOR at the
    API layer**, not public object hosting.
28. **[MEDIUM] Soft-deleting a message never deletes the blob.** `messages.remove`
    (`:303-311`) clears `storageId` from the row but never calls `ctx.storage.delete`, so the object
    stays billable and reachable. `deleteGroup` (`:339-364`) likewise leaves every attachment
    orphaned. There is no reclamation job anywhere in `convex/`.

### Push

29. **[GOOD] The FCM server key is NOT in the repo.** `convex/push.ts:18` reads
    `process.env.FCM_SERVICE_ACCOUNT` and throws a clear error if unset (`:19-21`); the JSON is
    parsed only in memory (`:22`). A repo-wide grep for `FCM_SERVICE_ACCOUNT` returns exactly two
    hits, both in `push.ts`. `README.md:42` confirms the intended split. **No secret is committed**
    in the Convex code. (`google-services.json` at the repo root is a *client* Firebase config —
    an API key + sender id, not a server credential. It is in scope for the mobile build but is not
    a push-auth secret. Note it *is* checked into version control despite `README.md:42` claiming it
    "lives outside version control" — worth reconciling, and worth confirming which
    `google-services.json` the release build uses.)
30. **[MEDIUM] Multi-device is broken: exactly one push token per user.**
    `users.pushToken` is `v.optional(v.string())` — a scalar (`schema.ts:11`) — and
    `users.setPushToken` (`users.ts:17-24`) **overwrites** it. Signing in on a second device
    silently kills push delivery to the first. Correct shape is a `pushTokens` table keyed by
    `(userId, token)`.
31. **[MEDIUM] No invalid-token cleanup.** `push.sendToTokens` logs failures to `console.error`
    (`push.ts:62-71`) but never removes the dead token from `users.pushToken`, so the tokens list
    degrades permanently and every send pays for dead entries.
32. **[MEDIUM] `sendEachForMulticast` has no 500-token chunking.** `push.ts:45` sends the whole array
    in one call. FCM caps a multicast at 500 recipients — **a group with more than 500 members with
    push tokens will have its notifications fail entirely**, with only a `console.error` to show for
    it. Given `createGroup`/`addMembers` have no member cap (OTHER-17), this is reachable.
33. **[LOW] Token selection is an N+1 read pass** (`messages.ts:240-255`) and `calls.start` only ever
    notifies `callee.pushToken` (`calls.ts:84`) — a callee on a second device gets no call ring.
34. **[LOW] `users.setPushToken` accepts an arbitrary attacker-chosen string** (`users.ts:21`).
    Self-scoped, so it cannot redirect someone else's push, but it lets an account register a
    garbage token that permanently poisons the delivery list for that user.

### Updates / app-updater

35. See **CRITICAL-5** for the full RCE chain. Additional notes:
    * `updates.check` (`:90`) is a public `action` with **no `token` argument at all** — the only
      public function in the backend with no authentication of any kind. It returns the release
      notes and a signed APK URL to anonymous callers.
    * `updates.publish` performs **no validation of the uploaded object**: `storageId` is taken as a
      bare `v.id("_storage")` (`:45`), `size` is client-supplied and unchecked (`:46`), and nothing
      verifies the object is a signed APK. `notes` (`:43`) is unbounded and rendered directly into a
      React `<Text>` (`UpdateChecker.tsx:163-168`) — safe in RN, but a stored-XSS vector if the web
      app renders it as HTML.
    * `parseVersion` (`:11-20`) is anchored at `^` but **not at `$`**, so `"1.0.0-<anything>"` parses
      as `1.0.0`. Minor.
    * `publish` deletes the previous release's storage object (`:59`) before/while inserting the
      new row — a failed publish sequence can leave zero releases.

### Rate limiting, validation, XSS

36. **[CRITICAL] No throttling of any kind** — see CRITICAL-6 for the four abuse paths.
37. **[MEDIUM] Message body has no maximum length.** `messages.send` (`messages.ts:209-222`) trims
    and inserts `trimmed` with no cap; only the *preview* is sliced (`helpers.ts:73`, to 120 chars)
    and only the *push* body is sliced (`messages.ts:261`, to 140). A single ~900 KB body is accepted
    and stored, and it is read back in full by `messages.list`. Combined with no rate limit, the
    database can be filled by one account.
38. **[MEDIUM] No `body`/`name`/`emoji`/`notes` character or length validation.** `emoji` is
    truncated to 8 units but never validated as an emoji (`reactions.ts:41`); `notes` (updates) is
    unbounded; `fileName` (200) and `mimeType` (120) are truncated but never validated
    (`messages.ts:224-225`).
39. **[MEDIUM] `size` is client-asserted.** `messages.ts:179,226` stores a caller-supplied number
    rather than the real `_storage` object size, and never checks that `storageId` is a file the
    caller actually uploaded (see also CRITICAL-4).
40. **[LOW→MEDIUM for the web app] Stored-XSS surface.** There is **no HTML rendering anywhere in the
    RN client** — grep for `dangerouslySetInnerHTML` / `WebView` / `innerHTML` across `src/` returns
    zero hits, and message bodies are rendered as React `<Text>`. So the RN app is not vulnerable.
    The Next.js app must preserve that. Two stored values are the injection candidates:
    * `avatarUrl` set via **`auth.updateProfile` (`auth.ts:188-190`) has NO validation**, while the
      duplicate `users.updateProfile` (`users.ts:67-69`) does require `startsWith("http")`. Because
      the unvalidated path exists, `javascript:...` and `data:text/html,...` can be stored in
      `avatarUrl`. Any `<a href={avatarUrl}>` in the web UI becomes stored XSS → and the token is in
      `localStorage` (CRITICAL-10), so that XSS is instant account takeover.
    * `conversations.sharedContent.links` (`conversations.ts:516-521`) returns URLs extracted from
      message bodies by `/(https?:\/\/[^\s]+)/gi` (`:452`). The `https?` prefix blocks `javascript:`
      here, but `[^\s]+` still admits `<`, `>`, `"` and `'`. React escapes these safely; any
      markdown/`dangerouslySetInnerHTML` renderer will not. Sanitize on write, escape on read.
    * **Recommendation: delete the duplicate `auth.updateProfile` and keep one validated
      `users.updateProfile`.** Two divergent profile mutations is the root cause.

### Platform / deployment

41. **[HIGH] The production deployment URL is hard-coded into the client**
    (`src/config/convexConfig.ts:1`) and the client is constructed with
    `skipConvexDeploymentUrlCheck: true` (`src/convex/client.ts:6`), which disables the client-side
    check that the running build matches the deployment it was compiled against. Shipping this
    pattern to a browser means the deployment URL is a public constant and a misconfiguration is
    silent.
42. **[MEDIUM] `.env.local` is committed** and contains the deployment name, cloud URL and site URL.
    Not secret, but it confirms which deployment the web app will hit — and `CONVEX_DEPLOYMENT` is a
    **dev** deployment (`dev:glad-capybara-533`), i.e. production data is being served from a
    development deployment. Confirm the web app will point at a prod deployment.
43. **[LOW] `convex/lib/helpers` is part of the public API surface** (`_generated/api.d.ts:33`,
    `"lib/helpers": typeof lib_helpers`). It currently exports only plain async functions, so nothing
    is client-invocable — but if anyone ever adds a `query()`/`mutation()` there it becomes public by
    default. Move the helpers out of the Convex module tree or keep the surface explicit.
44. **[LOW] No `convex.config.ts`, no `httpAction`, no custom database wrappers** — so there is no
    hidden middleware that might have been providing authorization. Grep confirms zero
    `httpAction`/`convex.http` usages outside the generated shim.

## Verdict for web exposure

**No. This backend cannot be driven from a browser today.** It is not safe to point a Next.js web
app at `glad-capybara-533.convex.cloud` and hand-ship it. Convex deployments are already reachable
from any browser — the URL in `src/config/convexConfig.ts:1` is public and every one of the 41
public functions is callable by anyone with a valid (or forged) token. The browser adds no new
attack surface to Convex's *transport*; it adds new attack surface to the *credential*: today the
token lives in RN AsyncStorage, tomorrow it lives in `localStorage`, where one XSS in the web app
is a full account takeover. And per CRITICAL-4 and CRITICAL-5, account takeover here escalates to
cross-conversation confidentiality loss and then to native code execution on every device via the
silent-update channel.

The good news is that this is not a rewrite. The core is sound: `requireUser` is genuinely called at
the top of every handler that uses it and **throws** rather than returning a nullable user, so there
is no "imported but never called" or "silent null continues" class of bug. Membership checks exist
and are correct in `messages.list`, `messages.send`, `conversations.get`, `conversations.sharedContent`,
`reactions.toggle`, and in **all five** call mutations (`accept`/`reject` are properly callee-only and
`accept` is properly gated on `status === "ringing"`). Files are stored with signed URLs, not public
buckets, and the FCM server key is correctly kept in an environment variable. The failures are a
short, enumerable list of missing checks and three structural design decisions.

### MUST be fixed before the web app ships

**Blocking — data breach:**
1. `conversations.typing` missing membership check → IDOR (`conversations.ts:411`).
2. `conversations.addMembers` missing owner-role check → any member adds anyone
   (`conversations.ts:244`).
3. `files.url` missing storage-ownership check → IDOR over every blob (`files.ts:16`).
4. `messages.send` `replyToId` not bound to `conversationId` → cross-conversation read
   (`messages.ts:227`).
5. Move the deploy URL out of the bundle and drop `skipConvexDeploymentUrlCheck`
   (`convexConfig.ts:1`, `client.ts:6`).

**Blocking — authentication design:**
6. Replace the token-in-argument scheme with Convex Auth + `ctx.auth.getUserIdentity()`, or at
   minimum add expiry, rotation and "revoke all sessions". Do **not** put the token in
   `localStorage` for the web build.
7. Delete the duplicate `auth.updateProfile` and keep the validated `users.updateProfile` — this
   closes the `javascript:`-in-`avatarUrl` stored-XSS that would otherwise ride on item 6.
8. Add rate limiting to `register`, `login`, `messages.send`, `calls.start`, `setTyping`,
   `generateUploadUrl`.

**Blocking — RCE chain:**
9. Gate `updates.publish` on an immutable user id, not `username` (`updates.ts:49`), and require
   `updates.check` to carry a token.
10. Verify a published SHA-256 and the APK signer fingerprint in `UpdateChecker` before
    `NativeModules.Installer.install()`.

**Blocking — availability (these break, they don't just slow down):**
11. Replace the unread-count materialization in `conversations.list` with a denormalized counter
    (`conversations.ts:59-65`) — at 500 members this query currently **throws** and takes the whole
    chat list down with it.
12. Fix the `messages.list` receipts N+1 (`messages.ts:134-160`) — ~600 index scans per page for a
    500-member group.
13. Bound `calls.start` (`calls.ts:45`), `calls.history` (`calls.ts:219`) and `users.list`
    (`users.ts:9`) with indexes + `take`.
14. Paginate `deleteGroup` into scheduled internal batches, or soft-delete
    (`conversations.ts:339-364`).

**Should fix before launch:** `conversations.list`/`messages.send`/`deleteGroup` N+1s; per-message
reaction query in `messages.list`; `replyToId`/`storageId` referential validation; body/name/note
length caps; the `callSignals` GC job and `active`-call timeout; the multi-device push-token table;
FCM 500-token chunking; owner-transfer / owner-must-remain invariants; constant-time password
comparison; a unified username-enumeration error.

**Answer to "can this backend be driven from a browser today?"** Yes, technically — and that is the
problem. It is already browser-drivable, it authenticates well, and it has eleven specific
authorization and performance holes that a hostile page (or a curious user with devtools) can walk
straight through. Fix items 1-14 and it is a reasonable base for the web app.
