export type ScreenRect = { x: number; y: number; width: number; height: number };
export type GestureTarget<T> = { id: string; kind: T; rect: ScreenRect };
export type Point = { x: number; y: number };
export type DeadZone = ScreenRect | { cx: number; cy: number; radius: number };

function contains(point: Point, rect: ScreenRect, padding = 0): boolean {
  return point.x >= rect.x - padding && point.x <= rect.x + rect.width + padding
    && point.y >= rect.y - padding && point.y <= rect.y + rect.height + padding;
}

/** Coordinates are all in window space. Center cancellation takes priority over padding. */
export function findActiveTarget<T>(
  point: Point, targets: GestureTarget<T>[], deadZone?: DeadZone, padding = 0,
): GestureTarget<T> | null {
  if (deadZone && ('radius' in deadZone
    ? Math.hypot(point.x - deadZone.cx, point.y - deadZone.cy) <= deadZone.radius
    : contains(point, deadZone))) return null;

  let nearest: GestureTarget<T> | null = null;
  let distance = Infinity;
  for (const target of targets) {
    if (!contains(point, target.rect, Math.max(0, padding))) continue;
    const candidateDistance = Math.hypot(
      point.x - target.rect.x - target.rect.width / 2,
      point.y - target.rect.y - target.rect.height / 2,
    );
    if (candidateDistance < distance) {
      nearest = target;
      distance = candidateDistance;
    }
  }
  return nearest;
}

export const SERVING_STOPS = [0.5, 1, 1.5, 2] as const;
export type ServingMultiplier = (typeof SERVING_STOPS)[number];

/** Stops sit at 0, 1/3, 2/3, 1; midpoint ties snap toward the larger serving. */
export function snapServingStop(normalizedX: number): ServingMultiplier {
  const clamped = Number.isNaN(normalizedX) ? 0 : Math.max(0, Math.min(1, normalizedX));
  return SERVING_STOPS[Math.round(clamped * (SERVING_STOPS.length - 1))] ?? 0.5;
}
