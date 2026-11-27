import { describe, expect, it } from 'vitest';
import { computeScrollTargetAboveKeyboard } from '../keyboardScrollMath';

describe('keyboardScrollMath', () => {
  it('scrolls an input covered by the keyboard cleanly above it', () => {
    // Pixel-like 890dp screen, 340dp keyboard -> visibleBottom = 532dp.
    // Inline custom-unit form sits at y=515..635 (height 120), partially behind keyboard.
    const nextY = computeScrollTargetAboveKeyboard({
      currentScrollY: 0,
      scrollViewTop: 48,
      nodeTop: 515,
      nodeHeight: 120,
      windowHeight: 890,
      keyboardHeight: 340,
    });
    expect(nextY).toBe(103); // 635 - (890 - 340 - 18) = 103
  });

  it('scrolls cards far down a long list above the keyboard', () => {
    const nextY = computeScrollTargetAboveKeyboard({
      currentScrollY: 400,
      scrollViewTop: 48,
      nodeTop: 720,
      nodeHeight: 130,
      windowHeight: 890,
      keyboardHeight: 340,
    });
    expect(nextY).toBe(718); // 400 + (850 - 532)
  });

  it('returns null when the form is already comfortably visible above the keyboard', () => {
    const nextY = computeScrollTargetAboveKeyboard({
      currentScrollY: 0,
      scrollViewTop: 48,
      nodeTop: 220,
      nodeHeight: 120,
      windowHeight: 890,
      keyboardHeight: 340,
    });
    expect(nextY).toBeNull();
  });

  it('clamps scroll so the top of a tall form is never pushed above the ScrollView top', () => {
    const nextY = computeScrollTargetAboveKeyboard({
      currentScrollY: 50,
      scrollViewTop: 48,
      nodeTop: 120,
      nodeHeight: 500, // taller than visible area above keyboard
      windowHeight: 890,
      keyboardHeight: 340,
    });
    // maxShift = 120 - (48 + 12) = 60 -> 50 + 60 = 110
    expect(nextY).toBe(110);
  });

  it('scrolls back down if the node top is above the visible viewport', () => {
    const nextY = computeScrollTargetAboveKeyboard({
      currentScrollY: 300,
      scrollViewTop: 48,
      nodeTop: 10,
      nodeHeight: 120,
      windowHeight: 890,
      keyboardHeight: 340,
    });
    // visibleTop = 60, nodeTop = 10 -> 300 - 50 = 250
    expect(nextY).toBe(250);
  });

  it('respects a shorter ScrollView bottom (e.g. above bottom tab bar when keyboard is closed)', () => {
    const nextY = computeScrollTargetAboveKeyboard({
      currentScrollY: 0,
      scrollViewTop: 48,
      scrollViewHeight: 740, // scrollBottom = 788, visibleBottom = 770
      nodeTop: 700,
      nodeHeight: 120, // nodeBottom = 820
      windowHeight: 890,
      keyboardHeight: 0,
    });
    expect(nextY).toBe(50);
  });
});
