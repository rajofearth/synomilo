import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import type { Scheme } from '../theme/paperTheme';

export type ThemeFonts = MD3Theme['fonts'];

/**
 * Font set per colour scheme.
 *
 * MD3 light and dark currently ship the same type scale, so these two entries
 * are equal today. They are still resolved per scheme rather than sharing one
 * constant, because the theme memo in `src/theme/dynamicTheme.ts` is keyed on
 * `[scheme, font]` -- the moment a scheme gets its own font variant (a serif
 * dark mode, a condensed light mode), it has to arrive through this table and
 * not through a new branch somewhere downstream.
 *
 * Module-scope constants, so identity is stable across renders. That is what
 * makes `font` usable as a dependency: a freshly-built object every render
 * would defeat the memo and rebuild the theme on every frame.
 */
const FONTS_BY_SCHEME: Record<Scheme, ThemeFonts> = {
  light: (MD3LightTheme as MD3Theme).fonts,
  dark: (MD3DarkTheme as MD3Theme).fonts,
};

/**
 * Pure, synchronous, no I/O.
 *
 * This must never become async. A theme that arrives a tick late is a flash of
 * the wrong scheme on cold start, and the app reads its theme during the first
 * render, before any bridge round trip could have resolved.
 */
export function resolveThemeFonts(scheme: Scheme): ThemeFonts {
  return FONTS_BY_SCHEME[scheme];
}