import { mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireUser } from "./lib/helpers";

export const toggle = mutation({
  args: {
    token: v.string(),
    messageId: v.id("messages"),
    emoji: v.string(),
  },
  handler: async (ctx, { token, messageId, emoji }) => {
    const me = await requireUser(ctx, token);
    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new ConvexError("Message not found");
    }
    const membership = await ctx.db
      .query("members")
      .withIndex("by_user_conversation", (q) =>
        q.eq("userId", me._id).eq("conversationId", message.conversationId),
      )
      .unique();
    if (!membership) {
      throw new ConvexError("Not a member of this conversation");
    }

    const mine = await ctx.db
      .query("reactions")
      .withIndex("by_message_user", (q) =>
        q.eq("messageId", messageId).eq("userId", me._id),
      )
      .collect();
    const same = mine.find((r) => r.emoji === emoji);
    for (const reaction of mine) {
      await ctx.db.delete(reaction._id);
    }
    if (!same) {
      await ctx.db.insert("reactions", {
        messageId,
        userId: me._id,
        emoji: emoji.slice(0, 8),
        createdAt: Date.now(),
      });
      return emoji;
    }
    return null;
  },
});
