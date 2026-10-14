'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  convexClient,
  convexErrorMessage,
  describeError,
  type AcceptResult,
  type CallInfo,
  type FoundUser,
  type IncomingCallRow,
  type SignalRow,
} from './api';
import {
  CallEngine,
  RING_TIMEOUT_MS,
  type CallKind,
  type CallRole,
  type CallState,
} from './callEngine';
import { deriveClockOffset, elapsedSeconds } from './duration';
import { logEvent } from './eventLog';
import { useConvexSubscription, usePoller } from './hooks';

/** `calls:incoming` is polled rather than subscribed, exactly as specified. */
export const INCOMING_POLL_MS = 3000;

/** Backstop poll for `calls:signals`; the live subscription is the fast path. */
export const SIGNALS_POLL_MS = 1000;

/** How long a terminal outcome ("Call declined") stays on screen. */
export const NOTICE_MS = 2600;

export type ActiveCall = {
  callId: string;
  kind: CallKind;
  role: CallRole;
  peerName: string;
};

export type CallSession = {
  active: ActiveCall | null;
  state: CallState;
  pcState: RTCPeerConnectionState;
  status: string | null;
  elapsed: number;
  clockOffset: number | null;
  error: string | null;
  notice: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  pendingIceCount: number;
  muted: boolean;
  cameraOff: boolean;
  busy: boolean;
  incoming: IncomingCallRow;
  version: number;
  call: (contact: FoundUser, kind: CallKind) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  hangUp: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  clearNotice: () => void;
  reset: () => void;
};

export function useCallSession(token: string | null, audioReady: boolean): CallSession {
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [callInfo, setCallInfo] = useState<CallInfo>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCallRow>(null);
  const [version, setVersion] = useState(0);

  const engineRef = useRef<CallEngine | null>(null);
  const leavingRef = useRef(false);
  const clockOffsetRef = useRef<number | null>(null);
  const incomingIdRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const bump = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  /**
   * The equivalent of the app's `leave()`: tear the peer connection down, clear
   * the active call, and - for terminal outcomes - explain what happened instead
   * of silently returning to idle.
   */
  const leave = useCallback(
    (reason?: string) => {
      if (leavingRef.current) {
        return;
      }
      leavingRef.current = true;
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
      engineRef.current?.dispose();
      engineRef.current = null;
      setActive(null);
      setCallInfo(null);
      setElapsed(0);
      clockOffsetRef.current = null;
      setMuted(false);
      setCameraOff(false);
      if (reason) {
        logEvent('warn', 'call', `ended: ${reason}`);
        setNotice(reason);
        noticeTimerRef.current = setTimeout(() => {
          setNotice(null);
          leavingRef.current = false;
        }, NOTICE_MS);
      } else {
        setNotice(null);
        leavingRef.current = false;
      }
    },
    [],
  );

  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  const begin = useCallback(
    (next: ActiveCall) => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
      leavingRef.current = false;
      engineRef.current?.dispose();
      setError(null);
      setNotice(null);
      setCallInfo(null);
      setElapsed(0);
      setMuted(false);
      setCameraOff(false);
      clockOffsetRef.current = null;

      engineRef.current = new CallEngine({
        log: (level, tag, message) => logEvent(level, tag, message),
        error: (message) => {
          setError(message);
          logEvent('error', 'call', message);
        },
        changed: bump,
        leave: (reason) => leaveRef.current(reason),
      });
      setActive(next);
      bump();
    },
    [bump],
  );

  // Media + peer connection + (for the caller) the offer. Keyed on the call id
  // only, exactly like the mobile screen's effect.
  const activeCallId = active?.callId ?? null;
  const activeRole = active?.role ?? null;
  useEffect(() => {
    const engine = engineRef.current;
    if (!activeCallId || !active || !token || !engine) {
      return;
    }
    void engine.start({
      callId: activeCallId,
      kind: active.kind,
      role: active.role,
      sendSignal: async (kind, payload) => {
        logEvent('debug', 'signal', `api.calls.signal kind=${kind}`);
        await convexClient().mutation(api.calls.signal, {
          token,
          callId: activeCallId,
          kind,
          payload,
        });
      },
      consumeSignals: async (signalIds) => {
        try {
          await convexClient().mutation(api.calls.consumeSignals, {
            token,
            signalIds,
          });
        } catch (caught) {
          logEvent('error', 'signal', `consumeSignals failed: ${describeError(caught)}`);
        }
      },
      endCall: async () => {
        logEvent('debug', 'call', 'api.calls.end');
        await convexClient().mutation(api.calls.end, { token, callId: activeCallId });
      },
    });

    return () => {
      engine.dispose();
      if (engineRef.current === engine) {
        engineRef.current = null;
      }
    };
  }, [activeCallId, activeRole, token, active, bump]);

  // Fast path: apply signalling the instant Convex pushes it.
  const signalArgs =
    token && activeCallId ? { token, callId: activeCallId } : null;
  useConvexSubscription<SignalRow[]>(
    signalArgs ? api.calls.signals : null,
    signalArgs,
    (rows) => {
      void engineRef.current?.drainSignals(Array.isArray(rows) ? rows : []);
    },
    (caught) => {
      const message = `calls.signals failed: ${describeError(caught)}`;
      setError(message);
      logEvent('error', 'signal', message);
    },
  );

  // Backstop: an explicit poll, so a dropped subscription degrades to slow
  // rather than to dead. Signals are deduplicated by id in the engine.
  usePoller(
    async () => {
      if (!token || !activeCallId) {
        return;
      }
      const rows = (await convexClient().query(api.calls.signals, {
        token,
        callId: activeCallId,
      })) as SignalRow[];
      logEvent('debug', 'poll', `calls.signals -> ${rows.length} pending`);
      await engineRef.current?.drainSignals(Array.isArray(rows) ? rows : []);
    },
    activeCallId ? SIGNALS_POLL_MS : null,
    `${token ?? ''}|${activeCallId ?? ''}`,
    (caught) => logEvent('error', 'poll', `calls.signals poll failed: ${describeError(caught)}`),
  );

  // Call lifecycle.
  useConvexSubscription<CallInfo>(
    signalArgs ? api.calls.get : null,
    signalArgs,
    (info) => {
      if (!info) {
        return;
      }
      setCallInfo(info);
      if (clockOffsetRef.current === null && info.serverNow) {
        clockOffsetRef.current = deriveClockOffset(info.serverNow, Date.now());
        logEvent('info', 'clock', `server clock offset = ${clockOffsetRef.current}ms`);
      }
      const role = info.role;
      if (info.status === 'rejected') {
        leaveRef.current(role === 'caller' ? 'Call declined' : 'Call ended');
      } else if (info.status === 'missed') {
        leaveRef.current(role === 'caller' ? 'No answer' : 'Missed call');
      } else if (info.status === 'ended') {
        leaveRef.current('Call ended');
      }
    },
    (caught) => {
      const message = `calls.get failed: ${describeError(caught)}`;
      setError(message);
      logEvent('error', 'call', message);
    },
  );

  // Duration, measured on the server's timeline.
  const answeredAt = callInfo?.answeredAt ?? null;
  const callStatus = callInfo?.status ?? null;
  useEffect(() => {
    if (callStatus !== 'active' || !answeredAt) {
      return;
    }
    const tick = () =>
      setElapsed(elapsedSeconds(answeredAt, Date.now(), clockOffsetRef.current));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [callStatus, answeredAt]);

  // Caller-side ring timeout. The server does the same job via markTimedOut.
  useEffect(() => {
    if (activeRole !== 'caller' || callStatus !== 'ringing') {
      return;
    }
    const timer = setTimeout(() => {
      logEvent('warn', 'call', `no answer after ${RING_TIMEOUT_MS / 1000}s`);
      void engineRef.current?.hangUp('No answer');
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [activeCallId, activeRole, callStatus]);

  // Incoming-call poll.
  usePoller(
    async () => {
      if (!token) {
        return;
      }
      const row = (await convexClient().query(api.calls.incoming, { token })) as IncomingCallRow;
      const id = row?._id ?? null;
      if (id === incomingIdRef.current) {
        logEvent('debug', 'poll', `calls.incoming -> ${id ? 'ringing' : 'none'}`);
        return;
      }
      incomingIdRef.current = id;
      if (row) {
        logEvent(
          'info',
          'ring',
          `calls.incoming -> ${row.type} call from ${row.caller?.displayName ?? 'unknown'}`,
        );
      } else {
        logEvent('debug', 'ring', 'calls.incoming -> none');
      }
      setIncoming(row);
    },
    token ? INCOMING_POLL_MS : null,
    token ?? '',
    (caught) => {
      const message = `calls.incoming poll failed: ${describeError(caught)}`;
      setError(message);
      logEvent('error', 'poll', message);
    },
  );

  const reset = useCallback(() => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    engineRef.current?.dispose();
    engineRef.current = null;
    setActive(null);
    setCallInfo(null);
    setIncoming(null);
    incomingIdRef.current = null;
    setError(null);
    setNotice(null);
    setElapsed(0);
    setMuted(false);
    setCameraOff(false);
    leavingRef.current = false;
  }, []);

  const startCall = useCallback(
    async (contact: FoundUser, kind: CallKind) => {
      if (!token) {
        return;
      }
      if (!audioReady) {
        setError(
          'Click "Enable audio / Start" at the top first. The browser blocks audio until a real click.',
        );
        return;
      }
      setBusy(true);
      try {
        logEvent('info', 'call', `api.calls.start -> ${contact.displayName} (${kind})`);
        const callId = (await convexClient().mutation(api.calls.start, {
          token,
          calleeId: contact._id,
          type: kind,
        })) as string;
        begin({ callId, kind, role: 'caller', peerName: contact.displayName });
      } catch (caught) {
        const message = `Could not start the call: ${convexErrorMessage(
          caught,
          'Unknown error',
        )}`;
        setError(message);
        logEvent('error', 'call', message);
      } finally {
        setBusy(false);
      }
    },
    [token, audioReady, begin],
  );

  const accept = useCallback(async () => {
    if (!token || !incoming) {
      return;
    }
    setBusy(true);
    try {
      logEvent('info', 'ring', `api.calls.accept ${incoming._id}`);
      const result = (await convexClient().mutation(api.calls.accept, {
        token,
        callId: incoming._id,
      })) as AcceptResult;
      if (!result.ok) {
        const message =
          result.reason === 'answered_elsewhere'
            ? 'That call was already answered on another device.'
            : `That call is no longer ringing (status: ${result.status}).`;
        setError(message);
        logEvent('warn', 'ring', message);
        incomingIdRef.current = null;
        setIncoming(null);
        return;
      }
      begin({
        callId: incoming._id,
        kind: incoming.type,
        role: 'callee',
        peerName: incoming.caller?.displayName ?? 'Unknown',
      });
      incomingIdRef.current = null;
      setIncoming(null);
    } catch (caught) {
      const message = `Could not answer: ${convexErrorMessage(
        caught,
        'The call may have ended.',
      )}`;
      setError(message);
      logEvent('error', 'ring', message);
    } finally {
      setBusy(false);
    }
  }, [token, incoming, begin]);

  const decline = useCallback(async () => {
    if (!token || !incoming) {
      return;
    }
    setBusy(true);
    try {
      logEvent('info', 'ring', `api.calls.reject ${incoming._id}`);
      await convexClient().mutation(api.calls.reject, { token, callId: incoming._id });
      incomingIdRef.current = null;
      setIncoming(null);
    } catch (caught) {
      const message = `Could not decline: ${convexErrorMessage(caught, 'Unknown error')}`;
      setError(message);
      logEvent('error', 'ring', message);
    } finally {
      setBusy(false);
    }
  }, [token, incoming]);

  const hangUp = useCallback(() => {
    void engineRef.current?.hangUp();
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((previous) => {
      engineRef.current?.setMuted(!previous);
      return !previous;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraOff((previous) => {
      engineRef.current?.setCameraEnabled(previous);
      return !previous;
    });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const engine = engineRef.current;
  const pcState = engine?.pcState ?? 'new';
  const pcConnected = pcState === 'connected';
  const terminal =
    callStatus === 'rejected' || callStatus === 'missed' || callStatus === 'ended';

  let state: CallState;
  if (!active) {
    state = notice ? 'ended' : 'idle';
  } else if (error) {
    state = 'failed';
  } else if (terminal || notice) {
    state = 'ended';
  } else if (pcConnected) {
    state = 'connected';
  } else if (callStatus === 'active') {
    state = 'connecting';
  } else if (active.role === 'caller') {
    state = 'calling';
  } else {
    state = 'ringing';
  }

  return {
    active,
    state,
    pcState,
    status: callStatus,
    elapsed,
    clockOffset: clockOffsetRef.current,
    error,
    notice,
    localStream: engine?.localStream ?? null,
    remoteStream: engine?.remoteStream ?? null,
    pendingIceCount: engine?.pendingIceCount ?? 0,
    muted,
    cameraOff,
    busy,
    incoming,
    version,
    call: startCall,
    accept,
    decline,
    hangUp,
    toggleMute,
    toggleCamera,
    clearNotice,
    reset,
  };
}
