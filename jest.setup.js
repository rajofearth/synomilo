/**
 * Jest bootstrap. Mocks every native module that has no JS-only implementation,
 * so `npm test` can at least load the module graph. Without this the single test
 * suite dies on `TurboModuleRegistry.getEnforcing('RNGestureHandlerModule')`
 * before a single assertion runs.
 */
require('react-native-gesture-handler/jestSetup');

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  const React = require('react');
  return {
    GestureHandlerRootView: ({ children, ...props }) =>
      React.createElement(View, props, children),
    PanGestureHandler: View,
    TapGestureHandler: View,
    ScrollView: View,
    State: {},
    Directions: {},
    Gesture: { Pan: () => ({}), Tap: () => ({}), Simultaneous: () => ({}) },
    GestureDetector: ({ children }) => children,
  };
});

jest.mock('react-native-webrtc', () => ({
  RTCPeerConnection: class {},
  RTCIceCandidate: class {},
  RTCSessionDescription: class {},
  mediaDevices: { getUserMedia: jest.fn(), getDisplayMedia: jest.fn() },
  MediaStream: class {},
  MediaStreamTrack: class {},
  RTCView: require('react-native').View,
  registerGlobals: jest.fn(),
}));

jest.mock('react-native-localize', () => {
  const listeners = new Set();
  const emit = () => listeners.forEach(l => l({ languageTag: 'en-US' }));
  return {
    __esModule: true,
    default: {
      getLocales: () => [
        { languageTag: 'en-US', languageCode: 'en', countryCode: 'US', isRTL: false },
      ],
      findBestAvailableLanguage: () => undefined,
      getCountry: () => 'US',
      getNumberFormatSettings: () => ({ decimalSeparator: '.' }),
    },
    getLocales: () => [
      { languageTag: 'en-US', languageCode: 'en', countryCode: 'US', isRTL: false },
    ],
    findBestAvailableLanguage: () => undefined,
    addEventListener: jest.fn((_, cb) => {
      listeners.add(cb);
      return { remove: () => listeners.delete(cb) };
    }),
    removeEventListener: jest.fn(),
    emitLanguageChange: emit,
    getNumberFormatSettings: () => ({ decimalSeparator: '.' }),
    getCountry: () => 'US',
  };
});

jest.mock('@react-native-firebase/messaging', () => {
  const chain = () => new Proxy(() => {}, { get: () => chain() });
  const messaging = () => new Proxy({}, { get: () => chain() });
  messaging.AuthorizationStatus = { AUTHORIZED: 1, DENIED: 2 };
  messaging.EventType = { TOKEN_REFRESH: 'onTokenRefresh', MESSAGE: 'onMessage' };
  return { __esModule: true, default: messaging };
});

jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => ({}) }));

jest.mock('@notifee/react-native', () => {
  const nc = jest.fn();
  nc.displayNotification = jest.fn(async () => 'id');
  nc.cancelNotification = jest.fn(async () => {});
  nc.cancelAllNotifications = jest.fn(async () => {});
  nc.createChannel = jest.fn(async () => 'channel');
  nc.createDisplayNotification = jest.fn(async () => 'id');
  nc.onForegroundEvent = jest.fn(() => () => {});
  nc.onBackgroundEvent = jest.fn(() => {});
  nc.onNotificationDisplayed = jest.fn(() => {});
  nc.requestPermission = jest.fn(async () => ({ authorizationStatus: 1 }));
  nc.getNotificationSettings = jest.fn(async () => ({
    authorizationStatus: 1,
    android: { importance: 5 },
  }));
  nc.AndroidImportance = { DEFAULT: 3, HIGH: 4, MAX: 5 };
  nc.AndroidCategory = { CALL: 'call', ALARM: 'alarm' };
  nc.AndroidVisibility = { PUBLIC: 1 };
  nc.EventType = {
    PRESS: 'press',
    ACTION_PRESS: 'actionPress',
    DELIVERED: 'delivered',
    DISMISSED: 'dismissed',
  };
  return { __esModule: true, default: nc, AndroidImportance: nc.AndroidImportance };
});

jest.mock('react-native-vision-camera', () => {
  const { View } = require('react-native');
  return {
    Camera: View,
    useCameraDevice: () => null,
    useCameraPermission: () => ({ hasPermission: false, requestPermission: jest.fn() }),
    useCodeScanner: () => ({ codeScannerView: null }),
  };
});

jest.mock('@cometchat/push-notifications-react-native', () => ({
  registerBackgroundCallTask: jest.fn(),
  addPushListener: jest.fn(),
  removePushListener: jest.fn(),
  handlePushMessage: jest.fn(async () => ({})),
}));

jest.mock('convex/server', () => ({
  router: {},
  internal: {},
  httpAction: jest.fn(),
  actionGeneric: jest.fn(),
  mutationGeneric: jest.fn(),
  queryGeneric: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(async () => ({ isConnected: true })),
  addEventListener: jest.fn(() => () => {}),
  useNetInfo: jest.fn(() => ({ isConnected: true })),
}));

// NativeModules.Installer is Android-only; leave it undefined rather than
// proxying NativeModules, which recurses into the bridge config.

jest.mock('react-native-device-info', () => {
  const platform = { isPad: false, isTV: false, isAndroid: true, isIos: false, isWeb: false, isWindows: false, isMac: false };
  return {
    __esModule: true,
    getUniqueId: jest.fn(async () => 'test-unique-id'),
    getSystemName: jest.fn(() => 'Android'),
    getSystemVersion: jest.fn(() => '14'),
    getVersion: jest.fn(() => '1.0.0'),
    getModel: jest.fn(() => 'test-device'),
    getBrand: jest.fn(() => 'google'),
    getBundleId: jest.fn(() => 'com.test.app'),
    getBuildNumber: jest.fn(() => '1'),
    Platform: platform,
  };
});

jest.mock('react-native-background-timer', () => ({
  setInterval: jest.fn((fn, ms) => setInterval(fn, ms)),
  clearInterval: jest.fn(id => clearInterval(id)),
  setTimeout: jest.fn((fn, ms) => setTimeout(fn, ms)),
  clearTimeout: jest.fn(id => clearTimeout(id)),
  runBackgroundTimer: jest.fn((fn, ms) => setInterval(fn, ms)),
  stopBackgroundTimer: jest.fn(id => clearInterval(id)),
}));

jest.useFakeTimers({ doNotFake: ['nextTick'] });

// `setupFiles` runs before the test framework is installed, so the hook is
// only available when this file is loaded via `setupFilesAfterEnv`.
if (typeof beforeEach === 'function') {
  beforeEach(() => {
    jest.clearAllMocks();
  });
}