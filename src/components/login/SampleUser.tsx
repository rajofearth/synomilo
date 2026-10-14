import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  Dimensions,
  useColorScheme,
  Pressable,
  ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Keyboard,
  type ColorValue,
} from 'react-native';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import {
  CometChatAvatar,
  CometChatUIKit,
  Icon,
  useTheme,
} from '@cometchat/chat-uikit-react-native';
import Check from '../../assets/icons/CheckFill';
import { sampleData } from '../../utils/helper';
import { resolveAvatar } from '../../utils/avatar';
import { SCREEN_CONSTANTS } from '../../utils/AppConstants';
import { navigationRef, resetTo } from '../../navigation/NavigationService';
import Skeleton from './Skeleton';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';

type GridItem = CometChat.User | { dummy: true };

/**
 * Fetch users from a remote sample JSON file, falling back to local sample data.
 *
 * Module scope: these never touch component state, and defining them inside the component
 * is what produced the `exhaustive-deps` violation on the mount effect.
 */
async function fetchUsers(): Promise<CometChat.User[]> {
  try {
    const response = await fetch(
      'https://assets.cometchat.io/sampleapp/sampledata.json',
    );

    if (response.ok) {
      const data = await response.json();
      const fetchedUsers = data.users || [];
      return fetchedUsers.map((user: any) => new CometChat.User(user));
    } else {
      throw new Error('Failed to load users');
    }
  } catch (error) {
    console.error('Exception while fetching users:', error);
    return getDefaultUsers();
  }
}

function getDefaultUsers(): Promise<CometChat.User[]> {
  const localUsers = sampleData.users || [];
  return Promise.resolve(
    localUsers.map((user: any) => new CometChat.User(user)),
  );
}

/**
 * Returns the appropriate image source for a sample user's avatar, or undefined when the
 * URL is unusable so `CometChatAvatar` falls back to its own initials.
 *
 * The URL check is the canonical one from `src/utils/avatar.ts`.
 */
const getAvatarSource = (
  avatar: string,
  name: string,
): ImageSourcePropType | undefined => {
  const resolved = resolveAvatar({ avatar }, name);
  return resolved.kind === 'url' ? { uri: resolved.uri } : undefined;
};

const Loading = ({ color }: { color: ColorValue }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="small" color={color} />
  </View>
);

const TOAST_DURATION_MS = 2800;

const LoginScreen: React.FC = () => {
  const [users, setUsers] = useState<CometChat.User[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userUID, setUserUID] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const theme = useTheme();
  const mode = useColorScheme();
  const { width } = Dimensions.get('window');
  const statusBarHeight =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight(); // returns 0 if no header
  const keyboardVerticalOffset =
    Platform.OS === 'ios'
      ? (insets.top + 8 || 0) + (headerHeight || 0)
      : (statusBarHeight + 6 || 0) + (headerHeight || 0);

  const [keyboardBehavior, setKeyboardBehavior] = useState<
    'padding' | 'height' | undefined
  >(Platform.OS === 'ios' ? 'padding' : 'height');

  useEffect(() => {
    const showListener = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardBehavior(Platform.OS === 'ios' ? 'padding' : 'height');
    });

    const hideListener = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardBehavior(undefined); // Remove behavior when keyboard hides
    });

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

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

  useEffect(() => {
    let cancelled = false;
    (async function loadUsers(): Promise<void> {
      try {
        setLoadingUsers(true);
        const fetchedUsers = await fetchUsers();
        if (!cancelled) {
          setUsers(fetchedUsers);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectUser = (user: CometChat.User): void => {
    setSelectedUser(user.getUid());
    setUserUID('');
  };

  /**
   * Composes a raw CometChat login, NOT a session in this app. Chat, groups, files and
   * reactions all come from Convex, so this screen signs you into the calls layer only —
   * `App.tsx` computes `isLoggedIn` from the Convex session, which stays null and every
   * Convex query will fail.
   *
   * `resetTo` alone, not `navigate()` followed by `reset()`: the queued navigate would have
   * replayed on top of the fresh stack and left a duplicate tab screen behind the back
   * button. `reset` rejects if the ref is not ready; that is swallowed here on purpose
   * because the failure surfaces as the screen simply not changing.
   */
  const handleContinue = async () => {
    if ((!selectedUser && !userUID.trim()) || isLoading) return;
    setIsLoading(true);
    const uid: string = userUID.trim() || selectedUser!;
    try {
      await CometChatUIKit.login({ uid });
      await resetTo(SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR);
    } catch (error: any) {
      console.error('Sample user login failed:', error);
      showToast(
        'Could not sign in to that sample user. Check your connection and try again.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * The skeleton is a "still loading" affordance, not an empty state. Gating it on
   * `users.length === 0` meant a failed fetch left it on screen forever, because Skeleton
   * used to return null once its own 3s timer expired while the caller still believed it
   * was showing.
   */
  const showSkeleton = loadingUsers;

  // Compute grid data only if users are available.
  let gridData: GridItem[] = [];
  if (users.length > 0) {
    gridData = [...users];
    const numColumns = 3;
    const numberOfElementsLastRow = users.length % numColumns;
    if (numberOfElementsLastRow !== 0) {
      for (let i = 0; i < numColumns - numberOfElementsLastRow; i++) {
        gridData.push({ dummy: true });
      }
    }
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.color.background2 }]}
      edges={['top']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingContainer}
        behavior={keyboardBehavior} // Use dynamic behavior
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* App Logo */}
          <View style={styles.logoContainer}>
            <Image
              source={
                mode === 'dark'
                  ? require('../../assets/icons/Dark.png')
                  : require('../../assets/icons/Light.png')
              }
              style={{
                width: width * 0.25,
                height: width * 0.25,
                resizeMode: 'contain',
              }}
            />
          </View>

          {/* Title */}
          <Text
            style={[
              theme.typography.heading2.bold,
              styles.logInTitle,
              { color: theme.color.textPrimary },
            ]}
          >
            Log In
          </Text>

          {/* Subtitle */}
          <Text
            style={[
              theme.typography.body.medium,
              styles.subtitle,
              { color: theme.color.textPrimary },
            ]}
          >
            Choose a Sample User
          </Text>

          {/* Sample Users Grid */}
          <View style={styles.userGridWrapper}>
            {showSkeleton ? (
              <Skeleton />
            ) : (
              <View style={styles.usersContainer}>
                {gridData.map((item, index) => {
                  // Render a blank view for dummy items
                  if ('dummy' in item && item.dummy) {
                    return (
                      <View key={`dummy-${index}`} style={styles.userCard} />
                    );
                  }

                  // Otherwise, render a user
                  const user = item as CometChat.User;
                  const isSelected = selectedUser === user.getUid();
                  const firstName = user.getName();

                  return (
                    <Pressable
                      key={user.getUid()}
                      style={[
                        styles.userCard,
                        {
                          borderWidth: isSelected ? 1.5 : 1,
                          borderColor: isSelected
                            ? theme.color.borderHighlight
                            : theme.color.borderLight,
                          backgroundColor: isSelected
                            ? theme.color.extendedPrimary50
                            : theme.color.background1,
                        },
                      ]}
                      onPress={() => handleSelectUser(user)}
                    >
                      {/* Show the check icon ONLY if selected */}
                      {isSelected && (
                        <View style={styles.checkIconContainer}>
                          <Icon
                            icon={
                              <Check
                                color={theme.color.staticWhite}
                                height={18}
                                width={18}
                              />
                            }
                          />
                        </View>
                      )}
                      <CometChatAvatar
                        name={user.getName()}
                        image={getAvatarSource(user.getAvatar(), user.getName())}
                      />
                      {/* Display only the first name */}
                      <Text
                        style={[
                          theme.typography.body.medium,
                          styles.firstNameText,
                          { color: theme.color.textPrimary },
                        ]}
                      >
                        {firstName}
                      </Text>
                      <Text
                        style={[
                          theme.typography.caption1.regular,
                          styles.uidText,
                          { color: theme.color.textSecondary },
                        ]}
                      >
                        {user.getUid()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Horizontal divider with "Or" in the middle */}
          <View style={styles.dividerRow}>
            <View
              style={[
                styles.divider,
                { borderColor: theme.color.borderDefault },
              ]}
            />
            <Text
              style={[
                theme.typography.body.medium,
                { color: theme.color.textTertiary },
              ]}
            >
              Or
            </Text>
            <View
              style={[
                styles.divider,
                { borderColor: theme.color.borderDefault },
              ]}
            />
          </View>

          {/* UID Input */}
          <Text
            style={[
              theme.typography.caption1.medium,
              styles.uidLabel,
              { color: theme.color.textPrimary },
            ]}
          >
            Enter Your UID
          </Text>
          <TextInput
            placeholder=" Enter UID"
            placeholderTextColor={theme.color.textTertiary}
            style={[
              theme.typography.body.regular,
              styles.uidInput,
              {
                borderColor: theme.color.borderLight,
                color: theme.color.textPrimary,
              },
            ]}
            value={userUID}
            onChangeText={(text: string) => {
              setUserUID(text);
              setSelectedUser(null);
            }}
          />
        </ScrollView>

        {/* Bottom container with "Continue" button and "Change App Credentials" */}
        <View style={styles.bottomContainer}>
          <TouchableOpacity
            style={[
              styles.continueButton,
              {
                backgroundColor: theme.color.primaryButtonBackground,
              },
            ]}
            onPress={handleContinue}
            disabled={(!selectedUser && !userUID.trim()) || isLoading}
          >
            {isLoading ? (
              <Loading color={theme.color.staticWhite} />
            ) : (
              <Text
                style={[
                  theme.typography.button.medium,
                  styles.continueButtonText,
                  { color: theme.color.staticWhite },
                ]}
              >
                Continue
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.changeCredentialsWrapper}>
            <Text
              style={[
                theme.typography.body.regular,
                { color: theme.color.textSecondary },
              ]}
            >
              Change{' '}
            </Text>
            <TouchableOpacity
              style={styles.changeCredentialsContainer}
              onPress={() => {
                navigationRef.navigate(SCREEN_CONSTANTS.APP_CRED);
              }}
            >
              <Text
                style={[
                  theme.typography.body.regular,
                  { color: theme.color.primary },
                ]}
              >
                App Credentials
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Inside the KeyboardAvoidingView so the message is not occluded by the keyboard. */}
        {toastMessage && (
          <View style={styles.toastContainer}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default LoginScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardAvoidingContainer: {
    flex: 1,
  },
  scrollContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logInTitle: {
    marginBottom: 16,
    alignSelf: 'center',
  },
  subtitle: {
    marginBottom: 6,
  },
  usersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  userCard: {
    position: 'relative',
    width: '30%',
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 8,
    marginBottom: 12,
    alignItems: 'center',
    overflow: 'hidden',
  },
  checkIconContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    borderBottomLeftRadius: 10,
    borderTopRightRadius: 7,
    width: '27%',
    height: '22%',
    backgroundColor: '#7367F0',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  firstNameText: {
    marginTop: 8,
    textAlign: 'center',
  },
  uidText: {
    marginTop: 4,
    textAlign: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    gap: 10,
  },
  divider: {
    flex: 1,
    height: 1,
    borderWidth: 0.5,
  },
  uidLabel: {
    paddingBottom: 5,
  },
  uidInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 24,
  },
  bottomContainer: {
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  continueButton: {
    paddingVertical: 12,
    borderRadius: 6,
    marginBottom: 12,
  },
  continueButtonText: {
    alignSelf: 'center',
  },
  changeCredentialsWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  changeCredentialsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastContainer: {
    position: 'absolute',
    bottom: '8%',
    left: 20,
    right: 20,
    backgroundColor: '#C73C3E',
    padding: 8,
    borderRadius: 12,
    alignItems: 'center',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  userGridWrapper: {
    minHeight: 240,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
