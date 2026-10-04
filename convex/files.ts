import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/helpers";

export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireUser(ctx, token);
    return await ctx.storage.generateUploadUrl();
  },
});
