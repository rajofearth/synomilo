import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { requireUser } from "./lib/helpers";

function parseVersion(value: string): [number, number, number] | null {
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function isNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (next[index] > now[index]) {
      return true;
    }
    if (next[index] < now[index]) {
      return false;
    }
  }
  return false;
}

export const publish = mutation({
  args: {
    token: v.string(),
    version: v.string(),
    notes: v.optional(v.string()),
    storageId: v.id("_storage"),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx, args.token);
    if (me.username !== "yashraj") {
      throw new ConvexError("Only the maintainer can publish updates");
    }
    const version = args.version.replace(/^v/i, "").trim();
    if (!parseVersion(version)) {
      throw new ConvexError("Version must look like 1.0.0");
    }
    const stale = await ctx.db.query("updateCache").collect();
    for (const row of stale) {
      await ctx.db.delete(row._id);
      await ctx.storage.delete(row.storageId);
    }
    await ctx.db.insert("updateCache", {
      version,
      storageId: args.storageId,
      size: args.size ?? 0,
      notes: args.notes ?? "",
      createdAt: Date.now(),
    });
    return version;
  },
});

export const getLatest = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("updateCache").order("desc").first();
  },
});

export const removePublished = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("updateCache").collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
      await ctx.storage.delete(row.storageId);
    }
  },
});

export const check = action({
  args: { currentVersion: v.string() },
  handler: async (ctx, { currentVersion }) => {
    const latest = await ctx.runQuery(internal.updates.getLatest, {});
    if (!latest) {
      return null;
    }
    if (!isNewer(latest.version, currentVersion)) {
      return null;
    }
    const url = await ctx.storage.getUrl(latest.storageId);
    if (!url) {
      return null;
    }
    return {
      version: latest.version,
      notes: latest.notes ?? "",
      url,
      size: latest.size ?? 0,
    };
  },
});
