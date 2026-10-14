import { CometChat } from "@cometchat/chat-sdk-react-native";
import { CometChatUIKit } from "@cometchat/chat-uikit-react-native";

/**
 * The Convex side and the CometChat side are two independent sessions, and they can
 * diverge: Convex can be up while CometChat is down. That divergence is invisible to the
 * user by default — every chat, group, file and reaction is served by Convex, so the app
 * looks perfectly healthy while voice and video are dead.
 *
 * `ensureCometChatSession` therefore REPORTS failure instead of swallowing it. Callers
 * surface it (the root navigator renders a banner); a half-logged-in user must never
 * discover it by dialling someone and getting nothing.
 */
export type CometChatSessionResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * The CometChat UID is the Convex username — normalised exactly the way
 * `convex/lib/helpers.ts#normalizeUsername` does it (trim + lowercase).
 *
 * This matters more than it looks. Calls and call history are keyed on the CometChat UID,
 * so a stray capital or a trailing space would silently fork the identity: a brand new
 * CometChat user with no call history and no contacts. Normalising here means the UID that
 * `login`/`register` were given is the UID CometChat gets, every time, on every device.
 */
function normalizeUid(uid: string): string {
  return uid.trim().toLowerCase();
}

let activeUid: string | null = null;

/**
 * In-flight `ensureCometChatSession` calls, keyed by UID.
 *
 * Without this the login screen and the `sessionUser` effect in App.tsx both call this for
 * the same user on the same tap, producing two concurrent `CometChatUIKit.login()` calls
 * for one identity — the SDK rejects the second and the session is left in an unknown state.
 */
const inFlight = new Map<string, Promise<CometChatSessionResult>>();

/**
 * Last failure, published so the UI can show a persistent, non-fatal warning. Cleared on
 * the next successful login, so the banner dismisses itself when CometChat recovers.
 */
let lastError: string | null = null;
const errorListeners = new Set<(error: string | null) => void>();

export function getCometChatSessionError(): string | null {
  return lastError;
}

export function subscribeCometChatSessionError(
  listener: (error: string | null) => void,
): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

function publishError(error: string | null) {
  if (lastError === error) {
    return;
  }
  lastError = error;
  errorListeners.forEach(listener => listener(error));
}

function describe(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return message || "unknown error";
}

async function establish(
  uid: string,
  displayName: string,
): Promise<CometChatSessionResult> {
  if (activeUid === uid && CometChatUIKit.loggedInUser) {
    return { ok: true };
  }
  // createUser fails harmlessly when the user already exists; anything else means the
  // CometChat identity genuinely does not exist yet and login is about to fail because of
  // it, so the reason is kept and folded into the reported failure.
  let createReason: string | null = null;
  try {
    await CometChatUIKit.createUser(
      new CometChat.User({ uid, name: displayName }),
    );
  } catch (error: unknown) {
    createReason = describe(error);
    console.log("[CometChat] createUser did not succeed:", createReason);
  }
  try {
    await CometChatUIKit.login({ uid });
  } catch (error: unknown) {
    const reason = describe(error);
    console.log("[CometChat] login failed:", reason);
    publishError(
      `Signed in, but calls are unavailable (${reason}). Chat and messages still work.`,
    );
    return { ok: false, reason: createReason ?? reason };
  }
  activeUid = uid;
  publishError(null);
  return { ok: true };
}

export function ensureCometChatSession(
  uid: string,
  displayName: string,
): Promise<CometChatSessionResult> {
  const key = normalizeUid(uid);
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const request = establish(key, displayName)
    .catch((error: unknown) => {
      console.log("[CometChat] background session failed", error);
      return { ok: false, reason: describe(error) } as CometChatSessionResult;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/**
 * Tear the CometChat session down on sign-out so the next login starts clean.
 *
 * `CometChatUIKit.logout()` is tried first (it clears the UIKit's cached login too), with
 * a direct `CometChat.logout()` behind it: if the UIKit wrapper rejects, the raw SDK session
 * would otherwise survive and the next `login({uid})` could be rejected as "already
 * logged in".
 *
 * Never rejects — a failure here must not block sign-out.
 */
export function clearCometChatSession(): Promise<unknown> {
  activeUid = null;
  inFlight.clear();
  publishError(null);
  const sdkLogout = () => CometChat.logout();
  return Promise.resolve()
    .then(() => CometChatUIKit.logout())
    .catch((error: unknown) => {
      console.log("[CometChat] UIKit logout failed, falling back to SDK:", error);
      return sdkLogout();
    })
    .catch((error: unknown) => {
      console.log("[CometChat] logout failed:", error);
      return undefined;
    });
}