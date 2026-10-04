import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/helpers";

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
    await requireUser(ctx, token);
    return await ctx.storage.getUrl(storageId);
  },
});
