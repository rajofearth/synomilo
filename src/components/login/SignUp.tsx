import React, { useEffect, useMemo, useState } from 'react';
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
import { navigate, navigationRef } from '../../navigation/NavigationService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { ensureCometChatSession } from '../../auth/cometchatSession';
import { convexErrorMessage } from '../../utils/convexError';

const UID_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;

const SignUp: React.FC = () => {
  const [fullName, setFullName] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const statusBarHeight =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  const { signIn } = useSession();
  const registerMutation = useMutation(api.auth.register);

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

  const keyboardVerticalOffset = useMemo(() => {
    return Platform.OS === 'ios'
      ? (insets.top || 0) + (headerHeight || 0)
      : (statusBarHeight || 0) + (headerHeight || 0);
  }, [insets.top, headerHeight, statusBarHeight]);

  const trimmedName = fullName.trim();
  const trimmedUid = username.trim();
  const isFormValid =
    trimmedName.length >= 2 &&
    UID_PATTERN.test(trimmedUid) &&
    password.length >= 6;

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2800);
  };

  const handleCreateAccount = async () => {
    if (isLoading) {
      return;
    }
    if (trimmedName.length < 2) {
      showToast('Enter your full name');
      return;
    }
    if (!UID_PATTERN.test(trimmedUid)) {
      showToast(
        'Username must be 3-32 characters: letters, numbers, dots, dashes, underscores',
      );
      return;
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);
    try {
      const result = await registerMutation({
        username: trimmedUid,
        password,
        displayName: trimmedName,
      });
      await signIn(result.token);
      ensureCometChatSession(
        result.user.username,
        result.user.displayName,
      ).catch(() => {});
      navigate(SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR);
      navigationRef.reset({
        index: 0,
        routes: [{ name: SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR }],
      });
    } catch (error: any) {
      showToast(
        convexErrorMessage(
          error,
          'Could not create your account. Check your connection and try again.',
        ),
      );
    } finally {
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
              Create your account
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
              Enter your details to create an account.
            </Text>

            <View style={styles.inputContainer}>
              <Text
                style={[
                  theme.typography.caption1.medium,
                  { color: theme.color.textPrimary, paddingBottom: 5 },
                ]}
              >
                Full name
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
                value={fullName}
                onChangeText={setFullName}
                placeholder="e.g. Asha Patel"
                placeholderTextColor={theme.color.textTertiary}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>

            <View style={[styles.inputContainer, { marginTop: 20 }]}>
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
                placeholder="e.g. asha.patel"
                placeholderTextColor={theme.color.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text
                style={[
                  theme.typography.caption1.regular,
                  { color: theme.color.textTertiary, marginTop: 5 },
                ]}
              >
                3-32 characters: letters, numbers, dots, dashes, underscores.
              </Text>
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
                placeholder="At least 6 characters"
                placeholderTextColor={theme.color.textTertiary}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={handleCreateAccount}
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
              onPress={handleCreateAccount}
              disabled={!isFormValid || isLoading}
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
                  Create account
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
                Already have an account?{' '}
              </Text>
              <TouchableOpacity onPress={() => navigationRef.goBack()}>
                <Text
                  style={[
                    theme.typography.body.medium,
                    { color: theme.color.primary },
                  ]}
                >
                  Log in
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {toastMessage && (
        <View
          style={[styles.toastContainer, { backgroundColor: theme.color.error }]}
        >
          <Text style={[styles.toastText, { color: theme.color.staticWhite }]}>
            {toastMessage}
          </Text>
        </View>
      )}
    </View>
  );
};

export default SignUp;

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
