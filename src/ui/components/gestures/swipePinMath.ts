export const SWIPE_PIN_THRESHOLD = 72;
export const SWIPE_PIN_MAX_TRANSLATE = 116;
export const SWIPE_PIN_FLICK_VELOCITY = 520;

/**
 * Maps raw horizontal pan translation into a smooth right-only card offset:
 * 1:1 tracking up to `SWIPE_PIN_THRESHOLD`, then exponential rubber-band
 * resistance approaching `SWIPE_PIN_MAX_TRANSLATE`.
 */
export function computeSwipePinOffset(translationX: number): number {
  'worklet';
  if (!Number.isFinite(translationX) || translationX <= 0) return 0;
  if (translationX <= SWIPE_PIN_THRESHOLD) return translationX;
  const overshoot = translationX - SWIPE_PIN_THRESHOLD;
  const headroom = SWIPE_PIN_MAX_TRANSLATE - SWIPE_PIN_THRESHOLD;
  return SWIPE_PIN_THRESHOLD + headroom * (1 - Math.exp(-overshoot / 68));
}

/** Normalized [0, 1] progress toward the pin commit threshold. */
export function computeSwipePinProgress(offset: number): number {
  'worklet';
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.min(1, offset / SWIPE_PIN_THRESHOLD);
}

/** Returns true when releasing the card should toggle its pinned state. */
export function shouldCommitSwipePin(offset: number, velocityX: number): boolean {
  'worklet';
  if (!Number.isFinite(offset) || offset <= 0) return false;
  if (offset >= SWIPE_PIN_THRESHOLD) return true;
  return Number.isFinite(velocityX) && velocityX >= SWIPE_PIN_FLICK_VELOCITY && offset >= SWIPE_PIN_THRESHOLD * 0.58;
}
