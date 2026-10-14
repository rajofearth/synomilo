'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  api,
  convexClient,
  convexErrorMessage,
  describeError,
  type FoundUser,
  type MessageRow,
  type MessageListResult,
  type PublicUser,
} from '@/lib/api';
import { formatClock, logEvent } from '@/lib/eventLog';
import { usePoller } from '@/lib/hooks';

const MESSAGE_POLL_MS = 2000;

type Pending = {
  key: string;
  body: string;
  at: number;
  state: 'sending' | 'sent' | 'failed';
  detail?: string;
};

type ChatSectionProps = {
  token: string | null;
  me: PublicUser | null;
  contact: FoundUser | null;
  conversationId: string | null;
  onConversation: (conversationId: string) => void;
  onError: (message: string) => void;
};

export default function ChatSection({
  token,
  me,
  contact,
  conversationId,
  onConversation,
  onError,
}: ChatSectionProps) {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  usePoller(
    async () => {
      if (!token || !conversationId) {
        return;
      }
      const result = (await convexClient().query(api.messages.list, {
        token,
        conversationId,
        limit: 50,
      })) as MessageListResult;
      const next = result?.messages ?? [];
      setRows(next);
      // Retire anything the server has now echoed back.
      setPending((previous) =>
        previous.filter(
          (item) =>
            item.state === 'sending' ||
            item.state === 'failed' ||
            !next.some(
              (row) =>
                row.senderId === me?._id &&
                row.body === item.body &&
                Math.abs(row.createdAt - item.at) < 60_000,
            ),
        ),
      );
    },
    token && conversationId ? MESSAGE_POLL_MS : null,
    `${token ?? ''}|${conversationId ?? ''}`,
    (caught) => logEvent('error', 'chat', `messages.list failed: ${describeError(caught)}`),
  );

  useEffect(() => {
    setRows([]);
    setPending([]);
    pinned.current = true;
  }, [conversationId]);

  useEffect(() => {
    const node = listRef.current;
    if (node && pinned.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [rows, pending]);

  const openChat = async () => {
    if (!token || !contact) {
      return;
    }
    setError(null);
    try {
      logEvent('info', 'chat', `api.conversations.createDM with ${contact.username}`);
      const id = (await convexClient().mutation(api.conversations.createDM, {
        token,
        otherUserId: contact._id,
      })) as string;
      logEvent('good', 'chat', `conversation ${id} ready`);
      onConversation(id);
    } catch (caught) {
      const message = `Could not open the chat: ${convexErrorMessage(caught, 'Unknown error')}`;
      setError(message);
      onError(message);
      logEvent('error', 'chat', message);
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!token || !conversationId || !body) {
      return;
    }
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDraft('');
    setSending(true);
    setPending((previous) => [...previous, { key, body, at: Date.now(), state: 'sending' }]);
    try {
      logEvent('info', 'chat', `api.messages.send "${body.slice(0, 60)}"`);
      await convexClient().mutation(api.messages.send, {
        token,
        conversationId,
        body,
        kind: 'text',
      });
      setPending((previous) =>
        previous.map((item) => (item.key === key ? { ...item, state: 'sent' } : item)),
      );
      logEvent('good', 'chat', 'message accepted by the server');
    } catch (caught) {
      const detail = convexErrorMessage(caught, 'Unknown error');
      setPending((previous) =>
        previous.map((item) =>
          item.key === key ? { ...item, state: 'failed', detail } : item,
        ),
      );
      const message = `Message not sent: ${detail}`;
      setError(message);
      onError(message);
      logEvent('error', 'chat', message);
    } finally {
      setSending(false);
    }
  };

  const visible = useMemo(
    () =>
      pending.map((item) => ({
        key: item.key,
        mine: true,
        body: item.body,
        at: item.at,
        state: item.state,
        detail: item.detail,
      })),
    [pending],
  );

  return (
    <section className="panel">
      <header>
        <h2>5 · Text chat</h2>
        <span className="spacer" />
        {conversationId ? <span className="badge on">open</span> : <span className="badge">no chat</span>}
      </header>

      {!conversationId ? (
        <>
          <p className="hint">
            {contact
              ? `Press "Start chat" above to open a DM with ${contact.displayName}.`
              : 'Look up a contact above, then press "Start chat".'}
          </p>
          <p className="hint">
            Sending a message is the push-notification test: the phone must light
            up while it is in the background. Send from here, then send one back
            from the phone.
          </p>
        </>
      ) : (
        <>
          <div
            className="chat-list"
            ref={listRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
            }}
          >
            {rows.length === 0 && visible.length === 0 ? (
              <p className="empty">No messages yet.</p>
            ) : null}
            {rows.map((row) => (
              <div key={row._id} className={`bubble ${row.senderId === me?._id ? 'mine' : ''}`}>
                <div>{row.body ?? `[${row.kind}]`}</div>
                <div className="bubble-meta">
                  <span>{row.senderId === me?._id ? 'you' : row.sender.displayName}</span>
                  <span>{formatClock(row.createdAt)}</span>
                  <span>{row.senderId === me?._id ? 'delivered' : 'received'}</span>
                </div>
              </div>
            ))}
            {visible.map((item) => (
              <div key={item.key} className="bubble mine">
                <div>{item.body}</div>
                <div className="bubble-meta">
                  <span>you</span>
                  <span>{formatClock(item.at)}</span>
                  <span>{item.state}</span>
                </div>
                {item.detail ? (
                  <div className="bubble-meta">
                    <span>{item.detail}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <form onSubmit={send} style={{ marginTop: 10 }}>
            <div className="row">
              <div className="grow">
                <label htmlFor="chat-draft">Message</label>
                <input
                  id="chat-draft"
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="type and press Enter"
                  disabled={sending}
                />
              </div>
              <button type="submit" disabled={sending || !draft.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
          <p className="hint">
            conversationId: {conversationId} · polled every{' '}
            {MESSAGE_POLL_MS / 1000}s
          </p>
        </>
      )}

      {error ? (
        <div className="alert">
          <span className="alert-head">Error</span>
          {error}
        </div>
      ) : null}

      {!conversationId && contact ? (
        <div className="controls">
          <button type="button" onClick={() => void openChat()}>
            Start chat with {contact.displayName}
          </button>
        </div>
      ) : null}
    </section>
  );
}
