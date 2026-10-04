"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

let messagingSingleton: any = null;

async function getMessaging(): Promise<any> {
  if (messagingSingleton) {
    return messagingSingleton;
  }
  const appModule: any = await import("firebase-admin/app");
  const appApi = appModule.default ?? appModule;
  const messagingModule: any = await import("firebase-admin/messaging");
  const messagingApi = messagingModule.default ?? messagingModule;
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("FCM_SERVICE_ACCOUNT is not set on this deployment");
  }
  const serviceAccount = JSON.parse(raw);
  const app =
    appApi.getApps().length > 0
      ? appApi.getApp()
      : appApi.initializeApp({ credential: appApi.cert(serviceAccount) });
  messagingSingleton = messagingApi.getMessaging(app);
  return messagingSingleton;
}

export const sendToTokens = internalAction({
  args: {
    tokens: v.array(v.string()),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.record(v.string(), v.string())),
    tag: v.optional(v.string()),
    channelId: v.optional(v.string()),
  },
  handler: async (_ctx, { tokens, title, body, data, tag, channelId }) => {
    if (tokens.length === 0) {
      return { sent: 0 };
    }
    const messaging = await getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: data ?? {},
      android: {
        priority: "high",
        ttl: 86400000,
        notification: {
          channelId: channelId ?? "default",
          sound: "default",
          ...(tag !== undefined ? { tag } : {}),
        },
      },
      apns: {
        payload: { aps: { sound: "default" } },
      },
    });
    const failures = response.responses
      .map((entry: any, index: number) =>
        entry.success
          ? null
          : `${tokens[index].slice(0, 14)}: ${entry.error?.code ?? "unknown"}`,
      )
      .filter(Boolean);
    if (failures.length > 0) {
      console.error("push failures", failures);
    }
    return { sent: response.successCount, failed: failures.length };
  },
});

/**
 * Sends a data-only, high-priority message. Used for incoming calls so the
 * app can display a full-screen ringing notification with actions.
 */
export const sendDataToTokens = internalAction({
  args: {
    tokens: v.array(v.string()),
    data: v.record(v.string(), v.string()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (_ctx, { tokens, data, ttlMs }) => {
    if (tokens.length === 0) {
      return { sent: 0 };
    }
    const messaging = await getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      data,
      android: { priority: "high", ttl: ttlMs ?? 60000 },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { contentAvailable: true } },
      },
    });
    return { sent: response.successCount };
  },
});
