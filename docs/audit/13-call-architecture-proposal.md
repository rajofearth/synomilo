# 13 — Call Architecture Proposal (React Native + Next.js, Convex + LiveKit)

**Status:** design spec. No source file was modified.
**Reads after:** `01-call-incoming-ringing.md`, `02-call-outgoing-ongoing.md`, `08-native-secrets.md`, `11-web-stack-research.md`. This document does not re-derive their findings; it cites them as constraints and turns them into a build plan.
**Scope:** the call subsystem only — signalling, state, push, ringing UI, ongoing UI, duration, web parity, and the migration path.

---

## Decision summary

**Build one call system: LiveKit for media on both React Native and Next.js, Convex as the authoritative state machine, Convex actions for push.** Keep `calls` in Convex and keep the existing `start`/`accept`/`end` verbs — replace only the media plane and the SDP/ICE signalling, then rebuild ringing around a single push owner.

Concretely: (1) Phase 0 makes ringing reliable today with no migration — one ringer, one payload, unconditional token registration, terminal pushes, an `IncomingCallActivity`, and a foreground-service ongoing notification with a chronometer. (2) A new `calls` table with an explicit state machine and a `pushTokens` table lands behind a flag. (3) One Convex internal action (`push.sendCallPush`) is the only thing that rings a phone, and every client state — cold start, background, foreground, CallKit — converges on one idempotent handler keyed by `callId`. (4) Duration is always `(endedAt ?? serverNow) - answeredAt`, never a counter. (5) LiveKit replaces `react-native-webrtc` because CometChat's JS packages are proprietary with a competitive-use prohibition, and because one signalling model serving both platforms is cheaper than two.

~25–36 engineer-days across seven phases. Every phase ships and rolls back independently.

---

## 0. What is already known, and what this document adds

The audits already established, and this spec treats as fixed constraints:

| Constraint | Source |
| --- | --- |
| Call push is `notification`+`data`, so Play draws it and the app's full-screen path is off the critical path. `push.sendDataToTokens` is dead code. | 01 #1 |
| Two `FirebaseMessagingService` claimants; routing is nondeterministic. | 01 #5, 08 A1 |
| No ringing `Activity` exists; `showWhenLocked`/`turnScreenOn` were deliberately removed from `MainActivity`. | 01 #2 |
| `fullScreenAction.id === 'accept-call'` auto-answers on lock-screen. | 01 #3 |
| FCM token is not stored if the permission prompt is declined; server silently skips push. | 01 #8 |
| One `pushToken` per user, last-write-wins: device N+1 kills device N. | 01 #10 |
| No terminal push — a hung-up call keeps ringing for the full 60 s. | 01 #7 |
| No ongoing notification anywhere. CometChat ships one (`CallNotificationService.java`) but `CometChatCalls.init()` is never called. | 02 #1, #2 |
| No call store; all live call state is local `useState` and dies with the screen. | 02 #2 |
| Duration is a server clock subtracted from a device clock; `elapsed` is never seeded; `formatElapsed` has no hours and no negative guard. | 02 #6, #7, #11 |
| `aps-environment` hardcoded to `development`; no PushKit entitlement; CometChat's bundle ID. iOS rings on dev builds only. | 08 C5, B1, B3, B4 |
| Three `MESSAGING_EVENT` claimants in the shipped manifest; `onMessage`/`onNewToken` routing undefined. | 08 A1, Android-7 |
| CometChat JS is proprietary, revocably licensed, with a §4.04(e) competitive-use prohibition. LiveKit is Apache-2.0. | 11 §1 |
| Browsers have no incoming-call activity; no full-screen intent; `requireInteraction` is "Limited availability"; iOS web push needs an installed PWA. | 11 §504 |
| Chrome exempts a live call from intensive throttling via an open `RTCDataChannel` / live `MediaStreamTrack`. | 11 §545 |

What this document adds: a decision on the RN side of the LiveKit question, an exact schema and state machine, an exact push payload and handler, an Android/iOS ringing and ongoing implementation, a duration rule, a web design, and a phased migration.

---

## 1. Decision: CometChat calls vs LiveKit for the React Native app too

### 1.1 The options

The RN app currently does **not** use CometChat for calls at all. It uses Convex for signalling and `react-native-webrtc` for media (`src/components/calls/WebRTCCallScreen.tsx:115`). The CometChat calls surface in the repo is dead:

- `CometChatCalls.init()` — 0 call sites repo-wide (02 #9).
- `OngoingCallScreen`, `CallDetails`, `CallHistory`, `CallRecordings` are registered in the stack and never navigated to; they read the CometChat dashboard, not `convex/calls` (02 #9, 09).
- The single remaining `CometChat.initiateCall` is one legacy screen, `src/components/conversations/screens/UserInfo.tsx:158` (02 #9).
- The CometChat native push engine is a *third* ringer that never fires correctly and, when it does, calls `acceptCall` on a `sessionId` this app never created (01 #6).

So the real choice is not "CometChat vs LiveKit". It is:

| Option | Media plane | Signalling | Cost | Licence | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Keep hand-rolled WebRTC on Convex** | `react-native-webrtc` | Convex `callSignals` rows | Works today | Apache/MIT-ish | **Not viable for web.** Browsers need an SFU; a pure Convex-signalled P2P mesh does not work through NAT, has no TURN, no group calls, no recording, no stats, and reinvents every media edge case. |
| **B. Move the RN app to CometChat Calls** | CometChat SDK | CometChat servers | Large re-integration of a subsystem that is currently dead code | Proprietary, revocable, §4.04(e) | **Rejected.** It fixes nothing for web, and it adds the licence exposure to the RN app too. |
| **C. LiveKit everywhere** | LiveKit SFU + `@livekit/react-native` | Convex stays authoritative; a Convex action mints LiveKit JWTs | Bounded — the Convex call record survives intact | Apache-2.0 throughout | **Recommended.** |

### 1.2 The three questions, answered

**(a) Does LiveKit really work identically on RN and web?** Yes, and this is the decisive point. `livekit-client@2.22.4` is Apache-2.0 and is the shared core; `@livekit/components-react@2.9.24` and `@livekit/react-native@3.0.0` (or `2.12.0`) are two presentation layers over it, with the same `Room`, `Participant`, `Track`, `LocalTrackPublication` object model. Verified on the registry today:

```
livekit-client                => 2.22.4 | Apache-2.0
@livekit/react-native         => 3.0.0  | Apache-2.0   (peer: livekit-client ^2.19.0,
                                                        @livekit/react-native-webrtc ^144.2.0)
@livekit/react-native-callkeep=> 4.3.16 | ISC
livekit-server-sdk            => 2.19.1 | Apache-2.0
@livekit/components-react     => 2.9.24 | Apache-2.0
```

There is no `@livekit/components-react-native` — the RN UI is built from `useTracks` / `RoomAudioRenderer` / `<VideoTrack>` hooks exported by `@livekit/react-native`. That is a small UI assembly job, not a second SDK.

Consequence: **one signalling model serves both platforms.** Convex holds the call record and the state machine; a Convex action mints the LiveKit access token; the client connects. The web app is not a special case — it is the same `useCallSession`, the same `calls.accept`, the same push payload, rendered with different components.

**(b) Migration cost.** The honest accounting. The expensive-looking part is the native WebRTC swap, and it is smaller than it looks.

| Work | Size | Why |
| --- | --- | --- |
| `convex/schema.ts` calls table + `pushTokens` + `callSessions` | 0.5 d | Additive; the existing `calls` table is already 90% of the target shape. |
| State machine + guard + `serverNow` on every response | 1 d | ~120 lines in `convex/lib/callState.ts`. |
| Push: single owner, one payload, terminal pushes, multi-device fan-out | 2 d | `convex/push.ts` gains one builder; `convex/calls.ts` gains four `ctx.scheduler.runAfter(0, internal.push.sendCallPush, …)` calls. |
| Converged client push handler (cold/background/foreground/action/CallKit) | 2 d | Replaces `src/notifications/background.ts` + three `App.tsx` effects. |
| `IncomingCallActivity` + manifest + Notifee FSI config + FGS ongoing notification | 2.5 d | Kotlin activity is ~80 lines; it renders an existing RN view via a `ReactActivity` subclass or is a plain `Activity` that boots the RN root with a `callId` extra. |
| CallKit + PushKit (replacing the CometChat AppDelegate hooks) | 1.5 d | The CometChat package already gets the *ordering* right (08 iOS-6); we copy that position, not its code. |
| LiveKit server + `mintLiveKitToken` action + RN room swap | 5–7 d | The big one. Includes the WebRTC package swap. |
| Web app call surface | 4–6 d | Per 11 §292–425. |

**The package swap, stated plainly.** `@livekit/react-native` depends on `@livekit/react-native-webrtc@^144.2.0`, not `react-native-webrtc@124`. That is a different native module, autolinked differently, with its own Gradle/Pod footprint. Two consequences:

1. `react-native-webrtc` cannot coexist with `@livekit/react-native-webrtc` in one build without symbol collisions — `RTCPeerConnection`, `RTCSessionDescription` and friends are defined in both. This is a **hard cutover**, not an additive install.
2. `android/app/proguard-rules.pro` is empty and `minifyEnabled` is `false` (08 A10, Android-10). Flipping R8 on with no keep rules breaks every native module at runtime. This must be fixed **before** the swap, not after.

Also note the app is on the **New Architecture** (`newArchEnabled=true`, `gradle.properties:35`). Verify the LiveKit RN fork's New Arch compatibility in Phase 4 spike before committing; if it is a blocker, `@livekit/react-native@2.12.0` is the fallback pin.

**Total: ~25–36 engineer-days including web, ~19–30 excluding web.**

**(c) Licence.**

| Package | Declared licence |
| --- | --- |
| `@cometchat/chat-sdk-react-native` | `SEE LICENSE IN LICENSE.md` — proprietary, revocable |
| `@cometchat/calls-sdk-react-native` | proprietary (npm literally reads `License: none`) |
| `@cometchat/push-notifications-react-native` | proprietary |
| `livekit-client`, `@livekit/react-native`, `livekit-server-sdk`, `@livekit/components-react` | **Apache-2.0** |
| `@livekit/react-native-callkeep` | ISC |
| `react-native-callkeep` (if used directly) | ISC |

CometChat's ToS §4.04(e) forbids using it to develop a product with functionality substantially similar to or competitive with the Software, and §9 caps liability at $10 if you never subscribed. 11 §1 already ruled it out for web. **The same reasoning applies to the RN app**, and it applies with *more* force there, because the RN app is the shipping product.

### 1.3 Recommendation

**Adopt option C. LiveKit on both platforms. Keep Convex authoritative. Strangle, do not rewrite.**

The migration is incremental because the Convex call record is the durable half and it stays. Only the media plane and the SDP/ICE relay move. Specifically:

- `convex/calls.ts:248-300` (`signal` / `signals` / `consumeSignals`) **dies** in Phase 4. LiveKit's SFU does SDP/ICE. This is the only server code that goes away.
- Every other `calls.*` verb survives, gaining a state machine.
- `calls.start` gains a `mediaBackend: "webrtc" | "livekit"` column so the media path is switchable at runtime during the transition, and a bad LiveKit deploy can be rolled back to the WebRTC path without a schema rollback.

```ts
// convex/schema.ts — one column that makes the cutover reversible
mediaBackend: v.union(v.literal("webrtc"), v.literal("livekit")),
```

Rollback semantics: set `mediaBackend` back to `"webrtc"`, clients reconnect to the legacy `WebRTCCallScreen`. Old calls in flight on the old path continue on the old path; new calls use LiveKit. The state machine is shared by both paths, which is the whole point of doing the schema first.

---

## 2. Convex schema

### 2.1 Tables

Replace the `calls` table; add three new ones. Everything is additive against the current data except the `calls` shape, so a migration script maps old rows forward.

```ts
// convex/schema.ts

export const CALL_STATUSES = [
  "ringing",
  "accepted",
  "rejected",
  "cancelled",
  "ended",
  "missed",
  "busy",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const END_REASONS = [
  "normal_hangup",
  "declined",
  "unanswered",
  "cancelled_by_caller",
  "busy",
  "peer_disconnected",
  "media_failure",
  "answered_elsewhere",
] as const;
export type EndReason = (typeof END_REASONS)[number];

// ─────────────────────────────────────────────────────────────── calls
calls: defineTable({
  conversationId: v.id("conversations"),
  callerId: v.id("users"),
  calleeIds: v.array(v.id("users")), // length >= 1; 1 = 1:1, >1 = group
  mediaType: v.union(v.literal("audio"), v.literal("video")),

  // Which side is asking. `outgoing` is derived per-viewer from callerId,
  // persisted so history queries do not recompute it.
  direction: v.union(v.literal("incoming"), v.literal("outgoing")),

  status: v.union(
    v.literal("ringing"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("cancelled"),
    v.literal("ended"),
    v.literal("missed"),
    v.literal("busy"),
  ),

  endReason: v.optional(
    v.union(
      v.literal("normal_hangup"),
      v.literal("declined"),
      v.literal("unanswered"),
      v.literal("cancelled_by_caller"),
      v.literal("busy"),
      v.literal("peer_disconnected"),
      v.literal("media_failure"),
      v.literal("answered_elsewhere"),
    ),
  ),

  // Authoritative timestamps. Written by the Convex clock, never by a client.
  createdAt: v.number(),
  answeredAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),

  // Durability of the ringing window. The scheduler is scheduled off this,
  // not off a literal, so the client and server cannot disagree.
  ringTimeoutMs: v.number(),

  // Swap target for Phase 4 rollback. See §1.3.
  mediaBackend: v.union(v.literal("webrtc"), v.literal("livekit")),

  // Opaque per-install ids (Android installation id, iOS vendor id, web
  // sessionStorage UUID). The accept arbiter names the winner here.
  clientSessionIds: v.array(v.string()),
  answeredByClientSessionId: v.optional(v.string()),

  // LiveKit, Phase 4. Empty string until then.
  livekitRoomName: v.optional(v.string()),
})
  .index("by_caller", ["callerId"])
  .index("by_callee", ["calleeIds"])
  .index("by_conversation_createdAt", ["conversationId", "createdAt"])
  .index("by_status_createdAt", ["status", "createdAt"]),
// NOTE: `.index("by_callee", ["calleeIds"])` on an array field indexes each
// element, so `q.eq("calleeIds", userId)` finds every call this user is on.
// Verified Convex behaviour; it replaces today's two `by_callee*` indexes.

// ───────────────────────────────────────────────────── pushTokens (new)
// One row per device. Replaces `users.pushToken: v.optional(v.string())`
// (01 #10 — one token per user means device N+1 kills device N).
pushTokens: defineTable({
  userId: v.id("users"),
  token: v.string(),
  platform: v.union(
    v.literal("android"),
    v.literal("ios"),
    v.literal("web"),
  ),
  deviceId: v.string(), // stable per install; survives sign-out
  // Set while this device is in a call. Push is skipped for these devices so
  // you do not get rung by call B while on call A.
  activeCallId: v.optional(v.id("calls")),
  lastSeenAt: v.number(),
  enabled: v.boolean(),
})
  .index("by_user", ["userId"])
  .index("by_token", ["token"]),

// ──────────────────────────────────────────────────── callSessions (new)
// Per-device, per-call join state. The source of truth for "is this device
// actually in this call", which the current code has nowhere to put (02 #2).
callSessions: defineTable({
  callId: v.id("calls"),
  userId: v.id("users"),
  clientSessionId: v.string(),
  platform: v.union(
    v.literal("android"),
    v.literal("ios"),
    v.literal("web"),
  ),
  role: v.union(v.literal("caller"), v.literal("callee")),
  state: v.union(
    v.literal("ringing"), // notification shown
    v.literal("connecting"), // accepted, media not up
    v.literal("connected"), // media flowing
    v.literal("left"),
  ),
  joinedAt: v.number(),
  lastSeenAt: v.number(),
})
  .index("by_call", ["callId"])
  .index("by_user_state", ["userId", "state"]),

// ────────────────────────────────────────────── callEvents (new, Phase 4)
// Append-only. Not on the hot path; this is the debugging surface and the
// input to any future analytics. Cheap to add now, expensive to backfill.
callEvents: defineTable({
  callId: v.id("calls"),
  at: v.number(),
  from: v.optional(v.union(v.literal("caller"), v.literal("callee"), v.literal("system"))),
  clientSessionId: v.optional(v.string()),
  kind: v.string(), // "start" | "accept" | "reject" | "cancel" | ...
  detail: v.optional(v.string()),
}).index("by_call_at", ["callId", "at"]),
```

`users.pushToken` stays for one release cycle (Phase 0 writes both, Phase 2 stops writing it) so a mid-migration rollback still rings.

### 2.2 The state machine

Legal transitions. Anything not in this table is rejected server-side.

| From \ To | `ringing` | `accepted` | `rejected` | `cancelled` | `ended` | `missed` | `busy` |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **(none)** | `start` | — | — | — | — | — | `rejectBusy` |
| `ringing` | — | `accept` | `reject` | `cancel` | — | `expire` | `rejectBusy` |
| `accepted` | — | `upgradedToVideo`\* | — | — | `hangup` | — | — |
| any terminal | — | — | — | — | — | — | — |

\* `accepted → accepted` is the only self-loop: audio→video escalation. It changes `mediaType` and appends a `callEvents` row; it does not touch `answeredAt`.

Terminal states: `rejected`, `cancelled`, `ended`, `missed`, `busy`. **No transition leaves a terminal state.** A second `accept` on an already-`accepted` call is not an error path — it returns a structured `answered_elsewhere` result so the losing device can detach silently (§3.5).

Role authorisation, enforced in the same guard:

| Transition | Who may perform it |
| --- | --- |
| `start` | any authenticated user not in `calleeIds` |
| `accept` | any user in `calleeIds`, **once** |
| `reject` | any user in `calleeIds` |
| `cancel` | the caller only |
| `expire` | the scheduler only (`internalMutation`) |
| `rejectBusy` | the server, when the callee is already in an `accepted` call |
| `upgradedToVideo` | any participant, only when `mediaType === "audio"` |
| `hangup` | any participant |

The current `accept` guard (`convex/calls.ts:164`) checks only `status !== "ringing"` and does not check whether the callee is already in a call (02 #4). The new guard fixes both.

### 2.3 The guard

```ts
// convex/lib/callState.ts

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type ActorRole = "caller" | "callee" | "system";

type Transition =
  | "accept" | "reject" | "cancel" | "expire"
  | "rejectBusy" | "upgradedToVideo" | "hangup";

/** Legal target status for (from, transition). `null` = illegal. */
const NEXT: Record<string, Record<Transition, string | null>> = {
  ringing: {
    accept: "accepted",
    reject: "rejected",
    cancel: "cancelled",
    expire: "missed",
    rejectBusy: "busy",
    hangup: null,
    upgradedToVideo: null,
  },
  accepted: {
    accept: null,
    reject: null,
    cancel: null,
    expire: null,
    rejectBusy: null,
    hangup: "ended",
    upgradedToVideo: "accepted",
  },
  rejected:  { accept: null, reject: null, cancel: null, expire: null, rejectBusy: null, hangup: null, upgradedToVideo: null },
  cancelled: { accept: null, reject: null, cancel: null, expire: null, rejectBusy: null, hangup: null, upgradedToVideo: null },
  ended:     { accept: null, reject: null, cancel: null, expire: null, rejectBusy: null, hangup: null, upgradedToVideo: null },
  missed:    { accept: null, reject: null, cancel: null, expire: null, rejectBusy: null, hangup: null, upgradedToVideo: null },
  busy:      { accept: null, reject: null, cancel: null, expire: null, rejectBusy: null, hangup: null, upgradedToVideo: null },
};

const ROLE_AUTHORITY: Record<Transition, ActorRole[]> = {
  accept: ["callee"],
  reject: ["callee"],
  cancel: ["caller"],
  expire: ["system"],
  rejectBusy: ["system"],
  upgradedToVideo: ["caller", "callee"],
  hangup: ["caller", "callee"],
};

export function roleOf(
  call: Doc<"calls">,
  userId: Id<"users"> | null,
): ActorRole {
  if (userId === null) return "system";
  if (call.callerId === userId) return "caller";
  if (call.calleeIds.includes(userId)) return "callee";
  throw new ConvexError("You are not part of this call");
}

export function assertTransition(
  call: Doc<"calls">,
  transition: Transition,
  role: ActorRole,
): void {
  const next = NEXT[call.status]?.[transition] ?? null;
  if (next === null) {
    throw new ConvexError({
      code: "ILLEGAL_TRANSITION",
      message: `Cannot ${transition} a call that is ${call.status}`,
      status: call.status,
      callId: call._id,
    });
  }
  if (!ROLE_AUTHORITY[transition].includes(role)) {
    throw new ConvexError({
      code: "NOT_AUTHORIZED",
      message: `A ${role} may not ${transition} this call`,
    });
  }
}

/** Every terminal write goes through here, so endedAt is set exactly once. */
export function terminalPatch(call: Doc<"calls">, endReason: string) {
  return {
    status: END_STATUS,
    endReason,
    endedAt: Date.now(),
  };
}
```

### 2.4 `accept` returns a value, it does not throw

The single most annoying failure in the current app: the second `accept` throws `"This call is no longer ringing"`, which is caught and swallowed at `App.tsx:195/247` on one path but surfaced as a spurious `Alert` on another (`IncomingCallOverlay.tsx:60-64`), while the call is actually connected (02 #4). Multi-device makes the second accept *normal*, not exceptional.

```ts
// convex/calls.ts
export const accept = mutation({
  args: { token: v.string(), callId: v.id("calls"), clientSessionId: v.string() },
  handler: async (ctx, { token, callId, clientSessionId }) => {
    const me = await requireUser(ctx, token);
    const call = await loadCall(ctx, callId);
    const role = roleOf(call, me._id);

    if (call.status === "accepted") {
      // Not an error. Another device already won.
      return {
        ok: false as const,
        reason: "answered_elsewhere" as const,
        answeredByClientSessionId: call.answeredByClientSessionId ?? null,
        call,
      };
    }
    if (call.status !== "ringing") {
      return { ok: false as const, reason: "not_ringing" as const, status: call.status };
    }

    const now = Date.now();
    assertTransition(call, "accept", role);

    await ctx.db.patch(callId, {
      status: "accepted",
      answeredAt: now,                       // server clock, written once
      answeredByClientSessionId: clientSessionId,
      clientSessionIds: call.clientSessionIds.includes(clientSessionId)
        ? call.clientSessionIds
        : [...call.clientSessionIds, clientSessionId],
    });
    await ctx.db.insert("callSessions", {
      callId, userId: me._id, clientSessionId, platform: PLATFORM, role,
      state: "connecting", joinedAt: now, lastSeenAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.push.sendCallPush, {
      callId, kind: "call.accepted", excludeUserId: me._id,
    });
    return { ok: true as const, answeredAt: now, serverNow: now, callId };
  },
});
```

Every `calls.*` mutation returns `serverNow: Date.now()`. This is the clock-skew fix (§7) and it costs one field.

---

## 3. Lifecycle and signalling on Convex

### 3.1 Signal taxonomy

Signals split cleanly into two tiers, and conflating them is what makes hand-rolled WebRTC on Convex unworkable:

| Tier | Signals | Transport | Latency target | Durable? |
| --- | --- | --- | --- | --- |
| **Durable session state** | `call.invite`, `call.accept`, `call.reject`, `call.cancel`, `call.hangup`, `call.renegotiate` | Convex mutation → `useQuery` on the call row | ~100 ms | Yes, in `calls` |
| **Ephemeral media state** | mute, hold, camera toggle, speaking, quality | LiveKit data channel (`room.localParticipant.publishData`) | ~20 ms | No |
| **Media transport** | SDP offer/answer, ICE, DTW | LiveKit SFU | — | No |

`call.renegotiate` sits on the boundary: a *durable* change (audio→video) is a Convex mutation; the *negotiation packets* that follow are LiveKit's problem.

### 3.2 How signals travel: mutations + live queries, not pub/sub

**Convex has no pub/sub primitive.** Verified against the installed SDK: `node_modules/convex/dist/esm-types/server/` contains no `pubsub`/`topic` module. Convex's realtime model is: a query reads tables, Convex tracks the dependency set, and any write that invalidates a dependency re-runs the query and pushes the new value down the client's WebSocket.

That is a perfectly good fit here, and it is the same mechanism the app already uses for `api.calls.incoming` (`convex/calls.ts:104`) and `api.calls.get` (`:130`). Design:

- **Writes** are mutations. `call.invite` is `calls.start`, `call.accept` is `calls.accept`, etc. All five share one guard (§2.3).
- **Reads** are one query per concern, subscribed once per call:
  - `calls.get` — the call row, projected for the viewer (role, peer, `serverNow`, duration anchor).
  - `calls.participants` — live per-participant state from `callSessions`.
  - `calls.pendingSignals` — gone in Phase 4 (LiveKit replaces it).
- **Fan-out** is implicit. Writing the `calls` row invalidates every subscriber of `calls.get` for that `callId`, on every platform, simultaneously, from one consistent snapshot. That is Convex's core guarantee and it is exactly the semantics a call state machine needs.

Why not poll: a 250 ms poll on 2 participants per room is fine but it is wasted work and it adds up to 1 s of staleness at worst. Why not a `callEvents` table as a queue: you would re-implement pub/sub badly, lose snapshot consistency, and every consumer needs dedupe logic. Use `callEvents` for the audit trail only.

### 3.3 The ~100 ms budget

Convex realtime is a WebSocket push triggered by an invalidation, not a poll. The realistic budget for *mutation committed → client's `useQuery` callback fires*:

| Stage | Budget |
| --- | --- |
| Client → Convex (mutation RPC, TLS, one region hop) | 20–50 ms |
| Transaction commit + write | 5–15 ms |
| Invalidation + query re-execution | 5–20 ms |
| Server → client WebSocket push | 20–50 ms |
| **Total p50** | **~50–135 ms** |

I have not benchmarked this on your deployment; treat the numbers as a design target to measure in Phase 1, not a guarantee. Two design consequences that hold regardless:

1. **The caller never waits on the round trip.** `calls.start` returns `callId` and the caller renders "Ringing…" from local state immediately. Nothing about the caller's UX gates on the 100 ms.
2. **The callee's answer path does not depend on it.** The callee answers from the push/CallKit path, not from the query. The query's job is to tear the ring down everywhere else, which can be 200 ms late without anyone noticing.

If measured p99 exceeds ~250 ms, the escape hatch is a small SSE endpoint (Node sidecar, `Cache-Control: no-cache`, keyed by `callId`) that the call screen subscribes to. Defer that; do not build it speculatively.

### 3.4 `useCallSession(callId)`

Shared conceptually; the RN and web implementations differ only in the media layer they hand back. Both live in a `src/calls/` directory that is isomorphic in shape.

```ts
// src/calls/useCallSession.ts — the shared contract
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export type CallRole = "caller" | "callee";

export interface CallSession {
  callId: string | null;
  role: CallRole | null;
  peer: { _id: string; displayName: string; avatarUrl?: string } | null;
  mediaType: "audio" | "video";
  status:
    | "idle" | "dialing" | "ringing"   // not ringing (outbound / waiting)
    | "incoming"                          // ringing (inbound)
    | "connecting"
    | "active"
    | "ended";
  /** Server clock. Every duration computation in the app goes through this. */
  serverNow: number;
  answeredAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  /** Answers on another device of yours. Not an error. */
  answeredElsewhere: boolean;
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  cancel: () => Promise<void>;
  hangup: () => Promise<void>;
}

export function useCallSession(opts: {
  token: string | null;
  callId: string | null;
  /** Stable per install/tab. See §3.5. */
  clientSessionId: string;
  platform: "android" | "ios" | "web";
}): CallSession {
  const { token, callId, clientSessionId } = opts;

  const data = useQuery(
    api.calls.get,
    token && callId ? { token, callId, clientSessionId } : "skip",
  );

  const acceptM = useMutation(api.calls.accept);
  const rejectM = useMutation(api.calls.reject);
  const cancelM = useMutation(api.calls.cancel);
  const hangupM = useMutation(api.calls.hangup);
  const convex = useConvex();

  const answeredElsewhere = data?.accept?.reason === "answered_elsewhere";

  const status = useMemo<CallSession["status"]>(() => {
    if (!data) return "idle";
    if (data.accept && !data.accept.ok) {
      return data.accept.reason === "answered_elsewhere" ? "ended" : "ended";
    }
    switch (data.status) {
      case "ringing":
        return data.role === "caller" ? "dialing" : "incoming";
      case "accepted":
        return data.mediaConnected ? "active" : "connecting";
      default:
        return "ended";
    }
  }, [data]);

  const run = useCallback(
    async (m: typeof acceptM, ...args: never[]) => {
      if (!token || !callId) return;
      await (m as any)({ token, callId, clientSessionId, ...(args[0] ?? {}) });
    },
    [token, callId, clientSessionId],
  );

  // Reconcile our own session row whenever the call state moves.
  const lastStatus = useRef(status);
  useEffect(() => {
    if (!token || !callId || status === lastStatus.current) return;
    lastStatus.current = status;
    convex.mutation(api.calls.setSessionState, {
      token, callId, clientSessionId, platform: opts.platform,
      state:
        status === "incoming" ? "ringing"
        : status === "active" ? "connected"
        : status === "connecting" ? "connecting"
        : "left",
    }).catch(() => {});
  }, [status, token, callId, clientSessionId, convex, opts.platform]);

  return {
    callId, role: data?.role ?? null, peer: data?.peer ?? null,
    mediaType: data?.mediaType ?? "audio",
    status,
    serverNow: data?.serverNow ?? Date.now(),
    answeredAt: data?.answeredAt ?? null,
    endedAt: data?.endedAt ?? null,
    endReason: data?.endReason ?? null,
    answeredElsewhere,
    accept: () => run(acceptM),
    reject: () => run(rejectM),
    cancel: () => run(cancelM),
    hangup: () => run(hangupM),
  };
}
```

The RN variant swaps the media section for `<LiveKitRoom>`; the web variant for `@livekit/components-react`'s `<VideoConference>`. Everything above the media layer is identical, which is the whole point.

### 3.5 Multi-device: how many rings, which device answers

**All devices ring.** That is WhatsApp's behaviour and it is what users expect. Pushing only to "the active device" is the failure mode in 01 #10.

**Arbitration is server-side and first-write-wins.** No client election, no leader, no ordering assumption. The `accept` mutation reads `status`; Convex mutations are serialisable per-document, so exactly one of N concurrent accepts observes `status === "ringing"` and wins. The losers get `{ ok: false, reason: "answered_elsewhere", answeredByClientSessionId }`.

Loser behaviour differs by call type:

- **1:1 call** — loser dismisses the ring immediately and shows a 3-second toast: *"Answered on your other device."* It does **not** connect media. Connecting two of your own devices as separate participants to a 1:1 room is a bug, not a feature.
- **Group call** — loser may join the room as an additional participant. The media layer decides; Convex does not care, since a LiveKit room admits anyone with a valid token.

Which device *connected* is recorded in `answeredByClientSessionId`, so the toast can name the platform, and so the call log can show "answered on iPhone".

**Device identity.** `clientSessionId` comes from `react-native-device-info` (`getUniqueId()`) on mobile and from a `sessionStorage` UUID on web. It must be stable across app launches on the same install and distinct across tabs.

**The multi-tab web case** is the sharp edge, and it has two independent guards:

1. **Primary guard — a `BroadcastChannel`.** Tabs in the same origin share one channel. The first tab to see an `incoming` call claims it (`callId` → `claimingTabId`) and posts `ring-claimed`. Other tabs stop ringing immediately. Local, zero-latency, no server round trip.
2. **Backstop guard — the state machine.** If two tabs race (or `BroadcastChannel` is unavailable), both call `accept`. One wins, one gets `answered_elsewhere` (§3.5). The tab that loses tears down. Server-authoritative, so it is correct even when the client guard fails.

Never rely on guard 1 alone. Never rely on guard 2 for UX — a double-ring for 100 ms is audible.

**Same origin, two profiles.** Push tokens are keyed by `userId` via the `pushTokens` table, so signing in as B on the same device overwrites A's token row if you key by `token` only. Fix: `by_token` upsert *deletes any other row with the same token* (01 #9 — the token is never cleared on sign-out today), and sign-out sets `enabled: false` rather than deleting, so the FCM registration stays warm.

---

## 4. Push — one owner for ringing

### 4.1 The owner

**`internal.push.sendCallPush` in `convex/push.ts` is the only thing in the codebase permitted to ring a phone.** One builder, one sender, one payload. It is called from exactly four places, all inside `convex/calls.ts`:

```ts
// convex/calls.ts — the complete set of push call sites
await ctx.scheduler.runAfter(0, internal.push.sendCallPush, {
  callId, kind: "call.ring", excludeUserId: null,
});                                        // in start()
await ctx.scheduler.runAfter(0, internal.push.sendCallPush, {
  callId, kind: "call.accepted", excludeUserId: answererId,
});                                        // in accept()
await ctx.scheduler.runAfter(0, internal.push.sendCallPush, {
  callId, kind: "call.end", excludeUserId: null,
});                                        // in every terminal transition
```

Today there are three ringers (01's "Live push paths" table: the Play-drawn notification, the Notifee FSI, and CometChat's native engine) and zero terminal pushes. Phase 0 collapses that to one and adds the terminal pushes.

### 4.2 Who issues it, and to which tokens

The issuer is a Convex `internalAction`, scheduled with `runAfter(0, …)` from the mutation so the mutation stays fast and the FCM call does not block it.

**Token selection, in order:**

1. Every user in `calleeIds`.
2. Every row in `pushTokens` for that user, **except** rows where `enabled === false`.
3. Skip rows where `activeCallId` is set and that call is `accepted` — that device is already on a call and should not be rung (this is the "all-but-currently-active" refinement; it is per-*call*, not per-*app*, so a user with a phone and a tablet still gets both).
4. `excludeUserId` filters the actor (a caller does not need a "someone called you" push for their own call).
5. On FCM failure, prune tokens reporting `UNREGISTERED` or `INVALID_ARGUMENT` by deleting the `pushTokens` row. The existing failure logging at `convex/push.ts:69-71` is correct and currently has no consumer — make it delete.

Chunk at 500 tokens per `sendEachForMulticast` call. Log loudly and throw if `tokens.length === 0` for an incoming call — today's silent `if (callee.pushToken)` (01 #8) is the reason "sometimes it doesn't ring" has no diagnostic trail.

### 4.3 The payload

**Every field is a string.** FCM `data` is `Record<string, string>`; a number in there is a delivery-time crash on Android.

```json
{
  "v": "1",
  "kind": "call.ring",
  "callId": "kg7ab2c9d1e0f4a3b8c6d5e4f2a1b0c9d",
  "conversationId": "kd3f8a1b2c3d4e5f60718293a4b5c6d7e",
  "callerId": "k9a1b2c3d4e5f60718293a4b5c6d7e8f",
  "callerName": "Ada Lovelace",
  "callerAvatarUrl": "",
  "calleeIds": "k1b2c3d4e5f60718293a4b5c6d7e8f90",
  "mediaType": "video",
  "createdAt": "1760000000000",
  "ringExpiresAt": "1760000045000",
  "answeredAt": "",
  "endedAt": "",
  "endReason": "",
  "serverNow": "1760000000120",
  "collapseKey": "call:kg7ab2c9d1e0f4a3b8c6d5e4f2a1b0c9d",
  "from": "convex"
}
```

| Field | Meaning | Used by |
| --- | --- | --- |
| `v` | Payload schema version. Bump on any breaking change; clients ignore `v` they do not know. | Client gate |
| `kind` | `call.ring` \| `call.accepted` \| `call.end`. | Client routing (§4.6) |
| `callId` | Convex document id. **The idempotency key for the entire system.** | Everything |
| `conversationId` | Chat the call belongs to. | Opening the call screen at the right place |
| `callerName`, `callerAvatarUrl` | Rendered on the lock screen. Never render a name from a client. | Ringing UI |
| `calleeIds` | Comma-joined. Lets a device self-filter if it is not a target (e.g. a stale token after an account switch). | Client |
| `mediaType` | `audio` \| `video`. Decides video icon + whether to request the camera at answer time. | Ringing UI |
| `ringExpiresAt` | `createdAt + ringTimeoutMs`. The client stops its own ring at this instant, so a lost terminal push cannot leave a phone ringing past the server's intent. | Client timeout |
| `serverNow` | Convex clock at send. First half of the skew fix (§7). | Client |
| `collapseKey` | `call:<callId>`. See §4.4. | OS-level dedupe |

**Transport per platform:**

```ts
// convex/push.ts
await messaging.sendEachForMulticast({
  tokens,
  data: payload,                       // data-only: never add `notification`
                                      // for kind === "call.ring" (01 #1)
  android: {
    priority: "high",
    ttl: 60_000,                       // not 86_400_000. A stale ring is a bug.
    collapseKey: payload.collapseKey,
    restrictedPackageName: undefined,  // leave default; see §4.7
  },
  apns: {
    headers: { "apns-priority": "10", "apns-collapse-id": payload.collapseKey },
    payload: {
      aps: {
        // VoIP: this must be a VoIP push for PushKit/CallKit to deliver it
        // to a terminated app. See §5.5.
        ...(payload.kind === "call.ring" && Platform_IS_IOS
          ? { "voip": 1 }
          : { "content-available": 1 }),
      },
      ...payload,
    },
  },
  webpush: {
    headers: { TTL: "60", Urgency: "high" },
    notification: undefined,           // the SW draws it (§8); keep the
                                      // payload data-only so SW owns the copy
    data: payload,
    fcmOptions: { link: `/call/${payload.callId}` },
  },
});
```

Note `android.ttl` drops from today's `86400000` (`convex/push.ts:51`) to 60 s. A call push that is delivered an hour late is worse than one that is not delivered.

### 4.4 The dedupe key

Three layers, because no single layer is sufficient:

| Layer | Mechanism | Stops |
| --- | --- | --- |
| Transport | `android.collapseKey` = `apns-collapse-id` = `collapseKey` = `call:<callId>` | Duplicate messages queued while the device was offline. FCM/APNs collapse them to one. |
| OS notification | Android `tag: call:<callId>`; web `tag: call:<callId>` + `renotify: false` | Two notifications stacking for one call. |
| Client | `handledCalls: Set<callId>` in the converged handler (§4.6), backed by AsyncStorage on RN and `localStorage` on web | The ring restarting on an app-state transition, a redelivered push, or a re-mounted component. |

`callId` is the key because it is minted once per call by Convex and is globally unique. Never key on `(callerId, calleeId)` — back-to-back calls collide, and a stale push from call #1 kills the ring on call #2.

`renotify: false` on web and `onlyAlertOnce: true` on the ongoing notification mean a re-delivered `call.ring` updates the existing notification instead of re-sounding it.

### 4.5 Terminal pushes are not optional

01 #7: `end` and `markTimedOut` send nothing. A caller who hangs up leaves the callee's phone ringing for the full 60 s, because the only thing that ever cancels the ring is JS running on the callee's device.

The fix is the `call.end` push, carrying `kind: "call.end"`, `endReason`, and `endedAt`. Every terminal transition sends it:

| Transition | `kind` | `endReason` |
| --- | --- | --- |
| callee declines | `call.end` | `declined` |
| caller cancels | `call.end` | `cancelled_by_caller` |
| ring expires | `call.end` | `unanswered` |
| callee busy | `call.end` | `busy` |
| hangup | `call.end` | `normal_hangup` |
| media failure | `call.end` | `media_failure` |

The handler cancels the ringing notification, stops the ringtone, dismisses `IncomingCallActivity`, and on iOS calls `provider.reportCall(with: uuid, endedAt: …, reason: .remoteEnded)`. Without it the user experience is broken in a way that no amount of ring-quality work fixes.

### 4.6 One handler for every client state

This is the design that fixes symptoms 1 and 2. Today there are three divergent paths (01 #14: foreground `onMessage`, background headless, and the CometChat native engine) plus two tap routers that both auto-accept (01 #11).

**One function, five entry points, idempotent by `callId`:**

```ts
// src/calls/pushHandler.ts
export type PushSource =
  | "cold-start"      // app launched by the push/FSI/CallKit
  | "background"      // notifee background event / RNFB setBackgroundMessageHandler
  | "foreground"      // RNFB onMessage / SW postMessage to an open tab
  | "action-button"   // Accept / Decline tapped
  | "callkit";        // iOS CXAnswerCallAction / CXEndCallAction

export async function handleCallPush(
  data: CallPushPayload,
  source: PushSource,
): Promise<void> {
  if (data.v !== "1") return;
  if (MARKED_HANDLED.has(data.callId)) return;   // in-memory fast path
  if (await alreadyHandled(data.callId)) return; // persisted: survives a cold start

  // ── Every path past this point is identical. No app-state branching. ──

  if (data.kind === "call.end") {
    await teardownRinging(data.callId, data.endReason);   // cancel notif, stop
    MARKED_HANDLED.add(data.callId);                      // ringtone, dismiss UI
    return;                                              //   activity / CallKit
  }

  if (data.kind === "call.accepted") {
    await teardownRinging(data.callId, "answered_elsewhere");
    MARKED_HANDLED.add(data.callId);
    return;
  }

  // kind === "call.ring"
  const now = Date.now();
  if (now > Number(data.ringExpiresAt)) return;   // stale push: server beat us

  await showRingingUi({
    callId: data.callId,
    callerName: data.callerName,
    callerAvatarUrl: data.callerAvatarUrl || undefined,
    mediaType: data.mediaType,
    ringExpiresAt: Number(data.ringExpiresAt),
    serverNow: Number(data.serverNow),
  });
  MARKED_HANDLED.add(data.callId);
  await persistHandled(data.callId, Number(data.ringExpiresAt));
}
```

Registered at:

```ts
// index.js — cold start and background. BEFORE anything else, as today.
messaging().setBackgroundMessageHandler(async m =>
  handleCallPush(m.data as CallPushPayload, "background"));
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const d = (detail?.notification?.data ?? {}) as Record<string, string>;
  if (d.kind !== "call.ring") return;
  await handleCallPush(d as CallPushPayload,
    type === EventType.ACTION_PRESS || type === EventType.PRESS
      ? "action-button" : "background");
});

// App.tsx — foreground and cold start.
messaging().onMessage(m => handleCallPush(m.data as CallPushPayload, "foreground"));
notifee.getInitialNotification().then(n =>
  n && handleCallPush(n.notification.data as CallPushPayload, "cold-start"));
messaging().getInitialNotification().then(m =>
  m?.data && handleCallPush(m.data as CallPushPayload, "cold-start"));
```

The invariant this buys: **the ring is a pure function of the payload and the elapsed time.** Whether the push woke a killed app, a backgrounded one, or arrived at a visible one changes only *how the UI is presented* (`IncomingCallActivity` vs an in-app overlay), never *whether it rings*.

Two rules that must not be violated:

- **No `AppState` branching inside `handleCallPush`.** Presentation branching lives in `showRingingUi`, which picks the surface. Anything else reintroduces 01 #14.
- **`accept` is never called by a body tap.** Only by the Accept action or the in-app Accept button. Today `App.tsx:194-204` and `App.tsx:287-302` both accept on a plain press — that is 01 #11 and it is a lock-screen auto-answer bug, not just a UX wart.

### 4.7 Registration is unconditional

Three fixes that must land in Phase 0, before anything else, because they are the difference between "always rings" and "sometimes rings":

1. **Store the token regardless of the permission result.** `App.tsx:167-180` returns early when the prompt is declined, so a user who dismisses Android 13+ once is permanently unreachable. Permission gates *display*, not *registration*. Call `getToken()` and `setPushToken` unconditionally; request permission separately.
2. **Clear on sign-out.** `SessionProvider.tsx:81-92` never calls `setPushToken({ pushToken: null })`, so the device keeps receiving the previous user's calls (01 #9).
3. **One `FirebaseMessagingService`.** The shipped manifest has three claimants for `MESSAGING_EVENT` (08 Android-7). Until this is collapsed, token refresh and message routing are undefined and no amount of push payload work can be reasoned about:

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<service
  android:name="com.cometchat.pushnotification.reactnative.CometChatFcmService"
  tools:node="remove" />
```

Keep RNFB's service; it is the one with JS handlers. This also removes CometChat's third ringer (01 #6) in one line.

---

## 5. Mobile incoming call UI

### 5.1 Android: the ringing activity

Today `fullScreenAction.launchActivity` is `'default'`, which resolves to `MainActivity` — an activity with no `showWhenLocked`/`turnScreenOn` (01 #2, 01 #3). The fix is a dedicated activity.

**`android/app/src/main/res/values/themes.xml`** — a ring-specific theme so the activity has no action bar and draws behind the status bar:

```xml
<style name="Theme.CallRinging" parent="Theme.AppCompat.NoActionBar">
  <item name="android:windowShowWallpaper">false</item>
  <item name="android:windowBackground">@color/call_ringing_background</item>
  <item name="android:windowNoTitle">true</item>
  <item name="android:windowTurnScreenOn">true</item>
  <item name="android:windowShowWhenLocked">true</item>
  <item name="android:statusBarColor">@android:color/transparent</item>
</style>
```

**`IncomingCallActivity.kt`** — a plain `Activity` that boots only the ring surface, not the whole app. Booting the full RN root into a killed process just to render two buttons is what makes the current FSI feel like "a blank screen".

```kotlin
package com.rajofearth.synomilo

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager

class IncomingCallActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true); setTurnScreenOn(true)
    } else {
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    startActivity(
      Intent(this, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(EXTRA_SURFACE, "incoming-call")
        putExtra(EXTRA_CALL_ID, intent.getStringExtra(EXTRA_CALL_ID))
        putExtra(EXTRA_CALLER_NAME, intent.getStringExtra(EXTRA_CALLER_NAME))
        putExtra(EXTRA_CALLER_AVATAR, intent.getStringExtra(EXTRA_CALLER_AVATAR))
        putExtra(EXTRA_MEDIA_TYPE, intent.getStringExtra(EXTRA_MEDIA_TYPE))
        putExtra(EXTRA_RING_EXPIRES_AT, intent.getLongExtra(EXTRA_RING_EXPIRES_AT, 0L))
      })
    finish()   // this activity's only job was waking the screen
  }
  companion object {
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALLER_NAME = "callerName"
    const val EXTRA_CALLER_AVATAR = "callerAvatarUrl"
    const val EXTRA_MEDIA_TYPE = "mediaType"
    const val EXTRA_RING_EXPIRES_AT = "ringExpiresAt"
    const val EXTRA_SURFACE = "surface"
    fun intent(ctx: Context, callId: String, callerName: String,
               avatar: String?, mediaType: String, ringExpiresAt: Long) =
      Intent(ctx, IncomingCallActivity::class.java).apply {
        putExtra(EXTRA_CALL_ID, callId); putExtra(EXTRA_CALLER_NAME, callerName)
        putExtra(EXTRA_CALLER_AVATAR, avatar); putExtra(EXTRA_MEDIA_TYPE, mediaType)
        putExtra(EXTRA_RING_EXPIRES_AT, ringExpiresAt)
      }
  }
}
```

`MainActivity` renders `<IncomingCallScreen/>` when `getIntent().getStringExtra("surface") == "incoming-call"` and boots the normal navigator otherwise.

### 5.2 Android manifest fragment

```xml
<!-- android/app/src/main/AndroidManifest.xml — additions only -->

<!-- Calling is core functionality; Play requires this declaration form to
     keep USE_FULL_SCREEN_INTENT granted on Android 14+. Without it the FSI
     silently downgrades to a sticky heads-up (01 #4). -->
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL" />
<uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<application ...>

  <!-- The ringing screen. Own task, singleTop so a second call does not stack,
       excluded from recents so it does not sit in the launcher. -->
  <activity
    android:name=".IncomingCallActivity"
    android:theme="@style/Theme.CallRinging"
    android:launchMode="singleTask"
    android:showWhenLocked="true"
    android:turnScreenOn="true"
    android:excludeFromRecents="true"
    android:taskAffinity="com.rajofearth.synomilo.call"
    android:noHistory="true"
    android:exported="false" />

  <!-- MainActivity must be able to render over the keyguard when the user
       answers from the ring screen and lands back in the app. -->
  <activity android:name=".MainActivity" ... >

  <!-- ONE FirebaseMessagingService (08 A1 / Android-7). Removing the CometChat
       claimant also removes the third ringer (01 #6). -->
  <service
    android:name="com.cometchat.pushnotification.reactnative.CometChatFcmService"
    tools:node="remove" />

  <!-- Notifee's foreground service, typed for calls. The AAR ships
       foregroundServiceType="shortService"; tools:replace is mandatory or the
       manifest merger fails. Notifee allows ONE foreground-service
       notification at a time, which is why ringing is a normal notification
       and only the ongoing call is an FGS (§6.1). -->
  <service
    android:name="app.notifee.core.ForegroundService"
    android:foregroundServiceType="phoneCall"
    tools:replace="android:foregroundServiceType" />

  <!-- Pre-warm the ring sound in the credential-encrypted storage so a killed
       app can ring from a cold start (01 #15: res/raw/ringtone.wav ships
       unused today). -->
  <meta-data
    android:name="com.google.firebase.messaging.default_notification_channel_id"
    android:value="default" />
</application>
```

### 5.3 Android: Notifee configuration

Three channels, each immutable once created — so changing a channel id is the only way to change its settings (08 Android-13, 01 #15).

```ts
// src/calls/notificationChannels.ts

export const CH = {
  messages: "default",
  /** RINGING. High importance, system ringtone, bypasses DND, long pattern. */
  ringing: "call_ringing_v3",
  /** ONGOING. Low importance, silent, chronometer, persistent actions. */
  ongoing: "call_ongoing_v1",
} as const;

const SYSTEM_RINGTONE = "content://settings/system/ringtone";

export async function ensureCallChannels(): Promise<void> {
  await notifee.createChannel({
    id: CH.ringing,
    name: "Incoming calls",
    description: "Rings when someone calls you",
    importance: AndroidImportance.HIGH,
    sound: SYSTEM_RINGTONE,
    vibration: true,
    vibrationPattern: [500, 1000, 500, 1000],   // the classic two-burst ring
    lights: true,
    lightColor: "#2FBF71",
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: true,          // Notifee 9 supports this; today it is omitted
  });
  await notifee.createChannel({
    id: CH.ongoing,
    name: "Ongoing calls",
    description: "Shows a call you are currently in",
    importance: AndroidImportance.LOW,
    sound: undefined,         // LOW + no sound. Ongoing must never re-alert.
    vibration: false,
    lights: false,
    visibility: AndroidVisibility.PUBLIC,
  });
}
```

**The ringing notification:**

```ts
// src/calls/ringing.ts
export async function showRingingUi(p: RingingPayload): Promise<void> {
  await ensureCallChannels();
  const id = `call:${p.callId}`;

  // Persist BEFORE displaying. A pure FSI launch emits no notification
  // object, so a handler that reads detail.notification.data finds nothing
  // and bails — that is exactly how accept-from-lock-screen is dead today
  // (01 #11, 01 "Missing vs docs/intent").
  await AsyncStorage.setItem(
    `ring:${p.callId}`,
    JSON.stringify({ ...p, at: Date.now() }),
  );

  await notifee.displayNotification({
    id,
    title: p.callerName,
    body: p.mediaType === "video"
      ? "Incoming video call"
      : "Incoming voice call",
    data: { ...p, kind: "call.ring" },
    android: {
      channelId: CH.ringing,
      category: AndroidCategory.CALL,        // locks it to the call volume group
      importance: AndroidImportance.HIGH,
      loopSound: true,                       // rings until answered — the core
      ongoing: true,                         //   complaint in symptom 2
      autoCancel: false,
      onlyAlertOnce: true,
      timeoutAfter: Math.max(1000, p.ringExpiresAt - Date.now()),
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: "ic_stat_call",
      tag: id,
      // OPENS THE RING SCREEN. Never `accept-call` (01 #3).
      fullScreenAction: { id: "open-call", launchActivity: "IncomingCallActivity" },
      pressAction:   { id: "open-call", launchActivity: "IncomingCallActivity" },
      actions: [
        { title: "Decline", pressAction: { id: "decline-call" } },
        { title: "Accept",  pressAction: { id: "accept-call", launchActivity: "IncomingCallActivity" } },
      ],
      showTimestamp: false,
    },
  });
}
```

**Decline and teardown** (both must be idempotent; both may run on a killed app):

```ts
export async function teardownRinging(
  callId: string,
  endReason: string,
): Promise<void> {
  await notifee.cancelNotification(`call:${callId}`);
  await AsyncStorage.removeItem(`ring:${callId}`);
  await CallRingingModule.dismiss();   // finishes IncomingCallActivity if shown
  // iOS only:
  // CallKitModule.reportEnded(callId, endReason);
}
```

**The FSI grant is not verifiable from JS.** On `targetSdk 36`, `USE_FULL_SCREEN_INTENT` is Special app access that Play can revoke (01 #4), Notifee 9 exposes no query for it, and when it is missing Android converts the FSI into a sticky heads-up — which is what the user is seeing today. Ship a ~40-line native module:

```kotlin
// android/app/src/main/java/com/rajofearth/synomilo/FsiModule.kt
@ReactMethod fun canUseFullScreenIntent(promise: Promise) {
  promise.resolve(
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) true
    else app.unsafeCheckUseFullScreenIntent()   // API 34+
  )
}
@ReactMethod fun openFullScreenIntentSettings(promise: Promise) {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
    startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
      Uri.fromParts("package", packageName, null)))
  }
  promise.resolve(null)
}
```

Surface it in `SettingsScreen` as a row: *"Show calls over other apps — Allow"*. Today nothing detects FSI denial (01 #4), so the app cannot tell the user why it rings like a notification.

### 5.4 iOS: the CallKit/PushKit registration race

The race is real and it is a startup-ordering problem, not a logic problem. A VoIP push can arrive within ~5 s of a cold launch. React Native's JS bundle is not ready in that window — on a Release build the Hermes bundle load plus the Convex client connect routinely takes 1–3 s. If `CXProvider` is not registered before the push arrives, iOS never shows the ring, and if the app does not report the call within ~5 s of the push, the system treats it as a failure.

**The ordering rule:** everything in this chain must run in `application(_:didFinishLaunchingWithOptions:)` **before** `factory.startReactNative`, on the main thread, and must not touch the RN bridge.

The repo already gets this right by accident — `AppDelegate.swift:31` calls `registerForVoIPPushes()` before line 39's `startReactNative`, with a comment explaining why (08 iOS-6). We keep the position and replace the body.

```swift
// ios/SampleAppWithPushNotifications/AppDelegate.swift
import PushKit
import CallKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate, PKPushRegistryDelegate {
  var window: UIWindow?
  private let callManager = CallKitManager()      // owns PKPushRegistry + CXProvider

  func application(_ app: UIApplication,
    didFinishLaunchingWithOptions launch: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {

    // 1. CallKit + PushKit FIRST. No RN, no bridge, no async.
    callManager.register()                        // -> provider.onBegin, registry(desiredPushTypes: [.voIP])

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate; reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(withModuleName: "sampleapp", in: window, launchOptions: launch)
    return true
  }

  // 2. Hand the buffered VoIP pushes to JS the moment the bridge is up.
  //    A push that arrived during launch is replayed here, not dropped.
  func applicationDidBecomeActive(_ app: UIApplication) {
    callManager.drainBufferedPushesToJS()
  }

  // 3. PushKit token -> Convex. Separate token from the APNs one; VoIP tokens
  //    must be registered to the VoIP topic.
  func application(_ app: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    CallKitManager.shared.didRegisterAPNsToken(token)
  }
  func application(_ app: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken token: Data,
    withActivationState state: UIApplication.PushRegistryActivationState) {
    CallKitManager.shared.didRegisterVoIPToken(token)
  }
}
```

```swift
// ios/CallKitManager.swift — pure Foundation + CallKit + PushKit, no React.
final class CallKitManager: NSObject {
  static let shared = CallKitManager()
  private let provider: CXProvider
  private let controller = CXCallController()
  private var registry: PKPushRegistry?
  private var providerConfiguration: [CXProviderConfiguration] = []
  /// Pushes that arrived before the RN bridge was ready. Replayed on
  /// `drainBufferedPushesToJS()`. Without this buffer a cold-start ring is
  /// silently lost — which is the iOS half of symptom 1.
  private var buffered: [[AnyHashable: Any]] = []
  private var ringSounds = AVAudioPlayer()

  func register() {
    let localizedName = Bundle.main.object(
      forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "synomiló"
    let iconTemplate = UIImage(named: "CallKitIcon")?.withRenderingMode(.alwaysTemplate)
    let cfg = CXProviderConfiguration(localizedName: localizedName)
    cfg.supportsVideo = true
    cfg.maximumCallsPerCallGroup = 1
    cfg.maximumCallGroups = 1
    cfg.supportedHandleTypes = [.generic]
    cfg.iconTemplateImageData = iconTemplate?.pngData()
    providerConfiguration = [cfg]
    provider = CXProvider(configuration: cfg)

    provider.setDelegate(self, queue: .main)
    // PushKit's registry must be created on a non-main queue; Apple's sample
    // does it on a dedicated queue for this reason.
    DispatchQueue(label: "com.rajofearth.synomilo.pushkit").async { [self] in
      let r = PKPushRegistry(queue: .main)
      r.desiredPushTypes = [.voIP]
      r.delegate = self
      registry = r
    }
  }

  func drainBufferedPushesToJS() {
    guard !buffered.isEmpty else { return }
    let pending = buffered; buffered = []
    for payload in pending { RNCallEventEmitter.emit(payload) }
  }

  /// Called from `PKPushRegistryDelegate`, possibly before RN exists.
  func handle(voIPPush dict: [AnyHashable: Any]) {
    guard let callId = dict["callId"] as? String,
          let uuid = UUID(uuidString: dict["uuid"] as? String ?? "") else { return }
    let call = CXCall(uuid: uuid)
    // The system requires reportNewIncomingCall within ~5s of the push.
    provider.reportNewIncomingCall(with: callId, update: update(from: dict)) { _ in }
    ringSounds.play()
    if RNCallEventEmitter.isBridgeReady { RNCallEventEmitter.emit(dict) }
    else { buffered.append(dict) }                 // replay later
  }

  private func update(from d: [AnyHashable: Any]) -> CXCallUpdate {
    let u = CXCallUpdate()
    u.remoteHandle = CXHandle(type: .generic,
                              value: (d["callerName"] as? String) ?? "Unknown")
    u.localizedCallerName = d["callerName"] as? String
    u.hasVideo = (d["mediaType"] as? String) == "video"
    u.supportsHolding = true
    u.supportsGrouping = false        // group calls are LiveKit rooms, not
    u.supportsUngrouping = false      // CallKit Call Groups. Say so explicitly.
    u.supportsDTMF = false            // see §9.4
    u.hasStartsOnHold = false
    return u
  }
}

extension CallKitManager: CXProviderDelegate {
  /// The user tapped Answer in the system UI.
  func providerDidReset(_ provider: CXProvider) {}
  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    callManager.provider.reportOutgoingCall(with: action.callUUID,
      startedConnectingAt: Date())
    // MUST forward to Convex. Silence here means the call never becomes
    // "accepted" and the ring never stops on any other device.
    RNCallEventEmitter.emit(["kind": "call.accept",
      "callId": action.callUUID.uuidString])
  }
  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    callManager.provider.reportCall(with: action.callUUID, endedAt: Date(),
      reason: .remoteEnded)
    RNCallEventEmitter.emit(["kind": "call.end",
      "callId": action.callUUID.uuidString])
  }
  func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {}
  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {}
  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {}
  func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
    RNCallEventEmitter.emit(["kind": "call.timeout",
      "callId": (action as? CXAnswerCallAction)?.callUUID.uuidString ?? ""])
  }
}

extension CallKitManager: PKPushRegistryDelegate {
  func pushRegistry(_ r: PKPushRegistry, didUpdate push: PKPush,
                    for type: PKPushType) {
    guard let d = push.payloadDictionary as? [AnyHashable: Any] else { return }
    callManager.handle(voIPPush: d)
  }
  func pushRegistry(_ r: PKPushRegistry, didInvalidatePushToken t: Data) {
    // Device token rotated: re-register with Convex.
    RNCallEventEmitter.emit(["kind": "voip.token.invalid"])
  }
}
```

**Reporting accept/decline back to Convex.** `CXAnswerCallAction` and `CXEndCallAction` arrive on the native side, possibly before the bridge exists. Route them through the same `RNCallEventEmitter` used for buffered pushes so there is exactly one path: `handleCallPush(..., "callkit")` (§4.6). That means the CallKit Answer button and the in-app Accept button run **the same code**, which is what stops the current situation where two of the four accept paths auto-answer and one throws a spurious Alert (01 #11, 02 #4).

**The three blockers that must land first** (08 B1, B3, B4 — none of the iOS work functions without them):

| Blocker | Fix |
| --- | --- |
| `aps-environment` hardcoded to `development` in the only entitlements file the target uses | `<key>aps-environment</key><string>$(APS_ENVIRONMENT)</string>` in both `.entitlements`; `APS_ENVIRONMENT = development` for Debug, `production` for Release in `project.pbxproj`. Verify with `codesign -d --ententitlements`. **Until this lands, production APNs — including VoIP — cannot reach a released iOS build.** This is the iOS half of symptom 1. |
| No `com.apple.developer.pushkit.unrestricted-voip` entitlement; no PushKit capability in `project.pbxproj` | Enable Push Notifications in Xcode; ensure the App ID carries the entitlement. Without it, VoIP registration fails and iOS terminates the app for an unhandled VoIP push. |
| `PRODUCT_BUNDLE_IDENTIFIER = com.cometchat.internal.reactnative.ios` | Change to a synomilo-owned ID **before any TestFlight build**, and update `CFBundleURLSchemes` in `Info.plist`. Push routing assumptions do not survive a reused demo ID and it will not pass review. |

Also confirm `UIBackgroundModes` keeps `audio` + `voip` + `remote-notification` (it does — 08 iOS-4 — do not let the Xcode capability rewrite drop `audio`, which LiveKit needs for a backgrounded call).

---

## 6. Mobile ongoing call

### 6.1 One owner of the ongoing notification

02 #1: `notifee.displayNotification` is called in exactly one place in the whole app, and it only ever fires for the callee. Nothing posts a notification when a call becomes active, and nothing posts one for an outgoing call. Symptom 3 and 4 are one missing feature.

Notifee permits **one** foreground-service notification at a time. Therefore: **ringing is a normal notification with an FSI; ongoing is the foreground service.** They never coexist.

```ts
// src/calls/ongoing.ts
let foregroundRegistered = false;

export async function showOngoingCall(p: {
  callId: string;
  peerName: string;
  peerAvatarUrl?: string;
  mediaType: "audio" | "video";
  answeredAt: number;   // SERVER clock. The chronometer anchor. See §7.
}): Promise<void> {
  await ensureCallChannels();

  if (!foregroundRegistered) {
    notifee.registerForegroundService(() => new Promise(() => {}));
    foregroundRegistered = true;
  }

  await notifee.displayNotification({
    id: `ongoing:${p.callId}`,
    title: p.peerName,
    body: mediaTypeLabel(p.mediaType),
    data: { callId: p.callId, kind: "ongoing" },
    android: {
      channelId: CH.ongoing,           // LOW, silent. Must never re-alert.
      asForegroundService: true,       // keeps the process alive when backgrounded
      ongoing: true,                   // no dismiss affordance
      autoCancel: false,
      onlyAlertOnce: true,             // 02 #3: required, absent today
      colorized: true,
      color: "#2FBF71",
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: "ic_stat_call",
      tag: `ongoing:${p.callId}`,
      // THE DURATION IS RENDERED BY THE OS, from the server timestamp.
      timestamp: p.answeredAt,
      showChronometer: true,
      chronometerDirection: "up",
      pressAction: { id: "open-call" },   // reopen the call screen
      actions: [
        { title: muteLabel,  pressAction: { id: "toggle-mute" } },
        { title: "Speaker",   pressAction: { id: "toggle-speaker" } },
        { title: "Hold",      pressAction: { id: "toggle-hold" } },
        { title: "End",       pressAction: { id: "hangup" } },
      ],
      showTimestamp: false,
    },
  });
}

export async function hideOngoingCall(callId: string): Promise<void> {
  await notifee.cancelNotification(`ongoing:${callId}`);
  await notifee.stopForegroundService();
  foregroundRegistered = false;
}
```

Four actions on a notification is above the Android guidance of three visible actions. Notifee will render them, but the End action must be last and must not be the only one — measure on a real device, and drop `Hold` first if it truncates.

Notification actions are handled in the background headless task, where the Convex mutation runs via `ConvexHttpClient`:

```ts
// src/calls/ongoingActions.ts — runs in the Notifee background task
export async function handleOngoingAction(
  data: Record<string, string>,
  actionId: string,
): Promise<void> {
  const token = await AsyncStorage.getItem("synomilo.convex.token");
  if (!token) return;
  // ONE client for the whole task. Constructing a ConvexHttpClient per
  // action inside a 60s headless budget is how actions get dropped (01 #20).
  const client = getOrCreateClient();
  const callId = data.callId as any;

  switch (actionId) {
    case "toggle-mute":
    case "toggle-speaker":
    case "toggle-hold":
      // Ephemeral media state. NOT a Convex mutation — a LiveKit data
      // channel message (§3.1). If the room is not connected yet, patch the
      // session row so the UI reconciles on reconnect.
      await client.mutation(api.calls.setPendingMediaAction,
        { token, callId, action: actionId.replace("toggle-", "") });
      break;
    case "hangup":
      await client.mutation(api.calls.hangup, { token, callId, clientSessionId: "" });
      await hideOngoingCall(data.callId);
      break;
  }
}
```

### 6.2 Heads-up "call in progress" on return

02 #2: there is no call store, so all live call state is local `useState` and dies with the screen. There is no `AppState` listener in `WebRTCCallScreen.tsx` and no in-call banner anywhere in `src`.

```ts
// src/calls/callStore.ts
import { create } from "zustand";

interface ActiveCall {
  callId: string;
  clientSessionId: string;
  peerName: string;
  mediaType: "audio" | "video";
  answeredAt: number;   // server clock
  muted: boolean; speakerOn: boolean; held: boolean; cameraOff: boolean;
  connected: boolean;
}
export const useCallStore = create<{ active: ActiveCall | null; set: (a: ActiveCall | null) => void }>(
  (set) => ({ active: null, set: (a) => set({ active: a }) }),
);
```

Then a persistent `<OngoingCallBar/>` mounted next to `<IncomingCallOverlay/>` in `App.tsx`, above the navigator, that renders when `active !== null && AppState !== 'active'` — a heads-up card with avatar, `useCallDuration`, and a hang-up button. Tapping it re-navigates to `CallScreen`.

Two behaviour rules from 02 #5 that must be fixed while this exists:

- **`hangup` must not be in a `useEffect` dependency array.** `hangUp` closes over `leaving`, so flipping `leaving` re-creates it, which re-runs the media effect, which calls `getUserMedia` and `createOffer` *again for a call being ended*. Hold `hangUp` in a ref.
- **The cleanup's `pc.close()` synchronously fires `connectionstatechange: 'closed'`, which calls `hangUp()` again**, producing a second `navigation.goBack()` and popping one screen too far. Guard with a `disposed` ref that is already in scope.

### 6.3 iOS ongoing

CallKit shows the ongoing call automatically once the call is reported — `CXCall` persists in the system UI and in Control Center / the Lock Screen for the whole call. Nothing app-side is required beyond reporting the start:

```swift
provider.reportOutgoingCall(with: uuid, startedConnectingAt: Date())
// ... on first remote track / on connected:
provider.reportOutgoingCall(with: uuid, connectedAt: Date())
// ... on teardown:
provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
```

Because CallKit owns the audio session for the duration, LiveKit RN must be configured not to fight it (`registerGlobals({ autoConfigureAudioSession: false })`, then configure `AudioSession` when `RTCAudioSession.audioSessionDidActivate` fires). Skipping this is the standard cause of "the call drops when I background the app" on iOS.

---

## 7. Duration correctness

### 7.1 The rule

```
durationMs = max(0, (endedAt ?? serverNow()) - answeredAt)
```

Three properties, all mandatory:

1. **`endedAt` and `answeredAt` are written by Convex, never by a client.** One clock, one authority. The current code satisfies this; keep it.
2. **`serverNow()` is not `Date.now()`.** The current code subtracts a *server* timestamp from a *device* clock, so any skew drives the value negative and `formatElapsed` renders `-1:-3` verbatim (02 #6, 02 #11). Every call query returns `serverNow`; the client computes an offset and uses it.
3. **Never an incrementing counter.** `setElapsed(elapsed + 1)` accumulates drift across background/suspend and across the timer being cleared. Even the current delta-based version is unseeded (`useState(0)` with a first tick at +1000 ms), so the screen paints `00:00` for a full second and then jumps to `00:Δ+1` — which is exactly "the duration numbers are weird" for received calls, where Δ is largest because the path is notification → mutation → navigation → mount (02 #7).

### 7.2 The implementation

```ts
// src/calls/useCallDuration.ts — isomorphic, one implementation both platforms use
import { useEffect, useMemo, useState } from "react";

/**
 * Single source of truth for every duration in the product: the in-call
 * screen, the ongoing-call bar, the call-history list, the notification
 * chronometer anchor, and the web call bar.
 *
 * durationMs = max(0, (endedAt ?? serverNow) - answeredAt)
 *
 * Never incremented, never accumulated, never seeded to zero.
 */
export function useCallDuration(
  answeredAt: number | null,
  endedAt: number | null,
  serverNow: number,
): { durationMs: number; label: string; isLive: boolean } {
  const [now, setNow] = useState(() => serverNow);

  // Live calls tick from the offset-corrected server clock. A finished call
  // does not tick at all — its duration is frozen at the moment endedAt was
  // written, which is the only way the history list can be correct.
  useEffect(() => {
    if (answeredAt === null || endedAt !== null) return;
    setNow(serverNow);
    const id = setInterval(() => setNow(Date.now() + clockOffset), 1000);
    return () => clearInterval(id);
  }, [answeredAt, endedAt, serverNow]);

  const durationMs = useMemo(() => {
    if (answeredAt === null) return 0;
    const end = endedAt ?? now;
    return Math.max(0, end - answeredAt);      // Math.max kills the skew case
  }, [answeredAt, endedAt, now]);

  return {
    durationMs,
    label: formatDuration(durationMs),
    isLive: answeredAt !== null && endedAt === null,
  };
}

/**
 * Client/server clock offset, refreshed on every calls.get response.
 * The midpoint of the request window is used so one-way latency cancels.
 */
let clockOffset = 0;
export function applyClockSample(serverNow: number, sentAt: number, receivedAt: number) {
  const rtt = receivedAt - sentAt;
  if (rtt > 0 && rtt < 5_000) {
    clockOffset = serverNow - (sentAt + receivedAt) / 2;
  }
}
export function serverNow(): number { return Date.now() + clockOffset; }

/** mm:ss under an hour, h:mm:ss above it, never negative, never NaN. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  // 09:05 is correct. 120:00 is what the current code shows for a 2h call.
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
```

Call sites:

```tsx
// Live call screen
const { label, durationMs } = useCallDuration(
  call.answeredAt, call.endedAt, call.serverNow);

// Ongoing-call bar (uses the SAME hook, same answerAt from the store)
const bar = useCallDuration(active.answeredAt, null, storeServerNow);

// Call-history row — frozen, no ticker, no hooks-with-interval needed
const row = useCallDuration(c.answeredAt, c.endedAt, c.endedAt ?? Date.now());
```

`formatDuration` also replaces `convertMinutesToTime` in `CallDetails.tsx:261` and `CallHistory.tsx:156`, which render `NaN min  NaN sec` when the payload lacks `totalDurationInMinutes` (02 #12). Those two screens read CometChat dashboard data and are being deleted in Phase 6, so the fix is deletion.

### 7.3 Why the current numbers are weird — precisely

Five distinct defects compose. Symptom 5 is the sum.

| # | Defect | Location | Observable |
| --- | --- | --- | --- |
| 1 | `answeredAt` written by the Convex server, read against `Date.now()` on the device | `convex/calls.ts:167` vs `WebRTCCallScreen.tsx:242` | Device clock 3 s behind → `elapsed = -3` → `formatElapsed` renders **`-1:-3`**. `Math.floor(-0.05) = -1`, `-3 % 60 = -3`, `padStart` keeps the sign. |
| 2 | `elapsed` initialised to `0`, interval's first tick at +1000 ms | `WebRTCCallScreen.tsx:66`, `:241` | Screen paints `00:00` for one second, then snaps to `1 + floor(Δ/1000)`. With Δ = 400 ms → `00:01`; with Δ = 8 s (notification path) → **`00:08`**. The user's "received calls show weird durations" is this jump. |
| 3 | No hours branch in `formatElapsed` | `WebRTCCallScreen.tsx:286` | A 2 h call shows `120:00`. A 61 min call shows `61:40`, not `1:01:40`. Correct arithmetic, wrong format. |
| 4 | `statusLabel` falls through to `'Call ended'` for every non-active/ringing status, including `call === undefined` | `WebRTCCallScreen.tsx:294` | The first ~400 ms of every call renders **"Call ended"**. |
| 5 | `useEffect` deps are `[call?.status, call?.answeredAt]` but `leave` changes identity, and `call` is also a dep | `WebRTCCallScreen.tsx:232-235` | After a teardown the effect re-runs and can re-trigger `leave()`, producing the double-`goBack()` that pops an unrelated screen. |

Defect 1 is the one that produces literal garbage. Defects 2 and 4 are the ones that produce "weird" without being obviously broken. All five are fixed by the rule above plus the `status` enum from §3.4 (which has no `"Call ended"` fallthrough, because `call === undefined` maps to `"idle"`).

---

## 8. Web parity

### 8.1 Client-only boundaries

`@livekit/components-react` touches `window`, `RTCPeerConnection`, `AudioContext` and `navigator.mediaDevices` at module scope in several paths. SSR-ing it produces hydration mismatches and crashes.

```tsx
// src/app/(app)/call/[callId]/page.tsx
import { Skeleton } from "@/components/skeleton";
const CallRoom = dynamic(() => import("./CallRoom"), {
  ssr: false,
  loading: () => <Skeleton />,
});
export default function Page({ params }: { params: { callId: string } }) {
  return <CallRoom callId={params.callId} />;
}
```

```tsx
// src/app/(app)/layout.tsx
import { CallBar } from "@/components/call-bar";   // client component

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>                        {/* ONE ConvexReactClient, module scope (11 §57) */}
      {children}
      <CallBar />                  {/* survives navigation, above the router */}
    </Shell>
  );
}
```

`<CallBar/>` lives in the layout, not in a page, so a call in progress survives a client-side navigation. That is symptom 4's web analogue.

### 8.2 The room

```tsx
"use client";
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";
import { useCallSession } from "@/calls/useCallSession";
import { useCallDuration } from "@/calls/useCallDuration";

export default function CallRoom({ callId }: { callId: string }) {
  const session = useCallSession({ token, callId, clientSessionId, platform: "web" });
  const creds = useQuery(api.livekit.credentials, { token, callId });

  const { label } = useCallDuration(session.answeredAt, session.endedAt, session.serverNow);

  if (!creds || session.status === "ended") return <CallEnded />;

  return (
    <LiveKitRoom
      serverUrl={creds.serverUrl}
      token={creds.token}
      connect={session.status !== "ended"}
      audio={session.status === "active"}
      video={session.mediaType === "video" && session.status === "active"}
      onConnected={() => markConnected(callId)}
      onDisconnected={() => session.hangup()}
      data-lk-theme="default"
    >
      <VideoConference />
      <RoomAudioRenderer />   {/* MUST stay mounted: it owns the <audio> element */}
      <DurationBadge label={label} />
    </LiveKitRoom>
  );
}
```

### 8.3 FCM Web + service worker

Per 11 §446, four things are all required for a push to reach a closed tab: HTTPS, a registered SW with a `push` listener, `Notification.permission === "granted"` requested from a user gesture, and per-browser subscriptions stored server-side keyed by user.

```ts
// src/lib/firebase.ts — token registration, mirroring the RN path exactly
import { initializeApp } from "firebase/app";
import { getMessaging, getToken } from "firebase/messaging";

export async function registerWebPush(userId: string, endpoint: string) {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY!,
    serviceWorkerRegistration: reg,
  });
  // Same pushTokens table, platform: "web", deviceId = per-tab sessionStorage uuid.
  await registerDevice({ token, platform: "web", deviceId, userId });
}
```

```js
// public/sw.js — MUST call showNotification on every push.
// Safari revokes notification permission for a site whose SW receives a push
// and does not display it (11 §443).
self.addEventListener("push", (event) => {
  const d = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(d.callerName ?? "synomiló", {
      body: d.mediaType === "video" ? "Incoming video call" : "Incoming voice call",
      icon: "/icons/caller-192.png",
      badge: "/icons/badge.png",
      tag: d.collapseKey ?? `call:${d.callId}`,   // one notification per call
      renotify: false,                            // a redelivered push must not re-sound
      requireInteraction: true,                   // "Limited availability" — do not rely on it
      silent: false,
      vibrate: [500, 1000, 500, 1000],
      data: d,
      actions: [
        { action: "decline", title: "Decline" },
        { action: "accept", title: "Accept" },
      ],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data;
  event.waitUntil((async () => {
    // One client only. A second tab would answer twice; the Convex state
    // machine makes that safe but not pleasant.
    const win = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of win) { c.postMessage({ type: "call-push", data: d }); return (await c.focus()); }
    await self.clients.openWindow(`/call/${d.callId}?action=${event.action}`);
  })());
});
```

Accepting from a notification requires microphone permission, which needs a user gesture. `openWindow` navigation **is** the gesture. If permission is denied, `calls.accept` has already fired server-side and the call is in `accepted` with nobody in the room — so `accept` must be followed by a room-join failure path that reverts to `ended` with `endReason: "media_failure"` if no participant joins within 15 s. That watchdog is worth building regardless of platform.

### 8.4 What web actually cannot do — be honest

Per 11 §504. Design the copy around this rather than pretending.

| Wanted | Web reality | What we ship |
| --- | --- | --- |
| Full-screen incoming-call activity | Impossible. OS banner only. | In-app overlay when the tab is visible; OS notification otherwise. Two surfaces, one handler (§4.6). |
| Custom looping ringtone until answered | Impossible. Cannot attach a looping custom ringtone to a notification. | Foreground: `<audio loop>` in the tab (autoplay allowed — the user clicked Call in this tab). Background: `AudioContext` from the page; background tabs are not audio-muted if actively playing. Closed tab: OS sound only. |
| Bypass Focus / DND | Impossible. | Accept it. In-app missed-call entries carry the message instead. |
| Notification survives OS truncation | No guarantee on title length. | Title ≤ 40 chars. Nothing load-bearing in title or body. |
| Custom Accept/Decline | Max 2, gated on `Notification.maxActions > 0`. | Check at runtime: `Notification.maxActions ?? 0` and fall back to a single "Open" action. |
| Know if it was shown | `notificationclose` fires only on active dismissal. | Do not build on it. |
| Ring when the browser is fully quit | No browser does this. | Missed-call list in `calls.history` is the fallback channel. Push is an accelerant, never the only one (11 §542). |

**Edge `scenario: "incoming-call"` is flag-only.** Microsoft's explainer proposes `options.scenario = "incoming-call"` for distinguished styling, custom answer/reject buttons, an associated ringtone and higher priority — it is behind `--enable-features=IncomingCallNotifications` and has not shipped (11 §510-521). Feature-detect it, use it if present, ship the notification-with-two-actions fallback today. Do not gate the product on it.

### 8.5 Keeping the call alive

Three mechanisms, all required:

```ts
// 1. An OPEN RTCDataChannel is a spec'd exemption from Chrome's intensive
//    throttling: a peer connection with an open data channel or a live
//    MediaStreamTrack is checked once per second, never once per minute
//    (11 §546-552). LiveKit opens one for `room.localParticipant.publishData`
//    and for its own control plane; assert it explicitly so a regression
//    cannot silently drop the tab to 1/min.
room.localParticipant
  .publishData(new TextEncoder().encode("keepalive"), { reliable: false })
  .catch(() => {});

// 2. wakeLock is released automatically when the tab becomes invisible, so
//    re-requesting on visibilitychange is mandatory, not an optimisation.
let sentinel: WakeLockSentinel | null = null;
const acquire = async () => {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => { sentinel = null; });
  } catch { /* refused for battery/power-save. Never fatal. */ }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !sentinel) void acquire();
});
void acquire();

// 3. Reconcile after a discard rather than assuming the call ended.
if (document.wasDiscarded) {
  // Re-read calls.get; if it says `accepted` and we have no room, show
  // "Rejoin call?" — the call may still be live with the other participant.
}
```

Do **not** design around a silent `AudioContext` on Chrome — "a silent audio track doesn't count" (11 §559). The WebRTC exemption is the real one.

### 8.6 Ongoing-call indicator without a notification

A `Notification` is a snapshot. It cannot show a live duration and it cannot be updated with new buttons (`new Notification()` throws a `TypeTypeError` in nearly all mobile browsers — it must be `ServiceWorkerRegistration.showNotification`). So:

- **Docked call bar** in the layout, bottom-right: avatar, `useCallDuration` label, mute, camera, hang-up. The real indicator.
- **Document title + favicon badge** for when the tab is backgrounded. Chromium treats "updating the table title or favicon" as a reason not to discard a page (11 §554), so this is both a UX affordance and a survival mechanism:

```ts
let baseTitle = "";
function paintCallIndicator(active: ActiveCall | null) {
  const { label } = useCallDuration(active?.answeredAt ?? null, null, active?.serverNow ?? 0);
  if (active) {
    // "<canvas> — 04:12" — Chromium reads title changes as liveness.
    baseTitle ||= document.title;
    document.title = `(${label}) ${active.peerName} — synomiló`;
    drawFaviconBadge("#E5484D");
  } else {
    document.title = baseTitle || "synomiló";
    restoreFavicon();
  }
}
```

- **`sendBeacon` on `pagehide`**, not `beforeunload` (11 §590):

```ts
addEventListener("pagehide", (e) => {
  if (!activeCallId) return;
  navigator.sendBeacon("/api/calls/leave",
    new Blob([JSON.stringify({ callId: activeCallId })], { type: "application/json" }));
});
```

---

## 9. Cross-cutting

### 9.1 Call recording — port or consciously drop

`src/components/calls/CallRecordings.tsx` (6.6 kB) is a working UI. It reads `call.getRecordings()` — **CometChat dashboard data**, not `convex/calls`. It is registered in the stack and unreachable (02 #9, 09). It is not a port job; it is a rewrite against a new source.

The replacement is **LiveKit Egress**, and the decision is not "port the component" but "do we record at all".

| Option | What it costs | Verdict |
| --- | --- | --- |
| **Drop recording** | Delete `CallRecordings.tsx`, `CallDetails.tsx`, `CallHistory.tsx`, `OngoingCallScreen.tsx`. Remove the feature from the UI. | **Recommended for v1.** |
| **LiveKit Egress, room composite** | Needs `docker run --rm -p 8080:8080 livekit/egress` plus a container with Chrome; `EgressClient.startRoomCompositeEgress(roomName, { fileOutputs: [{ fileType: "MP4", filepath: "/tmp/recordings/<callId>" }] })`; upload to Convex Storage from the egress container; render the existing UI against Convex Storage ids. | Real work, ~3–5 days, plus a container to operate. |
| **LiveKit Egress, participant** | `startParticipantEgress` for a single participant — cheaper, no browser container, but only one side's tracks. | Niche. |

**Recommendation: consciously drop it in Phase 6, delete the components, and record the decision.** Reasons: the components read a dashboard you are removing, no user has working recordings today, and recording brings consent UI, retention policy, storage cost, and a legal surface that nobody has asked for. If it is required later, the LiveKit Egress path is documented above and the UI is a day of work against a new query.

If it does ship, the consent rule is non-negotiable: a visible, persistent recording indicator to every participant, plus a `recordingConsent` boolean on the call row that every participant must set before egress starts.

### 9.2 Group calls

`calls.calleeIds` is already `v.array(v.id("users"))` in §2.1, so the schema is group-capable from day one without a migration.

What needs deciding:

- **Ring policy.** WhatsApp rings everyone and connects when *any one* answers; the others join when they accept. The state machine's `ringing → accepted` transition handles it: the first accept wins and the rest become participants. `answeredByClientSessionId` becomes `answeredByClientSessionIds`.
- **Index change.** `.index("by_callee", ["calleeIds"])` on an array field indexes each element, so one index replaces today's `by_callee` + `by_callee_status` pair (02 "Group calls: ABSENT", 09 M27).
- **Media.** LiveKit rooms are inherently multi-party. `VideoConference` gives you a grid for free on web; on RN you build a `useTracks` grid, which is the one genuinely new UI component in Phase 4.
- **CallKit.** `supportsGrouping = false` (§5.4) is correct — group calls here are LiveKit rooms, not CallKit Call Groups. Setting `supportsGrouping = true` would put a CallKit group in the system UI with no relationship to the actual room.

Ship 1:1 in Phase 4. Enable group in Phase 5 by passing `calleeIds` with more than one element. The state machine does not change.

### 9.3 Quality and stats

`react-native-callstats` is a dependency with **zero imports** anywhere in the repo (07 §374, 09 M31). It is 0.6 MB of dead weight and it is a CometChat Calls SDK dependency, not a WebRTC API.

**Drop it.** LiveKit gives better data:

```ts
// Both platforms, identical source.
room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
  // excellent | good | poor | unknown | lost
  report({ callId, clientSessionId, direction: quality, kind: "quality" });
});

const stats = await room.getStats();
for (const report of stats) {
  // report.type === RTCStatsReportType.outbound-rtp
  //   packetsSent, bytesSent, jitter, packetsLost, roundTripTime
}
```

Throttle to one sample per 15 s, write to `callEvents`. That replaces M31 with something that actually works, at a fraction of the size. Remove `react-native-callstats` from `package.json` in Phase 4 (07 §422 already budgets the 6–9 MB APK win from the unused-dep sweep).

The connection-quality signal is also the input to `endReason: "peer_disconnected"`. LiveKit's `RoomEvent.Disconnected` with `reason === ParticipantDisconnectedReason` and `DisconnectionQuality` gives you `good`/`poor` — surface a "Reconnecting…" state rather than silently ending the call, which is what 02 "peer disconnected by network: not modelled" describes.

### 9.4 DTMF

`supportsDTMF = false` on the `CXCallUpdate` (§5.4), and here is why: DTMF in CallKit exists to drive a **PSTN/SIP IVR**. There is no SIP leg in this architecture — every participant joins a LiveKit room over WebRTC. There is no keypad on the far end to press buttons on.

If SIP is added later (`livekit-server-sdk`'s SIP participant), DTMF becomes real: `CXHandle` on the SIP participant, `supportsDTMF = true`, and `room.localParticipant` DTMF frames. **Do not build a DTMF keypad UI now.** Recording the decision is the deliverable. This is 09 M29 ("DTMF / keypad: ABSENT") staying absent with a stated reason rather than an unstated gap.

### 9.5 Screen share

| Platform | Mechanism | Effort | Defer? |
| --- | --- | --- | --- |
| Web | `getDisplayMedia()` — **always requires a user gesture**, `displaySurface` may be `browser` (11 §594) | ~1 day, `@livekit/components-react` `<ScreenShareButton/>` | No — it is one line and works. |
| iOS | `ScreenCapturePickerView` from `@livekit/react-native` + a broadcast upload extension in the Xcode target (Phase 4 of the RN quickstart) | 3–5 days | Yes. |
| Android | `MediaProjection` — consent dialog every session, plus a foreground service with `mediaProjection` type | 3–5 days, high user-dropout | Yes. |

Ship web screen share in Phase 5. iOS/Android in a Phase 7 if requested. State the asymmetry in the UI: show the button on web, hide it on mobile until Phase 7, rather than shipping a button that opens a consent dialog and then fails.

### 9.6 TURN and server provisioning

LiveKit ships an **embedded TURN server** whose auth is integrated with the signalling connection — coturn is not needed (11 §376). Clients never see ICE credentials; LiveKit hands them out over the authenticated signalling channel.

Deploy: one `livekit/server` container + Redis (recommended in production) + a real domain with a trusted TLS cert. Ports: **UDP 50000–60000** (media), **TCP 7881** (signalling), plus **UDP/TCP 3478 and TLS 5349** if you enable TURN over TCP/TLS for restrictive networks. **400–3000 concurrent calls per node** is the documented ceiling.

`livekit-server-sdk` in a Convex action mints the token:

```ts
// convex/livekit.ts
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

export const credentials = query({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, { token, callId }) => {
    const me = await requireUser(ctx, token);
    const call = await loadCall(ctx, callId);
    roleOf(call, me._id);                       // throws for non-participants

    // Pre-create the room so the first joiner does not race room creation.
    const svc = new RoomServiceClient(
      process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
    const roomName = call.livekitRoomName ?? `call-${callId}`;
    await svc.createRoom({ name: roomName, emptyTimeout: 300, maxParticipants: 8 })
      .catch(() => { /* ERR_ALREADY_EXISTS is the expected race */ });

    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!,
      { identity: `${me._id}:${clientSessionId}`, name: me.displayName, ttl: "2h" },
    );
    at.addGrant({ room: roomName, roomJoin: true, canPublish: true,
                  canSubscribe: true, canPublishData: true, roomAdmin: false });
    return { token: await at.toJwt(), serverUrl: process.env.LIVEKIT_WS_URL! };
  },
});
```

Two details that matter:

- **`identity` is `${userId}:${clientSessionId}`, not `userId`.** LiveKit's SFU treats identity as the unique participant key. Two of your devices sharing an identity means the second **replaces** the first — the call appears to drop. This is the SFU-side expression of the same multi-device problem §3.5 solves on the Convex side.
- **The room is named from the `callId`**, so a room is garbage-collected by `emptyTimeout: 300` and there is no cross-call leakage.

Dev: one container. Escape hatch: LiveKit Cloud's Build plan is $0, no card, 5,000 WebRTC minutes/month (11 §378). If nobody wants to operate UDP and TLS, use that — the code is identical.

### 9.7 Permissions matrix

| Capability | Android | iOS | Web | Enforcement |
| --- | --- | --- | --- | --- |
| Microphone | `RECORD_AUDIO` (runtime) | `NSMicrophoneUsageDescription` | `getUserMedia({audio})` | **Required at answer**, not at ring |
| Camera | `CAMERA` (runtime) | `NSCameraUsageDescription` | `getUserMedia({video})` | Requested only for `mediaType === "video"` |
| Notifications | `POST_NOTIFICATIONS` (API 33+) | `UNUserNotificationCenter.requestAuthorization` | `Notification.requestPermission()` from a gesture | Registration is unconditional (§4.7); this gates *display* |
| Full-screen intent | `USE_FULL_SCREEN_INTENT` (API 34+: Special app access) | PushKit VoIP | **Impossible** | Check `canUseFullScreenIntent()`; degrade to heads-up |
| Ongoing call | `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_PHONE_CALL` + `MANAGE_OWN_CALLS` | `UIBackgroundModes: audio, voip` | none (tab stays alive) | Manifest + entitlements |
| Screen share | `mediaProjection` FGS | Broadcast extension | `getDisplayMedia` | Gesture required on all |
| Bluetooth routing | `BLUETOOTH_CONNECT` | `NSBluetoothAlwaysUsageDescription` | none | Wired/BT headset route detection |

Two defects in this table are pre-existing and unrelated to the migration:

- `NSBluetoothAlwaysUsageDescription` is **absent** from `Info.plist` (08 iOS-10). Accessing Bluetooth without it hard-crashes with `NSInvalidArgumentException`. Ship it with the CallKit work.
- `WRITE_EXTERNAL_STORAGE` / `READ_EXTERNAL_STORAGE` are declared with no `maxSdkVersion` and are ignored on API 29+/33+ (08 A2). Delete them or add `maxSdkVersion="28"`.

**Permission timing is the UX decision.** Request microphone and camera at *answer*, not at ring. Asking for the microphone while the phone is ringing on the lock screen guarantees a denial, because the system dialog appears on top of the ring and the user dismisses everything. WhatsApp asks after the user taps Accept. On Android the FSI must not be blocked by a runtime-permission dialog either.

---

## 10. Migration plan

Each phase ships independently, is verifiable on its own, and has a rollback that does not require a schema revert.

### Phase 0 — Make ringing reliable today · **3–5 days** · no LiveKit, no schema change

The no-regret fixes. Everything here is a bug fix against the current architecture; nothing is thrown away later.

| # | Change | Fixes |
| --- | --- | --- |
| 0.1 | `tools:node="remove"` on `CometChatFcmService`. One `MESSAGING_SERVICE`. | 01 #5, 08 A1 — "sometimes it doesn't ring" |
| 0.2 | Delete `setupPushOnLogin()`, `registerBackgroundCallTask()`, the `addCallListener` effect, `<CometChatIncomingCall>`. CometChat's ring engine is the third ringer and its accept path is a no-op. | 01 #6, #18, 02 #9 |
| 0.3 | Store the FCM token **unconditionally**; clear it on sign-out; log loudly when a callee has no token. | 01 #8, #9 |
| 0.4 | Switch `calls.start` to `internal.push.sendDataToTokens`. Delete the server-side `channelId`/`tag`/`title`/`body`. | 01 #1, #14, #15 |
| 0.5 | **Terminal pushes** from `end`, `reject`, `cancel`, `markTimedOut`. | 01 #7 |
| 0.6 | Add `IncomingCallActivity`, the manifest fragment (§5.2), `fullScreenAction.id = "open-call"`, and `Fs iModule`. | 01 #2, #3, #4 |
| 0.7 | Fix iOS: `$(APS_ENVIRONMENT)`, PushKit capability, bundle ID. **Nothing on iOS rings until this lands.** | 08 B1, B3, B4 |
| 0.8 | `useCallDuration` + `serverNow` on `calls.get`; delete the local `elapsed` counter and `formatElapsed`. | 02 #6, #7, #8, #11 → symptom 5 |
| 0.9 | Ongoing foreground-service notification with chronometer, `onlyAlertOnce`, mute/speaker/hold/end; `callStore` + `AppState` reconciliation; `hangup` out of effect deps; `disposed` guard on teardown. | 02 #1, #2, #3, #5 → symptoms 3, 4 |
| 0.10 | Reconcile displayed `call:*` notifications against `calls.incoming` on resume; fix the `IncomingCallOverlay` mount-cancel dependency bug (`[incoming]`, not `[incoming?._id]`). | 01 #16, #17 |

**Verify:** two real devices, three app states (foreground / background / force-stopped) × two platforms. Kill the app, receive a call, confirm an FSI on Android and a CallKit ring on iOS. Place a call, hang up, confirm the callee's ring stops within 1 s.

**Rollback:** a single `EXPERIMENTAL_CALL_PIPELINE` env var gates 0.4–0.6 behind the old path. 0.1–0.3 and 0.7 are unconditional bug fixes with no rollback path needed.

**Symptom impact:** 1 (largely), 2, 3, 4, 5. Symptom 6 partially — 0.6, 0.9, plus the feature gap in §9.

### Phase 1 — Schema and state machine · **2–3 days**

Add `pushTokens`, `callSessions`, the new `calls` shape, `convex/lib/callState.ts`, `serverNow` on every response, `calls.cancel` (distinct from `reject`), and the structured `accept` return. Backfill existing `calls` rows. `users.pushToken` still written, still read, as the fallback.

**Verify:** a table-driven unit test over `assertTransition` covering all 7 × 7 cells; a concurrency test firing 5 simultaneous `accept` mutations for one call and asserting exactly one `ok: true` and four `answered_elsewhere`.

**Rollback:** the new columns are `optional` except `mediaBackend` and `ringTimeoutMs`, which get defaults in the mutation. Old code keeps working because `status: "active"` is still produced for the legacy path (`accepted` maps to it). Verify this before deleting `pushToken`.

### Phase 2 — One push owner, one handler · **2–3 days**

`internal.push.sendCallPush` with the §4.3 payload. `pushTokens` fan-out with chunking and token pruning. `handleCallPush` (§4.6) wired into all five entry points. `BroadcastChannel` multi-tab guard on web. Per-call `collapseKey` everywhere.

**Verify:** `adb shell am force-stop` then ring; assert one notification with `adb shell dumpsys notification`. Then deliver the same payload twice via `curl` to the FCM endpoint and assert the notification count stays at 1. Open two web tabs with the same session; assert one rings.

**Rollback:** `EXPERIMENTAL_CALL_PIPELINE=0` reverts to `sendToTokens`. The new payload's `kind` field is ignored by the old client, which only reads `callId`, so a mid-flight revert is safe.

### Phase 3 — Mobile call experience · **5–7 days**

`IncomingCallScreen` (the in-app ring overlay), Accept/Decline as *explicit*
user actions on every surface (never a body tap), the ringback tone for the
caller, the post-return "Rejoin?" prompt when the app was killed mid-call,
and `promoteToVideo` (audio→video escalation, the only legal self-loop in the
state machine).

**Verify:** five real devices (two Android, two iOS, one tablet). Ring from
each, answer from each, decline from each, cancel from the caller, let the
ring time out. Assert exactly one notification and exactly one ring at every
point. On the tablet specifically: confirm the phone still rings (01 #10).

**Rollback:** the new screens mount behind `EXPERIMENTAL_CALL_UI`. The old
`WebRTCCallScreen` remains the fallback path.

### Phase 4 — LiveKit · **7–10 days** · the cutover

Spike first (**1 day, gate**): a bare `@livekit/react-native` room on this RN
0.81.4 + New Architecture + Hermes build. If the LiveKit RN fork is not New-Arch
compatible, pin `@livekit/react-native@2.12.0` and re-run the spike. **Do not
start the real work until the spike passes.** This is the single largest
schedule risk in the plan.

Then, in order:

1. Fix `proguard-rules.pro` **before** enabling R8. It is empty today and
   `minifyEnabled` is `false` (08 A10, Android-11). Add keep rules for
   `@livekit/**`, `io.invertase.**`, `com.rajofearth.**`, plus the standard
   New-Arch `-keep class * extends com.facebook.react.** { *; }`.
2. Stand up `livekit/server` + Redis; add `LIVEKIT_URL`, `LIVEKIT_WS_URL`,
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` to the Convex deployment env.
3. `convex/livekit.ts` with `credentials` (§9.6).
4. `LiveKitRoom` RN component behind `mediaBackend === "livekit"`.
5. **Hard cutover:** remove `react-native-webrtc`, add
   `@livekit/react-native` + `@livekit/react-native-webrtc`. They cannot
   coexist (§1.2b). Grep for every `react-native-webrtc` import and delete —
   audit 09's inventory says `WebRTCCallScreen.tsx` is the only live consumer,
   but verify rather than assume.
6. Delete `convex/calls.ts:248-300` (`signal` / `signals` / `consumeSignals`)
   and the `callSignals` table. Nothing else on the server goes away.
7. `api.calls.setSessionState` wired to LiveKit `RoomEvent.Connected` /
   `Disconnected` / `ConnectionQualityChanged` (§9.3).
8. CallKit/PushKit replaced by `CallKitManager` (§5.4), on top of the Phase 0
   entitlement fixes.

**Verify:** a 2-minute call on each platform pair (Android↔iOS, Android↔web,
iOS↔web). Verify the SFU is actually relaying — `livekit-server` logs should
show the room with two participants; a P2P mesh would show a direct connection
and a TURN allocation only for the hard NAT cases. Call behind a symmetric NAT
(CGNAT) to prove TURN works. Verify `clientSessionId` differs per device by
logging the LiveKit `identity` — if it is `userId` alone, the second device
silently replaces the first.

**Rollback:** set `mediaBackend` to `"webrtc"` in the schema. New calls take
the old path. **The reverse is not true** — once `react-native-webrtc` is
removed from the build, the old path is gone. So: keep the WebRTC path
compiling and tested through the whole of Phase 4, and delete the package only
in Phase 6.

### Phase 5 — Web app · **4–6 days**

Next.js call surface: client-only boundaries (§8.1), `CallRoom` (§8.2), FCM
Web + SW (§8.3), `CallBar` + title/favicon indicator (§8.6), the
keep-alive trio (§8.5), and the honest UX copy (§8.4).

**Verify:** Chrome, Edge, Firefox, Safari desktop. Tab-switch for 10 minutes
and confirm the call survives (the `RTCDataChannel` exemption). Close the tab
mid-call and confirm the other party sees nothing broken and the page is not
discarded. Two tabs, one answer (§3.5). iOS Safari: confirm the PWA
install prompt is shown and that push only works from the Home Screen.

**Rollback:** the web app is new — there is nothing to roll back to. Ship it behind a feature flag if the rest of the web app is not ready.

### Phase 6 — Delete the legacy surface · **2–3 days**

Delete: `src/components/calls/WebRTCCallScreen.tsx`, `OngoingCallScreen.tsx`,
`CallDetails.tsx`, `CallHistory.tsx`, `CallRecordings.tsx`,
`src/utils/CometChatPushV2.ts`, `src/components/calls/Calls.tsx`'s CometChat
branches, and `react-native-webrtc` + `react-native-callstats` from
`package.json`. Then remove the CometChat *chat* packages too
(`@cometchat/calls-sdk-react-native`, `@cometchat/push-notifications-react-native`)
and migrate theming off `@cometchat/chat-uikit-react-native` to
`react-native-paper`, which every Convex screen already uses.

**Do not start here.** 02's closing note is right: removing the CometChat
surface before Phase 0 lands will *look* like it fixed the bug — the duplicate
ring disappears — while the background experience is still a plain tray
notification. That is a false-positive fix and it will hide Phase 0.

**Verify:** full smoke suite (audit 04 §"Phase 4 manual smoke"). Two devices, both platforms, every call path. APK size drops ~3.3 MB per 10 §364.

### Effort summary

| Phase | Days | Cumulative |
| --- | --- | --- |
| 0 — Reliability fixes | 3–5 | 3–5 |
| 1 — Schema + state machine | 2–3 | 5–8 |
| 2 — Push owner + handler | 2–3 | 7–11 |
| 3 — Mobile call UX | 5–7 | 12–18 |
| 4 — LiveKit cutover (incl. 1 d spike) | 7–10 | 19–28 |
| 5 — Web app | 4–6 | 23–34 |
| 6 — Delete legacy | 2–3 | 25–37 |

Phases 0–1 alone fix four of the six symptoms and are worth doing regardless of whether LiveKit ever ships.

---

## 11. Symptom → fix map

| # | User's words | Root cause | Fix | Phase |
| --- | --- | --- | --- | --- |
| 1 | *"sometimes their phone rings, sometimes it doesn't, or it only rings when I have the app open"* | Three `MESSAGING_EVENT` claimants (08 A1); token not stored if permission denied (01 #8); token cleared never on sign-out (01 #9); one token per user (01 #10); iOS `aps-environment = development` (08 B1); push is `notification`+`data` so Play draws a one-shot tray alert in the background (01 #1) | 0.1, 0.3, 0.4, 0.7, 1, 2 | 0 |
| 2 | *"a vague notification that somebody is calling… it should do what WhatsApp does"* | No `IncomingCallActivity`; FSI target is keyguard-obscuring `MainActivity`; `fullScreenAction.id = "accept-call"`; FSI revoked on API 34+ and undetectable; notification had no `loopSound`, no category, no actions | 0.6 + `CallRingingActivity` + `loopSound` + `AndroidCategory.CALL` | 0 |
| 3 | *"If I have minimized the app while calling… the notification is just a normal notification"* | There is no ongoing notification anywhere (02 #1); no call store, so state dies with the screen (02 #2) | 0.9 — foreground-service notification, `ongoing`, `onlyAlertOnce`, persistent actions, `callStore` + `AppState` | 0 |
| 4 | *"ongoing call… I may know there's a call but nothing else"* | Same as 3, plus the in-call banner/mini-player does not exist (02 §Feature gaps) and `hangup` is reachable only from the hang-up button — swipe-back never calls it, so the row stays `active` forever (02 #5) | 0.9 + `OngoingCallBar` + `beforeRemove` guard + `sendBeacon` on web | 0, 5 |
| 5 | *"the duration numbers are weird"* | Five defects: server clock read against device clock → `-1:-3`; unseeded `elapsed` → `00:00` then jump; no hours branch → `120:00`; `statusLabel` shows "Call ended" during the load window; `useEffect` dep churn re-triggers teardown | §7 in full: `durationMs = max(0, (endedAt ?? serverNow) - answeredAt)`, `serverNow` from the clock-offset sample, memoized, never incremented | 0 |
| 6 | *"there aren't properly fleshed-out features for outgoing or incoming calls"* | No group calls, no hold, no speaker, no screen share, no DTMF, no stats, no headset routing, no audio-session config, no PiP, no duration in the call list, no upgrade audio⇄video | §9 + Phases 3–5. Recording consciously dropped; DTMF consciously dropped with a stated reason (no SIP leg) | 3, 4, 5 |

---

## 12. Risks and things I judge too big or too risky

Ordered by "will this hurt".

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Play revokes `USE_FULL_SCREEN_INTENT`.** It is Special app access on API 34+, revocable by the user and by Play. When it is gone the FSI silently becomes a sticky heads-up, which is precisely symptom 2. | High — it can silently un-fix a shipped symptom | File the Play calling declaration. Ship `canUseFullScreenIntent()`. Surface the row in `SettingsScreen`. Treat "no FSI" as a supported degraded mode and write the UI copy for it. |
| **`@livekit/react-native` + New Architecture.** The app has `newArchEnabled=true` on RN 0.81.4. If the LiveKit RN fork is not New-Arch compatible the whole plan stalls at Phase 4. | High — schedule | The 1-day Phase 4 spike exists solely for this. Fallback pin `@livekit/react-native@2.12.0`. Fallback 2: `livekit-client` directly with `react-native-webrtc` for media, which is more work but keeps the existing native module. |
| **Self-hosted LiveKit is ops.** UDP 50000–60000, a TLS cert, Redis, upgrades. | Medium | Start with LiveKit Cloud's Build plan ($0, no card, 5,000 min/mo). The client code is byte-identical; only `LIVEKIT_URL` changes. Move to self-host when volume justifies it. |
| **The `@livekit/react-native-webrtc` swap is a hard cutover.** It cannot coexist with `react-native-webrtc`; removing the old one destroys the rollback path. | Medium | Keep the WebRTC path compiling through Phase 4. Delete the package only in Phase 6. |
| **iOS PushKit entitlement.** Without it VoIP registration fails and iOS terminates the app for an unhandled VoIP push. | Medium | Phase 0, item 0.7. Verify with `codesign -d --ententitlements` on the packaged binary, not in the project settings. |
| **R8.** `proguard-rules.pro` is empty and `minifyEnabled` is `false` (08 Android-10/11). The moment anyone flips it, every reflection-based native module breaks in release only. | Medium, latent | Fix the rules as Phase 4 step 1, *before* enabling. Do not bundle "let's enable R8" with the LiveKit change. |
| **Leaked Firebase service-account key in git history** (08 C1). It is the credential that sends every call ring. | High security, pre-existing | Rotate and purge — outside this document's scope but it should not wait. |
| **`REQUEST_INSTALL_PACKAGES`** (08 Android-3) is in the manifest for the self-updater. Play requires a Declaration Form and may reject the build. Shipping a call app that fails review over a side feature is a bad trade. | Medium | Decide before the next release: remove the updater, or file the declaration. |

### Too big for this cycle

- **LiveKit Egress recording.** A container with Chrome, an upload path, retention policy, and consent UI. Not a symptom. Ship dropped, consciously.
- **DTMF.** No SIP leg exists, so there is no keypad on the far end. Building a keypad UI would be building a feature that cannot function.
- **Native screen share.** iOS broadcast extension + Android `MediaProjection` FGS is 6–10 days for two platforms with a mediocre consent experience. Web only, for now.
- **Group calls UI.** The state machine and the LiveKit room already support it; only the RN grid is new work. Enable after 1:1 is solid.
- **PiP.** The SDK ships the capability but `MainActivity.kt` is 31 lines and has no `onUserLeaveHint`. Cheap later, zero user complaints today.
- **Call-quality telemetry at scale.** `callEvents` is cheap and worth writing now. A dashboard is a different project.

### Open questions for you

1. **Is the ring timeout 45 s or 60 s?** `convex/calls.ts:8` and `callNotifications.ts:69` both say 60 s; your own UX doc says 45 s. The payload's `ringExpiresAt` makes this a one-line change, but it should be a decision rather than whichever number a grep finds.
2. **Self-host or LiveKit Cloud to start?** The code is identical; the ops cost is not.
3. **Is recording actually required?** If yes, it moves out of "consciously dropped" and needs its own phase.
4. **What is the target call volume?** Under ~5,000 WebRTC minutes/month, Cloud Build is free and removes an entire ops surface from the critical path.

---

## Appendix: files this spec touches

**Backend.** `convex/schema.ts` (§2), `convex/lib/callState.ts` (new, §2.3), `convex/calls.ts` (§2.4, §3.1, §4.1), `convex/push.ts` (§4.3), `convex/livekit.ts` (new, §9.6), `convex/users.ts` (`pushToken` deprecation, §4.7).

**Shared.** `src/calls/` — `useCallSession.ts`, `useCallDuration.ts`, `callStore.ts`, `pushHandler.ts`, `notificationChannels.ts`, `ringing.ts`, `ongoing.ts`, `ongoingActions.ts`.

**React Native.** `index.js` (§4.6), `App.tsx` (§4.6, §6.2), `src/auth/SessionProvider.tsx` (§4.7), `android/app/src/main/AndroidManifest.xml` (§5.2), `android/app/src/main/java/com/rajofearth/synomilo/IncomingCallActivity.kt` (new, §5.1), `.../FsiModule.kt` (new, §5.3), `android/app/src/main/res/values/themes.xml` (§5.1), `android/app/proguard-rules.pro` (§Phase 4 step 1), `ios/SampleAppWithPushNotifications/AppDelegate.swift` (§5.4), `ios/CallKitManager.swift` (new, §5.4), `ios/.../SampleAppWithPushNotifications.entitlements` + `...Release.entitlements` + `project.pbxproj` (§5.4), `ios/.../Info.plist` (§9.7).

**Deleted.** `src/components/calls/WebRTCCallScreen.tsx`, `OngoingCallScreen.tsx`, `CallDetails.tsx`, `CallHistory.tsx`, `CallRecordings.tsx`, `src/utils/CometChatPushV2.ts`, `convex/calls.ts:248-300`.

**Web.** `src/app/(app)/call/[callId]/page.tsx`, `src/app/(app)/CallRoom.tsx`, `src/app/(app)/layout.tsx`, `src/components/call-bar.tsx`, `src/lib/firebase.ts`, `public/sw.js`.

---

*Related: `01-call-incoming-ringing.md` (why ringing is broken today), `02-call-outgoing-ongoing.md` (why ongoing is broken today and why durations are weird), `08-native-secrets.md` (the three blockers that stop iOS ringing entirely), `11-web-stack-research.md` (why LiveKit and not CometChat, and what browsers cannot do).*