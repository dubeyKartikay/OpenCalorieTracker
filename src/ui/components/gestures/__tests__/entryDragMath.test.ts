import { describe, expect, it } from 'vitest';
import { computeAutoScrollVelocity, computeGhostPosition, findDropTargetMeal, type MealDropZone } from '../entryDragMath';

const ZONES: MealDropZone[] = [
  { meal: 'Breakfast', rect: { x: 20, y: 100, width: 320, height: 110 } },
  { meal: 'Lunch', rect: { x: 20, y: 220, width: 320, height: 66 } },
  { meal: 'Dinner', rect: { x: 20, y: 296, width: 320, height: 66 } },
  { meal: 'Snacks', rect: { x: 20, y: 372, width: 320, height: 66 } },
];

describe('findDropTargetMeal', () => {
  it('returns the exact meal section containing the pointer', () => {
    expect(findDropTargetMeal({ x: 180, y: 140 }, ZONES)).toBe('Breakfast');
    expect(findDropTargetMeal({ x: 180, y: 250 }, ZONES)).toBe('Lunch');
    expect(findDropTargetMeal({ x: 180, y: 325 }, ZONES)).toBe('Dinner');
    expect(findDropTargetMeal({ x: 180, y: 400 }, ZONES)).toBe('Snacks');
  });

  it('tolerates moderate horizontal thumb drift outside the meal column', () => {
    expect(findDropTargetMeal({ x: 4, y: 325 }, ZONES)).toBe('Dinner');
    expect(findDropTargetMeal({ x: 370, y: 325 }, ZONES)).toBe('Dinner');
    expect(findDropTargetMeal({ x: -100, y: 325 }, ZONES)).toBeNull();
  });

  it('resolves small vertical gaps to the nearest meal center within paddingY', () => {
    // Gap between Lunch (ends 286) and Dinner (starts 296) is 10px; 292 is closer to Dinner.
    expect(findDropTargetMeal({ x: 180, y: 292 }, ZONES, 8)).toBe('Dinner');
    expect(findDropTargetMeal({ x: 180, y: 289 }, ZONES, 8)).toBe('Lunch');
  });

  it('returns null when far outside all meal rows or when zones are empty', () => {
    expect(findDropTargetMeal({ x: 180, y: 20 }, ZONES)).toBeNull();
    expect(findDropTargetMeal({ x: 180, y: 520 }, ZONES)).toBeNull();
    expect(findDropTargetMeal({ x: 180, y: 325 }, [])).toBeNull();
  });

  it('ignores zero-sized zones', () => {
    const broken: MealDropZone[] = [
      { meal: 'Breakfast', rect: { x: 20, y: 100, width: 0, height: 0 } },
      { meal: 'Dinner', rect: { x: 20, y: 200, width: 320, height: 66 } },
    ];
    expect(findDropTargetMeal({ x: 180, y: 100 }, broken)).toBeNull();
    expect(findDropTargetMeal({ x: 180, y: 230 }, broken)).toBe('Dinner');
  });
});

describe('computeAutoScrollVelocity', () => {
  it('returns 0 in the middle of the viewport', () => {
    expect(computeAutoScrollVelocity(400, 100, 700)).toBe(0);
  });

  it('returns negative velocity near the top edge and positive near the bottom edge', () => {
    expect(computeAutoScrollVelocity(120, 100, 700, 80, 10)).toBeLessThan(0);
    expect(computeAutoScrollVelocity(680, 100, 700, 80, 10)).toBeGreaterThan(0);
  });

  it('clamps velocity at maxStepPx beyond the viewport edge', () => {
    expect(computeAutoScrollVelocity(50, 100, 700, 80, 10)).toBe(-10);
    expect(computeAutoScrollVelocity(760, 100, 700, 80, 10)).toBe(10);
  });

  it('returns 0 for degenerate container bounds', () => {
    expect(computeAutoScrollVelocity(200, 300, 300)).toBe(0);
    expect(computeAutoScrollVelocity(200, 400, 100)).toBe(0);
  });
});

describe('computeGhostPosition', () => {
  it('anchors horizontally to the row with damped sway and lifts above the pointer', () => {
    const pos = computeGhostPosition(
      { x: 220, y: 340 },
      { x: 180, y: 140 },
      { x: 52, y: 120, width: 280, height: 48 },
      { x: 0, y: 40 },
      56,
      18,
    );
    expect(pos.left).toBeCloseTo(52 + 40 * 0.22, 5);
    expect(pos.top).toBe(340 - 40 - 28 - 18);
  });

  it('clamps horizontal sway to +/- 28px', () => {
    const farRight = computeGhostPosition(
      { x: 500, y: 340 },
      { x: 100, y: 140 },
      { x: 52, y: 120, width: 280, height: 48 },
      { x: 0, y: 0 },
      56,
    );
    expect(farRight.left).toBe(52 + 28);
  });
});
