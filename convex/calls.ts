import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { publicUser, pushTokensForUser, requireUser } from "./lib/helpers";

const RING_TIMEOUT_MS = 60000;
/**
 * How long an `active` call is treated as genuinely in progress before it is
 * considered abandoned. Rows abandoned by a killed app used to permanently
 * block the user from answering any new call.
 */
const ACTIVE_CALL_TTL_MS = 4 * 60 * 60 * 1000;

async function loadCall(
  ctx: QueryCtx | MutationCtx,
  callId: Id<"calls">,
): Promise<Doc<"calls">> {
  const call = await ctx.db.get(callId);
  if (!call) {
    throw new ConvexError("Call not found");
  }
  return call;
}

function assertParticipant(call: Doc<"calls">, userId: Id<"users">) {
  if (call.callerId !== userId && call.calleeId !== userId) {
    throw new ConvexError("You are not part of this call");
  }
}

export const start = mutation({
  args: {
    token: v.string(),
    calleeId: v.id("users"),
    type: v.union(v.literal("audio"), v.literal("video")),
  },
  handler: async (ctx, { token, calleeId, type }) => {
    const me = await requireUser(ctx, token);
    if (calleeId === me._id) {
      throw new ConvexError("You cannot call yourself");
    }
    const callee = await ctx.db.get(calleeId);
    if (!callee) {
      throw new ConvexError("User not found");
    }
    const now = Date.now();

    // Clean up any of my stale ringing calls first.
    const myRingingAsCaller = await ctx.db
      .query("calls")
      .withIndex("by_caller", (q) => q.eq("callerId", me._id))
      .collect();
    for (const call of myRingingAsCaller) {
      // An `active` call blocks regardless of age. The previous check was
      // `now - createdAt < RING_TIMEOUT_MS`, so a 5-minute-old active call
      // passed the test and a second call row was inserted.
      if (call.status === "active") {
        throw new ConvexError("You are already in a call");
      }
      if (call.status === "ringing") {
        if (now - call.createdAt < RING_TIMEOUT_MS) {
          throw new ConvexError("You are already placing a call");
        }
        await ctx.db.patch(call._id, {
          status: "missed",
          endedAt: now,
          endReason: "timeout",
        });
      }
    }
    const myRingingAsCallee = await ctx.db
      .query("calls")
      .withIndex("by_callee_status", (q) =>
        q.eq("calleeId", me._id).eq("status", "ringing"),
      )
      .collect();
    for (const call of myRingingAsCallee) {
      await ctx.db.patch(call._id, {
        status: "rejected",
        endedAt: now,
        endReason: "declined",
      });
    }

    const callId = await ctx.db.insert("calls", {
      callerId: me._id,
      calleeId,
      type,
      status: "ringing",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(
      RING_TIMEOUT_MS,
      internal.calls.markTimedOut,
      { callId },
    );

    // DATA-ONLY push. A message carrying an FCM `notification` block is drawn
    // by Play Services in the background, which bypasses the app entirely and
    // produces the vague heads-up instead of a full-screen ring. The client's
    // Notifee full-screen intent is the single owner of the ring.
    const tokens = await pushTokensForUser(ctx, calleeId);
    if (tokens.length === 0) {
      console.warn(`call ${String(callId)}: callee has no push token registered`);
    } else {
      await ctx.scheduler.runAfter(0, internal.push.sendDataToTokens, {
        tokens,
        ttlMs: RING_TIMEOUT_MS,
        data: {
          type: "call",
          callAction: "ring",
          callId: String(callId),
          callType: type,
          callerName: me.displayName,
          ringExpiresAt: String(now + RING_TIMEOUT_MS),
          serverNow: String(now),
        },
      });
    }

    return callId;
  },
});

export const incoming = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await requireUser(ctx, token);
    const ringing = await ctx.db
      .query("calls")
      .withIndex("by_callee_status", (q) =>
        q.eq("calleeId", me._id).eq("status", "ringing"),
      )
      .collect();
    const fresh = ringing
      .filter((call) => Date.now() - call.createdAt < RING_TIMEOUT_MS)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!fresh) {
      return null;
    }
    const caller = await ctx.db.get(fresh.callerId);
    return {
      _id: fresh._id,
      type: fresh.type,
      createdAt: fresh.createdAt,
      caller: caller ? publicUser(caller) : null,
    };
  },
});

export const get = query({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, { token, callId }) => {
    const me = await requireUser(ctx, token);
    const call = await ctx.db.get(callId);
    if (!call) {
      return null;
    }
    if (call.callerId !== me._id && call.calleeId !== me._id) {
      return null;
    }
    const peerId =
      call.callerId === me._id ? call.calleeId : call.callerId;
    const peer = await ctx.db.get(peerId);
    return {
      _id: call._id,
      type: call.type,
      status: call.status,
      createdAt: call.createdAt,
      answeredAt: call.answeredAt ?? null,
      endedAt: call.endedAt ?? null,
      role: call.callerId === me._id ? "caller" : "callee",
      peer: peer ? publicUser(peer) : null,
      // Shipped with answeredAt/endedAt so the client can correct for the
      // difference between the server clock and the device clock. Without it,
      // `Date.now() - answeredAt` goes negative on any skewed device and the
      // call duration renders as garbage (e.g. "-1:-3").
      serverNow: Date.now(),
    };
  },
});

/**
 * Best-effort "stop ringing" push. Without it a declined or timed-out call
 * keeps ringing the other device for the full ring window, because no
 * terminal push was ever sent.
 */
async function notifyPeerOfStop(
  ctx: MutationCtx,
  call: Doc<"calls">,
  peerId: Id<"users">,
  action: "cancelled" | "ended",
): Promise<void> {
  const tokens = await pushTokensForUser(ctx, peerId);
  if (tokens.length === 0) {
    return;
  }
  await ctx.scheduler.runAfter(0, internal.push.sendDataToTokens, {
    tokens,
    ttlMs: 30000,
    data: {
      type: "call",
      callAction: action,
      callId: String(call._id),
      serverNow: String(Date.now()),
    },
  });
}

export const accept = mutation({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, { token, callId }) => {
    const me = await requireUser(ctx, token);
    const call = await loadCall(ctx, callId);
    if (call.calleeId !== me._id) {
      throw new ConvexError("Only the person being called can accept");
    }
    if (call.status === "active") {
      // Answered on another device. Convex mutations are serialisable per
      // document, so exactly one concurrent accept wins and the loser gets
      // this instead of a spurious error toast.
      return { ok: false as const, reason: "answered_elsewhere" as const };
    }
    if (call.status !== "ringing") {
      return {
        ok: false as const,
        reason: "not_ringing" as const,
        status: call.status,
      };
    }
    // Busy check. An `active` row is only evidence of a live call if it was
    // answered recently - otherwise it is a row abandoned by a killed app or a
    // dropped network, and those used to block every future answer with
    // "You are already in a call" even though the user was on no call at all.
    const now = Date.now();
    const staleBefore = now - ACTIVE_CALL_TTL_MS;
    const activeAsCallee = await ctx.db
      .query("calls")
      .withIndex("by_callee_status", (q) =>
        q.eq("calleeId", me._id).eq("status", "active"),
      )
      .collect();
    for (const stale of activeAsCallee) {
      const startedAt = stale.answeredAt ?? stale.createdAt;
      if (startedAt < staleBefore) {
        // Abandoned: close it out so it can never block again.
        await ctx.db.patch(stale._id, {
          status: "ended",
          endedAt: now,
          endReason: "failed",
        });
      } else {
        throw new ConvexError("You are already on another call");
      }
    }
    await ctx.db.patch(callId, { status: "active", answeredAt: now });
    return { ok: true as const, answeredAt: now, serverNow: now };
  },
});

export const reject = mutation({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, { token, callId }) => {
    const me = await requireUser(ctx, token);
    const call = await loadCall(ctx, callId);
    if (call.calleeId !== me._id) {
      throw new ConvexError("Only the person being called can decline");
    }
    if (call.status === "ringing") {
      const now = Date.now();
      await ctx.db.patch(callId, {
        status: "rejected",
        endedAt: now,
        endReason: "declined",
      });
      await notifyPeerOfStop(
        ctx,
        call,
        call.callerId,
        "cancelled",
      );
    }
    return true;
  },
});

export const markTimedOut = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get(callId);
    if (call && call.status === "ringing") {
      await ctx.db.patch(callId, {
        status: "missed",
        endedAt: Date.now(),
        endReason: "timeout",
      });
      await notifyPeerOfStop(ctx, call, call.calleeId, "cancelled");
    }
  },
});

export const end = mutation({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, { token, callId }) => {
    const me = await requireUser(ctx, token);
    const call = await loadCall(ctx, callId);
    assertParticipant(call, me._id);
    const now = Date.now();
    const peerId = call.callerId === me._id ? call.calleeId : call.callerId;
    if (call.status === "ringing") {
      const cancelled = call.callerId === me._id;
      await ctx.db.patch(callId, {
        status: cancelled ? "missed" : "rejected",
        endedAt: now,
        endReason: cancelled ? "timeout" : "declined",
      });
      await notifyPeerOfStop(ctx, call, peerId, "cancelled");
    } else if (call.status === "active") {
      await ctx.db.patch(callId, { status: "ended", endedAt: now, endReason: "hangup" });
      await notifyPeerOfStop(ctx, call, peerId, "ended");
    }
    return true;
  },
});

export const history = query({
  args: { token: v.string(), before: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { token, before, limit }) => {
    const me = await requireUser(ctx, token);
    const take = Math.min(limit ?? 50, 100);
    const rows = [];
    let cursor = before;
    // Paged over `by_createdAt` (newest first) with both roles merged, so the
    // list no longer hard-caps at 100 and stops loading a user's older calls.
    while (rows.length < take) {
      const batch = await ctx.db
        .query("calls")
        .withIndex("by_createdAt", (q) =>
          cursor === undefined ? q : q.lt("createdAt", cursor),
        )
        .order("desc")
        .take(take * 2);
      if (batch.length === 0) {
        break;
      }
      cursor = batch[batch.length - 1].createdAt;
      for (const call of batch) {
        if (call.callerId !== me._id && call.calleeId !== me._id) {
          continue;
        }
        const peerId =
          call.callerId === me._id ? call.calleeId : call.callerId;
        const peer = await ctx.db.get(peerId);
        rows.push({
          _id: call._id,
          type: call.type,
          status: call.status,
          createdAt: call.createdAt,
          answeredAt: call.answeredAt ?? null,
          endedAt: call.endedAt ?? null,
          endReason: call.endReason ?? null,
          durationMs:
            call.answeredAt && call.endedAt
              ? Math.max(0, call.endedAt - call.answeredAt)
              : null,
          direction: call.callerId === me._id ? "outgoing" : "incoming",
          peer: peer ? publicUser(peer) : null,
        });
        if (rows.length >= take) {
          break;
        }
      }
      if (batch.length < take * 2) {
        break;
      }
    }
    return { calls: rows, hasMore: rows.length >= take, cursor: cursor ?? null };
  },
});

export const signal = mutation({
  args: {
    token: v.string(),
    callId: v.id("calls"),
    kind: v.union(v.literal("offer"), v.literal("answer"), v.literal("ice")),
    payload: v.string(),
  },
  handler: async (ctx, { token, callId, kind, payload }) => {
    const me = await requireUser(ctx, token);
    const call = await loadCall(ctx, callId);
    assertParticipant(call, me._id);
    const toUserId = call.callerId === me._id ? call.calleeId : call.callerId;
    await ctx.db.insert("callSignals", {
      callId,
      fromUserId: me._id,
      toUserId,
      kind,
      payload: payload.slice(0, 20000),
      createdAt: Date.now(),
    });
    return true;
  },
});

export const signals = query({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, { token, callId }) => {
    const me = await requireUser(ctx, token);
    const incoming = await ctx.db
      .query("callSignals")
      .withIndex("by_call_to", (q) =>
        q.eq("callId", callId).eq("toUserId", me._id),
      )
      .collect();
    return incoming
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => ({ _id: s._id, kind: s.kind, payload: s.payload }));
  },
});

export const consumeSignals = mutation({
  args: { token: v.string(), signalIds: v.array(v.id("callSignals")) },
  handler: async (ctx, { token, signalIds }) => {
    const me = await requireUser(ctx, token);
    for (const signalId of signalIds) {
      const signal = await ctx.db.get(signalId);
      if (signal && signal.toUserId === me._id) {
        await ctx.db.delete(signalId);
      }
    }
    return true;
  },
});
