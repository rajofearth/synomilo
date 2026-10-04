import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { paperTheme } from './paperTheme';

export type Scheme = 'light' | 'dark';

type PaperColors = MD3Theme['colors'];
type Palette = Record<number, string>;

type DynamicColorNativeModule = {
  getSystemColors(): Promise<Record<string, number> | null>;
};

const LIGHT_NEUTRALS = {
  background: '#FAFAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#E9E9EF',
  onSurface: '#19191D',
  onSurfaceVariant: '#45454E',
  outline: '#77777F',
  outlineVariant: '#C8C8D0',
  error: '#B3261E',
  elevation: {
    level0: 'transparent',
    level1: '#FCFCFE',
    level2: '#F9F9FC',
    level3: '#F5F5F9',
    level4: '#F2F2F6',
    level5: '#EEEEF3',
  },
};

export function staticFallbackTheme(scheme: Scheme): MD3Theme {
  if (scheme === 'light') {
    return {
      ...MD3LightTheme,
      dark: false,
      colors: {
        ...MD3LightTheme.colors,
        ...LIGHT_NEUTRALS,
      },
    } as MD3Theme;
  }

  return {
    ...MD3DarkTheme,
    ...paperTheme,
    colors: {
      ...MD3DarkTheme.colors,
      ...paperTheme.colors,
    },
  } as MD3Theme;
}

function getNativeModule(): DynamicColorNativeModule | undefined {
  try {
    const fromNativeModules = (NativeModules as Record<string, unknown>)
      .DynamicColor as DynamicColorNativeModule | undefined;
    if (fromNativeModules) {
      return fromNativeModules;
    }
    const fromTurboRegistry = TurboModuleRegistry.get(
      'DynamicColor',
    ) as unknown as DynamicColorNativeModule | null;
    return fromTurboRegistry ?? undefined;
  } catch {
    return undefined;
  }
}

export function isDynamicAvailable(): boolean {
  try {
    return (
      Platform.OS === 'android' &&
      Number(Platform.Version) >= 31 &&
      getNativeModule() != null
    );
  } catch {
    return false;
  }
}

function argbToHex(argb: number): string {
  const value = argb >>> 0;
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `#${[r, g, b]
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function toPalette(colors: Record<string, number>, prefix: string): Palette {
  const palette: Palette = {};
  for (const [name, value] of Object.entries(colors)) {
    if (!name.startsWith(`${prefix}_`)) {
      continue;
    }
    const tone = Number(name.slice(prefix.length + 1));
    if (!Number.isFinite(tone)) {
      continue;
    }
    palette[tone] = argbToHex(value);
  }
  return palette;
}

function pick(palette: Palette, tone: number, fallback: string): string {
  const exact = palette[tone];
  if (exact) {
    return exact;
  }
  const available = Object.keys(palette).map(Number);
  if (available.length === 0) {
    return fallback;
  }
  const nearest = available.reduce((best, candidate) =>
    Math.abs(candidate - tone) < Math.abs(best - tone) ? candidate : best,
  );
  return palette[nearest] ?? fallback;
}

function buildDynamicColors(
  colors: Record<string, number>,
  scheme: Scheme,
): PaperColors | null {
  const accent1 = toPalette(colors, 'system_accent1');
  const accent2 = toPalette(colors, 'system_accent2');
  const accent3 = toPalette(colors, 'system_accent3');

  if (Object.keys(accent1).length === 0) {
    return null;
  }

  const base = staticFallbackTheme(scheme).colors;

  if (scheme === 'light') {
    return {
      ...base,
      primary: pick(accent1, 40, base.primary),
      onPrimary: pick(accent1, 100, pick(accent1, 99, base.onPrimary)),
      primaryContainer: pick(accent1, 90, base.primaryContainer),
      onPrimaryContainer: pick(accent1, 10, base.onPrimaryContainer),
      inversePrimary: pick(accent1, 80, base.inversePrimary),
      secondary: pick(accent2, 40, base.secondary),
      onSecondary: pick(accent2, 100, pick(accent2, 99, base.onSecondary)),
      secondaryContainer: pick(accent2, 90, base.secondaryContainer),
      onSecondaryContainer: pick(accent2, 10, base.onSecondaryContainer),
      tertiary: pick(accent3, 40, base.tertiary),
      onTertiary: pick(accent3, 100, pick(accent3, 99, base.onTertiary)),
      tertiaryContainer: pick(accent3, 90, base.tertiaryContainer),
      onTertiaryContainer: pick(accent3, 10, base.onTertiaryContainer),
    };
  }

  return {
    ...base,
    primary: pick(accent1, 80, base.primary),
    onPrimary: pick(accent1, 20, base.onPrimary),
    primaryContainer: pick(accent1, 30, base.primaryContainer),
    onPrimaryContainer: pick(accent1, 90, base.onPrimaryContainer),
    inversePrimary: pick(accent1, 40, base.inversePrimary),
    secondary: pick(accent2, 80, base.secondary),
    onSecondary: pick(accent2, 20, base.onSecondary),
    secondaryContainer: pick(accent2, 30, base.secondaryContainer),
    onSecondaryContainer: pick(accent2, 90, base.onSecondaryContainer),
    tertiary: pick(accent3, 80, base.tertiary),
    onTertiary: pick(accent3, 20, base.onTertiary),
    tertiaryContainer: pick(accent3, 30, base.tertiaryContainer),
    onTertiaryContainer: pick(accent3, 90, base.onTertiaryContainer),
  };
}

export async function buildPaperTheme(scheme: Scheme): Promise<MD3Theme> {
  const fallback = staticFallbackTheme(scheme);
  try {
    const native = getNativeModule();
    if (!native) {
      return fallback;
    }
    const systemColors = await native.getSystemColors();
    if (!systemColors) {
      return fallback;
    }
    const colors = buildDynamicColors(systemColors, scheme);
    if (!colors) {
      return fallback;
    }
    return { ...fallback, dark: scheme === 'dark', colors };
  } catch {
    return fallback;
  }
}
