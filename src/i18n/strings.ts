/**
 * The app's entire translation surface: three tab labels.
 *
 * This replaced `useCometChatTranslation` / `getCometChatTranslation` from the UIKit.
 * The UIKit shipped a ~40 KB localisation bundle to render three strings, and its
 * fallback behaviour was to return the KEY itself — so a missing key rendered as a
 * shouted `PROFILE` sitting under two sentence-case siblings. That is why the labels
 * below are literal English and why nothing here is keyed by uppercase enum.
 *
 * No i18n dependency, deliberately. `t()` is a lookup with the key as its own fallback,
 * so adding a language later is "add a file and a lookup" — not a refactor of every
 * call site. The moment that stops being true is the moment worth adopting i18next.
 */
export const STRINGS = {
  CHATS: 'Chats',
  CALLS: 'Calls',
  PROFILE: 'Profile',
} as const;

export type StringKey = keyof typeof STRINGS;

/**
 * Resolve a key to its English string. Unknown keys return the key itself rather than
 * throwing, so a typo degrades to visible-but-harmless instead of a blank label.
 */
export const t = (key: StringKey): string => STRINGS[key];
