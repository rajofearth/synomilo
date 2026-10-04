import {
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

type GitHubAsset = {
  name?: string;
  url?: string;
  size?: number;
};

type GitHubRelease = {
  tag_name?: string;
  body?: string | null;
  assets?: GitHubAsset[];
};

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

export const getCached = internalQuery({
  args: { version: v.string() },
  handler: async (ctx, { version }) => {
    return await ctx.db
      .query("updateCache")
      .withIndex("by_version", (q) => q.eq("version", version))
      .first();
  },
});

export const replaceCache = internalMutation({
  args: {
    version: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const stale = await ctx.db.query("updateCache").collect();
    for (const row of stale) {
      await ctx.db.delete(row._id);
      await ctx.storage.delete(row.storageId);
    }
    await ctx.db.insert("updateCache", {
      version: args.version,
      storageId: args.storageId,
      size: args.size,
      notes: args.notes,
      createdAt: Date.now(),
    });
  },
});

export const dropVersion = internalMutation({
  args: { version: v.string() },
  handler: async (ctx, { version }) => {
    const rows = await ctx.db
      .query("updateCache")
      .withIndex("by_version", (q) => q.eq("version", version))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
      await ctx.storage.delete(row.storageId);
    }
  },
});

export const check = action({
  args: { currentVersion: v.string() },
  handler: async (ctx, { currentVersion }) => {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    if (!token || !repo) {
      return null;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "synomilo-updater",
    };

    try {
      const releaseResponse = await fetch(
        `https://api.github.com/repos/${repo}/releases/latest`,
        { headers },
      );
      if (!releaseResponse.ok) {
        return null;
      }
      const release = (await releaseResponse.json()) as GitHubRelease;
      const version = (release.tag_name ?? "").replace(/^v/i, "").trim();
      if (!version || !isNewer(version, currentVersion)) {
        return null;
      }

      const notes = (release.body ?? "").slice(0, 500);
      const cached = await ctx.runQuery(internal.updates.getCached, {
        version,
      });
      if (cached) {
        const cachedUrl = await ctx.storage.getUrl(cached.storageId);
        if (cachedUrl) {
          return {
            version,
            notes: cached.notes ?? notes,
            url: cachedUrl,
            size: cached.size ?? 0,
          };
        }
        await ctx.runMutation(internal.updates.dropVersion, { version });
      }

      const asset = (release.assets ?? []).find((candidate) =>
        (candidate.name ?? "").toLowerCase().endsWith(".apk"),
      );
      if (!asset?.url) {
        return null;
      }

      const downloaded = await ctx.runAction(
        internal.updatesNode.downloadAndCache,
        {
          version,
          assetUrl: asset.url,
          notes,
        },
      );

      await ctx.runMutation(internal.updates.replaceCache, {
        version,
        storageId: downloaded.storageId,
        size: downloaded.size,
        notes,
      });

      const url = await ctx.storage.getUrl(downloaded.storageId);
      if (!url) {
        return null;
      }
      return { version, notes, url, size: downloaded.size };
    } catch (error) {
      console.error("update check failed", error);
      return null;
    }
  },
});
