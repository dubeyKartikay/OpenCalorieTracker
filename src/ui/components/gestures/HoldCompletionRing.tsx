import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../../tokens';
import { clampHoldProgress, HOLD_RING_RESET_MS } from './holdRingMath';

export interface UseHoldRingOptions {
  /** Hold threshold in ms for linear 0 -> 1 completion sweep. */
  holdMs: number;
  /** When false, ring stays idle and resets immediately. */
  enabled?: boolean;
}

export interface HoldRingControl {
  progress: SharedValue<number>;
  enabled: boolean;
  reducedMotion: boolean;
  /** Subtle button settle while holding (1 -> 0.94 -> 1). */
  pressScaleStyle: ReturnType<typeof useAnimatedStyle>;
  startWorklet: () => void;
  resetWorklet: () => void;
  clearWorklet: () => void;
  clear: () => void;
}

export function useHoldRing({ holdMs, enabled = true }: UseHoldRingOptions): HoldRingControl {
  const reducedMotion = Boolean(useReducedMotion());
  const progress = useSharedValue(0);
  const scale = useSharedValue(1);
  const safeHoldMs = Math.max(1, holdMs);

  const startWorklet = useCallback(() => {
    'worklet';
    if (!enabled) return;
    cancelAnimation(progress);
    cancelAnimation(scale);
    progress.set(0);
    if (reducedMotion) {
      progress.set(withTiming(1, { duration: 120 }));
      return;
    }
    progress.set(withTiming(1, { duration: safeHoldMs, easing: Easing.linear }));
    scale.set(withTiming(0.94, { duration: Math.min(180, safeHoldMs), easing: Easing.out(Easing.quad) }));
  }, [enabled, progress, reducedMotion, safeHoldMs, scale]);

  const resetWorklet = useCallback(() => {
    'worklet';
    cancelAnimation(progress);
    cancelAnimation(scale);
    if (reducedMotion || progress.value === 0) {
      progress.set(0);
      scale.set(1);
      return;
    }
    progress.set(withTiming(0, { duration: HOLD_RING_RESET_MS, easing: Easing.out(Easing.quad) }));
    scale.set(withTiming(1, { duration: HOLD_RING_RESET_MS, easing: Easing.out(Easing.quad) }));
  }, [progress, reducedMotion, scale]);

  const clearWorklet = useCallback(() => {
    'worklet';
    cancelAnimation(progress);
    cancelAnimation(scale);
    progress.set(0);
    scale.set(1);
  }, [progress, scale]);

  const clear = useCallback(() => {
    cancelAnimation(progress);
    cancelAnimation(scale);
    progress.set(0);
    scale.set(1);
  }, [progress, scale]);

  useEffect(() => {
    if (!enabled) {
      cancelAnimation(progress);
      cancelAnimation(scale);
      progress.set(0);
      scale.set(1);
    }
  }, [enabled, progress, scale]);

  const pressScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reducedMotion ? 1 : scale.value }],
  }), [reducedMotion]);

  return {
    progress,
    enabled,
    reducedMotion,
    pressScaleStyle,
    startWorklet,
    resetWorklet,
    clearWorklet,
    clear,
  };
}

export interface HoldCompletionRingProps {
  /** Progress shared value [0, 1] from `useHoldRing`. */
  progress: SharedValue<number>;
  /** Outer diameter of the ring (even integer recommended). */
  size: number;
  /** Stroke thickness of the active sweeping arc. */
  strokeWidth?: number;
  /** Active arc stroke color (defaults to `colors.accent`). */
  color?: string;
  /** Opacity of the quiet at-rest circular track. */
  trackOpacity?: number;
  /** Stroke width of the quiet at-rest track. */
  trackStrokeWidth?: number;
  /** Hide the ring completely when hold is inactive (e.g. open, undo, logged). */
  visible?: boolean;
}

interface RingVariantProps {
  progress: SharedValue<number>;
  size: number;
  strokeWidth: number;
  color: string;
  trackOpacity: number;
  trackStrokeWidth: number;
}

function ReducedHoldRing({
  progress,
  size,
  strokeWidth,
  color,
  trackOpacity,
  trackStrokeWidth,
}: RingVariantProps) {
  const half = size / 2;
  const trackRadius = half - strokeWidth / 2;
  const reducedRingStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  return (
    <View pointerEvents="none" style={[styles.ring, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={styles.trackSvg}>
        <Circle
          cx={half}
          cy={half}
          r={trackRadius}
          fill="none"
          stroke={color}
          strokeWidth={trackStrokeWidth}
          strokeOpacity={trackOpacity}
        />
      </Svg>
      <Animated.View
        style={[
          styles.reducedRing,
          {
            width: size,
            height: size,
            borderRadius: half,
            borderWidth: strokeWidth,
            borderColor: color,
          },
          reducedRingStyle,
        ]}
      />
    </View>
  );
}

function SweepHoldRing({
  progress,
  size,
  strokeWidth,
  color,
  trackOpacity,
  trackStrokeWidth,
}: RingVariantProps) {
  const half = size / 2;
  const trackRadius = half - strokeWidth / 2;
  const clamped = useDerivedValue(() => clampHoldProgress(progress.value));

  const rightArcStyle = useAnimatedStyle(() => {
    const p = clamped.value;
    const deg = -135 + (p < 0.5 ? p : 0.5) * 360;
    return {
      opacity: p > 0.01 ? 1 : 0,
      transform: [{ rotate: `${deg}deg` }],
    };
  });

  const leftArcStyle = useAnimatedStyle(() => {
    const p = clamped.value;
    const deg = -135 + (p > 0.5 ? p - 0.5 : 0) * 360;
    return {
      opacity: p > 0.5 ? 1 : 0,
      transform: [{ rotate: `${deg}deg` }],
    };
  });

  const startCapStyle = useAnimatedStyle(() => ({
    opacity: clamped.value > 0.01 ? 1 : 0,
  }));

  const tipCapStyle = useAnimatedStyle(() => {
    const p = clamped.value;
    return {
      opacity: p > 0.01 ? 1 : 0,
      transform: [{ rotate: `${p * 360}deg` }],
    };
  });

  return (
    <View pointerEvents="none" style={[styles.ring, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={styles.trackSvg}>
        <Circle
          cx={half}
          cy={half}
          r={trackRadius}
          fill="none"
          stroke={color}
          strokeWidth={trackStrokeWidth}
          strokeOpacity={trackOpacity}
        />
      </Svg>
      <View style={[styles.halfClip, { right: 0, width: half, height: size }]}>
        <Animated.View
          style={[
            styles.arcCircle,
            {
              right: 0,
              width: size,
              height: size,
              borderRadius: half,
              borderWidth: strokeWidth,
              borderTopColor: color,
              borderRightColor: color,
              borderBottomColor: 'transparent',
              borderLeftColor: 'transparent',
            },
            rightArcStyle,
          ]}
        />
      </View>
      <View style={[styles.halfClip, { left: 0, width: half, height: size }]}>
        <Animated.View
          style={[
            styles.arcCircle,
            {
              left: 0,
              width: size,
              height: size,
              borderRadius: half,
              borderWidth: strokeWidth,
              borderBottomColor: color,
              borderLeftColor: color,
              borderTopColor: 'transparent',
              borderRightColor: 'transparent',
            },
            leftArcStyle,
          ]}
        />
      </View>
      <Animated.View
        style={[
          styles.capDot,
          {
            top: 0,
            left: half - strokeWidth / 2,
            width: strokeWidth,
            height: strokeWidth,
            borderRadius: strokeWidth / 2,
            backgroundColor: color,
          },
          startCapStyle,
        ]}
      />
      <Animated.View style={[styles.tipSpinner, { width: size, height: size }, tipCapStyle]}>
        <View
          style={[
            styles.capDot,
            {
              top: 0,
              left: half - strokeWidth / 2,
              width: strokeWidth,
              height: strokeWidth,
              borderRadius: strokeWidth / 2,
              backgroundColor: color,
            },
          ]}
        />
      </Animated.View>
    </View>
  );
}

/**
 * Circular hold-completion ring drawn around circular `+` buttons.
 *
 * Only mounts animated hooks when `visible` is true, and mounts only the active
 * motion variant (reduced-motion fade vs full clockwise sweep).
 */
export function HoldCompletionRing({
  progress,
  size,
  strokeWidth = 2.25,
  color = colors.accent,
  trackOpacity = 0.24,
  trackStrokeWidth = 1.25,
  visible = true,
}: HoldCompletionRingProps) {
  const reducedMotion = Boolean(useReducedMotion());
  if (!visible) return null;
  const sharedProps: RingVariantProps = {
    progress,
    size,
    strokeWidth,
    color,
    trackOpacity,
    trackStrokeWidth,
  };
  return reducedMotion ? <ReducedHoldRing {...sharedProps} /> : <SweepHoldRing {...sharedProps} />;
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackSvg: {
    position: 'absolute',
  },
  reducedRing: {
    position: 'absolute',
  },
  halfClip: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
  arcCircle: {
    position: 'absolute',
    top: 0,
  },
  capDot: {
    position: 'absolute',
  },
  tipSpinner: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
