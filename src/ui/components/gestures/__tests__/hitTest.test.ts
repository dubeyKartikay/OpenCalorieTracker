import { describe, expect, it } from 'vitest';
import { findActiveTarget, SERVING_STOPS, snapServingStop } from '../hitTest';
import type { GestureTarget } from '../hitTest';

const targets: GestureTarget<'capture' | 'suggestion'>[] = [
  { id: 'camera', kind: 'capture', rect: { x: 20, y: 40, width: 56, height: 56 } },
  { id: 'search', kind: 'capture', rect: { x: 110, y: 10, width: 56, height: 56 } },
  { id: 'voice', kind: 'capture', rect: { x: 200, y: 40, width: 56, height: 56 } },
  { id: 'usual-1', kind: 'suggestion', rect: { x: 10, y: 240, width: 80, height: 64 } },
  { id: 'usual-2', kind: 'suggestion', rect: { x: 100, y: 240, width: 80, height: 64 } },
  { id: 'usual-3', kind: 'suggestion', rect: { x: 190, y: 240, width: 80, height: 64 } },
];

describe('findActiveTarget', () => {
  it.each(targets)('hits the exact bounds of $id', target => {
    const { x, y, width, height } = target.rect;
    for (const point of [{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }, { x: x + width / 2, y: y + height / 2 }]) {
      expect(findActiveTarget(point, targets)).toBe(target);
    }
  });

  it('cancels inside a circular dead zone, including its boundary', () => {
    const deadZone = { cx: 48, cy: 68, radius: 20 };
    expect(findActiveTarget({ x: 48, y: 68 }, targets, deadZone)).toBeNull();
    expect(findActiveTarget({ x: 68, y: 68 }, targets, deadZone, 50)).toBeNull();
    expect(findActiveTarget({ x: 69, y: 68 }, targets, deadZone)?.id).toBe('camera');
  });

  it('cancels inside a rectangular dead zone before matching targets', () => {
    const deadZone = { x: 20, y: 40, width: 56, height: 56 };
    expect(findActiveTarget({ x: 20, y: 40 }, targets, deadZone, 8)).toBeNull();
    expect(findActiveTarget({ x: 76, y: 96 }, targets, deadZone)).toBeNull();
  });

  it('adds padded hit tolerance without expanding the dead zone', () => {
    expect(findActiveTarget({ x: 14, y: 68 }, targets)).toBeNull();
    expect(findActiveTarget({ x: 14, y: 68 }, targets, undefined, 6)?.id).toBe('camera');
    expect(findActiveTarget({ x: 13.99, y: 68 }, targets, undefined, 6)).toBeNull();
    expect(findActiveTarget({ x: 77, y: 68 }, targets, { cx: 48, cy: 68, radius: 28 }, 6)?.id).toBe('camera');
  });

  it('picks the nearest center in an overlap, independently of target order', () => {
    const overlapping = [
      { id: 'left', kind: 'capture', rect: { x: 0, y: 0, width: 60, height: 60 } },
      { id: 'right', kind: 'suggestion', rect: { x: 40, y: 0, width: 60, height: 60 } },
    ];
    expect(findActiveTarget({ x: 55, y: 30 }, overlapping)?.id).toBe('right');
    expect(findActiveTarget({ x: 45, y: 30 }, [...overlapping].reverse())?.id).toBe('left');
    expect(findActiveTarget({ x: 50, y: 30 }, overlapping)?.id).toBe('left');
  });

  it('cancels outside every target, including gaps and an empty target set', () => {
    expect(findActiveTarget({ x: 140, y: 160 }, targets)).toBeNull();
    expect(findActiveTarget({ x: -100, y: -100 }, targets)).toBeNull();
    expect(findActiveTarget({ x: 48, y: 68 }, [])).toBeNull();
  });
});

describe('snapServingStop', () => {
  it('exposes the four exact serving multipliers', () => {
    expect(SERVING_STOPS).toEqual([0.5, 1, 1.5, 2]);
  });

  it.each([
    [0, 0.5], [1 / 3, 1], [2 / 3, 1.5], [1, 2],
    [1 / 6 - 0.0001, 0.5], [1 / 6, 1],
    [0.5 - 0.0001, 1], [0.5, 1.5],
    [5 / 6 - 0.0001, 1.5], [5 / 6, 2],
    [-1, 0.5], [2, 2], [-Infinity, 0.5], [Infinity, 2], [NaN, 0.5],
  ])('snaps position %s to %s servings', (position, expected) => {
    expect(snapServingStop(position)).toBe(expected);
  });
});
