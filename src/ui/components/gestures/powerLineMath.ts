export interface PowerLineOrigin {
  x: number;
  y: number;
  /** Visual radius of the origin button. */
  radius: number;
}

export interface PowerLineTarget {
  id: string;
  /** Center X of target in the same coordinate space as origin. */
  x: number;
  /** Center Y of target in the same coordinate space as origin. */
  y: number;
  /** Visual radius (or distance from target center to edge along the ray). */
  radius: number;
}

export interface PowerLineGeometry {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  midX: number;
  midY: number;
  length: number;
  angleDeg: number;
}

/**
 * Computes straight radial conduit segments from the origin button's rim to
 * each target's rim. A small negative `rimInset` (default `-4`) tucks both ends
 * slightly behind the button and target circles so there is never a visual gap.
 */
export function computePowerLines(
  origin: PowerLineOrigin,
  targets: readonly PowerLineTarget[],
  rimInset = -4,
): PowerLineGeometry[] {
  const results: PowerLineGeometry[] = [];
  for (const target of targets) {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const dist = Math.hypot(dx, dy);
    if (!Number.isFinite(dist) || dist < 1) continue;
    const ux = dx / dist;
    const uy = dy / dist;
    const startDist = Math.max(0, origin.radius + rimInset);
    const endDist = Math.min(dist, Math.max(startDist, dist - target.radius - rimInset));
    const length = endDist - startDist;
    if (length < 4) continue;
    const startX = origin.x + ux * startDist;
    const startY = origin.y + uy * startDist;
    const endX = origin.x + ux * endDist;
    const endY = origin.y + uy * endDist;
    results.push({
      id: target.id,
      startX,
      startY,
      endX,
      endY,
      midX: (startX + endX) / 2,
      midY: (startY + endY) / 2,
      length,
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }
  return results;
}

/** Computes wrapped [0, 1) travel progress for a staggered pulse on a power line. */
export function computePulseProgress(phase: number, offset: number): number {
  'worklet';
  const raw = phase + offset;
  return raw - Math.floor(raw);
}
