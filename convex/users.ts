import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { publicUser, requireUser } from "./lib/helpers";

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await requireUser(ctx, token);
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u._id !== me._id)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(publicUser);
  },
});

export const setPushToken = mutation({
  args: { token: v.string(), pushToken: v.union(v.string(), v.null()) },
  handler: async (ctx, { token, pushToken }) => {
    const me = await requireUser(ctx, token);
    await ctx.db.patch(me._id, { pushToken: pushToken ?? undefined });
    return true;
  },
});

export const updateProfile = mutation({
  args: {
    token: v.string(),
    displayName: v.optional(v.string()),
    username: v.optional(v.string()),
  },
  handler: async (ctx, { token, displayName, username }) => {
    const me = await requireUser(ctx, token);
    const patch: { displayName?: string; username?: string } = {};

    if (displayName !== undefined) {
      const nextDisplayName = displayName.trim();
      if (nextDisplayName.length < 2 || nextDisplayName.length > 40) {
        throw new ConvexError("Display name must be 2 to 40 characters");
      }
      patch.displayName = nextDisplayName;
    }

    if (username !== undefined) {
      const nextUsername = username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(nextUsername)) {
        throw new ConvexError(
          "Username must be 3 to 20 characters using a-z, 0-9, _",
        );
      }
      const existing = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", nextUsername))
        .unique();
      if (existing && existing._id !== me._id) {
        throw new ConvexError("That username is taken");
      }
      patch.username = nextUsername;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(me._id, patch);
    }
    return publicUser((await ctx.db.get(me._id)) ?? me);
  },
});
