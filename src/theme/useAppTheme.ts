import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { StatusBarStyle } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { useTheme } from 'react-native-paper';
import type { Theme as NavigationTheme } from '@react-navigation/native';
import { buildNavigationTheme, buildPaperTheme } from './dynamicTheme';
import type { Scheme } from './paperTheme';
import { resolveThemeFonts } from '../utils/themeTypography';
import type { ThemeFonts } from '../utils/themeTypography';

/**
 * SINGLE SOURCE OF TRUTH FOR THE COLOUR SCHEME.
 *
 * ------------------------------------------------------------------
 * DO NOT CALL `useColorScheme()` ANYWHERE ELSE IN THIS APP.
 * ------------------------------------------------------------------
 *
 * `useColorScheme()` is a subscription, not a value. React Native implements it
 * with `useSyncExternalStore` over a native `appearanceChanged` event, so every
 * caller holds its own subscription and its own snapshot of the scheme. Two
 * callers are two readers that re-render on their own schedule, and the app
 * had exactly that: `App.tsx` read it for `PaperProvider`, and
 * `RootStackNavigator` read it again for the `NavigationContainer` theme and
 * the `StatusBar` bar style. Paper repainted from one snapshot, the chrome
 * around it from another, and a scheme flip could leave them disagreeing.
 *
 * This module is the one place the OS scheme enters the app:
 *
 *     useColorScheme()  ->  useAppPaperTheme()  ->  PaperProvider
 *                                              ->  useAppNavigationTheme()  ->  NavigationContainer
 *                                              ->  useAppStatusBarStyle()   ->  StatusBar
 *
 * Everything downstream reads the theme object, never the OS. Because Paper's
 * `theme` prop is compared by identity and `buildPaperTheme` returns a new
 * object per call, flipping the scheme produces a new theme and the whole tree
 * re-renders in the same commit -- no relaunch, no second render pass, no
 * frame where the background and the chrome disagree.
 *
 * Do not add a persisted override here without reading this again. A persisted
 * scheme read from AsyncStorage arrives a tick late, which is a flash of the
 * wrong theme on cold start; `src/config/store.ts` is the place that hazard is
 * documented, and it deliberately stays out of the theme path.
 */

/**
 * The OS colour scheme, normalised to the two schemes the palette defines.
 *
 * `useColorScheme()` is `'light' | 'dark' | null`. `null` is treated as light
 * rather than dark so an unresolved read can never surprise the user with an
 * inverted UI.
 */
export function useAppColorScheme(): Scheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

/**
 * The Paper theme for the current scheme.
 *
 * Memoised on `[scheme, font]` -- every input `buildPaperTheme` reads. Drop
 * either one and the app silently keeps the previous scheme: that is the bug
 * this module exists to make impossible, so the dependency list is not
 * negotiable.
 */
export function useAppPaperTheme(): MD3Theme {
  const scheme = useAppColorScheme();
  const font: ThemeFonts = resolveThemeFonts(scheme);
  return useMemo(() => buildPaperTheme(scheme, font), [scheme, font]);
}

/**
 * The navigation theme, derived from the Paper theme already in context.
 *
 * It deliberately does NOT call `useColorScheme()`. `NavigationContainer` must
 * repaint off the same object Paper repaints off, or the screen and the chrome
 * around it can disagree for a frame -- and, if the reader were stale, until
 * the next relaunch.
 */
export function useAppNavigationTheme(): NavigationTheme {
  const paperTheme = useTheme<MD3Theme>();
  return useMemo(() => buildNavigationTheme(paperTheme), [paperTheme]);
}

/**
 * Status bar content colour for the current scheme.
 *
 * Derived from `theme.dark`, which is `scheme === 'dark'`, so the status bar
 * can never be driven by a different read of the OS than the screens.
 */
export function useAppStatusBarStyle(): StatusBarStyle {
  const paperTheme = useTheme<MD3Theme>();
  return paperTheme.dark === true ? 'light-content' : 'dark-content';
}