# 16 — UI/UX, Micro-interactions & Performance Research

**Scope:** read-only research + static audit. No source files were modified.
**Subject:** the React Native app at `P:\Projects\cometchat-sample-app`.
**Stack as found:** bare RN `0.81.4`, React `19.1.0`, Hermes, `newArchEnabled=true`
(`android/gradle.properties`), TypeScript, strictly achromatic (R===G===B) theme,
`react-native-paper@^5.15.3`, `react-native-gesture-handler@^2.28.0`,
`@react-native-vector-icons/material-design-icons@^13.1.4`. CometChat removed.
`src/` is 46 files / 12,235 lines; `ChatScreen.tsx` alone is 3,718 lines.

---

## 0. The fact that reframes every recommendation below

**React Native 0.81 is out of support.** It shipped 12 Aug 2025 and RN's own docs now
carry the banner *"This is documentation for React Native 0.81, which is no longer in
active development"* ([reactnative.dev/docs/0.81/flatlist](https://reactnative.dev/docs/0.81/flatlist)).
The [releases overview](https://reactnative.dev/docs/releases) lists `0.81.x` support as
ended; [endoflife.date/react-native](https://endoflife.date/react-native) dates active
support to 10 Dec 2025 and security support to 11 Feb 2026. Latest stable is **0.87.1**
(11 Aug 2026).

This is the single most consequential input to the library question, because most of the
ecosystem now pins support to *"the three latest React Native versions"* — which on
today's npm means 0.85 / 0.86 / 0.87, **not 0.81**.

Two consequences that show up repeatedly below:

1. Every 2026-native library (Reanimated 4, Unistyles 3, Tamagui 2, NativeWind 5) will
   let you *install* on RN 0.81 and then quietly stop shipping fixes for the exact
   combination you installed.
2. The app is already paying for this. `react-native-paper`'s own MD3
   [Searchbar modernization ticket #4978](https://github.com/callstack/react-native-paper/issues/4978)
   and the 6.0 line are all being built against RN 0.85+, not 0.81.

**Upgrading RN is out of scope for this document** but it is a standing prerequisite for
every "adopt the modern option" recommendation below. Where a recommendation depends on a
current RN, this report says so explicitly.

---

# PART 1 — UI/UX LIBRARY EVALUATION

## 1.1 Scores

Scale: 1 (bad) – 5 (excellent). "Achromatic fit" = can it render R===G===B without
fighting the library.

| Library | RN 0.81 + New Arch | Bundle size | Maintenance (Oct 2026) | TS quality | Licence | Migration cost from Paper | Achromatic fit | **Total /35** |
|---|---|---|---|---|---|---|---|---|
| **Stay on `react-native-paper` MD3** | 5 | 4 | 4 | 5 | 5 | **0** | 5 | **28** |
| **`unistyles` v3** (engine only) | 4 | 5 | 4 | 5 | 5 | n/a (additive) | 5 | **28** |
| **`@rn-primitives/*`** | 5 | 5 | 3 | 5 | 5 | 3 (additive) | 5 | **31** |
| **`tamagui` v2** | 5 | 3 | 5 | 5 | 5 | 2 (full rewrite) | 5 | **30** |
| **`nativewind` v4** / Tailwind v3 | 4 | 3 | 3 | 4 | 5 | 2 | 5 | **26** |
| **`gluestack-ui` v5** | 2 | 4 | 5 | 5 | 5 | 2 | 5 | **28** |
| `nativewind` v5 / Tailwind v4 | 1 | 3 | 2 (RC) | 4 | 5 | 2 | 5 | **22** |
| **`expo-*` equivalents** | — | — | — | — | — | — | — | **HARD NO** |

### Evidence per library

#### `react-native-paper` 5.15.3 — stay

- **Release / maintenance:** `6.0.0-alpha.0` shipped 15 Jun 2026, `5.15.3` on 26 May 2026
  ([releases](https://github.com/callstack/react-native-paper/releases)). Very active —
  June 2026 alone brought an MD3 FAB, an MD3 Switch, an MD3 Checkbox, motion tokens,
  `theme.state` opacity tokens and a new colour schema
  ([commits](https://github.com/callstack/react-native-paper/commits)).
- **Health:** MIT, 392.4k weekly downloads, 14.4k stars, package health 92/100, "maintenance
  healthy", 8 maintainers, 322 open issues / 111 open PRs
  ([Snyk](https://security.snyk.io/package/npm/react-native-paper)).
- **New Arch:** no New-Architecture blocker documented; the 5.x line is the stable one and
  is what this app ships. `6.0.0-alpha.0` explicitly added
  *"react-native-reanimated as peer dependency (#4912)"*.
- **Bundle:** Paper ships a production babel plugin for exactly this —
  `env.production.plugins: ['react-native-paper/babel']`
  ([6.x getting started](https://oss.callstack.com/react-native-paper/6.x/docs/guides/getting-started)).
  The app does **not** use it (`babel.config.js` is 3 lines). Free win, see Part 4.
- **Achromatic fit: perfect, and already proven.** `src/theme/paperTheme.ts:12-96` is a
  complete hand-authored greyscale MD3 palette where every value satisfies R===G===B.
  Paper's MD3 theme is a plain object; there is nothing to fight. The only real friction is
  documented in the file itself: Paper's default `primary` flips to near-white in dark mode
  (`ChatScreen.tsx:1722-1727`), which is why outgoing bubbles use the
  `primaryContainer`/`onPrimaryContainer` pair rather than `primary`. That is a one-time
  design decision, already made.
- **TypeScript:** first-class. `MD3Theme['colors']` is a typed interface; `paperTheme.ts:5`
  aliases it, so an accidental hue (`#E53935`) is a type-level no-op but a very visible diff.
- **Watch item:** Paper 6 requires `react-native-reanimated >= 4.3.0` **and**
  `react-native-worklets >= 0.8.1` ([6.x migration](https://oss.callstack.com/react-native-paper/6.x/docs/guides/migration)),
  and replaces `TextInput` with a complete rewrite that keeps the same import name but
  different props. Do not upgrade to 6.x piecemeal.

#### `tamagui` v2 — best *engine*, wrong *shape* for this app

- **Version fit is exact.** Tamagui 2's upgrade guide lists prerequisites as
  *"React 19+, React Native 0.81+ (with New Architecture support), TypeScript 5+"*
  ([upgrade guide](https://tamagui.dev/docs/guides/how-to-upgrade),
  [version-two announcement](https://tamagui.dev/blog/version-two)). This is the only
  candidate that names RN 0.81 as supported.
- **Performance:** *"within 10% of the speed of vanilla React Native… Running Tamagui
  without the compiler averages 125ms or ~12% slower"* ([benchmarks](https://tamagui.dev/docs/intro/benchmarks)).
- **Maintenance:** the most active project in this set. `next.md` shows compiler work
  landing through July 2026 and a v3 roadmap ([next.md](https://github.com/tamagui/tamagui/blob/main/next.md)).
- **The problem:** it is a *whole design system*, not a drop-in. It needs
  `tamagui.config.ts`, a **Metro plugin**, a **Babel plugin**, a font loader and a theme
  build step ([compiler install](https://github.com/tamagui/tamagui/blob/v2.7.7/code/tamagui.dev/data/docs/intro/compiler-install.mdx)).
  For a monochrome app the entire token set is ~30 greys — a config file, not a win.
- **Achromatic fit: perfect.** Tamagui themes are plain objects; a 30-token greyscale theme
  is a boring file.
- **Verdict: right answer for a greenfield app, wrong answer for a 12k-line app that
  already has a working paper theme.**

#### `@rn-primitives/*` — the genuinely useful addition

- **Positioning:** *"Style-free building blocks for React Native… Bring your own styles, we
  handle the behavior, accessibility, and platform differences"* ([rnprimitives.com](https://rnprimitives.com/)).
  Unstyled by design, which is **exactly** what a strictly-monochrome app wants — there is
  no design system to fight, so there is no hue to leak in.
- **Maintenance:** MIT, 943 stars, 419 commits, created Jan 2024
  ([repo](https://github.com/roninoss/rn-primitives)). Active: `all@1.5.2` "Accessibility
  overhaul" and `portal@1.5.3` in July 2026 ([releases](https://github.com/roninoss/rn-primitives/releases)).
  That overhaul is exactly the work this app would otherwise have to do by hand — it added
  `useAccessibilityFocus(enabled)`, fixed menu items being unselectable with screen
  readers, and fixed slider increment/decrement.
- **New Arch / bundle:** pure JS wrappers over RN primitives; no native module, no native
  build step. ~0 bundle cost, instant install.
- **Honest weakness:** ~943 stars is small. It is a one-maintainer project
  (mrzachnugent). Treat it as "copy the source, own it" — which the README explicitly
  offers as a supported mode.
- **Verdict: adopt *selectively*, per-primitive. See 1.3.**

#### `unistyles` v3 — best *styling engine*, but you don't have a styling problem

- **Perfect version fit:** *"Unistyles requires the New Architecture… compatible with React
  Native version >= 0.81, React 19+, TypeScript > 5.0"*; current 3.2.5
  ([for library authors](https://www.unistyl.es/v3/other/for-library-authors),
  [reactnative.directory](https://reactnative.directory/package/react-native-unistyles)).
- **The real mechanism is genuinely impressive:** *"Unistyles 3.0 updates only selected
  ShadowNodes from C++… your components are never re-rendered"*
  ([how unistyles works](https://unistyl.es/v3/start/how-unistyles-works)). A colour-scheme
  flip touches the ShadowTree, not React.
- **Cost:** it is a **hard** dependency on `react-native-nitro-modules` (≥0.35.2 for 3.2.x) —
  a second native module with its own C++ codegen step
  ([reactnative.directory](https://reactnative.directory/package/react-native-unistyles)).
- **Achromatic fit: perfect.** Themes are plain objects with `setTheme()`; a 30-token
  greyscale theme is trivial.
- **But:** the app's theming is *already* correct and *already* centralised
  (`src/theme/useAppTheme.ts` has an explicit DO-NOT-READ-`useColorScheme()`-TWICE rule,
  and the existing chat screen builds all 18 of its colours in one memoised `ui` token
  object at `ChatScreen.tsx:891-914`). Unistyles would be a second styling system
  coexisting with Paper's `StyleSheet.create` — a Babel plugin that rewrites every RN
  component import, for a problem the app does not have.
- **Known sharp edge, documented by a real user:** *"It does not generally track every prop
  that happens to carry style-like values. If the view mounts after that theme change,
  React Native receives the stale light object"* — i.e. a real class of "my view didn't
  update" bugs ([paseo/docs/unistyles.md](https://github.com/getpaseo/paseo/blob/main/docs/unistyles.md)).
- **Verdict: not now. Revisit only if the app ever needs runtime white-labelling or
  per-screen themes that must swap without a re-render.**

#### `gluestack-ui` — wrong answer twice over

- **It is now v5**, stable since 25 June 2026
  ([v5 stable release](https://gluestack.io/blogs/gluestack-ui-v5-stable-release)), and the
  v2 that the brief asks about is three majors behind.
- **v5 requires choosing a styling engine**, and the two options are
  *NativeWind v5 — Expo & React Native CLI* or *UniWind — Expo-only*
  ([installation](https://v5.gluestack.io/ui/docs/home/getting-started/installation)).
  So gluestack v5 on bare RN means **NativeWind v5**, which is a release candidate.
- **NativeWind v5 is an RC with a bare-RN problem.** v5 is `5.0.0-rc.0` paired exactly with
  `react-native-css@3.1.0-rc.0`, tested against *Expo 57.0.22 / RN 0.86.3 / React 19.2.3*
  ([v5 installation](https://www.nativewind.dev/v5/getting-started/installation)). The
  NativeWind repo's own `DEVELOPMENT.md` warns *"Read the release setup and compatibility
  limits before advising consumers"*
  ([DEVELOPMENT.md](https://github.com/nativewind/nativewind/blob/main/DEVELOPMENT.md)).
  A competitor's comparison table asserts *"NativeWind v5 (preview) dropped bare React
  Native support"* — vendor claim, but it is a red flag worth verifying yourself
  ([uniwind.dev/vs-nativewind](https://uniwind.dev/vs-nativewind)).
- **Its own CLI has a documented incident with RN 0.8x:** *"npx gluestack-ui init breaks
  babel.config.js on React Native 0.86+"* — it rewrites the preset to the
  long-removed `metro-react-native-babel-preset`, and installs
  `react-native-reanimated@~4.1.0` which it admits is *"incompatible with RN 0.86"*
  ([issue #3421](https://github.com/gluestack/gluestack-ui/issues/3421)).
- **Its benchmark page is stale** — it advertises gluestack v1 and claims *"How does gluestack v2 improve performance compared to v1? Coming soon..."*
  ([performance benchmarks](https://v1.gluestack.io/ui/v1)). v2's own FAQ page is still
  titled "Migration from V1 to V2" ([FAQs](https://v5.gluestack.io/ui/docs/guides/more/faqs)).
- **There is also a security incident on the record:** "React Native ARIA & gluestack-ui
  Security Incident Report", 3 Sep 2025 ([blogs](https://gluestack.io/blogs)).
- **Verdict: no.** Adopting it means adopting an RC Tailwind engine on an unsupported RN,
  through a CLI with a known config-rewriting bug.

#### `nativewind` / Tailwind v4 — RC on top of RC

- **v4 stable (4.2.7) is still Tailwind CSS v3.** Tailwind v4 exists only in
  `nativewind@5.0.0-rc.0`, and it is *"a release candidate… not intended for production use"*
  ([v5 docs](https://www.nativewind.dev/v5)).
- Achromatic fit would be fine (`@theme { --color-… }` accepts any hex). Maintenance and
  RN-0.81 fit are the problems.
- **Verdict: no.** Also note it would need `metro.config.js` surgery
  (`withNativewind`) and a `postcss.config.js` — for an app that has neither today and a
  working greyscale MD3 palette already.

#### `expo-*` equivalents — **HARD NO**

The brief is explicit that this is bare RN. Confirmed hard blockers, any one of which is
disqualifying:

- `expo-image`, `expo-haptics`, `expo-blur`, `expo-linear-gradient` require the Expo module
  system and an Expo Go / dev-client runtime.
- `npx expo install` **rewrites `package.json` dependency versions** to SDK-pinned ranges —
  it will fight `react-native-webrtc@^124`, `@notifee/react-native`, `@react-native-firebase/*`,
  `react-native-video`, and the hand-written native call stack
  (`android/app/src/main/java/com/rajofearth/synomilo/CallIntentModule.kt`,
  `IncomingCallActivity.kt`, `CallNotificationService.java`) that the whole calling feature
  depends on (see reports [01](01-call-incoming-ringing.md), [02](02-call-outgoing-ongoing.md),
  [13](13-call-architecture-proposal.md)).
- gluestack v5's own CLI and UniWind are Expo-first.

If a future Expo migration happens, **`expo-image` is the single package genuinely worth
porting** — it is the only one with no RN-core equivalent (see Part 2, image decoding).

---

## 1.2 RECOMMENDATION

> **Stay on `react-native-paper` MD3 and add `@rn-primitives/*` selectively.**

Rationale in one line each:

- **Paper is the zero-migration option and the app's monochrome palette is already a
  first-class Paper theme** (`src/theme/paperTheme.ts`, 96 lines, all greys). Replacing it
  means rewriting ~14 files and every token for zero user-visible gain.
- **The thing Paper is genuinely bad at is behaviour, not appearance** — focus management,
  ARIA semantics, keyboard interaction, escape-to-dismiss, portals. `@rn-primitives` is
  *unstyled by design*, so it slots underneath Paper without any risk of reintroducing hue.
- **The budget saved by not migrating is better spent on Part 3**, where there is a
  findable 20–40% re-render reduction in the chat list for zero new dependencies.

### 1.3 How the monochrome MD3 palette is expressed (no change needed)

`src/theme/paperTheme.ts` already defines it and it is already correct. The complete token
set, for the record:

| MD3 role | Light | Dark | Used for |
|---|---|---|---|
| `primary` | `#1A1A1A` | `#EDEDED` | FAB, active tab icon, unread badge, swipe arrow |
| `onPrimary` | `#FFFFFF` | `#0B0B0B` | content on `primary` |
| `primaryContainer` | `#E6E6E6` | `#3A3A3A` | **outgoing bubble**, `Avatar.Text`, menu cards |
| `onPrimaryContainer` | `#000000` | `#FFFFFF` | content on `primaryContainer` |
| `secondary` / `tertiary` | `#4D4D4D` / `#737373` | `#C9C9C9` / `#9C9C9C` | secondary emphasis |
| `error` | `#000000` | `#FFFFFF` | missed call, destructive action |
| `background` / `surface` | `#FFFFFF` | `#0B0B0B` / `#131313` | screen, card |
| `surfaceVariant` | `#F0F0F0` | `#1F1F1F` | **incoming bubble**, pressed row |
| `onSurfaceVariant` | `#5C5C5C` | `#A0A0A0` | timestamps, captions, send-button idle |
| `outline` | `#8A8A8A` | `#6B6B6B` | swipe-reply arrow, focus ring |
| `outlineVariant` | `#DEDEDE` | `#2E2E2E` | dividers, draft-bar top border |
| `elevation.level1…5` | `#FFFFFF`→`#EBEBEB` | `#141414`→`#242424` | the elevation ladder |

Three invariants worth writing into a regression test, because nothing enforces them:

1. `R === G === B` for every token.
2. Text-on-bubble pairs must be `primaryContainer`/`onPrimaryContainer` and
   `surfaceVariant`/`onSurface` — **never** `primary` + a literal white. The file already
   documents this at `ChatScreen.tsx:1722-1727` after the dark-mode flip produced
   white-on-near-white.
3. Status must never be carried by hue. Read receipts already do this correctly —
   `ChatScreen.tsx:1734-1736` distinguishes `sent`/`read` by **icon shape and weight**,
   not colour. Keep it that way.

### 1.4 The actual migration surface (for the record)

If you *ever* do migrate, this is the complete list of what would have to change — it is
small enough to be a weekend, which is precisely the argument for not doing it:

| File | Paper components used |
|---|---|
| `src/components/convex/ChatInfoScreen.tsx:23` | `ActivityIndicator, Appbar, Button, Checkbox, Chip, Dialog, Divider, IconButton, List, Portal, SegmentedButtons, Snackbar, Text, TextInput, useTheme` |
| `src/components/convex/ProfileScreen.tsx:22` | `ActivityIndicator, Button, Dialog, HelperText, Portal, Snackbar, Text, TextInput, useTheme` |
| `src/components/convex/AddContactScreen.tsx:20` | `ActivityIndicator, Button, HelperText, Text, TextInput, useTheme` |
| `src/components/convex/ConversationsList.tsx:11` | `Button, Dialog, Portal, Text, useTheme` |
| `src/components/convex/ForwardMessageScreen.tsx:11` | `Appbar, Searchbar, Divider, ActivityIndicator, Text, useTheme` |
| `src/components/convex/ContactInfoScreen.tsx:13` | `ActivityIndicator, Appbar, Button, Divider, List, Text, useTheme` |
| `src/components/convex/GroupsList.tsx:15` | `Text, TextInput, useTheme` |
| `src/components/convex/SettingsScreen.tsx:15` | `Text, useTheme` |
| `src/components/convex/UserAvatar.tsx:12` | `Avatar` (only `Avatar.Text`) |
| `src/updater/UpdateChecker.tsx:17` | `Button, Dialog, Portal, ProgressBar, Text, useTheme` |
| `App.tsx:5` | `Button, Dialog, PaperProvider, Portal, Text, useTheme` |
| `src/theme/{dynamicTheme,paperTheme,useAppTheme}.ts`, `src/utils/themeTypography.ts` | `MD3LightTheme, MD3DarkTheme, MD3Theme` types |
| 8 files | `useTheme` only (`ChatScreen`, `Calls`, `IncomingCallOverlay`, `OngoingCallBar`, `WebRTCCallScreen`, `Login`, `SignUp`, `RootStackNavigator`, `BottomTabNavigator`) |

Note the shape of that table: **10 files** carry real component weight; **9 files** use only
`useTheme`. A migration is mostly `useTheme` → a hook you write, and the bubble/avatar/media
surfaces (which are already hand-rolled with `StyleSheet.create`, not Paper) are untouched.
That is *why* the migration cost is honestly small — and also why the payoff is small.

---

# PART 2 — MICRO-INTERACTIONS

**Already available:** RN core `Animated` (with `useNativeDriver`), `LayoutAnimation`,
`Vibration`, `Modal`, `Pressable` (Android ripple built in), `FlatList`;
`react-native-gesture-handler` 2.28; `react-native-paper` (`Dialog`, `Modal`, `Menu`,
`Snackbar`, `ProgressBar`, `IconButton`, `TouchableRipple`); `safe-area-context`.
**Not installed:** `react-native-reanimated`, any bottom sheet, FlashList, any haptics lib.

Effort: **S** ≈ <½ day · **M** ≈ 1–2 days · **L** ≈ 3–5 days.

---

### 2.1 Send-button state morph (idle → sending spinner → sent tick) — **highest impact-per-risk**

- **Feasible now: YES, no new dependency.**
- **Implementation.** The composer already computes `canSend` from draft state
  (`ChatScreen.tsx:2100`). Cross-fade three absolutely-positioned children of one fixed-size
  `View`: the idle `MaterialDesignIcons name="send"`, an `ActivityIndicator`, and a
  `check`. Drive with a single `Animated.Value(0→1)`:
  `opacity: morph`, `transform: [{scale: morph.interpolate({inputRange:[0,0.5,1], outputRange:[1,1.25,1]})}]`.
  `useNativeDriver: true` for both — it is pure opacity/transform. Flip the state at
  `sendStatus` transitions already present on the `OutgoingMessage` row
  (`ChatScreen.tsx:98`: `'pending' | 'uploading' | 'sending' | 'sent' | 'failed'`).
  The morph is 140 ms `Easing.out(Easing.quad)`.
- **Effort: S.** ~40 lines, one file.
- **Accessibility.** The button must expose a single stable label that changes with state:
  `accessibilityLabel` = `"Send message"` → `"Sending"` → `"Sent"`. Never leave three
  focusable nodes in the tree — make the container `accessible` and the children
  `importantForAccessibility="no-hide-descendants"`. Under
  `AccessibilityInfo.isReduceMotionEnabled()`, snap opacity over 0 ms and drop the scale
  overshoot ([AccessibilityInfo](https://reactnative.dev/docs/0.81/accessibilityinfo)).

### 2.2 Swipe-to-reply: haptic + commit tuning — **already 80% there**

- **Feasible now: YES.** `SwipeReply` (`ChatScreen.tsx:474-600`) already does the hard part
  correctly: one-sided `activeOffsetX` so it never fights the scroll, `failOffsetY` so a
  vertical drag still scrolls, `translateX` on the native driver so a drag never crosses
  the bridge, and a slide-out → fire → slide-back commit (`ChatScreen.tsx:547-550`).
- **What is missing:**
  1. **Haptics.** Import `Vibration` from `react-native` and call
     `Vibration.vibrate(8)` inside `onEnd` at the moment of commit, **not** on
     `onStart`. The `VIBRATE` permission is already declared
     (`android/app/src/main/AndroidManifest.xml`). RN docs: on Android the default is
     400 ms — **8 ms is the right value for a tick**, a 400 ms buzz feels like a bug
     ([Vibration](https://reactnative.dev/docs/0.81/vibration)). Gate it behind a
     one-time setting toggle and never fire it when
     `AccessibilityInfo.isScreenReaderEnabled()` is true.
  2. **Commit threshold.** Current: commit when `|travelled| >= SWIPE_TRIGGER` (56dp).
     Prefer `travel >= SWIPE_REACH * 0.55 || velocityX > 350` — a fast flick should
     commit even if it never travelled 56dp. That is the single change that makes it
     feel like WhatsApp rather than like a drawer.
  3. **Reveal affordance.** Currently the arrow fades *and* scales via `reveal`
     (`ChatScreen.tsx:495-499, 574`). Add a third channel — rotate the arrow from
     `-15°` to `0°` over the same `reveal` — so the affordance is legible for
     users who cannot perceive the alpha ramp. Greyscale-only means shape is the
     *only* channel available; use it.
- **Effort: S.** **Impact: high.** This is the interaction users touch most.
- **Accessibility.** `onLongPress` already works alongside the swipe (the `activeOffsetX`
  threshold is chosen so a long-press never completes the pan — `ChatScreen.tsx:467-470`).
  Keep that. Add `accessibilityActions` + `onAccessibilityAction` `{name:'activate'}` on the
  bubble for "reply", so swipe-to-reply has a non-gesture equivalent for screen readers.

### 2.3 Optimistic send + upload progress animation — **feasible now, needs a design decision**

- **Feasible now: YES.**
- **Current state is functionally right and visually flat.** `SendProgressBar`
  (`ChatScreen.tsx:270-291`) sets `width: \`${Math.round(progress*100)}%\`` as a **plain
  string style on every XHR progress event** (`ChatScreen.tsx:165-168`). That is a layout
  property mutated on the JS thread at network-event frequency. It is correct; it is just
  visibly steppy, and `postWithProgress` fires up to ~60×/s on a fast connection.
- **What to change:**
  1. **Throttle** the progress callback to ~20 Hz (`ChatScreen.tsx:165`) and round to 1 %
     — currently it rounds to whole percent per event, which for a fast 2 MB upload is
     several events per percent.
  2. **Indeterminate state is currently a static `'30%'` bar** (`ChatScreen.tsx:285, 329`).
     Make it *move*: a 3-cycle loop `translateX: 0 → trackWidth → 0` with
     `Animated.loop` + `Easing.inOut`, 1200 ms, native driver. A static 30 % bar reads as
     "stuck at 30 %"; a sweeping one reads as "working, size unknown".
  3. **Do not animate `width`.** Cross-fade two bars: one driven by
     `Animated.timing` on a shared value whenever the percentage *changes by ≥ 2 %*, with
     `useNativeDriver: false` (width is a layout prop and cannot run on the native
     driver) but a **short** 120 ms duration. Combined with the 20 Hz throttle this is
     indistinguishable from native.
- **Effort: S.** **Impact: medium** — it only shows on attachments, but that is exactly
  when a user is most anxious.
- **Accessibility.** `accessibilityRole="progressbar"` +
  `accessibilityValue={{min:0, max:100, now}}`, and for the indeterminate case
  `accessibilityLabel="Uploading"` with **no** `now` value — announcing "30 %" when the
  number is invented is a lie to a screen reader.

### 2.4 Press feedback: scale/opacity + Android ripple — **feasible now, partially present**

- **Feasible now: YES.**
- **Already there:** `ConversationsList.tsx:122-128` uses `Pressable`'s
  `({pressed}) => [styles, {opacity: pressed ? 0.7 : 1}]`, and Paper components ship
  `TouchableRipple` internally. `MenuAction` and `ReactionPickerButton`
  (`ChatScreen.tsx:759-797`) already spring-scale.
- **What is missing:** the chat **bubbles** have no press feedback at all
  (`ChatScreen.tsx:1749-1768` is a `Pressable` with a static `style` array). Add
  `pressed && { opacity: 0.72, transform: [{ scale: 0.985 }] }` via the function form.
  Android's `Pressable` already produces a ripple by default (`android_ripple`), so
  toggling `backgroundColor` on press would fight it.
- **Effort: S.** **Impact: low-medium.** Tactility is most of what makes a screen feel
  alive, and it costs almost nothing.
- **Accessibility.** Ripple is decorative; the `pressed` opacity change must survive
  `reduceMotionEnabled` (RN disables some of these automatically, but set it explicitly).

### 2.5 Bubble entry animation — **needs a decision, then is free**

- **Feasible now: YES, with a caveat.** `Animated` + native driver gives you
  `opacity 0→1` + `translateY 8→0` + `scale 0.98→1` over 180 ms `Easing.out`.
- **The catch: the list is `inverted` (`ChatScreen.tsx:2250`).** Entry animations on an
  inverted list run from the wrong edge unless you flip the Y sign. Do not fight this —
  **animate opacity + scale only**, which is direction-agnostic.
- **The real blocker is rendering, not animation.** Today `renderMessage` rebuilds on every
  message change (Part 3, finding P1). Adding a per-row `Animated.Value` to a list that
  already re-renders every visible row on every message is *worse*, not better. **Do 2.1
  and P1 first, then add this.**
- **Effort: M** (once P1 is fixed). **Impact: high** — this is the single most
  "premium-feeling" item, and the single most likely to be wasted if it ships before P1.
- **Accessibility.** Under `reduceMotionEnabled`, mount at final opacity/transform. Never
  animate opacity from 0 without a 200 ms floor — a `reduceTransparency` user with
  opacity animation gets an unreadable flash.

### 2.6 Reaction chip pop — **feasible now**

- **Implementation.** On a reaction count change, render each emoji+count as a small chip
  inside the bubble footer; animate the changed chip `scale 0.6→1.06→1` + `opacity 0→1`
  over 220 ms with `Animated.sequence` of two `spring`s, native driver. This is the
  standard "elastic pop" and it reads as physical even in greyscale because scale is
  shape, not colour.
- **Effort: M.** The state is already there — `reactions: Array<{emoji, count, mine}>`
  on every `Message` (`ChatScreen.tsx:80`). Needs a per-chip "previous count" ref and a
  diff, which is only safe once rows stop re-rendering wholesale (P1).
- **Accessibility.** Reaction chips must be real buttons with
  `accessibilityLabel={\`❤️ 3, tap to react\``}` and an `accessibilityState={{selected: mine}}`.
  A chip that is only reachable by long-press is invisible to TalkBack.

### 2.7 Timestamp / tick reveal — **feasible now**

- **Implementation.** On send, the timestamp + tick row animates
  `opacity 0→1` + `translateX -4→0` over 160 ms, scheduled 120 ms after the bubble
  mounts. When the receipt upgrades `sent → delivered → read`
  (`ChatScreen.tsx:1039-1053`), cross-fade the icon over 140 ms and add a single
  `scale 1→1.15→1` bump on the `check-all` only — that bump is the whole "it was read"
  signal in a monochrome app.
- **Effort: S.** **Impact: medium** — cheap, and it makes the optimistic flow feel alive.
- **Accessibility.** The tick is decorative; wrap it in
  `accessibilityElementsHidden` and instead put the delivery state in the bubble's
  `accessibilityLabel` as `", sent"` / `", delivered"` / `", read"`. A screen-reader user
  should never have to interpret a checkmark.

### 2.8 Pull-to-refresh vs. subtler freshness — **subtle wins, no dependency**

- **Feasible now: YES.**
- **Recommendation: no `RefreshControl` on the chat list.** The list is Convex-reactive —
  `useQuery(api.conversations.thread)` (`ChatScreen.tsx:820` region) is already live, so
  there is nothing for pull-to-refresh to *do*. A pull gesture that re-fetches data which
  is already streaming is the definition of a hollow interaction. Worse, on an `inverted`
  list it is a horizontal swipe away from swipe-to-reply.
- **Instead:** a **"N new messages" pill** that floats above the composer, appearing only
  when `scrollOffsetY` is off-screen and a newer message lands. Tap → `scrollToOffset({offset:0, animated:true})`.
  This is the same affordance as 2.10 below and should be built once.
- **Effort: M.** **Impact: medium.** Needs `onScroll` + a `useRef` for last offset.
- **Accessibility.** The pill needs `accessibilityLiveRegion="polite"` on Android so
  TalkBack announces new arrivals, and `AccessibilityInfo.announceForAccessibility` is
  available but noisier — prefer the live region.

### 2.9 Bottom sheet vs. dialog for the long-press menu — **keep the anchored menu, add a bottom sheet for confirmations**

- **Feasible now: YES for the sheet, with caveats.**
- **Current state:** the long-press menu is an absolutely-positioned `Animated.View` at the
  touch point with `scale 0.8→1` + `opacity 0→1` (`ChatScreen.tsx:2836-3052`,
  animation at `:1072-1085`). It is already good, already anchored to the press point, and
  already dismisses on backdrop press.
- **Verdict: keep it.** A bottom sheet for a 5-item context menu is *more* motion, not
  less. Anchored menus are what iOS and Android both ship for long-press.
- **Where a bottom sheet IS right:** the **delete confirmation**
  (`ChatScreen.tsx:2839-2905`). A destructive, irreversible action ("This will delete the
  message for everyone") currently appears as a small card floating wherever the finger
  happened to land — which can be off-screen, partially behind the keyboard, or clipped.
  A `PaperModal` with `contentContainerStyle` anchored bottom + safe-area padding is
  strictly better, costs nothing, and Paper 6 already splits these into
  `contentBackgroundColor` / `contentBorderRadius` / `contentElevation`
  ([6.x migration](https://oss.callstack.com/react-native-paper/6.x/docs/guides/migration)).
- **If you later want a *draggable* sheet** (swipe-to-dismiss on a 4-item sheet is a real
  premium signal): `@gorhom/bottom-sheet@5.2.14`, MIT
  ([npm](https://www.npmjs.com/package/@gorhom/bottom-sheet)) — **but v5 is built on
  Reanimated v3** ([gorhom.dev](https://gorhom.dev/react-native-bottom-sheet/)), and
  Reanimated 4 is the only line that supports RN 0.81 (Part 3). **Do not add it until the
  Reanimated question is settled.**
- **Safe-area:** the app already wraps the root in
  `<SafeAreaView edges={['top','bottom']}>` (`App.tsx:551`). A bottom sheet must add
  `useSafeAreaInsets().bottom` **itself** — Paper's `Modal` does not.
- **Accessibility.** `Modal` gets focus trapping and back-button dismissal for free from
  Paper. Add `accessibilityViewIsModal` and a labelled `accessibilityLabel` on the sheet
  root; announce `"Delete message dialog"` on open.

### 2.10 Scroll anchoring / "jump to latest" pill — **feasible now, the highest-value list work**

- **Feasible now: YES.**
- **Implementation.** `listRef` already exists (`ChatScreen.tsx:870`). On `onScroll`
  (RN's `scrollEventThrottle={16}`), track `contentOffset.y` (remember: `inverted`, so 0
  = newest). When `contentOffset.y > threshold` (≈1.5 screens) and a new message arrives,
  set `showJumpPill`. Track `hasUnread` in a `useRef`, cleared on scroll-to-0. Render an
  absolutely-positioned `Animated.View` pill above the composer: slide up
  `translateY 24→0` + `opacity 0→1`, 200 ms spring.
- **Critical detail that is currently a bug waiting to happen:** the existing
  `onScrollToIndexFailed` handler (`ChatScreen.tsx:2255-2263`) retries after a **fixed
  250 ms** `setTimeout`. With variable-height bubbles this is a race — it works most of the
  time and jitters the rest. Use
  `InteractionManager.runAfterInteractions` or the
  `scrollToIndex` `onViewableItemsChanged`-driven retry instead.
- **Effort: M.** **Impact: high** — nothing else in this list makes a long chat feel
  manageable.
- **Accessibility.** The pill needs `accessibilityRole="button"`,
  `accessibilityLabel="Jump to latest message"`, and should be in the a11y focus order
  *above* the composer, not below it.

### 2.11 Haptics on Android via `Vibration` — **feasible now, zero dependency**

- **Already declared:** `<uses-permission android:name="android.permission.VIBRATE" />`
  is in `android/app/src/main/AndroidManifest.xml`. Nothing to add.
- **API:** `Vibration.vibrate(pattern?, repeat?)`. On Android an arbitrary duration in ms
  works; iOS ignores duration and always does a fixed ~400 ms
  ([Vibration](https://reactnative.dev/docs/0.81/vibration)). **Therefore gate the whole
  thing on `Platform.OS === 'android'`** — on iOS a "tick" would be a 400 ms buzz.
- **Suggested table** (all Android):
  | Event | Pattern | Rationale |
  |---|---|---|
  | swipe-to-reply commits | `8` | subliminal tick |
  | message sent | `10` | confirms the tap landed |
  | reaction applied | `[0, 6, 40, 14]` | double-tap feel |
  | incoming message | `[0, 4, 60, 4]` | barely there; often suppressed |
  | call accepted / declined | `[0, 20, 80, 20]` | the only one that should feel loud |
- **Honest caveat:** `Vibration` is a crude buzzer. It is the right call for *this* app
  because it costs nothing and RN's built-in API is the only haptics option that doesn't
  add a native dependency. If you later want real `HapticFeedbackConstants` (tick /
  click / impact-light), that is a native module — and at which point
  `expo-haptics`-equivalent is also a native module, so write your own 40-line TurboModule
  rather than migrating to Expo for it.
- **Accessibility.** Respect the system: **never vibrate when
  `AccessibilityInfo.isScreenReaderEnabled()` is true** (screen readers already announce
  every state change; doubling it is hostile), and never when
  `isReduceMotionEnabled()` is true. Add a user-facing "Haptics" toggle in
  `SettingsScreen` — one `AsyncStorage` boolean.
- **Effort: S.** ~30 lines total.

### 2.12 Skeleton vs. spinner — **use skeletons for the *known-length* lists only**

- **Feasible now: YES.**
- **Where the app currently spins:** `ConversationsList.tsx:143-145`,
  `Calls.tsx:200-202`, `ChatScreen.tsx:2243-2245`. All three gate on
  `query === undefined`.
- **Where skeletons are strictly better:** `ConversationsList` and `Calls`. These render a
  **fixed-height repeating row** (52 dp avatar + two lines). A skeleton there is a
  `View` with `backgroundColor: colors.surfaceVariant` at 30–45 % opacity — which is
  already in the achromatic palette as `onSurfaceDisabled` `#A8A8A8` /
  `surfaceDisabled` `#F5F5F5` light, `#5E5E5E` / `#1A1A1A` dark
  (`paperTheme.ts:35-36, 78-79`). **No new colour token needed.**
- **Where a spinner is correct:** `ChatScreen`'s *subscription* gate
  (`ChatScreen.tsx:2242-2245`). A chat history has **no known length**, so a skeleton is a
  lie about what is coming. Keep the spinner there. Same for the video player's own
  buffering (`viewerMedia` at `ChatScreen.tsx:856-859`).
- **Do NOT add a shimmer library.** In pure greyscale a looping opacity ramp on grey boxes
  reads as "the app is broken"; MD3's own guidance is a static placeholder with a subtle
  fade-in, not a sweep.
- **Effort: S** (one shared `<RowSkeleton/>` component + two call sites). **Impact: low-medium.**
- **Accessibility.** Skeletons must be `accessibilityElementsHidden` +
  `importantForAccessibility="no"`; the *loading* state should be announced once via a
  live region, not per-row.

### 2.13 Empty and error states — **mostly present, mostly missing semantics**

- **What exists (genuinely good):** `ConversationsList.tsx:146-157` (icon-free, title +
  hint + a named next action), `Calls.tsx:203-228` (icon + title + hint),
  `ChatScreen.tsx:2264-2275` ("No messages yet"), and per-message failure with retry
  (`SendFailureOverlay`, `ChatScreen.tsx:340-375`).
- **What is missing:**
  1. **No skeletons anywhere** — see 2.12.
  2. **The chat empty state has no call to action.** `ChatScreen.tsx:2264-2275` is a
     single line of text. It should offer the one thing that makes sense — share an
     invite, or say who you are talking to.
  3. **Error states conflate "not loaded yet" with "failed".** Every screen above treats
     `undefined` as "loading" and has **no** `null`/error branch. If Convex throws,
     Convex's own error boundary takes over — so the app has a *global* crash path where a
     *per-list* retry should exist. Add an `error` branch with a Retry button to
     `ConversationsList` and `ChatScreen`.
  4. **Copy.** `AddContactScreen.tsx:94` already has a `COPY` table and
     `friendlyError()` at `:82` parsing Convex diagnostics — that pattern should be reused
     rather than reinvented per screen.
- **Effort: S–M. Impact: medium.** Error states are where a premium app is actually
  distinguishable; polished happy paths are table stakes.
- **Accessibility.** Every empty state needs `accessibilityRole="header"` on the title so
  TalkBack lands on it, and every error needs `accessibilityLiveRegion="assertive"`.

### 2.14 Voice/video call screen transitions — **feasible now, and the highest-risk item here**

- **Feasible now: YES for the in-app transition. NO for a true call transition.**
- **Current state:** `RootStackNavigator.tsx:114-118` gives the call screen
  `animation: 'fade'`. A cross-fade into a call screen is the weakest possible signal — a
  call is the single most important transition in the app.
- **Recommended, in order:**
  1. **Scale + fade, in-app, free.** `animation: 'slide_from_bottom'` on the call screen
     (`@react-navigation/native-stack` already installed) reads as "a sheet came up" and
     costs one line. Better still, a `SlideFromBottomIOS`-style transition with a 260 ms
     duration matches iOS's actual call presentation.
  2. **Connecting shimmer.** While the call screen mounts, animate a pulsing ring on the
     peer's avatar — `IncomingCallOverlay.tsx:37, 129-137` **already does exactly this**
     with `Animated.loop`. Reuse that component; do not build a second one.
  3. **Audio-route transition.** When the user toggles speaker, the current and new
     `AudioRoute`s should cross-fade over ~200 ms. There is no core RN API for this — it
     is `AVAudioSession` / `AudioManager`. **Skip it.** It is invisible on most devices.
- **What is explicitly out of reach:** the iOS-style call presentation (the call screen
  rising over the app with the app shrinking behind it) is an `AVAudioSession` +
  `CallKit` presentation, and Android needs its own `ConnectionService` foreground
  activity. **That is a native-project rewrite**, not a dependency. It is what report
  [13](13-call-architecture-proposal.md) is for.
- **Effort: M** for items 1–2. **Impact: high for a call app.**
- **Accessibility.** **The connecting state is the single most important a11y moment in
  this app.** Announce `"Connecting to {name}"` via
  `AccessibilityInfo.announceForAccessibility` on mount, `"Connected"` on ICE
  `connected`, and — critically — a live region on the **duration timer** is *not*
  appropriate (it would talk every second). Instead expose a
  `accessibilityLabel="Call in progress"` on the root and let the user query duration.
  DND / silent mode must not suppress the screen-reader announcement.

### 2.15 Summary table

| # | Interaction | New dep? | Effort | Impact | Feasible with what's installed |
|---|---|---|---|---|---|
| 2.1 | Send-button state morph | No | S | **High** | ✅ |
| 2.2 | Swipe-to-reply haptic + flick commit | No | S | **High** | ✅ (80% built) |
| 2.6 | Reaction chip pop | No | M | High | ✅ (after P1) |
| 2.5 | Bubble entry animation | No | M | High | ✅ (after P1) |
| 2.10 | Jump-to-latest pill | No | M | High | ✅ |
| 2.14 | Call screen transition | No | M | High | ✅ (partial) |
| 2.7 | Timestamp / tick reveal | No | S | Medium | ✅ |
| 2.3 | Progress bar polish | No | S | Medium | ✅ |
| 2.11 | Haptics (`Vibration`) | No | S | Medium | ✅ |
| 2.8 | Freshness pill | No | M | Medium | ✅ |
| 2.13 | Error / empty states | No | S–M | Medium | ✅ |
| 2.4 | Press feedback | No | S | Low–Med | ✅ (partial) |
| 2.12 | Skeletons | No | S | Low–Med | ✅ |
| 2.9 | Draggable bottom sheet | **Yes** | M | Low | ⚠️ blocked on Reanimated |

**Everything above is achievable without a single new dependency.** That is the headline of
Part 2.

---

# PART 3 — PERFORMANCE

## 3.1 Reanimated: worth it?

### Status on RN 0.81 + New Architecture

| Fact | Source |
|---|---|
| Reanimated **4.x is New-Architecture-only** | [npm](https://www.npmjs.com/package/react-native-reanimated), [GitHub](https://github.com/software-mansion/react-native-reanimated) |
| Latest is **4.7.1**; weekly downloads 7.66M | [npm](https://www.npmjs.com/package/react-native-reanimated) |
| **RN 0.81 is supported by Reanimated `4.1.x`–`4.3.x` only.** 4.4.x and above do **not** list 0.81 | [compatibility table](https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility/) |
| Pairs with **`react-native-worklets` `0.8.x`** (0.8.x itself covers RN 0.81–0.85) | [worklets compatibility.json](https://github.com/software-mansion/react-native-reanimated/blob/main/packages/react-native-worklets/compatibility.json) |
| Unpacked size **4.04 MB**, 1,983 files, MIT | [npm](https://www.npmjs.com/package/react-native-reanimated?activeTab=readme) |

This is a hard ceiling: **on RN 0.81 the newest Reanimated you can legitimately install is
`4.3.x` + `worklets@0.8.x`.** That is also, conveniently, exactly the pair Paper 6 requires
([Paper 6 migration](https://oss.callstack.com/react-native-paper/6.x/docs/guides/migration)).

### Install cost

1. `npm i react-native-reanimated@~4.3 react-native-worklets@~0.8`
2. **Babel plugin** — `plugins: ['react-native-worklets/plugin']`, and it **must be last** in
   the plugins array. Your `babel.config.js` is currently 3 lines
   (`{ presets: ['module:@react-native/babel-preset'] }`), so this is a clean 4-line edit.
   Auto-workletisation of callbacks is what makes the API pleasant
   ([getting started](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started)).
3. **Bundle Mode** — since Worklets `0.10.0` (19 Jun 2026) *"Bundle Mode is now considered
   stable and the recommended way of using Worklets"*
   ([changelog](https://npmx.dev/package-changelog/react-native-reanimated/v/4.5.0-nightly-20260621-9c2e3b052)).
   Note this is documented on a 4.5 nightly; **0.8.x worklets predates Bundle Mode**, so
   4.3.x ships with the legacy eval mode. Acceptable, but know what you are getting.
4. **Native rebuild** on both platforms. `useNativeDriver: true` props currently in the app
   (`ChatScreen.tsx:509, 1076`; `BottomTabNavigator.tsx:68`) all keep working — Reanimated
   is a drop-in for those. No behavioural regression.
5. **Can the winlist be shared?** Partially. `SwipeReply`'s `translateX` (`:536`) and the
   gesture `onUpdate` (`:534-537`) become pure UI-thread worklets — no JS bridge crossing
   at all. Today it is `useNativeDriver`, which is *already* off the JS thread for the
   transform, so the **marginal** gain over the status quo is small. The gain is real for
   the *gesture callbacks* and for anything that must read/write shared values per frame
   (2.5 bubble entry, 2.6 chip pop, 2.10 jump pill with `useAnimatedScrollHandler`).

### Verdict

> **Not worth it yet. Fix the re-render problem first — it is worth far more and costs zero.**

Reasoning, bluntly:

- The app's existing animations are **already correct**: `SwipeReply` uses
  `useNativeDriver: true` and explicitly documents why (`ChatScreen.tsx:471-472`: *"a drag
  never crosses the bridge and never re-renders the list"*). That is the performance
  property people add Reanimated for, and you have it.
- The actual bottleneck found in this audit (**P1**) is **re-renders, not animation
  latency**. Adding a 4 MB native library will not make `renderMessage` stop rebuilding on
  every message.
- **The winlist is frozen.** You are capped at 4.3.x forever on RN 0.81, while
  Reanimated's own README advertises 4.7.x. Every 4.4+ fix — including a live SIGSEGV
  report on RN 0.83 ([issue #10648](https://github.com/software-mansion/react-native-reanimated/issues/10648)) —
  is out of reach.
- **It unblocks nothing in Part 2.** All 15 micro-interactions are achievable with
  `Animated` + `useNativeDriver`, because they are opacity/transform/scale — all of which
  the native driver supports without a worklet.

**Revisit when:** (a) RN is upgraded past 0.83, (b) you want 2.5/2.6 with scroll-linked
animation (2.10's jump pill with `useAnimatedScrollHandler`), or (c) you adopt
`@gorhom/bottom-sheet` v5 — which is Reanimated v3-only and therefore **incompatible** with
the RN-0.81-supported 4.x line anyway.

---

## 3.2 List audit — findings

Every `FlatList` in the app, and how it is configured:

| List | File:line | `keyExtractor` | `renderItem` | memo | `getItemLayout` | window props |
|---|---|---|---|---|---|---|
| **Chat messages** | `ChatScreen.tsx:2247` | inline arrow `:2252` | `useCallback` `:1690` | ❌ | n/a (variable height) | none |
| Draft chips (h-scroll) | `ChatScreen.tsx:2292` | inline arrow `:2296` | **inline JSX arrow** `:2299` | ❌ | n/a | none |
| Conversations | `ConversationsList.tsx:159` | inline arrow `:161` | **inline JSX arrow** `:162` | ❌ | ❌ | none |
| Call history | `Calls.tsx:230` | inline arrow `:232` | `useCallback` `:99` | ❌ | ❌ | none |
| Groups | `GroupsList.tsx:162` | inline arrow `:164` | **inline JSX arrow** `:165` | ❌ | ❌ | none |
| Forward-to picker | `ForwardMessageScreen.tsx:230` | inline arrow `:232` | `useCallback` `:117` | ❌ | ❌ | none |

RN's own guidance: *"Avoid anonymous function on renderItem… Also, ensure that it is wrapped
in a `useCallback` hook"* and *"React.memo() creates a memoized component that will be
re-rendered only when the props passed to the component change"*
([Optimizing FlatList Configuration](https://reactnative.dev/docs/0.81/optimizing-flatlist-configuration)).

---

### **P1 — `renderMessage` depends on the entire message array ⇒ every visible row re-renders on every message — CRITICAL**

`src/components/convex/ChatScreen.tsx:1690-2094`

```
1690:  const renderMessage = useCallback(
        ({ item, index }) => { ... 400 lines of JSX ... },
2080:    [
2081:      user?._id,
2082:      conversation?.type,
2083:      type,              // stable (memoised on theme.fonts)
2084:      ui,                // stable (memoised on theme.colors)
2085:      applyReaction,     // stable
2086:      openViewer,       // stable
2087:      messages,          // ◄── CHANGES ON EVERY SINGLE MESSAGE
2088:      highlightId,       // stable unless highlighted
2089:      scrollToMessage,   // stable
2090:      tickFor,           // ◄── ALSO CHANGES (see below)
2091:      retryOutgoing,
2092:      discardOutgoing,
2093:    ],
2094:  );
```

Three compounding problems:

1. **`messages` in the dependency array** (`:2087`). `messages` is rebuilt by the merge
   memo at `:974-999` whenever `thread` or `outgoing` changes. So `renderMessage` gets a
   **new function identity on every message received, sent, confirmed or removed.**
   `FlatList` is a `PureComponent` keyed on props; a changed `renderItem` prop invalidates
   it, and it re-renders **every currently-mounted row** — not just the new one.
2. **`tickFor` is also unstable** (`:2090`). It is `useCallback`'d on `[receipts]`
   (`:1039-1053`), and `receipts` is `useMemo`'d on `[thread]` (`:1001-1004`). Any `thread`
   update — a typing indicator, a reaction, a read receipt from *any* participant —
   rebuilds `receipts` → rebuilds `tickFor` → rebuilds `renderMessage`.
3. **There is no `React.memo` row component anywhere.** Grepping the whole of `src/` finds
   **zero** occurrences of `React.memo` or `memo(`. The row is not a component — it is
   ~390 lines of JSX *inside* `renderItem` (`:1748`–`2078`), wrapped in `SwipeReply`
   (`:474`). It cannot be memoised without being extracted. This is the structural reason
   1 and 2 are so expensive: even a correct `renderItem` cannot save a row that has no
   identity of its own.

**Measured impact:** a conversation that has scrolled up (so the user can see 12–20
bubbles) receives one message → 12–20 full row renders, each including
`SwipeReply`'s `Gesture.Pan()` construction, `dayjs(...).isSame(...)` date math
(`:1696`), a `UserAvatar`, and up to six `MaterialDesignIcons` glyph lookups. The
conversation list does the same thing at `ConversationsList.tsx:162`.

**Fix (do this first):**
1. Extract `MessageRow` as a module-level `React.memo` component taking
   `{ message, isMine, isGroup, showDay, isHighlighted, ui, type, handlers… }` — a flat,
   individually-stable prop surface. Keep `SwipeReply` inside it.
2. Pass `tick` as a **prop** computed per-item inside the memo, or better: give the memo a
   `tickFor` prop that is itself a `useCallback` keyed on `[receipts]` — but the key point
   is that `renderItem` must **not** close over `messages`. `renderItem` should read only
   `item` + `index`.
3. `const keyExtractor = useCallback((item: Message) => item._id, [])` — hoisted, stable.
4. If the memoised row still re-renders too often, gate the expensive fields (`tick`,
   reaction row) behind an explicit `extraData` that is a narrow derived value
   (`receiptsVersion`) rather than the whole array.

**Effort: M. Impact: the largest single performance win available in this repo. Zero new
dependencies.**

---

### **P2 — `useWindowDimensions()` at the top of `ChatScreen` re-renders the whole chat list on every keyboard open/close — HIGH**

`src/components/convex/ChatScreen.tsx:802`

```
801:  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
802:  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
```

`windowWidth`/`windowHeight` are consumed at exactly **three** places, and every one of
them belongs to the **media viewer**, not the message list:

- `:2101-2102` → `viewerWidth = windowWidth - 32`, `viewerHeight = windowHeight - 160`
- `:2756` → `width: Math.min(windowWidth - 48, 340)` on the action-menu card

On Android, `useWindowDimensions` fires on every soft-keyboard show **and hide**, because
the window genuinely resizes. Every time the user taps the composer — which is the single
most frequent action in the app — this triggers a state change in `ChatScreen`, which
re-renders the `FlatList`, which (per P1) re-renders **every visible bubble**.

**Fix:** move the media viewer and the action menu into their own components, or at
minimum call `useWindowDimensions()` *inside* the viewer subtree. One-line change if left
inline but scoped; proper change is extraction.

**Effort: S. Impact: high, and it compounds P1 — fix with or after P1, both are required.**

---

### **P3 — `SessionProvider` is one monolithic context with a live notification field — MEDIUM**

`src/auth/SessionProvider.tsx:48-61, 286-315`

The single `SessionContextValue` carries `token`, `user`, `isLoading`, **`notice`**,
`dismissNotice`, `signIn` and `signOut`. Two separate consequences:

1. **`notice` is a user-facing string that changes rarely but invalidates everything.**
   `setNotice(...)` is called at `:174, :206, :224` and `setNotice(null)` at `:239`. Any
   of those re-renders **all 16 components** that call `useSession()` — `AppInner`
   (`App.tsx:52`), `ChatScreen.tsx:1116`, `ConversationsList.tsx:49`, `Calls.tsx:58`,
   `WebRTCCallScreen.tsx:56`, `IncomingCallOverlay.tsx:35`, `AddContactScreen.tsx:118`,
   `ChatInfoScreen.tsx:73`, `ContactInfoScreen.tsx:37`, `ForwardMessageScreen.tsx:71`,
   `GroupsList.tsx:51`, `ProfileScreen.tsx:53`, `SettingsScreen.tsx:112`,
   `UpdateChecker.tsx:34`, `Login.tsx:39`, `SignUp.tsx:42` — because the context value
   identity changes (`:292-300`). Only `Login.tsx:39` actually reads `notice`.
2. **`signOut` is `useCallback`'d on `[token, revokeToken]` (`:282`)**, so it changes
   identity on every token change. `AppInner` lists it in an effect dependency list
   (`App.tsx:310-316`) alongside `token` and `sessionUser?._id` — three values that move
   together, so the effect re-subscribes for no reason on any of them.

**Fix:** split into `SessionContext` (token, user, isLoading, signIn, signOut) and
`NoticeContext` (notice, dismissNotice). Only `Login.tsx:39` needs the latter. ~20 lines.
Also drop the redundant deps from `App.tsx:310-316`.

**Effort: S. Impact: medium — infrequent triggers, but each one is an app-wide re-render.**

---

### **P4 — `RootStackNavigator` calls `useColorScheme()` directly, contradicting the documented invariant, and the fix is dead code — HIGH (correctness, and it is literally hue in a monochrome app)**

`src/navigation/RootStackNavigator.tsx:14, 32-45`

```
14:  import { StatusBar, useColorScheme } from 'react-native';
...
32:  const scheme: 'light' | 'dark' =
33:    useColorScheme() === 'light' ? 'light' : 'dark';
34:  const baseNavigationTheme = scheme === 'light' ? DefaultTheme : DarkTheme;
35:  const NavigationTheme = {
36:    {...baseNavigationTheme,
37:    colors: {...baseNavigationTheme.colors,
43:      background: colors.background,
```

Three findings:

1. **`useColorScheme()` at `:33` is the second reader** the codebase explicitly forbids.
   `src/theme/useAppTheme.ts:14-17` says *"DO NOT CALL `useColorScheme()` ANYWHERE ELSE IN
   THIS APP"* and `App.tsx:601-615` says the same thing again at length. The navigator is
   the exact file the comment says it used to be fixed in — and it is still doing it.
2. **The hooks that were written to fix it have zero call sites.**
   `useAppNavigationTheme()` (`useAppTheme.ts:79-82`) and `useAppStatusBarStyle()`
   (`useAppTheme.ts:90-93`) are exported and never imported anywhere in `src/`, and
   `buildNavigationTheme()` (`dynamicTheme.ts:84-125`) is therefore dead code. Repo-wide
   grep for those three identifiers returns only their own definitions.
3. **Consequence: `NavigationContainer` is running on React Navigation's
   `DefaultTheme`/`DarkTheme`,** with only `background` overridden. Per
   `dynamicTheme.ts:36-39`, that means `primary` stays `rgb(0, 122, 255)` and `notification`
   stays `rgb(255, 59, 48)` — **blue and red — in a strictly monochrome app.** The
   `buildNavigationTheme` function that would map every one of those to greys is written,
   documented, correct, and not wired up.

Additionally, `NavigationTheme` at `:35-45` is a **new object literal on every render**, so
`NavigationContainer`'s `theme` prop changes identity on every `RootStackNavigator`
render, forcing a navigator-wide re-render.

**Fix:** delete lines 14 (the `useColorScheme` import), 32-34 and 35-45; use
`const NavigationTheme = useAppNavigationTheme()` and
`barStyle={useAppStatusBarStyle()}`. The functions already exist and are already tested by
construction. **~10 lines deleted, the monochrome invariant restored.**

**Effort: S. Impact: high — this is a correctness bug with a visible hue leak, and it is
the single most embarrassing thing in this report.**

---

### **P5 — Inline `renderItem` closures defeat `FlatList`'s pure-component bailout — MEDIUM**

| Location | What |
|---|---|
| `ConversationsList.tsx:162` | `renderItem={({ item }) => ( ... )}` — **not** `useCallback`, **not** a component |
| `GroupsList.tsx:165` | identical shape |
| `ChatScreen.tsx:2299` | `renderItem={({ item }) => { ... }}` — identical shape |
| `ChatScreen.tsx:2295` | `extraData={draft}` is **redundant** — `data={draft}` at `:2294` already changes identity whenever `draft` does, which is the only way `draft` changes. Dead prop. |

`ConversationsList`'s row also allocates a **new style array and a new object literal per
row per render** (`:164-167` `{ backgroundColor: colors.surfaceVariant }`, `:171-177`,
`:195-196`, `:220-229`). That defeats `StyleSheet` identity reuse for every visible row on
every keystroke-free parent render.

**Fix:** extract `ConversationRow` as a `React.memo` component with a stable prop surface;
hoist static colours to a `useMemo`; delete `extraData={draft}`.
**Effort: S per list.**

---

### **P6 — Inline `keyExtractor` arrows on all six lists — LOW**

`ChatScreen.tsx:2252`, `ChatScreen.tsx:2296`, `ConversationsList.tsx:161`,
`Calls.tsx:232`, `GroupsList.tsx:164`, `ForwardMessageScreen.tsx:232` — all
`keyExtractor={item => item._id}`, a fresh function each render. Hoist to
`const keyExtractor = useCallback((item) => item._id, [])`, or better, a module-level
`const keyExtractor = (item: Item) => item._id`.

**Effort: S (6 one-line edits). Impact: low — but it is free.**

---

### **P7 — No `initialNumToRender` / `maxToRenderPerBatch` / `windowSize` tuning — LOW**

All six lists run on RN's defaults (`initialNumToRender: 10`, `maxToRenderPerBatch: 10`,
`windowSize: 21` — [FlatList docs, 0.81](https://reactnative.dev/docs/0.81/flatlist)).
For a chat with **variable-height, media-bearing, gesture-wrapped** bubbles, a batch of 10
full rows is a lot of JS work per frame during a fling. Suggested for `ChatScreen.tsx:2247`:
`initialNumToRender={8}` (they are tall), `maxToRenderPerBatch={6}`,
`windowSize={11}` (inverted + anchored near the composer means fewer screens of history
are ever in view).

**`removeClippedSubviews`:** RN defaults it to `true` on Android and `false` elsewhere
([docs](https://reactnative.dev/docs/optimizing-flatlist-configuration)). Android is
already covered; **do not** force it on iOS, where it causes blank-row bugs on `inverted`
lists.

**`getItemLayout`: correct to omit.** Bubbles are variable height (`styles.bubble` is
padding-only, `ChatScreen.tsx:3062-3066`), so there is no honest `length` to return. Do
**not** fake it. This is the one optimisation in the RN checklist that would actively make
things worse here.

---

### **P8 — Images: no finding. This is correct and worth stating explicitly.**

Every `<Image>` in the app has explicit dimensions in a `StyleSheet`:

| Location | Dimensions |
|---|---|
| `ChatScreen.tsx:1853, 1869` | `styles.imageAttachment` = `220×220`, `borderRadius: 10` (`:3398-3403`) |
| `ChatScreen.tsx:2317` | `styles.draftThumb` = `28×28` (`:3364-3368`) |
| `ChatScreen.tsx:2567` | inside the viewer, sized by `viewerWidth`/`viewerHeight` (`:2101-2102`) |
| `ChatInfoScreen.tsx:368` | `{ width: THUMB_SIZE, height: THUMB_SIZE }` inline (`:30`) |
| `UserAvatar.tsx:88-94` | `[{ width: size, height: size, borderRadius: corner }]` — `size` is a required prop |

No layout-thrashing image loads. **The one caveat:** none of them set
`defaultSource`/`blurRadius`, so there is no low-res placeholder while a remote avatar
decodes. `expo-image` is the standard fix and is a **hard no** (Part 1). The RN-core
alternative is a `blurhash`-style base64 placeholder decoded into an `Image` and swapped on
`onLoad` — ~30 lines, no dependency.

---

### **P9 — Dead code worth removing while in here — LOW**

- `src/utils/ActiveChatContext.tsx` (32 lines) — a `createContext` whose `ActiveChatProvider`
  is **never mounted** and whose `useActiveChat` has **no call sites**. A CometChat remnant.
- `src/config/store.ts` — its own comment at `:22` says *"Nothing currently reads this store
  (`useConfig` has no call sites)"*. A zustand store that imports `config.json` and
  `AsyncStorage` for nothing.
- `buildNavigationTheme()` / `useAppNavigationTheme()` / `useAppStatusBarStyle()` — dead
  until you fix P4.

None of these cost measurable runtime (the modules are tiny and tree-shaken), but all
three are **traps**: they look like live architecture and will mislead the next reader.

---

## 3.3 Performance priorities

1. **P4** — 10-line fix, restores the monochrome invariant, deletes a class of bug. *S*
2. **P1** — extract `React.memo` `MessageRow`, remove `messages`/`tickFor` from the
   `renderItem` closure. *M* — **the big one**
3. **P2** — scope `useWindowDimensions()` to the viewer. *S*
4. **P3** — split the session context. *S*
5. **P5/P6/P7** — `useCallback` the `keyExtractor`s, extract the inline rows, tune window
   props. *S*
6. **P9** — delete dead code. *S*

---

# PART 4 — PRIORITISED PLAN

| # | Improvement | Impact | Effort | New dep? | Risk | Notes |
|---|---|---|---|---|---|---|
| 1 | **P4 — wire `useAppNavigationTheme()` into `RootStackNavigator`** | **High** | S | No | **Very low** | Functions already exist and are correct. Deletes 10 lines. Removes blue `#007AFF` and red `#FF3B30` from a monochrome app. **Do this first.** |
| 2 | **P1 — extract memoised `MessageRow`; drop `messages`/`tickFor` from `renderItem`** | **Very high** | M | No | Medium | Touches the largest file in the repo. Pure refactor — behaviour is assertable, and there are existing tests in `__tests__/`. This is the single biggest performance win in the repo. |
| 3 | **P2 — scope `useWindowDimensions()` to the media viewer** | **High** | S | No | Low | 1 line if inline-scoped; clean if extracted. Compounds #2. |
| 4 | **2.1 + 2.2 — send-button morph; swipe haptic + flick-to-commit** | High | S | No | Low | The two most-felt interactions in the app. Both are additive; swipe is already 80% built. |
| 5 | **2.11 — `Vibration` haptics behind a settings toggle** | Medium | S | No | Low | Permission already declared. Android-only gate. |
| 6 | **P3 — split `SessionContext` from `NoticeContext`** | Medium | S | No | Low | ~20 lines. Removes app-wide re-renders on session expiry/sign-in. |
| 7 | **2.10 — jump-to-latest pill; fix the `setTimeout`-based `onScrollToIndexFailed`** | High | M | No | Low | The 250 ms retry is a live race on variable-height bubbles. |
| 8 | **P5/P6/P7 — hoist `keyExtractor`s, extract inline rows, tune window props** | Medium | S | No | Low | Mechanical. Delete the redundant `extraData` at `ChatScreen.tsx:2295`. |
| 9 | **2.7 — timestamp / tick reveal; read-receipt scale bump** | Medium | S | No | Low | In greyscale, the scale bump *is* the read signal. |
| 10 | **2.5 + 2.6 — bubble entry animation, reaction chip pop** | High | M | No | Medium | **Sequence after #2.** Per-row `Animated.Value` inside a list that re-renders every row is a regression, not a feature. |
| 11 | **2.3 — throttle progress to 20 Hz; animate the indeterminate bar** | Medium | S | No | Low | XHR fires up to ~60×/s today. |
| 12 | **`react-native-paper/babel` in production `env`** | Medium | **S** | No | Low | Free bundle-size reduction the library ships for exactly this. One line in `babel.config.js`. |
| 13 | **2.13 — error branches + Retry on `ConversationsList` and `ChatScreen`; empty-state CTA** | Medium | S–M | No | Low | Reuse `AddContactScreen.tsx:82` `friendlyError()` and its `COPY` table. |
| 14 | **2.12 — skeletons for `ConversationsList` / `Calls` only** | Low–Med | S | No | Low | Tokens already exist (`surfaceDisabled`/`onSurfaceDisabled`). Keep the spinner in `ChatScreen` — history length is unknown. |
| 15 | **2.14 — call screen: `slide_from_bottom` + reuse the existing connecting pulse** | High | M | No | Low | The `fade` at `RootStackNavigator.tsx:117` is the weakest call transition possible. |
| 16 | **2.4 — press feedback on chat bubbles** | Low–Med | S | No | Low | Don't toggle `backgroundColor`; Android ripple is already there. |
| 17 | **2.8 — freshness pill** | Medium | M | No | Low | Shares 90% of the code from #7. Do them together or not at all. |
| 18 | **P9 — delete `ActiveChatContext`, dead `store.ts`, wire-or-kill dead theme hooks** | Low | S | No | Very low | Hygiene. Do it while the files are open. |

### Bluntly: what is **not** worth the effort for a small app

| Rejected | Why |
|---|---|
| **Migrating off `react-native-paper`** | The app has a working, complete, hand-authored achromatic MD3 palette. Nine of nineteen Paper touchpoints are `useTheme` only. The migration table in §1.4 is a weekend, which means the payoff is also a weekend. Spend that weekend on P1 instead — it is worth more to the user. |
| **`gluestack-ui`** | v5 requires choosing an RC Tailwind engine; its CLI has a documented config-rewriting bug on RN 0.8x (issue #3421); its benchmark page still advertises v1. |
| **`nativewind` v5 / Tailwind v4** | `5.0.0-rc.0`, *"not intended for production use"*, tested against RN 0.86 — not 0.81 — and needing `lightningcss` pinned to an exact patch. |
| **`tamagui` v2** | The best-fitting library on paper (it literally targets RN 0.81 + New Arch). Wrong shape for a 12k-line app with an existing theme: a new compiler, a new Metro plugin, a new Babel plugin, a new config file, and a rewritten token set — to produce the same 30 greys. |
| **`unistyles` v3** | Impressive C++ ShadowTree updates. But it adds `react-native-nitro-modules` (a second native module + codegen) and a Babel plugin that rewrites every RN import — for a theming problem `src/theme/useAppTheme.ts` has already solved correctly. |
| **Any `expo-*`** | **Hard no.** It would fight `react-native-webrtc`, `@notifee/react-native`, `@react-native-firebase/*`, `react-native-video`, and the hand-written native call stack that the entire calling feature runs on. |
| **`react-native-reanimated`** | You already have `useNativeDriver` on every animation (`ChatScreen.tsx:509, 1076`; `BottomTabNavigator.tsx:68`). RN 0.81 caps you at 4.3.x forever while the library ships 4.7.x. It fixes no micro-interaction in Part 2. **Revisit only after an RN upgrade.** |
| **`@gorhom/bottom-sheet`** | v5 is Reanimated **v3**-only — incompatible with the RN-0.81-supported 4.x line. Paper's own `Modal` covers the one place a sheet is genuinely warranted (delete confirmation). |
| **`@shopify/flash-list`** | Worth it past ~50 items with recycled cells. A Convex chat list is 20–200 rows of variable-height, media-bearing bubbles; the migration cost (inverted-list semantics, `estimatedItemSize`, the whole `SwipeReply` row) exceeds the benefit at this scale. Revisit if conversations reach 1000+ messages. |
| **`expo-image`** | The only genuinely compelling Expo package here — and it is a hard no on the bare-RN constraint. The RN-core substitute is a base64 placeholder + `onLoad` swap, ~30 lines. |

---

## Appendix — sources

**React Native**
- [FlatList (0.81)](https://reactnative.dev/docs/0.81/flatlist) · [Optimizing FlatList Configuration](https://reactnative.dev/docs/optimizing-flatlist-configuration) · [current](https://reactnative.dev/docs/optimizing-flatlist-configuration)
- [Releases overview](https://reactnative.dev/docs/releases) · [Versions](https://reactnative.dev/versions.html) · [endoflife.date/react-native](https://endoflife.date/react-native)
- [Vibration (0.81)](https://reactnative.dev/docs/0.81/vibration) · [AccessibilityInfo (0.81)](https://reactnative.dev/docs/0.81/accessibilityinfo)

**UI libraries**
- react-native-paper: [releases](https://github.com/callstack/react-native-paper/releases) · [commits](https://github.com/callstack/react-native-paper/commits) · [Snyk](https://security.snyk.io/package/npm/react-native-paper) · [6.x migration](https://oss.callstack.com/react-native-paper/6.x/docs/guides/migration) · [6.x getting started](https://oss.callstack.com/react-native-paper/6.x/docs/guides/getting-started) · [5.x MD3 guide](https://oss.callstack.com/react-native-paper/docs/guides/migration-guide-to-5.0) · [Searchbar #4978](https://github.com/callstack/react-native-paper/issues/4978)
- gluestack-ui: [v5 stable](https://gluestack.io/blogs/gluestack-ui-v5-stable-release) · [v5 install](https://v5.gluestack.io/ui/docs/home/getting-started/installation) · [CLI](https://gluestack.io/ui/docs/home/getting-started/cli) · [upgrade-to-v5](https://v5.gluestack.io/ui/docs/guides/more/upgrade-to-v5) · [issue #3421](https://github.com/gluestack/gluestack-ui/issues/3421) · [benchmarks (v1)](https://v1.gluestack.io/ui/v1) · [FAQs](https://v5.gluestack.io/ui/docs/guides/more/faqs) · [blogs](https://gluestack.io/blogs)
- tamagui: [upgrade v1→v2](https://tamagui.dev/docs/guides/how-to-upgrade) · [version two](https://tamagui.dev/blog/version-two) · [benchmarks](https://tamagui.dev/docs/intro/benchmarks) · [compiler install](https://github.com/tamagui/tamagui/blob/v2.7.7/code/tamagui.dev/data/docs/intro/compiler-install.mdx) · [next.md](https://github.com/tamagui/tamagui/blob/main/next.md)
- rn-primitives: [site](https://rnprimitives.com/) · [repo](https://github.com/roninoss/rn-primitives) · [releases](https://github.com/roninoss/rn-primitives/releases)
- unistyles: [for library authors](https://www.unistyl.es/v3/other/for-library-authors) · [how unistyles works](https://unistyl.es/v3/start/how-unistyles-works) · [StyleSheet](https://unistyl.es/v3/references/stylesheet) · [migration](https://www.unistyl.es/v3/start/migration-guide) · [reactnative.directory](https://reactnative.directory/package/react-native-unistyles) · [user field report](https://github.com/getpaseo/paseo/blob/main/docs/unistyles.md)
- nativewind / uniwind: [v5 overview](https://www.nativewind.dev/v5) · [v5 install](https://www.nativewind.dev/v5/getting-started/installation) · [v5 theme](https://www.nativewind.dev/v5/customization/theme) · [DEVELOPMENT.md](https://github.com/nativewind/nativewind/blob/main/DEVELOPMENT.md) · [v4 announcement](https://www.nativewind.dev/blog/announcement-nativewind-v4) · [uniwind vs nativewind](https://uniwind.dev/vs-nativewind) · [uniwind site](https://uniwind.dev/)

**Animation / sheets**
- reanimated: [npm](https://www.npmjs.com/package/react-native-reanimated) · [compatibility](https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility/) · [getting started](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started) · [worklets compatibility.json](https://github.com/software-mansion/react-native-reanimated/blob/main/packages/react-native-worklets/compatibility.json) · [worklets changelog](https://npmx.dev/package-changelog/react-native-reanimated/v/4.5.0-nightly-20260621-9c2e3b052) · [issues](https://github.com/software-mansion/react-native-reanimated/issues) · [BottomSheet.tsx source](https://github.com/gorhom/react-native-bottom-sheet/blob/master/src/components/bottomSheet/BottomSheet.tsx)
- bottom sheet: [gorhom.dev](https://gorhom.dev/react-native-bottom-sheet/) · [npm](https://www.npmjs.com/package/@gorhom/bottom-sheet)

**Performance commentary** (secondary; primary sources above take precedence)
- [Optimizing FlatList Configuration](https://reactnative.dev/docs/optimizing-flatlist-configuration)
- [RapidNative — RN Performance 2026](https://www.rapidnative.com/blogs/react-native-performance-optimization-2026-playbook) (vendor)
- [DEV — 2026 RN Performance Playbook](https://dev.to/mark_fa/the-2026-react-native-performance-playbook-new-arch-flashlist-reanimated-4-48g2) (community)

**Related reports in this repo**
- [00 — Master report](00-MASTER-REPORT.md) · [06 — Chat & messaging](06-chat-messaging.md) · [07 — State & performance](07-state-performance.md) · [10 — Bloat & dead code](10-bloat-deadcode.md) · [13 — Call architecture](13-call-architecture-proposal.md) · [15 — CometChat replacements](15-cometchat-replacements.md)