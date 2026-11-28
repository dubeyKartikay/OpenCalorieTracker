import { describe, expect, it, vi } from 'vitest';
import { notifyTabBarPress, subscribeTabBarPress } from '../tabAbandon';

describe('tabAbandon', () => {
  it('notifies all active subscribers on tab-bar press and unsubscribes cleanly', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribeTabBarPress(first);
    const offSecond = subscribeTabBarPress(second);

    notifyTabBarPress();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
    notifyTabBarPress();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    offSecond();
    notifyTabBarPress();
    expect(second).toHaveBeenCalledTimes(2);
  });
});
