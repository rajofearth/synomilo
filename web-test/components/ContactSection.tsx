'use client';

import { useState } from 'react';
import {
  api,
  convexClient,
  convexErrorMessage,
  describeError,
  type FoundUser,
  type PublicUser,
} from '@/lib/api';
import type { CallKind } from '@/lib/callEngine';
import { logEvent } from '@/lib/eventLog';
import Avatar from './Avatar';

type ContactSectionProps = {
  token: string | null;
  contact: FoundUser | null;
  onContact: (contact: FoundUser | null) => void;
  onCall: (contact: FoundUser, kind: CallKind) => void;
  onStartChat: (contact: FoundUser) => void;
  busy: boolean;
  audioReady: boolean;
};

export default function ContactSection({
  token,
  contact,
  onContact,
  onCall,
  onStartChat,
  busy,
  audioReady,
}: ContactSectionProps) {
  const [lookup, setLookup] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async () => {
    if (!token) {
      return;
    }
    const wanted = lookup.trim().toLowerCase();
    if (!wanted) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      logEvent('info', 'lookup', `users.findByUsername "${wanted}"`);
      const found = (await convexClient().query(api.users.findByUsername, {
        token,
        username: wanted,
      })) as FoundUser | null;
      if (found) {
        logEvent('good', 'lookup', `found ${found.username} (${found._id})`);
        onContact(found);
        return;
      }
      // `findByUsername` is deliberately non-informative: `null` also means
      // "that is you". Fall back to the full directory so the operator can tell
      // those two apart. `users.list` excludes the signed-in user.
      logEvent('warn', 'lookup', 'findByUsername returned null, scanning users.list');
      const everyone = (await convexClient().query(api.users.list, {
        token,
      })) as PublicUser[];
      const match = (everyone ?? []).find(
        (candidate) => candidate.username.toLowerCase() === wanted,
      );
      onContact(match ? { ...match, hasConversation: false } : null);
      if (!match) {
        const message = `No other account is called "${wanted}".`;
        setError(message);
        logEvent('warn', 'lookup', message);
      }
    } catch (caught) {
      const message = `Lookup failed: ${convexErrorMessage(caught, describeError(caught))}`;
      setError(message);
      logEvent('error', 'lookup', message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="panel">
      <header>
        <h2>2 · Pick a contact</h2>
        <span className="spacer" />
        {contact ? <span className="badge on">{contact.username}</span> : null}
      </header>

      <div className="row">
        <div className="grow">
          <label htmlFor="contact-lookup">Username</label>
          <input
            id="contact-lookup"
            type="text"
            value={lookup}
            onChange={(event) => setLookup(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void find();
              }
            }}
            placeholder="the phone user's username"
            disabled={!token}
          />
        </div>
        <button type="button" onClick={() => void find()} disabled={!token || working}>
          {working ? 'Looking up…' : 'Look up'}
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      {contact ? (
        <>
          <div className="avatar-row" style={{ marginTop: 12 }}>
            <Avatar name={contact.displayName} url={contact.avatarUrl} size={56} />
            <div>
              <div className="avatar-name">{contact.displayName}</div>
              <div className="avatar-sub">@{contact.username}</div>
            </div>
          </div>
          <dl className="keyvals">
            <dt>user id</dt>
            <dd>{contact._id}</dd>
            <dt>dm exists</dt>
            <dd>{contact.hasConversation ? 'yes' : 'no (will be created)'}</dd>
          </dl>
          <div className="controls">
            <button type="button" onClick={() => onCall(contact, 'audio')} disabled={busy}>
              Call voice
            </button>
            <button type="button" onClick={() => onCall(contact, 'video')} disabled={busy}>
              Call video
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => onStartChat(contact)}
              disabled={busy}
            >
              {contact.hasConversation ? 'Open chat' : 'Start chat'}
            </button>
          </div>
          {!audioReady ? (
            <div className="alert notice">
              <span className="alert-head">Heads up</span>
              Audio is still locked by the browser autoplay policy. Click
              “Enable audio / Start” at the top before placing a call.
            </div>
          ) : null}
        </>
      ) : (
        <p className="hint">
          Look up the account signed in on the phone. Calls and messages both go
          to that person.
        </p>
      )}
    </section>
  );
}
