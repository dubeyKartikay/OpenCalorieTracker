import { describe, expect, it } from 'vitest';
import { clampHoldProgress, computeHoldRingAngles } from '../holdRingMath';

describe('holdRingMath', () => {
  it('clamps progress cleanly to [0, 1]', () => {
    expect(clampHoldProgress(-0.2)).toBe(0);
    expect(clampHoldProgress(0)).toBe(0);
    expect(clampHoldProgress(0.4)).toBe(0.4);
    expect(clampHoldProgress(1)).toBe(1);
    expect(clampHoldProgress(1.8)).toBe(1);
    expect(clampHoldProgress(Number.NaN)).toBe(0);
  });

  it('computes exact clockwise angles across all four quadrants', () => {
    expect(computeHoldRingAngles(0)).toEqual({
      progress: 0,
      rightDeg: -135,
      leftDeg: -135,
      tipDeg: 0,
      showStart: false,
      showLeft: false,
    });

    const q1 = computeHoldRingAngles(0.25);
    expect(q1.rightDeg).toBeCloseTo(-45);
    expect(q1.leftDeg).toBeCloseTo(-135);
    expect(q1.tipDeg).toBeCloseTo(90);
    expect(q1.showStart).toBe(true);
    expect(q1.showLeft).toBe(false);

    const half = computeHoldRingAngles(0.5);
    expect(half.rightDeg).toBeCloseTo(45);
    expect(half.leftDeg).toBeCloseTo(-135);
    expect(half.tipDeg).toBeCloseTo(180);
    expect(half.showStart).toBe(true);
    expect(half.showLeft).toBe(false);

    const q3 = computeHoldRingAngles(0.75);
    expect(q3.rightDeg).toBeCloseTo(45);
    expect(q3.leftDeg).toBeCloseTo(-45);
    expect(q3.tipDeg).toBeCloseTo(270);
    expect(q3.showStart).toBe(true);
    expect(q3.showLeft).toBe(true);

    const full = computeHoldRingAngles(1);
    expect(full.rightDeg).toBeCloseTo(45);
    expect(full.leftDeg).toBeCloseTo(45);
    expect(full.tipDeg).toBeCloseTo(360);
    expect(full.showStart).toBe(true);
    expect(full.showLeft).toBe(true);
  });
});
