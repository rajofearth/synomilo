import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { resetToLogin } from "../navigation/NavigationService";
import { readPersisted, removePersisted, writePersisted } from "../security/secureStore";

/**
 * ------------------------------------------------------------------------
 * SESSION TOKEN STORAGE
 * ------------------------------------------------------------------------
 *
 * These three keys hold a bearer credential - whoever presents the token *is* the
 * user, with no second factor - and they used to live in plaintext AsyncStorage,
 * which on Android is an unencrypted SQLite file in the app sandbox, readable by
 * root and by `adb backup`.
 *
 * They now go through `src/security/secureStore.ts`, which reads and writes the
 * encrypted store on Android and migrates any value still sitting in AsyncStorage
 * on first read. This is the ONLY change made to this file's behaviour: the TTL
 * policy, the validation timeout, the offline revocation queue and the
 * sign-out-teardown ordering are all untouched.
 *
 * The migration is deliberately write-then-verify-then-delete, so a keystore
 * write that does not land leaves the plaintext copy in place - the pre-existing
 * state - rather than losing the session. See `readPersisted` for the full
 * ordering and its one accepted failure mode (a Keystore entry lost *after* a
 * successful migration logs the user out; it never locks them out).
 *
 * On iOS there is no `SecureStore` native module, so `readPersisted` /
 * `writePersisted` / `removePersisted` are plain AsyncStorage wrappers and the
 * session behaves exactly as before.
 */
const TOKEN_KEY = "synomilo.convex.token";
const TOKEN_ISSUED_AT_KEY = "synomilo.convex.token.issuedAt";
const PENDING_REVOCATION_KEY = "synomilo.convex.pendingRevocation";

/**
 * `sessions` has no `expiresAt` and nothing ever sweeps the table
 * (`convex/schema.ts:15-22`), so a token minted once stays valid for the lifetime of the
 * deployment. That is a server-side gap and convex/ is not this module's to change — but
 * the client can still refuse to keep handing it out forever.
 *
 * 30 days is long enough that nobody is logged out mid-workflow and short enough that a
 * token lifted off a lost or backed-up device stops working on its own.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long to wait for `api.auth.me` to answer before deciding the stored token is not a
 * usable session.
 *
 * This is what makes the "don't render children until the token is validated" gate
 * terminate: without it, an unreachable Convex deployment leaves `isLoading` true forever
 * and the app shows a blank screen instead of a login screen.
 */
const VALIDATION_TIMEOUT_MS = 10_000;

export type SessionUser = {
  _id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: number;
};

type SessionContextValue = {
  token: string | null;
  user: SessionUser | null;
  isLoading: boolean;
  /**
   * A one-shot, user-facing explanation of why the previous session ended. The login screen
   * consumes it, so "your session expired" is something the user is actually told rather
   * than something they infer from being dumped back at the login form.
   */
  notice: string | null;
  dismissNotice: () => void;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue>({
  token: null,
  user: null,
  isLoading: true,
  notice: null,
  dismissNotice: () => {},
  signIn: async () => {},
  signOut: async () => {},
});

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setToken] = useState<string | null>(null);
  /**
   * True only once the encrypted store has been read AND any stored token has cleared the TTL
   * check. Children are not rendered before this, which is the whole point: an
   * already-signed-in user must never see the login screen flash while the token is being
   * validated against Convex.
   */
  const [restoreComplete, setRestoreComplete] = useState(false);
  /**
   * The token this client minted itself in `signIn`, and which has therefore not been
   * validated yet.
   *
   * Without this, `signIn` flips `!!token` from false to true, `isLoading` flips to true,
   * and App.tsx tears down the entire tree — NavigationContainer included — while the
   * login handler is still awaiting. The subsequent `reset()` then lands on an unmounted
   * ref and the app lands on a blank screen. Trusting the token we just obtained from the
   * server keeps the tree mounted across the hand-off.
   */
  const [locallyAcceptedToken, setLocallyAcceptedToken] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const logoutMutation = useMutation(api.auth.logout);
  const signingOutRef = useRef(false);

  /**
   * Best-effort server-side revocation.
   *
   * Sessions have no server-side TTL, so if the device is offline when the user signs out
   * the `sessions` row survives and that token stays valid FOREVER. Dropping it on the
   * floor is the bug; queueing it is the fix — the next time a mutation succeeds, the
   * revocation lands. Local state is cleared either way: an unusable device must still be
   * able to sign out.
   */
  const flushPendingRevocations = useCallback(async () => {
    let pending: string | null = null;
    try {
      pending = await readPersisted(PENDING_REVOCATION_KEY);
    } catch {
      return;
    }
    if (!pending) {
      return;
    }
    try {
      await logoutMutation({ token: pending });
      await removePersisted([PENDING_REVOCATION_KEY]).catch(() => {});
    } catch {
      // Still offline — retried on the next successful call.
    }
  }, [logoutMutation]);

  const revokeToken = useCallback(
    async (tokenToRevoke: string) => {
      try {
        await logoutMutation({ token: tokenToRevoke });
      } catch {
        await writePersisted({ [PENDING_REVOCATION_KEY]: tokenToRevoke }).catch(
          () => {},
        );
      }
    },
    [logoutMutation],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let restored: string | null = null;
      let issuedAt = 0;
      try {
        const [storedToken, storedIssuedAt] = await Promise.all([
          readPersisted(TOKEN_KEY),
          readPersisted(TOKEN_ISSUED_AT_KEY),
        ]);
        restored = storedToken && storedToken.length > 0 ? storedToken : null;
        issuedAt = storedIssuedAt ? Number(storedIssuedAt) : 0;
      } catch {
        restored = null;
      }
      if (cancelled) {
        return;
      }

      if (restored) {
        if (!issuedAt || !Number.isFinite(issuedAt)) {
          // Installed before the TTL existed, so the age is unknowable. Stamp it now rather
          // than signing every existing user out on upgrade.
          await writePersisted({ [TOKEN_ISSUED_AT_KEY]: String(Date.now()) }).catch(
            () => {},
          );
        } else if (Date.now() - issuedAt > SESSION_TTL_MS) {
          await removePersisted([TOKEN_KEY, TOKEN_ISSUED_AT_KEY]).catch(() => {});
          await revokeToken(restored);
          restored = null;
          setNotice("Your session expired after 30 days. Please log in again.");
        }
      }
      if (cancelled) {
        return;
      }
      setToken(restored);
      setRestoreComplete(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [revokeToken]);

  const me = useQuery(api.auth.me, token ? { token } : "skip");

  // Retry any revocation that could not be delivered while the device was offline.
  useEffect(() => {
    if (me !== undefined) {
      flushPendingRevocations();
    }
  }, [me, flushPendingRevocations]);

  /**
   * The server rejected the stored token — the row was deleted, or logout happened on
   * another device. Wipe it locally and tell the user why they are back at the login form.
   */
  useEffect(() => {
    if (token && me === null) {
      removePersisted([TOKEN_KEY, TOKEN_ISSUED_AT_KEY]).catch(() => {});
      setToken(null);
      setLocallyAcceptedToken(null);
      setNotice("Your session has ended. Please log in again.");
    }
  }, [token, me]);

  /**
   * `me` stuck at `undefined` means Convex has not answered. Past the timeout the token is
   * treated as unusable and the user is asked to sign in again — fail closed, rather than
   * sitting on a blank screen or worse, rendering authenticated UI against a session that
   * cannot be verified.
   */
  useEffect(() => {
    if (!token || me !== undefined) {
      return;
    }
    const timer = setTimeout(() => {
      removePersisted([TOKEN_KEY, TOKEN_ISSUED_AT_KEY]).catch(() => {});
      setToken(null);
      setLocallyAcceptedToken(null);
      setNotice(
        "We could not verify your session. Please check your connection and log in again.",
      );
      resetToLogin();
    }, VALIDATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [token, me]);

  const signIn = useCallback(async (nextToken: string) => {
    const issuedAt = Date.now();
    await writePersisted({
      [TOKEN_KEY]: nextToken,
      [TOKEN_ISSUED_AT_KEY]: String(issuedAt),
    });
    setNotice(null);
    // Same tick, so the tree is never torn down mid-login.
    setLocallyAcceptedToken(nextToken);
    setToken(nextToken);
    flushPendingRevocations();
  }, [flushPendingRevocations]);

  const signOut = useCallback(async () => {
    if (signingOutRef.current) {
      return;
    }
    signingOutRef.current = true;
    const currentToken = token;
    try {
      // 1. Leave the authenticated UI first. The token is cleared synchronously in the
      //    same batch as `resetToLogin()`, so `isLoading` stays false and the navigator is
      //    still mounted when the reset lands. Not awaiting it is deliberate: the user
      //    must not watch a spinner while a network call decides where to take them.
      setToken(null);
      setLocallyAcceptedToken(null);
      resetToLogin();

      // 2. Then tear down. None of this blocks the navigation above.
      if (currentToken) {
        await revokeToken(currentToken);
      }

      /**
       * Guard the local wipe against a session that started WHILE we were revoking.
       *
       * `resetToLogin()` puts the user on the login form immediately, so a fast typist can
       * complete a new sign-in before `revokeToken` settles. An unconditional `multiRemove`
       * at that point would delete the brand-new token and silently sign them straight back
       * out. Only wipe if the stored token is still the one we signed out of.
       */
      const stored = await readPersisted(TOKEN_KEY).catch(() => null);
      if (stored === currentToken || (stored === null && !currentToken)) {
        await removePersisted([TOKEN_KEY, TOKEN_ISSUED_AT_KEY]).catch(() => {});
      }
    } finally {
      signingOutRef.current = false;
    }
  }, [token, revokeToken]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<SessionContextValue>(() => {
    // Blocking on `locallyAcceptedToken` is what keeps a successful login from bouncing the
    // whole tree back through this gate.
    const isLoading =
      !restoreComplete ||
      (!!token && me === undefined && token !== locallyAcceptedToken);
    return {
      token,
      user: me ?? null,
      isLoading,
      notice,
      dismissNotice,
      signIn,
      signOut,
    };
  }, [
    token,
    me,
    restoreComplete,
    locallyAcceptedToken,
    notice,
    dismissNotice,
    signIn,
    signOut,
  ]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}