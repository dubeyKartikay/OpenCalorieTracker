import { createElement } from 'react';
import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { spacing } from './spacing';

/** Tablets and unfolded inner displays share the expanded layout. */
export const EXPANDED_BREAKPOINT = 700;

export interface LayoutClass {
  layout: 'compact' | 'expanded';
  isExpanded: boolean;
  width: number;
  height: number;
}

export function useLayoutClass(): LayoutClass {
  const { width, height } = useWindowDimensions();
  const isExpanded = width >= EXPANDED_BREAKPOINT;
  return { layout: isExpanded ? 'expanded' : 'compact', isExpanded, width, height };
}

export interface TwoPaneProps {
  primary: ReactNode;
  secondary: ReactNode;
  primaryWeight?: number | undefined;
  secondaryWeight?: number | undefined;
  gap?: number | undefined;
}

function validWeight(weight: number): number {
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

export function TwoPane({ primary, secondary, primaryWeight = 1, secondaryWeight = 1, gap = spacing.s16 }: TwoPaneProps) {
  const { isExpanded } = useLayoutClass();
  return createElement(
    View,
    { style: { width: '100%', flexDirection: isExpanded ? 'row' : 'column', alignItems: isExpanded ? 'flex-start' : 'stretch', gap } },
    createElement(View, { style: isExpanded ? { flex: validWeight(primaryWeight), minWidth: 0 } : { width: '100%' } }, primary),
    createElement(View, { style: isExpanded ? { flex: validWeight(secondaryWeight), minWidth: 0 } : { width: '100%' } }, secondary),
  );
}
