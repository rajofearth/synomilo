import React from 'react';

/**
 * Legacy auth context.
 *
 * `Conversations.tsx` reads this via `useContext(AuthContext)`, but no Provider was ever
 * mounted — so `setIsLoggedIn(false)` was permanently the default no-op at the bottom of
 * this file, and that file's logout button did nothing at all. RootStackNavigator now
 * mounts a real provider wired to the canonical `signOut`.
 */
export interface AuthContextProps {
  isLoggedIn: boolean;
  setIsLoggedIn: React.Dispatch<React.SetStateAction<boolean>>;
  /**
   * Invoked when a consumer calls `setIsLoggedIn(false)`, so the legacy path tears the
   * Convex and CometChat sessions down and resets the stack to Login exactly like the
   * Profile and Settings entry points do.
   */
  onSignOut?: () => void;
}

export const AuthContext = React.createContext<AuthContextProps>({
  isLoggedIn: false,
  setIsLoggedIn: () => {},
});