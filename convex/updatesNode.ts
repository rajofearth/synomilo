"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

export const downloadAndCache = internalAction({
  args: {
    version: v.string(),
    assetUrl: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { assetUrl }) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN is not set on this deployment");
    }

    const response = await fetch(assetUrl, {
      headers: {
        Accept: "application/octet-stream",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`asset download failed with status ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const storageId = await ctx.storage.store(
      new Blob([buffer], {
        type: "application/vnd.android.package-archive",
      }),
    );

    return { storageId, size: buffer.byteLength };
  },
});
