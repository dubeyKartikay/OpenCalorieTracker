import type { Point, ScreenRect } from './hitTest';

export interface MealDropZone {
  meal: string;
  rect: ScreenRect;
}

/**
 * Resolve which meal drop zone a drag pointer currently targets.
 * Meal rows stack vertically full-width, so horizontal tolerance is generous
 * while vertical boundaries match the exact row first and fall back to the
 * nearest zone center within `paddingY` across small gaps.
 */
export function findDropTargetMeal(
  point: Point,
  zones: readonly MealDropZone[],
  paddingY = 8,
  paddingX = 56,
): string | null {
  if (!zones.length) return null;

  const padX = Math.max(0, paddingX);
  const padY = Math.max(0, paddingY);

  // 1. Prefer strict vertical containment (with generous horizontal forgiveness).
  let directMatch: MealDropZone | null = null;
  let directDistance = Infinity;
  for (const zone of zones) {
    const { x, y, width, height } = zone.rect;
    if (width <= 0 || height <= 0) continue;
    if (point.x < x - padX || point.x > x + width + padX) continue;
    if (point.y >= y && point.y <= y + height) {
      const distY = Math.abs(point.y - (y + height / 2));
      if (distY < directDistance) {
        directDistance = distY;
        directMatch = zone;
      }
    }
  }
  if (directMatch) return directMatch.meal;

  // 2. Fall back to padded vertical band across tiny gaps between sections.
  let paddedMatch: MealDropZone | null = null;
  let paddedDistance = Infinity;
  for (const zone of zones) {
    const { x, y, width, height } = zone.rect;
    if (width <= 0 || height <= 0) continue;
    if (point.x < x - padX || point.x > x + width + padX) continue;
    if (point.y >= y - padY && point.y <= y + height + padY) {
      const distY = Math.abs(point.y - (y + height / 2));
      if (distY < paddedDistance) {
        paddedDistance = distY;
        paddedMatch = zone;
      }
    }
  }
  return paddedMatch?.meal ?? null;
}

/**
 * Compute per-tick auto-scroll delta (px) when dragging near the top or bottom
 * edge of the scroll viewport. Negative scrolls up, positive scrolls down.
 */
export function computeAutoScrollVelocity(
  pointerY: number,
  containerTop: number,
  containerBottom: number,
  edgeThreshold = 76,
  maxStepPx = 11,
): number {
  const height = containerBottom - containerTop;
  if (height <= 0 || edgeThreshold <= 0 || maxStepPx <= 0) return 0;

  const effectiveEdge = Math.min(edgeThreshold, height / 3);
  const distTop = pointerY - containerTop;
  if (distTop < effectiveEdge) {
    const ratio = Math.min(1, Math.max(0, (effectiveEdge - distTop) / effectiveEdge));
    return -Math.round(ratio * maxStepPx * 10) / 10;
  }

  const distBottom = containerBottom - pointerY;
  if (distBottom < effectiveEdge) {
    const ratio = Math.min(1, Math.max(0, (effectiveEdge - distBottom) / effectiveEdge));
    return Math.round(ratio * maxStepPx * 10) / 10;
  }

  return 0;
}

/**
 * Position the floating drag ghost slightly above the user's fingertip with
 * damped horizontal sway so the food item stays clearly visible while dragging.
 */
export function computeGhostPosition(
  pointer: Point,
  startPointer: Point,
  rowRect: ScreenRect,
  overlayOrigin: Point,
  ghostHeight: number,
  liftOffsetY = 18,
): { left: number; top: number } {
  const swayX = Math.max(-28, Math.min(28, (pointer.x - startPointer.x) * 0.22));
  const left = rowRect.x - overlayOrigin.x + swayX;
  const top = pointer.y - overlayOrigin.y - ghostHeight / 2 - liftOffsetY;
  return { left, top };
}
