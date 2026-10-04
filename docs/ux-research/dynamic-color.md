# Material You Dynamic Color for react-native-paper (MD3 Dark) — Research & Design

Scoped to: React Native 0.81.4 (New Architecture, bridgeless), Android only, app `com.rajofearth.synomilo`, TypeScript, `react-native-paper` 5.15.3.
Target devices: Android 11 (API 30, no dynamic color — needs fallback) and Android 12+ (API 31+, has Material You system tonal palettes).

This is a design document. No application code was modified — all code below is copy-pasteable for a follow-up change.

---

## 1. Project facts (verified by reading the files)

| File | Finding |
| --- | --- |
| `android\app\src\main\java\com\rajofearth\synomilo\MainApplication.kt` | `DefaultReactNativeHost`, package list only from `PackageList(this).packages`, empty manual-add block. New arch flags come from `BuildConfig`. |
| `android\app\src\main\java\com\rajofearth\synomilo\MainActivity.kt` | Plain `ReactActivity`, `getMainComponentName() = "sampleapp"`. |
| `android\app\build.gradle` | `com.android.application`, `org.jetbrains.kotlin.android`, `com.facebook.react` plugins; dependencies: react-android, hermes-android, animated-gif. No custom native modules. |
| `android\build.gradle` | `compileSdkVersion 36`, `targetSdkVersion 36`, `minSdkVersion 24`, `kotlinVersion 2.1.20`, `buildToolsVersion 36.0.0`. |
| `android\settings.gradle` | AGP supplied by `@react-native/gradle-plugin` includeBuild (AGP 8.x, Gradle 8.14.3). |
| `android\gradle.properties` | `newArchEnabled=true`, `hermesEnabled=true`, `android.useAndroidX=true`. |
| `package.json` | `react-native 0.81.4`, `react-native-paper ^5.15.3`, `react-native-device-info`, TypeScript 5.8. No Material You library installed. |
| `src\theme\paperTheme.ts` | Static clone of `MD3DarkTheme` with `primary: '#5B4BC4'`, dark greys, explicit `elevation` levels. |
| `App.tsx` | `<PaperProvider theme={paperTheme}>` wraps `AppInner` (line 450); `CometChatThemeProvider` separately uses `styleConfig.color.brandColor`. |

Relevant Paper 5.15.3 type shape (from `node_modules\react-native-paper\lib\typescript\types.d.ts`): `MD3Theme = ThemeBase & { version: 3; isV3: true; colors: MD3Colors; fonts: MD3Typescale }`, where `MD3Colors` contains `primary`, `onPrimary`, `primaryContainer`, `onPrimaryContainer`, `secondary*`, `tertiary*`, `surface`, `surfaceVariant`, `background`, `onSurface`, `onSurfaceVariant`, `outline`, `outlineVariant`, `inverseSurface`, `inverseOnSurface`, `inversePrimary`, `shadow`, `scrim`, `backdrop`, `surfaceDisabled`, `onSurfaceDisabled`, `error`, `onError`, `errorContainer`, `onErrorContainer`, and `elevation: { level0..level5 }`.

---

## 2. Approach evaluation

### 2.1 `react-native-material-you` / `@assembless/react-native-material-you`

- Exists on npm: unscoped `react-native-material-you` is at **1.3.0, last published 2022-05-14**; the maintained-name package `@assembless/react-native-material-you` is at **1.0.0-beta.4, last published 2022-04-04** (still beta after 4 years).
- Legacy bridge module (`NativeModules` + `ReactContextBaseJavaModule`), no TurboModule/codegen support, no RN 0.81 statement, predates AGP 8 and Kotlin 2.x. It would only work through the new-arch interop layer if its old Android `build.gradle` conventions still resolve under AGP 8 + Gradle 8.14.3 — unverified and unmaintained.
- It also generates a full wallpaper-derived palette plus a React context/hook service we do not need; we only need the 5 system tonal palettes.

### 2.2 `react-native-material-you-colors`

- Exists: **0.1.2, last published 2023-10-23**. Multi-platform palette generator with Android/iOS/web support, but again a pre-new-arch legacy module, no RN 0.81 validation, single-maintainer, and it pulls in palette generation we do not need.

### 2.3 Zero-native alternative: `PlatformColor('@android:color/system_accent1_80')`

React Native's `PlatformColor` can resolve Android system resources without native code. **Rejected** because react-native-paper performs string color math on theme colors using the `color` library, e.g. `color(theme.colors.onSurfaceVariant).alpha(0.12).rgb().string()` (`node_modules\react-native-paper\lib\commonjs\components\Button\Button.js:148`, `components\Chip\helpers.js`, `components\Switch\utils.js`, `components\TextInput\helpers.js`, and ~90 more call sites). `PlatformColor` returns an opaque native color object, not a hex string, so those calls produce invalid colors / broken ripples and disabled states. A Paper theme must contain plain hex/rgb strings.

### 2.4 Verdict

Neither npm package is reliable for RN 0.81.4 + AGP 8 + Kotlin 2.1.20, and `PlatformColor` is incompatible with Paper's color utilities. **Chosen approach: a minimal custom legacy native module** (`ReactContextBaseJavaModule`) resolved through the new-arch TurboModule interop layer (enabled by default under bridgeless in RN 0.74+). It is ~70 lines of Kotlin, no new dependencies, no codegen, and it degrades to `null` on API < 31 so the existing static theme is used.

---

## 3. Native module (Kotlin)

### 3.1 New file: `android\app\src\main\java\com\rajofearth\synomilo\DynamicColorModule.kt`

```kotlin
package com.rajofearth.synomilo

import android.content.res.Resources
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

class DynamicColorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DynamicColor"

  @ReactMethod
  fun getSystemColors(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      promise.resolve(null)
      return
    }

    try {
      val resources = Resources.getSystem()
      val palettes = listOf(
          "system_accent1",
          "system_accent2",
          "system_accent3",
          "system_neutral1",
          "system_neutral2",
      )
      val tones = listOf(0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99)
      val result: WritableMap = Arguments.createMap()
      var found = 0

      for (palette in palettes) {
        for (tone in tones) {
          val name = "${palette}_$tone"
          val id = resources.getIdentifier(name, "color", "android")
          if (id != 0) {
            result.putInt(name, resources.getColor(id, null))
            found++
          }
        }
      }

      if (found == 0) {
        promise.resolve(null)
      } else {
        promise.resolve(result)
      }
    } catch (error: Exception) {
      promise.reject("E_DYNAMIC_COLOR", error.message, error)
    }
  }
}
```

Notes:
- `Resources.getSystem()` avoids holding a `Context` and resolves `android` package resources directly.
- `getIdentifier(...)` returns `0` for tones an OEM omitted, so missing entries are silently skipped (never a crash).
- `resources.getColor(id, null)` is API 23+; `minSdkVersion` here is 24.
- Android's system palettes have **no tone 6**; available steps are 0, 10, ..., 90, 95, 99 (and 100 on some versions). We request the 12 steps the M3 mapping needs and ignore the rest.
- The module is a legacy bridge module; under RN 0.81 bridgeless it is exposed through the TurboModule interop layer, and `Promise`/`WritableMap`/`putInt` are all supported by interop.

### 3.2 New file: `android\app\src\main\java\com\rajofearth\synomilo\DynamicColorPackage.kt`

```kotlin
package com.rajofearth.synomilo

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DynamicColorPackage : ReactPackage {

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(DynamicColorModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
```

---

## 4. MainApplication.kt modification

### 4.1 Current file content (verbatim, 38 lines)

Path: `android\app\src\main\java\com\rajofearth\synomilo\MainApplication.kt`

```kotlin
package com.rajofearth.synomilo

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
```

### 4.2 Edited file content (only one line added)

```kotlin
package com.rajofearth.synomilo

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
              add(DynamicColorPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
```

No import is needed because `DynamicColorPackage` is in the same package.

---

## 5. TypeScript theme: `src\theme\dynamicTheme.ts`

Complete file. No placeholders.

```ts
import { NativeModules, TurboModuleRegistry } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { paperTheme } from './paperTheme';

type PaperColors = MD3Theme['colors'];
type Palette = Record<number, string>;

type DynamicColorNativeModule = {
  getSystemColors(): Promise<Record<string, number> | null>;
};

const STATIC_THEME = paperTheme as MD3Theme;
const FALLBACK = STATIC_THEME.colors;

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
      return STATIC_THEME;
    }
    const systemColors = await native.getSystemColors();
    if (!systemColors) {
      return STATIC_THEME;
    }
    const colors = buildDynamicColors(systemColors);
    if (!colors) {
      return STATIC_THEME;
    }
    return { ...STATIC_THEME, dark: true, colors };
  } catch {
    return STATIC_THEME;
  }
}
```

### 5.1 Token mapping used

| Paper token | System palette / tone | Fallback (static theme) |
| --- | --- | --- |
| `primary` | `system_accent1_80` | `#5B4BC4` |
| `onPrimary` | `system_accent1_20` | Paper default |
| `primaryContainer` | `system_accent1_30` | Paper default |
| `onPrimaryContainer` | `system_accent1_90` | Paper default |
| `inversePrimary` | `system_accent1_40` | Paper default |
| `secondary` | `system_accent2_80` | `#8B7CF6` |
| `onSecondary` | `system_accent2_20` | Paper default |
| `secondaryContainer` | `system_accent2_30` | Paper default |
| `onSecondaryContainer` | `system_accent2_90` | Paper default |
| `tertiary` | `system_accent3_80` | Paper default |
| `onTertiary` | `system_accent3_20` | Paper default |
| `tertiaryContainer` | `system_accent3_30` | Paper default |
| `onTertiaryContainer` | `system_accent3_90` | Paper default |
| `background`, `surface` | `system_neutral1_10` | `#0E0E14` / `#17171F` |
| `onBackground`, `onSurface` | `system_neutral1_90` | `#F4F4F6` |
| `surfaceVariant` | `system_neutral2_30` | `#22222C` |
| `onSurfaceVariant` | `system_neutral2_80` | `#A9A9B8` |
| `outline` | `system_neutral2_60` | `#3A3A46` |
| `outlineVariant` | `system_neutral2_30` | `#2A2A34` |
| `inverseSurface` | `system_neutral1_90` | Paper default |
| `inverseOnSurface` | `system_neutral1_20` | Paper default |
| `error` | static `#E5484D` | `#E5484D` |
| `errorContainer` / `onError*` | static M3 dark reds | `#93000A` / `#FFDAD6` / `#690005` |
| `elevation.level1..5` | `neutral1_10` mixed with white at 4/7/10/12/15% | current fixed greys |

Notes:
- `surfaceDisabled`/`onSurfaceDisabled` are `onSurface` (neutral1_90) at 12% / 38% alpha, matching how Paper's own `MD3DarkTheme` computes them. Keeping them as hex-derived `rgba()` strings is required because Paper feeds them into the `color` library.
- `elevation` is derived from the neutral surface instead of Paper's default primary-tinted overlay, which is what removes the purple cast from Appbar/FAB/Card/Menu elevations.
- Android exposes no public `system_error_*` tonal palette, so `error` and its container/on-colors stay static.

---

## 6. Wiring into the app (documented only; not applied)

`App.tsx` currently renders `<PaperProvider theme={paperTheme}>` at line 450. Replace the static import usage with a stateful theme resolved once at startup:

```tsx
import { useEffect, useState } from 'react';
import { PaperProvider } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { paperTheme } from './src/theme/paperTheme';
import { buildPaperTheme } from './src/theme/dynamicTheme';

const App = (): React.ReactElement => {
  const [theme, setTheme] = useState<MD3Theme>(paperTheme as MD3Theme);

  useEffect(() => {
    let mounted = true;
    buildPaperTheme().then(resolved => {
      if (mounted) {
        setTheme(resolved);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <ConvexProvider client={convex}>
      <PaperProvider theme={theme}>
        <SessionProvider>
          <AppInner />
        </SessionProvider>
      </PaperProvider>
    </ConvexProvider>
  );
};
```

`src\theme\paperTheme.ts` stays untouched and remains the fallback source. Note the CometChat UIKit is themed separately (`CometChatThemeProvider` in `App.tsx` uses `styleConfig.color.brandColor`), so chat bubbles/avatars keep the static brand color unless that provider is also fed dynamic colors later.

---

## 7. Gradle changes and rebuild

- **Gradle changes: none.** The two Kotlin files live in the app module, which already applies `org.jetbrains.kotlin.android`; no new dependencies, no `settings.gradle` autolinking entry, no codegen step (legacy module).
- **Rebuild required: yes.** `MainApplication.kt` changed, so a Metro reload is not enough. Run `npm run android` (debug) or `cd android && ./gradlew :app:assembleDebug`; for release `./gradlew :app:assembleRelease`. A clean build is not required, but if the module is not visible from JS, try `./gradlew clean` once.
- Release note: `enableProguardInReleaseBuilds = false` today. If minification is enabled later, add to `android\app\proguard-rules.pro`:
  `-keep class com.rajofearth.synomilo.DynamicColorModule { *; }` and `-keep class com.rajofearth.synomilo.DynamicColorPackage { *; }`.

---

## 8. Edge cases

1. **API < 31 (Android 11 test device):** Kotlin resolves `null`; `buildPaperTheme()` returns the static `paperTheme`. Primary stays `#5B4BC4`.
2. **Missing tones on some OEMs:** `getIdentifier` returns 0 and the tone is omitted; `pick()` falls back to the nearest available tone in that palette, then to the static token. `buildDynamicColors()` returns `null` (full static theme) if `system_accent1_*` or `system_neutral1_*` is entirely absent.
3. **No tone 6:** Android's system palette does not define tone 6; `surface`/`background` use `neutral1_10` as requested (use 10, not 6).
4. **Signed ARGB ints:** Android color ints are signed 32-bit `0xAARRGGBB`; `argb >>> 0` before bit-shifting prevents negative/`NaN` hex output. Alpha is dropped, which is fine because all `system_*` palette colors are opaque.
5. **No public system error palette:** `error` is pinned to `#E5484D` with static M3 dark container/on-colors.
6. **Module missing / not registered:** `getNativeModule()` returns `undefined` (and tries `TurboModuleRegistry` as a second route); the theme falls back silently. All native access is inside `try/catch`.
7. **Bridgeless interop:** legacy modules are reachable via `NativeModules` under RN 0.81's default TurboModule interop; no TurboModule spec or codegen is needed.
8. **Wallpaper change while running:** the palette is read once at startup. Android regenerates system colors on wallpaper change; if live refresh is wanted later, re-run `buildPaperTheme()` on `AppState` `'active'` or an `ACTION_WALLPAPER_CHANGED` receiver and call `setTheme`. Not required for v1.
9. **Paper color math:** every token returned by `buildDynamicColors()` is a hex or `rgba()` string, so `color(theme.colors.x).alpha(...)` calls inside Paper keep working; do not switch to `PlatformColor` here.
10. **OEM-tinted palettes:** OEMs may return palettes with unusual contrast (very light `accent1_80`). The M3 dark role mapping keeps on-color/container pairs from the same palette, which preserves contrast; if a specific OEM still looks wrong, widen the `pick()` fallback to enforce a minimum luminance delta without changing the theme structure.
11. **CometChat UI colors are separate:** dynamic colors only affect `react-native-paper` components until `CometChatThemeProvider` is fed the same palette.

## 9. Test plan

| Device | Expected |
| --- | --- |
| Android 12+ (API 31+) | `buildPaperTheme()` resolves dynamic tokens; pick two different wallpapers and confirm `primary`/`surface`/elevation greys change and ripples/disabled states still render. |
| Android 11 (API 30) | `getSystemColors` resolves `null`; UI is pixel-identical to today's static theme (`#5B4BC4` primary, dark greys). |
| Either + release build | Module still reachable (proguard rules if minify enabled). |
