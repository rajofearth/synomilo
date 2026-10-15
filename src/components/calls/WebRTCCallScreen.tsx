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
  releaseAudioRoute,
} from '../../notifications/callMediaState';
import { useCallStore } from './callStore';
import {
  deriveClockOffset,
  elapsedSeconds,
  formatElapsed,
} from '../../utils/callDuration';

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/** Mirrors convex/calls.ts RING_TIMEOUT_MS. */
const RING_TIMEOUT_MS = 60000;
/** How long a terminal message ("Call declined") stays on screen before popping. */
const NOTICE_MS = 1600;

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
      hideOngoingCallNotification(callId).catch(() => {});
      setActiveCall(null);
      leave(reason);
    },
    [token, endCall, callId, leave, setActiveCall],
  );

  useEffect(() => {
    hangUpRef.current = hangUp;
  });

  // Leave the teardown of the ongoing notification to `hangUp` and unmount only:
  // this effect must not re-run on every status change and cancel a notification
  // that is about to be shown again.
  useEffect(
    () => () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      hideOngoingCallNotification(callId).catch(() => {});
      setActiveCall(null);
      releaseAudioRoute();
    },
    [callId, setActiveCall],
  );

  // Set up local media + peer connection.
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        if (Platform.OS === 'android') {
          await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]);
        }
        const stream = await mediaDevices.getUserMedia({
          audio: true,
          video:
            type === 'video'
              ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 }
              : false,
        });
        if (disposed) {
          stream.getTracks().forEach((track: any) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalURL(stream.toURL());

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
            }).catch(() => {});
          }
        });
        register('track', (event: any) => {
          const [remoteStream] = event.streams;
          if (remoteStream) {
            remoteStreamRef.current = remoteStream;
            setRemoteURL(remoteStream.toURL());
          }
        });
        register('connectionstatechange', () => {
          const state = pcAny.connectionState;
          if (disposed || leavingRef.current) {
            return;
          }
          if (state === 'failed' || state === 'closed') {
            // Previously a silent hang: the connection dropped and the user saw the
            // screen simply go away with no explanation.
            hangUpRef.current('Call ended · connection lost');
          }
        });

        setPcReady(true);

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
      remoteStreamRef.current
        ?.getTracks?.()
        .forEach((track: any) => track.stop());
      remoteStreamRef.current = null;
      localStreamRef.current
        ?.getTracks?.()
        .forEach((track: any) => track.stop());
      localStreamRef.current = null;
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
            for (const candidate of pendingIceRef.current.splice(0)) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(
                () => {},
              );
            }
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
    if (videoTrack) {
      videoTrack.enabled = cameraOff;
      setCameraOff(!cameraOff);
    }
  }, [cameraOff]);

  const flipCamera = useCallback(() => {
    const videoTrack = localStreamRef.current
      ?.getVideoTracks?.()
      ?.find(() => true);
    videoTrack?._switchCamera?.();
  }, []);

  const statusLabel = notice
    ? notice
    : call?.status === 'active'
      ? formatElapsed(elapsed)
      : call?.status === 'ringing'
        ? role === 'caller'
          ? 'Ringing…'
          : 'Connecting…'
        : call
          ? 'Call ended'
          : 'Connecting…';

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