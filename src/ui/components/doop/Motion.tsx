import { useEffect, useState, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export interface RevealPanelProps {
  visible: boolean;
  /** Direction the panel eases in from ('down' enters from slightly above, 'up' from slightly below). */
  direction?: 'down' | 'up';
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * UI-thread Reanimated open/close wrapper that keeps children mounted through
 * exit so inline panels, keypads, and bars close as smoothly as they open.
 */
export function RevealPanel({ visible, direction = 'down', style, children }: RevealPanelProps) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);

  if (visible && !mounted) {
    setMounted(true);
  } else if (!visible && mounted && reducedMotion) {
    setMounted(false);
  }

  useEffect(() => {
    if (visible) {
      if (reducedMotion) {
        progress.set(1);
      } else {
        progress.set(withSpring(1, { damping: 24, stiffness: 320, mass: 0.78 }));
      }
      return;
    }

    if (!mounted) return;
    if (reducedMotion) {
      progress.set(0);
      return;
    }
    progress.set(
      withTiming(
        0,
        { duration: 145, easing: Easing.out(Easing.cubic) },
        finished => {
          if (finished) scheduleOnRN(setMounted, false);
        },
      ),
    );
  }, [mounted, progress, reducedMotion, visible]);

  const offset = direction === 'down' ? -8 : 10;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.7, 1], [0, 0.94, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [offset, 0], Extrapolation.CLAMP) },
      { scale: interpolate(progress.value, [0, 1], [0.985, 1], Extrapolation.CLAMP) },
    ],
  }));

  if (!mounted) return null;
  return (
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
