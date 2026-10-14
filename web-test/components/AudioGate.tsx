'use client';

import { useEffect, useRef, useState } from 'react';
import { logEvent } from '@/lib/eventLog';
import { describeError } from '@/lib/api';

type AudioGateProps = {
  onReady: (ready: boolean) => void;
};

/**
 * Autoplay policy.
 *
 * A browser will not play audio for a page that has never seen a real user
 * gesture, so a WebRTC call that connects perfectly can still be completely
 * silent. This button is the fix and it has to exist before any call is placed:
 * `getUserMedia` is called here and only here, from inside a genuine click
 * handler, the returned stream is pushed through a media element to unlock
 * playback for the whole document, and the tracks are then released so the
 * microphone indicator does not stay lit for the rest of the session.
 */
export default function AudioGate({ onReady }: AudioGateProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // null until the client has checked, so the server-rendered markup and the
  // first client render agree and React has no hydration mismatch to report.
  const [supported, setSupported] = useState<boolean | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function',
    );
  }, []);

  const start = async () => {
    setWorking(true);
    setError(null);
    try {
      logEvent('info', 'audio', 'requesting microphone to unlock autoplay');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const element = audioRef.current;
      if (element) {
        element.srcObject = stream;
        element.muted = false;
        element.volume = 1;
        await element.play();
      }
      stream.getTracks().forEach((track) => track.stop());

      type AudioContextCtor = new () => AudioContext;
      const Ctor =
        (window.AudioContext as unknown as AudioContextCtor | undefined) ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (Ctor) {
        const context = new Ctor();
        await context.resume();
        await context.close().catch(() => {});
      }

      setReady(true);
      onReady(true);
      logEvent('good', 'audio', 'autoplay unlocked for this document');
    } catch (caught) {
      const message = describeError(caught);
      setError(
        `Could not unlock audio: ${message}\n` +
          'If this says NotAllowedError or Permission denied, check that the page is served over ' +
          'HTTPS or from localhost and that the browser was allowed to use the microphone.',
      );
      logEvent('error', 'audio', `unlock failed: ${message}`);
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <button type="button" className="hero" onClick={() => void start()} disabled={ready || working}>
        {ready ? 'Audio enabled ✓' : working ? 'Requesting microphone…' : 'Enable audio / Start'}
      </button>
      <audio ref={audioRef} className="hidden-audio" />
      {supported === false ? (
        <div className="alert" style={{ margin: 0, width: '100%' }}>
          <span className="alert-head">Insecure context</span>
          {'navigator.mediaDevices is unavailable. getUserMedia requires HTTPS or localhost - open the page at http://localhost:3100 instead of the LAN-IP address.'}
        </div>
      ) : null}
      {error ? (
        <div className="alert" style={{ margin: 0 }}>
          <span className="alert-head">Audio</span>
          {error}
        </div>
      ) : null}
    </>
  );
}
