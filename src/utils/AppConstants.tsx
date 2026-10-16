export const APP_NAME = 'synomiló';

export const AppConstants = {
  // Unused, and deliberately left as a trap rather than a source of truth.
  //
  // The installed version is read from the APK at runtime by
  // `DeviceInfo.getVersion()`, which returns `versionName` from
  // android/app/build.gradle. That is the number the updater compares against,
  // and the only number that cannot drift from what was actually shipped.
  //
  // This field drifted to 1.0.7 while the app was at v1.1.1 and nothing read it,
  // so it caused no harm; but it is a second place to bump a version by mistake
  // the moment something starts displaying it. Anything that needs the version
  // should call `DeviceInfo.getVersion()`. Do not "fix" this number.
  versionNumber: '1.1.4',
  webClientId:
    '',
  iosClientId:
    '',
};

/**
 * Route names. Every key here maps to a registered `<Stack.Screen>` that has at least
 * one live `navigate()` caller: see `RootStackParamList`, which is the type-level
 * counterpart. The UIKit-era keys (CONVERSATION, CREATE_CONVERSATION, THREAD_VIEW,
 * SEARCH_MESSAGES, SAVED_MESSAGES, PINNED_MESSAGES, USER_INFO, GROUP_INFO, ADD_MEMBER,
 * TRANSFER_OWNERSHIP, BANNED_MEMBER, VIEW_MEMBER, QR_SCREEN, AI_AGENTS, CALL_DETAILS,
 * CALL_LOGS, APP_CRED, SAMPLE_USER, ONGOING_CALL_SCREEN) went out with their screens.
 */
export const SCREEN_CONSTANTS = {
  LOGIN: 'Login',
  SIGN_UP: 'SignUp',
  BOTTOM_TAB_NAVIGATOR: 'BottomTabNavigator',
  CHATS: 'Chats',
  CALLS: 'Calls',
  MESSAGES: 'Messages',
} as const;
