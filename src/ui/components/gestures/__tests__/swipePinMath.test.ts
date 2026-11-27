import { describe, expect, it } from 'vitest';
import {
  computeSwipePinOffset,
  computeSwipePinProgress,
  shouldCommitSwipePin,
  SWIPE_PIN_MAX_TRANSLATE,
  SWIPE_PIN_THRESHOLD,
} from '../swipePinMath';

describe('swipePinMath', () => {
  it('clamps left swipes to zero and tracks right swipes 1:1 up to threshold', () => {
    expect(computeSwipePinOffset(-40)).toBe(0);
    expect(computeSwipePinOffset(0)).toBe(0);
    expect(computeSwipePinOffset(36)).toBe(36);
    expect(computeSwipePinOffset(SWIPE_PIN_THRESHOLD)).toBe(SWIPE_PIN_THRESHOLD);
  });

  it('applies rubber-band damping past the commit threshold without exceeding max', () => {
    const past = computeSwipePinOffset(SWIPE_PIN_THRESHOLD + 60);
    expect(past).toBeGreaterThan(SWIPE_PIN_THRESHOLD);
    expect(past).toBeLessThan(SWIPE_PIN_MAX_TRANSLATE);

    const far = computeSwipePinOffset(1000);
    expect(far).toBeLessThanOrEqual(SWIPE_PIN_MAX_TRANSLATE);
    expect(far).toBeGreaterThan(SWIPE_PIN_MAX_TRANSLATE - 1);
  });

  it('computes clamped [0, 1] reveal progress', () => {
    expect(computeSwipePinProgress(-5)).toBe(0);
    expect(computeSwipePinProgress(SWIPE_PIN_THRESHOLD / 2)).toBeCloseTo(0.5, 4);
    expect(computeSwipePinProgress(SWIPE_PIN_THRESHOLD)).toBe(1);
    expect(computeSwipePinProgress(SWIPE_PIN_MAX_TRANSLATE)).toBe(1);
  });

  it('commits past threshold or on a deliberate right flick', () => {
    expect(shouldCommitSwipePin(SWIPE_PIN_THRESHOLD - 1, 0)).toBe(false);
    expect(shouldCommitSwipePin(SWIPE_PIN_THRESHOLD, 0)).toBe(true);
    expect(shouldCommitSwipePin(SWIPE_PIN_THRESHOLD * 0.65, 650)).toBe(true);
    expect(shouldCommitSwipePin(20, 900)).toBe(false);
  });
});
