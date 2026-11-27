import { describe, expect, it } from 'vitest';
import { computePowerLines, computePulseProgress } from '../powerLineMath';

describe('powerLineMath', () => {
  it('computes accurate radial geometry and angles from origin rim to target rims', () => {
    const lines = computePowerLines(
      { x: 22, y: 22, radius: 22 },
      [
        { id: 'voice', x: 22, y: -98, radius: 21 }, // straight up (-90 deg), dist 120
        { id: 'usual', x: -73, y: 22, radius: 0 }, // straight left (180 deg), dist 95
        { id: 'search', x: -82, y: -38, radius: 21 }, // up-left, dist 120
      ],
      0,
    );

    expect(lines).toHaveLength(3);

    const voice = lines[0]!;
    expect(voice.id).toBe('voice');
    expect(voice.angleDeg).toBeCloseTo(-90, 4);
    expect(voice.length).toBeCloseTo(77, 4);
    expect(voice.startX).toBeCloseTo(22, 4);
    expect(voice.startY).toBeCloseTo(0, 4);
    expect(voice.endX).toBeCloseTo(22, 4);
    expect(voice.endY).toBeCloseTo(-77, 4);

    const usual = lines[1]!;
    expect(usual.id).toBe('usual');
    expect(Math.abs(usual.angleDeg)).toBeCloseTo(180, 4);
    expect(usual.length).toBeCloseTo(73, 4);

    const search = lines[2]!;
    expect(search.length).toBeCloseTo(Math.hypot(104, 60) - 43, 4);
    expect(search.midX).toBeCloseTo((search.startX + search.endX) / 2, 4);
    expect(search.midY).toBeCloseTo((search.startY + search.endY) / 2, 4);
  });

  it('skips degenerate zero-distance or overlapping targets cleanly', () => {
    const lines = computePowerLines(
      { x: 100, y: 100, radius: 44 },
      [
        { id: 'same', x: 100, y: 100, radius: 20 },
        { id: 'overlap', x: 120, y: 100, radius: 20 },
        { id: 'valid', x: 220, y: 100, radius: 20 },
      ],
      0,
    );
    expect(lines.map(l => l.id)).toEqual(['valid']);
    expect(lines[0]!.length).toBeCloseTo(56, 4);
    expect(lines[0]!.angleDeg).toBeCloseTo(0, 4);
  });

  it('wraps staggered pulse progress into [0, 1)', () => {
    expect(computePulseProgress(0, 0)).toBeCloseTo(0, 5);
    expect(computePulseProgress(0.25, 0.5)).toBeCloseTo(0.75, 5);
    expect(computePulseProgress(0.75, 0.5)).toBeCloseTo(0.25, 5);
    expect(computePulseProgress(1.0, 0)).toBeCloseTo(0, 5);
  });
});
