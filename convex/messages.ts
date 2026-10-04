import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { previewFor, publicUser, requireUser } from "./lib/helpers";

const kindValidator = v.union(
  v.literal("text"),
  v.literal("image"),
  v.literal("video"),
  v.literal("audio"),
  v.literal("file"),
);

export const list = query({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    before: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { token, conversationId, before, limit }) => {
    const me = await requireUser(ctx, token);
    const membership = await ctx.db
      .query("members")
      .withIndex("by_user_conversation", (q) =>
        q.eq("userId", me._id).eq("conversationId", conversationId),
      )
      .unique();
    if (!membership) {
      throw new ConvexError("Not a member of this conversation");
    }

    const take = Math.min(limit ?? 50, 100);
    const pageDesc = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q) =>
        before === undefined
          ? q.eq("conversationId", conversationId)
          : q.eq("conversationId", conversationId).lt("createdAt", before),
      )
      .order("desc")
      .take(take);

    const page = pageDesc.reverse();
    const senderCache = new Map<string, ReturnType<typeof publicUser>>();
    const result = [];
    for (const msg of page) {
      let sender = senderCache.get(msg.senderId);
      if (!sender) {
        const user = await ctx.db.get(msg.senderId);
        sender = user
          ? publicUser(user)
          : {
              _id: msg.senderId,
              username: "unknown",
              displayName: "Unknown",
              avatarUrl: null,
              createdAt: 0,
            };
        senderCache.set(msg.senderId, sender);
      }

      const reactions = await ctx.db
        .query("reactions")
        .withIndex("by_message", (q) => q.eq("messageId", msg._id))
        .collect();
      const grouped = new Map<
        string,
        { emoji: string; count: number; mine: boolean }
      >();
      for (const reaction of reactions) {
        const entry = grouped.get(reaction.emoji) ?? {
          emoji: reaction.emoji,
          count: 0,
          mine: false,
        };
        entry.count += 1;
        if (reaction.userId === me._id) {
          entry.mine = true;
        }
        grouped.set(reaction.emoji, entry);
      }

      let fileUrl: string | null = null;
      if (msg.storageId && !msg.deletedAt) {
        fileUrl = await ctx.storage.getUrl(msg.storageId);
      }

      let replyTo = null;
      if (msg.replyToId) {
        const original = await ctx.db.get(msg.replyToId);
        if (original) {
          let replySenderName = "Unknown";
          const cached = senderCache.get(original.senderId);
          if (cached) {
            replySenderName = cached.displayName;
          } else {
            const replySender = await ctx.db.get(original.senderId);
            if (replySender) {
              replySenderName = replySender.displayName;
            }
          }
          replyTo = {
            _id: original._id,
            body: original.deletedAt ? null : (original.body ?? null),
            kind: original.kind,
            deletedAt: original.deletedAt ?? null,
            senderName: replySenderName,
          };
        }
      }

      result.push({
        _id: msg._id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        sender,
        kind: msg.kind,
        body: msg.deletedAt ? null : (msg.body ?? null),
        fileName: msg.deletedAt ? null : (msg.fileName ?? null),
        mimeType: msg.deletedAt ? null : (msg.mimeType ?? null),
        size: msg.deletedAt ? null : (msg.size ?? null),
        storageId: msg.storageId ?? null,
        deletedAt: msg.deletedAt ?? null,
        forwardedFrom: msg.forwardedFrom ?? null,
        replyTo,
        fileUrl,
        createdAt: msg.createdAt,
        reactions: Array.from(grouped.values()),
      });
    }

    const memberRows = await ctx.db
      .query("members")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();
    const receipts = [];
    for (const member of memberRows) {
      if (member.userId === me._id) {
        continue;
      }
      const memberSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", member.userId))
        .collect();
      let lastSeenAt = 0;
      for (const session of memberSessions) {
        if (session.lastSeenAt > lastSeenAt) {
          lastSeenAt = session.lastSeenAt;
        }
      }
      receipts.push({
        userId: member.userId,
        lastReadAt: member.lastReadAt,
        lastSeenAt,
      });
    }

    return {
      messages: result,
      hasMore: pageDesc.length === take,
      receipts,
    };
  },
});

export const send = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    body: v.optional(v.string()),
    kind: v.optional(kindValidator),
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    replyToId: v.optional(v.id("messages")),
    forwardedFrom: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      token,
      conversationId,
      body,
      kind,
      storageId,
      fileName,
      mimeType,
      size,
      replyToId,
      forwardedFrom,
    },
  ) => {
    const me = await requireUser(ctx, token);
    const membership = await ctx.db
      .query("members")
      .withIndex("by_user_conversation", (q) =>
        q.eq("userId", me._id).eq("conversationId", conversationId),
      )
      .unique();
    if (!membership) {
      throw new ConvexError("Not a member of this conversation");
    }
    const resolvedKind = kind ?? "text";
    const trimmed = (body ?? "").trim();
    if (resolvedKind === "text" && !trimmed) {
      throw new ConvexError("Message is empty");
    }
    if (resolvedKind !== "text" && !storageId) {
      throw new ConvexError("Missing attachment");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      conversationId,
      senderId: me._id,
      kind: resolvedKind,
      body: resolvedKind === "text" ? trimmed : trimmed || undefined,
      storageId,
      fileName: fileName?.slice(0, 200),
      mimeType: mimeType?.slice(0, 120),
      size,
      replyToId,
      forwardedFrom: forwardedFrom ? forwardedFrom.slice(0, 120) : undefined,
      createdAt: now,
    });

    await ctx.db.patch(conversationId, {
      updatedAt: now,
      lastMessageAt: now,
      lastMessagePreview: previewFor(resolvedKind, trimmed, me.displayName),
      lastMessageSender: me._id,
    });
    await ctx.db.patch(membership._id, { lastReadAt: now });

    const members = await ctx.db
      .query("members")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();
    const tokens: string[] = [];
    for (const member of members) {
      if (member.userId === me._id) {
        continue;
      }
      const user = await ctx.db.get(member.userId);
      if (user?.pushToken) {
        tokens.push(user.pushToken);
      }
    }
    if (tokens.length > 0) {
      const conversation = await ctx.db.get(conversationId);
      const isDm = conversation?.type === "dm";
      const label =
        resolvedKind === "text"
          ? trimmed.slice(0, 140)
          : resolvedKind === "image"
            ? "📷 Photo"
            : resolvedKind === "video"
              ? "🎬 Video"
              : resolvedKind === "audio"
                ? "🎧 Audio"
                : "📄 File";
      await ctx.scheduler.runAfter(0, internal.push.sendToTokens, {
        tokens,
        title: isDm ? me.displayName : (conversation?.name ?? "Wedding group"),
        body: isDm ? label : `${me.displayName}: ${label}`,
        data: {
          type: "message",
          conversationId: String(conversationId),
        },
      });
    }

    return messageId;
  },
});

export const remove = mutation({
  args: { token: v.string(), messageId: v.id("messages") },
  handler: async (ctx, { token, messageId }) => {
    const me = await requireUser(ctx, token);
    const message = await ctx.db.get(messageId);
    if (!message) {
      return true;
    }
    if (message.senderId !== me._id) {
      throw new ConvexError("You can only delete your own messages");
    }
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .collect();
    for (const reaction of reactions) {
      await ctx.db.delete(reaction._id);
    }
    await ctx.db.patch(messageId, {
      deletedAt: Date.now(),
      body: undefined,
      storageId: undefined,
      fileName: undefined,
      mimeType: undefined,
      size: undefined,
      replyToId: undefined,
    });
    return true;
  },
});

export const latestForConversation = query({
  args: { token: v.string(), conversationId: v.id("conversations") },
  handler: async (ctx, { token, conversationId }) => {
    const me = await requireUser(ctx, token);
    const membership = await ctx.db
      .query("members")
      .withIndex("by_user_conversation", (q) =>
        q.eq("userId", me._id).eq("conversationId", conversationId),
      )
      .unique();
    if (!membership) {
      return null;
    }
    const last = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .first();
    if (!last) {
      return null;
    }
    let senderName = "Unknown";
    const sender = await ctx.db.get(last.senderId);
    if (sender) {
      senderName = sender.displayName;
    }
    return {
      _id: last._id,
      preview: previewFor(last.kind, last.body ?? "", senderName),
      createdAt: last.createdAt,
    };
  },
});
