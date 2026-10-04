# Material UI Adoption Plan — CometChat Sample App

Status: research complete, no code changed
Date: 2026-10-04
Stack: React Native 0.81.4, React 19.1.0, New Architecture (bridgeless, Fabric), Hermes, Android-first, TypeScript, existing dark zinc/purple theme.

## 1. Recommendation

Adopt **`react-native-paper@5.15.3`** (MD3) with **`@react-native-vector-icons/material-design-icons@13.1.4`**.

Reasons:
- Only actively maintained, MD3-spec React Native library with the exact component set the chat screens need (Appbar, List, Dialog, Menu, Snackbar, Chip, SegmentedButtons, Modal/Portal, FAB, Badge, Searchbar).
- Peer deps are permissive: `react: "*"`, `react-native: "*"`, `react-native-safe-area-context: "*"`. The project's safe-area-context `^5.6.1` already satisfies it. No native code on Android (JS-only library).
- Compatible with New Architecture in practice; the remaining RN 0.81/Fabric bugs are enumerated with workarounds in section 8.

Do **not** use `react-native-vector-icons` (classic): npm marks 10.3.0 deprecated — "moved to a new model of per-icon-family packages". Use the scoped `@react-native-vector-icons/material-design-icons`, which Paper itself prefers (it `require`s it first in `MaterialCommunityIcon`, with fallbacks to legacy packages).

Do **not** use `react-native-paper@6.0.0-alpha.0` yet: it adds hard peers `react-native-reanimated >= 4.3.0` and `react-native-worklets >= 0.8.1`, neither of which is installed. It also contains breaking API rewrites (TextInput, FAB). Re-evaluate after 6.0 stable.

Alternatives considered (all rejected):

| Library | Latest | Last publish | Verdict |
|---|---|---|---|
| `react-native-material-ui` | 1.30.1 | 2022-06 | Unmaintained, MD2, no new-arch guarantees |
| `react-native-material` | 0.0.4 | 2022-06 | Dead |
| `@react-native-material/core` | 1.3.7 | 2022-04 | Unmaintained |
| `react-native-paper-tabs` | 0.11.4 | 2025-04 | Community add-on, pulls `react-native-pager-view`; only if swipeable tabs are required |
| `@gorhom/bottom-sheet` | — | — | Requires `react-native-reanimated` (not installed); defer |

## 2. Exact versions to install

```
npm install react-native-paper@5.15.3 @react-native-vector-icons/material-design-icons@13.1.4
```

Transitive (installed automatically, no action):

| Package | Version |
|---|---|
| `@react-native-vector-icons/common` | ^13.0.3 |
| `@callstack/react-theme-provider` | ^3.0.9 (peer `react >=16.3.0`, React 19 OK) |
| `use-latest-callback` | ^0.2.3 |
| `color` | ^3.1.2 |

Already present and sufficient:
- `react-native-safe-area-context@^5.6.1` (latest is 5.10.1; do not upgrade as part of this work)

Do not add: `react-native-reanimated`, `react-native-worklets`, `react-native-pager-view`, `@gorhom/bottom-sheet`.

## 3. Install + Android setup steps

1. Install the two packages above.
2. Android: rebuild. Autolinking picks up the vector-icons native module (fonts/assets ship inside it). **No `fonts.gradle` line is needed** with v13 scoped packages, and **no Babel plugin is needed for vector icons** (the old `react-native-vector-icons/babel-plugin` is legacy v10-only).
3. Android verification: `npm run android`; open a scratch screen and render `<Icon source="check" />`. A toast warning from Paper means the icon module failed to load.
4. iOS later (not this milestone): `npx rnvi-update-plist package.json ios/AppName/Info.plist` then `pod install`.
5. Expo config is irrelevant: this is a vanilla RN CLI project (`App.tsx`, `index.js`, no `expo` dependency). Ignore the icons package `app.plugin.js`; never run `expo prebuild`/`expo install`.
6. Optional production bundle trim — modify `babel.config.js` (currently only the preset):

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  env: {
    production: {
      plugins: ['react-native-paper/babel'],
    },
  },
};
```

7. Optional Jest setup if tests render Paper or icon components (per vector-icons README): map `\\.(ttf)$` to a file mock and mock `@react-native-vector-icons/common`.

## 4. Provider + theming

Wrap root (e.g. in `App.tsx` or the component passed to `AppRegistry`). Paper recommends a second `PaperProvider` near the app root; providers like Zustand/Convex remain outside it.

```tsx
import {
  MD3DarkTheme,
  PaperProvider,
  configureFonts,
} from 'react-native-paper';

const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#5B4BC4',
    onPrimary: '#FFFFFF',
    primaryContainer: '#2A2350',
    onPrimaryContainer: '#E7E0FF',
    secondary: '#B9A9FF',
    onSecondary: '#23183D',
    background: '#09090B',        // zinc-950
    onBackground: '#FAFAFA',
    surface: '#18181B',            // zinc-900
    onSurface: '#FAFAFA',
    surfaceVariant: '#27272A',     // zinc-800
    onSurfaceVariant: '#A1A1AA',   // zinc-400
    outline: '#3F3F46',            // zinc-700
    outlineVariant: '#27272A',
    // MD3 tints surfaces by elevation; replace defaults so cards/bubbles
    // stay neutral instead of picking up the purple tint.
    elevation: {
      level0: 'transparent',
      level1: '#1B1B1F',
      level2: '#1F1F24',
      level3: '#232329',
      level4: '#25252B',
      level5: '#27272E',
    },
  },
  roundness: 12,
  // Optional, only if the app should keep its current font family:
  // fonts: configureFonts({ config: { fontFamily: 'Inter' } }),
};

export default function Main() {
  return (
    <PaperProvider theme={theme}>
      <App />
    </PaperProvider>
  );
}
```

React Navigation coexistence (optional, keeps navigation chrome in sync):

```tsx
import { adaptNavigationTheme } from 'react-native-paper';
import { DarkTheme as NavigationDarkTheme } from '@react-navigation/native';

const { DarkTheme } = adaptNavigationTheme({
  reactNavigationTheme: NavigationDarkTheme,
  defaultTheme: MD3DarkTheme,
});
```

Coexistence strategy:
- Do not rewrite existing `StyleSheet` code. Extend the app palette file with the same hex values used in the Paper theme so both worlds share one source of truth.
- New/refactored screens use Paper components; untouched screens keep custom components.
- Use `theme.colors.*` (via `useTheme()`) for any custom view adjacent to Paper components (e.g. message bubble backgrounds) so both track the same tokens.
- Do not render Paper `Appbar.Header` and the native-stack header on the same screen: set `headerShown: false` for Paper-managed screens.
- Incremental adoption, one screen per PR.

## 5. Component mapping

| Screen need | Paper component | Notes / gotchas |
|---|---|---|
| Chat list row | `List.Item` + `Avatar.Image` (or `Avatar.Text`) + `Badge` | `left` / `right` props; unread `Badge` positioned absolute over avatar; `right` renders time + badge column |
| Online indicator | `Badge` (no children = dot) | `size={10}`, absolute, theme-colored |
| Chat list search | `Searchbar` | controlled `value` / `onChangeText` |
| New chat action | `FAB` (or `FAB.Group`) | icon `"pencil"` / `"message-plus"` |
| Chat app bar | `Appbar.Header` + `Appbar.BackAction` + `Appbar.Content` (title + subtitle for presence) + `Appbar.Action` | hides native header; respects status bar; use `Appbar` with React Navigation via official guide if in-screen header is desired |
| Composer | `TextInput mode="flat" multiline` + `TextInput.Icon` / `IconButton` | auto-grow manually (`onContentSizeChange`); avoid `activeUnderlineColor: 'transparent'` (issue #4843); on iOS pass explicit `fontWeight` in style (issue #4880) |
| Send / attach / camera | `IconButton` | `containerColor` for accent send button |
| Long-press context menu | `Menu` + `Menu.Item` | Menu portals itself; requires Paper >= 5.15.1 (open-once bug #4807 fixed) |
| Toasts / errors | `Snackbar` | Fabric hide bug #4951 in 5.15.3 — remount via `key` or patch (see risks) |
| Date separators | `Divider` + `Text variant="labelSmall"` | `Caption` is MD2-era; in v5 use `Text` variants |
| Message bubbles | `Surface elevation={1}` + `Text` | override `colors.elevation.*` (section 4) to avoid purple tint; keep custom bubble layout inside `Surface` |
| Reactions | `Chip compact` (or custom emoji row) | Chip clones its direct `avatar` child; fine for emoji `Text` |
| Attachment bottom sheet | `Portal` + `Modal` | baseline: no gestures, dismiss via backdrop/button; `@gorhom/bottom-sheet` (drag + snap points) needs Reanimated — defer, not installed |
| Conversation details tabs | `SegmentedButtons` | best for 2–3 segments; Paper v5 has no Tabs/TabView. If swipeable tabs needed: `react-native-paper-tabs@0.11.4` + `react-native-pager-view` |
| Profile / settings rows | `List.Section`, `List.Subheader`, `List.Item`, `List.Accordion` | groups, expandable advanced settings |
| Settings toggles | `Switch` | wrap in `List.Item` or custom row |
| Settings text fields | `TextInput mode="outlined"` | same TextInput caveats as composer |
| Confirmations / rename | `Dialog` + `Portal` + `Dialog.Title/Content/Actions` + `Button` | never put a React Fragment directly in `Dialog.Actions` (issue #4794) |
| Radio choice | `RadioButton.Group` + `RadioButton.Item` | e.g. media download quality |
| Action buttons | `Button` (`mode="contained" / "outlined" / "text"`) | |
| Empty states | compose `Icon` + `Text` + `Button` inside a centered `View` | no built-in EmptyState primitive |
| Loading | `ActivityIndicator`, `ProgressBar` | |
| Generic pressable | `TouchableRipple` | ripple caveat #4810 |

## 6. Bundle size and tree-shaking

Unpacked package sizes (npm metadata):
- `react-native-paper@5.15.3`: ~3.77 MB (source + CJS + ESM)
- `@react-native-vector-icons/material-design-icons@13.1.4`: ~2.50 MB (includes MDI TTF font assets + glyphmap JSON)
- `@react-native-vector-icons/common`: ~155 KB

Practical impact:
- Metro in RN 0.81 does not tree-shake by default; Paper's barrel export pulls every component unless the `react-native-paper/babel` plugin (section 3, item 6) rewrites imports to per-module requires in production. Add it; this is the main lever.
- Paper needs only the Material Design Icons family; do not install other icon families.
- The MDI TTF (~1 MB+) ships as a native asset, not JS; the glyph map JSON is bundled in JS (hundreds of KB raw, reduced after minification).
- Measure with `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/base.jsbundle` before/after; compare clean release builds.
- Hermes is already enabled: no change.

## 7. Migration order

0. Spike (half day, feature branch): install deps, wrap `PaperProvider`, render a scratch screen with `Button`, `Appbar.Header`, `TextInput`, `Menu`, `Dialog` and verify on a physical Android device/emulator: icon font loads, ripple behavior, Menu opens more than once, Dialog dismisses without console errors. This de-risks section 8 before any screen work.
1. Settings — lowest risk; `List.Section/Item`, `Switch`, `Dialog`, `TextInput`.
2. Profile — `Avatar.Image/Text`, `TextInput`, `Button`, `List`.
3. Conversation details — `SegmentedButtons`, `List`, `Switch`, `RadioButton`.
4. Chat list — `Searchbar`, `List.Item`, `Avatar`, `Badge`, `FAB` (highest-traffic screen; do after the primitives are proven).
5. Chat screen last — `Appbar`, composer `TextInput`, `Menu`, `Snackbar`; keep existing custom bubbles initially, switching only their colors to theme tokens; adopt `Surface` bubbles afterwards if desired.
6. Attachment sheet: `Portal` + `Modal` first; only add `@gorhom/bottom-sheet` (+ Reanimated) if drag/snap UX is a hard requirement.

Rules: one screen per PR, no big-bang rewrite, keep existing components until their screen is migrated.

## 8. Known issues (React 19 / RN 0.81 / New Architecture)

| Issue | Status | Impact | Mitigation |
|---|---|---|---|
| [#4810](https://github.com/callstack/react-native-paper/issues/4810) `TouchableRipple` ripple not showing on RN 0.81+ (Android, also reported iOS/0.82/0.83) | Open; fixed only on `main` / 6.0.0-alpha (#4897) | All pressables: List.Item, Menu, Button ripple feedback | Try `borderless` first (user-confirmed fix); otherwise pass `underlayColor` + custom `background` (`PressableAndroidRippleConfig`, `foreground: true`); verify per component in spike; accept state-layer opacity as fallback |
| [#4951](https://github.com/callstack/react-native-paper/issues/4951) `Snackbar` stays mounted after `visible=false` under Fabric | Open; fix PR #5022 pending, not in 5.15.3 | Toasts never disappear | Remount with changing `key`, or `patch-package` the `if (finished)` guard; or build a thin app-level toast |
| [#4794](https://github.com/callstack/react-native-paper/issues/4794) `Dialog.Actions` injects `compact` into `React.Fragment` (React 19 error) | Open | Console error / broken dismiss when fragment children used | Never use `<>...</>` inside `Dialog.Actions`; wrap in `View` (fixes it) |
| [#4880](https://github.com/callstack/react-native-paper/issues/4880) `TextInput` SIGSEGV on Fabric when style has no `fontWeight` | Open; PR pending | iOS-only native crash | Android-first: low priority; on iOS pass explicit `fontWeight` in `style` |
| [#4843](https://github.com/callstack/react-native-paper/issues/4843) transparent `activeUnderlineColor` makes `TextInput` untouchable under New Arch | Open | Composer/search input dead | Never set underline/activeUnderline to `transparent`; use surface color |
| [#5045](https://github.com/callstack/react-native-paper/issues/5045) `Modal`/`Dialog` not moved above keyboard in Android edge-to-edge (Android 15+) | Open; PR pending | Dialogs with inputs covered by keyboard | Avoid `Dialog` + `TextInput` combos; use full-screen edit screens; track PR |
| [#4807](https://github.com/callstack/react-native-paper/issues/4807) Menu opens only once on RN 0.81 | Fixed in 5.15.1 (#4845, #4876); 5.15.3 includes | Long-press menus | Use >= 5.15.1; if seen, key-remount anchor workaround |
| [#4797](https://github.com/callstack/react-native-paper/issues/4797) "Support for RN 0.81" umbrella (animations/components) | Open; Menu part fixed | Residual: ripples (#4810) | Covered by spike + #4810 mitigations |
| Paper 5.x maintenance mode, dev on 6.0 alpha (requires Reanimated 4 + Worklets; breaking TextInput/FAB APIs) | — | Future upgrade cost | Stay on 5.15.3 now; plan a separate migration project for 6.0 stable |

## 9. Summary of risks

- Ripple loss (#4810) is the most visible regression and is **not fixed in 5.15.3**; validate the workaround on the target device before committing to the migration.
- Snackbar and Dialog keyboard issues can be worked around cheaply but require deliberate code patterns; document them in the component guidelines for the team.
- No native modules are added (Paper is JS-only), so the build risk is limited to the icon native module for fonts.
- Bundle cost is real but manageable with the Paper Babel plugin; enforce it before migrating screens.
- If the reported Fabric issues turn out to block chat-list polish, the escape hatch is a thin in-house component layer (as today) — the migration is screen-by-screen and fully reversible.
