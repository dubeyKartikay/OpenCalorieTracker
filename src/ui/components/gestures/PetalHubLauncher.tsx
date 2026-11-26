import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, fontFace } from '../../tokens';
import { DoopIcon, inferFoodGlyph } from '../DoopIcons';
import { findActiveTarget } from './hitTest';
import type { DeadZone, GestureTarget, Point } from './hitTest';

export type CaptureAction = 'search' | 'camera' | 'voice';
export interface HubSuggestion { id: string; label: string; subtitle?: string }
export interface PetalHubLauncherProps {
  suggestions: HubSuggestion[];
  onTapAddMeal: () => void;
  onSelectCapture: (action: CaptureAction) => void;
  onCommitSuggestion: (suggestion: HubSuggestion) => void;
  onOpenChange?: (open: boolean) => void;
}

/** Shared internally with MealHoldFan; callbacks remain fresh without rebuilding a live pan. */
export function useHoldTargets(onSelect: (id: string) => void, targetIds: string[]) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const nodes = useRef(new Map<string, ComponentRef<typeof View>>());
  const targets = useRef(new Map<string, GestureTarget<string>>());
  const origin = useRef<ComponentRef<typeof View> | null>(null);
  const deadZone = useRef<DeadZone | undefined>(undefined);
  const session = useRef(0);
  const holding = useRef(false);
  const mounted = useRef(true);
  const currentActive = useRef<string | null>(null);
  const lastPoint = useRef<Point | null>(null);
  const suppressUntil = useRef(0);
  const select = useRef(onSelect);
  useLayoutEffect(() => { select.current = onSelect; }, [onSelect]);
  const progress = useSharedValue(0);
  const charge = useSharedValue(0);
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; session.current += 1; };
  }, []);

  const update = useCallback((x: number, y: number) => {
    if (!holding.current) return;
    lastPoint.current = { x, y };
    const id = findActiveTarget({ x, y }, [...targets.current.values()], deadZone.current, 6)?.id ?? null;
    if (currentActive.current !== id) {
      currentActive.current = id;
      setActiveId(id);
      if (id) void Haptics.selectionAsync().catch(() => {});
    }
  }, []);

  const measure = useCallback(() => {
    const generation = session.current;
    origin.current?.measureInWindow((x, y, width, height) => {
      if (!mounted.current || generation !== session.current) return;
      deadZone.current = { cx: x + width / 2, cy: y + height / 2, radius: Math.min(width, height) / 2 };
      if (lastPoint.current) update(lastPoint.current.x, lastPoint.current.y);
    });
    nodes.current.forEach((node, id) => {
      node.measureInWindow((x, y, width, height) => {
        if (!mounted.current || generation !== session.current || width <= 0 || height <= 0) return;
        targets.current.set(id, { id, kind: id, rect: { x, y, width, height } });
        if (lastPoint.current) update(lastPoint.current.x, lastPoint.current.y);
      });
    });
  }, [update]);

  // Measure again at the final animated position, including a scroll or layout change.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(measure, 160);
    return () => clearTimeout(timer);
  }, [open, measure]);

  const beginCharge = useCallback(() => {
    charge.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) }));
    buttonScale.set(withTiming(0.94, { duration: 180 }));
  }, [charge, buttonScale]);

  const endCharge = useCallback(() => {
    if (!holding.current) {
      charge.set(withTiming(0, { duration: 120 }));
      buttonScale.set(withTiming(1, { duration: 120 }));
    }
  }, [charge, buttonScale]);

  const show = useCallback(() => {
    session.current += 1;
    targets.current.clear();
    deadZone.current = undefined;
    lastPoint.current = null;
    holding.current = true;
    suppressUntil.current = Infinity;
    currentActive.current = null;
    setActiveId(null);
    setOpen(true);
    charge.set(0);
    progress.set(withTiming(1, { duration: 170, easing: Easing.out(Easing.cubic) }));
    // Clear expanding pulse ring + crisp button snap signaling hold-and-swipe activation.
    pulseScale.set(0.95);
    pulseOpacity.set(0.85);
    pulseScale.set(withTiming(1.55, { duration: 320, easing: Easing.out(Easing.cubic) }));
    pulseOpacity.set(withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) }));
    buttonScale.set(withSequence(withTiming(1.06, { duration: 110 }), withTiming(1, { duration: 130 })));
    measure();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [measure, progress, charge, pulseScale, pulseOpacity, buttonScale]);

  const close = useCallback(() => {
    charge.set(withTiming(0, { duration: 100 }));
    buttonScale.set(withTiming(1, { duration: 120 }));
    if (!holding.current) return;
    holding.current = false;
    session.current += 1;
    suppressUntil.current = Date.now() + 350;
    setOpen(false);
    setActiveId(null);
    currentActive.current = null;
    progress.set(withTiming(0, { duration: 120 }));
  }, [progress, charge, buttonScale]);

  const finish = useCallback((x: number, y: number, success: boolean) => {
    if (!holding.current) return;
    const id = success
      ? findActiveTarget({ x, y }, [...targets.current.values()], deadZone.current, 6)?.id
      : undefined;
    close();
    if (id) select.current(id);
  }, [close]);

  // RNGH stores these callbacks for future gesture events; none run during render.
  /* eslint-disable react-hooks/refs */
  // A zero distance activates immediately on web. Let only the long-press timer open it.
  const gesture = useMemo(() => Gesture.Pan().activateAfterLongPress(260).minDistance(10_000)
    .maxPointers(1).shouldCancelWhenOutside(false)
    .onBegin(() => { runOnJS(beginCharge)(); })
    .onStart(() => { runOnJS(show)(); })
    .onUpdate(event => { runOnJS(update)(event.absoluteX, event.absoluteY); })
    .onEnd((event, success) => { runOnJS(finish)(event.absoluteX, event.absoluteY, success); })
    .onFinalize(() => { runOnJS(endCharge)(); runOnJS(close)(); }), [beginCharge, endCharge, show, update, finish, close]);
  /* eslint-enable react-hooks/refs */

  const overlayStyle = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.82 + progress.value * 0.18 }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const chargeStyle = useAnimatedStyle(() => ({ opacity: charge.value * 0.9, transform: [{ scale: 1.12 - charge.value * 0.08 }] }));
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulseOpacity.value, transform: [{ scale: pulseScale.value }] }));
  const handleAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: buttonScale.value }] }));

  const targetKey = JSON.stringify(targetIds);
  const targetRefs = useMemo(() => {
    const ids: string[] = JSON.parse(targetKey);
    return Object.fromEntries(ids.map(id => [id, (node: ComponentRef<typeof View> | null) => {
        if (node) nodes.current.set(id, node);
        else { nodes.current.delete(id); targets.current.delete(id); }
      }]));
  }, [targetKey]);
  const bindTarget = (id: string) => targetRefs[id];
  const tap = (action: () => void) => {
    if (holding.current || Date.now() < suppressUntil.current) return;
    action();
  };
  const choose = (id: string) => {
    // Explicit overlay taps also support an accessibility-opened fan.
    if (!holding.current) return;
    close();
    select.current(id);
  };
  return { open, activeId, origin, gesture, overlayStyle, scrimStyle, chargeStyle, pulseStyle, handleAnimStyle, bindTarget, measure, show, close, tap, choose };
}

const captures = [
  { action: 'camera', label: 'Camera', glyph: 'camera', x: -60, y: 34 },
  { action: 'search', label: 'Search', glyph: 'search', x: 0, y: 5 },
  { action: 'voice', label: 'Voice', glyph: 'mic', x: 60, y: 34 },
] as const;

export function PetalHubLauncher({ suggestions, onTapAddMeal, onSelectCapture, onCommitSuggestion, onOpenChange }: PetalHubLauncherProps) {
  const picks = suggestions.slice(0, 3);
  const {
    open, activeId, origin: originRef, gesture, overlayStyle, scrimStyle, chargeStyle, pulseStyle, handleAnimStyle,
    bindTarget, measure, show, close, tap, choose,
  } = useHoldTargets(id => {
    const capture = captures.find(item => `capture:${item.action}` === id);
    if (capture) onSelectCapture(capture.action);
    else {
      const suggestion = picks.find(item => `suggestion:${item.id}` === id);
      if (suggestion) onCommitSuggestion(suggestion);
    }
  }, [...captures.map(item => `capture:${item.action}`), ...picks.map(item => `suggestion:${item.id}`)]);

  const openChanged = useRef(onOpenChange);
  useLayoutEffect(() => { openChanged.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => { openChanged.current?.(open); }, [open]);

  return <View style={[styles.hub, open && styles.hubOpen]} onLayout={measure}>
    {/* Darken all non-swipable screen chrome behind the active hub & swipable targets */}
    {open && <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />}
    <Svg pointerEvents="none" width={208} height={208} viewBox="0 0 208 208" style={styles.orbits}>
      <Circle cx={104} cy={104} r={62} fill="none" stroke={open ? colors.border : colors.hairline} strokeWidth={1} strokeDasharray="1.5 5.5" />
      <Circle cx={104} cy={104} r={96} fill="none" stroke={colors.hairline} strokeWidth={1} strokeDasharray="1 6" />
    </Svg>
    {open && <Animated.View pointerEvents="box-none" style={[styles.captureArc, overlayStyle]}>
      {captures.map(({ action, label, glyph, x, y }) => {
        const id = `capture:${action}`;
        const active = activeId === id;
        return <View key={id} style={[styles.captureSlot, { left: x, top: y }]}>
          <View ref={bindTarget(id)} collapsable={false} onLayout={measure}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Add meal using ${label.toLowerCase()}`}
              accessibilityState={{ selected: active }} onPress={() => choose(id)} style={[styles.capture, active && styles.selected]}>
              <DoopIcon name={glyph} size={20} color={active ? colors.onAccent : colors.ink} />
            </Pressable>
          </View>
        </View>;
      })}
    </Animated.View>}
    <GestureDetector gesture={gesture}>
      <Animated.View ref={originRef} collapsable={false} style={[styles.handleWrap, handleAnimStyle]}>
        {/* Quiet tap+hold visual language: outer segmented arc + 3 orbital beads telegraphing fan targets */}
        {!open && <Svg pointerEvents="none" width={108} height={108} viewBox="0 0 108 108" style={styles.affordanceRing}>
          <Path d="M 16 26 A 48 48 0 0 1 92 26" fill="none" stroke={colors.accent} strokeWidth={1.4} strokeOpacity={0.48} strokeLinecap="round" strokeDasharray="3 5" />
          <Circle cx={20} cy={22} r={2} fill={colors.accent} fillOpacity={0.75} />
          <Circle cx={54} cy={6} r={2.2} fill={colors.accent} fillOpacity={0.85} />
          <Circle cx={88} cy={22} r={2} fill={colors.accent} fillOpacity={0.75} />
          <Path d="M 24 92 A 48 48 0 0 0 84 92" fill="none" stroke={colors.accent} strokeWidth={1.2} strokeOpacity={0.32} strokeLinecap="round" strokeDasharray="2 6" />
        </Svg>}
        {/* Press-down charging ring before threshold triggers */}
        <Animated.View pointerEvents="none" style={[styles.chargeRing, chargeStyle]} />
        {/* Expanding transition pulse ring when entering hold-and-swipe state */}
        <Animated.View pointerEvents="none" style={[styles.pulseRing, pulseStyle]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Add meal" accessibilityHint="Tap to search, or hold and slide to choose"
          accessibilityActions={[{ name: 'activate', label: 'Add meal' }, { name: 'longpress', label: 'Show capture options' }]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') show(); else if (event.nativeEvent.actionName === 'activate') tap(onTapAddMeal); }}
          onAccessibilityEscape={close} onPress={() => tap(onTapAddMeal)} style={[styles.handle, open && styles.handleOpen]}>
          <View style={open ? styles.handleIconOpen : undefined}>
            <DoopIcon name="plus" size={22} color={open ? colors.accent : colors.onAccent} />
          </View>
          {!open && <Text style={styles.handleLabel}>Add meal</Text>}
        </Pressable>
      </Animated.View>
    </GestureDetector>
    <View style={styles.picks}>
      {picks.map((suggestion, index) => {
        const id = `suggestion:${suggestion.id}`;
        const active = activeId === id;
        return <View key={suggestion.id} ref={bindTarget(id)} collapsable={false} onLayout={measure} style={[styles.pickSlot, index === 0 ? styles.pickLeft : index === 1 ? styles.pickRight : styles.pickBottom]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Log ${suggestion.label}${suggestion.subtitle ? `, ${suggestion.subtitle}` : ''}`}
            accessibilityState={{ selected: active }} onPress={() => open ? choose(id) : tap(() => onCommitSuggestion(suggestion))}
            style={styles.pick}>
            <View style={[styles.pickWell, open && styles.pickWellEligible, active && styles.selected]}>
              <DoopIcon name={inferFoodGlyph(suggestion.label)} size={20} color={active ? colors.onAccent : colors.ink} />
            </View>
            <Text numberOfLines={1} style={[styles.pickLabel, open && styles.pickLabelEligible]}>{suggestion.label}</Text>
          </Pressable>
        </View>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  hub: { height: 222, marginTop: 14, overflow: 'visible', zIndex: 10 },
  hubOpen: { zIndex: 120, elevation: 24 },
  scrim: { position: 'absolute', left: -3000, right: -3000, top: -3000, bottom: -3000, backgroundColor: 'rgba(10,11,18,0.78)', zIndex: 1 },
  orbits: { position: 'absolute', left: '50%', marginLeft: -104, top: 0, zIndex: 2 },
  handleWrap: { position: 'absolute', left: '50%', marginLeft: -44, top: 60, width: 88, height: 88, zIndex: 12, alignItems: 'center', justifyContent: 'center' },
  affordanceRing: { position: 'absolute', left: -10, top: -10 },
  chargeRing: { position: 'absolute', width: 98, height: 98, borderRadius: 49, borderWidth: 2, borderColor: colors.accent },
  pulseRing: { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 2.5, borderColor: colors.accent },
  handle: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', gap: 3 },
  handleOpen: { backgroundColor: colors.raised, borderColor: colors.accent },
  handleIconOpen: { transform: [{ rotate: '45deg' }] },
  handleLabel: { ...fontFace('bold'), color: colors.onAccent, fontSize: 12.5, letterSpacing: 0.1 },
  captureArc: { position: 'absolute', left: '50%', top: 0, zIndex: 20, elevation: 20 },
  captureSlot: { position: 'absolute', width: 46, height: 46, marginLeft: -23, alignItems: 'center', justifyContent: 'center' },
  capture: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surface, borderWidth: 1.25, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  picks: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10 },
  pickSlot: { position: 'absolute', width: '32%', height: 64 },
  pickLeft: { left: 0, top: 72 },
  pickRight: { right: 0, top: 72 },
  pickBottom: { left: '34%', top: 158 },
  pick: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  pickWell: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(192,202,245,0.10)', alignItems: 'center', justifyContent: 'center' },
  pickWellEligible: { backgroundColor: colors.surface, borderColor: 'rgba(122,162,247,0.58)', borderWidth: 1.25 },
  pickLabel: { ...fontFace('semibold'), color: colors.ink, fontSize: 11, lineHeight: 14, textAlign: 'center', width: '100%' },
  pickLabelEligible: { color: colors.ink },
  selected: { borderColor: colors.accent, backgroundColor: colors.accent, transform: [{ scale: 1.08 }] },
});
