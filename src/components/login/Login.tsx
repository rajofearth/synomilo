import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useMutation } from 'convex/react';
import { SCREEN_CONSTANTS, APP_NAME } from '../../utils/AppConstants';
import { navigate, resetTo } from '../../navigation/NavigationService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { ensureCometChatSession } from '../../auth/cometchatSession';
import { convexErrorMessage } from '../../utils/convexError';

const TOAST_DURATION_MS = 2800;

const Login: React.FC = () => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const statusBarHeight =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  const { signIn, notice, dismissNotice } = useSession();
  const loginMutation = useMutation(api.auth.login);

  /**
   * The button is disabled while `isLoading`, but the keyboard's "Go" action is not — and
   * `isLoading` read from the render closure is stale for the whole duration of the
   * mutation, so two quick "Go" presses both pass the guard. Every successful login mints
   * a NEW `sessions` row server-side, and nothing ever expires those rows, so each
   * double-submit permanently leaks a live bearer token the user can never revoke.
   *
   * A ref is set synchronously, before the first `await`, so the second tap sees it.
   */
  const inFlightRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [keyboardBehavior, setKeyboardBehavior] = useState<
    'padding' | 'height' | undefined
  >(Platform.OS === 'ios' ? 'padding' : 'height');

  useEffect(() => {
    const showListener = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardBehavior(Platform.OS === 'ios' ? 'padding' : 'height');
    });
    const hideListener = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardBehavior(undefined);
    });
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  // The toast is a modal-ish overlay; it must not outlive the screen that owns it, or the
  // timer fires into an unmounted component.
  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

  const keyboardVerticalOffset = useMemo(() => {
    return Platform.OS === 'ios'
      ? (insets.top || 0) + (headerHeight || 0)
      : (statusBarHeight || 0) + (headerHeight || 0);
  }, [insets.top, headerHeight, statusBarHeight]);

  const isFormValid = username.trim().length > 0 && password.trim().length > 0;

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToastMessage(null);
    }, TOAST_DURATION_MS);
  }, []);

  // The session provider explains WHY the user landed back here ("your session expired").
  // Without this they just get the login form with no context.
  useEffect(() => {
    if (notice) {
      showToast(notice);
      dismissNotice();
    }
  }, [notice, dismissNotice, showToast]);

  const handleLogin = async () => {
    const uid = username.trim();
    if (inFlightRef.current || !uid || !password.trim()) {
      return;
    }
    inFlightRef.current = true;
    setIsLoading(true);
    try {
      const result = await loginMutation({ username: uid, password });
      await signIn(result.token);
      /**
       * Awaited on purpose. Fire-and-forget left the calls layer un-authenticated while
       * the UI already claimed to be signed in, and raced the `sessionUser` effect in
       * App.tsx into two concurrent `CometChatUIKit.login()` calls for one identity.
       *
       * The CometChat UID is the Convex username, normalised the same way the server
       * normalises it, so the identity is identical on every device.
       *
       * A failure here is NOT fatal — Convex is the system of record for chat, groups,
       * files and reactions, and the user is legitimately signed in. It is surfaced
       * instead of swallowed: `cometchatSession` publishes it and the root navigator shows
       * a dismissible banner, so "calls are broken" is a fact on screen and not something
       * the user discovers by dialling someone.
       */
      const cometChat = await ensureCometChatSession(
        result.user.username,
        result.user.displayName,
      );
      // `reset` alone: a preceding `navigate()` would have queued an intent that replayed
      // on top of the fresh stack, leaving a duplicate tab screen behind the back button.
      await resetTo(SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR);
      if (!cometChat.ok) {
        console.log('[Login] CometChat session unavailable:', cometChat.reason);
      }
    } catch (error: any) {
      showToast(
        convexErrorMessage(
          error,
          'Login failed. Check your connection and try again.',
        ),
      );
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.color.background2 }]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={keyboardBehavior}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <View style={styles.contentContainer}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.brandContainer}>
              <Text
                style={[
                  theme.typography.heading1.bold,
                  { color: theme.color.primary },
                ]}
              >
                {APP_NAME}
              </Text>
            </View>

            <Text
              style={[
                theme.typography.heading3.bold,
                { color: theme.color.textPrimary, alignSelf: 'center' },
              ]}
            >
              Log in
            </Text>
            <Text
              style={[
                theme.typography.body.medium,
                {
                  color: theme.color.textSecondary,
                  alignSelf: 'center',
                  marginTop: 6,
                  marginBottom: 24,
                },
              ]}
            >
              Enter your username and password.
            </Text>

            <View style={styles.inputContainer}>
              <Text
                style={[
                  theme.typography.caption1.medium,
                  { color: theme.color.textPrimary, paddingBottom: 5 },
                ]}
              >
                Username
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: theme.color.borderLight,
                    backgroundColor: theme.color.background2,
                    color: theme.color.textPrimary,
                  },
                ]}
                value={username}
                onChangeText={setUsername}
                placeholder="Enter your username"
                placeholderTextColor={theme.color.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                textContentType="username"
                autoComplete="username"
              />
            </View>

            <View style={[styles.inputContainer, { marginTop: 20 }]}>
              <Text
                style={[
                  theme.typography.caption1.medium,
                  { color: theme.color.textPrimary, paddingBottom: 5 },
                ]}
              >
                Password
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: theme.color.borderLight,
                    backgroundColor: theme.color.background2,
                    color: theme.color.textPrimary,
                  },
                ]}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={theme.color.textTertiary}
                secureTextEntry
                editable={!isLoading}
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                blurOnSubmit
                onSubmitEditing={handleLogin}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor: theme.color.primaryButtonBackground,
                  opacity: isFormValid ? 1 : 0.6,
                },
              ]}
              onPress={handleLogin}
              disabled={!isFormValid || isLoading}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isFormValid || isLoading, busy: isLoading }}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={theme.color.staticWhite} />
              ) : (
                <Text
                  style={[
                    theme.typography.button.medium,
                    { textAlign: 'center', color: theme.color.staticWhite },
                  ]}
                >
                  Continue
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.switchRow}>
              <Text
                style={[
                  theme.typography.body.regular,
                  { color: theme.color.textSecondary },
                ]}
              >
                New to {APP_NAME}?{' '}
              </Text>
              <TouchableOpacity
                disabled={isLoading}
                onPress={() => navigate(SCREEN_CONSTANTS.SIGN_UP)}
              >
                <Text
                  style={[
                    theme.typography.body.medium,
                    { color: theme.color.primary },
                  ]}
                >
                  Create an account
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>

        {/**
         * Inside the KeyboardAvoidingView on purpose. As a sibling it anchored to the
         * bottom of the full-height window, and iOS has no `adjustResize` — only
         * `behavior="padding"`, which does not resize the parent. The user submits with the
         * keyboard up, so "Incorrect password. Try again." rendered behind the keyboard
         * and read as a silently failing login.
         */}
        {toastMessage && (
          <View
            style={[styles.toastContainer, { backgroundColor: theme.color.error }]}
          >
            <Text style={[styles.toastText, { color: theme.color.staticWhite }]}>
              {toastMessage}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
};

export default Login;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  inputContainer: {
    width: '100%',
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  primaryButton: {
    borderRadius: 24,
    paddingVertical: 12,
    width: '100%',
    marginTop: 24,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  toastContainer: {
    position: 'absolute',
    bottom: '8%',
    left: 20,
    right: 20,
    padding: 8,
    borderRadius: 16,
    alignItems: 'center',
  },
  toastText: {
    fontSize: 14,
  },
});
