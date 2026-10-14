import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConvexHttpClient } from 'convex/browser';
import { CONVEX_URL } from '../config/convexConfig';

export const TOKEN_KEY = 'synomilo.convex.token';

let client: ConvexHttpClient | null = null;

/**
 * One Convex client for the whole headless context.
 *
 * `background.ts` used to construct a `ConvexHttpClient` per notification action.
 * Every one of those opens a fresh websocket and a fresh TLS handshake inside a
 * Notifee headless task with a ~60s budget, and a TLS handshake on a cold radio is
 * the single most likely reason an action press silently did nothing.
 */
export function headlessConvexClient(): ConvexHttpClient {
  if (!client) {
    client = new ConvexHttpClient(CONVEX_URL, {
      skipConvexDeploymentUrlCheck: true,
    });
  }
  return client;
}

export async function readSessionToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch (error) {
    console.log('[push] headless token read failed', error);
    return null;
  }
}