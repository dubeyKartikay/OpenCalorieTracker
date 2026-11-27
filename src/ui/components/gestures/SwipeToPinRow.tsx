import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../../haptics';
import { colors, fontFace, radius } from '../../tokens';
import { DoopIcon } from '../DoopIcons';
import {
  computeSwipePinOffset,
  computeSwipePinProgress,
  shouldCommitSwipePin,
  SWIPE_PIN_THRESHOLD,
} from './swipePinMath';

export interface SwipeToPinRowProps {
  pinned: boolean;
  disabled?: boolean;
  onTogglePin: () => void;
  onSwipeStart?: () => void;
  onSwipeEnd?: () => void;
  /** Always-visible card header wrapped by the right-swipe pan detector. */
  header: ReactNode;
  /** Optional expanded content below the header; moves with the card without intercepting inner horizontal scrolls. */
  expandedBody?: ReactNode;
  /** Optional style applied to the sliding foreground card (e.g. hold scale). */
  cardStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Optional style on the outer row container. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Right-swipe-to-pin/unpin row modeled after native Mail/Notes swipe actions:
 * sliding the card right uncovers a full-height action underlay that arms with
 * a crisp haptic detent at the threshold and commits on release.
 */
export function SwipeToPinRow({
  pinned,
  disabled = false,
  onTogglePin,
  onSwipeStart,
  onSwipeEnd,
  header,
  expandedBody,
  cardStyle,
  style,
}: SwipeToPinRowProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const translateX = useSharedValue(0);
  const armedSV = useSharedValue(0);
  const iconPop = useSharedValue(1);
  const [armed, setArmed] = useState(false);

  const pinnedRef = useRef(pinned);
  const toggleRef = useRef(onTogglePin);
  const swipeStartRef = useRef(onSwipeStart);
  const swipeEndRef = useRef(onSwipeEnd);
  useLayoutEffect(() => {
    pinnedRef.current = pinned;
    toggleRef.current = onTogglePin;
    swipeStartRef.current = onSwipeStart;
    swipeEndRef.current = onSwipeEnd;
  }, [onSwipeEnd, onSwipeStart, onTogglePin, pinned]);

  const notifySwipeStart = useCallback(() => {
    swipeStartRef.current?.();
  }, []);

  const notifySwipeEnd = useCallback(() => {
    swipeEndRef.current?.();
  }, []);

  const notifyArmedChange = useCallback((nextArmed: boolean) => {
    setArmed(nextArmed);
    if (nextArmed) {
      hapticMedium();
      if (!reducedMotion) {
        iconPop.set(withSequence(
          withTiming(1.22, { duration: 85 }),
          withSpring(1.06, { damping: 16, stiffness: 360 }),
        ));
      }
    } else {
      hapticSelection();
      iconPop.set(reducedMotion ? 1 : withTiming(1, { duration: 100 }));
    }
  }, [iconPop, reducedMotion]);

  const notifyCommit = useCallback(() => {
    if (pinnedRef.current) hapticLight();
    else hapticSuccess();
    toggleRef.current();
  }, []);

  const resetArmedState = useCallback(() => {
    setArmed(false);
    iconPop.set(1);
  }, [iconPop]);

  /* eslint-disable react-hooks/refs */
  const panGesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .maxPointers(1)
    .activeOffsetX(14)
    .failOffsetX(-10)
    .failOffsetY([-12, 12])
    .onStart(() => {
      cancelAnimation(translateX);
      armedSV.set(0);
      runOnJS(notifySwipeStart)();
    })
    .onUpdate(event => {
      const offset = computeSwipePinOffset(event.translationX);
      translateX.set(offset);
      const isArmed = offset >= SWIPE_PIN_THRESHOLD ? 1 : 0;
      if (isArmed !== armedSV.value) {
        armedSV.set(isArmed);
        runOnJS(notifyArmedChange)(isArmed === 1);
      }
    })
    .onEnd(event => {
      const offset = computeSwipePinOffset(event.translationX);
      const commit = shouldCommitSwipePin(offset, event.velocityX);
      armedSV.set(0);
      if (reducedMotion) {
        translateX.set(withTiming(0, { duration: 120 }));
      } else {
        translateX.set(withSpring(0, { damping: 22, stiffness: 320, mass: 0.72 }));
      }
      runOnJS(resetArmedState)();
      if (commit) {
        runOnJS(notifyCommit)();
      }
    })
    .onFinalize(() => {
      if (translateX.value !== 0) {
        translateX.set(reducedMotion ? withTiming(0, { duration: 120 }) : withSpring(0, { damping: 22, stiffness: 320, mass: 0.72 }));
      }
      if (armedSV.value !== 0) {
        armedSV.set(0);
        runOnJS(resetArmedState)();
      }
      runOnJS(notifySwipeEnd)();
    }), [armedSV, disabled, notifyArmedChange, notifyCommit, notifySwipeEnd, notifySwipeStart, reducedMotion, resetArmedState, translateX]);
  /* eslint-enable react-hooks/refs */

  const foregroundStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const underlayStyle = useAnimatedStyle(() => {
    const progress = computeSwipePinProgress(translateX.value);
    return {
      opacity: interpolate(progress, [0, 0.14, 1], [0, 0.85, 1], Extrapolation.CLAMP),
    };
  });

  const badgeStyle = useAnimatedStyle(() => {
    const progress = computeSwipePinProgress(translateX.value);
    const scale = interpolate(progress, [0, 1], [0.84, 1], Extrapolation.CLAMP) * iconPop.value;
    const shiftX = interpolate(progress, [0, 1], [-8, 0], Extrapolation.CLAMP);
    return {
      opacity: interpolate(progress, [0, 0.25, 1], [0, 0.7, 1], Extrapolation.CLAMP),
      transform: [{ translateX: shiftX }, { scale }],
    };
  });

  const actionLabel = pinned ? 'Unpin' : 'Pin';
  const armedFill = pinned ? styles.underlayUnpinArmed : styles.underlayPinArmed;
  const idleFill = pinned ? styles.underlayUnpinIdle : styles.underlayPinIdle;
  const iconColor = armed ? (pinned ? colors.warning : colors.onAccent) : (pinned ? colors.warning : colors.accent);
  const textColor = armed ? (pinned ? colors.warning : colors.onAccent) : (pinned ? colors.warning : colors.accent);

  return (
    <View style={[styles.container, style]}>
      <Animated.View
        pointerEvents="none"
        accessible={false}
        style={[styles.underlay, armed ? armedFill : idleFill, underlayStyle]}
      >
        <Animated.View style={[styles.badge, badgeStyle]}>
          <View style={[styles.iconPill, pinned && styles.iconPillUnpinIdle, armed && (pinned ? styles.iconPillUnpinArmed : styles.iconPillPinArmed)]}>
            <DoopIcon name="pin" size={18} color={iconColor} />
          </View>
          <Text numberOfLines={1} style={[styles.label, { color: textColor }]}>
            {actionLabel}
          </Text>
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.foreground, foregroundStyle]}>
        <Animated.View style={cardStyle}>
          <GestureDetector gesture={panGesture}>
            <View collapsable={false}>{header}</View>
          </GestureDetector>
          {expandedBody}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  underlay: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    right: 0,
    borderRadius: radius.r12,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: 14,
  },
  underlayPinIdle: {
    backgroundColor: 'rgba(122, 162, 247, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(122, 162, 247, 0.34)',
  },
  underlayPinArmed: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  underlayUnpinIdle: {
    backgroundColor: 'rgba(224, 175, 104, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(224, 175, 104, 0.32)',
  },
  underlayUnpinArmed: {
    backgroundColor: 'rgba(224, 175, 104, 0.26)',
    borderWidth: 1.25,
    borderColor: colors.warning,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconPill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 162, 247, 0.14)',
  },
  iconPillPinArmed: {
    backgroundColor: 'rgba(17, 19, 28, 0.18)',
  },
  iconPillUnpinIdle: {
    backgroundColor: 'rgba(224, 175, 104, 0.16)',
  },
  iconPillUnpinArmed: {
    backgroundColor: 'rgba(224, 175, 104, 0.24)',
  },
  label: {
    ...fontFace('bold'),
    fontSize: 13.5,
    letterSpacing: 0.15,
  },
  foreground: {
    backgroundColor: colors.ground,
  },
});
