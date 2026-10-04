import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    username: v.string(),
    displayName: v.string(),
    passwordHash: v.string(),
    salt: v.string(),
    avatarUrl: v.optional(v.string()),
    pushToken: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_username", ["username"]),

  sessions: defineTable({
    token: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

  conversations: defineTable({
    type: v.union(v.literal("dm"), v.literal("group")),
    name: v.optional(v.string()),
    emoji: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    dmKey: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.optional(v.number()),
    lastMessagePreview: v.optional(v.string()),
    lastMessageSender: v.optional(v.id("users")),
  })
    .index("by_dmKey", ["dmKey"])
    .index("by_updatedAt", ["updatedAt"]),

  members: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    joinedAt: v.number(),
    lastReadAt: v.number(),
    typingAt: v.optional(v.number()),
    muted: v.optional(v.boolean()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"])
    .index("by_user_conversation", ["userId", "conversationId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    kind: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("video"),
      v.literal("audio"),
      v.literal("file"),
    ),
    body: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    replyToId: v.optional(v.id("messages")),
    forwardedFrom: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_conversation_createdAt", ["conversationId", "createdAt"]),

  reactions: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
    createdAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user", ["messageId", "userId"]),

  calls: defineTable({
    callerId: v.id("users"),
    calleeId: v.id("users"),
    type: v.union(v.literal("audio"), v.literal("video")),
    status: v.union(
      v.literal("ringing"),
      v.literal("active"),
      v.literal("rejected"),
      v.literal("missed"),
      v.literal("ended"),
    ),
    createdAt: v.number(),
    answeredAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
  })
    .index("by_callee_status", ["calleeId", "status"])
    .index("by_caller", ["callerId"])
    .index("by_callee", ["calleeId"]),

  callSignals: defineTable({
    callId: v.id("calls"),
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    kind: v.union(
      v.literal("offer"),
      v.literal("answer"),
      v.literal("ice"),
    ),
    payload: v.string(),
    createdAt: v.number(),
  }).index("by_call_to", ["callId", "toUserId"]),

  updateCache: defineTable({
    version: v.string(),
    storageId: v.id("_storage"),
    size: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_version", ["version"]),
});
