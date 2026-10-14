/**
 * The peer-to-peer call engine.
 *
 * This is a line-by-line port of the signalling half of
 * `src/components/calls/WebRTCCallScreen.tsx`. The SDP/ICE ordering is the
 * contract with the phone and must not be "improved" here: the offer is sent
 * while the call is still RINGING (before the callee accepts), the answer is
 * only ever produced in response to a received offer, and remote ICE candidates
 * are buffered until a remote description exists.
 *
 * Everything that is NOT WebRTC lives outside this file, so the ordering below
 * is readable in isolation.
 */
import { describeError } from './api';
import type { LogLevel } from './eventLog';

/** Identical to the mobile app. STUN only, no TURN. */
export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/** Mirrors RING_TIMEOUT_MS in `convex/calls.ts`. */
export const RING_TIMEOUT_MS = 60000;

export type CallKind = 'audio' | 'video';
export type CallRole = 'caller' | 'callee';
export type SignalKind = 'offer' | 'answer' | 'ice';

export type SignalRow = { _id: string; kind: SignalKind; payload: string };

/** The loud state readout required by the harness. */
export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'failed';

export type EngineHooks = {
  log: (level: LogLevel, tag: string, message: string) => void;
  /** Anything that should light up the red error box. Silent failure is not an option here. */
  error: (message: string) => void;
  /** Tell React something observable changed (streams, peer connection state). */
  changed: () => void;
  /** The harness supplies this; it is the equivalent of the app's `leave()`. */
  leave: (reason?: string) => void;
};

export type EngineDeps = {
  callId: string;
  kind: CallKind;
  role: CallRole;
  sendSignal: (kind: SignalKind, payload: string) => Promise<void>;
  consumeSignals: (ids: string[]) => Promise<void>;
  endCall: () => Promise<void>;
};

/**
 * `RTCSessionDescription` and `RTCIceCandidate` are WebIDL platform objects in
 * the browser: their data lives on the prototype, so a bare `JSON.stringify()`
 * yields `{}`. Both types define `toJSON()` in the WebRTC spec and Chrome,
 * Firefox and Safari implement it, which produces exactly the shape the mobile
 * app's `JSON.stringify(offer)` produced in React Native. This is the one
 * unavoidable platform divergence from `WebRTCCallScreen.tsx`.
 */
function toSignalPayload(value: unknown): unknown {
  if (value && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  return value;
}

export class CallEngine {
  localStream: MediaStream | null = null;
  remoteStream: MediaStream | null = null;
  pcState: RTCPeerConnectionState = 'new';
  /** Candidates held back because no remote description has arrived yet. */
  pendingIceCount = 0;

  private pc: RTCPeerConnection | null = null;
  private listeners: Array<[string, EventListener]> = [];
  private pendingIce: unknown[] = [];
  private remoteDescSet = false;
  private applied = new Set<string>();
  private draining = false;
  private disposed = false;
  private leaving = false;
  private deps: EngineDeps | null = null;
  private starting = false;

  constructor(private readonly hooks: EngineHooks) {}

  get ready(): boolean {
    return this.pc !== null && !this.disposed;
  }

  /**
   * Mirrors the setup effect of `WebRTCCallScreen.tsx`: permissions, media,
   * one peer connection, listeners, and - for the caller only - the offer.
   */
  async start(deps: EngineDeps): Promise<void> {
    if (this.starting || this.deps) {
      return;
    }
    this.starting = true;
    this.deps = deps;
    this.hooks.log(
      'info',
      'call',
      `start ${deps.kind} call as ${deps.role} (callId=${deps.callId})`,
    );

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video:
          deps.kind === 'video'
            ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 }
            : false,
      });
      if (this.disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.localStream = stream;
      this.hooks.changed();
      this.hooks.log(
        'info',
        'media',
        `local stream: ${stream.getTracks().map((t) => t.kind).join(', ')}`,
      );

      const pc = new RTCPeerConnection(ICE_SERVERS);
      this.pc = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const register = (event: string, handler: (event: Event) => void): void => {
        pc.addEventListener(event, handler);
        this.listeners.push([event, handler]);
      };

      register('icecandidate', (event: Event) => {
        const candidate = (event as RTCPeerConnectionIceEvent).candidate;
        if (candidate && this.deps) {
          const payload = JSON.stringify(toSignalPayload(candidate));
          this.hooks.log('signal', 'ice', `-> ice candidate (${payload.length}b)`);
          this.deps.sendSignal('ice', payload).catch((error: unknown) => {
            this.hooks.error(`Could not send ICE candidate: ${describeError(error)}`);
          });
        }
      });

      register('track', (event: Event) => {
        const [remoteStream] = (event as RTCTrackEvent).streams;
        if (remoteStream) {
          this.remoteStream = remoteStream;
          this.hooks.changed();
          this.hooks.log(
            'good',
            'media',
            `remote stream: ${remoteStream.getTracks().map((t) => t.kind).join(', ')}`,
          );
        }
      });

      register('connectionstatechange', () => {
        const state = pc.connectionState;
        this.pcState = state;
        this.hooks.log('info', 'pc', `connectionState=${state}`);
        this.hooks.changed();
        if (this.disposed || this.leaving) {
          return;
        }
        if (state === 'failed' || state === 'closed') {
          this.hooks.error(
            'Peer connection failed or closed before it finished. The call did not connect.',
          );
          void this.hangUp('Call ended · connection lost');
        }
      });

      // Extra observability. These do not change the protocol.
      register('iceconnectionstatechange', () => {
        this.hooks.log('debug', 'pc', `iceConnectionState=${pc.iceConnectionState}`);
      });
      register('icegatheringstatechange', () => {
        this.hooks.log('debug', 'pc', `iceGatheringState=${pc.iceGatheringState}`);
      });
      register('signalingstatechange', () => {
        this.hooks.log('debug', 'pc', `signalingState=${pc.signalingState}`);
      });
      register('negotiationneeded', () => {
        this.hooks.log('debug', 'pc', 'negotiationneeded (ignored; ordering is fixed)');
      });

      this.hooks.changed();

      if (deps.role === 'caller') {
        // Offer goes out while the call is still RINGING. The phone is not in
        // the call yet; it will pick this up once it accepts.
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        this.hooks.log('signal', 'sdp', 'offer created, local description set');
        await deps.sendSignal('offer', JSON.stringify(toSignalPayload(offer)));
        this.hooks.log('good', 'sdp', 'offer posted to signalling');
      } else {
        this.hooks.log('info', 'sdp', 'callee waiting for the offer');
      }
    } catch (error) {
      this.hooks.error(
        `Could not start your camera and microphone. ${describeError(error)}`,
      );
    } finally {
      this.starting = false;
    }
  }

  /**
   * Apply incoming WebRTC signals exactly once each, in arrival order, then
   * delete them. Byte-for-byte the same shape as the effect it replaces.
   */
  async drainSignals(rows: SignalRow[]): Promise<void> {
    const pc = this.pc;
    // Signals seen before the peer connection exists are deliberately NOT
    // consumed, so they are still there on the next poll.
    if (!pc || this.draining || this.disposed || !this.deps) {
      return;
    }
    this.draining = true;
    const consumed: string[] = [];
    try {
      for (const signal of rows) {
        if (this.applied.has(signal._id)) {
          continue;
        }
        this.applied.add(signal._id);
        try {
          const payload = JSON.parse(signal.payload) as RTCSessionDescriptionInit;
          if (signal.kind === 'offer') {
            this.hooks.log('signal', 'sdp', '<- offer received');
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            this.remoteDescSet = true;
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.hooks.log('signal', 'sdp', 'answer created, local description set');
            await this.deps.sendSignal('answer', JSON.stringify(toSignalPayload(answer)));
            this.hooks.log('good', 'sdp', 'answer posted to signalling');
          } else if (signal.kind === 'answer') {
            this.hooks.log('signal', 'sdp', '<- answer received');
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            this.remoteDescSet = true;
            for (const candidate of this.pendingIce.splice(0)) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate as RTCIceCandidateInit)).catch(
                () => {},
              );
            }
            this.pendingIceCount = 0;
            this.hooks.changed();
          } else if (signal.kind === 'ice') {
            this.hooks.log('signal', 'ice', '<- ice candidate received');
            if (this.remoteDescSet) {
              await pc
                .addIceCandidate(new RTCIceCandidate(payload as RTCIceCandidateInit))
                .catch(() => {});
            } else {
              this.pendingIce.push(payload);
              this.pendingIceCount = this.pendingIce.length;
              this.hooks.log(
                'debug',
                'ice',
                `buffered until remote description (${this.pendingIce.length} held)`,
              );
            }
          }
        } catch (error) {
          this.hooks.error(
            `Failed to apply ${signal.kind} signal: ${describeError(error)}`,
          );
        }
        consumed.push(signal._id);
      }
      if (consumed.length > 0) {
        await this.deps.consumeSignals(consumed);
      }
    } finally {
      this.draining = false;
    }
  }

  setMuted(muted: boolean): void {
    this.localStream
      ?.getAudioTracks()
      .forEach((track) => {
        track.enabled = !muted;
      });
  }

  setCameraEnabled(enabled: boolean): void {
    this.localStream
      ?.getVideoTracks()
      .forEach((track) => {
        track.enabled = enabled;
      });
  }

  async hangUp(reason?: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.leaving = true;
    this.hooks.log('info', 'call', reason ? `hang up: ${reason}` : 'hang up');
    const ending = this.deps?.endCall();
    if (ending) {
      ending.catch((error: unknown) => {
        this.hooks.error(`calls.end failed: ${describeError(error)}`);
      });
    }
    this.dispose();
    this.hooks.leave(reason);
  }

  /**
   * Same teardown as the mobile screen's effect cleanup: listeners come off
   * BEFORE `close()`, because closing fires `connectionstatechange: 'closed'`
   * and would otherwise re-enter the hang-up path.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const [event, handler] of this.listeners) {
      try {
        this.pc?.removeEventListener(event, handler);
      } catch {
        /* ignore */
      }
    }
    this.listeners = [];
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.remoteStream?.getTracks().forEach((track) => track.stop());
    this.remoteStream = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.pendingIce = [];
    this.pendingIceCount = 0;
    this.deps = null;
    this.hooks.changed();
  }
}
