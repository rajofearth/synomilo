import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  useColorScheme,
  Platform,
  StatusBar,
  Dimensions,
  ScrollView,
  KeyboardAvoidingView,
  BackHandler,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CometChatUIKit,
  UIKitSettings,
  useCometChatTranslation,
  useTheme,
} from '@cometchat/chat-uikit-react-native';
import { navigationRef, resetTo } from '../../navigation/NavigationService';
import { SCREEN_CONSTANTS } from '../../utils/AppConstants';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';

const TOAST_DURATION_MS = 2500;

const AppCredentials: React.FC = () => {
  // These are the *editable* states bound to the TextInput fields
  const [appId, setAppId] = useState<string>('');
  const [authKey, setAuthKey] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('US');

  // Toast state for showing error messages
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const theme = useTheme();
  const { t } = useCometChatTranslation();
  const { width } = Dimensions.get('window');
  const mode = useColorScheme();

  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight(); // returns 0 if no header
  const statusBarHeight =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

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
  // For iOS use insets.top (not status bar) + header height
  const keyboardVerticalOffset = useMemo(() => {
  return Platform.OS === 'ios'
    ? (insets.top || 0) + (headerHeight || 0)
    : (statusBarHeight || 0) + (headerHeight || 0);
}, [insets.top, headerHeight, statusBarHeight]);

  // Compute if form is valid (all fields provided)
  const isFormValid =
    appId.trim().length > 0 &&
    authKey.trim().length > 0 &&
    selectedRegion.trim().length > 0;

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

  // Load existing credentials if any
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const onBackPress = () => {
        navigationRef.goBack();
        return true; // Prevent default behavior
      };
      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress,
      );

      async function loadCredentials() {
        try {
          const credentialsStr = await AsyncStorage.getItem('appCredentials');
          if (!credentialsStr || cancelled) {
            return;
          }
          const credentials = JSON.parse(credentialsStr);
          // Populate the fields so the user sees what is already saved.
          setAppId(credentials.appId || '');
          setAuthKey(credentials.authKey || '');
          setSelectedRegion(credentials.region || 'US');
        } catch (error) {
          console.log('Error loading stored credentials:', error);
        }
      }

      loadCredentials();

      return () => {
        cancelled = true;
        backHandler.remove();
      };
    }, []),
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

  const handleContinue = async (): Promise<void> => {
    // Validate the inputs.
    // If the user has modified a field and cleared it (i.e. the input becomes empty),
    // show a toast message.
    if (!appId.trim()) {
      showToast('Please enter App ID');
      return;
    }
    if (!authKey.trim()) {
      showToast('Please enter Auth Key');
      return;
    }
    if (!selectedRegion.trim()) {
      showToast('Please select a region');
      return;
    }

    // Since all fields are non-empty, use their current values.
    const newAppId = appId.trim();
    const newAuthKey = authKey.trim();
    const newRegion = selectedRegion.trim();

    try {
      const credentials = {
        region: newRegion,
        appId: newAppId,
        authKey: newAuthKey,
      };
      // No logging here: an authKey in the console goes straight to logcat / the device
      // console in plaintext.
      await AsyncStorage.setItem('appCredentials', JSON.stringify(credentials));

      // Re-initialize with updated credentials
      await CometChatUIKit.init({
        appId: newAppId,
        authKey: newAuthKey,
        region: newRegion,
        subscriptionType: CometChat.AppSettings
          .SUBSCRIPTION_TYPE_ALL_USERS as UIKitSettings['subscriptionType'],
      });
      showToast('App credentials saved');
    } catch (error) {
      console.error('Failed to save credentials', error);
      showToast('Could not save those credentials. Check the values and retry.');
      return;
    }

    // `resetTo` alone. The previous `navigate('BottomTabNavigator')` queued an intent that
    // replayed on top of the new stack, and `BottomTabNavigator` is not where this screen
    // goes next anyway.
    await resetTo(SCREEN_CONSTANTS.SAMPLE_USER);
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.color.background2 }]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={keyboardBehavior} // Use dynamic behavior
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <View style={styles.contentContainer}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header/Logo */}
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
                {
                  color: theme.color.textPrimary,
                  marginBottom: 20,
                  alignSelf: 'center',
                },
              ]}
            >
              {t('APP_CREDENTIALS')}
            </Text>

            {/* Region Selector */}
            <View style={styles.inputContainer}>
              <Text
                style={[
                  theme.typography.caption1.medium,
                  { color: theme.color.textPrimary, marginBottom: 10 },
                ]}
              >
                {t('REGION')}
              </Text>
              <View style={styles.regionRow}>
                {/* US */}
                <TouchableOpacity
                  style={[
                    styles.flagContainer,
                    {
                      backgroundColor:
                        selectedRegion === 'US'
                          ? theme.color.extendedPrimary50
                          : theme.color.background1,
                      borderColor:
                        selectedRegion === 'US'
                          ? theme.color.borderHighlight
                          : theme.color.borderDefault,
                    },
                  ]}
                  onPress={() => setSelectedRegion('US')}
                >
                  <View style={styles.flagInnerContainer}>
                    <Image
                      source={require('../../assets/icons/US.png')}
                      style={styles.flagImage}
                    />
                    <Text
                      style={[
                        theme.typography.button.medium,
                        { color: theme.color.textSecondary },
                      ]}
                    >
                      US
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* EU */}
                <TouchableOpacity
                  style={[
                    styles.flagContainer,
                    {
                      backgroundColor:
                        selectedRegion === 'EU'
                          ? theme.color.extendedPrimary50
                          : theme.color.background1,
                      borderColor:
                        selectedRegion === 'EU'
                          ? theme.color.borderHighlight
                          : theme.color.borderDefault,
                    },
                  ]}
                  onPress={() => setSelectedRegion('EU')}
                >
                  <View style={styles.flagInnerContainer}>
                    <Image
                      source={require('../../assets/icons/EU.png')}
                      style={styles.flagImage}
                    />
                    <Text
                      style={[
                        theme.typography.button.medium,
                        { color: theme.color.textSecondary },
                      ]}
                    >
                      EU
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* IN */}
                <TouchableOpacity
                  style={[
                    styles.flagContainer,
                    {
                      backgroundColor:
                        selectedRegion === 'IN'
                          ? theme.color.extendedPrimary50
                          : theme.color.background1,
                      borderColor:
                        selectedRegion === 'IN'
                          ? theme.color.borderHighlight
                          : theme.color.borderDefault,
                    },
                  ]}
                  onPress={() => setSelectedRegion('IN')}
                >
                  <View style={styles.flagInnerContainer}>
                    <Image
                      source={require('../../assets/icons/India.png')}
                      style={styles.flagImage}
                    />
                    <Text
                      style={[
                        theme.typography.button.medium,
                        { color: theme.color.textSecondary },
                      ]}
                    >
                      IN
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* App ID */}
            <View style={styles.inputContainer}>
              <Text
                style={[
                  theme.typography.caption1.medium,
                  { color: theme.color.textPrimary, paddingBottom: 5 },
                ]}
              >
                APP ID
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
                value={appId}
                onChangeText={setAppId}
                placeholder="Enter the App ID"
                placeholderTextColor={theme.color.textTertiary}
              />
            </View>

            {/* Auth Key */}
            <View style={styles.inputContainer}>
              <Text
                style={[
                  theme.typography.caption1.medium,
                  { color: theme.color.textPrimary, paddingBottom: 5 },
                ]}
              >
                Auth Key
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
                value={authKey}
                onChangeText={setAuthKey}
                placeholder="Enter the Auth Key"
                placeholderTextColor={theme.color.textTertiary}
                // An authKey is a bearer credential for the whole CometChat REST API;
                // rendering it in cleartext on a shared screen is how it ends up in a
                // screenshot.
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </ScrollView>

          {/* Continue Button */}
          <View style={styles.buttonWrapper}>
            <TouchableOpacity
              style={[
                styles.continueButton,
                {
                  backgroundColor: theme.color.primaryButtonBackground,
                  opacity: isFormValid ? 1 : 0.6,
                },
              ]}
              onPress={handleContinue}
            >
              <Text
                style={[
                  theme.typography.button.medium,
                  { textAlign: 'center', color: theme.color.staticWhite },
                ]}
              >
                {t('CONTINUE')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      {/* Toast Message */}
      {toastMessage && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
    </View>
  );
};

export default AppCredentials;

const styles = StyleSheet.create({
  logoContainer: {
    alignItems: 'center',
    marginTop: Platform.OS === 'android' ? 30 : 50,
    marginBottom: 20,
  },
  inputContainer: {
    width: '100%',
    marginTop: 20,
  },
  regionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  flagContainer: {
    width: '32%',
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagInnerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 5,
  },
  flagImage: {
    width: 30,
    height: 30,
    resizeMode: 'contain',
  },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  continueButton: {
    borderRadius: 8,
    paddingVertical: 12,
    width: '100%',
  },
  toastContainer: {
    position: 'absolute',
    bottom: '8%',
    left: 20,
    right: 20,
    backgroundColor: '#C73C3E',
    padding: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 80,
  },
  buttonWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
});
