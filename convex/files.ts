import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireUser, membershipForConversation } from "./lib/helpers";

export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireUser(ctx, token);
    return await ctx.storage.generateUploadUrl();
  },
});

export const url = query({
  args: { token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { token, storageId }) => {
    const me = await requireUser(ctx, token);

    // A blob id is not a capability. Without this check any authenticated user
    // could read any attachment in the deployment by guessing/harvesting ids.
    // Access is granted only if the blob is attached to a message in a
    // conversation the caller is a member of.
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .collect();

    if (messages.length === 0) {
      throw new ConvexError("Not found");
    }

    let allowed = false;
    for (const message of messages) {
      const membership = await membershipForConversation(
        ctx,
        message.conversationId,
        me._id,
      );
      if (membership) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      throw new ConvexError("Not found");
    }

    return await ctx.storage.getUrl(storageId);
  },
});
