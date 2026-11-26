import { Platform } from 'react-native';
import type { TextStyle } from 'react-native';

// The root layout registers all four Manrope weights via @expo-google-fonts/manrope.
// On native Android/iOS, each weight is a distinct font face name; setting fontWeight
// alone on a single-weight family causes Android to fall back to regular/medium.
const webStack = 'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export const fontFamily = {
  body: Platform.OS === 'web' ? webStack : 'Manrope_500Medium',
  number: Platform.OS === 'web' ? webStack : 'Manrope_500Medium',
  medium: Platform.OS === 'web' ? webStack : 'Manrope_500Medium',
  semibold: Platform.OS === 'web' ? webStack : 'Manrope_600SemiBold',
  bold: Platform.OS === 'web' ? webStack : 'Manrope_700Bold',
  extrabold: Platform.OS === 'web' ? webStack : 'Manrope_800ExtraBold',
} as const;

/** Font weights as React Native expects them: strings, not numbers. */
export const fontWeight = {
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

export type FontWeightName = keyof typeof fontWeight;

/** Cross-platform Manrope weight style that renders true Bold/ExtraBold on Android & Web. */
export function fontFace(weight: FontWeightName = 'medium'): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  if (Platform.OS === 'web') {
    return { fontFamily: webStack, fontWeight: fontWeight[weight] };
  }
  return { fontFamily: fontFamily[weight] };
}

/** Font sizes, in density-independent pixels. */
export const fontSize = {
  t10: 10,
  t11: 11,
  t12: 12,
  t13: 13,
  t14: 14,
  t16: 16,
  t18: 18,
  t20: 20,
  t24: 24,
  t28: 28,
  t32: 32,
  t40: 40,
  t48: 48,
  t56: 56,
  t64: 64,
} as const;

/** Line height as a multiple of font size. */
export const lineHeight = {
  tight: 1.15,
  normal: 1.5,
} as const;

/** Style fragment that keeps digits from shifting width as values change. */
export const tabularNums = {
  fontVariant: ['tabular-nums'] as const,
};

export type FontFamilyToken = keyof typeof fontFamily;
export type FontSizeToken = keyof typeof fontSize;
export type FontWeightToken = keyof typeof fontWeight;
export type LineHeightToken = keyof typeof lineHeight;
