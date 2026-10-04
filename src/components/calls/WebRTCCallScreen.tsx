import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { useTheme } from '@cometchat/chat-uikit-react-native';
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
import { convexErrorMessage } from '../../utils/convexError';
import { dismissCallNotification } from '../../notifications/callNotifications';

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
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
  const pendingIceRef = useRef<any[]>([]);
  const remoteDescSetRef = useRef(false);
  const appliedSignalsRef = useRef<Set<string>>(new Set());

  const [pcReady, setPcReady] = useState(false);
  const [localURL, setLocalURL] = useState<string | null>(null);
  const [remoteURL, setRemoteURL] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    dismissCallNotification(callId);
  }, [callId]);

  const leave = useCallback(
    (message?: string) => {
      if (leaving) {
        return;
      }
      setLeaving(true);
      navigation.goBack();
    },
    [leaving, navigation],
  );

  const hangUp = useCallback(async () => {
    if (token) {
      endCall({ token, callId: callId as any }).catch(() => {});
    }
    leave();
  }, [token, endCall, callId, leave]);

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
        pcAny.addEventListener('icecandidate', (event: any) => {
          if (event.candidate && token) {
            sendSignal({
              token,
              callId: callId as any,
              kind: 'ice',
              payload: JSON.stringify(event.candidate),
            }).catch(() => {});
          }
        });
        pcAny.addEventListener('track', (event: any) => {
          const [remoteStream] = event.streams;
          if (remoteStream) {
            setRemoteURL(remoteStream.toURL());
          }
        });
        pcAny.addEventListener('connectionstatechange', () => {
          const state = pcAny.connectionState;
          if (state === 'failed' || state === 'closed') {
            hangUp();
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
      }
    })();

    return () => {
      disposed = true;
      try {
        pcRef.current?.close();
      } catch {}
      localStreamRef.current
        ?.getTracks?.()
        .forEach((track: any) => track.stop());
    };
  }, [token, callId, type, role, sendSignal, hangUp]);

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
    if (call.status === 'rejected' || call.status === 'missed' || call.status === 'ended') {
      leave();
    }
  }, [call?.status, leave, call]);

  useEffect(() => {
    if (call?.status !== 'active' || !call.answeredAt) {
      return;
    }
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - call.answeredAt!) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [call?.status, call?.answeredAt]);

  // Caller times out if nobody answers.
  useEffect(() => {
    if (role !== 'caller' || call?.status !== 'ringing') {
      return;
    }
    const timer = setTimeout(() => {
      hangUp();
    }, 60000);
    return () => clearTimeout(timer);
  }, [role, call?.status, hangUp]);

  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current
      ?.getAudioTracks?.()
      ?.find(() => true);
    if (audioTrack) {
      audioTrack.enabled = muted;
      setMuted(value => !value);
    }
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const videoTrack = localStreamRef.current
      ?.getVideoTracks?.()
      ?.find(() => true);
    if (videoTrack) {
      videoTrack.enabled = cameraOff;
      setCameraOff(value => !value);
    }
  }, [cameraOff]);

  const flipCamera = useCallback(() => {
    const videoTrack = localStreamRef.current
      ?.getVideoTracks?.()
      ?.find(() => true);
    videoTrack?._switchCamera?.();
  }, []);

  const formatElapsed = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const statusLabel =
    call?.status === 'active'
      ? formatElapsed(elapsed)
      : call?.status === 'ringing'
        ? role === 'caller'
          ? 'Ringing…'
          : 'Connecting…'
        : 'Call ended';

  return (
    <View
      style={[styles.container, { backgroundColor: theme.color.background1 }]}
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
              { backgroundColor: theme.color.extendedPrimary50 },
            ]}
          >
            <Text style={[styles.audioInitials, { color: theme.color.primary }]}>
              {peerName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(part => part[0]?.toUpperCase() ?? '')
                .join('')}
            </Text>
          </View>
        </View>
      )}

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Text style={[styles.peerName, { color: theme.color.textPrimary }]}>
            {peerName}
          </Text>
          <Text
            style={[
              styles.status,
              { color: theme.color.textSecondary },
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
              { backgroundColor: theme.color.background3 },
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
                  ? theme.color.primary
                  : theme.color.background3,
              },
            ]}
            onPress={toggleMute}
          >
            <MaterialDesignIcons
              name={muted ? 'microphone-off' : 'microphone'}
              size={26}
              color={muted ? '#FFFFFF' : theme.color.textPrimary}
            />
          </TouchableOpacity>

          {type === 'video' && (
            <>
              <TouchableOpacity
                style={[
                  styles.controlButton,
                  {
                    backgroundColor: cameraOff
                      ? theme.color.primary
                      : theme.color.background3,
                  },
                ]}
                onPress={toggleCamera}
              >
                <MaterialDesignIcons
                  name={cameraOff ? 'video-off' : 'video'}
                  size={26}
                  color={cameraOff ? '#FFFFFF' : theme.color.textPrimary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.controlButton,
                  { backgroundColor: theme.color.background3 },
                ]}
                onPress={flipCamera}
              >
                <MaterialDesignIcons
                  name="camera-flip-outline"
                  size={26}
                  color={theme.color.textPrimary}
                />
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={[styles.controlButton, { backgroundColor: '#E5484D' }]}
            onPress={hangUp}
          >
            <MaterialDesignIcons name="phone-hangup" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {!pcReady && (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.color.primary} />
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
});
