# Synomiló — Mobile App Audit & Web Parity Report

**Scope:** full audit of the React Native app at `P:\Projects\cometchat-sample-app` (bare RN 0.81.4, Android + iOS), plus a build plan for a Next.js web app on the same backend.

**Method:** 13 specialist subagents audited the app independently. A 14th agent independently **verified** the security claims and refuted 8 of them. Findings below are only those that survived verification.

**Raw reports:** 13 files, ~600 KB, in `docs/audit/`.

| # | Report | Findings |
|---|--------|----------|
| 01 | [Incoming call ringing](01-call-incoming-ringing.md) | 21 (5 CRIT) |
| 02 | [Outgoing & ongoing calls](02-call-outgoing-ongoing.md) | 12 (2 CRIT) |
| 03 | [Auth & login](03-auth-login.md) | 25 (4 CRIT) |
| 04 | [Convex backend](04-convex-backend.md) | 41 fns audited |
| 05 | [Avatars](05-avatars.md) | 33 sites |
| 06 | [Chat & messaging](06-chat-messaging.md) | 20 (3 CRIT) |
| 07 | [State & performance](07-state-performance.md) | 10 leaks |
| 08 | [Native & secrets](08-native-secrets.md) | — |
| 09 | [Feature inventory](09-feature-inventory.md) | 262 features |
| 10 | [Bloat & dead code](10-bloat-deadcode.md) | 84 files |
| 11 | [Web stack research](11-web-stack-research.md) | — |
| 12 | [Security verification](12-security-verification.md) | 4 confirmed |
| 13 | [Call architecture proposal](13-call-architecture-proposal.md) | 1,754 lines |

---

## Verdict

The app does not have bugs. It has an **unfinished migration** that was shipped as a finished product.

Sometime mid-build the developer replaced CometChat with Convex as the backend for chat, groups, users and messages. They rebuilt the screens under `src/components/convex/` and added Convex to the backend — but **they never deleted the old CometChat UIKit screens, never re-pointed the navigator, and never finished the call pipeline.** Both stacks ship in every release APK.

Everything below is downstream of that one fact. The call bugs are because three different ringing engines are running at once and none of them is complete. The avatar bugs are because avatars live in two databases that never got synchronised. The login bug is because the login screen was never wired into navigation.

---

## The six symptoms you reported, root-caused

### 1. "Sometimes their phone rings, sometimes it doesn't"

Three services claim `com.google.firebase.MESSAGING_EVENT` in the shipped manifest (3–4 merged manifests, `merged_manifests/release/...:139,233,494`). Android delivers a push to exactly one of them. **Which one is nondeterministic** — so delivery is a coin flip, and a lost push means no ring.

Compounding it: the call push carries an FCM `notification` block (`convex/push.ts:45-61`), so when the app is backgrounded or killed, **Play Services draws it and the app's own handler never runs**. The app's full-screen ringing code is not on the critical path. Commit `e63d82d` deliberately made this change, and the comment says why — but the consequence was that the real ring path became dead code: `sendDataToTokens` (`convex/push.ts:80-101`) now has zero callers.

### 2. "It just gives a vague notification that somebody is calling"

Commit `e63d82d` also switched the notification to a plain heads-up on channel `incoming_call_v2` with no full-screen action, no `category: call`, no Accept/Decline, no ring loop. **That is the vague notification.** It is a deliberate change that nobody followed up on.

When the Notifee full-screen path *does* fire, it launches `MainActivity` (`callNotifications.ts:72`) — an activity that `e63d82d` deliberately stripped of `showWhenLocked`/`turnScreenOn`. So on a locked screen it opens a blank RN screen behind the keyguard. There is **no dedicated ringing activity in the app's manifest at all**.

### 3. "If I have minimized the app while calling someone, there is nothing"

`notifee.displayNotification` is called **exactly once in the entire app**, and only for *incoming* rings, pushed only to the callee. **There is no ongoing-call notification.** Minimise mid-call and you get nothing at all.

Ironically the correct code already exists — `CallNotificationService.java:32-45` has `setOngoing`/`setWhen`/`setUsesChronometer`/`setOnlyAlertOnce` — but it is only started by `CometChatCalls.init()`, **which is never called in this repo**.

### 4. "What I see is that I may know there's a call but nothing else"

All call state lives in screen-local `useState` (`WebRTCCallScreen.tsx:60-66`). The only zustand store in the app holds theme config. There is zero `AppState` handling in the call screen, no in-call banner, no mini-player. `NavigationService.ts:22-35` has no dedupe, so a second call screen can stack on top of a first.

### 5. "The duration numbers are weird"

The duration is anchored to the **server** clock (`convex/calls.ts:167` writes `startedAt`) but computed against the **device** clock (`WebRTCCallScreen.tsx:242`). Any clock skew produces negative values — literally rendering as `-1:-3`. Separately, `elapsed` initialises to `0` rather than being seeded from `answeredAt`, so received calls paint `00:00` and then jump to the real time a tick later.

### 6. "Not properly fleshed out"

A WhatsApp-grade call screen needs: group calls, audio↔video upgrade, speaker, Bluetooth routing, proximity sensor, hold, per-participant tiles, network-quality indicator, screen-on during call. None present. See the phased plan in report 13.

---

## The other atrocities

### Security — 4 confirmed criticals

| # | Finding | Impact |
|---|---------|--------|
| 1 | **Firebase Admin private key is in git history.** Deleted in commit `c0e6aa1`, but still recoverable: `git show v1.0.3^:synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json` prints a valid RSA-2048 key for project `synomilo-92580`. A plain `git clone` fetches tags. | Full admin over Firestore, RTDB, Storage and FCM. **Rotate immediately.** |
| 2 | **Live credential committed.** `scripts/publish-release.mjs:26-28` hardcodes `username: "yashraj"`, `password: "testpass123"` and logs into the production Convex deployment. | Tracked in git. Rotated? Probably not. |
| 3 | **`updates.publish` → remote code execution.** Authorises on a hardcoded username with no role column, and `register` never reserves that username, so anyone can register it. `UpdateChecker.tsx` downloads and installs the artifact with no integrity check. | Anyone can push an APK to every install. |
| 4 | **CometChat app-level `authKey` is in the client bundle** (`src/utils/AppConstants.tsx:6`). | Compromise of the entire CometChat app. Rotate. |

Plus 5 IDOR-class authorisation holes that matter enormously once a **browser** drives this backend:

- `conversations.typing` — no membership check; any logged-in user reads any conversation's typing roster.
- `conversations.addMembers` — checks membership but not `role === "owner"`; any member can pull strangers into a private group.
- `files.url` — auth helper result discarded; signed URL for any `storageId`.
- `messages.send` — `replyToId` never validated against the target conversation; `messages.list:106` returns the foreign message body.
- `updates.publish` — as above.

**The verifier refuted 8 claims from the first pass**, and you should know the corrections: the tracked `.jks` is the *vendor's public CometChat demo keystore*, not synomiló's release key; `build.gradle` never hardcoded release passwords; `.env.local` is properly ignored; CI has no hardcoded secrets; the PBKDF2 iteration claim was wrong. Those are not as bad as first reported.

### Login is broken by design

**There is no code path that navigates to the login screen.** `RootStackNavigator.tsx:83-91` sets `initialRouteName` once; `navigate(SCREEN_CONSTANTS.LOGIN)` appears nowhere. In debug the app boots to `SampleUser.tsx`, which is **CometChat-only and creates no Convex session**. So debug login succeeds, then the Convex-backed UI has no token. In release, a user who logs out is stranded in authenticated UI with no way back to sign in.

Also: sessions have **no TTL** (`schema.ts:15-22`) — a leaked token is valid forever, including offline. And `login`/`register` have **zero brute-force protection**.

### Avatars — 28 of 33 sites show a placeholder

Two databases hold avatars and they are never synchronised. `cometchatSession.ts:14-16` creates the CometChat user as `{uid, name}` with **no avatar**, and `updateUser` is never called — so 14 sites are permanently stuck on initials. In 12 further sites the correct `avatarUrl` is **already in scope and simply discarded** (e.g. `ChatInfoScreen.tsx:456` throws away a correct DM avatar behind an `isGroup &&`). There are 7 divergent copies of an `initialsFor` helper and no shared resolver, and **no avatar `<Image>` anywhere has an `onError`**, so a 404 renders an empty box rather than falling back.

### Dead code — 536 KB, 84 files

The CometChat UIKit screen stack is still registered in the navigator but unreachable from any `navigate()` call. **16 of 18 screens in `RootStackNavigator.tsx` are dead** — 6,888 LOC, 38% of `src/`. 84 dead files, 536,415 bytes, ~970 KB of release APK (1.4%). 52 unused icon components (322 KB). 5 superhero avatar PNGs ship in every release to feed a `__DEV__`-only screen.

**And the migration actively broke a feature:** `BottomTabNavigator.tsx:99` filters the groups tab, so the FAB bubbles to the dead stack and navigates to `Messages` with a `{group}` param that live `ChatScreen.tsx:244` ignores — **infinite spinner**. The working `GroupsList.tsx` is dead behind one line of code.

### Other landmines

- **Typing indicator writes to the DB on every keystroke** (`ChatScreen.tsx:389-393`) — 8 writes/sec, each invalidating 4 live queries including the 60-message list. ~180 index scans per second of typing.
- **No message pagination.** `limit: 60` hardcoded at `ChatScreen.tsx:256`; `hasMore` is ignored, so quotes older than 60 messages fail silently.
- **Saved Messages is unreachable** and would break if reached — it navigates with `{user, group}` that Convex cannot read.
- **1-minute ExoPlayer per video cell** inside a FlatList (`ChatScreen.tsx:913`).
- `npm test` is a single assert-free render call with no mocks — **no safety net for any refactor.**

---

## Feature inventory

262 features catalogued: **LIVE 157 · PARTIAL 10 · DEAD 27 · NOT-BUILT 68**.
Web parity: **NATIVE-DIRECT 192 · WEB-HARD 60 · MOBILE-ONLY 10**.

---

## Web app: the decision that shapes everything

**CometChat's JavaScript SDKs are proprietary with a competitive-use prohibition** (§4.04e of their ToS, $10 liability cap, "free for development" tier only, calls metered separately). Shipping CometChat in a public web app is a licence risk.

**Recommendation: replace CometChat calls with LiveKit** (Apache-2.0) on *both* platforms, keeping Convex as the authoritative state machine with a Convex internal action minting LiveKit tokens.

Why both platforms: one signalling model, one call schema, one code path to get right. The web app stops being a special case. The full spec is in [report 13](13-call-architecture-proposal.md).

### Honest web limitations

There is **no full-screen incoming-call UI in any browser.** No `fullScreenIntent`, no CallKit. Edge's `scenario: "incoming-call"` is an unshipped explainer behind a flag. What you can actually ship is an OS notification (Chromium only, ≤2 actions, OS-truncated title) plus an in-page overlay. iOS web push requires PWA installation to the Home Screen. A call can be kept alive across tab switches only by keeping a `RTCDataChannel` open (a spec'd exemption from Chrome's 1-minute throttling).

So: **mobile keeps the proper WhatsApp-grade ringing; web gets the best the platform allows.** Building web first would have hidden these constraints entirely.

---

## Recommended order of work

**Phase 0 — today, no new deps (stop the bleeding)**
1. Rotate the Firebase admin key and the CometChat `authKey`. Scrub git history or abandon the repo lineage.
2. Delete `scripts/publish-release.mjs`'s hardcoded credential; use env vars.
3. Close the 5 IDORs. Required before any browser can touch this backend.
4. Collapse the three `MESSAGING_EVENT` claimants to one. Fix the token-registration race (`App.tsx:167-180` returns early on denied permission and never stores the token).
5. Fix `durationMs = max(0, (endedAt ?? serverNow) - answeredAt)` — kills the `-1:-3` garbage in ~5 lines.
6. Add the ongoing-call notification (the `CallNotificationService.java` code already exists — call it).
7. Re-point the Groups FAB at `GroupsList.tsx` (one line) to kill the infinite spinner.
8. Wire a real login route.

**Phase 1 — delete dead code.** 84 files, ~970 KB APK. Do it *after* Phase 0, and fix ProGuard keep rules first (R8 is currently off; enabling it without keep rules breaks every native module in release).

**Phase 2 — fix mobile calls properly.** Dedicated `IncomingCallActivity`, PushKit/CallKit registration race on iOS, the `aps-environment=development` blocker, in-call banner, `beforeRemove` guard. Full-screen intent needs a runtime `canUseFullScreenIntent()` check because Play can revoke it — the ring silently degrades to a heads-up otherwise.

**Phase 3 — gate spike on `@livekit/react-native`** under RN 0.81.4 + New Architecture, one day, before committing to the migration. Note `react-native-webrtc` → `@livekit/react-native-webrtc` is a hard cutover; delete the old package last or you lose the rollback.

**Phase 4 — build the web app**, LiveKit client-only via `dynamic(..., {ssr:false})`, FCM Web push with a service worker, Convex token in an HttpOnly cookie, multi-tab dedupe so one user with two tabs doesn't ring twice.

---

## Known risks

- **Play can revoke `USE_FULL_SCREEN_INTENT`** — this silently un-fixes symptom 2 on real devices. Ship the check and the degraded-mode copy.
- **`proguard-rules.pro` is empty and R8 is off.** Fix keep rules before anyone flips `minifyEnabled`.
- **`REQUEST_INSTALL_PACKAGES` will likely get a Play rejection** — unrelated to bugs, blocks release.
- **DTMF cannot work** — there is no SIP leg, so there is no far-end keypad. Don't build it.
- LiveKit Egress recording, DTMF and native screen share are 3–10 days each for features nobody asked for. Recording must be ported or consciously dropped — `CallRecordings.tsx` exists today.