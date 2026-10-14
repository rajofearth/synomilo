'use client';

import { useState, type FormEvent } from 'react';
import { api, convexClient, convexErrorMessage, type LoginResult, type PublicUser } from '@/lib/api';
import { logEvent } from '@/lib/eventLog';
import Avatar from './Avatar';

const TOKEN_KEY = 'webtest.token';
const USER_KEY = 'webtest.user';

type SignInSectionProps = {
  token: string | null;
  user: PublicUser | null;
  onSignedIn: (token: string, user: PublicUser) => void;
  onSignedOut: () => void;
  onError: (message: string) => void;
};

export function readStoredSession(): { token: string; user: PublicUser } | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    const raw = window.localStorage.getItem(USER_KEY);
    if (!token || !raw) {
      return null;
    }
    return { token, user: JSON.parse(raw) as PublicUser };
  } catch {
    return null;
  }
}

export default function SignInSection({
  token,
  user,
  onSignedIn,
  onSignedOut,
  onError,
}: SignInSectionProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      logEvent('info', 'auth', `api.auth.login as "${username.trim()}"`);
      const result = (await convexClient().mutation(api.auth.login, {
        username: username.trim(),
        password,
      })) as LoginResult;
      window.localStorage.setItem(TOKEN_KEY, result.token);
      window.localStorage.setItem(USER_KEY, JSON.stringify(result.user));
      logEvent('good', 'auth', `signed in as ${result.user.username} (${result.user._id})`);
      onSignedIn(result.token, result.user);
      setPassword('');
    } catch (error) {
      const message = convexErrorMessage(error, 'Sign in failed.');
      logEvent('error', 'auth', message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (token) {
      try {
        await convexClient().mutation(api.auth.logout, { token });
        logEvent('info', 'auth', 'api.auth.logout');
      } catch (error) {
        logEvent('warn', 'auth', `logout failed: ${convexErrorMessage(error, '')}`);
      }
    }
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    onSignedOut();
  };

  if (token && user) {
    return (
      <section className="panel">
        <header>
          <h2>1 · Sign in</h2>
          <span className="spacer" />
          <span className="badge on">signed in</span>
        </header>
        <div className="avatar-row">
          <Avatar name={user.displayName} url={user.avatarUrl} size={48} />
          <div>
            <div className="avatar-name">{user.displayName}</div>
            <div className="avatar-sub">@{user.username}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
        <dl className="keyvals">
          <dt>user id</dt>
          <dd>{user._id}</dd>
          <dt>token</dt>
          <dd>{token}</dd>
        </dl>
        <p className="hint">
          The token is an opaque session string, not a Convex JWT. It is kept in
          localStorage under <code>webtest.token</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <header>
        <h2>1 · Sign in</h2>
        <span className="spacer" />
        <span className="badge">signed out</span>
      </header>
      <form onSubmit={submit}>
        <div className="row">
          <div className="grow">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="the phone user's username"
            />
          </div>
          <div className="grow">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="password"
            />
          </div>
          <button type="submit" disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
      <p className="hint">
        Sign in with the <strong>browser</strong> account, not the phone account.
        The two must be different people.
      </p>
    </section>
  );
}
