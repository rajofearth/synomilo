'use client';

import { useEffect } from 'react';
import { logEvent } from '@/lib/eventLog';
import type { CallSession } from '@/lib/useCallSession';
import Avatar from './Avatar';

type IncomingCallSectionProps = {
  session: CallSession;
};

/**
 * A synthesised ring tone. The harness ships no audio assets, and a silent
 * element is useless for the one thing this panel has to do: be impossible to
 * miss while the operator is reading the event log.
 */
function startRingTone(): () => void {
  type AudioContextCtor = new () => AudioContext;
  const Ctor =
    (window.AudioContext as unknown as AudioContextCtor | undefined) ??
    ((window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext);
  if (!Ctor) {
    logEvent('warn', 'ring', 'no Web Audio API; incoming call will be silent');
    return () => {};
  }
  const context = new Ctor();
  const beep = (at: number) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.4);
  };
  void context.resume();
  for (let index = 0; index < 3; index += 1) {
    beep(context.currentTime + index * 0.45);
  }
  const timer = setInterval(() => {
    for (let index = 0; index < 3; index += 1) {
      beep(context.currentTime + index * 0.45);
    }
  }, 1600);
  return () => {
    clearInterval(timer);
    void context.close().catch(() => {});
  };
}

export default function IncomingCallSection({ session }: IncomingCallSectionProps) {
  const { incoming, accept, decline, busy, active, clearNotice } = session;

  useEffect(() => {
    if (!incoming) {
      return;
    }
    const stop = startRingTone();
    return stop;
  }, [incoming]);

  return (
    <section className="panel">
      <header>
        <h2>4 · Incoming call</h2>
        <span className="spacer" />
        <span className="badge">{incoming ? 'ringing' : 'idle'}</span>
      </header>

      {incoming ? (
        <div className="incoming">
          <div className="avatar-row">
            <Avatar
              name={incoming.caller?.displayName ?? 'Unknown'}
              url={incoming.caller?.avatarUrl}
              size={56}
            />
            <div>
              <div className="avatar-name">
                {incoming.caller?.displayName ?? 'Unknown'}
              </div>
              <div className="avatar-sub">@{incoming.caller?.username ?? 'unknown'}</div>
            </div>
          </div>
          <div className="incoming-title">
            Incoming {incoming.type} call — the browser is ringing
          </div>
          <div className="controls">
            <button type="button" onClick={() => void accept()} disabled={busy}>
              Accept
            </button>
            <button type="button" className="danger" onClick={() => void decline()} disabled={busy}>
              Decline
            </button>
          </div>
          {active ? (
            <p className="hint">
              A call is already running in this tab. Hang that up before
              accepting, or the server will refuse.
            </p>
          ) : null}
          <p className="hint">callId: {incoming._id}</p>
        </div>
      ) : (
        <>
          <p className="hint">
            Polling <code>api.calls.incoming</code> every 3s. Nothing is ringing
            for this account right now.
          </p>
          {session.notice ? (
            <div className="alert notice">
              <span className="alert-head">Last outcome</span>
              {session.notice}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="ghost small" onClick={clearNotice}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
