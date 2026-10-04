import { Platform } from 'react-native';

export type TypographyVariant = {
  regular: { fontFamily: string };
  medium: { fontFamily: string };
  bold: { fontFamily: string };
};

export type Typography = {
  fontFamily: string;
  link: { fontFamily: string };
} & Record<
  | "title"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "body"
  | "caption1"
  | "caption2"
  | "button",
  TypographyVariant
>;

// Simple font mapping - response name to file names (without extension)
const FONT_MAP: Record<string, { regular: string; medium: string; bold: string }> = {
  'times new roman': {
    regular: Platform.OS === 'ios' ? 'TimesNewRomanPSMT' : 'times_new_roman_regular',
    medium: Platform.OS === 'ios' ? 'TimesNewRomanPSMT' : 'times_new_roman_medium',
    bold: Platform.OS === 'ios' ? 'TimesNewRomanPS-BoldMT' : 'times_new_roman_bold',
  },
  'inter': {
    regular: Platform.OS === 'ios' ? 'Inter-Regular' : 'inter_regular',
    medium: Platform.OS === 'ios' ? 'Inter-Medium' : 'inter_medium',
    bold: Platform.OS === 'ios' ? 'Inter-Bold' : 'inter_bold',
  },
  'roboto': {
    regular: Platform.OS === 'ios' ? 'Roboto-Regular' : 'roboto_regular',
    medium: Platform.OS === 'ios' ? 'Roboto-Medium' : 'roboto_medium',
    bold: Platform.OS === 'ios' ? 'Roboto-Bold' : 'roboto_bold',
  },
};

/**
 * Creates a complete Typography object for CometChat theme.
 * Normalizes font name, provides fallback, and builds all variants.
 * 
 * @param font - The font name from backend (e.g., 'inter', 'roboto', 'times new roman')
 * @returns Complete Typography object with all variants configured
 */
export const createTypography = (font: string): Typography => {
  const types = [
    "title",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "body",
    "caption1",
    "caption2",
    "button",
  ] as const;

  // Normalize font name from backend and provide fallback
  const fontKey = font ? font.toLowerCase().trim() : '';
  const fontVariants = FONT_MAP[fontKey] || FONT_MAP['times new roman'];

  // Defensive: ensure all variants exist
  const baseStyle: TypographyVariant = {
    regular: { fontFamily: fontVariants.regular },
    medium: { fontFamily: fontVariants.medium },
    bold: { fontFamily: fontVariants.bold },
  };

  const typography: Typography = {
    fontFamily: fontVariants.regular,
    link: { fontFamily: fontVariants.regular },
  } as Typography;

  types.forEach((type) => {
    typography[type] = { ...baseStyle };
  });

  return typography;
};