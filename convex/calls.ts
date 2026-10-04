import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { publicUser, requireUser } from "./lib/helpers";

const RING_TIMEOUT_MS = 60000;

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
      if (
        (call.status === "ringing" || call.status === "active") &&
        now - call.createdAt < RING_TIMEOUT_MS
      ) {
        throw new ConvexError("You are already in a call");
      }
      if (call.status === "ringing") {
        await ctx.db.patch(call._id, { status: "missed", endedAt: now });
      }
    }
    const myRingingAsCallee = await ctx.db
      .query("calls")
      .withIndex("by_callee_status", (q) =>
        q.eq("calleeId", me._id).eq("status", "ringing"),
      )
      .collect();
    for (const call of myRingingAsCallee) {
      await ctx.db.patch(call._id, { status: "rejected", endedAt: now });
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

    if (callee.pushToken) {
      await ctx.scheduler.runAfter(0, internal.push.sendDataToTokens, {
        tokens: [callee.pushToken],
        data: {
          type: "call",
          callId: String(callId),
          callType: type,
          callerName: me.displayName,
        },
        ttlMs: RING_TIMEOUT_MS,
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
      role: call.callerId === me._id ? "caller" : "callee",
      peer: peer ? publicUser(peer) : null,
    };
  },
});

export const accept = mutation({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, { token, callId }) => {
    const me = await requireUser(ctx, token);
    const call = await loadCall(ctx, callId);
    if (call.calleeId !== me._id) {
      throw new ConvexError("Only the person being called can accept");
    }
    if (call.status !== "ringing") {
      throw new ConvexError("This call is no longer ringing");
    }
    await ctx.db.patch(callId, { status: "active", answeredAt: Date.now() });
    return true;
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
      await ctx.db.patch(callId, { status: "rejected", endedAt: Date.now() });
    }
    return true;
  },
});

export const markTimedOut = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get(callId);
    if (call && call.status === "ringing") {
      await ctx.db.patch(callId, { status: "missed", endedAt: Date.now() });
    }
  },
});

export const end = mutation({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, { token, callId }) => {
    const me = await requireUser(ctx, token);
    const call = await loadCall(ctx, callId);
    assertParticipant(call, me._id);
    if (call.status === "ringing") {
      await ctx.db.patch(callId, {
        status: call.callerId === me._id ? "missed" : "rejected",
        endedAt: Date.now(),
      });
    } else if (call.status === "active") {
      await ctx.db.patch(callId, { status: "ended", endedAt: Date.now() });
    }
    return true;
  },
});

export const history = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await requireUser(ctx, token);
    const asCaller = await ctx.db
      .query("calls")
      .withIndex("by_caller", (q) => q.eq("callerId", me._id))
      .collect();
    const asCallee = await ctx.db
      .query("calls")
      .withIndex("by_callee", (q) => q.eq("calleeId", me._id))
      .collect();
    const all = [...asCaller, ...asCallee]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
    const rows = [];
    for (const call of all) {
      const peerId =
        call.callerId === me._id ? call.calleeId : call.callerId;
      const peer = await ctx.db.get(peerId);
      rows.push({
        _id: call._id,
        type: call.type,
        status: call.status,
        createdAt: call.createdAt,
        direction: call.callerId === me._id ? "outgoing" : "incoming",
        peer: peer ? publicUser(peer) : null,
      });
    }
    return rows;
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
