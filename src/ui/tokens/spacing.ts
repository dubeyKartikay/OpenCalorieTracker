/** Spacing scale, in density-independent pixels. */
export const spacing = {
  s2: 2,
  s4: 4,
  s6: 6,
  s8: 8,
  s10: 10,
  s12: 12,
  s16: 16,
  s20: 20,
  s24: 24,
  s28: 28,
  s32: 32,
  s40: 40,
  s44: 44,
  s48: 48,
  s56: 56,
  s64: 64,
  s72: 72,
  s80: 80,
  s96: 96,
  s112: 112,
  s128: 128,
  s144: 144,
  s160: 160,
} as const;

export type SpacingToken = keyof typeof spacing;
export type SpacingTokenValue = (typeof spacing)[SpacingToken];

/** Minimum tappable edge, per platform accessibility guidance. */
export const MIN_TOUCH_TARGET = 44;

/** Horizontal page gutter used by every screen. */
export const SCREEN_GUTTER = 20;
