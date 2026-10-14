import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { monochromeColors } from './paperTheme';
import type { Scheme } from './paperTheme';

export type { Scheme } from './paperTheme';

const BASE_THEME: Record<Scheme, MD3Theme> = {
  light: MD3LightTheme as MD3Theme,
  dark: MD3DarkTheme as MD3Theme,
};

/**
 * Returns the app's theme for a colour scheme.
 *
 * Pure static lookup: it never reads system, platform or wallpaper colours,
 * so it is synchronous and deterministic. Only `colors` is overridden -- the
 * base MD3 theme supplies `fonts`/`roundness`/`isV3`, which react-native-paper
 * requires internally.
 */
export function buildPaperTheme(scheme: Scheme): MD3Theme {
  return {
    ...BASE_THEME[scheme],
    dark: scheme === 'dark',
    colors: monochromeColors[scheme],
  };
}