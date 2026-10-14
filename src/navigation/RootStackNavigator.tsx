import React, { useEffect, useRef } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
} from '@react-navigation/native';
import BottomTabNavigator from './BottomTabNavigator';
import { SCREEN_CONSTANTS } from '../utils/AppConstants';
import { RootStackParamList } from './types';
import { navigationRef, processPendingNavigation, resetToLogin } from './NavigationService';
import Login from '../components/login/Login';
import SignUp from '../components/login/SignUp';
import { StatusBar, useColorScheme } from 'react-native';
import { useTheme } from 'react-native-paper';
import ChatScreen from '../components/convex/ChatScreen';
import CallScreen from '../components/calls/WebRTCCallScreen';
import ForwardMessageScreen from '../components/convex/ForwardMessageScreen';
import ChatInfoScreen from '../components/convex/ChatInfoScreen';
import ContactInfoScreen from '../components/convex/ContactInfoScreen';
import AddContactScreen from '../components/convex/AddContactScreen';
import SettingsScreen from '../components/convex/SettingsScreen';

type Props = {
  isLoggedIn: boolean;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootStackNavigator = ({ isLoggedIn }: Props) => {
  const { colors } = useTheme();
  const scheme: 'light' | 'dark' =
    useColorScheme() === 'light' ? 'light' : 'dark';
  const baseNavigationTheme = scheme === 'light' ? DefaultTheme : DarkTheme;
  const NavigationTheme = {
    ...baseNavigationTheme,
    colors: {
      ...baseNavigationTheme.colors,
      /**
       * Paper's `colors.background`. The theme is rebuilt from `useColorScheme()`
       * on every OS scheme change, so the navigator background tracks the system.
       */
      background: colors.background,
    },
  };

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
    if (isLoggedIn) {
      wasLoggedInRef.current = true;
      return;
    }
    if (wasLoggedInRef.current) {
      wasLoggedInRef.current = false;
      resetToLogin();
    }
  }, [isLoggedIn]);

  return (
    <>
      <StatusBar
        backgroundColor={colors.background}
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
        <Stack.Navigator
          id={undefined}
          initialRouteName={
            isLoggedIn
              ? SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR
              : SCREEN_CONSTANTS.LOGIN
          }
          screenOptions={{
            gestureEnabled: true,
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name={SCREEN_CONSTANTS.LOGIN} component={Login} />
          <Stack.Screen name={SCREEN_CONSTANTS.SIGN_UP} component={SignUp} />

          <Stack.Screen
            name={SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR}
            component={BottomTabNavigator}
          />

          {/* Chat Screens */}
          <Stack.Screen name={SCREEN_CONSTANTS.MESSAGES} component={ChatScreen} />
          <Stack.Screen name="ForwardMessage" component={ForwardMessageScreen} />
          <Stack.Screen name="ChatInfo" component={ChatInfoScreen} />
          <Stack.Screen name="ContactInfo" component={ContactInfoScreen} />
          <Stack.Screen name="AddContact" component={AddContactScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />

          {/* Call Screens */}
          <Stack.Screen
            name="CallScreen"
            component={CallScreen}
            options={{ animation: 'fade' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
};

export default RootStackNavigator;
