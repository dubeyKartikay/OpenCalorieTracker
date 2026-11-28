import { useEffect, useRef } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notifies mounted tab screens whenever the user taps any tab in the bottom bar. */
export function notifyTabBarPress(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Low-level subscription helper for abandoning transient flows on tab-bar taps. */
export function subscribeTabBarPress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Abandons transient UI flows (inline composers, popovers, keypads, multi-select)
 * whenever the user switches tabs or re-taps the current tab — without firing when
 * pushing a child flow screen like Camera or full nutrition details.
 */
export function useAbandonOnTabPress(onAbandon: () => void): void {
  const latestRef = useRef(onAbandon);
  useEffect(() => {
    latestRef.current = onAbandon;
  });
  useEffect(() => subscribeTabBarPress(() => latestRef.current()), []);
}
