import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery } from "convex/react";
import { CometChatPushNotifications } from "@cometchat/push-notifications-react-native";
import { api } from "../../convex/_generated/api";
import { clearCometChatSession } from "./cometchatSession";

const TOKEN_KEY = "synomilo.convex.token";

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
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue>({
  token: null,
  user: null,
  isLoading: true,
  signIn: async () => {},
  signOut: async () => {},
});

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [storedTokenLoaded, setStoredTokenLoaded] = useState(false);
  const logoutMutation = useMutation(api.auth.logout);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TOKEN_KEY)
      .then((stored) => {
        if (!cancelled) {
          setToken(stored);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setStoredTokenLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const me = useQuery(api.auth.me, token ? { token } : "skip");

  useEffect(() => {
    if (token && me === null) {
      AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
      setToken(null);
    }
  }, [token, me]);

  const signIn = useCallback(async (nextToken: string) => {
    await AsyncStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
  }, []);

  const signOut = useCallback(async () => {
    const currentToken = token;
    if (currentToken) {
      logoutMutation({ token: currentToken }).catch(() => {});
    }
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    setToken(null);
    try {
      CometChatPushNotifications.unregister();
    } catch {}
    await clearCometChatSession();
  }, [token, logoutMutation]);

  const value = useMemo<SessionContextValue>(() => {
    const isLoading =
      !storedTokenLoaded || (!!token && me === undefined);
    return {
      token,
      user: me ?? null,
      isLoading,
      signIn,
      signOut,
    };
  }, [token, me, storedTokenLoaded, signIn, signOut]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
