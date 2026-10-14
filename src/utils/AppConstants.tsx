export const APP_NAME = 'synomiló';

export const AppConstants = {
  // Display-only. The updater compares against the APK's `versionName` from
  // android/app/build.gradle, not this value - this was stale at V5.5.1 and
  // showed a wrong version in Profile and Settings.
  versionNumber: '1.0.7',
  webClientId:
    '',
  iosClientId:
    '',
};

/**
 * Route names. Every key here maps to a registered `<Stack.Screen>` that has at least
 * one live `navigate()` caller — see `RootStackParamList`, which is the type-level
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
