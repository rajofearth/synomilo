'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  CONVEX_URL,
  convexClient,
  convexErrorMessage,
  describeError,
  type FoundUser,
  type PublicUser,
} from '@/lib/api';
import type { CallKind } from '@/lib/callEngine';
import { logEvent } from '@/lib/eventLog';
import { useCallSession } from '@/lib/useCallSession';
import AudioGate from './AudioGate';
import CallScreenSection from './CallScreenSection';
import ChatSection from './ChatSection';
import ContactSection from './ContactSection';
import EventLog from './EventLog';
import IncomingCallSection from './IncomingCallSection';
import SignInSection, { readStoredSession } from './SignInSection';

export default function Harness() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [contact, setContact] = useState<FoundUser | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [restored, setRestored] = useState(false);

  const session = useCallSession(token, audioReady);
  const { reset: resetCall } = session;

  const pushError = useCallback((message: string) => {
    setAppError(message);
  }, []);

  // Restore the persisted session on mount and prove it still works.
  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) {
      setRestored(true);
      return;
    }
    let cancelled = false;
    logEvent('info', 'auth', `restoring session for @${stored.user.username}`);
    convexClient()
      .query(api.auth.me, { token: stored.token })
      .then((me: unknown) => {
        if (cancelled) {
          return;
        }
        const fresh = (me as PublicUser | null) ?? stored.user;
        setToken(stored.token);
        setUser(fresh);
        logEvent('good', 'auth', `session restored as @${fresh.username}`);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        logEvent('warn', 'auth', `stored session rejected: ${describeError(error)}`);
        window.localStorage.removeItem('webtest.token');
        window.localStorage.removeItem('webtest.user');
      })
      .finally(() => {
        if (!cancelled) {
          setRestored(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedIn = useCallback(
    (nextToken: string, nextUser: PublicUser) => {
      resetCall();
      setAppError(null);
      setContact(null);
      setConversationId(null);
      setToken(nextToken);
      setUser(nextUser);
    },
    [resetCall],
  );

  const signedOut = useCallback(() => {
    resetCall();
    setAppError(null);
    setContact(null);
    setConversationId(null);
    setToken(null);
    setUser(null);
  }, [resetCall]);

  const onCall = useCallback(
    (target: FoundUser, kind: CallKind) => {
      void session.call(target, kind);
    },
    [session],
  );

  const onStartChat = useCallback(
    (target: FoundUser) => {
      // ChatSection owns the createDM call; selecting the contact and opening
      // the conversation here keeps both entry points on the same code path.
      setConversationId(null);
      setContact(target);
      void convexClient()
        .mutation(api.conversations.createDM, {
          token: token ?? '',
          otherUserId: target._id,
        })
        .then((id: unknown) => {
          logEvent('good', 'chat', `conversation ${String(id)} ready`);
          setConversationId(String(id));
        })
        .catch((error: unknown) => {
          const message = `Could not open the chat: ${convexErrorMessage(
            error,
            'Unknown error',
          )}`;
          pushError(message);
          logEvent('error', 'chat', message);
        });
    },
    [token, pushError],
  );

  return (
    <main className="page">
      <header className="topbar">
        <h1>WebRTC + push test harness</h1>
        <AudioGate onReady={setAudioReady} />
        <span className="badge">{audioReady ? 'audio unlocked' : 'audio locked'}</span>
        <span className="badge">{restored ? (token ? 'signed in' : 'signed out') : 'restoring…'}</span>
        <span className="spacer" />
        <span className="convex-url">convex: {CONVEX_URL}</span>
      </header>

      <div className="columns">
        <div className="stack">
          <SignInSection
            token={token}
            user={user}
            onSignedIn={signedIn}
            onSignedOut={signedOut}
            onError={pushError}
          />

          {appError ? (
            <div className="alert" role="alert">
              <span className="alert-head">Error</span>
              {appError}
            </div>
          ) : null}

          <ContactSection
            token={token}
            contact={contact}
            onContact={(next) => {
              setContact(next);
              setConversationId(null);
            }}
            onCall={onCall}
            onStartChat={onStartChat}
            busy={session.busy || !audioReady}
            audioReady={audioReady}
          />

          <CallScreenSection session={session} />

          <IncomingCallSection session={session} />

          <ChatSection
            token={token}
            me={user}
            contact={contact}
            conversationId={conversationId}
            onConversation={setConversationId}
            onError={pushError}
          />
        </div>

        <div className="stack">
          <EventLog />
        </div>
      </div>
    </main>
  );
}
