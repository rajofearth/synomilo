import { action } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireUser } from "./lib/helpers";

/**
 * LiveKit access-token minting.
 *
 * LiveKit is an OPTIONAL media plane. The app's 1:1 calling already works
 * peer-to-peer over Convex's own `callSignals` table (SDP + ICE), which is
 * what `WebRTCCallScreen.tsx` uses today. This action exists so a client can
 * instead join a LiveKit room, which adds an SFU, automatic reconnect and
 * bandwidth adaptation, and works identically on React Native and the web.
 *
 * Convex stays authoritative: it owns who is calling whom and when. LiveKit
 * only moves media. The room name is derived from the Convex call id, so a
 * client cannot mint a token for an arbitrary room or an arbitrary identity.
 *
 * Credentials come from deployment env vars (LIVEKIT_URL / LIVEKIT_API_KEY /
 * LIVEKIT_API_SECRET). They are NEVER hardcoded and never returned to clients
 * beyond the short-lived, room-scoped access token.
 */

declare const process: { env: Record<string, string | undefined> };

const TOKEN_TTL_SECONDS = 10 * 60;

function livekitConfig() {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new ConvexError(
      "LiveKit is not configured on this deployment. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET, or use the built-in peer-to-peer calling.",
    );
  }
  return { url, apiKey, apiSecret };
}

export const mintToken = action({
  args: { token: v.string(), callId: v.string() },
  handler: async (
    ctx,
    { token, callId },
  ): Promise<{
    token: string;
    serverUrl: string;
    roomName: string;
    identity: string;
    serverNow: number;
  }> => {
    const me = await requireUser(ctx, token);
    const { url, apiKey, apiSecret } = livekitConfig();

    // Dynamic import keeps the SDK out of the client bundle and out of the
    // module graph for every user who never places a call.
    const serverSdk: any = await import("livekit-server-sdk");
    const AccessToken =
      serverSdk.AccessToken ?? serverSdk.default?.AccessToken;

    // Room name is server-derived, never client-supplied.
    const roomName = `call-${callId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    const access = new AccessToken(apiKey, apiSecret, {
      identity: me._id,
      name: me.displayName,
      ttl: `${TOKEN_TTL_SECONDS}s`,
      metadata: JSON.stringify({
        username: me.username,
        avatarUrl: me.avatarUrl ?? null,
      }),
    });
    access.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return {
      token: await access.toJwt(),
      serverUrl: url,
      roomName,
      identity: me._id,
      // Lets the client correct for the difference between this server's clock
      // and the device's, which is what call duration is derived from.
      serverNow: Date.now(),
    };
  },
});
