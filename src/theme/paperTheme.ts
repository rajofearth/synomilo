import type { MD3Theme } from 'react-native-paper';

export type Scheme = 'light' | 'dark';

type PaperColors = MD3Theme['colors'];

/**
 * Strictly achromatic palettes. Every value satisfies R === G === B.
 * Do not introduce hue here: the app has no dynamic/Material You colours
 * and must stay black & white in both schemes.
 */
const lightColors: PaperColors = {
  primary: '#1A1A1A',
  onPrimary: '#FFFFFF',
  primaryContainer: '#E6E6E6',
  onPrimaryContainer: '#000000',
  secondary: '#4D4D4D',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#EDEDED',
  onSecondaryContainer: '#1A1A1A',
  tertiary: '#737373',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#E0E0E0',
  onTertiaryContainer: '#1A1A1A',
  error: '#000000',
  onError: '#FFFFFF',
  errorContainer: '#E6E6E6',
  onErrorContainer: '#000000',
  background: '#FFFFFF',
  onBackground: '#0B0B0B',
  surface: '#FFFFFF',
  onSurface: '#0B0B0B',
  surfaceVariant: '#F0F0F0',
  onSurfaceVariant: '#5C5C5C',
  surfaceDisabled: '#F5F5F5',
  onSurfaceDisabled: '#A8A8A8',
  outline: '#8A8A8A',
  outlineVariant: '#DEDEDE',
  inverseSurface: '#0B0B0B',
  inverseOnSurface: '#F2F2F2',
  inversePrimary: '#F2F2F2',
  shadow: '#000000',
  scrim: '#00000066',
  backdrop: '#00000042',
  elevation: {
    level0: 'transparent',
    level1: '#FFFFFF',
    level2: '#FAFAFA',
    level3: '#F5F5F5',
    level4: '#F0F0F0',
    level5: '#EBEBEB',
  },
};

const darkColors: PaperColors = {
  primary: '#EDEDED',
  onPrimary: '#0B0B0B',
  primaryContainer: '#3A3A3A',
  onPrimaryContainer: '#FFFFFF',
  secondary: '#C9C9C9',
  onSecondary: '#0B0B0B',
  secondaryContainer: '#2B2B2B',
  onSecondaryContainer: '#EDEDED',
  tertiary: '#9C9C9C',
  onTertiary: '#0B0B0B',
  tertiaryContainer: '#262626',
  onTertiaryContainer: '#E0E0E0',
  error: '#FFFFFF',
  onError: '#000000',
  errorContainer: '#2E2E2E',
  onErrorContainer: '#FFFFFF',
  background: '#0B0B0B',
  onBackground: '#F2F2F2',
  surface: '#131313',
  onSurface: '#F2F2F2',
  surfaceVariant: '#1F1F1F',
  onSurfaceVariant: '#A0A0A0',
  surfaceDisabled: '#1A1A1A',
  onSurfaceDisabled: '#5E5E5E',
  outline: '#6B6B6B',
  outlineVariant: '#2E2E2E',
  inverseSurface: '#F2F2F2',
  inverseOnSurface: '#131313',
  inversePrimary: '#2B2B2B',
  shadow: '#000000',
  scrim: '#00000099',
  backdrop: '#00000080',
  elevation: {
    level0: 'transparent',
    level1: '#141414',
    level2: '#181818',
    level3: '#1C1C1C',
    level4: '#202020',
    level5: '#242424',
  },
};

export const monochromeColors: Record<Scheme, PaperColors> = {
  light: lightColors,
  dark: darkColors,
};