import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

declare const crypto: {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
};

declare const process: { env: Record<string, string | undefined> };

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

/**
 * Every enabled push token across all of a user's signed-in devices.
 *
 * Replaces reading the single `users.pushToken` scalar, which was
 * last-write-wins: signing in on a tablet unregistered the phone.
 */
export async function pushTokensForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Doc<"users">["_id"],
): Promise<string[]> {
  const rows = await ctx.db
    .query("pushTokens")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.filter((row) => row.enabled !== false).map((row) => row.token);
}

/**
 * Register (or refresh) a device's push token. Idempotent on token, so a
 * rotating FCM token replaces itself instead of accumulating dead rows.
 */
export async function upsertPushToken(
  ctx: MutationCtx,
  userId: Doc<"users">["_id"],
  token: string,
  platform: "android" | "ios" | "web",
): Promise<void> {
  const existing = await ctx.db
    .query("pushTokens")
    .withIndex("by_token", (q) => q.eq("token", token))
    .collect();
  const now = Date.now();
  for (const row of existing) {
    if (row.userId === userId) {
      await ctx.db.patch(row._id, { platform, enabled: true, lastSeenAt: now });
      return;
    }
    // Token was reassigned to a different account - drop the stale claim.
    await ctx.db.delete(row._id);
  }
  await ctx.db.insert("pushTokens", {
    userId,
    token,
    platform,
    enabled: true,
    lastSeenAt: now,
  });
}

/** Remove a device's token on sign-out so the next user does not inherit it. */
export async function removePushTokenForUser(
  ctx: MutationCtx,
  userId: Doc<"users">["_id"],
): Promise<void> {
  const rows = await ctx.db
    .query("pushTokens")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Maintainer usernames, from the `MAINTAINER_USERS` deployment env var
 * (comma-separated). Anything in this list may publish app updates.
 *
 * These usernames are also RESERVED: `auth.register` refuses to create an
 * account with one of them. Previously `updates.publish` gated on a hardcoded
 * username string while registration happily let anyone claim that name, which
 * meant a self-registered account could push an APK to every install.
 */
export function maintainerUsernames(): string[] {
  const raw =
    typeof process !== "undefined" && process.env
      ? (process.env.MAINTAINER_USERS ?? "")
      : "";
  return raw
    .split(",")
    .map((value: string) => normalizeUsername(value))
    .filter((value: string) => value.length > 0);
}

export function isMaintainer(username: string): boolean {
  return maintainerUsernames().includes(normalizeUsername(username));
}

export function validateUsername(username: string): boolean {
  return /^[a-z0-9_.-]{3,32}$/.test(username);
}

/**
 * Membership lookup shared by every function that must prove the caller belongs
 * to a conversation before reading or mutating its contents.
 */
export async function membershipForConversation(
  ctx: QueryCtx | MutationCtx,
  conversationId: unknown,
  userId: Doc<"users">["_id"],
) {
  const rows = await ctx.db
    .query("members")
    .withIndex("by_user_conversation", (q) =>
      q.eq("userId", userId).eq("conversationId", conversationId as never),
    )
    .unique();
  return rows ?? null;
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
