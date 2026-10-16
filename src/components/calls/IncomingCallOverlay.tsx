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
  AppState,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from 'react-native-paper';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { navigate } from '../../navigation/NavigationService';
import { convexErrorMessage } from '../../utils/convexError';
import UserAvatar from '../convex/UserAvatar';
import {
  dismissCallNotification,
  reconcileCallNotifications,
  showIncomingCallNotification,
} from '../../notifications/callNotifications';
import { teardownRinging } from '../../notifications/background';
import { IncomingCallRingBridge } from '../../notifications/foregroundRinging';

/**
 * The in-app half of incoming-call UI, shown when the user is already in the app.
 * It is also, in this state, the thing that RINGS.
 *
 * The other half - the lock-screen ring activity - is the SAME state machine seen
 * from outside the app: one Convex query (`calls.incoming`) and one ringing
 * Notifee notification, in both cases.
 *
 * ## The ring is owned by whoever is on screen
 *
 * This component used to delegate ringing to the notification channel in every
 * state, which is right for a backgrounded app and wrong for a visible one, for
 * two reasons:
 *
 *   1. An overlay on top of a looping notification is a ring the user cannot
 *      silence, and a notification whose Accept/Decline buttons duplicate the
 *      card directly behind it.
 *   2. Far worse, every path that cancels that notification then removes the
 *      ONLY sound in the app. `teardownRinging` cancels the notification - which
 *      is what stops the channel sound and the vibration - and this component
 *      had nothing to replace it with. Accepting, declining, or the stale-ring
 *      reconcile firing while the app was open therefore produced a call that
 *      was still ringing, silently. That is the reported bug.
 *
 * So while the overlay is up it owns the ring itself (see
 * `IncomingCallRingBridge`) and cancels the notification channel; the moment the
 * app stops being visible it hands the ring back, because a native ring owned by
 * a suspended JS runtime can neither show a ring screen over the keyguard nor
 * be stopped by a terminal push. See the AppState effect below.
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

  /**
   * Everything a ring puts up comes down, in the order that matters: the sound
   * first, then the notification, then the deferred accept.
   *
   * The sound goes FIRST and unconditionally, before the mutation is even sent.
   * `teardownRinging` cancels the ringing notification, which is what stops the
   * channel sound and the vibration - and since this overlay owns the ring while
   * it is on screen, cancelling the notification on its own would silence a call
   * the user is still being invited to answer. The user has pressed a button;
   * that decision is final whatever the server says, so the ring stops here and
   * not after a round trip.
   *
   * `dismissActivity: false` - there is no ring activity over a foreground app.
   */
  const silenceRing = useCallback((callId: string) => {
    IncomingCallRingBridge.stop(callId).catch(() => {});
    return teardownRinging(callId, false).catch(() => {});
  }, []);

  const accept = useCallback(async () => {
    if (!token || !incoming || busy) {
      return;
    }
    setBusy(true);
    await silenceRing(incoming._id);
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
      // Belt and braces. `silenceRing` above has already stopped everything, and
      // this second pass is the one that still holds if the handler is entered by
      // a path that skipped it - it is idempotent by construction, so it costs
      // nothing when it has nothing to do.
      await teardownRinging(incoming._id, false).catch(() => {});
      setBusy(false);
    }
  }, [token, incoming, busy, acceptCall, silenceRing]);

  const decline = useCallback(async () => {
    if (!token || !incoming || busy) {
      return;
    }
    setBusy(true);
    await silenceRing(incoming._id);
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
  }, [token, incoming, busy, rejectCall, silenceRing]);

  /**
   * Start ringing for this call, and take the notification channel out of the
   * business.
   *
   * Order matters. The ring starts first so that a call whose notification was
   * already posted (it arrives over FCM before this query can possibly have
   * delivered it) never has a window in which it is neither ringing nor
   * answered; the notification is cancelled immediately afterwards so the two
   * owners never overlap audibly.
   *
   * The cleanup is the only thing that stops a ring nobody decided on - the
   * server timeout, a remote decline, the query going quiet - and it stops it by
   * callId, so an unmount racing a different call cannot silence that call.
   */
  useEffect(() => {
    if (!incomingId) {
      return;
    }
    IncomingCallRingBridge.start(incomingId).catch(() => {});
    dismissCallNotification(incomingId);
    return () => {
      IncomingCallRingBridge.stop(incomingId).catch(() => {});
    };
  }, [incomingId]);

  /**
   * Hand the ring between its two owners when the app stops being visible.
   *
   * Not optional, and this is the half of the ownership rule that is easy to
   * miss. A native ring belongs to a JS runtime that Android may suspend at any
   * moment, so if the user swipes away from a call that arrived in the
   * foreground:
   *
   *   - nothing can show a ring screen over the lock screen, because that is the
   *     notification's full-screen intent and there is no notification;
   *   - a terminal push (caller hung up, the 60s window expired) arrives in a
   *     headless task with no way to reach this component, so the sound would
   *     play on past the end of the call;
   *   - if the process is killed the ring dies with it and the user is left with
   *     a call they can neither answer nor decline.
   *
   * So going to `background` posts the ringing notification - full-screen intent,
   * Accept/Decline buttons and all - and only then stops the native ring.
   * Coming back to `active` reverses it, and is gated on having actually handed
   * it over so that a notification-shade pull, which Android reports as
   * `inactive` and then `active`, cannot restart the ringtone from its first bar.
   */
  const ringIsWithNotification = useRef(false);
  useEffect(() => {
    if (!incomingId) {
      ringIsWithNotification.current = false;
      return;
    }
    const call = incoming;
    let subscription: { remove: () => void } | undefined;
    try {
      subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'background') {
          if (ringIsWithNotification.current) {
            return;
          }
          ringIsWithNotification.current = true;
          showIncomingCallNotification({
            callId: incomingId,
            callerName: call ? callerNameOf(call) : '',
            type: call?.type ?? 'audio',
          })
            .then(() => IncomingCallRingBridge.stop(incomingId))
            // The handover failed, so the native ring is still ours. Nothing to
            // undo: it is already the one thing ringing.
            .catch(() => {
              ringIsWithNotification.current = false;
            });
          return;
        }
        if (state === 'active' && ringIsWithNotification.current) {
          ringIsWithNotification.current = false;
          dismissCallNotification(incomingId);
          IncomingCallRingBridge.start(incomingId).catch(() => {});
        }
      });
    } catch {
      // A runtime with no AppState emitter still rings; it just cannot hand over.
    }
    return () => {
      subscription?.remove();
    };
  }, [incomingId, incoming]);

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
   *
   * Safe to run at any time now, including while a call is ringing in this
   * window: while the overlay is up it owns the ring and no ringing notification
   * exists, so there is nothing here that can silence a live call.
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
