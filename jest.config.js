module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|convex|@notifee|@noble|dayjs|react-native-.*|@react-native-firebase)/)',
  ],
  moduleNameMapper: {
    '\\.png$': '<rootDir>/__mocks__/fileMock.js',
    '\\.(wav|mp3|mp4)$': '<rootDir>/__mocks__/fileMock.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/docs/', '/\\.build-outputs/'],
};