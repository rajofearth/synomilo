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
import { useTheme } from 'react-native-paper';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { navigate } from '../../navigation/NavigationService';
import { convexErrorMessage } from '../../utils/convexError';
import UserAvatar from '../convex/UserAvatar';
import { reconcileCallNotifications } from '../../notifications/callNotifications';
import { teardownRinging } from '../../notifications/background';

/**
 * The in-app half of incoming-call UI, shown when the user is already in the app.
 *
 * The other half - the lock-screen ring activity - is the SAME state machine seen
 * from outside the app: one Convex query (`calls.incoming`) and one ringing
 * Notifee notification, in both cases. This overlay used to suppress that
 * notification entirely while the app was visible, which meant a call arriving
 * with the app open produced a silent card and nothing else. It now leaves the
 * ringing notification alone and only owns the Accept/Decline decision, which is
 * why nothing here cancels the notification on an AppState change any more.
 */
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
        caller: {
          _id: string;
          displayName: string;
          username: string;
          avatarUrl: string | null;
        } | null;
      }
    | null
    | undefined;
  const incomingId = incoming?._id ?? null;
  // `useQuery` returns undefined while the first result is in flight; null once it
  // has resolved to "nothing ringing". Distinguishing the two is what stops the
  // mount-time cancel from firing before the server has been asked.
  const querySettled = incoming !== undefined;
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
      navigate('CallScreen', {
        callId: incoming._id,
        type: incoming.type,
        role: 'callee',
        peerName: callerNameOf(incoming),
      });
    } catch (error) {
      Alert.alert(
        'Could not answer',
        convexErrorMessage(error, 'The call may have ended.'),
      );
    } finally {
      // `finally`, not the success path. The teardown used to sit after
      // `await acceptCall(...)`, so a mutation that threw - a dropped connection, or
      // accept's "You are already on another call" - jumped straight to `catch` and
      // left the ringing notification alive and looping. `accept` throws for reasons
      // that have nothing to do with whether the user answered, and either way the
      // ringing UI is gone: the user made a decision. The call itself is already
      // terminal in the server's view in most of these cases.
      //
      // `dismissActivity: false` - there is no ring activity over a foreground app.
      // Everything a ring puts up comes down here: notification, deferred accept.
      await teardownRinging(incoming._id, false).catch(() => {});
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
    } catch {
      // Swallowed, as before: declining is always allowed, and a rejected mutation
      // means the call was already gone.
    } finally {
      // Same reason as `accept`: the ring must come down whatever the server says.
      // `catch {}` here used to swallow the mutation error *and* skip this line.
      await teardownRinging(incoming._id, false).catch(() => {});
      setBusy(false);
    }
  }, [token, incoming, busy, rejectCall]);

  /**
   * Reconcile the OS notification against the live query.
   *
   * The old version read `incoming` but depended on `incoming?._id`, so the first
   * run - where `incoming` is still `undefined`, before the query has ever returned
   * - cancelled every `call:*` notification in the tray. This component mounts on
   * every sign-in, so a sign-in that raced an incoming call silently killed the
   * ring.
   *
   * Scoped to `call:*` rather than "all call notifications" on purpose: an ongoing
   * call is a different notification with a different lifetime, and this effect
   * must not be able to tear down the notification for a call already connected.
   */
  useEffect(() => {
    if (incomingId) {
      return;
    }
    if (querySettled) {
      reconcileCallNotifications([]);
    }
  }, [incomingId, querySettled]);

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

  const callerName = callerNameOf(incoming);
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });

  return (
    <View
      style={[styles.backdrop, { backgroundColor: theme.colors.background }]}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <Text
            style={[styles.eyebrow, { color: theme.colors.onSurfaceVariant }]}
          >
            Incoming call
          </Text>
          <View style={styles.avatarWrap}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  borderColor: theme.colors.outline,
                  transform: [{ scale: pulseScale }],
                },
              ]}
            />
            <View
              style={[
                styles.avatar,
                { backgroundColor: theme.colors.primaryContainer },
              ]}
            >
              <UserAvatar
                entity={incoming.caller}
                name={callerName}
                size={140}
                variant="text"
                labelStyle={styles.avatarText}
                labelColor={theme.colors.onPrimaryContainer}
              />
            </View>
          </View>
          <Text style={[styles.name, { color: theme.colors.onSurface }]}>
            {callerName}
          </Text>
        </View>

        {/*
          The same two affordances the lock-screen ring screen draws, in the same
          order and the same treatment, so the foreground and background paths feel
          like one thing. Achromatic only: the pair used to be red and green, which
          is the only colour in this product.
        */}
        <View style={styles.actions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Decline call"
            disabled={busy}
            onPress={decline}
            style={[
              styles.pill,
              {
                borderColor: theme.colors.outline,
                backgroundColor: theme.colors.surfaceVariant,
              },
              busy && styles.pillDisabled,
            ]}
          >
            <Text
              style={[styles.pillLabel, { color: theme.colors.onSurface }]}
            >
              Decline
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Accept call"
            disabled={busy}
            onPress={accept}
            style={[
              styles.pill,
              { backgroundColor: theme.colors.primary },
              busy && styles.pillDisabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.onPrimary} />
            ) : (
              <Text
                style={[styles.pillLabel, { color: theme.colors.onPrimary }]}
              >
                Accept
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

/**
 * The caller's name, or the state of the call when there is no name.
 *
 * `calls.incoming` joins the caller through `publicUser`, which always carries
 * `displayName`; the fallbacks are for the window between the row being created
 * and the user document existing. "Unknown" as a rendered string is never the
 * right answer - it reads as a bug, which is exactly how it was reported.
 */
const callerNameOf = (call: {
  caller?: { displayName?: string | null; username?: string | null } | null;
}): string =>
  call.caller?.displayName?.trim() ||
  call.caller?.username?.trim() ||
  'Incoming call';

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
  eyebrow: {
    fontSize: 13,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 24,
  },
  avatarWrap: {
    width: 148,
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 2,
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 44,
    fontWeight: '700',
  },
  name: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 24,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 56,
  },
  pill: {
    flex: 1,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillDisabled: {
    opacity: 0.5,
  },
  pillLabel: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
