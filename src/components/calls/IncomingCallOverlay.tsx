import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { navigate } from '../../navigation/NavigationService';
import { convexErrorMessage } from '../../utils/convexError';
import {
  dismissAllCallNotifications,
  dismissCallNotification,
} from '../../notifications/callNotifications';

const IncomingCallOverlay: React.FC = () => {
  const { token } = useSession();
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const incoming = useQuery(
    api.calls.incoming,
    token ? { token } : 'skip',
  ) as
    | {
        _id: string;
        type: 'audio' | 'video';
        caller: { displayName: string } | null;
      }
    | null
    | undefined;
  const incomingId = incoming?._id ?? null;
  const acceptCall = useMutation(api.calls.accept);
  const rejectCall = useMutation(api.calls.reject);
  const [busy, setBusy] = useState(false);

  const accept = useCallback(async () => {
    if (!token || !incoming || busy) {
      return;
    }
    setBusy(true);
    try {
      await acceptCall({ token, callId: incoming._id as any });
      dismissCallNotification(incoming._id);
      const callerName = incoming.caller?.displayName ?? 'Unknown';
      navigate('CallScreen', {
        callId: incoming._id,
        type: incoming.type,
        role: 'callee',
        peerName: callerName,
      });
    } catch (error) {
      Alert.alert(
        'Could not answer',
        convexErrorMessage(error, 'The call may have ended.'),
      );
    } finally {
      setBusy(false);
    }
  }, [token, incoming, busy, acceptCall]);

  const decline = useCallback(async () => {
    if (!token || !incoming || busy) {
      return;
    }
    setBusy(true);
    try {
      await rejectCall({ token, callId: incoming._id as any });
      dismissCallNotification(incoming._id);
    } catch {} finally {
      setBusy(false);
    }
  }, [token, incoming, busy, rejectCall]);

  useEffect(() => {
    if (!incoming) {
      dismissAllCallNotifications();
    }
  }, [incoming?._id]);

  useEffect(() => {
    if (!incomingId) {
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [incomingId, pulse]);

  if (!incoming) {
    return null;
  }

  const callerName = incoming.caller?.displayName ?? 'Unknown';
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  return (
    <View
      style={[styles.backdrop, { backgroundColor: theme.color.background1 }]}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <Text
            style={[styles.callingLabel, { color: theme.color.textSecondary }]}
          >
            Incoming {incoming.type === 'video' ? 'video' : 'voice'} call
          </Text>
          <View style={styles.avatarWrap}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  borderColor: theme.color.primary,
                  transform: [{ scale: pulseScale }],
                },
              ]}
            />
            <View
              style={[
                styles.avatar,
                { backgroundColor: theme.color.extendedPrimary50 },
              ]}
            >
              <Text style={[styles.avatarText, { color: theme.color.primary }]}>
                {callerName
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map(part => part[0]?.toUpperCase() ?? '')
                  .join('')}
              </Text>
            </View>
          </View>
          <Text style={[styles.name, { color: theme.color.textPrimary }]}>
            {callerName}
          </Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.action}>
            <TouchableOpacity
              style={[styles.actionButton, styles.declineButton]}
              onPress={decline}
              disabled={busy}
            >
              <MaterialDesignIcons
                name="phone-hangup"
                size={30}
                color="#FFFFFF"
              />
            </TouchableOpacity>
            <Text
              style={[styles.actionLabel, { color: theme.color.textPrimary }]}
            >
              Decline
            </Text>
          </View>
          <View style={styles.action}>
            <TouchableOpacity
              style={[styles.actionButton, styles.acceptButton]}
              onPress={accept}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <MaterialDesignIcons name="phone" size={30} color="#FFFFFF" />
              )}
            </TouchableOpacity>
            <Text
              style={[styles.actionLabel, { color: theme.color.textPrimary }]}
            >
              Accept
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
};

export default IncomingCallOverlay;

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  safe: {
    flex: 1,
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callingLabel: {
    fontSize: 16,
    marginBottom: 24,
  },
  avatarWrap: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    opacity: 0.5,
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 48,
    fontWeight: '700',
  },
  name: {
    fontSize: 26,
    fontWeight: '700',
    marginTop: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingBottom: 56,
  },
  action: {
    alignItems: 'center',
  },
  actionButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButton: {
    backgroundColor: '#E5484D',
  },
  acceptButton: {
    backgroundColor: '#2FBF71',
  },
  actionLabel: {
    fontSize: 13,
    marginTop: 8,
  },
});
