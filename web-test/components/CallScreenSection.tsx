'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { formatElapsed } from '@/lib/duration';
import { logEvent } from '@/lib/eventLog';
import type { CallSession } from '@/lib/useCallSession';

type CallScreenSectionProps = {
  session: CallSession;
};

function useMediaElement(
  ref: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
  label: string,
): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (!stream) {
      node.srcObject = null;
      return;
    }
    if (node.srcObject === stream) {
      return;
    }
    node.srcObject = stream;
    const attempt = node.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch((error: unknown) => {
        logEvent('error', label, `play() rejected: ${String(error)}`);
      });
    }
  }, [ref, stream, label]);
}

export default function CallScreenSection({ session }: CallScreenSectionProps) {
  const {
    active,
    state,
    pcState,
    status,
    elapsed,
    clockOffset,
    error,
    localStream,
    remoteStream,
    pendingIceCount,
    muted,
    cameraOff,
    hangUp,
    toggleMute,
    toggleCamera,
  } = session;

  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const localRef = useRef<HTMLVideoElement | null>(null);

  useMediaElement(remoteRef, remoteStream, 'media');
  useMediaElement(localRef, active?.kind === 'video' ? localStream : null, 'media');

  return (
    <section className="panel">
      <header>
        <h2>3 · Call screen</h2>
        <span className="spacer" />
        <span className={`badge big ${state === 'connected' ? 'on' : ''}`}>{state}</span>
      </header>

      <div className="state-line">
        <span className="badge">peer connection: {pcState}</span>
        {status ? <span className="badge">server status: {status}</span> : null}
        <span className="badge">ice buffered: {pendingIceCount}</span>
        <span className="badge">clock offset: {clockOffset === null ? '—' : `${clockOffset}ms`}</span>
      </div>

      {error ? (
        <div className="alert" role="alert">
          <span className="alert-head">Error</span>
          {error}
        </div>
      ) : null}

      {active ? (
        <>
          <div className="videos">
            <div className="video-box">
              <span className="video-tag">{active.kind === 'video' ? 'remote video' : 'remote audio'}</span>
              <video ref={remoteRef} autoPlay playsInline />
              {remoteStream ? null : (
                <span className="video-empty">
                  No remote stream yet.
                  <br />
                  Check the event log for the answer / ICE exchange.
                </span>
              )}
            </div>
            {active.kind === 'video' ? (
              <div className="video-box local">
                <span className="video-tag">you</span>
                <video ref={localRef} autoPlay playsInline muted />
              </div>
            ) : null}
          </div>

          <div className="state-line" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 18 }}>
              {active.peerName}
            </strong>
            <span className="avatar-sub">
              you are the {active.role} · callId {active.callId}
            </span>
            <span className="spacer" />
            <span className={`badge big ${state === 'connected' ? 'on' : ''}`}>
              {state === 'connected' ? formatElapsed(elapsed) : state}
            </span>
          </div>

          <div className="controls">
            <button type="button" onClick={toggleMute}>
              {muted ? 'Unmute mic' : 'Mute mic'}
            </button>
            {active.kind === 'video' ? (
              <button type="button" onClick={toggleCamera}>
                {cameraOff ? 'Camera on' : 'Camera off'}
              </button>
            ) : null}
            <button type="button" className="danger" onClick={hangUp}>
              Hang up
            </button>
          </div>
        </>
      ) : (
        <p className="hint">
          No call in progress. Pick a contact above and press “Call voice” or
          “Call video”, or wait for the phone to call this account.
        </p>
      )}
    </section>
  );
}
