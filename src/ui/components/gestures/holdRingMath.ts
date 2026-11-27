/**
 * Pure angle math for the 0 -> 360 degree circular hold-completion ring.
 *
 * Uses two half-circle clipped borders so the ring animates purely via GPU
 * transforms (`Animated.View` + `useAnimatedStyle`) without SVG prop bridging.
 */

export const HOLD_RING_RESET_MS = 120;

export interface HoldRingAngles {
  /** Clamped progress in [0, 1]. */
  progress: number;
  /** Rotation in degrees for the right half-circle arc (-135 -> +45). */
  rightDeg: number;
  /** Rotation in degrees for the left half-circle arc (-135 -> +45). */
  leftDeg: number;
  /** Rotation in degrees for the rounded leading tip cap (0 -> 360). */
  tipDeg: number;
  /** Whether any progress arc should be visible. */
  showStart: boolean;
  /** Whether the second (left) half arc has started sweeping. */
  showLeft: boolean;
}

export function clampHoldProgress(progress: number): number {
  'worklet';
  if (Number.isNaN(progress) || progress <= 0) return 0;
  if (progress >= 1) return 1;
  return progress;
}

export function computeHoldRingAngles(progress: number): HoldRingAngles {
  'worklet';
  const clamped = clampHoldProgress(progress);
  const rightFraction = clamped < 0.5 ? clamped : 0.5;
  const leftFraction = clamped > 0.5 ? clamped - 0.5 : 0;
  return {
    progress: clamped,
    rightDeg: -135 + rightFraction * 360,
    leftDeg: -135 + leftFraction * 360,
    tipDeg: clamped * 360,
    showStart: clamped > 0.01,
    showLeft: clamped > 0.5,
  };
}
