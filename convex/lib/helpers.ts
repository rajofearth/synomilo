import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

declare const crypto: {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
};

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"users">> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!session) {
    throw new ConvexError("Your session has expired. Please log in again.");
  }
  const user = await ctx.db.get(session.userId);
  if (!user) {
    throw new ConvexError("User not found");
  }
  const now = Date.now();
  if (now - session.lastSeenAt > 30000 && "patch" in ctx.db) {
    await (ctx.db as MutationCtx["db"]).patch(session._id, {
      lastSeenAt: now,
    });
  }
  return user;
}

export function publicUser(user: Doc<"users">) {
  return {
    _id: user._id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
  };
}

export function genToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function genSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(username: string): boolean {
  return /^[a-z0-9_.-]{3,32}$/.test(username);
}

export function previewFor(
  kind: "text" | "image" | "video" | "audio" | "file",
  body: string | undefined,
  senderName: string,
): string {
  if (kind === "text") {
    return `${senderName}: ${(body ?? "").slice(0, 120)}`;
  }
  const label =
    kind === "image"
      ? "Photo"
      : kind === "video"
        ? "Video"
        : kind === "audio"
          ? "Voice message"
          : "File";
  return `${senderName}: ${label}`;
}
