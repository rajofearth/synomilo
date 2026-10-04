import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { MD3DarkTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { paperTheme } from './paperTheme';

type PaperColors = MD3Theme['colors'];
type Palette = Record<number, string>;

type DynamicColorNativeModule = {
  getSystemColors(): Promise<Record<string, number> | null>;
};

export const staticFallbackTheme: MD3Theme = {
  ...MD3DarkTheme,
  ...paperTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...paperTheme.colors,
  },
} as MD3Theme;

const FALLBACK = staticFallbackTheme.colors;

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

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map(char => char + char)
          .join('')
      : normalized.padEnd(6, '0');
  const value = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value)) {
    return [0, 0, 0];
  }
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mix(hex: string, target: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(target);
  const blend = (a: number, b: number) => Math.round(a + (b - a) * amount);
  const r = blend(r1, r2);
  const g = blend(g1, g2);
  const b = blend(b1, b2);
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

function buildElevation(surface: string): PaperColors['elevation'] {
  return {
    level0: 'transparent',
    level1: mix(surface, '#FFFFFF', 0.04),
    level2: mix(surface, '#FFFFFF', 0.07),
    level3: mix(surface, '#FFFFFF', 0.1),
    level4: mix(surface, '#FFFFFF', 0.12),
    level5: mix(surface, '#FFFFFF', 0.15),
  };
}

function buildDynamicColors(colors: Record<string, number>): PaperColors | null {
  const accent1 = toPalette(colors, 'system_accent1');
  const accent2 = toPalette(colors, 'system_accent2');
  const accent3 = toPalette(colors, 'system_accent3');
  const neutral1 = toPalette(colors, 'system_neutral1');
  const neutral2 = toPalette(colors, 'system_neutral2');

  if (Object.keys(accent1).length === 0 || Object.keys(neutral1).length === 0) {
    return null;
  }

  const surface = pick(neutral1, 10, FALLBACK.surface);
  const onSurface = pick(neutral1, 90, FALLBACK.onSurface);

  return {
    ...FALLBACK,
    primary: pick(accent1, 80, FALLBACK.primary),
    onPrimary: pick(accent1, 20, FALLBACK.onPrimary),
    primaryContainer: pick(accent1, 30, FALLBACK.primaryContainer),
    onPrimaryContainer: pick(accent1, 90, FALLBACK.onPrimaryContainer),
    inversePrimary: pick(accent1, 40, FALLBACK.inversePrimary),
    secondary: pick(accent2, 80, FALLBACK.secondary),
    onSecondary: pick(accent2, 20, FALLBACK.onSecondary),
    secondaryContainer: pick(accent2, 30, FALLBACK.secondaryContainer),
    onSecondaryContainer: pick(accent2, 90, FALLBACK.onSecondaryContainer),
    tertiary: pick(accent3, 80, FALLBACK.tertiary),
    onTertiary: pick(accent3, 20, FALLBACK.onTertiary),
    tertiaryContainer: pick(accent3, 30, FALLBACK.tertiaryContainer),
    onTertiaryContainer: pick(accent3, 90, FALLBACK.onTertiaryContainer),
    background: surface,
    onBackground: onSurface,
    surface,
    onSurface,
    surfaceVariant: pick(neutral2, 30, FALLBACK.surfaceVariant),
    onSurfaceVariant: pick(neutral2, 80, FALLBACK.onSurfaceVariant),
    outline: pick(neutral2, 60, FALLBACK.outline),
    outlineVariant: pick(neutral2, 30, FALLBACK.outlineVariant),
    inverseSurface: pick(neutral1, 90, FALLBACK.inverseSurface),
    inverseOnSurface: pick(neutral1, 20, FALLBACK.inverseOnSurface),
    surfaceDisabled: withAlpha(onSurface, 0.12),
    onSurfaceDisabled: withAlpha(onSurface, 0.38),
    error: '#E5484D',
    onError: '#690005',
    errorContainer: '#93000A',
    onErrorContainer: '#FFDAD6',
    shadow: '#000000',
    scrim: '#000000',
    backdrop: withAlpha(pick(neutral2, 20, FALLBACK.surfaceVariant), 0.4),
    elevation: buildElevation(surface),
  };
}

export async function buildPaperTheme(): Promise<MD3Theme> {
  try {
    const native = getNativeModule();
    if (!native) {
      return staticFallbackTheme;
    }
    const systemColors = await native.getSystemColors();
    if (!systemColors) {
      return staticFallbackTheme;
    }
    const colors = buildDynamicColors(systemColors);
    if (!colors) {
      return staticFallbackTheme;
    }
    return { ...staticFallbackTheme, dark: true, colors };
  } catch {
    return staticFallbackTheme;
  }
}
