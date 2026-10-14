import './gesture-handler';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  AppState,
  Linking,
  NativeModules,
  useColorScheme,
} from 'react-native';
import {
  CometChatI18nProvider,
  CometChatIncomingCall,
  CometChatTheme,
  CometChatThemeProvider,
  CometChatUIEventHandler,
  CometChatUIEvents,
  CometChatUIKit,
  UIKitSettings,
} from '@cometchat/chat-uikit-react-native';
import { ConvexProvider, useMutation, useQuery } from 'convex/react';
import { Button, Dialog, PaperProvider, Portal, Text, useTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { buildPaperTheme } from './src/theme/dynamicTheme';
import UpdateChecker from './src/updater/UpdateChecker';

import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import RootStackNavigator from './src/navigation/RootStackNavigator';
import { AppConstants } from './src/utils/AppConstants';
import { setupPushOnLogin } from './src/utils/CometChatPushV2';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConfig } from './src/config/store';
import { DeepPartial } from '@cometchat/chat-uikit-react-native/src/shared/helper/types';
import { createTypography } from './src/utils/themeTypography';
import { convex } from './src/convex/client';
import { SessionProvider, useSession } from './src/auth/SessionProvider';
import { ensureCometChatSession } from './src/auth/cometchatSession';
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

// Listener ID for registering and removing CometChat listeners.
const listenerId = 'app';

const buildCometChatPalette = (paper: MD3Theme) => ({
  primary: paper.colors.primary as string,
  background1: paper.colors.background as string,
  background2: paper.colors.surface as string,
  background3: paper.colors.surfaceVariant as string,
  textPrimary: paper.colors.onSurface as string,
  textSecondary: paper.colors.onSurfaceVariant as string,
  textTertiary: paper.colors.outline as string,
  borderDefault: paper.colors.outlineVariant as string,
  borderLight: paper.colors.outlineVariant as string,
  error: paper.colors.error as string,
  extendedPrimary50: paper.colors.primaryContainer as string,
  iconSecondary: paper.colors.onSurfaceVariant as string,
});

const AppInner = (): React.ReactElement => {
  const [callReceived, setCallReceived] = useState(false);
  const incomingCall = useRef<CometChat.Call | CometChat.CustomMessage | null>(
    null,
  );
  const [isInitializing, setIsInitializing] = useState(true);
  const [hasValidAppCredentials, setHasValidAppCredentials] = useState(false);
  /** Pending "reject because busy" timers in the CometChat call listener. */
  const busyRejectTimers = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  const styleConfig = useConfig(state => state?.settings?.style);
  const paperTheme = useTheme();

  const { user: sessionUser, isLoading: sessionLoading, token } = useSession();
  const isLoggedIn = !!sessionUser;
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
        peerName: next.peerName ?? 'Unknown',
      });
    },
    [],
  );

  const theme = useMemo<{
    light: DeepPartial<CometChatTheme>;
    dark: DeepPartial<CometChatTheme>;
  }>(() => {
    const color = { ...buildCometChatPalette(paperTheme) };
    const typography = createTypography(styleConfig.typography.font);
    return { light: { color, typography }, dark: { color, typography } };
  }, [paperTheme, styleConfig.typography.font]);

  /**
   * Initialize the CometChat UIKit (used for voice/video calls only — chat,
   * groups, files and reactions are served by Convex).
   */
  useEffect(() => {
    async function init() {
      try {
        const AppData = (await AsyncStorage.getItem('appCredentials')) || '{}';
        const storedCredentials = JSON.parse(AppData);

        const finalAppId = storedCredentials.appId || AppConstants.appId;
        const finalAuthKey = storedCredentials.authKey || AppConstants.authKey;
        const finalRegion = storedCredentials.region || AppConstants.region;

        if (finalAppId && finalAuthKey && finalRegion) {
          setHasValidAppCredentials(true);
        } else {
          setHasValidAppCredentials(false);
        }

        await CometChatUIKit.init({
          appId: finalAppId,
          authKey: finalAuthKey,
          region: finalRegion,
          subscriptionType: CometChat.AppSettings
            .SUBSCRIPTION_TYPE_ALL_USERS as UIKitSettings['subscriptionType'],
        });
      } catch (error) {
        console.log('Error during initialization', error);
      } finally {
        setIsInitializing(false);
      }
    }
    init();
  }, []);

  /**
   * Keep a background CometChat session alive (same UID as the Convex user)
   * so the Calls tab and call UI keep working. Failures are non-fatal.
   */
  useEffect(() => {
    if (sessionUser) {
      ensureCometChatSession(sessionUser.username, sessionUser.displayName);
    }
  }, [sessionUser]);

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
        await dismissCallNotification(data.callId);
        if (pressActionId === 'open-call') {
          return;
        }
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

  /**
   * NEW push wiring (@cometchat/push-notifications-react-native). Active while a user is
   * logged in. The cleanup removes the push handlers when the user logs out.
   */
  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    return setupPushOnLogin();
  }, [isLoggedIn]);

  /**
   * Attach CometChat call listeners to handle incoming, outgoing, and cancelled call events.
   */
  useEffect(() => {
    // Held locally so the cleanup closure sees the same Set instance even though
    // the ref object itself is stable for the lifetime of the component.
    const busyTimers = busyRejectTimers.current;
    CometChat.addCallListener(
      listenerId,
      new CometChat.CallListener({
        onIncomingCallReceived: async (call: CometChat.Call) => {
          const callerUid = call.getSender()?.getUid();
          const me = await CometChat.getLoggedinUser();
          if (callerUid && callerUid === me?.getUid()) {
            return;
          }
          try {
            const activeCall = CometChat.getActiveCall();
            if (activeCall) {
              const timer = setTimeout(() => {
                busyTimers.delete(timer);
                CometChat.rejectCall(
                  call.getSessionId(),
                  CometChat.CALL_STATUS.BUSY,
                )
                  .then(() => {
                    console.log('Incoming call rejected due to active call');
                  })
                  .catch(error => {
                    console.error(
                      'Error rejecting call with busy status:',
                      error,
                    );
                  });
              }, 2000);
              busyTimers.add(timer);
            } else {
              CometChatUIEventHandler.emitUIEvent(
                CometChatUIEvents.ccToggleBottomSheet,
                {
                  isBottomSheetVisible: false,
                },
              );
              incomingCall.current = call;
              setCallReceived(true);
            }
          } catch (error) {
            console.error('Error getting active call:', error);
            CometChatUIEventHandler.emitUIEvent(
              CometChatUIEvents.ccToggleBottomSheet,
              {
                isBottomSheetVisible: false,
              },
            );
            incomingCall.current = call;
            setCallReceived(true);
          }
        },
        onOutgoingCallRejected: () => {
          incomingCall.current = null;
          setCallReceived(false);
        },
        onIncomingCallCancelled: () => {
          incomingCall.current = null;
          setCallReceived(false);
        },
      }),
    );

    CometChatUIEventHandler.addCallListener(listenerId, {
      ccCallEnded: () => {
        incomingCall.current = null;
        setCallReceived(false);
      },
    });

    return () => {
      busyTimers.forEach(timer => clearTimeout(timer));
      busyTimers.clear();
      CometChatUIEventHandler.removeCallListener(listenerId);
      CometChat.removeCallListener(listenerId);
    };
  }, []);

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

  const allowBatteryOptimizations = useCallback(() => {
    setBatteryPromptVisible(false);
    NativeModules.Installer?.openBatterySettings?.();
    AsyncStorage.setItem('synomilo.batteryPrompted', 'true').catch(() => {});
  }, []);

  // Card Messages — app-level dispatcher for card element actions.
  useEffect(() => {
    const cardActionListenerId = 'cardAction_app';
    CometChatUIEventHandler.addUIListener(cardActionListenerId, {
      ccCardActionClicked: (event: { message: any; action: any }) => {
        const action = event?.action;
        if (!action) return;
        const actionType = action?.type ?? action?.action ?? '';
        switch (actionType) {
          case 'openUrl':
            if (action.url) {
              Linking.openURL(action.url).catch(() => {});
            }
            break;
          case 'copyToClipboard':
            if (action.value || action.text) {
              Clipboard.setString(action.value ?? action.text);
            }
            break;
          case 'downloadFile':
            if (action.url) {
              Linking.openURL(action.url).catch(() => {});
            }
            break;
          default:
            break;
        }
      },
    });
    return () => {
      CometChatUIEventHandler.removeUIListener(cardActionListenerId);
    };
  }, []);

  if (isInitializing || sessionLoading) {
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
        <CometChatThemeProvider theme={theme}>
          <CometChatI18nProvider>
            {isLoggedIn && callReceived && incomingCall.current ? (
              <CometChatIncomingCall
                call={incomingCall.current}
                onDecline={() => {
                  incomingCall.current = null;
                  setCallReceived(false);
                }}
              />
            ) : null}
            <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
              <RootStackNavigator
                isLoggedIn={isLoggedIn}
                hasValidAppCredentials={hasValidAppCredentials}
              />
            </SafeAreaView>
            {isLoggedIn && <IncomingCallOverlay />}
            {isLoggedIn && <OngoingCallBar />}
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
            </Portal>
          </CometChatI18nProvider>
        </CometChatThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

const App = (): React.ReactElement => {
  const scheme: 'light' | 'dark' =
    useColorScheme() === 'light' ? 'light' : 'dark';
  const theme = useMemo(() => buildPaperTheme(scheme), [scheme]);

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
