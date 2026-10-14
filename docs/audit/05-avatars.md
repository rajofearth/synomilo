# 05 - Avatar / profile-picture audit

**Reported bug:** *"There are a lot of bugs where if I have a profile picture, the app doesn't use my profile picture everywhere. There are only a few places where it does use it, but other places it just uses the placeholder."*

**Scope:** every render site in `src/` + `convex/` that draws a picture or initials for a person, group or conversation. Tokens grepped across the whole tree: `avatar`, `Avatar`, `photoURL`, `avatarURL`, `getAvatarUrl`, `imageUrl`, `UserEmptyIcon`, `AccountCircle`, `Person`, `initials`, `placeholder`, `<Image`, `ImageBackground`, `source={{`, `uri:`, `RNImageView`, `setUserAvatar`, `updateUser`, `profilePicture`.

**Headline:** 33 avatar render sites. Only **5** ever draw the real photo. **28** draw initials/a placeholder instead, and **12 of those 28 have the correct URL literally sitting in scope, unused** - that is the bug. There is no shared helper: every screen re-implements its own `initialsFor()` (7 divergent copies) and its own inline ternary.

---

## Avatar render sites

Verdicts:

* **URL** - the site reads an avatar URL and renders the real photo when one exists.
* **PLACEHOLDER** - the site has no photo code path at all; it renders initials / an icon unconditionally.
* **FALLBACK-BUG** - avatar data *is* available in scope but the site renders a placeholder (or has no avatar slot at all, or guards the URL path wrongly / passes `{uri:""}`).

| # | file:line | Component / screen | Whose avatar | Exact URL expression | Verdict |
|---|---|---|---|---|---|
| 1 | `src/components/convex/ConversationsList.tsx:120-130` | `ConversationsList` - header round button (Chats tab) | **me** | none. `{initialsFor(user?.displayName ?? '?')}`. `useSession().user.avatarUrl` is in scope and unused | **FALLBACK-BUG** |
| 2 | `src/components/convex/ConversationsList.tsx:172-197` | `ConversationsList` - conversation row | conversation / group | `{item.avatarUrl ? <Image source={{uri:item.avatarUrl}}/> : <Text>{initialsFor(item.title)}</Text>}`; `item.avatarUrl` from `convex/conversations.ts:44,54,82` | **URL** |
| 3 | `src/components/convex/UsersList.tsx:137-158` | `UsersList` - user row | other user | `{item.avatarUrl ? <Image source={{uri:item.avatarUrl}}/> : <Text>{initialsFor(item.displayName)}</Text>}`; `convex/users.ts:13` -> `publicUser()` | **URL** |
| 4 | `src/components/convex/GroupsList.tsx:184-205` | `GroupsList` - group row | group | `{item.avatarUrl ? <Image source={{uri:item.avatarUrl}}/> : <Text>{initialsFor(item.title)}</Text>}` | **URL** |
| 5 | `src/components/convex/GroupsList.tsx:282-316` | `GroupsList` - "New group" member picker row | other user | **no avatar element at all**. Row is checkbox + displayName + `@username`; `users.list` rows carry `avatarUrl` | **FALLBACK-BUG** |
| 6 | `src/components/convex/ProfileScreen.tsx:208-243` | `ProfileScreen` - hero (88px) | **me** | `{avatarUri ? <Image source={{uri:avatarUri}}/> : <Avatar.Text label={initials}/>}`; `avatarUri = avatarDraft ?? user?.avatarUrl ?? null` (`:91`) | **URL** |
| 7 | `src/components/convex/ChatInfoScreen.tsx:455-468` | `ChatInfoScreen` - hero (80/96px) | group **and** DM conversation | `{isGroup && groupAvatarUrl ? <Image source={{uri:groupAvatarUrl}}/> : <Avatar.Text label={initialsFor(title)}/>}`; `groupAvatarUrl = conversation?.avatarUrl ?? null` (`:83`). For DMs `convex/conversations.ts:129` already writes the *other user's* `avatarUrl` into `conversation.avatarUrl` - the `isGroup &&` guard throws it away | **FALLBACK-BUG** |
| 8 | `src/components/convex/ChatInfoScreen.tsx:412-423` | `ChatInfoScreen` - group member row (`memberRow`) | other user | `<Avatar.Text size={40} label={initialsFor(member.displayName).toUpperCase()}/>`. `member` is `{...publicUser(user), role}` (`convex/conversations.ts:118`) so `member.avatarUrl` is present and unused | **FALLBACK-BUG** |
| 9 | `src/components/convex/ChatInfoScreen.tsx:688-699` | `ChatInfoScreen` - "Add members" candidate row | other user | **no avatar element**. `users` from `api.users.list` (`:91`) each carry `avatarUrl` | **FALLBACK-BUG** |
| 10 | `src/components/convex/ContactInfoScreen.tsx:98` | `ContactInfoScreen` - hero (96px), reached by tapping a 1:1 chat header | other user | `<Avatar.Text size={96} label={initialsFor(displayName).toUpperCase()}/>`. `otherMember` comes from `conversations.get` members (`convex/conversations.ts:118`) with `avatarUrl`; unused | **FALLBACK-BUG** |
| 11 | `src/components/convex/ForwardMessageScreen.tsx:115-123` | `ForwardMessageScreen` - forward-target row | conversation / group | `<Avatar.Text label={initialsFor(item.title)}/>`. `item` is the same `ConversationRow` shape used by row 2 - it *has* `avatarUrl?: string \| null` (`:26`) | **FALLBACK-BUG** |
| 12 | `src/components/convex/ChatScreen.tsx:1108-1141` | `ChatScreen` - header (`Messages` route) | conversation / group | **no avatar element**. Header renders title + typing/member-count text only. `conversation.avatarUrl` (from `convex/conversations.ts:123-131`) is unused | **FALLBACK-BUG** |
| 13 | `src/components/convex/ChatScreen.tsx:788-1045` | `ChatScreen` - every message bubble | **message sender** | **no avatar element**. Group chats print `item.sender.displayName` as text (`:815-825`) instead. Backend *does* send `sender.avatarUrl` (`convex/messages.ts:46-62,118` via `publicUser`) but the local type at `ChatScreen.tsx:61` is `sender: { _id, displayName, username }` - the field is stripped by the type | **FALLBACK-BUG** |
| 14 | `src/components/calls/Calls.tsx:123-137` | `Calls` - call-history row (Calls tab) | call peer | inline `{initialsFor(name) \|\| '?'}`. `item.peer.avatarUrl` is declared at `:33` and returned by `convex/calls.ts:241`; unused | **FALLBACK-BUG** |
| 15 | `src/components/calls/WebRTCCallScreen.tsx:323-339` | `WebRTCCallScreen` - audio backdrop, 140px | call peer | inline initials computed from `route.params.peerName` (a plain string nav param). `api.calls.get` returns `peer: publicUser(peer)` with `avatarUrl` (`convex/calls.ts:151`) and the screen never reads it | **FALLBACK-BUG** |
| 16 | `src/components/calls/IncomingCallOverlay.tsx:146-160` | `IncomingCallOverlay` - full-screen ringing, 140px | call caller | inline initials from `incoming.caller.displayName`. `api.calls.incoming` returns `caller: publicUser(caller)` with `avatarUrl` (`convex/calls.ts:125`); unused | **FALLBACK-BUG** |
| 17 | `src/components/conversations/screens/Conversations.tsx:163-184` | `Conversations` (legacy CometChat) - header avatar | me, via CometChat | `image={loggedInUser?.getAvatar() ? {uri:...} : undefined}`. The CometChat user is built at `src/auth/cometchatSession.ts:14-16` as `new CometChat.User({uid, name: displayName})` - **no avatar field** | **PLACEHOLDER** |
| 18 | `src/components/conversations/screens/Conversations.tsx:193-203` | `CometChatConversations` rows | conversation | SDK-side. Convex conversations never exist in CometChat, so the list is empty/initials | **PLACEHOLDER** |
| 19 | `src/components/conversations/screens/Messages.tsx:589` | `CometChatMessageList` bubbles | message sender | SDK-side `User.getAvatar()` - always `""` | **PLACEHOLDER** |
| 20 | `src/components/conversations/screens/ThreadView.tsx:296` | `CometChatMessageList` bubbles | message sender | same | **PLACEHOLDER** |
| 21 | `src/components/conversations/screens/UserInfo.tsx:262-272` | `UserInfo` hero | other user (CometChat) | `image={userObj?.getAvatar() ? {uri: userObj.getAvatar()} : undefined}` | **PLACEHOLDER** |
| 22 | `src/components/conversations/screens/GroupInfo.tsx:261-273` | `GroupInfo` hero | group (CometChat) | `image={data.groupDetails?.getIcon() ? {uri: ...} : undefined}` | **PLACEHOLDER** |
| 23 | `src/components/groups/GroupHelper.tsx:390-393` | `GroupHelper` - join-group password sheet | group (CometChat) | **unguarded** `image={{uri: groupToJoin.getIcon()}}`. When there is no icon this hands `CometChatAvatar` `{uri:""}`, i.e. a broken image instead of initials | **FALLBACK-BUG** |
| 24 | `src/components/users/Users.tsx:27-42` | `CometChatUsers` rows | user (CometChat) | SDK-side | **PLACEHOLDER** |
| 25 | `src/components/conversations/screens/ViewMembers.tsx:53` | `CometChatGroupMembers` rows | group member (CometChat) | SDK-side | **PLACEHOLDER** |
| 26 | `src/components/conversations/screens/CreateConversation.tsx:80-91` | `CometChatUsers` picker | user (CometChat) | SDK-side | **PLACEHOLDER** |
| 27 | `src/components/conversations/screens/AddMember.tsx:225` | `CometChatUsers` picker | user (CometChat) | SDK-side | **PLACEHOLDER** |
| 28 | `src/components/AIAgent/AIAgents.tsx:46-51` | `CometChatUsers` picker | user (CometChat) | SDK-side | **PLACEHOLDER** |
| 29 | `src/components/conversations/screens/BannedMember.tsx:207-225` | `CometChatList` banned members | user (CometChat) | SDK-side. (`UserEmptyIcon` at `:149` is the empty-state illustration, not an avatar.) | **PLACEHOLDER** |
| 30 | `src/components/calls/CallLogDetailHeader.tsx:86-105` | `CallDetails` header | call peer (CometChat) | `user.getAvatar() ? {uri: user.getAvatar()} : undefined` / `groupObj.getIcon() ? {uri} : undefined` | **PLACEHOLDER** |
| 31 | `src/components/calls/CallParticipants.tsx:105-132` | `CallDetails` participant row | call participant (CometChat) | `avatarURL={item['avatar']}` off the CometChat call object | **PLACEHOLDER** |
| 32 | `src/components/calls/CallHistory.tsx:199-224` | `CallDetails` history row | call peer | **no avatar prop at all** - `_style.itemStyle.avatarStyle` is built at `:121-128` and never passed to `CometChatListItem` | **FALLBACK-BUG** |
| 33 | `src/components/login/SampleUser.tsx:298-301` | `SampleUser` grid (`__DEV__` only) | CometChat sample user | `getAvatarSource(user.getAvatar())` over `https://assets.cometchat.io/sampleapp/sampledata.json`. Local bundled fallback images at `src/utils/helper.ts:193-201` | **URL** |

**Non-avatar matches** (listed so the table is provably exhaustive): `src/components/login/AppCredentials.tsx:198,255,288,321` and `src/components/conversations/screens/qr_screen.tsx:309` are logos/illustrations; `GroupInfoStyles.tsx:31-39`, `UserInfoStyles.tsx:27-35`, `BannedMemberStyles.tsx:125`, `src/components/groups/styles.ts:29` are stylesheets; every `placeholder=` hit in `Login.tsx`, `SignUp.tsx`, `GroupHelper.tsx`, `UsersList.tsx`, `GroupsList.tsx`, `ForwardMessageScreen.tsx`, `AppCredentials.tsx`, `SampleUser.tsx`, `ChatScreen.tsx` is a `TextInput` prop; every `uri:` hit in `ChatScreen.tsx` and `ChatInfoScreen.tsx` outside the table is a message attachment / shared photo, not a person.

**Totals**

| Verdict | Sites | Rows |
|---|---|---|
| URL | **5** | 2, 3, 4, 6, 33 |
| PLACEHOLDER | **14** | 17-22, 24-31 |
| FALLBACK-BUG | **14** | 1, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 23, 32 |
| **Total** | **33** | |

Of the 28 non-URL sites, **12 have the correct avatar URL already in scope** (rows 1, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16). The other 16 fail because the value is missing at the source (CometChat, rows 17-32) or because the guard is wrong (row 23).

---
## How the avatar URL is stored

### The full data path

```
pick photo (react-native-image-picker)
  -> local file:// uri
  -> uriToBlob(uri)                                   ProfileScreen.tsx:42 / ChatInfoScreen.tsx:46
  -> POST api.files.generateUploadUrl                 convex/files.ts:5-11  -> Convex _storage object
  -> api.files.url -> ctx.storage.getUrl()            convex/files.ts:13-19 -> signed https URL
  -> api.users.updateProfile({avatarUrl})             convex/users.ts:66-71 (validate startsWith("http"))
     or api.conversations.updateGroup({avatarUrl})    convex/conversations.ts:320-325 (owner-only)
  -> users.avatarUrl / conversations.avatarUrl         convex/schema.ts:10, 28
  -> read back through publicUser()                   convex/lib/helpers.ts:33-41
```

**Shape:** a **full https URL string** pointing at Convex's storage CDN. Not a storage key, not base64, not a file name. `users.avatarUrl` is `v.optional(v.string())` (`convex/schema.ts:10`); `publicUser()` normalises it to `string | null` (`convex/lib/helpers.ts:38`).

**Where it is set**

* **Profile edit** - `ProfileScreen.tsx:144-172` (`pickAvatar`) -> `:68-86` (resolve storage URL into `avatarDraft`) -> `:115-133` (`handleSave` -> `updateProfile`, `avatarDraft ?? undefined`). This is the *only* way a user's photo is ever set.
* **Group photo** - `ChatInfoScreen.tsx:213-237` (`pickGroupPhoto`) -> `:123-149` -> `updateGroup`. Owner-gated in the UI (`:469 isOwner &&`) **and** on the server (`convex/conversations.ts:304-306`).
* **Signup** - nothing. `convex/auth.ts:104-110` inserts the user with no `avatarUrl`; `SignUp.tsx` / `Login.tsx` contain zero avatar code. Every new account starts blank.
* **CometChat `updateUser`** - **never called.** `CometChat.updateUser` / `setAvatar` do not appear anywhere in the repo.

### Does CometChat store it too? No.

The CometChat side is created once, at sign-in, and never touched again:

```ts
// src/auth/cometchatSession.ts:14-16
await CometChatUIKit.createUser(
  new CometChat.User({ uid, name: displayName }),   // <-- no avatar
);
```

`App.tsx:148-152` re-runs this on every `sessionUser` change, and `cometchatSession.ts:10-12` early-returns for the same uid, so the CometChat user object is created exactly once with `{uid, name}` and **never updated**.

### When a user changes their photo, is BOTH updated? No - only one is.

| Store | Written on photo change? | Read by which render sites |
|---|---|---|
| Convex `users.avatarUrl` | **yes** (`ProfileScreen.tsx:115-133`) | rows 2, 3, 4, 6 (and 1, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 *should* be reading it and aren't*) |
| Convex `conversations.avatarUrl` | **yes**, groups only (`ChatInfoScreen.tsx:140-148`) | rows 2, 4, 7 (rows 11, 12 *should* be reading it and aren't*) |
| CometChat `User.avatar` | **never** | rows 17, 19, 20, 21, 24, 26, 27, 28, 29, 30, 31 |

**This is the split.** Convex owns the truth; CometChat owns an empty shadow copy. Every screen built on the Convex query layer can show the photo; every screen built on a CometChat UIKit component is structurally incapable of showing it, forever, no matter how many times you re-upload.

Secondary consequences of the split:

* CometChat-side identity is keyed on `username` (`App.tsx:150`), Convex on `_id`. Nothing reconciles the two, so there is no join point at which an avatar could be bridged.
* `users.updateProfile` (`convex/users.ts:66-71`) only checks `startsWith("http")`. It does not verify the URL resolves, and there is **no way to clear a photo** - `avatarUrl: v.optional(v.string())` has no `null` path, and `ProfileScreen.tsx:125` sends `avatarDraft ?? undefined`, so "remove photo" is impossible.
* No `<Image>` in the app has an `onError` (verified: zero `onError` props on any avatar `<Image>`). A stale/404'd Convex storage URL therefore renders an empty transparent box, not initials - a third, worse failure mode.

---
## Root causes

Ranked by how many render sites each one breaks.

### 1. CRITICAL - CometChat is never told about the avatar (`src/auth/cometchatSession.ts:14-16`)

`new CometChat.User({ uid, name: displayName })` with no avatar, and `CometChat.updateUser` is never called in the entire repo. 14 render sites read `CometChat.User.getAvatar()` / `Group.getIcon()` and therefore always render initials. `cometchatSession.ts:10-12` short-circuits on the same uid, so even re-running `ensureCometChatSession` would not repair it - only an explicit `updateUser` would. Breaks rows 17-22, 24-31.

### 2. CRITICAL - Sites that already have `avatarUrl` in scope and render initials anyway

The single biggest cause of the reported bug. Twelve sites receive the correct URL from Convex and then discard it:

* `ContactInfoScreen.tsx:98` - `otherMember.avatarUrl` present, `Avatar.Text` hard-coded. Tapping any 1:1 chat's info button always shows initials.
* `ChatInfoScreen.tsx:456` - `groupAvatarUrl` is correct for groups *and* DMs (`convex/conversations.ts:129`), but the guard is `isGroup && groupAvatarUrl`, so a DM is forced to initials even though the URL is right there.
* `ChatInfoScreen.tsx:422` - `member.avatarUrl` present, unused.
* `Calls.tsx:129-136`, `WebRTCCallScreen.tsx:330-337`, `IncomingCallOverlay.tsx:152-159` - `peer.avatarUrl` / `caller.avatarUrl` are in the query payloads and in the TS types; all three compute initials from a display-name string instead.
* `ChatScreen.tsx:61` - the local `Message.sender` type omits `avatarUrl`, so the field the backend sends is erased at the type boundary and no bubble avatar was ever built.
* `ForwardMessageScreen.tsx:115-123`, `ConversationsList.tsx:127-129` (my own avatar in the header), `ChatInfoScreen.tsx:688-699`, `GroupsList.tsx:282-316`.

### 3. HIGH - Zero shared resolver; 7 divergent copies of `initialsFor`

`ConversationsList.tsx:49`, `UsersList.tsx:28`, `GroupsList.tsx:39`, `ContactInfoScreen.tsx:12`, `ChatInfoScreen.tsx:43`, `ProfileScreen.tsx:32`, `ForwardMessageScreen.tsx:36`, plus two inline re-implementations at `WebRTCCallScreen.tsx:331-336` and `IncomingCallOverlay.tsx:153-158`, and two more in `Calls.tsx:42` and `ChatInfoScreen.tsx:456`. They disagree: `ProfileScreen.tsx:32-40` trims + uppercases + returns `'?'` for empty, the list copies do none of those and uppercase at some call sites but not others. The same person therefore shows different initials on the Profile screen than in the Users list. There is no canonical helper to call, so each new screen re-decides the policy.

### 4. HIGH - No broken-URL handling anywhere

Zero `onError` props on any avatar `<Image>` (rows 2, 3, 4, 6, 7). `Image` on Android/iOS renders nothing for a 404, so the user sees an empty circle with no fallback. Convex storage objects have no retention policy here, and `convex/users.ts:67` accepts any http URL, so a dead URL is storable and permanent.

### 5. MEDIUM - Group avatars have no member-derived fallback, and the field meant to be one is dead

`convex/conversations.ts:206` sets `emoji: emoji ?? "💍"` on every group, `schema.ts:27` stores it, `conversations.list:81` / `get:136` return it, and the list row types declare it (`ConversationsList.tsx:27`, `GroupsList.tsx:27`, `ForwardMessageScreen.tsx:26`) - and **no component ever renders it**. Grep confirms: `emoji` appears in `convex/` and in three type declarations, never in JSX.

### 6. MEDIUM - No avatar slot exists at all in the main chat surface

`ChatScreen` renders zero avatars: not in the header (`:1108-1141`), not on any bubble (`:788-1045`). Group chats compensate with a `sender.displayName` text line (`:815-825`), which is exactly the "only a few places use it, other places use the placeholder" experience - the screen the user spends the most time in has no avatar support at all. Same for the two member-picker sheets (`GroupsList.tsx:282-316`, `ChatInfoScreen.tsx:688-699`).

### 7. LOW - Legacy CometChat screens are still registered in the nav

`RootStackNavigator.tsx:138-204` mounts `Conversations`, `Messages` (CometChat variant), `UserInfo`, `GroupInfo`, `CreateConversation`, `AddMember`, `ViewMembers`, `BannedMember`, `AIAgents`, `Users`, `CallDetails` - 11+ permanently-initials screens that duplicate Convex screens and are the reason two "Messages" implementations exist.

---

## The fix

One canonical helper. Put it in `src/lib/avatar/resolveAvatar.ts` and copy the identical file to the Next.js web app's `lib/avatar/resolveAvatar.ts` - it has **zero React and zero React Native imports** on purpose, so both platforms share one implementation.

```ts
// resolveAvatar.ts  -  platform-agnostic. No react-native, no next/*.
export type AvatarSubject =
  | {
      kind: 'user';
      id?: string | null;
      name?: string | null;
      convexAvatarUrl?: string | null;   // canonical (Convex)
      cometchatAvatarUrl?: string | null; // legacy mirror (CometChat)
    }
  | {
      kind: 'group' | 'conversation';
      id?: string | null;
      name?: string | null;
      convexAvatarUrl?: string | null;   // uploaded group photo / DM peer's avatar
      cometchatAvatarUrl?: string | null;
      memberIds?: string[] | null;       // sorted, stable - drives the deterministic mosaic
    };

export type ResolvedAvatar =
  | { type: 'url'; uri: string; source: 'convex' | 'cometchat' }
  | { type: 'initials'; initials: string; color: string };

const PALETTE = [
  '#E5484D', '#2FBF71', '#F5A524', '#3E63DD',
  '#8E4EC6', '#12A594', '#D6409F', '#616161',
] as const;

/* ---------------------------------------------------------------- 1. URL sanity */

const HTTP = /^https?:\/\/\S+$/i;

/**
 * A value is only usable as an <Image uri> if it is a real absolute http(s) URL.
 * This rejects: null/undefined, '', whitespace, bare Convex storage *keys*
 * ("storageId:abc123"), `file://`, `data:`, and bare hostnames.
 */
function usable(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && HTTP.test(candidate.trim());
}

/* ---------------------------------------------------- 2. broken / 404 memory */

const broken = new Set<string>();

/** Call from <Image onError>. Permanently demotes that URL for this session. */
export function markBrokenAvatar(uri: string | null | undefined): void {
  if (usable(uri)) broken.add(uri.trim());
}

/** Test-only. */
export function __resetBrokenCache(): void {
  broken.clear();
}

/**
 * Optional server-side / web preflight. Native skips this (onError covers it);
 * the Next.js app calls it from a Server Component so a dead URL never reaches
 * the client. Treat any non-2xx as broken.
 */
export async function preflightAvatarUrl(uri: string): Promise<boolean> {
  if (!usable(uri) || broken.has(uri)) return false;
  try {
    const res = await fetch(uri, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- 3. precedence */

function pickUrl(
  convexUrl: unknown,
  cometchatUrl: unknown,
): { uri: string; source: 'convex' | 'cometchat' } | null {
  // Convex is the system of record -> it always wins. CometChat is a legacy
  // mirror that may be stale or empty, so it is only ever a second chance.
  for (const [value, source] of [
    [convexUrl, 'convex'],
    [cometchatUrl, 'cometchat'],
  ] as const) {
    if (usable(value) && !broken.has(value.trim())) {
      return { uri: value.trim(), source };
    }
  }
  return null;
}

/* --------------------------------------------------------- 4. initials + hue */

/** FNV-1a - stable across platforms and runs, unlike a raw char sum. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Single canonical initials rule. Handles: leading/trailing/duplicate spaces,
 * single-word names, accented + non-Latin scripts, emoji, and empty input.
 * Always returns 1-2 upper-case characters.
 */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return '?';

  const letters = parts.slice(0, 2).map((part) => {
    // Array.from so astral chars (emoji, some scripts) are not split in half.
    const [first] = Array.from(part);
    return first ?? '';
  });

  return letters.join('').toLocaleUpperCase() || '?';
}

/* ---------------------------------------------------- 5. deterministic mosaic */

export const MAX_MOSAIC_TILES = 4;

/**
 * Stable member ordering for a group's composite avatar.
 * Sort by id (never by display name, and never by array order - Convex's
 * `by_conversation` collect order is not stable across queries) so the mosaic
 * does not shuffle between renders.
 */
export function stableMemberIds(memberIds: string[] | null | undefined): string[] {
  return Array.from(new Set((memberIds ?? []).filter(Boolean))).sort();
}

/* ------------------------------------------------------------- 6. the helper */

export function resolveAvatar(subject: AvatarSubject): ResolvedAvatar {
  const name = subject.name ?? '';

  const url = pickUrl(subject.convexAvatarUrl, subject.cometchatAvatarUrl);
  if (url) {
    return { type: 'url', uri: url.uri, source: url.source };
  }

  const key = subject.id ?? name;
  return {
    type: 'initials',
    initials: initialsFor(name),
    color: PALETTE[hash(`${subject.kind}:${key}`) % PALETTE.length]!,
  };
}

/** Convenience: the raw Image source, or null when the caller must draw initials. */
export function avatarImageSource(
  subject: AvatarSubject,
): { uri: string } | null {
  const r = resolveAvatar(subject);
  return r.type === 'url' ? { uri: r.uri } : null;
}
```

### The React Native component that consumes it

```tsx
// src/components/common/UserAvatar.tsx
import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import {
  resolveAvatar,
  markBrokenAvatar,
  type AvatarSubject,
  type ResolvedAvatar,
} from '../../lib/avatar/resolveAvatar';

export const UserAvatar = ({
  subject, size = 48, square = false, onInitials,
}: {
  subject: AvatarSubject;
  size?: number;
  square?: boolean;              // groups
  onInitials?: (r: Extract<ResolvedAvatar, { type: 'initials' }>) => void;
}) => {
  const [resolved, setResolved] = useState<ResolvedAvatar>(() => resolveAvatar(subject));
  // Re-resolve whenever the identity or either URL changes.
  const key = JSON.stringify(subject);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setResolved(resolveAvatar(subject));
  }

  const radius = square ? size * 0.3 : size / 2;

  if (resolved.type === 'url') {
    return (
      <Image
        source={{ uri: resolved.uri }}
        // Network images only; local file:// from the picker never reaches here.
        onError={() => {
          markBrokenAvatar(resolved.uri);   // demote, then re-resolve
          setResolved(resolveAvatar({ ...subject, convexAvatarUrl: null }));
        }}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }

  onInitials?.(resolved);   // lets ChatInfoScreen compose a 2x2 member mosaic
  return (
    <View
      style={[styles.fallback, {
        width: size, height: size, borderRadius: radius,
        backgroundColor: resolved.color,
      }]}>
      <Text style={[styles.label, { fontSize: size * 0.4 }]}>{resolved.initials}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  label: { color: '#FFFFFF', fontWeight: '700' },
});
```

### Call-site migration (one line each)

| Row | Replace |
|---|---|
| 1 | `<UserAvatar subject={{kind:'user', id:user?._id, name:user?.displayName, convexAvatarUrl:user?.avatarUrl}} size={40}/>` |
| 7 | drop the `isGroup &&` guard: `subject={{kind: isGroup?'group':'user', name:title, convexAvatarUrl:groupAvatarUrl, memberIds:members.map(m=>m._id)}}` |
| 8 | `subject={{kind:'user', id:member._id, name:member.displayName, convexAvatarUrl:member.avatarUrl}}` |
| 10 | `subject={{kind:'user', id:otherMember?._id, name:displayName, convexAvatarUrl:otherMember?.avatarUrl}} size={96}` |
| 11 | `subject={{kind: item.type==='group'?'group':'user', id:item._id, name:item.title, convexAvatarUrl:item.avatarUrl}} size={44}` |
| 13 | add `avatarUrl: string \| null` to the `Message['sender']` type at `ChatScreen.tsx:61`, then render `<UserAvatar>` left of the bubble for `!mine` |
| 14 | `subject={{kind:'user', id:item.peer?._id, name, convexAvatarUrl:item.peer?.avatarUrl}}` |
| 15 | `subject={{kind:'user', id:call?.peer?._id, name:peerName, convexAvatarUrl:call?.peer?.avatarUrl}} size={140}` |
| 16 | `subject={{kind:'user', id:incoming?.caller?._id, name:callerName, convexAvatarUrl:incoming?.caller?.avatarUrl}} size={140}` |
| 23 | `subject={{kind:'group', name:groupToJoin.getName(), cometchatAvatarUrl:groupToJoin.getIcon()}}` - the `usable()` guard makes `{uri:''}` impossible |
| 2, 3, 4, 6 | `subject={...}` - keeps working, gains `onError` recovery for free |
| 17-22, 24-32 | either pass `cometchatAvatarUrl` after fixing root cause 1, or delete these screens |

### Make `updateProfile` write to both stores

In `ProfileScreen.handleSave`, after the Convex mutation resolves:

```ts
const saved = await updateProfile({ token, displayName, username, avatarUrl });
// Keep the legacy CometChat mirror in sync so rows 17-32 stop lying.
if (saved.avatarUrl && cometchatAvatarUrlRef.current !== saved.avatarUrl) {
  await CometChat.updateUser(
    new CometChat.User({ uid: username, avatar: saved.avatarUrl }),
    CometChat.AuthToken.None,
  ).catch(() => {});   // non-fatal: calls must keep working if CometChat is down
}
```

Also widen `convex/schema.ts:10` to `v.optional(v.union(v.string(), v.null()))` so a photo can be removed.

---
## Group avatar logic

### What commit 281edf9 actually shipped

`git show --stat 281edf9` ("feat: profile and group avatars, ..."):

```
convex/conversations.ts    |  35 +-   -> conversations.avatarUrl + updateGroup
convex/files.ts            |  10 +-   -> files.url
convex/schema.ts           |   1 +    -> conversations.avatarUrl
convex/users.ts            |  16 +-   -> users.avatarUrl + updateProfile
src/.../ChatInfoScreen.tsx | 125 +-   -> hero Image + camera badge
src/.../ConversationsList.tsx | 38 +- -> row avatar + own-header initials
src/.../GroupsList.tsx     |  33 +-   -> row avatar
src/.../ProfileScreen.tsx  | 177 +-  -> hero Image + camera badge
src/.../UsersList.tsx      |  36 +-  -> row avatar
```

`git show 281edf9 -- src/components/convex/ChatScreen.tsx` is **8 lines and none of them touch avatars** - only `textTertiary` -> `textSecondary` colour swaps. So the commit's claim "avatars render in lists" is literally true and exactly scoped to *lists*. It never touched `ChatScreen`, `ContactInfoScreen`, `Calls`, `WebRTCCallScreen`, `IncomingCallOverlay`, or the member rows. That is the entire user-reported bug, in one `git show`.

### How a group avatar is actually computed

1. **Stored:** `conversations.avatarUrl`, `v.optional(v.string())` (`convex/schema.ts:28`).
2. **Written:** only by `conversations.updateGroup` (`convex/conversations.ts:294-329`), which enforces `membership.role === 'owner'` server-side (`:304-306`) and `avatarUrl.startsWith("http")` (`:321-323`). It is the **only** writer in the codebase.
3. **Upload path:** `ChatInfoScreen.tsx:213-237` -> `files.generateUploadUrl` -> POST blob -> `setPendingAvatarStorageId` -> `:123-149` effect resolves `files.url` -> `updateGroup`. Because it is written via `updateGroup` it is *also* silently available on the **group** row; for a **DM** the value is ignored on read because `conversations.list:54` and `conversations.get:129` overwrite `avatarUrl` with the other user's `avatarUrl`. That overwrite is correct.
4. **Read:** `ChatInfoScreen.tsx:83` `groupAvatarUrl = conversation?.avatarUrl ?? null`; rendered only under `isGroup && groupAvatarUrl` (`:456`).
5. **Fallback:** `initialsFor(title)`.

### Is it deterministic?

**The uploaded-photo path is deterministic** (one stored URL per group).

**The initials fallback is deterministic per call site but *not consistent across call sites*.** Three incompatible `initialsFor` implementations are in the group path alone:

| Implementation | trim | filter empties | uppercase | empty -> `'?'` |
|---|---|---|---|---|
| `GroupsList.tsx:39-45` | no | yes | no (caller does not) | no (renders empty `<Text>`) |
| `ChatInfoScreen.tsx:43-44` | no | yes | yes (at call site `:461`) | no |
| `ProfileScreen.tsx:32-40` | yes | **no** | yes | yes |

So `" ana maria "` produces `AM` in the Groups list, `AM` on ChatInfo, and a leading-space-derived first letter in `ProfileScreen` (it splits on `/\s+/` *before* filtering, so the first part is `''` and `.filter(Boolean)` never runs - it relies on `.map(part => part[0])` returning `undefined` and then `.filter(Boolean)` dropping it, producing `AM` by luck, but `''` for a name that is only whitespace). Different screens can and do disagree.

### Does it break for sparse / mixed member sets? Yes, completely.

There is **no member-derived fallback at all**. A group with 30 members and no uploaded photo is an identical initials square on every screen, forever. Concretely:

* `ChatInfoScreen.tsx:83` reads only `conversation?.avatarUrl`. If it is `null` there is no attempt to derive anything from `conversation.members`.
* `conversations.emoji` is the field that was *meant* to be the cheap fallback: `createGroup` sets `emoji: emoji ?? "💍"` (`convex/conversations.ts:206`), `schema.ts:27` declares it, `list:81` and `get:136` return it, and three row types declare it (`ConversationsList.tsx:27`, `GroupsList.tsx:27`, `ForwardMessageScreen.tsx:26`). **Grep confirms it is never rendered in any JSX.** It is a fully-plumbed dead field.
* **Mixed sets:** there is no 2x2 composite. If we add one with `resolveAvatar`, it must obey two rules or it will flicker:
  1. **Sort member ids** (`stableMemberIds`). Convex's `members.by_conversation` collect order is index order and is not guaranteed stable between queries - an unsorted mosaic would reshuffle on every refetch.
  2. **Pad, never shift.** If only 1 of 4 members has a photo, tile 2/3/4 must render that member's *initials* tile, not collapse left. Otherwise the same group looks different every time someone without a photo joins.
* Adding a member does **not** recompute `avatarUrl` (correct), so a mosaic must be derived at render time, never persisted - otherwise it goes stale exactly like `emoji` did.
* `GroupInfoStyles.tsx:39 avatarImage` and `UserInfoStyles.tsx:35 avatarImage` exist for the CometChat group/user heroes but are dead alongside them.
* **`GroupHelper.tsx:390-393`** is the sharpest group-avatar defect in the legacy tree: `image={{uri: groupToJoin.getIcon()}}` with no guard. `getIcon()` returns `""` for a group with no icon, so `CometChatAvatar` receives `{uri:""}` and renders a broken image rather than initials. The two sibling sites (`GroupInfo.tsx:267-271`, `CallLogDetailHeader.tsx:96-98`) both guard correctly - this one was missed.

### Recommendation

Resolve in this order: (a) uploaded `avatarUrl`; (b) `conversations.emoji` if you revive it; (c) a deterministic 2x2 member mosaic over `stableMemberIds(memberIds)`; (d) title initials with the hashed colour. All four steps live inside the single `resolveAvatar()` branch above - callers stop branching entirely.

---

## Findings

1. **[CRITICAL]** `src/auth/cometchatSession.ts:14-16` - the CometChat user is created with `{uid, name}` and `CometChat.updateUser` is never called anywhere in the repo. Every CometChat-rendered avatar (14 sites: rows 17-22, 24-31) is permanently initials. Directly contradicts commit 281edf9's "profile and group avatars".

2. **[CRITICAL]** `src/components/convex/ContactInfoScreen.tsx:98` - the 1:1 "Contact info" screen hard-codes `<Avatar.Text>`. `otherMember.avatarUrl` is present and unused. This is the most user-visible single bug: the user sets a photo, opens a chat, taps the header, and sees initials.

3. **[CRITICAL]** `src/components/convex/ChatInfoScreen.tsx:456` - `isGroup && groupAvatarUrl` discards a correct DM avatar that `convex/conversations.ts:129` already computed. Group chat info works; DM chat info does not. Same screen, same row, opposite behaviour.

4. **[CRITICAL]** `src/components/convex/ChatScreen.tsx:61` - the local `Message['sender']` type is `{_id, displayName, username}`, which strips the `avatarUrl` that `convex/messages.ts:46-62,118` actually returns. The main chat surface has zero avatar support in the header (`:1108-1141`) and zero in any bubble (`:788-1045`). Per-commit evidence: `281edf9` changed 8 lines of `ChatScreen.tsx`, none avatar-related.

5. **[HIGH]** `src/components/calls/Calls.tsx:129-136`, `src/components/calls/WebRTCCallScreen.tsx:330-337`, `src/components/calls/IncomingCallOverlay.tsx:152-159` - three call surfaces compute initials inline from a display-name string while `peer.avatarUrl` / `caller.avatarUrl` sit in the Convex payloads (`convex/calls.ts:125,151,241`) and in the TypeScript types. Calls are the most emotionally loaded surface in the app and they are 100% placeholder.

6. **[HIGH]** No shared resolver exists. Seven copies of `initialsFor` plus two inline duplicates: `ConversationsList.tsx:49`, `UsersList.tsx:28`, `GroupsList.tsx:39`, `ContactInfoScreen.tsx:12`, `ChatInfoScreen.tsx:43`, `ProfileScreen.tsx:32`, `ForwardMessageScreen.tsx:36`, `Calls.tsx:42`, `WebRTCCallScreen.tsx:331-336`, `IncomingCallOverlay.tsx:153-158`. They disagree on trimming and casing, so one person renders different initials on different screens. This is why a fix must be a helper, not a set of patches.

7. **[HIGH]** Zero `onError` handlers on any avatar `<Image>` (`ConversationsList.tsx:180`, `UsersList.tsx:144`, `GroupsList.tsx:185`, `ProfileScreen.tsx:210`, `ChatInfoScreen.tsx:457`). A 404'd URL renders an empty transparent box rather than initials - the worst of the three failure modes because it looks like a layout bug, not a data bug.

8. **[HIGH]** `src/components/convex/ChatInfoScreen.tsx:422` and `:688-699`, `src/components/convex/GroupsList.tsx:282-316` - member rows and both member-picker sheets render no avatar at all, although `users.list` and `conversations.get` both return `avatarUrl` for every member.

9. **[HIGH]** `src/components/convex/ConversationsList.tsx:120-130` - the app's own "my avatar" button in the Chats header renders initials even though `useSession().user.avatarUrl` is one property away. The user's own face is the one they can least afford to see missing.

10. **[MEDIUM]** `src/components/convex/ProfileScreen.tsx:115-133` + `convex/users.ts:66-71` - only Convex is written. There is no way to *remove* a photo either: `avatarUrl` is `v.optional(v.string())` with no `null` path, and `avatarDraft ?? undefined` means "unchanged". Needs `v.optional(v.union(v.string(), v.null()))`.

11. **[MEDIUM]** `convex/conversations.ts:206` / `convex/schema.ts:27` - `conversations.emoji` is fully plumbed (written at creation, stored, returned by `list`/`get`, declared in three row types) and rendered in **zero** components. It was the intended group-avatar fallback and was silently dropped.

12. **[MEDIUM]** Group avatars have no member-derived fallback of any kind. A group with no uploaded photo is an identical initials square on every screen regardless of membership; nothing in `ChatInfoScreen.tsx:83` looks at `conversation.members`.

13. **[MEDIUM]** `src/components/groups/GroupHelper.tsx:392` - unguarded `image={{uri: groupToJoin.getIcon()}}` passes `{uri:""}` for an icon-less group, producing a broken image. `GroupInfo.tsx:267-271` and `CallLogDetailHeader.tsx:96-98` guard correctly; this one was missed.

14. **[MEDIUM]** `src/components/calls/CallHistory.tsx:121-128,199-224` - `avatarStyle` is computed and then never passed to `CometChatListItem`. Call-history rows in `CallDetails` have no avatar at all.

15. **[MEDIUM]** `src/navigation/RootStackNavigator.tsx:138-204` - 11+ permanently-placeholder CometChat screens remain registered alongside their Convex replacements, including two different `Messages` implementations (`ChatScreen` at `:146` and the CometChat `Messages.tsx` path). This doubles the surface that must be fixed and makes the bug hard to reason about.

16. **[LOW]** `src/components/convex/ForwardMessageScreen.tsx:115-123` and `:26` - `ConversationRow` declares `avatarUrl?: string | null` and then renders `<Avatar.Text>`. A one-line omission that is pure regression risk for whoever next touches the forward sheet.

17. **[LOW]** `convex/users.ts:67` validates only `startsWith("http")`. Any third-party URL can be stored, so a slow or hostile host is a permanent per-user failure with no `onError` recovery (finding 7).

18. **[LOW]** `src/components/conversations/screens/GroupInfoStyles.tsx:39` and `UserInfoStyles.tsx:35` define `avatarImage` styles consumed only by dead CometChat screens.

19. **[LOW]** Signup never captures an avatar (`convex/auth.ts:104-110`, no avatar code in `Login.tsx` / `SignUp.tsx`). Every account begins as initials, which makes the placeholder paths look "correct" to a new user and masks the bug until they upload a photo - exactly when the inconsistency becomes visible.
