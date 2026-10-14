import { ConvexReactClient } from 'convex/react';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';

/**
 * Kept in lockstep with `src/config/convexConfig.ts` in the mobile app. The
 * harness talks to the SAME deployment as the phone - that is the whole point.
 */
export const CONVEX_URL = 'https://glad-capybara-533.convex.cloud';

export type QueryRef = FunctionReference<'query'>;
export type MutationRef = FunctionReference<'mutation'>;

/**
 * Hand-written stand-in for `convex/_generated/api`. The harness lives outside
 * the Convex project, so it has no generated types; every reference below is
 * resolved by string name against the deployment named above.
 */
export const api = {
  auth: {
    login: makeFunctionReference<'mutation'>('auth:login'),
    logout: makeFunctionReference<'mutation'>('auth:logout'),
    me: makeFunctionReference<'query'>('auth:me'),
  },
  users: {
    findByUsername: makeFunctionReference<'query'>('users:findByUsername'),
    list: makeFunctionReference<'query'>('users:list'),
  },
  conversations: {
    createDM: makeFunctionReference<'mutation'>('conversations:createDM'),
  },
  messages: {
    send: makeFunctionReference<'mutation'>('messages:send'),
    list: makeFunctionReference<'query'>('messages:list'),
  },
  calls: {
    start: makeFunctionReference<'mutation'>('calls:start'),
    signal: makeFunctionReference<'mutation'>('calls:signal'),
    signals: makeFunctionReference<'query'>('calls:signals'),
    consumeSignals: makeFunctionReference<'mutation'>('calls:consumeSignals'),
    accept: makeFunctionReference<'mutation'>('calls:accept'),
    reject: makeFunctionReference<'mutation'>('calls:reject'),
    end: makeFunctionReference<'mutation'>('calls:end'),
    incoming: makeFunctionReference<'query'>('calls:incoming'),
    get: makeFunctionReference<'query'>('calls:get'),
  },
} as const;

let client: ConvexReactClient | null = null;

/**
 * A single reactive client for the page. Created lazily so nothing touches the
 * network during the build.
 */
export function convexClient(): ConvexReactClient {
  if (!client) {
    client = new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false });
  }
  return client;
}

export function describeError(error: unknown): string {
  if (error === null || error === undefined) {
    return 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message || error.name;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Mirrors `src/utils/convexError.ts`. */
export function convexErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data: unknown = (error as unknown as { data?: unknown }).data;
    if (typeof data === 'string' && data.length > 0) {
      return data;
    }
  }
  if (error instanceof Error && error.message) {
    const match = error.message.match(/Uncaught (?:Convex)?Error: ([^\n]+)/);
    if (match && match[1]) {
      return match[1];
    }
    if (error.message.length > 0 && error.message.length < 220) {
      return error.message;
    }
  }
  return fallback;
}

export type PublicUser = {
  _id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: number;
};

export type FoundUser = PublicUser & { hasConversation: boolean };

export type SignalKind = 'offer' | 'answer' | 'ice';

export type SignalRow = {
  _id: string;
  kind: SignalKind;
  payload: string;
};

export type CallStatus = 'ringing' | 'active' | 'rejected' | 'missed' | 'ended';

export type CallInfo = {
  _id: string;
  type: 'audio' | 'video';
  status: CallStatus;
  createdAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  role: 'caller' | 'callee';
  peer: PublicUser | null;
  serverNow: number;
} | null;

export type IncomingCallRow = {
  _id: string;
  type: 'audio' | 'video';
  createdAt: number;
  caller: PublicUser | null;
} | null;

export type MessageRow = {
  _id: string;
  senderId: string;
  sender: PublicUser;
  kind: string;
  body: string | null;
  createdAt: number;
};

export type MessageListResult = {
  messages: MessageRow[];
  hasMore: boolean;
} | null;

export type LoginResult = { token: string; user: PublicUser };

export type AcceptResult =
  | { ok: true; answeredAt: number; serverNow: number }
  | { ok: false; reason: 'answered_elsewhere' }
  | { ok: false; reason: 'not_ringing'; status: CallStatus };
