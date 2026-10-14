import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  normalizeUsername,
  publicUser,
  pushTokensForUser,
  removePushTokenForUser,
  requireUser,
  upsertPushToken,
} from "./lib/helpers";

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

/**
 * Exact-username lookup, for the add-contact screen.
 *
 * The app used to ship a full directory (`users.list`) plus a client-side
 * filter. It is now one screen with one text field, so the whole directory
 * only ever had one reader. This replaces it.
 *
 * Deliberately NOT a prefix search: a prefix search has to be answered by
 * scanning, and the result set is "every account that has ever registered".
 * `by_username` is an index lookup on an exact value, so this stays O(1) and
 * caps at one row.
 *
 * The return value is deliberately uninformative: `null` means "no such
 * other user", full stop. It does not distinguish "does not exist" from
 * "exists but is you" from "exists but the session expired", because that
 * turns this into an account-enumeration oracle for anyone with a valid
 * token. The client already knows its own username and can say "that is you"
 * without asking.
 *
 * `hasConversation` is a read, not a write: `createDM` is idempotent on
 * `dmKey`, so the client calls it on both branches and this only decides the
 * label on the button ("Message" vs "Start chat").
 */
export const findByUsername = query({
  args: { token: v.string(), username: v.string() },
  handler: async (ctx, { token, username }) => {
    const me = await requireUser(ctx, token);
    const normalized = normalizeUsername(username);
    // Anything this short is a typo or an empty field, not a search.
    if (normalized.length < 2) {
      return null;
    }
    // Self-match: `null`, for the same reason as "not found" above.
    if (normalized === normalizeUsername(me.username)) {
      return null;
    }
    const match = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .first();
    if (!match || match._id === me._id) {
      return null;
    }
    // Mirrors `createDM`'s key exactly, so "already have a DM with this person"
    // and "opening that DM" cannot disagree.
    const dmKey = [me._id, match._id].sort().join(":");
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_dmKey", (q) => q.eq("dmKey", dmKey))
      .unique();
    return {
      ...publicUser(match),
      hasConversation: existing !== null,
    };
  },
});

/**
 * Register or clear this device's push token.
 *
 * Writes to the `pushTokens` table rather than the single `users.pushToken`
 * scalar, which was last-write-wins: signing in on a second device silently
 * unregistered the first, and that device stopped receiving calls forever.
 *
 * `platform` defaults to android because the existing RN client does not send
 * it; it exists so the web app can register its own token unambiguously.
 */
export const setPushToken = mutation({
  args: {
    token: v.string(),
    pushToken: v.union(v.string(), v.null()),
    platform: v.optional(
      v.union(v.literal("android"), v.literal("ios"), v.literal("web")),
    ),
  },
  handler: async (ctx, { token, pushToken, platform }) => {
    const me = await requireUser(ctx, token);
    if (pushToken === null || pushToken === "") {
      await removePushTokenForUser(ctx, me._id);
      await ctx.db.patch(me._id, { pushToken: undefined });
      return { registered: 0 };
    }
    await upsertPushToken(ctx, me._id, pushToken, platform ?? "android");
    // Keep the scalar in sync for anything still reading it.
    await ctx.db.patch(me._id, { pushToken });
    const rows = await pushTokensForUser(ctx, me._id);
    return { registered: rows.length };
  },
});

export const updateProfile = mutation({
  args: {
    token: v.string(),
    displayName: v.optional(v.string()),
    username: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, { token, displayName, username, avatarUrl }) => {
    const me = await requireUser(ctx, token);
    const patch: {
      displayName?: string;
      username?: string;
      avatarUrl?: string;
    } = {};

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

    if (avatarUrl !== undefined) {
      if (!avatarUrl.startsWith("http")) {
        throw new ConvexError("Invalid image");
      }
      patch.avatarUrl = avatarUrl;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(me._id, patch);
    }
    return publicUser((await ctx.db.get(me._id)) ?? me);
  },
});
