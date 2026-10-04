# Material 3 Expressive (M3E) spec for synomilo

Stack: React Native 0.81 · react-native-paper 5.15.3 (MD3) · Android-first · dark theme.
Constraint: **RN `Animated` only, no Reanimated** (do not add it). Doc-only: no app code was changed.
Date: 2026-10-04.

Sources are listed at the end. Values labelled *(canvas)* come from lnkiai/m3e-canvas, not Google.
Values labelled *(community)* are derived from third-party M3E implementations, not official tokens.

---

## 1. What lnkiai/m3e-canvas demonstrates

M3E Canvas is a browser sketch tool for M3 Expressive, not a component library. Its README and source
(`lib/tokens.ts`, `lib/shapes.ts`, `app/globals.css`) encode concrete M3E behaviour we can copy:

- **Four expressive theme axes** in one panel: color (7 presets or seed → full scheme, light/dark,
  3 contrast levels, dynamic-color switch), shape (square / rounded / full for every part), type
  (Roboto / Roboto Flex / Roboto Serif / system + emphasized styles), motion (standard vs expressive
  spring scheme, also driving preview transitions).
- **Component variants**: buttons at 5 sizes XS–XL (32/40/56/96/136 dp with matching padding, icon and
  font sizes), chips at 3 sizes (32/40/56), FABs 40/56/96 + extended FABs, split button (2 dp hairline,
  trailing arrow segment ~60% padding),   FAB menu, connected button groups, flexible nav bar ↔ rail
  (rail collapsed 96 / expanded 220), top app bars S/M/L (64/112/152), carousels with 4 layouts,
  toolbars, search bar, tooltips, date/time pickers, wavy progress.
- **Shape morph**: magnetic snapping fuses two buttons/list items into one run; "the corners soften as
  they meet" — outer corners stay large (28 dp / full) while inner corners drop to 8 dp (`GAP = 3`,
  `R_FULL = 28`, `R_INNER = 8`).
- **Motion**: a single `SETTLE_MS = 340` with `cubic-bezier(0.2, 0, 0, 1)` for size/position settles;
  corner changes use a shorter 220 ms; press feedback scales to 0.94 over 120 ms (tiles 0.96/140 ms);
  reduced-motion is honoured.
- **Loading indicator**: ported from material-components-android — 7 morphing shapes
  (soft burst → cookie 9 → pentagon → pill → sunny → cookie 4 → oval), one shape per 650 ms, driven by
  a unit-mass spring **stiffness 200, damping ratio 0.6**, plus 50° constant + 90° extra rotation.
- **Elevated surfaces**: elevated variant uses `0 1px 3px rgba(0,0,0,.2), 0 4px 8px rgba(0,0,0,.1)`;
  everything else is tonal (no shadow), consistent with M3E.

Takeaway: canvas is a good visual reference for component inventory and morph behaviour, but Google's
published tokens are the authority for exact dp/spring values used below.

---

## 2. Concrete M3E specs

### 2.1 Corner radius scale

| Token | Radius |
| --- | --- |
| none | 0 dp |
| extra-small | 4 dp |
| small | 8 dp |
| medium | 12 dp |
| large | 16 dp |
| large-increased | 20 dp |
| extra-large | 28 dp |
| extra-large-increased | 32 dp |
| extra-extra-large | 48 dp |
| full | fully rounded (height/2) |

Component mapping (defaults):

| Component | Radius | Notes |
| --- | --- | --- |
| Buttons (round) | full | rest state |
| Buttons (square) | XS/S 12 · M 16 · L/XL 28 | pressed morph: XS/S 8 · M 12 · L/XL 16 |
| Icon buttons | full (round) / same as buttons (square) | always ≥ 48×48 target |
| FAB 56 | 16 (large) | |
| Medium FAB 80 | 20 (large-increased) | |
| Large FAB 96 | 28 (extra-large) | |
| Extended FAB small/medium/large | 16 / 20 / 28 | heights 56/80/96 |
| Cards (filled/outlined/elevated) | 12 (medium) | |
| Dialog (floating) | 28 (extra-large) | width 280–560, padding 24, scrim 0.32 |
| Dialog (full-screen) | 0 | header + bottom action bar 56 |
| Bottom sheet (modal) | 28 top corners, 0 bottom | side sheet 16 |
| Menu container (baseline M3) | 4 (extra-small) | |
| Menu groups (M3E) *(community)* | 16 per group surface, 2 dp gaps | selected item state corner 12, item state 4 |
| Navigation bar | 0 container | active indicator 56×32, radius full |
| Snackbar | 4 (extra-small) | *(canvas uses 8)* |
| Search bar | full (28 at 56 height) | |
| Text field (filled/outlined) | 4 | unchanged by M3E; *(canvas draws 16)* |
| Chips | 8 (small) | |
| Connected button group | outer: 22–28 / full; inner: 4–8, 2 dp gaps | inner = outer − padding (optical roundness) |
| Grouped list container | outer 16–28, inner 8 *(canvas)* | first/last item round, middle items 8 |

Rule of thumb: **resting shapes got rounder, pressed shapes got squarer**; grouped/connected items use
smaller inner corners so two surfaces read as one silhouette.

### 2.2 Motion physics (springs)

M3E replaces durations/easing with spring composites. Spatial = moves/resizes (may bounce). Effects =
color/alpha (never bounces). Official token values:

| Token | Stiffness | Damping ratio | Approx. duration | RN `Animated.spring` (mass 1): `c = 2ζ√k` |
| --- | --- | --- | --- | --- |
| Expressive fast spatial | 800 | 0.60 | ~350 ms | stiffness 800, damping **34** |
| Expressive default spatial | 380 | 0.75–0.80 | ~500 ms | stiffness 380, damping **29** (0.75) |
| Expressive slow spatial | 200 | 0.80 | ~650 ms | stiffness 200, damping **23** |
| Standard fast spatial | 1400 | 0.90 | ~350 ms | stiffness 1400, damping **67** |
| Standard default spatial | 700 | 0.90 | ~500 ms | stiffness 700, damping **48** |
| Standard slow spatial | 300 | 0.90 | ~750 ms | stiffness 300, damping **31** |
| Effects fast / default / slow | 3800 / 1600 / 800 | 1.0 | 150 / 200 / 300 ms | damping **123 / 80 / 57** |

Cubic-bezier fallbacks if a spring is impractical (y > 1 = overshoot; RN `Easing.bezier` supports it):

| Token | Curve | Duration |
| --- | --- | --- |
| Expressive fast spatial | `(0.42, 1.67, 0.21, 0.90)` | 350 ms |
| Expressive default spatial | `(0.38, 1.21, 0.22, 1.00)` | 500 ms |
| Expressive slow spatial | `(0.39, 1.29, 0.35, 0.98)` | 650 ms |
| Effects (both schemes) fast/default/slow | `(0.31, 0.94, 0.34, 1.00)` / `(0.34, 0.80, 0.34, 1.00)` / `(0.34, 0.88, 0.34, 1.00)` | 150 / 200 / 300 ms |

Legacy emphasized set (still fine for screen transitions): standard `cubic-bezier(0.2, 0, 0, 1)`,
emphasized decelerate `(0.05, 0.7, 0.1, 1)`, emphasized accelerate `(0.3, 0, 0.8, 0.15)`. Enter 400 ms,
exit 200 ms.

**Bounce guidance**

| Interaction | Motion | Why |
| --- | --- | --- |
| FAB press-in | effects fast, no bounce (or scale 0.94 in ~120 ms) | direct manipulation: must feel immediate |
| FAB release | expressive fast spatial | small, delightful overshoot |
| FAB → extended morph / FAB menu open | expressive default spatial | larger spatial change, hero moment |
| Menu open | expressive default spatial (scale 0.92→1 + fade) | anchor-origin reveal |
| Menu close | effects fast + accelerate, no bounce | exits are faster, no overshoot |
| Dialog enter | standard default spatial or timing 300 ms, no bounce | modals need stability |
| Dialog exit | standard accelerate ~200 ms | |
| Tab / nav indicator morph | expressive default spatial, one axis only | spec: indicator animates on one axis |
| List item press / ripple | effects fast, no bounce | high-frequency, under finger |
| Snackbar in/out | effects default, no bounce | |
| Sheet enter | expressive default spatial | |
| Progress/loading | linear rotation + effects | continuous, shimmer must not bounce |

Rule: bounce on **release/open/selection** of prominent elements; never on press-in, exit, color or
high-frequency controls.

### 2.3 Shape morphing that is practical in RN

1. **Pill button press**: radius 20→12 (M button) on press, spring back on release. `borderRadius`
   is JS-driver only — keep it on a separate `Animated.Value`.
2. **FAB press**: scale 0.94 + radius 16→12; release springs back with slight overshoot.
3. **Active tab / nav indicator**: animate width and `translateX`; Paper's `Navigation.Bar` already
   animates its pill indicator — prefer configuring it over rebuilding.
4. **Connected groups**: static radii (outer 22–28, inner 8, 2–3 dp gaps). Animating individual
   corners needs four separate radius values, all JS-driven.
5. **Loading indicator**: rotate (native driver) + morph `borderRadius` circle↔rounded-square via JS
   driver. The exact 7-shape SVG morph is not reachable without `react-native-svg`.
6. **Split button**: corner morph of the arrow segment (small radius when closed, larger when open) at
   ~220 ms.

### 2.4 Typography emphasis

M3E adds emphasized variants to all 15 roles: **one weight step bolder** than baseline, same size and
line height. Baseline → emphasized: display/headline 400→500, titleLarge 400→500,
titleMedium/titleSmall 500→600, labels 500→600, body 400→500. Recommended line heights keep the M3
ratios: **1.2× for display/headline/title, ~1.5× for body/label**. Use heavier weight, size or color
to draw attention to headlines and primary actions — don't change both weight and tracking at once.

RN note: RN maps only static weights on Android; variable-font axes (`wght`, `opsz`, `ROND`) are not
usable through Paper. Ship Roboto 400/500/600/700 and pick a static weight per role.

### 2.5 Expressive component updates

- **FAB**: sizes small 40 (deprecated), FAB 56, medium 80, large 96; variants now by *size*, colors are
  primary / secondary / tertiary tonal (`*Container`); surface color no longer recommended.
- **FAB menu**: opens from any FAB, up to 6 items, 56 dp close button, 4 dp gap, anchored at the FAB's
  top-trailing corner; items match medium button metrics.
- **Button groups**: standard (padding XS 18 / S 12 / M–XL 8) vs connected (2 dp everywhere; inner
  radii XS 4 / S 8 / M 8 / L 16 / XL 20). Selected standard-group buttons change width, shape and
  padding. M3 segmented buttons are deprecated in favour of button groups / nav rail.
- **Split button**: primary action segment + trailing arrow segment (tighter padding), 2 dp hairline,
  arrow opens a menu; radius morphs between the two segment shapes.
- **Menus**: rounded group surfaces (16) with 2 dp gaps; 48 dp items; selected item gets a filled
  12 dp-corner state layer; baseline single-surface menus stay at 4 dp.
- **Dialogs**: floating 280–560 wide, 28 dp corners, 24 dp padding, `surfaceContainerHigh`, 0.32 scrim;
  full-screen variant at 0 dp with 56 dp header and bottom action bar.
- **Navigation bar**: *flexible* bar is 64 dp tall (was 80), item padding 6 dp top/bottom, indicator
  56×32 pill in `secondaryContainer`, active label in `secondary` (no longer bold), filled icon when
  active; at ≥ 600 dp items go horizontal with 40×56 dp pills holding icon+label.
- **Loading indicators**: shape-morphing indicator (7 shapes, 650 ms each, spring 200/0.6) and wavy
  linear/circular progress.
- **Snackbar**: 4 dp corners, `inverseSurface`, action aligned trailing.
- **Toolbars**: docked/floating replace the bottom app bar; floating toolbar is a full-radius pill at
  elevation 3.

### 2.6 Elevation, dark theme, rim light

- Elevation levels 0–5 with 0/1/3/6/8/12 dp shadow and tonal overlays; in dark theme depth comes from
  lightness, not shadow. M3E further de-emphasises shadows: dialogs/menus/sheets are tonal surfaces.
- Dark tonal levels (primary overlay over base surface): 0 = `#1C1B1F`-class base, then ~5 / 8 / 11 /
  12 / 14 % for levels 1–5. Paper's `theme.colors.elevation.level0…5` already encodes this — use
  `level1` sheets, `level2` nav bar/menu, `level3` dialogs/FAB.
- **Rim light** *(community, not an official token)*: on dark surfaces, a 1 dp top edge highlight
  (`rgba(255,255,255,0.05–0.08)`) or a faint `outlineVariant` border restores edge definition where
  shadows disappear. Apply sparingly to floating surfaces (FAB, dialogs, menus, snackbar).
- Dynamic color: on Android this normally comes from the wallpaper via a native module. We do not need
  it for the M3E *feel*; generate a scheme from a brand seed with `material-color-utilities` (pure JS,
  optional) and inject it into `theme.colors`, or hardcode the generated dark scheme.

---

## 3. Implementation checklist for synomilo

### 3.1 Theme overrides (Paper 5.15.3)

Paper's `roundness` is a **unit, 1 unit = 1 dp, and the v5 default is 4 — not Google's roundness 3**.
That default already produces card 12 (`3 × roundness`), FAB 16 (`4 × roundness`), dialog 28
(`7 × roundness`), menu/snackbar 4. So keep `roundness: 4` and override where M3E differs.

```tsx
import { MD3DarkTheme, configureFonts } from 'react-native-paper';

export const m3eTheme = {
  ...MD3DarkTheme,
  roundness: 4,                       // keep: card 12 / FAB 16 / dialog 28 / menu 4
  colors: {
    ...MD3DarkTheme.colors,
    // seed-generated scheme roles if not using MD3 defaults:
    // primary, primaryContainer, secondaryContainer, surfaceContainerHigh, ...
  },
  fonts: {
    ...MD3DarkTheme.fonts,
    titleLarge: { ...MD3DarkTheme.fonts.titleLarge, fontWeight: '600' as const },   // emphasized
    labelLarge: { ...MD3DarkTheme.fonts.labelLarge, fontWeight: '600' as const },
  },
};
```

Component-level targets (pass `style` / `contentStyle` / component `theme` prop):

| Component | Setting |
| --- | --- |
| Button | keep pill; if square look needed use `borderRadius: 12` (M) and pressed 12 |
| FAB | `size` per role + `style={{borderRadius: 16}}` (medium 80 → 20, large 96 → 28) |
| FAB extended | height 56; for M3E heights 80/96 set height + radius 20/28 + `titleLarge` label |
| Card | `mode="contained"`/`"outlined"`, `borderRadius: 12`, elevation 0 |
| Dialog | Paper default is already 28; set `style={{borderRadius: 28}}` to be explicit |
| Menu | `contentStyle={{borderRadius: 16, paddingVertical: 8}}`; `Menu.Item` height 48 |
| Navigation.Bar | keep Paper indicator; bar height 64 for flexible; `activeIndicatorStyle` if exposed |
| Snackbar | `wrapperStyle={{borderRadius: 4}}` |
| TextInput | outlined radius 4 (default); filled top radius 4 |
| Chip | default 8; avoid pill chips unless intentionally "full" shape |

### 3.2 Suggested spring constants (RN `Animated`, mass 1)

```ts
export const SPRINGS = {
  expressiveFastSpatial:    { stiffness: 800,  damping: 34,  mass: 1 },
  expressiveDefaultSpatial: { stiffness: 380,  damping: 29,  mass: 1 },
  expressiveSlowSpatial:    { stiffness: 200,  damping: 23,  mass: 1 },
  standardFastSpatial:      { stiffness: 1400, damping: 67,  mass: 1 },
  standardDefaultSpatial:   { stiffness: 700,  damping: 48,  mass: 1 },
  standardSlowSpatial:      { stiffness: 300,  damping: 31,  mass: 1 },
  effectsFast:              { stiffness: 3800, damping: 123, mass: 1 },
  effectsDefault:           { stiffness: 1600, damping: 80,  mass: 1 },
  effectsSlow:              { stiffness: 800,  damping: 57,  mass: 1 },
};
```

### 3.3 Menu entrance (native driver, expressive default spatial)

```tsx
const progress = useRef(new Animated.Value(0)).current;

useEffect(() => {
  if (visible) {
    Animated.spring(progress, {
      toValue: 1,
      stiffness: 380,   // expressive default spatial
      damping: 29,      // c = 2 * 0.75 * sqrt(380)
      mass: 1,
      useNativeDriver: true,
    }).start();
  } else {
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      easing: Easing.bezier(0.34, 0.88, 0.34, 1), // effects default curve, no bounce
      useNativeDriver: true,
    }).start();
  }
}, [visible]);

const style = {
  opacity: progress,
  transform: [
    { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
  ],
};
```

Paper's built-in `Menu` hardcodes 250 ms + `cubic-bezier(0.4, 0, 0.2, 1)` and scales from 0. To get the
spring, render animated content inside `Portal`; otherwise set `theme.animation.scale` (global, affects
other Paper animations) and accept the easing.

### 3.4 FAB press (split drivers: scale native, radius JS)

```tsx
const press = useRef(new Animated.Value(0)).current;   // native driver (scale)
const radius = useRef(new Animated.Value(16)).current; // JS driver only (borderRadius)

const onPressIn = () => {
  Animated.parallel([
    Animated.spring(press, {
      toValue: 1, stiffness: 3800, damping: 123, mass: 1, useNativeDriver: true,
    }),
    Animated.timing(radius, {
      toValue: 12, duration: 120, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: false,
    }),
  ]).start();
};

const onPressOut = () => {
  Animated.parallel([
    Animated.spring(press, {
      toValue: 0, stiffness: 800, damping: 34, mass: 1, useNativeDriver: true,
    }),
    Animated.spring(radius, {
      toValue: 16, stiffness: 380, damping: 29, mass: 1, useNativeDriver: false,
    }),
  ]).start();
};

// <Animated.View style={{ borderRadius: radius,
//   transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }) }] }} />
```

### 3.5 Not feasible without Reanimated (workarounds only)

| Needed | Why RN Animated can't | Workaround without Reanimated |
| --- | --- | --- |
| Interruptible springs with gesture velocity | spring runs start-to-finish on one driver; retarget mid-flight is manual and JS-only | keep gestures on `PanResponder` + `Animated.spring` with `velocity`; acceptable for a single sheet/card |
| FAB → extended morph (width/height/padding/font) | layout props are JS-driver; per-frame layout on JS thread janks | crossfade label + `scaleX`/`translateX` on native driver; or skip the morph |
| `borderRadius` / `backgroundColor` with native driver | native driver only supports transform/opacity (color/radius JS-only) | separate `Animated.Value`s per driver; short 100–150 ms radius transitions; color crossfades via two views' opacity |
| GPU-thread shape morph (loading indicator, wavy progress) | needs SVG path interpolation (`react-native-svg` not installed) or Reanimated | rotate native + JS radius morph of a simple shape; use Paper `ActivityIndicator`/`ProgressBar` for progress |
| Shared-element transitions (FAB → screen) | no core support | `react-navigation` shared-element libs or plain fade/slide |
| Sheet drag-to-dismiss with spring follow | JS gesture thread | `Modal` + `Animated` translateY + spring on release; fine for one surface |
| Spring-driven list swipe with neighbour pull | per-frame layout on JS | skip neighbour pull; use `Swipeable`-style translate + fade |
| Reacting to scroll with native-smooth springs | `Animated.event` is linear only | accept interpolation or JS-driven |

Additional Paper 5 constraints: `Dialog`/`Modal` animation is fade+scale with no spring hook; `Menu`
easing is fixed; `Navigation.Bar` indicator animation is internal. Overriding these means wrapping in
`Portal`/`Modal` with our own `Animated` views.

---

## Sources

- lnkiai/m3e-canvas README + `lib/tokens.ts`, `lib/shapes.ts`, `app/globals.css` (fetched 2026-10-04).
- Google M3: [Corner radius scale](https://m3.material.io/styles/shape/corner-radius-scale),
  [Shape overview](https://m3.material.io/styles/shape/overview-principles),
  [Motion specs (spring composites)](https://m3.material.io/styles/motion/overview/specs),
  [Easing and duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs),
  [Buttons specs](https://m3.material.io/components/buttons/specs),
  [FAB overview](https://m3.material.io/components/floating-action-button/overview),
  [Extended FAB overview](https://m3.material.io/components/extended-fab/overview),
  [FAB menu specs](https://m3.material.io/components/fab-menu/specs),
  [Button groups specs](https://m3.material.io/components/button-groups/specs),
  [Dialogs specs](https://m3.material.io/components/dialogs/specs),
  [Menus specs](https://m3.material.io/components/menus/specs),
  [Navigation bar overview](https://m3.material.io/components/navigation-bar/overview),
  [Elevation tokens](https://m3.material.io/styles/elevation/tokens),
  [Typography applying type](https://m3.material.io/styles/typography/applying-type),
  [May 2025 announcement](https://m3.material.io/blog/building-with-m3-expressive).
- Community (cross-checks): material-components-android `BottomNavigation.md` (flexible bar 64 dp,
  indicator 56×32); Compose `MotionScheme`, `MaterialExpressiveTheme`, `Typography` refs;
  react-material-expressive docs (FAB/menu/nav metrics); material_3_expressive (dialog/scrim).
- react-native-paper 5.15.3 sources (`Card.tsx`, `Menu/Menu.tsx`, main-branch Dialog/FAB for contrast)
  and RN 0.81 `Animated` docs.
