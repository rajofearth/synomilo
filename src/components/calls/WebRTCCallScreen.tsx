import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PermissionsAndroid,
  Platform,
  ActivityIndicator,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from 'react-native-paper';
import { useQuery, useMutation } from 'convex/react';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  mediaDevices,
} from 'react-native-webrtc';
import Video from 'react-native-video';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import UserAvatar from '../convex/UserAvatar';
import { cancelAllCallNotifications } from '../../notifications/callNotifications';
import {
  hideOngoingCallNotification,
  refreshOngoingCallActions,
  showOngoingCallNotification,
} from '../../notifications/ongoingCall';
import {
  applyAudioRoute,
  callMediaState,
  prepareCallAudioRoute,
  releaseAudioRoute,
} from '../../notifications/callMediaState';
import { useCallStore } from './callStore';
import {
  advanceLink,
  canRestartIce,
  connectionStatusLabel,
  describeLocalTracks,
  initialLinkState,
  missingVideoReason,
  permissionFailureMessage,
  summarisePermissionResults,
  type LinkPhase,
  type LinkState,
  type PermissionSummary,
} from './callSetup';
import {
  deriveClockOffset,
  elapsedSeconds,
  formatElapsed,
} from '../../utils/callDuration';

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/** Matches `CallNetworkModule.EVENT_NETWORK_CHANGED`. */
const NETWORK_CHANGED_EVENT = 'CallNetwork:changed';

/** Mirrors convex/calls.ts RING_TIMEOUT_MS. */
const RING_TIMEOUT_MS = 60000;
/** How long a terminal message ("Call declined") stays on screen before popping. */
const NOTICE_MS = 1600;

/**
 * Hand the camera and the microphone back to the system.
 *
 * `MediaStreamTrack.stop()` in react-native-webrtc 124 is JS-only - it flips
 * `_readyState` and calls nothing native (`MediaStreamTrack.ts:99`), so the
 * previous teardown left the `Camera2Capturer` running and the mic hot: the
 * recording indicator stayed on after every call, and a second `getUserMedia()`
 * on the same device could not get the camera. `MediaStream.release()` is the
 * path that reaches `mediaStreamTrackRelease` -> `GetUserMediaImpl.disposeTrack`
 * and actually stops capture and disposes the source.
 */
const releaseLocalStream = (stream: any) => {
  if (!stream) {
    return;
  }
  try {
    stream.release?.();
  } catch {}
};

const CallScreen = ({ route, navigation }: any) => {
  const { token } = useSession();
  const theme = useTheme();
  const { callId, type, role, peerName } = route.params as {
    callId: string;
    type: 'audio' | 'video';
    role: 'caller' | 'callee';
    peerName: string;
  };

  const call = useQuery(
    api.calls.get,
    token && callId ? { token, callId: callId as any } : 'skip',
  );
  const signals = useQuery(
    api.calls.signals,
    token && callId ? { token, callId: callId as any } : 'skip',
  );
  const sendSignal = useMutation(api.calls.signal);
  const consumeSignals = useMutation(api.calls.consumeSignals);
  const endCall = useMutation(api.calls.end);

  const pcRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const pcListenersRef = useRef<Array<[string, (event: any) => void]>>([]);
  const pendingIceRef = useRef<any[]>([]);
  const remoteDescSetRef = useRef(false);
  const appliedSignalsRef = useRef<Set<string>>(new Set());

  const [pcReady, setPcReady] = useState(false);
  const [localURL, setLocalURL] = useState<string | null>(null);
  const [remoteURL, setRemoteURL] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  /**
   * Live `RTCPeerConnection` state, surfaced through `connectionStatusLabel`.
   *
   * The call row flips to `active` the instant it is accepted, which is seconds
   * before any media path exists. Without these two the screen had no way to say
   * "connecting" as distinct from "broken", which is what made a dead call
   * indistinguishable from a slow one.
   */
  const [peerState, setPeerState] = useState<string | null>(null);
  const [iceState, setIceState] = useState<string | null>(null);
  /** Why the picture-in-picture box has no picture in it, or null. */
  const [videoMissingReason, setVideoMissingReason] = useState<string | null>(null);
  const permissionSummaryRef = useRef<PermissionSummary>({
    granted: [],
    refused: [],
    blocked: [],
  });
  // Difference between the server clock and this device's clock, sampled once
  // per call. `answeredAt` is a server timestamp; without this the duration
  // goes negative on any skewed device. Null until (and unless) the server ships
  // `serverNow` - the helper clamps to 0 in that case rather than showing garbage.
  const clockOffsetRef = useRef<number | null>(null);

  /**
   * Guards against the double-`goBack()`: the media effect's cleanup calls
   * `pc.close()`, which synchronously emits `connectionstatechange: 'closed'`,
   * which used to call `hangUp()` again and pop one screen further than intended.
   * A ref rather than state because the peer's callbacks are outside React.
   */
  const leavingRef = useRef(false);
  const hangUpRef = useRef<(reason?: string) => void>(() => {});
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mirrors `peerState` for the link tick, which runs outside React. */
  const peerStateRef = useRef<string | null>(null);
  /** Mirrors `iceState` for the same reason. */
  const iceStateRef = useRef<string | null>(null);
  /**
   * The device's default network, as last reported by `CallNetworkModule`.
   *
   * `undefined` until something has actually reported, which `advanceLink` reads as
   * "no news this tick" rather than as "no network" - see [advanceLink].
   */
  const networkKeyRef = useRef<string | null | undefined>(undefined);
  /**
   * The connection lifecycle. A ref rather than state because it is advanced from
   * a peer-connection event handler, and because the thing it replaces - one
   * deadline armed when the row flipped to `active` and never re-armed - is
   * precisely a piece of state that must not be re-derived by a re-render.
   *
   * See `advanceLink` in callSetup.ts.
   */
  const linkRef = useRef<LinkState>(initialLinkState());
  /** Only so the status line can read the phase; the decisions use the ref. */
  const [linkPhase, setLinkPhase] = useState<LinkPhase>('connecting');

  const setActiveCall = useCallStore(state => state.setActive);
  const setScreenVisible = useCallStore(state => state.setScreenVisible);

  // Reaching the call screen means the ring is over. Both ids, because this also
  // mounts for a call that is already `active` (resumed from the ongoing-call
  // notification, or answered on another device), and in that case a stale
  // `ongoing:` entry is just as wrong as a stale ring.
  useEffect(() => {
    cancelAllCallNotifications(callId);
  }, [callId]);

  useEffect(() => {
    setScreenVisible(true);
    return () => setScreenVisible(false);
  }, [setScreenVisible]);

  const leave = useCallback(
    (reason?: string) => {
      if (leavingRef.current) {
        return;
      }
      leavingRef.current = true;
      if (!reason) {
        navigation.goBack();
        return;
      }
      // Terminal states used to pop silently, which is why a declined call and a
      // failed call looked identical from the other end.
      setNotice(reason);
      noticeTimerRef.current = setTimeout(() => navigation.goBack(), NOTICE_MS);
    },
    [navigation],
  );

  const hangUp = useCallback(
    (reason?: string) => {
      if (token) {
        endCall({ token, callId: callId as any }).catch(() => {});
      }
      // Cleared FIRST, because `hideOngoingCallNotification` asks the call store
      // whether this call is still live before deciding whether to release the
      // audio route. Releasing it from under a peer connection that is still
      // carrying media takes the call out of voice-call mode.
      setActiveCall(null);
      hideOngoingCallNotification(callId).catch(() => {});
      leave(reason);
    },
    [token, endCall, callId, leave, setActiveCall],
  );

  useEffect(() => {
    hangUpRef.current = hangUp;
  });

  useEffect(() => {
    peerStateRef.current = peerState;
  }, [peerState]);

  useEffect(() => {
    iceStateRef.current = iceState;
  }, [iceState]);

  // Leave the teardown of the ongoing notification to `hangUp` and unmount only:
  // this effect must not re-run on every status change and cancel a notification
  // that is about to be shown again.
  useEffect(
    () => () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      // Also first, for the same reason as in `hangUp`: by the time the
      // notification comes down the call is over, so it owns the audio release.
      setActiveCall(null);
      hideOngoingCallNotification(callId).catch(() => {});
      // And unconditionally, because this cleanup also runs when the screen goes
      // away for a reason that is not a hangup at all - the peer connection is
      // closed either way, and a live route with no call behind it is exactly
      // what makes the *next* call sound wrong.
      releaseAudioRoute();
    },
    [callId, setActiveCall],
  );

  /**
   * An actual ICE restart, not just a hope for one.
   *
   * `restartIce()` is real in this library and verified end to end: it is declared
   * at `node_modules/react-native-webrtc/src/RTCPeerConnection.ts:561`, and on
   * Android it reaches `org.webrtc.PeerConnection.restartIce()` through
   * `WebRTCModule.java:1347`. But libwebrtc performs the restart on the *next*
   * local description, and this version does not expose
   * `continualGatheringPolicy` (`RTCPeerConnection.ts:56-62`), so gathering is
   * `gather_once` and `restartIce()` by itself produces no new candidates. The
   * flag it sets is consumed by `createOffer({ iceRestart: true })`, so the
   * restart offer is what makes this do anything - and it reuses the existing
   * `offer`/`answer` signal kinds and the existing peer-side handling, so no
   * signalling protocol is added or reshaped.
   *
   * Not attempted when there is nothing to restart on top of: libwebrtc refuses
   * an ICE restart with no remote description, and issuing a second offer while
   * one is already out is glare in a fixed caller-offers/callee-answers design.
   */
  const restartIce = useCallback(async () => {
    const pc: any = pcRef.current;
    if (!canRestartIce(pc)) {
      console.log(
        '[CallScreen] ice restart not possible',
        pc?.signalingState,
        !!pc?.remoteDescription,
      );
      return;
    }
    try {
      pc.restartIce();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      if (token) {
        await sendSignal({
          token,
          callId: callId as any,
          kind: 'offer',
          payload: JSON.stringify(offer),
        });
      }
    } catch (error) {
      // A restart that throws is an attempt spent, and the recovery window is
      // still running: the ladder moves on by itself rather than needing a
      // decision here.
      console.log('[CallScreen] ice restart failed', error);
    }
  }, [token, callId, sendSignal]);

  const restartIceRef = useRef(restartIce);

  useEffect(() => {
    restartIceRef.current = restartIce;
  }, [restartIce]);

  const linkPhaseRef = useRef<LinkPhase>('connecting');

  /**
   * One tick of the connection lifecycle: fold the live peer-connection values
   * into the lifecycle state and carry out at most one consequence.
   *
   * `hangUp` is deliberately NOT a dependency - it closes over `leavingRef` and
   * re-running an interval because its identity changed is the same class of bug
   * as re-running the media effect. The ref indirection is the same one
   * `hangUpRef` already uses.
   */
  const runLinkTick = useCallback(() => {
    if (leavingRef.current) {
      return;
    }
    const { state, effect } = advanceLink(linkRef.current, {
      peerState: peerStateRef.current,
      iceState: iceStateRef.current,
      now: Date.now(),
      networkKey: networkKeyRef.current,
    });
    linkRef.current = state;
    if (state.phase !== linkPhaseRef.current) {
      linkPhaseRef.current = state.phase;
      setLinkPhase(state.phase);
    }
    if (effect.type === 'restartIce') {
      restartIceRef.current();
      return;
    }
    if (effect.type === 'hangUp') {
      // The only place a link problem ends the call, and it runs once: the
      // decision is made on the transition into `failed` and never revisited.
      // Nothing above this line has told the peer anything.
      hangUpRef.current(effect.reason);
    }
  }, []);

  const runLinkTickRef = useRef(runLinkTick);

  useEffect(() => {
    runLinkTickRef.current = runLinkTick;
  }, [runLinkTick]);

  /**
   * Watch for the default network changing identity, so a handover asks for a
   * recovery instead of waiting for ICE to notice.
   *
   * Why this cannot be left to `iceConnectionState`. This `react-native-webrtc`
   * does not expose `continualGatheringPolicy`
   * (`lib/typescript/RTCPeerConnection.d.ts:31-37`), so gathering is `gather_once`
   * and every candidate gathered at setup describes the network the call started
   * on. After a Wi-Fi -> LTE handover those candidates are dead, and libwebrtc's
   * own answer takes a full consent-freshness window - tens of seconds of silence -
   * before it reports `disconnected` and the same recovery would begin anyway.
   * `ConnectivityManager` knows the instant the network is replaced, which is what
   * turns that gap into the second or two an ICE restart actually takes.
   *
   * The event carries the identity of the network *currently* in force, not the one
   * each callback happened to mention, so the `onAvailable(new)` + `onLost(old)`
   * pair a handover arrives as is one change and not two - the second of which
   * would otherwise be a spurious restart on a network that is up.
   *
   * The handler only records the network and runs a tick. `advanceLink` owns every
   * decision that follows - whether a change is worth spending an attempt on, and
   * when the budget is spent - so this cannot hang the call up, and cannot restart
   * ICE without spending from the same bounded ladder as everything else.
   *
   * Android-only, and absent on an older native binary, in which case recovery
   * still runs off the ICE states alone.
   */
  useEffect(() => {
    const nativeModule =
      Platform.OS === 'android'
        ? (NativeModules as Record<string, any>).CallNetwork
        : undefined;
    if (!nativeModule) {
      return;
    }
    const subscription = new NativeEventEmitter(nativeModule).addListener(
      NETWORK_CHANGED_EVENT,
      (payload: any) => {
        const key = payload?.networkKey ?? null;
        console.log(
          '[CallScreen] default network changed',
          key,
          payload?.connected ? 'up' : 'down',
        );
        networkKeyRef.current = key;
        runLinkTickRef.current();
      },
    );
    nativeModule
      .start?.()
      ?.catch((error: unknown) =>
        console.log('[CallScreen] network watch unavailable', error),
      );
    return () => {
      subscription.remove();
      // Never leave a ConnectivityManager callback registered against this process
      // for a call that is over.
      nativeModule.stop?.()?.catch?.(() => {});
    };
  }, []);

  // Set up local media + peer connection.
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        /**
         * The result used to be thrown away, and that is the entire reason the
         * picture-in-picture box was empty. `PermissionsAndroid.requestMultiple`
         * resolves `denied` for a permission the APK never declared - no dialog is
         * shown, nothing is logged - and `react-native-webrtc` then takes that same
         * `denied` at `getUserMedia.ts:71` (`videoPerm || delete constraints.video`)
         * and resolves with an AUDIO-ONLY stream. `toURL()` still returns a valid
         * id, so `RTCView` mounted, `WebRTCView.getVideoTrackForStreamURL` found
         * `stream.videoTracks` empty, logged "No video stream for react tag" and
         * never attached a sink. An empty box, with no error anywhere.
         *
         * Reading the result is what makes that state say so instead of showing
         * nothing. The underlying fix - declaring CAMERA in the manifest - is not
         * this file's to make; see the note next to the preview box.
         */
        let summary = permissionSummaryRef.current;
        if (Platform.OS === 'android') {
          const requested = [
            {
              permission: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
              label: 'microphone',
            },
            ...(type === 'video'
              ? [
                  {
                    permission: PermissionsAndroid.PERMISSIONS.CAMERA,
                    label: 'camera',
                  },
                ]
              : []),
          ];
          const results = await PermissionsAndroid.requestMultiple(
            requested.map(entry => entry.permission),
          );
          summary = summarisePermissionResults(requested, results);
          permissionSummaryRef.current = summary;
        }

        // No microphone means there is no call, and RECORD_AUDIO *is* declared, so
        // `permissionFailureMessage` can be trusted here. A missing camera is NOT
        // fatal: the call still carries audio, and telling someone to go and allow
        // a permission the APK never declared would be advice that cannot work.
        // It surfaces as "No camera" in the preview box instead.
        if (
          summary.refused.includes('microphone') ||
          summary.blocked.includes('microphone')
        ) {
          if (!disposed) {
            setSetupError(permissionFailureMessage(summary) ?? '');
          }
          return;
        }

        const stream = await mediaDevices.getUserMedia({
          audio: true,
          video:
            type === 'video'
              ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 }
              : false,
        });
        if (disposed) {
          // `track.stop()` is JS-only in this library
          // (`MediaStreamTrack.ts:99`) and releases nothing native, so the camera
          // would stay held. `release()` is what actually disposes the capturer.
          releaseLocalStream(stream);
          return;
        }
        localStreamRef.current = stream;
        setLocalURL(stream.toURL());

        // The evidence. A video call whose stream came back audio-only is
        // indistinguishable from a working one at every point above this line.
        console.log(
          `[CallScreen] local tracks ${type}`,
          JSON.stringify(describeLocalTracks(stream)),
        );
        if (!disposed) {
          setVideoMissingReason(missingVideoReason(summary, stream, type === 'video'));
        }

        /**
         * Voice-call audio routing.
         *
         * `MODE_IN_COMMUNICATION` is the part that has to happen (the peer comes
         * out of the speaker instead of the earpiece, and Android's voice-call
         * processing never engages without it), and it is what
         * `CallAudioModule.useDefaultRoute` does.
         *
         * What it used to do INSTEAD of that was `applyAudioRoute(false)`, which
         * is a `setCommunicationDevice(TYPE_BUILTIN_EARPIECE)` on API 31+ and an
         * explicit `isSpeakerphoneOn = false` below it. Both are overrides, and
         * both overrides applied at setup meant a Bluetooth headset or a car kit
         * was ignored for the whole call unless the user noticed and pressed
         * "Earpiece" to turn it off again. The platform already prefers a
         * connected Bluetooth/wired device in communication mode and falls back
         * to the earpiece, so the default is now to express no preference.
         */
        prepareCallAudioRoute().catch(() => {});

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;
        stream
          .getTracks()
          .forEach((track: any) => pc.addTrack(track, stream));

        const pcAny = pc as any;
        const register = (event: string, handler: (payload: any) => void) => {
          pcAny.addEventListener(event, handler);
          pcListenersRef.current.push([event, handler]);
        };

        register('icecandidate', (event: any) => {
          if (event.candidate && token) {
            sendSignal({
              token,
              callId: callId as any,
              kind: 'ice',
              payload: JSON.stringify(event.candidate),
            }).catch(error => {
              // A candidate that cannot be delivered is dropped on the floor with
              // no retry, and the connection then depends entirely on the SDP's
              // own (empty) candidate list. It is worth seeing in the log.
              console.log('[CallScreen] ice send failed', error);
            });
          }
        });
        register('track', (event: any) => {
          const [remoteStream] = event.streams;
          if (!remoteStream) {
            return;
          }
          remoteStreamRef.current = remoteStream;
          // `ontrack` fires once per track, and the audio track's stream has no
          // video in it. Binding `remoteURL` to that one replaced the avatar
          // backdrop with a full-screen empty `RTCView` for any peer on an
          // audio-only device.
          if (remoteStream.getVideoTracks?.().length) {
            setRemoteURL(remoteStream.toURL());
          }
        });
        register('connectionstatechange', () => {
          const state = pcAny.connectionState;
          if (disposed || leavingRef.current) {
            return;
          }
          setPeerState(state ?? null);
          peerStateRef.current = state ?? null;
          // NOT a hangup. `failed` here means "this attempt did not work", and
          // the answer is a bounded ICE restart followed by a recovery window -
          // which is what `runLinkTick` decides. Hanging up on the state event
          // is what made a Wi-Fi->LTE handover end the call outright, and it also
          // told the peer the call was over while this side had barely noticed.
          runLinkTickRef.current();
        });
        // `connectionState` can sit on 'new' indefinitely while ICE is already
        // dead, so the ICE layer is tracked separately - it is the one that
        // actually fails, and it fails first.
        register('iceconnectionstatechange', () => {
          const state = pcAny.iceConnectionState ?? null;
          setIceState(state);
          iceStateRef.current = state;
          runLinkTickRef.current();
        });

        setPcReady(true);
        setPeerState(pcAny.connectionState ?? null);
        peerStateRef.current = pcAny.connectionState ?? null;
        setIceState(pcAny.iceConnectionState ?? null);
        iceStateRef.current = pcAny.iceConnectionState ?? null;

        if (role === 'caller' && token) {
          const offer = await pc.createOffer({});
          await pc.setLocalDescription(offer);
          await sendSignal({
            token,
            callId: callId as any,
            kind: 'offer',
            payload: JSON.stringify(offer),
          });
        }
      } catch (error) {
        console.log('[CallScreen] setup error', error);
        if (!disposed) {
          setSetupError(
            'Could not start your camera and microphone. Check the app permissions.',
          );
        }
      }
    })();

    return () => {
      disposed = true;
      // Remove the listeners BEFORE closing: `close()` fires `closed`, which would
      // otherwise re-enter hangUp() during teardown.
      pcListenersRef.current.forEach(([event, handler]) => {
        try {
          (pcRef.current as any)?.removeEventListener(event, handler);
        } catch {}
      });
      pcListenersRef.current = [];
      try {
        pcRef.current?.close();
      } catch {}
      // Remote tracks belong to the peer connection and are disposed with it;
      // `pc.close()` above has already done that.
      remoteStreamRef.current = null;
      releaseLocalStream(localStreamRef.current);
      localStreamRef.current = null;
      // Everything that belongs to the peer connection rather than to the call
      // has to go with it. Left in place, a rebuilt peer connection would refuse
      // every signal as "already applied" and would queue candidates against a
      // remote description that no longer exists. Currently unreachable - `token`
      // only changes at sign-in/restore/sign-out - but it is a live landmine, and
      // recovery is exactly the kind of change that makes it matter.
      remoteDescSetRef.current = false;
      appliedSignalsRef.current = new Set();
      pendingIceRef.current = [];
    };
    // `hangUp` is deliberately NOT a dependency. It closes over the leaving flag,
    // so putting it here used to re-run this effect - a second getUserMedia(), a
    // second RTCPeerConnection and a second SDP offer for a call being torn down.
  }, [token, callId, type, role, sendSignal]);

  // Apply incoming WebRTC signals exactly once each.
  useEffect(() => {
    if (!pcReady || !signals || !token || !pcRef.current) {
      return;
    }
    const pc: any = pcRef.current;
    (async () => {
      const consumed: string[] = [];
      /**
       * Drain the candidates that arrived before there was a remote description
       * to attach them to.
       *
       * `addIceCandidate` rejects outright when `remoteDescription` is null, so
       * these have to wait. The previous code only drained on the `answer`
       * branch - and a callee never receives an answer, so on the callee side
       * every early candidate sat in the queue permanently. `consumeSignals`
       * then deleted the rows, so there was no second delivery either. The result
       * is that the caller's entire candidate set was discarded on one side and
       * the connection either came up on a host candidate that happened to be
       * reachable or not at all. This is the "sometimes it connects, sometimes
       * it does not".
       */
      const flushPendingIce = async () => {
        const queued = pendingIceRef.current.splice(0);
        for (const candidate of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (error) {
            console.log('[CallScreen] queued candidate rejected', error);
          }
        }
        if (queued.length) {
          console.log(`[CallScreen] flushed ${queued.length} queued candidate(s)`);
        }
      };

      for (const signal of signals) {
        if (appliedSignalsRef.current.has(signal._id)) {
          continue;
        }
        appliedSignalsRef.current.add(signal._id);
        try {
          const payload = JSON.parse(signal.payload);
          if (signal.kind === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            remoteDescSetRef.current = true;
            // BEFORE the answer is sent: the peer's candidates are already
            // queueing on its side, and every one of them is discarded unless we
            // have drained ours by the time it applies them.
            await flushPendingIce();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal({
              token,
              callId: callId as any,
              kind: 'answer',
              payload: JSON.stringify(answer),
            });
          } else if (signal.kind === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            remoteDescSetRef.current = true;
            await flushPendingIce();
          } else if (signal.kind === 'ice') {
            if (remoteDescSetRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(payload)).catch(
                () => {},
              );
            } else {
              pendingIceRef.current.push(payload);
            }
          }
        } catch (error) {
          console.log('[CallScreen] signal error', signal.kind, error);
          // Deliberately NOT consumed. `consumeSignals` DELETES the row, and it
          // used to run for every signal whether or not it had been applied, so a
          // description or candidate that threw was gone for good with no
          // redelivery. Leaving it in the queue lets the next query re-offer it.
          continue;
        }
        consumed.push(signal._id);
      }
      if (consumed.length > 0) {
        consumeSignals({ token, signalIds: consumed as any }).catch(() => {});
      }
    })();
  }, [signals, pcReady, token, callId, sendSignal, consumeSignals]);

  // React to the call lifecycle.
  useEffect(() => {
    if (!call) {
      return;
    }
    if (call.status === 'rejected') {
      // `rejected` and `missed` mean different things to the two sides of the call.
      leave(role === 'caller' ? 'Call declined' : 'Call ended');
    } else if (call.status === 'missed') {
      leave(role === 'caller' ? 'No answer' : 'Missed call');
    } else if (call.status === 'ended') {
      leave('Call ended');
    }
  }, [call?.status, leave, call, role]);

  useEffect(() => {
    if (call?.serverNow) {
      clockOffsetRef.current = deriveClockOffset(call.serverNow, Date.now());
    }
  }, [call?.serverNow]);

  useEffect(() => {
    if (call?.status !== 'active' || !call.answeredAt) {
      return;
    }
    // Seed immediately so an answered call does not paint 00:00 and then jump
    // to the real value a second later.
    const tick = () =>
      setElapsed(
        elapsedSeconds(call.answeredAt, Date.now(), clockOffsetRef.current),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [call?.status, call?.answeredAt]);

  // Caller times out if nobody answers. This timer only runs while JS is running,
  // which is why the same job is also done server-side by `markTimedOut`.
  useEffect(() => {
    if (role !== 'caller' || call?.status !== 'ringing') {
      return;
    }
    const timer = setTimeout(() => {
      hangUpRef.current('No answer');
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [role, call?.status]);

  /**
   * Drives the connection lifecycle once a second.
   *
   * `RING_TIMEOUT_MS` covers the ring only. Once the row flips to `active` the
   * previous code had no deadline at all, and `connectionState` reaching `failed`
   * takes tens of seconds on a mobile network - so a call that was never going to
   * connect sat on "Connecting…" indefinitely with no explanation and no way out
   * but the hang-up button.
   *
   * What it then grew was worse: one instant armed here, never re-armed, and a
   * predicate that read every non-`connected` value as "never going to connect".
   * A ten-minute-old call that dropped on a Wi-Fi->LTE handover was therefore
   * hung up with "Connection failed" inside one tick, and a call younger than the
   * deadline sat on "Reconnecting…" with nothing acting on it at all.
   *
   * The deadline now lives in the lifecycle state (`advanceLink`), is armed per
   * phase and cleared on success, and there is no armed clock at all while the
   * call is up. This effect only supplies the tick; the decisions are made by the
   * same function the `connectionstatechange` / `iceconnectionstatechange`
   * handlers call, so a drop is acted on when it happens rather than up to a
   * second later.
   */
  useEffect(() => {
    if (call?.status !== 'active' || !call.answeredAt) {
      return;
    }
    // Arm once, for the establishing window only. Recovery windows are armed by
    // the state machine itself, on entry to the phase they belong to.
    linkRef.current = initialLinkState(Date.now());
    // ...and the current network becomes this call's baseline. Without this the
    // first network report after a new call would read as a handover and spend an
    // ICE restart on candidates that had just been gathered on it.
    networkKeyRef.current = undefined;
    linkPhaseRef.current = 'connecting';
    setLinkPhase('connecting');
    const timer = setInterval(runLinkTick, 1000);
    runLinkTick();
    return () => clearInterval(timer);
  }, [call?.status, call?.answeredAt, runLinkTick]);

  /**
   * The ongoing-call notification. It did not exist before this: minimising during
   * a call produced nothing at all, so "I may know there's a call but nothing
   * else" was accurate.
   *
   * It is posted when the app is backgrounded and withdrawn when the user comes
   * back, because the call screen already shows everything the notification shows
   * while the app is visible.
   */
  useEffect(() => {
    if (call?.status !== 'active' || !call.answeredAt) {
      return;
    }
    const answeredAt = call.answeredAt;
    setActiveCall({
      callId,
      role,
      peerName,
      type,
      answeredAt,
      clockOffset: clockOffsetRef.current,
    });

    const post = () =>
      showOngoingCallNotification({
        callId,
        peerName,
        type,
        answeredAt,
        clockOffset: clockOffsetRef.current,
      }).catch(() => {});

    // Post straight away when the app is already in the background - a peer can
    // accept while we are minimised, and waiting for the next AppState change
    // would mean no notification at all for a call that is already live.
    if (AppState.currentState !== 'active') {
      post();
    }

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        hideOngoingCallNotification(callId).catch(() => {});
        return;
      }
      post();
    });
    return () => subscription.remove();
  }, [call?.status, call?.answeredAt, callId, peerName, role, type, setActiveCall]);

  /**
   * The notification's Mute and Speaker buttons are dispatched by Notifee outside
   * React. They write to `callMediaState`; this applies the change to the live peer
   * connection and refreshes the notification's action labels.
   *
   * It only refreshes - it never creates. Toggling mute with the on-screen button
   * sets the same flag, and that must not pop a notification over a call the user
   * is already looking at.
   */
  useEffect(() => {
    return callMediaState.subscribe(next => {
      const audioTrack = localStreamRef.current
        ?.getAudioTracks?.()
        ?.find(() => true);
      if (audioTrack) {
        audioTrack.enabled = !next.muted;
      }
      setMuted(next.muted);
      applyAudioRoute(next.speakerOn).catch(() => {});
      refreshOngoingCallActions(callId);
    });
  }, [callId]);

  /**
   * Leaving mid-call used to strand the Convex row in `active` forever: the
   * swipe-back gesture and the hardware back button never called `endCall`, so the
   * peer was never told and the call showed as live in history.
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener(
      'beforeRemove',
      (event: any) => {
        if (leavingRef.current) {
          return;
        }
        if (call?.status !== 'ringing' && call?.status !== 'active') {
          return;
        }
        event.preventDefault();
        Alert.alert('End this call?', 'Leaving will hang up for both of you.', [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'End call',
            style: 'destructive',
            onPress: () => hangUpRef.current(),
          },
        ]);
      },
    );
    return unsubscribe;
  }, [navigation, call?.status]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    const audioTrack = localStreamRef.current
      ?.getAudioTracks?.()
      ?.find(() => true);
    if (audioTrack) {
      audioTrack.enabled = !next;
      setMuted(next);
    }
    callMediaState.set({ muted: next });
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const videoTrack = localStreamRef.current
      ?.getVideoTracks?.()
      ?.find(() => true);
    if (!videoTrack) {
      // The old guard made this button a silent no-op: press it, nothing happens,
      // no indication that the camera was the thing missing.
      Alert.alert(
        videoMissingReason ?? 'No camera',
        'This call has no camera track, so there is nothing to turn on or off.',
      );
      return;
    }
    videoTrack.enabled = cameraOff;
    setCameraOff(!cameraOff);
  }, [cameraOff, videoMissingReason]);

  const flipCamera = useCallback(() => {
    const videoTrack = localStreamRef.current
      ?.getVideoTracks?.()
      ?.find(() => true);
    if (!videoTrack) {
      Alert.alert(
        videoMissingReason ?? 'No camera',
        'There is no camera to switch between on this call.',
      );
      return;
    }
    videoTrack._switchCamera?.();
  }, [videoMissingReason]);

  const statusLabel = connectionStatusLabel({
    notice,
    callStatus: call?.status,
    role,
    peerState,
    iceState,
    linkPhase,
    elapsedLabel: formatElapsed(elapsed),
  });

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      {role === 'caller' && call?.status === 'ringing' && (
        <Video
          source={require('../../assets/sounds/ringback.wav')}
          style={styles.ringbackAudio}
          repeat
          paused={false}
          volume={1}
        />
      )}
      {type === 'video' && remoteURL ? (
        <RTCView
          streamURL={remoteURL}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
        />
      ) : (
        <View style={styles.audioBackdrop}>
          <View
            style={[
              styles.audioAvatar,
              { backgroundColor: theme.colors.primaryContainer },
            ]}
          >
            <UserAvatar
              entity={call?.peer}
              name={peerName}
              size={140}
              variant="text"
              labelStyle={styles.audioInitials}
              labelColor={theme.colors.primary}
            />
          </View>
        </View>
      )}

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Text style={[styles.peerName, { color: theme.colors.onSurface }]}>
            {peerName}
          </Text>
          <Text
            style={[
              styles.status,
              { color: theme.colors.onSurfaceVariant },
              call?.status === 'active' && styles.statusActive,
            ]}
          >
            {statusLabel}
          </Text>
        </View>

        {type === 'video' && localURL && (
          <View
            style={[
              styles.localPreview,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
          >
            <RTCView
              streamURL={localURL}
              style={styles.localPreviewInner}
              objectFit="cover"
              mirror
              zOrder={1}
            />
            {/*
              An audio-only local stream still produces a perfectly valid
              `streamURL`, so `RTCView` mounts and renders nothing into the box.
              Saying so here is the only difference between "the app is broken"
              and "this phone did not grant the camera".
            */}
            {videoMissingReason && (
              <View
                style={[
                  styles.localPreviewNotice,
                  { backgroundColor: theme.colors.scrim },
                ]}
                pointerEvents="none"
              >
                <Text
                  style={[
                    styles.localPreviewNoticeText,
                    { color: theme.colors.onSurface },
                  ]}
                  numberOfLines={2}
                >
                  {videoMissingReason}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.controls}>
          <TouchableOpacity
            style={[
              styles.controlButton,
              {
                backgroundColor: muted
                  ? theme.colors.primary
                  : theme.colors.surfaceVariant,
              },
            ]}
            onPress={toggleMute}
          >
            <MaterialDesignIcons
              name={muted ? 'microphone-off' : 'microphone'}
              size={26}
              color={muted ? theme.colors.onPrimary : theme.colors.onSurface}
            />
          </TouchableOpacity>

          {type === 'video' && (
            <>
              <TouchableOpacity
                style={[
                  styles.controlButton,
                  {
                    backgroundColor: cameraOff
                      ? theme.colors.primary
                      : theme.colors.surfaceVariant,
                  },
                ]}
                onPress={toggleCamera}
              >
                <MaterialDesignIcons
                  name={cameraOff ? 'video-off' : 'video'}
                  size={26}
                  color={
                    cameraOff ? theme.colors.onPrimary : theme.colors.onSurface
                  }
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.controlButton,
                  { backgroundColor: theme.colors.surfaceVariant },
                ]}
                onPress={flipCamera}
              >
                <MaterialDesignIcons
                  name="camera-flip-outline"
                  size={26}
                  color={theme.colors.onSurface}
                />
              </TouchableOpacity>
            </>
          )}

          {/*
            Hangup used to be a hardcoded red, the only hue anywhere in this
            product. It now reads as "the filled one" against the outlined
            mute/camera controls, which is the same affordance the ring screen
            uses for Accept/Decline.
          */}
          <TouchableOpacity
            style={[
              styles.controlButton,
              { backgroundColor: theme.colors.primary },
            ]}
            onPress={() => hangUp()}
          >
            <MaterialDesignIcons
              name="phone-hangup"
              size={26}
              color={theme.colors.onPrimary}
            />
          </TouchableOpacity>
        </View>

        {!pcReady && !setupError && (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        )}
        {setupError && (
          <View style={styles.setupError}>
            <Text style={[styles.setupErrorText, { color: theme.colors.onSurface }]}>
              {setupError}
            </Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
};

export default CallScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  ringbackAudio: {
    width: 0,
    height: 0,
    position: 'absolute',
  },
  audioBackdrop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioAvatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioInitials: {
    fontSize: 48,
    fontWeight: '700',
  },
  safe: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    alignItems: 'center',
    paddingTop: 24,
  },
  peerName: {
    fontSize: 24,
    fontWeight: '700',
  },
  status: {
    fontSize: 15,
    marginTop: 6,
  },
  statusActive: {
    fontSize: 17,
  },
  hint: {
    fontSize: 14,
    marginTop: 6,
  },
  localPreview: {
    position: 'absolute',
    right: 16,
    top: 100,
    width: 110,
    height: 160,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  localPreviewInner: {
    flex: 1,
  },
  localPreviewNotice: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    opacity: 0.85,
  },
  localPreviewNoticeText: {
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 32,
    gap: 16,
  },
  controlButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
  },
  setupError: {
    position: 'absolute',
    bottom: 120,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  setupErrorText: {
    fontSize: 14,
    textAlign: 'center',
  },
});