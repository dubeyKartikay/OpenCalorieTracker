/**
 * Doop "Tokyo Night" palette.
 *
 * These are the only colour values the UI may use. Semantic slots are named by
 * role (ground/surface/ink/…) so screens never reach for a raw hue.
 */
export const colors = {
  /** App background, one layer below every card. */
  ground: '#1a1b26',
  /** Default card and sheet background. */
  surface: '#24283b',
  /** Raised elements stacked on a surface: chips, inputs, list rows. */
  raised: '#292e42',
  /** Circular daypart icon wells along the meal rail. */
  well: '#2e3040',
  /** Docked input & keypad sheet surface slightly above ground. */
  dock: '#202332',
  /** Visible stroke for focus rings and outlined controls. */
  border: '#414868',
  /** Quiet 1px divider drawn on top of `surface`. */
  hairline: '#2c3147',
  /** Empty portion of a progress track. */
  track: '#2f3549',
  /** Primary text. */
  ink: '#c0caf5',
  /** Secondary text, labels and icons. */
  muted: '#a9b1d6',
  /** Selection, focus and the single primary action. */
  accent: '#7aa2f7',
  /** Text and icons drawn on top of `accent`. */
  onAccent: '#1a1b26',
  /** Protein macro identifier only. */
  lavender: '#bb9af7',
  /** Carbs macro identifier only. */
  mint: '#73daca',
  /** Fat macro identifier only. */
  peach: '#ff9e64',
  /** Destructive actions and over-target states. */
  danger: '#f7768e',
  /** Confirmed and within-target states. */
  success: '#9ece6a',
  /** Attention states that are not errors. */
  warning: '#e0af68',
  /** Full-screen backdrop behind modals and sheets. */
  scrim: 'rgba(16,17,26,0.62)',
} as const;

export type ColorToken = keyof typeof colors;
export type ColorTokenValue = (typeof colors)[ColorToken];

/** Macro identifier colours. Nothing outside macro UI should use these. */
export const macroColors = {
  protein: colors.lavender,
  carbs: colors.mint,
  fat: colors.peach,
} as const;

export type MacroKey = keyof typeof macroColors;
export type MacroColorValue = (typeof macroColors)[MacroKey];
