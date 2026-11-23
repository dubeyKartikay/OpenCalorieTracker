import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, fontFamily, fontSize, fontWeight, radius, spacing } from '../../tokens';
import { findActiveTarget } from './hitTest';
import type { DeadZone, GestureTarget, Point } from './hitTest';

export type CaptureAction = 'search' | 'camera' | 'voice';
export interface HubSuggestion { id: string; label: string; subtitle?: string }
export interface PetalHubLauncherProps {
  suggestions: HubSuggestion[];
  onTapAddMeal: () => void;
  onSelectCapture: (action: CaptureAction) => void;
  onCommitSuggestion: (suggestion: HubSuggestion) => void;
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
    progress.set(withTiming(1, { duration: 140 }));
    measure();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [measure, progress]);

  const close = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    session.current += 1;
    suppressUntil.current = Date.now() + 350;
    setOpen(false);
    setActiveId(null);
    currentActive.current = null;
    progress.set(withTiming(0, { duration: 100 }));
  }, [progress]);

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
    .onStart(() => { runOnJS(show)(); })
    .onUpdate(event => { runOnJS(update)(event.absoluteX, event.absoluteY); })
    .onEnd((event, success) => { runOnJS(finish)(event.absoluteX, event.absoluteY, success); })
    .onFinalize(() => { runOnJS(close)(); }), [show, update, finish, close]);
  /* eslint-enable react-hooks/refs */

  const overlayStyle = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.94 + progress.value * 0.06 }] }));
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
  return { open, activeId, origin, gesture, overlayStyle, bindTarget, measure, show, close, tap, choose };
}

const captures: { action: CaptureAction; label: string; glyph: string }[] = [
  { action: 'camera', label: 'Camera', glyph: '▣' },
  { action: 'search', label: 'Search', glyph: '⌕' },
  { action: 'voice', label: 'Voice', glyph: '♩' },
];

export function PetalHubLauncher({ suggestions, onTapAddMeal, onSelectCapture, onCommitSuggestion }: PetalHubLauncherProps) {
  const picks = suggestions.slice(0, 3);
  const { open, activeId, origin: originRef, gesture, overlayStyle, bindTarget, measure, show, close, tap, choose } = useHoldTargets(id => {
    const capture = captures.find(item => `capture:${item.action}` === id);
    if (capture) onSelectCapture(capture.action);
    else {
      const suggestion = picks.find(item => `suggestion:${item.id}` === id);
      if (suggestion) onCommitSuggestion(suggestion);
    }
  }, [...captures.map(item => `capture:${item.action}`), ...picks.map(item => `suggestion:${item.id}`)]);

  return <View style={styles.hub} onLayout={measure}>
    {open && <Animated.View pointerEvents="box-none" style={[styles.captureArc, overlayStyle]}>
      {captures.map(({ action, label, glyph }, index) => {
        const id = `capture:${action}`;
        const active = activeId === id;
        return <View key={id} style={[styles.captureSlot, index === 1 && styles.topCapture]}>
          <View ref={bindTarget(id)} collapsable={false} onLayout={measure}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Add meal using ${label.toLowerCase()}`}
              accessibilityState={{ selected: active }} onPress={() => choose(id)} style={[styles.capture, active && styles.selected]}>
              <Text accessible={false} style={[styles.captureGlyph, active && styles.accentText]}>{glyph}</Text>
            </Pressable>
          </View>
          <Text style={styles.captureLabel}>{label}</Text>
        </View>;
      })}
    </Animated.View>}
    <GestureDetector gesture={gesture}>
      <Animated.View ref={originRef} collapsable={false} style={styles.handleWrap}>
        <Pressable accessibilityRole="button" accessibilityLabel="Add meal" accessibilityHint="Tap to search, or hold and slide to choose"
          accessibilityActions={[{ name: 'activate', label: 'Add meal' }, { name: 'longpress', label: 'Show capture options' }]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') show(); else if (event.nativeEvent.actionName === 'activate') tap(onTapAddMeal); }}
          onAccessibilityEscape={close} onPress={() => tap(onTapAddMeal)} style={styles.handle}>
          <Text accessible={false} style={styles.plus}>+</Text><Text style={styles.handleLabel}>Add meal</Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
    <View style={styles.picks}>
      {picks.map(suggestion => {
        const id = `suggestion:${suggestion.id}`;
        const active = activeId === id;
        return <View key={suggestion.id} ref={bindTarget(id)} collapsable={false} onLayout={measure} style={styles.pickSlot}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Log ${suggestion.label}${suggestion.subtitle ? `, ${suggestion.subtitle}` : ''}`}
            accessibilityState={{ selected: active }} onPress={() => open ? choose(id) : tap(() => onCommitSuggestion(suggestion))}
            style={[styles.pick, active && styles.selected]}>
            <Text numberOfLines={2} style={[styles.pickLabel, active && styles.accentText]}>{suggestion.label}</Text>
            {suggestion.subtitle && <Text numberOfLines={1} style={styles.subtitle}>{suggestion.subtitle}</Text>}
          </Pressable>
        </View>;
      })}
    </View>
    {open && <Pressable accessibilityRole="button" accessibilityLabel="Cancel meal selection" onPress={close} style={styles.cancel}>
      <Text style={styles.subtitle}>Cancel</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  hub: { alignItems: 'center', paddingTop: spacing.s8, gap: spacing.s12, overflow: 'visible', zIndex: 10 },
  handleWrap: { width: spacing.s80, height: spacing.s80 },
  handle: { width: spacing.s80, height: spacing.s80, borderRadius: radius.full, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  plus: { color: colors.onAccent, fontSize: fontSize.t40, lineHeight: 44 },
  handleLabel: { color: colors.onAccent, fontFamily: fontFamily.body, fontSize: fontSize.t12, fontWeight: fontWeight.bold },
  captureArc: { position: 'absolute', top: -spacing.s96, width: 256, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', overflow: 'visible', zIndex: 20, elevation: 20 },
  captureSlot: { width: spacing.s72, alignItems: 'center', gap: spacing.s6, marginTop: spacing.s32 },
  topCapture: { marginTop: 0 },
  capture: { width: spacing.s56, height: spacing.s56, borderRadius: radius.full, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  captureGlyph: { color: colors.ink, fontSize: fontSize.t24 },
  captureLabel: { color: colors.muted, fontFamily: fontFamily.body, fontSize: fontSize.t11 },
  picks: { flexDirection: 'row', gap: spacing.s8, width: '100%' },
  pickSlot: { flex: 1, minWidth: 0 },
  pick: { minHeight: spacing.s72, height: '100%', padding: spacing.s10, justifyContent: 'center', gap: spacing.s4, backgroundColor: colors.raised, borderRadius: radius.r16, borderWidth: 1, borderColor: colors.border },
  pickLabel: { color: colors.ink, fontFamily: fontFamily.body, fontSize: fontSize.t12, fontWeight: fontWeight.semibold },
  subtitle: { color: colors.muted, fontFamily: fontFamily.body, fontSize: fontSize.t11 },
  selected: { borderColor: colors.accent, backgroundColor: colors.surface, transform: [{ scale: 1.04 }] },
  accentText: { color: colors.accent },
  cancel: { position: 'absolute', right: 0, top: 0, minWidth: spacing.s44, minHeight: spacing.s44, alignItems: 'center', justifyContent: 'center' },
});
