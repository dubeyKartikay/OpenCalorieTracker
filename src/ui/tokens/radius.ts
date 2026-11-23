/** Corner radii, in density-independent pixels. */
export const radius = {
  r8: 8,
  r12: 12,
  r16: 16,
  r20: 20,
  r24: 24,
  r32: 32,
  /** Pills and circular controls. */
  full: 999,
} as const;

export type RadiusToken = keyof typeof radius;
export type RadiusTokenValue = (typeof radius)[RadiusToken];
