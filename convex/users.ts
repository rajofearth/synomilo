import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
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
