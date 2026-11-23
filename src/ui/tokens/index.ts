/**
 * Doop "Tokyo Night" design tokens.
 *
 * Shared UI constants and responsive layout helpers. Pure logic should import
 * constant-only modules directly; screens can use this UI barrel.
 */
import { colors, macroColors } from './colors';
import { radius } from './radius';
import { MIN_TOUCH_TARGET, SCREEN_GUTTER, spacing } from './spacing';
import { fontFamily, fontSize, fontWeight, lineHeight, tabularNums } from './typography';

export { colors, macroColors } from './colors';
export type { ColorToken, ColorTokenValue, MacroColorValue, MacroKey } from './colors';
export { radius } from './radius';
export type { RadiusToken, RadiusTokenValue } from './radius';
export { MIN_TOUCH_TARGET, SCREEN_GUTTER, spacing } from './spacing';
export type { SpacingToken, SpacingTokenValue } from './spacing';
export { EXPANDED_BREAKPOINT, TwoPane, useLayoutClass } from './layout';
export type { LayoutClass, TwoPaneProps } from './layout';
export {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  tabularNums,
} from './typography';
export type {
  FontFamilyToken,
  FontSizeToken,
  FontWeightToken,
  LineHeightToken,
} from './typography';

/** Every token group in one object, for theme providers and storybook-style tooling. */
export const tokens = {
  colors,
  macroColors,
  radius,
  spacing,
  minTouchTarget: MIN_TOUCH_TARGET,
  screenGutter: SCREEN_GUTTER,
  fontFamily,
  fontWeight,
  fontSize,
  lineHeight,
  tabularNums,
} as const;

export type Tokens = typeof tokens;
