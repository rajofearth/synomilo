import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
} from '@react-navigation/native';
import BottomTabNavigator from './BottomTabNavigator';
import OngoingCallScreen from '../components/conversations/screens/OngoingCallScreen';
import { SCREEN_CONSTANTS } from '../utils/AppConstants';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { RootStackParamList } from './types';
import { navigationRef, processPendingNavigation, resetToLogin } from './NavigationService';
import { AuthContext } from './AuthContext';
import { useSession } from '../auth/SessionProvider';
import {
  getCometChatSessionError,
  subscribeCometChatSessionError,
} from '../auth/cometchatSession';
import Login from '../components/login/Login';
import SignUp from '../components/login/SignUp';
import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
} from 'react-native';
import Conversations from '../components/conversations/screens/Conversations';
import CreateConversation from '../components/conversations/screens/CreateConversation';
import ChatScreen from '../components/convex/ChatScreen';
import CallScreen from '../components/calls/WebRTCCallScreen';
import ForwardMessageScreen from '../components/convex/ForwardMessageScreen';
import ChatInfoScreen from '../components/convex/ChatInfoScreen';
import ContactInfoScreen from '../components/convex/ContactInfoScreen';
import AddContactScreen from '../components/convex/AddContactScreen';
import SettingsScreen from '../components/convex/SettingsScreen';
import ThreadView from '../components/conversations/screens/ThreadView';
import SavedMessages from '../components/conversations/screens/SavedMessages';
import PinnedMessages from '../components/conversations/screens/PinnedMessages';
import UserInfo from '../components/conversations/screens/UserInfo';
import AddMember from '../components/conversations/screens/AddMember';
import BannedMember from '../components/conversations/screens/BannedMember';
import ViewMembers from '../components/conversations/screens/ViewMembers';
import GroupInfo from '../components/conversations/screens/GroupInfo';
import TransferOwnership from '../components/conversations/screens/TransferOwnership';
import Calls from '../components/calls/Calls';
import { CallDetails } from '../components/calls/CallDetails';
import AIAgents from '../components/AIAgent/AIAgents';
import QRScreen from '../components/conversations/screens/qr_screen';
import SearchMessages from '../components/conversations/screens/SearchMessages';

type Props = {
  isLoggedIn: boolean;
  hasValidAppCredentials: boolean;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * `AppCredentials` is a credential-entry screen and `SampleUser` is a dev-only shortcut.
 * Metro does not tree-shake `{__DEV__ && ...}`, so a plain `import` puts both in the
 * release module graph no matter how the route is gated — the component ships, it is merely
 * unreachable.
 *
 * A lazy `import()` is the part of the graph Metro can actually split: with
 * `experimentalImportSupport` (on by default in `@react-native/metro-config`) it becomes an
 * `import()` that is emitted as a separate async chunk, loaded on demand, and never
 * evaluated — let alone reached — in a release build. The route names stay registered in
 * dev so `initialRouteName` below is untouched.
 */
const AppCredentials = __DEV__
  ? React.lazy(() => import('../components/login/AppCredentials'))
  : null;
const SampleUser = __DEV__
  ? React.lazy(() => import('../components/login/SampleUser'))
  : null;

/**
 * Non-fatal, app-wide warning that the CometChat half of the session did not come up.
 *
 * Convex can be perfectly healthy while CometChat is down, and the user would otherwise
 * have no way of knowing that voice and video are dead until they tried a call.
 */
const CallsUnavailableBanner = () => {
  const [error, setError] = useState<string | null>(
    getCometChatSessionError(),
  );
  const theme = useTheme();

  useEffect(
    () => subscribeCometChatSessionError(setError),
    [],
  );

  if (!error) {
    return null;
  }
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[styles.banner, { backgroundColor: theme.color.error }]}
      accessibilityRole="alert"
      onPress={() => setError(null)}
    >
      <Text
        style={[
          theme.typography.caption1.medium,
          { color: theme.color.staticWhite, textAlign: 'center' },
        ]}
      >
        {error}  Tap to dismiss.
      </Text>
    </TouchableOpacity>
  );
};

const RootStackNavigator = ({isLoggedIn, hasValidAppCredentials: _hasValidAppCredentials}: Props) => {
  const theme = useTheme();
  const { signOut } = useSession();
  const legacyLoggedInRef = useRef(isLoggedIn);
  const scheme: 'light' | 'dark' =
    useColorScheme() === 'light' ? 'light' : 'dark';
  const baseNavigationTheme = scheme === 'light' ? DefaultTheme : DarkTheme;
  const NavigationTheme = {
    ...baseNavigationTheme,
    colors: {
      ...baseNavigationTheme.colors,
      background: theme.color.background1 as string,
    },
  };

  const backgroundColor = theme.color.background2;

  /**
   * Catch-all for "the session went away while the navigator was already mounted".
   *
   * `initialRouteName` is read ONCE, at mount, so it cannot react to logout — and the user
   * is stranded in authenticated UI with no session, which is the one-way-door bug. Every
   * path that drops the Convex session converges here: an explicit sign-out, a token the
   * server rejects mid-session, an expired session, an unvalidatable token.
   *
   * `wasLoggedIn` gates on the true -> false TRANSITION so signing in (false -> true) never
   * triggers it, and so the initial cold start on Login is left alone.
   */
  const wasLoggedInRef = useRef(false);
  useEffect(() => {
    legacyLoggedInRef.current = isLoggedIn;
    if (isLoggedIn) {
      wasLoggedInRef.current = true;
      return;
    }
    if (wasLoggedInRef.current) {
      wasLoggedInRef.current = false;
      resetToLogin();
    }
  }, [isLoggedIn]);

  /**
   * The legacy `AuthContext` consumer (`Conversations.tsx` calls `setIsLoggedIn(false)` from
   * its LOGOUT tooltip). It used to be a permanent no-op because no Provider was mounted;
   * now it routes into the same sign-out as Profile and Settings.
   */
  const handleLegacySignOut = useCallback(() => {
    signOut().catch(() => {});
  }, [signOut]);
  const setIsLoggedIn = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    value => {
      const next =
        typeof value === 'function'
          ? (value as (prev: boolean) => boolean)(legacyLoggedInRef.current)
          : value;
      legacyLoggedInRef.current = next;
      if (!next && wasLoggedInRef.current) {
        handleLegacySignOut();
      }
    },
    [handleLegacySignOut],
  );

  const authContextValue = useMemo(
    () => ({ isLoggedIn, setIsLoggedIn, onSignOut: handleLegacySignOut }),
    [isLoggedIn, setIsLoggedIn, handleLegacySignOut],
  );

  return (
    <AuthContext.Provider value={authContextValue}>
      <StatusBar
        backgroundColor={backgroundColor}
        barStyle={scheme === 'light' ? 'dark-content' : 'light-content'}
        translucent={false}
      />
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          processPendingNavigation();
        }}
        theme={NavigationTheme}
      >
        <Suspense fallback={null}>
          <Stack.Navigator
            id={undefined}
            initialRouteName={
              isLoggedIn
                ? SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR
                : __DEV__
                ? _hasValidAppCredentials
                  ? SCREEN_CONSTANTS.SAMPLE_USER
                  : SCREEN_CONSTANTS.APP_CRED
                : SCREEN_CONSTANTS.LOGIN
            }
            screenOptions={{
              gestureEnabled: true,
              headerShown: false,
              animation: 'slide_from_right',
            }}
          >
            {/* Auth Screens */}
            <Stack.Screen
              name={SCREEN_CONSTANTS.LOGIN}
              component={Login}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.SIGN_UP}
              component={SignUp}
            />
            {__DEV__ && AppCredentials && (
              <Stack.Screen
                name={SCREEN_CONSTANTS.APP_CRED}
                component={AppCredentials}
              />
            )}
            {__DEV__ && SampleUser && (
              <Stack.Screen
                name={SCREEN_CONSTANTS.SAMPLE_USER}
                component={SampleUser}
              />
            )}
            {/**
             * Release-build landing pad for the two dev-only route names.
             *
             * `Conversations.tsx` — a file this module does not own — ends its logout with
             * `reset({ routes: [{ name: 'SampleUser' }] })`. Once SampleUser is out of the
             * release graph that name resolves to nothing, and React Navigation's default
             * `onUnhandledAction` returns silently in production: the user would be signed
             * out but the screen would never change. Aliasing both dev names to Login (an
             * already-bundled screen, so no new release code) makes any stray navigation to
             * a dev-only route land somewhere correct instead of nowhere.
             */}
            {!__DEV__ && (
              <>
                <Stack.Screen
                  name={SCREEN_CONSTANTS.APP_CRED}
                  component={Login}
                />
                <Stack.Screen
                  name={SCREEN_CONSTANTS.SAMPLE_USER}
                  component={Login}
                />
              </>
            )}

            {/* Tab Screens */}
            <Stack.Screen
              name={SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR}
              component={BottomTabNavigator}
            />
            {/**
             * Removed with the three-tab restructure:
             *   `Users`  — the whole-directory screen, superseded by `AddContact`.
             *   `Groups` — group creation is gone from the app.
             *   `Profile` — this WAS a stack route and is now a bottom-tab route, so
             *               the tab bar renders it directly. Keeping both registrations
             *               would have left two routes named `Profile`, and a
             *               `navigation.navigate('Profile')` from inside the tab navigator
             *               resolving to whichever one the stack happened to pick.
             * Nothing navigates to any of the three any more (verified by grep), so
             * nothing is stranded.
             */}
            <Stack.Screen name="AIAgents" component={AIAgents} />
            <Stack.Screen
              name={SCREEN_CONSTANTS.SAVED_MESSAGES}
              component={SavedMessages}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.PINNED_MESSAGES}
              component={PinnedMessages}
            />

            {/* Chat Screens */}
            <Stack.Screen
              name={SCREEN_CONSTANTS.CONVERSATION}
              component={Conversations}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.CREATE_CONVERSATION}
              component={CreateConversation}
            />
            <Stack.Screen name={SCREEN_CONSTANTS.MESSAGES} component={ChatScreen} />
            <Stack.Screen
              name={SCREEN_CONSTANTS.THREAD_VIEW}
              component={ThreadView}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.SEARCH_MESSAGES}
              component={SearchMessages}
            />
            <Stack.Screen
              name="ForwardMessage"
              component={ForwardMessageScreen}
            />
            <Stack.Screen name="ChatInfo" component={ChatInfoScreen} />
            <Stack.Screen name="ContactInfo" component={ContactInfoScreen} />
            <Stack.Screen name="AddContact" component={AddContactScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />

            {/* Info Screens */}
            <Stack.Screen
              name={SCREEN_CONSTANTS.USER_INFO}
              component={UserInfo}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.GROUP_INFO}
              component={GroupInfo}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.ADD_MEMBER}
              component={AddMember}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.TRANSFER_OWNERSHIP}
              component={TransferOwnership}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.BANNED_MEMBER}
              component={BannedMember}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.VIEW_MEMBER}
              component={ViewMembers}
            />

            {/* Call Screens */}
            <Stack.Screen
              name="CallScreen"
              component={CallScreen}
              options={{ animation: 'fade' }}
            />
            <Stack.Screen
              name={SCREEN_CONSTANTS.ONGOING_CALL_SCREEN}
              component={OngoingCallScreen}
            />
            <Stack.Screen name={SCREEN_CONSTANTS.CALL_LOGS} component={Calls} />
            <Stack.Screen
              name={SCREEN_CONSTANTS.CALL_DETAILS}
              component={CallDetails}
            />
            <Stack.Screen name={SCREEN_CONSTANTS.QR_SCREEN} component={QRScreen} />
          </Stack.Navigator>
        </Suspense>
      </NavigationContainer>
      <CallsUnavailableBanner />
    </AuthContext.Provider>
  );
};

export default RootStackNavigator;

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    zIndex: 100,
    elevation: 6,
  },
});