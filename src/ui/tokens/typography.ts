/** Text stack. Manrope carries both prose and figures. */
export const fontFamily = {
  body: 'Manrope',
  number: 'Manrope',
} as const;

/** Font weights as React Native expects them: strings, not numbers. */
export const fontWeight = {
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

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
export type FontWeightToken = keyof typeof fontWeight;
export type FontSizeToken = keyof typeof fontSize;
export type LineHeightToken = keyof typeof lineHeight;
