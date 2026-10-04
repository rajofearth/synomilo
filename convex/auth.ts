import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

declare const TextEncoder: new () => { encode(input?: string): Uint8Array };
import {
  genSalt,
  genToken,
  normalizeUsername,
  publicUser,
  requireUser,
  validateUsername,
} from "./lib/helpers";

const WEB_CRYPTO_ITERATIONS = 210000;
const FALLBACK_ITERATIONS = 20000;
const KEYLEN = 32;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const subtle = (globalThis as any).crypto?.subtle;
  if (subtle?.importKey && subtle?.deriveBits) {
    const key = await subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: encoder.encode(salt),
        iterations: WEB_CRYPTO_ITERATIONS,
      },
      key,
      KEYLEN * 8,
    );
    return toHex(new Uint8Array(bits));
  }
  const derived = pbkdf2(sha256, password, salt, {
    c: FALLBACK_ITERATIONS,
    dkLen: KEYLEN,
  });
  return toHex(derived);
}

async function createSession(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const token = genToken();
  const now = Date.now();
  await ctx.db.insert("sessions", {
    token,
    userId,
    createdAt: now,
    lastSeenAt: now,
  });
  return token;
}

export const register = mutation({
  args: {
    username: v.string(),
    password: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { username, password, displayName }) => {
    const normalized = normalizeUsername(username);
    if (!validateUsername(normalized)) {
      throw new ConvexError(
        "Username must be 3-32 characters: letters, numbers, dots, dashes or underscores",
      );
    }
    if (password.length < 6) {
      throw new ConvexError("Password must be at least 6 characters");
    }
    const name = displayName.trim();
    if (name.length < 2) {
      throw new ConvexError("Please enter your full name");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();
    if (existing) {
      throw new ConvexError("That username is taken. Try another one.");
    }

    const salt = genSalt();
    const passwordHash = await hashPassword(password, salt);
    const userId = await ctx.db.insert("users", {
      username: normalized,
      displayName: name,
      passwordHash,
      salt,
      createdAt: Date.now(),
    });
    const token = await createSession(ctx, userId);
    const user = await ctx.db.get(userId);
    return { token, user: publicUser(user!) };
  },
});

export const login = mutation({
  args: {
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, { username, password }) => {
    const normalized = normalizeUsername(username);
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();
    if (!user) {
      throw new ConvexError("No account found with that username.");
    }
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      throw new ConvexError("Incorrect password. Try again.");
    }
    const token = await createSession(ctx, user._id);
    return { token, user: publicUser(user) };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (session) {
      await ctx.db.delete(session._id);
    }
    return true;
  },
});

export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!session) {
      return null;
    }
    const user = await ctx.db.get(session.userId);
    if (!user) {
      return null;
    }
    return publicUser(user);
  },
});

export const updateProfile = mutation({
  args: {
    token: v.string(),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, { token, displayName, avatarUrl }) => {
    const user = await requireUser(ctx, token);
    const patch: Record<string, unknown> = {};
    if (displayName !== undefined) {
      const name = displayName.trim();
      if (name.length < 2) {
        throw new ConvexError("Please enter your full name");
      }
      patch.displayName = name;
    }
    if (avatarUrl !== undefined) {
      patch.avatarUrl = avatarUrl;
    }
    await ctx.db.patch(user._id, patch);
    const updated = await ctx.db.get(user._id);
    return publicUser(updated!);
  },
});
