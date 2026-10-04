import './gesture-handler';
import React, { useState, useEffect, useRef } from 'react';
import {
  Platform,
  View,
  PlatformColor,
  AppState,
  AppStateStatus,
  Linking,
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
import { ConvexProvider, useMutation } from 'convex/react';
import { PaperProvider } from 'react-native-paper';
import { paperTheme } from './src/theme/paperTheme';

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
} from './src/notifications/callNotifications';
import {
  consumePendingCall,
  handleDataMessage,
} from './src/notifications/background';
import notifee, { EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { api } from './convex/_generated/api';
import { navigate } from './src/navigation/NavigationService';

// Listener ID for registering and removing CometChat listeners.
const listenerId = 'app';

const AppInner = (): React.ReactElement => {
  const [callReceived, setCallReceived] = useState(false);
  const incomingCall = useRef<CometChat.Call | CometChat.CustomMessage | null>(
    null,
  );
  const [isInitializing, setIsInitializing] = useState(true);
  const [hasValidAppCredentials, setHasValidAppCredentials] = useState(false);
  const styleConfig = useConfig(state => state?.settings?.style);

  const { user: sessionUser, isLoading: sessionLoading, token } = useSession();
  const isLoggedIn = !!sessionUser;
  const setPushToken = useMutation(api.users.setPushToken);
  const acceptCall = useMutation(api.calls.accept);
  const rejectCall = useMutation(api.calls.reject);

  const theme: { light: DeepPartial<CometChatTheme>; dark: DeepPartial<CometChatTheme> } = {
    light: {
      color: {
        primary: styleConfig.color.brandColor,
        textPrimary: styleConfig.color.primaryTextLight,
        textSecondary: styleConfig.color.secondaryTextLight,
      },
      typography: createTypography(styleConfig.typography.font),
    },
    dark: {
      color: {
        primary: styleConfig.color.brandColor,
        textPrimary: styleConfig.color.primaryTextDark,
        textSecondary: styleConfig.color.secondaryTextDark,
      },
      typography: createTypography(styleConfig.typography.font),
    },
  };

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
   * Register for FCM push notifications and route notification taps into the
   * Convex chat screens. Re-runs whenever the signed-in user changes.
   */
  useEffect(() => {
    const sessionToken = sessionUser ? token : null;
    if (!sessionToken || !sessionUser) {
      return;
    }
    let unsubTap: (() => void) | undefined;
    let unsubRefresh: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const granted = await requestPushPermission();
      if (cancelled || !granted) {
        return;
      }
      const fcmToken = await getFcmToken();
      if (cancelled) {
        return;
      }
      if (fcmToken) {
        setPushToken({ token: sessionToken, pushToken: fcmToken }).catch(
          () => {},
        );
      }
      unsubRefresh = onTokenRefresh(nextToken => {
        setPushToken({ token: sessionToken, pushToken: nextToken }).catch(
          () => {},
        );
      });
      const openFromData = (data: Record<string, string>) => {
        if (data.type === 'message' && data.conversationId) {
          navigate(
            'Messages' as never,
            { conversationId: data.conversationId } as never,
          );
        }
      };
      unsubTap = onNotificationTap(openFromData, openFromData);
    })();

    return () => {
      cancelled = true;
      unsubTap?.();
      unsubRefresh?.();
    };
  }, [sessionUser?._id, token, setPushToken]);

  /**
   * Notification channels + in-app ringing for calls that arrive while the
   * app is open (data messages go through the foreground handler).
   */
  useEffect(() => {
    ensureNotificationChannels().catch(() => {});
    const unsubscribe = messaging().onMessage(async remoteMessage => {
      await handleDataMessage(
        remoteMessage?.data as Record<string, unknown> | undefined,
      );
    });
    return unsubscribe;
  }, []);

  /**
   * Calls accepted from a notification are routed into the call screen. The
   * headless handler stores them in AsyncStorage before launching the app.
   */
  useEffect(() => {
    if (!token || !sessionUser) {
      return;
    }
    let busy = false;
    const routePending = async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        const pending = await consumePendingCall();
        if (pending) {
          acceptCall({ token, callId: pending.callId as any }).catch(() => {});
          dismissCallNotification(pending.callId);
          navigate('CallScreen', {
            callId: pending.callId,
            type: pending.callType,
            role: 'callee',
            peerName: pending.callerName,
          });
        }
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
  }, [token, sessionUser?._id, acceptCall]);

  /**
   * Presses on call notifications while the app is in the foreground.
   */
  useEffect(() => {
    if (!token) {
      return;
    }
    return notifee.onForegroundEvent(({ type, detail }) => {
      const data = (detail.notification?.data ?? {}) as Record<string, string>;
      if (!data.callId) {
        return;
      }
      const pressActionId = (detail as any).pressAction?.id ?? '';
      if (type === EventType.ACTION_PRESS && pressActionId === 'decline-call') {
        rejectCall({ token, callId: data.callId as any }).catch(() => {});
        dismissCallNotification(data.callId);
        return;
      }
      if (
        type === EventType.PRESS ||
        (type === EventType.ACTION_PRESS &&
          (pressActionId === 'accept-call' || pressActionId === 'open-call'))
      ) {
        acceptCall({ token, callId: data.callId as any })
          .catch(() => {})
          .finally(() => {
            dismissCallNotification(data.callId);
            navigate('CallScreen', {
              callId: data.callId,
              type: data.callType === 'video' ? 'video' : 'audio',
              role: 'callee',
              peerName: data.callerName ?? 'Unknown',
            });
          });
      }
    });
  }, [token, acceptCall, rejectCall]);

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
              setTimeout(() => {
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
      CometChatUIEventHandler.removeCallListener(listenerId);
      CometChat.removeCallListener(listenerId);
    };
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
          backgroundColor: Platform.select({
            ios: PlatformColor('systemBackgroundColor'),
            android: PlatformColor('?android:attr/colorBackground'),
          }),
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
          </CometChatI18nProvider>
        </CometChatThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

const App = (): React.ReactElement => {
  return (
    <ConvexProvider client={convex}>
      <PaperProvider theme={paperTheme}>
        <SessionProvider>
          <AppInner />
        </SessionProvider>
      </PaperProvider>
    </ConvexProvider>
  );
};

export default App;
