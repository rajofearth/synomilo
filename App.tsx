import './gesture-handler';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, AppState, NativeModules } from 'react-native';
import { ConvexProvider, useMutation, useQuery } from 'convex/react';
import { Button, Dialog, PaperProvider, Portal, Text, useTheme } from 'react-native-paper';
import { useAppPaperTheme } from './src/theme/useAppTheme';
import AppLock, { useIsAppLockActive } from './src/components/security/AppLock';
import {
  canRingOverLockScreen,
  requestRingOverLockScreen,
} from './src/notifications/lockScreenRinging';
import UpdateChecker from './src/updater/UpdateChecker';

import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import RootStackNavigator from './src/navigation/RootStackNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { convex } from './src/convex/client';
import { SessionProvider, useSession } from './src/auth/SessionProvider';
import IncomingCallOverlay from './src/components/calls/IncomingCallOverlay';
import {
  getFcmToken,
  onNotificationTap,
  onTokenRefresh,
  requestPushPermission,
} from './src/notifications/push';
import {
  dismissCallNotification,
  ensureNotificationChannels,
  reconcileCallNotifications,
} from './src/notifications/callNotifications';
import {
  handleOngoingCallAction,
  ONGOING_ACTION_HANGUP,
  ONGOING_ACTION_MUTE,
  ONGOING_ACTION_SPEAKER,
} from './src/notifications/ongoingCall';
import {
  consumePendingCall,
  handleDataMessage,
  teardownRinging,
} from './src/notifications/background';
import OngoingCallBar from './src/components/calls/OngoingCallBar';
import { isOngoingCall, useCallStore } from './src/components/calls/callStore';
import notifee, { EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { api } from './convex/_generated/api';
import { navigate } from './src/navigation/NavigationService';

const AppInner = (): React.ReactElement => {
  const paperTheme = useTheme();

  const { user: sessionUser, isLoading: sessionLoading, token } = useSession();
  const isLoggedIn = !!sessionUser;
  const appLockActive = useIsAppLockActive();
  const setPushToken = useMutation(api.users.setPushToken);
  const acceptCall = useMutation(api.calls.accept);
  const rejectCall = useMutation(api.calls.reject);

  /**
   * The server's view of "is anything ringing for me", used only to cancel stale
   * `call:*` notifications on resume. There is no terminal push from the server
   * today (convex/calls.ts `end`/`markTimedOut` schedule none), so a phone that was
   * offline for a call keeps a ring until its own 60s timeout expires - and
   * answering it then fails with "This call is no longer ringing".
   */
  const incomingCallForReconcile = useQuery(
    api.calls.incoming,
    token && sessionUser ? { token } : 'skip',
  ) as { _id: string } | null | undefined;

  /**
   * Four independent accept-then-navigate paths existed (system notification tap,
   * deferred headless accept, notifee foreground press, and the lock-screen ring
   * activity), none of them deduplicated. Two of them could fire for the same call
   * and push two CallScreens, which mounted two RTCPeerConnections and two SDP
   * offers. This is the single place a call screen is opened from, with a short
   * window guard.
   */
  const lastOpenedCall = useRef<{ callId: string; at: number } | null>(null);
  /** Latest FCM token seen, so a rotation while logged out is still captured. */
  const fcmTokenRef = useRef<string | null>(null);
  const openCallScreen = useCallback(
    (next: {
      callId: string;
      type?: string;
      role?: 'caller' | 'callee';
      peerName?: string;
    }) => {
      const store = useCallStore.getState();
      if (
        store.screenVisible &&
        store.active?.callId === next.callId
      ) {
        return;
      }
      const previous = lastOpenedCall.current;
      if (
        previous &&
        previous.callId === next.callId &&
        Date.now() - previous.at < 5000
      ) {
        return;
      }
      lastOpenedCall.current = { callId: next.callId, at: Date.now() };
      navigate('CallScreen', {
        callId: next.callId,
        type: next.type === 'video' ? 'video' : 'audio',
        role: next.role ?? 'callee',
        peerName: next.peerName?.trim() || 'Incoming call',
      });
    },
    [],
  );

  /**
   * Push-token registration.
   *
   * This used to `return` before `getFcmToken()` whenever the OS notification
   * prompt came back denied, so a single dismissed Android 13+ prompt made the
   * device permanently unreachable: the token was never stored, and
   * `convex/calls.ts start` silently skips the push when `callee.pushToken` is
   * falsy. The OS permission governs DISPLAY, not DELIVERY.
   *
   * It also only ran on login, and only after a full permission round trip, so a
   * token that rotated while the app was logged out was never captured. The
   * `onTokenRefresh` listener is now registered unconditionally - independent of
   * any session - and the token is re-read on every launch and on every return to
   * the foreground, which is what recovers a token lost while logged out.
   */
  useEffect(() => {
    let cancelled = false;
    let unsubRefresh: (() => void) | undefined;

    const store = (sessionToken: string | null, value: string | null) => {
      fcmTokenRef.current = value;
      if (!sessionToken || !value) {
        return;
      }
      setPushToken({ token: sessionToken, pushToken: value }).catch(error => {
        console.warn('[push] could not store FCM token', error);
      });
    };

    (async () => {
      const granted = await requestPushPermission();
      if (!granted) {
        // Not fatal and not a reason to skip: the token is registered anyway and
        // the user can still be reached for a call once they enable notifications.
        console.warn(
          '[push] notification permission not granted; registering the token anyway',
        );
      }
      if (cancelled) {
        return;
      }
      store(token ?? null, await getFcmToken());
    })();

    unsubRefresh = onTokenRefresh(nextToken => {
      store(token ?? null, nextToken);
    });

    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        return;
      }
      getFcmToken().then(value => {
        if (!cancelled && value && value !== fcmTokenRef.current) {
          store(token ?? null, value);
        }
      });
    });

    return () => {
      cancelled = true;
      subscription.remove();
      unsubRefresh?.();
    };
  }, [token, setPushToken]);

  /**
   * Notification taps (warm and cold) into the Convex chat screens and the call
   * screen. Separate from token registration so that a denied permission cannot
   * take the navigation handlers down with it.
   */
  useEffect(() => {
    const sessionToken = sessionUser?._id ? token : null;
    if (!sessionToken) {
      return;
    }
    let unsubTap: (() => void) | undefined;

    (async () => {
      const openFromData = (data: Record<string, string>) => {
        if (data.type === 'message' && data.conversationId) {
          navigate(
            'Messages' as never,
            { conversationId: data.conversationId } as never,
          );
          return;
        }
        if (data.type === 'call' && data.callId) {
          // A body tap on a ringing notification opens the call screen; it does
          // not auto-accept on the caller's behalf any more.
          dismissCallNotification(data.callId);
          openCallScreen({
            callId: data.callId,
            type: data.callType,
            role: 'callee',
            peerName: data.callerName,
          });
        }
      };
      unsubTap = onNotificationTap(openFromData, openFromData);
    })();

    return () => {
      unsubTap?.();
    };
  }, [sessionUser?._id, token, openCallScreen]);

  /**
   * Notification channels + in-app ringing for calls that arrive while the
   * app is open.
   *
   * `messaging().onMessage` only fires while the app is visible, which makes this
   * the one place where it is safe to test `AppState` and skip the OS notification:
   * `IncomingCallOverlay` is already showing a full-screen Accept/Decline card for
   * the same call. Posting both gave the user two racing Accept buttons.
   */
  useEffect(() => {
    ensureNotificationChannels().catch(() => {});
    const unsubscribe = messaging().onMessage(async remoteMessage => {
      await handleDataMessage(
        remoteMessage?.data as Record<string, unknown> | undefined,
        { suppressWhenForeground: true },
      );
    });
    return unsubscribe;
  }, []);

  /**
   * Calls accepted from a notification are routed into the call screen. The
   * headless handler stores them in AsyncStorage before launching the app.
   *
   * Also reconciles on resume: cancels any `call:*` notification for a call the
   * server no longer considers ringing. Without it a ring for a call that was
   * already missed survives until its own timeout and the user answers a dead call.
   */
  useEffect(() => {
    if (!token || !sessionUser?._id) {
      return;
    }
    let busy = false;
    const routePending = async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        if (incomingCallForReconcile !== undefined) {
          await reconcileCallNotifications(
            incomingCallForReconcile
              ? [incomingCallForReconcile._id]
              : [],
          );
        }
        const pending = await consumePendingCall();
        if (!pending) {
          return;
        }
        if (pending.action === 'resume') {
          // Off the ongoing-call notification of a call that is already live.
          // Accepting again here throws "This call is no longer ringing", which
          // used to surface as a spurious alert over a connected call.
          if (isOngoingCall(pending.callId)) {
            return;
          }
          openCallScreen({
            callId: pending.callId,
            type: pending.callType,
            role: 'callee',
            peerName: pending.callerName,
          });
          return;
        }
        acceptCall({ token, callId: pending.callId as any })
          .catch(error => {
            console.warn('[call] deferred accept failed', error);
          })
          .finally(() => {
            dismissCallNotification(pending.callId);
            openCallScreen({
              callId: pending.callId,
              type: pending.callType,
              role: 'callee',
              peerName: pending.callerName,
            });
          });
      } finally {
        busy = false;
      }
    };
    routePending();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        routePending();
      }
    });
    return () => subscription.remove();
  }, [
    token,
    sessionUser?._id,
    acceptCall,
    openCallScreen,
    incomingCallForReconcile,
  ]);

  /**
   * Presses on call notifications while the app is in the foreground, plus the
   * ongoing-call notification's Mute / Speaker / End actions.
   *
   * A plain press no longer accepts the call. It used to: `pressAction.id` was
   * literally `accept-call`, so a body tap on the notification was an answer -
   * and since the full-screen intent used the same id, that was also true on the
   * lock screen.
   */
  useEffect(() => {
    if (!token) {
      return;
    }
    return notifee.onForegroundEvent(async ({ type, detail }) => {
      const data = (detail.notification?.data ?? {}) as Record<string, string>;
      if (!data.callId) {
        return;
      }
      const pressActionId = (detail as any).pressAction?.id ?? '';

      if (
        pressActionId === ONGOING_ACTION_MUTE ||
        pressActionId === ONGOING_ACTION_SPEAKER ||
        pressActionId === ONGOING_ACTION_HANGUP
      ) {
        await handleOngoingCallAction(data, pressActionId);
        return;
      }

      if ((data.type ?? '') === 'ongoing') {
        openCallScreen({
          callId: data.callId,
          type: data.callType,
          role: 'callee',
          peerName: data.peerName,
        });
        return;
      }

      if (type === EventType.ACTION_PRESS && pressActionId === 'decline-call') {
        rejectCall({ token, callId: data.callId as any }).catch(() => {});
        await teardownRinging(data.callId);
        return;
      }
      if (
        type === EventType.PRESS ||
        (type === EventType.ACTION_PRESS &&
          (pressActionId === 'accept-call' || pressActionId === 'open-call'))
      ) {
        // `open-call` is what the full-screen intent and a body press now target.
        // Notifee has already started the ring activity in that case, so there is
        // nothing to do here beyond making sure the notification is out of the way -
        // and, critically, nothing may accept the call.
        if (pressActionId === 'accept-call') {
          acceptCall({ token, callId: data.callId as any }).catch(error => {
            console.warn('[call] accept from notification failed', error);
          });
        }
        if (pressActionId === 'open-call') {
          // The ring screen is taking over. It recovers the payload from the
          // POSTED notification (Notifee only attaches the extras bundle when a
          // `mainComponent` is set, which a bare full-screen intent does not
          // provide), so cancelling here would make it refuse to draw - and the
          // decline it posts would arrive with a null callId.
          return;
        }
        await dismissCallNotification(data.callId);
        openCallScreen({
          callId: data.callId,
          type: data.callType,
          role: 'callee',
          peerName: data.callerName,
        });
      }
    });
  }, [token, acceptCall, rejectCall, openCallScreen]);

  /**
   * Hand-off from the native lock-screen ring activity.
   *
   * `IncomingCallActivity` draws Accept/Decline over the keyguard and then starts
   * `MainActivity` with the decision in its intent; `MainActivity.onCreate` and
   * `onNewIntent` publish it through the `CallIntent` native module. Nothing
   * consumed that before this, so accepting from the lock screen did nothing at
   * all while the app was running, and booted to a blank screen when it was not.
   */
  useEffect(() => {
    if (!token || !sessionUser?._id) {
      return;
    }
    const bridge = NativeModules.CallIntent as
      | { takeLaunchIntent?: () => Promise<any> }
      | undefined;
    if (!bridge?.takeLaunchIntent) {
      return;
    }
    let cancelled = false;
    const consume = async () => {
      try {
        const payload = await bridge.takeLaunchIntent!();
        if (cancelled || !payload?.callId) {
          return;
        }
        if (payload.callAction === 'decline') {
          rejectCall({ token, callId: payload.callId as any }).catch(() => {});
          await teardownRinging(payload.callId, false);
          return;
        }
        if (payload.callAction === 'accept') {
          acceptCall({ token, callId: payload.callId as any }).catch(error => {
            console.warn('[call] accept from ring screen failed', error);
          });
          await teardownRinging(payload.callId, false);
          openCallScreen({
            callId: payload.callId,
            type: payload.mediaType,
            role: 'callee',
            peerName: payload.callerName,
          });
        }
      } catch (error) {
        console.warn('[call] ring screen hand-off failed', error);
      }
    };
    consume();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        consume();
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [token, sessionUser?._id, acceptCall, rejectCall, openCallScreen]);

  const [batteryPromptVisible, setBatteryPromptVisible] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    let cancelled = false;
    const checkBatteryOptimizations = async () => {
      try {
        const prompted = await AsyncStorage.getItem('synomilo.batteryPrompted');
        if (prompted || cancelled) {
          return;
        }
        const installer = NativeModules.Installer;
        if (!installer?.isIgnoringBatteryOptimizations) {
          return;
        }
        const ignoring = await installer.isIgnoringBatteryOptimizations();
        if (!cancelled && ignoring === false) {
          setBatteryPromptVisible(true);
        }
      } catch {}
    };
    checkBatteryOptimizations();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const dismissBatteryPrompt = useCallback(() => {
    setBatteryPromptVisible(false);
    AsyncStorage.setItem('synomilo.batteryPrompted', 'true').catch(() => {});
  }, []);

  /**
   * Android 14+ makes `USE_FULL_SCREEN_INTENT` revocable special app access.
   * Without the grant, a backgrounded incoming call silently degrades to an
   * ordinary heads-up notification - which is exactly the "sometimes it just
   * goes mute" behaviour. Ask once, then deep-link to the system setting.
   */
  const [fsiPromptVisible, setFsiPromptVisible] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const asked = await AsyncStorage.getItem('synomilo.fsiPrompted');
        if (asked || cancelled) {
          return;
        }
        if (await canRingOverLockScreen()) {
          return;
        }
        if (!cancelled) {
          setFsiPromptVisible(true);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const dismissFsiPrompt = useCallback(() => {
    setFsiPromptVisible(false);
    AsyncStorage.setItem('synomilo.fsiPrompted', 'true').catch(() => {});
  }, []);

  const allowFsi = useCallback(() => {
    setFsiPromptVisible(false);
    AsyncStorage.setItem('synomilo.fsiPrompted', 'true').catch(() => {});
    requestRingOverLockScreen();
  }, []);

  const allowBatteryOptimizations = useCallback(() => {
    setBatteryPromptVisible(false);
    NativeModules.Installer?.openBatterySettings?.();
    AsyncStorage.setItem('synomilo.batteryPrompted', 'true').catch(() => {});
  }, []);

  if (sessionLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: paperTheme.colors.background,
        }}
      />
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
          <View
            style={{ flex: 1 }}
            importantForAccessibility={
              appLockActive ? 'no-hide-descendants' : 'auto'
            }
          >
            <RootStackNavigator isLoggedIn={isLoggedIn} />
          </View>
          {isLoggedIn && <IncomingCallOverlay />}
          {isLoggedIn && <OngoingCallBar />}
        </SafeAreaView>
        {/* Mounted last so the lock covers the navigator and the call
            overlays. Reads the session itself; needs no props. */}
        <AppLock />
        <Portal>
          <Dialog
            visible={batteryPromptVisible}
            onDismiss={dismissBatteryPrompt}
            style={{ borderRadius: 28 }}
          >
            <Dialog.Title>Keep calls reliable</Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium">
                Allow synomiló to run in the background so incoming calls
                arrive on time. This opens a system setting.
              </Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={dismissBatteryPrompt}>Not now</Button>
              <Button onPress={allowBatteryOptimizations}>Allow</Button>
            </Dialog.Actions>
          </Dialog>
          <Dialog
            visible={fsiPromptVisible}
            onDismiss={dismissFsiPrompt}
            style={{ borderRadius: 28 }}
          >
            <Dialog.Title>Show calls over your lock screen</Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium">
                Android only lets synomiló take over a locked screen if you allow
                full screen notifications. Without it, a call arriving while the
                app is closed only shows a quiet notification. This opens a
                system setting.
              </Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={dismissFsiPrompt}>Not now</Button>
              <Button onPress={allowFsi}>Allow</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

const App = (): React.ReactElement => {
  /**
   * SINGLE SOURCE OF TRUTH FOR THE COLOUR SCHEME.
   *
   * `useAppPaperTheme()` is the ONE place the OS colour scheme enters this app.
   * `useColorScheme()` is a subscription (React Native implements it with
   * `useSyncExternalStore` over a native `appearanceChanged` event), so every
   * caller holds its own snapshot and re-renders on its own schedule. This file
   * previously had a second reader inside `RootStackNavigator`, so Paper
   * repainted from one snapshot while the navigation container and status bar
   * repainted from another - and the navigation theme was React Navigation's
   * own blue/red defaults, which do not change with the scheme at all.
   *
   * `buildPaperTheme` returns a NEW object per call, which is what Paper needs:
   * it re-renders on a changed `theme` prop identity, so a mutated-in-place
   * theme would hold the previous scheme. See `src/theme/useAppTheme.ts`.
   */
  const theme = useAppPaperTheme();

  return (
    <ConvexProvider client={convex}>
      <PaperProvider theme={theme}>
        <SessionProvider>
          <AppInner />
          <UpdateChecker />
        </SessionProvider>
      </PaperProvider>
    </ConvexProvider>
  );
};

export default App;
