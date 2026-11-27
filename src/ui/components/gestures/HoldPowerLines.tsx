import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors } from '../../tokens';
import {
  computePowerLines,
  computePulseProgress,
  type PowerLineGeometry,
  type PowerLineOrigin,
  type PowerLineTarget,
} from './powerLineMath';

const CONDUIT_HEIGHT = 12;
const PULSE_CYCLE_MS = 1050;
const PULSE_OFFSETS = [0, 0.5] as const;

export interface HoldPowerLinesProps {
  /** Only mounts animations while the hold-and-slide overlay is open. */
  visible: boolean;
  /** Origin button center and visual radius in the parent container's coordinates. */
  origin: PowerLineOrigin;
  /** Hold targets in the same coordinate space as `origin`. */
  targets: readonly PowerLineTarget[];
  /** Currently hovered target id (energizes that line and softens others). */
  activeId: string | null;
  /** Open transition progress [0, 1] from `useHoldTargets`. */
  openProgress: SharedValue<number>;
  /** Z-index for placing conduits behind target circles and the center handle. */
  zIndex?: number;
}

function PowerPulse({
  phase,
  offset,
  length,
  energized,
  dimmed,
}: {
  phase: SharedValue<number>;
  offset: number;
  length: number;
  energized: boolean;
  dimmed: boolean;
}) {
  const sparkWidth = Math.max(12, Math.min(26, length * 0.38));

  const pulseStyle = useAnimatedStyle(() => {
    const t = computePulseProgress(phase.value, offset);
    const travelX = -sparkWidth + t * (length + sparkWidth * 0.75);
    const edgeFade = interpolate(
      t,
      [0, 0.14, 0.78, 1],
      [0, 1, 1, 0],
      Extrapolation.CLAMP,
    );
    const peakOpacity = energized ? 1 : dimmed ? 0.25 : 0.88;
    return {
      opacity: edgeFade * peakOpacity,
      transform: [{ translateX: travelX }],
    };
  }, [dimmed, energized, length, offset, sparkWidth]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.spark,
        { width: sparkWidth },
        energized && styles.sparkEnergized,
        pulseStyle,
      ]}
    >
      <View style={[styles.sparkTail, energized && styles.sparkTailEnergized]} />
      <View style={[styles.sparkHead, energized && styles.sparkHeadEnergized]} />
    </Animated.View>
  );
}

function ConduitLine({
  line,
  phase,
  openProgress,
  energized,
  dimmed,
  reducedMotion,
}: {
  line: PowerLineGeometry;
  phase: SharedValue<number>;
  openProgress: SharedValue<number>;
  energized: boolean;
  dimmed: boolean;
  reducedMotion: boolean;
}) {
  const containerStyle = useAnimatedStyle(() => {
    const p = openProgress.value;
    const scaleX = reducedMotion ? 1 : interpolate(p, [0, 1], [0.25, 1], Extrapolation.CLAMP);
    const baseOpacity = energized ? 1 : dimmed ? 0.35 : 0.92;
    return {
      opacity: p * baseOpacity,
      transform: [{ rotate: `${line.angleDeg}deg` }, { scaleX }],
    };
  }, [dimmed, energized, line.angleDeg, reducedMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.conduit,
        {
          left: line.midX - line.length / 2,
          top: line.midY - CONDUIT_HEIGHT / 2,
          width: line.length,
          height: CONDUIT_HEIGHT,
        },
        containerStyle,
      ]}
    >
      <View style={[styles.auraRail, energized && styles.auraRailEnergized]} />
      <View style={[styles.coreRail, energized && styles.coreRailEnergized]} />
      {reducedMotion ? (
        <View style={[styles.staticTip, energized && styles.staticTipEnergized]} />
      ) : (
        PULSE_OFFSETS.map(offset => (
          <PowerPulse
            key={offset}
            phase={phase}
            offset={offset}
            length={line.length}
            energized={energized}
            dimmed={dimmed}
          />
        ))
      )}
    </Animated.View>
  );
}

function ActivePowerLines({
  origin,
  targets,
  activeId,
  openProgress,
  zIndex,
}: Omit<HoldPowerLinesProps, 'visible'>) {
  const reducedMotion = Boolean(useReducedMotion());
  const phase = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(phase);
      phase.set(0);
      return;
    }
    phase.set(0);
    phase.set(withRepeat(withTiming(1, { duration: PULSE_CYCLE_MS, easing: Easing.linear }), -1, false));
    return () => {
      cancelAnimation(phase);
    };
  }, [phase, reducedMotion]);

  const lines = useMemo(
    () => computePowerLines(origin, targets),
    [origin, targets],
  );

  if (lines.length === 0) return null;

  const hasActive = activeId !== null;

  return (
    <View pointerEvents="none" style={[styles.layer, { zIndex }]}>
      {lines.map(line => (
        <ConduitLine
          key={line.id}
          line={line}
          phase={phase}
          openProgress={openProgress}
          energized={activeId === line.id}
          dimmed={hasActive && activeId !== line.id}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
}

/**
 * Animated radial energy conduits flowing outward from a hold-and-slide `+`
 * button into every available hold target, indicating that the user can slide
 * directly to any option. Mounts zero animations when closed.
 */
export function HoldPowerLines({
  visible,
  origin,
  targets,
  activeId,
  openProgress,
  zIndex = 8,
}: HoldPowerLinesProps) {
  if (!visible) return null;
  return (
    <ActivePowerLines
      origin={origin}
      targets={targets}
      activeId={activeId}
      openProgress={openProgress}
      zIndex={zIndex}
    />
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    overflow: 'visible',
  },
  conduit: {
    position: 'absolute',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  auraRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(122, 162, 247, 0.14)',
  },
  auraRailEnergized: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(122, 162, 247, 0.36)',
  },
  coreRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(122, 162, 247, 0.42)',
  },
  coreRailEnergized: {
    height: 2.5,
    backgroundColor: colors.accent,
  },
  spark: {
    position: 'absolute',
    left: 0,
    height: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sparkEnergized: {
    height: 7,
  },
  sparkTail: {
    flex: 1,
    height: 2.5,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    backgroundColor: colors.accent,
    opacity: 0.9,
  },
  sparkTailEnergized: {
    height: 3.25,
    opacity: 1,
  },
  sparkHead: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginLeft: -2,
    backgroundColor: colors.ink,
  },
  sparkHeadEnergized: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.ink,
  },
  staticTip: {
    position: 'absolute',
    right: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  staticTipEnergized: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.ink,
  },
});
