import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { publicUser, requireUser } from "./lib/helpers";

async function membershipFor(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<"conversations">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("members")
    .withIndex("by_user_conversation", (q) =>
      q.eq("userId", userId).eq("conversationId", conversationId),
    )
    .unique();
}

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await requireUser(ctx, token);
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    const rows = [];
    for (const m of memberships) {
      const conv = await ctx.db.get(m.conversationId);
      if (!conv) {
        continue;
      }
      const members = await ctx.db
        .query("members")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conv._id),
        )
        .collect();

      let title = conv.name ?? "Chat";
      let emoji: string | null = conv.emoji ?? null;
      let avatarUrl: string | null = conv.avatarUrl ?? null;
      let otherUserId: Id<"users"> | null = null;
      if (conv.type === "dm") {
        const other = members.find((x) => x.userId !== me._id);
        if (other) {
          const otherUser = await ctx.db.get(other.userId);
          if (otherUser) {
            title = otherUser.displayName;
            otherUserId = otherUser._id;
            emoji = null;
            avatarUrl = otherUser.avatarUrl ?? null;
          }
        }
      }

      const unread = await ctx.db
        .query("messages")
        .withIndex("by_conversation_createdAt", (q) =>
          q.eq("conversationId", conv._id).gt("createdAt", m.lastReadAt),
        )
        .filter((q) => q.neq(q.field("senderId"), me._id))
        .collect();

      const now = Date.now();
      const typingMember = members.find(
        (x) => x.userId !== me._id && (x.typingAt ?? 0) > now - 4000,
      );
      let typingName: string | null = null;
      if (typingMember) {
        const typingUser = await ctx.db.get(typingMember.userId);
        typingName = typingUser ? typingUser.displayName : null;
      }

      rows.push({
        _id: conv._id,
        type: conv.type,
        title,
        emoji,
        avatarUrl,
        otherUserId,
        memberCount: members.length,
        lastMessageAt: conv.lastMessageAt ?? conv.createdAt,
        lastMessagePreview: conv.lastMessagePreview ?? "No messages yet",
        unreadCount: unread.length,
        typingName,
        muted: m.muted ?? false,
      });
    }

    rows.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return rows;
  },
});

export const get = query({
  args: { token: v.string(), conversationId: v.id("conversations") },
  handler: async (ctx, { token, conversationId }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (!membership) {
      return null;
    }
    const conv = await ctx.db.get(conversationId);
    if (!conv) {
      return null;
    }
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    const members = [];
    for (const mm of memberships) {
      const user = await ctx.db.get(mm.userId);
      if (user) {
        members.push({ ...publicUser(user), role: mm.role });
      }
    }
    let title = conv.name ?? "Chat";
    let emoji: string | null = conv.emoji ?? null;
    let avatarUrl: string | null = conv.avatarUrl ?? null;
    if (conv.type === "dm") {
      const other = members.find((x) => x._id !== me._id);
      if (other) {
        title = other.displayName;
        emoji = null;
        avatarUrl = other.avatarUrl ?? null;
      }
    }
    return {
      _id: conv._id,
      type: conv.type,
      title,
      emoji,
      avatarUrl,
      createdBy: conv.createdBy,
      members,
    };
  },
});

export const createDM = mutation({
  args: { token: v.string(), otherUserId: v.id("users") },
  handler: async (ctx, { token, otherUserId }) => {
    const me = await requireUser(ctx, token);
    if (otherUserId === me._id) {
      throw new ConvexError("You cannot start a chat with yourself");
    }
    const other = await ctx.db.get(otherUserId);
    if (!other) {
      throw new ConvexError("User not found");
    }
    const dmKey = [me._id, otherUserId].sort().join(":");
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_dmKey", (q) => q.eq("dmKey", dmKey))
      .unique();
    if (existing) {
      return existing._id;
    }
    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      type: "dm",
      dmKey,
      createdBy: me._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("members", {
      conversationId,
      userId: me._id,
      role: "member",
      joinedAt: now,
      lastReadAt: now,
    });
    await ctx.db.insert("members", {
      conversationId,
      userId: otherUserId,
      role: "member",
      joinedAt: now,
      lastReadAt: 0,
    });
    return conversationId;
  },
});

export const createGroup = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    emoji: v.optional(v.string()),
    memberIds: v.array(v.id("users")),
  },
  handler: async (ctx, { token, name, emoji, memberIds }) => {
    const me = await requireUser(ctx, token);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new ConvexError("Please give the group a name");
    }
    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      type: "group",
      name: trimmed,
      emoji: emoji ?? "💍",
      createdBy: me._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("members", {
      conversationId,
      userId: me._id,
      role: "owner",
      joinedAt: now,
      lastReadAt: now,
    });
    const unique = Array.from(new Set(memberIds)).filter((id) => id !== me._id);
    for (const uid of unique) {
      const user = await ctx.db.get(uid);
      if (!user) {
        continue;
      }
      await ctx.db.insert("members", {
        conversationId,
        userId: uid,
        role: "member",
        joinedAt: now,
        lastReadAt: 0,
      });
    }
    return conversationId;
  },
});

export const addMembers = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    memberIds: v.array(v.id("users")),
  },
  handler: async (ctx, { token, conversationId, memberIds }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (!membership) {
      throw new ConvexError("Not a member of this conversation");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("members")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    const existingIds = new Set(existing.map((m) => m.userId));
    for (const uid of Array.from(new Set(memberIds))) {
      if (existingIds.has(uid)) {
        continue;
      }
      const user = await ctx.db.get(uid);
      if (!user) {
        continue;
      }
      await ctx.db.insert("members", {
        conversationId,
        userId: uid,
        role: "member",
        joinedAt: now,
        lastReadAt: 0,
      });
    }
    return true;
  },
});

export const removeMember = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    userId: v.id("users"),
  },
  handler: async (ctx, { token, conversationId, userId }) => {
    const me = await requireUser(ctx, token);
    const mine = await membershipFor(ctx, conversationId, me._id);
    if (!mine || mine.role !== "owner") {
      throw new ConvexError("Only the group owner can remove members");
    }
    const target = await membershipFor(ctx, conversationId, userId);
    if (target) {
      await ctx.db.delete(target._id);
    }
    return true;
  },
});

export const updateGroup = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, { token, conversationId, name, avatarUrl }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (!membership || membership.role !== "owner") {
      throw new ConvexError("Only the group owner can edit the group");
    }
    if (name === undefined && avatarUrl === undefined) {
      throw new ConvexError("Nothing to update");
    }
    const patch: { name?: string; avatarUrl?: string; updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (name !== undefined) {
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 50) {
        throw new ConvexError("Enter a group name");
      }
      patch.name = trimmed;
    }
    if (avatarUrl !== undefined) {
      if (!avatarUrl.startsWith("http")) {
        throw new ConvexError("Invalid image");
      }
      patch.avatarUrl = avatarUrl;
    }
    await ctx.db.patch(conversationId, patch);
    return true;
  },
});

export const deleteGroup = mutation({
  args: { token: v.string(), conversationId: v.id("conversations") },
  handler: async (ctx, { token, conversationId }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (!membership || membership.role !== "owner") {
      throw new ConvexError("Only the group owner can delete the group");
    }
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();
    for (const message of messages) {
      const reactions = await ctx.db
        .query("reactions")
        .withIndex("by_message", (q) => q.eq("messageId", message._id))
        .collect();
      for (const reaction of reactions) {
        await ctx.db.delete(reaction._id);
      }
      await ctx.db.delete(message._id);
    }
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();
    for (const member of memberships) {
      await ctx.db.delete(member._id);
    }
    await ctx.db.delete(conversationId);
    return true;
  },
});

export const markRead = mutation({
  args: { token: v.string(), conversationId: v.id("conversations") },
  handler: async (ctx, { token, conversationId }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (membership) {
      await ctx.db.patch(membership._id, { lastReadAt: Date.now() });
    }
    return true;
  },
});

export const leave = mutation({
  args: { token: v.string(), conversationId: v.id("conversations") },
  handler: async (ctx, { token, conversationId }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (membership) {
      await ctx.db.delete(membership._id);
    }
    return true;
  },
});

export const setTyping = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    typing: v.boolean(),
  },
  handler: async (ctx, { token, conversationId, typing }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (membership) {
      await ctx.db.patch(membership._id, {
        typingAt: typing ? Date.now() : 0,
      });
    }
    return true;
  },
});

export const typing = query({
  args: { token: v.string(), conversationId: v.id("conversations") },
  handler: async (ctx, { token, conversationId }) => {
    const me = await requireUser(ctx, token);
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    const now = Date.now();
    const names: string[] = [];
    for (const member of memberships) {
      if (member.userId === me._id) {
        continue;
      }
      if ((member.typingAt ?? 0) > now - 4000) {
        const user = await ctx.db.get(member.userId);
        if (user) {
          names.push(user.displayName);
        }
      }
    }
    return names;
  },
});

export const setMuted = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    muted: v.boolean(),
  },
  handler: async (ctx, { token, conversationId, muted }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (membership) {
      await ctx.db.patch(membership._id, { muted });
    }
    return true;
  },
});

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

export const sharedContent = query({
  args: { token: v.string(), conversationId: v.id("conversations") },
  handler: async (ctx, { token, conversationId }) => {
    const me = await requireUser(ctx, token);
    const membership = await membershipFor(ctx, conversationId, me._id);
    if (!membership) {
      throw new ConvexError("Not a member of this conversation");
    }
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_conversation_createdAt", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .take(300);

    const photos: {
      _id: Id<"messages">;
      kind: "image" | "video";
      fileUrl: string | null;
      createdAt: number;
    }[] = [];
    const files: {
      _id: Id<"messages">;
      fileName: string | null;
      mimeType: string | null;
      size: number | null;
      fileUrl: string | null;
      createdAt: number;
    }[] = [];
    const links: {
      url: string;
      messageId: Id<"messages">;
      createdAt: number;
    }[] = [];
    const seenLinks = new Set<string>();

    for (const msg of recent) {
      if (msg.deletedAt) {
        continue;
      }
      if ((msg.kind === "image" || msg.kind === "video") && msg.storageId) {
        photos.push({
          _id: msg._id,
          kind: msg.kind,
          fileUrl: await ctx.storage.getUrl(msg.storageId),
          createdAt: msg.createdAt,
        });
      } else if (
        (msg.kind === "file" || msg.kind === "audio") &&
        msg.storageId
      ) {
        files.push({
          _id: msg._id,
          fileName: msg.fileName ?? null,
          mimeType: msg.mimeType ?? null,
          size: msg.size ?? null,
          fileUrl: await ctx.storage.getUrl(msg.storageId),
          createdAt: msg.createdAt,
        });
      }
      if (msg.kind === "text" && msg.body) {
        const matches = msg.body.match(URL_REGEX);
        if (matches) {
          for (const url of matches) {
            if (!seenLinks.has(url)) {
              seenLinks.add(url);
              links.push({ url, messageId: msg._id, createdAt: msg.createdAt });
            }
          }
        }
      }
    }

    return { photos, files, links };
  },
});
