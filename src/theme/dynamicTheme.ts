import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { monochromeColors } from './paperTheme';
import type { Scheme } from './paperTheme';
import type { ThemeFonts } from '../utils/themeTypography';
import type { Theme as NavigationTheme } from '@react-navigation/native';

export type { Scheme } from './paperTheme';

const BASE_THEME: Record<Scheme, MD3Theme> = {
  light: MD3LightTheme as MD3Theme,
  dark: MD3DarkTheme as MD3Theme,
};

/**
 * THE SINGLE SOURCE OF TRUTH FOR THE APP'S COLOURS.
 *
 * Everything the app draws comes from here, and `scheme` is the only input
 * that decides light vs dark. Read this before adding a second palette, a
 * second `useColorScheme()`, or a theme provider anywhere else.
 *
 * Why this has to be one derivation:
 *
 * `useColorScheme()` is a subscription, not a value. React Native implements it
 * with `useSyncExternalStore` over a native `appearanceChanged` event, so a
 * component that reads it holds its OWN subscription and its OWN copy of the
 * snapshot. Two components calling `useColorScheme()` are two independent
 * readers of the same source, each re-rendering on its own schedule.
 *
 * That is the failure this module exists to prevent. The app used to be read
 * twice -- once in `App.tsx` for `PaperProvider`, once in `RootStackNavigator`
 * for the `NavigationContainer` theme and the `StatusBar` bar style. Paper
 * re-themed from one snapshot while the navigation container and the status bar
 * re-themed from another, so a scheme flip could leave a frame where the screen
 * background and the chrome around it disagreed. And because the navigation
 * theme was React Navigation's `DefaultTheme`/`DarkTheme` rather than this
 * palette, `primary` stayed `rgb(0, 122, 255)` and `notification` stayed
 * `rgb(255, 59, 48)` in BOTH schemes -- hue in a monochrome app, and the
 * clearest signal a user gets that "the theme did not follow the device".
 *
 * The rule, then:
 *   - `scheme` is read in exactly one place (`useAppColorScheme`, below).
 *   - `buildPaperTheme` turns it into the one theme object.
 *   - Everything else -- Paper components, the navigation container, the
 *     status bar -- derives from that object. No second read, no second palette.
 *
 * Both functions are pure and synchronous on purpose. A theme that resolves a
 * tick late is a flash of the wrong scheme on cold start.
 */

/**
 * Returns the app's theme for a colour scheme.
 *
 * Pure static lookup: it never reads system, platform or wallpaper colours,
 * so it is synchronous and deterministic. Only `colors` is overridden -- the
 * base MD3 theme supplies `fonts`/`roundness`/`isV3`, which react-native-paper
 * requires internally.
 *
 * Returns a NEW object every call, which is what Paper needs: it re-renders on
 * a changed `theme` prop identity, so a mutated-in-place theme would leave the
 * whole tree on the previous scheme until something else forced a render.
 */
export function buildPaperTheme(scheme: Scheme, fonts?: ThemeFonts): MD3Theme {
  const base = BASE_THEME[scheme];
  return {
    ...base,
    fonts: fonts ?? base.fonts,
    dark: scheme === 'dark',
    colors: monochromeColors[scheme],
  };
}

/**
 * Derives the React Navigation theme from the Paper theme.
 *
 * It takes the theme as an argument rather than reading `useColorScheme()`
 * itself. That is the whole point: `NavigationContainer` must repaint off the
 * same object Paper repaints off, or the two can disagree for a frame and the
 * chrome can disagree with the screen indefinitely.
 *
 * Every colour is mapped from the monochrome palette, so there is no hue left
 * to leak in from React Navigation's own defaults.
 */
export function buildNavigationTheme(theme: MD3Theme): NavigationTheme {
  const colors = theme.colors;
  const fonts = theme.fonts;
  // MD3's `fontWeight` is optional; React Navigation's FontStyle requires it.
  // MD3's `fontWeight` is optional and may be 'normal'/'bold'; React Navigation's
  // FontStyle wants a numeric string.
  const weight = (value: unknown): '400' | '500' | '700' => {
    const raw = typeof value === 'string' ? value : undefined;
    if (raw === 'bold' || raw === '700') return '700';
    if (raw === '500' || raw === '600') return '500';
    return '400';
  };
  return {
    dark: theme.dark === true,
    fonts: {
      regular: {
        fontFamily: fonts.bodyMedium.fontFamily,
        fontWeight: weight(fonts.bodyMedium.fontWeight),
      },
      medium: {
        fontFamily: fonts.titleMedium.fontFamily,
        fontWeight: weight(fonts.titleMedium.fontWeight),
      },
      bold: {
        fontFamily: fonts.headlineSmall.fontFamily,
        fontWeight: weight(fonts.headlineSmall.fontWeight),
      },
      heavy: {
        fontFamily: fonts.headlineLarge.fontFamily,
        fontWeight: weight(fonts.headlineLarge.fontWeight),
      },
    },
    colors: {
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.onSurface,
      border: colors.outlineVariant,
      notification: colors.error,
    },
  };
}