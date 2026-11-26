import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { energyValue, number } from '../../format';
import { colors, fontFace, spacing, tabularNums } from '../../tokens';
import { findActiveTarget, SERVING_STOPS, snapServingStop } from './hitTest';
import type { GestureTarget, ScreenRect, ServingMultiplier } from './hitTest';

import { DoopIcon, inferFoodGlyph, mealDaypartGlyph } from '../DoopIcons';

export type LogMeal = string;
export interface HoldToLogGestureControl {
  start: (x: number, y: number) => void;
  update: (x: number, y: number) => void;
  finish: (x: number, y: number, success: boolean) => void;
  cancel: () => void;
}

export interface HoldToLogPanelProps {
  foodLabel: string;
  portionLabel?: string;
  onGestureReady?: (control: HoldToLogGestureControl | null) => void;
  kcalForMultiplier: (multiplier: ServingMultiplier) => number;
  onLog: (meal: LogMeal, multiplier: ServingMultiplier) => void;
  onDismiss: () => void;
  initialMultiplier?: ServingMultiplier;
  energyUnit?: 'kcal' | 'kJ';
  mealLabels?: string[];
  /** Allows the owner to anchor the panel beside its Library item. */
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner'] as const;
const servingLabels = ['½', '1', '1½', '2'];

export function HoldToLogPanel({
  foodLabel,
  portionLabel = '1 serving',
  onGestureReady,
  kcalForMultiplier,
  onLog,
  onDismiss,
  initialMultiplier = 1,
  energyUnit = 'kcal',
  mealLabels,
  style,
}: HoldToLogPanelProps) {
  const resolvedMeals = useMemo(() => {
    const trimmed = (mealLabels ?? []).map(label => label.trim()).filter(Boolean);
    const unique = [...new Set(trimmed)];
    return unique.length > 0 ? unique : [...DEFAULT_MEALS];
  }, [mealLabels]);
  const [multiplier, setMultiplier] = useState<ServingMultiplier>(initialMultiplier);
  const [activeMeal, setActiveMeal] = useState<LogMeal | null>(null);
  const value = useRef(multiplier);
  const selected = useRef<LogMeal | null>(null);
  const slider = useRef<ComponentRef<typeof View> | null>(null);
  const sliderRect = useRef<ScreenRect | undefined>(undefined);
  const mealNodes = useRef(new Map<LogMeal, ComponentRef<typeof View>>());
  const targets = useRef(new Map<LogMeal, GestureTarget<LogMeal>>());
  const dragging = useRef(false);
  const settled = useRef(false);
  const mounted = useRef(true);
  const suppressUntil = useRef(0);
  const callbacks = useRef({ onLog, onDismiss });
  useLayoutEffect(() => { callbacks.current = { onLog, onDismiss }; }, [onLog, onDismiss]);
  const animatedStop = useSharedValue(SERVING_STOPS.indexOf(initialMultiplier) / 3);
  const fillStyle = useAnimatedStyle(() => ({ width: `${animatedStop.value * 100}%` }));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const measure = useCallback(() => {
    slider.current?.measureInWindow((x, y, width, height) => {
      if (mounted.current) sliderRect.current = { x, y, width, height };
    });
    mealNodes.current.forEach((node, id) => node.measureInWindow((x, y, width, height) => {
      if (mounted.current && width > 0 && height > 0) targets.current.set(id, { id, kind: id, rect: { x, y, width, height } });
    }));
  }, []);

  const changeServing = useCallback((next: ServingMultiplier) => {
    if (settled.current || next === value.current) return;
    value.current = next;
    setMultiplier(next);
    animatedStop.set(withTiming(SERVING_STOPS.indexOf(next) / 3, { duration: 100 }));
    void Haptics.selectionAsync().catch(() => {});
  }, [animatedStop]);

  const update = useCallback((x: number, y: number) => {
    if (settled.current) return;
    const rect = sliderRect.current;
    // Stop centers are inset by half a 44px touch target at either end.
    if (rect && y >= rect.y && y <= rect.y + rect.height) {
      changeServing(snapServingStop((x - rect.x - spacing.s44 / 2) / Math.max(1, rect.width - spacing.s44)));
    }
    const meal = findActiveTarget({ x, y }, [...targets.current.values()], rect)?.kind ?? null;
    if (selected.current !== meal) {
      selected.current = meal;
      setActiveMeal(meal);
      if (meal) void Haptics.selectionAsync().catch(() => {});
    }
  }, [changeServing]);

  const commit = useCallback((meal: LogMeal) => {
    if (settled.current) return;
    settled.current = true;
    callbacks.current.onLog(meal, value.current);
  }, []);
  const dismiss = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    callbacks.current.onDismiss();
  }, []);
  const start = useCallback((x: number, y: number) => {
    dragging.current = true;
    suppressUntil.current = Infinity;
    measure();
    update(x, y);
  }, [measure, update]);
  const finish = useCallback((x: number, y: number, success: boolean) => {
    if (!dragging.current) return;
    dragging.current = false;
    suppressUntil.current = Date.now() + 350;
    setActiveMeal(null);
    selected.current = null;
    if (!success) return;
    const meal = findActiveTarget({ x, y }, [...targets.current.values()], sliderRect.current)?.kind;
    if (meal) commit(meal);
    // Releasing over the servings control only adjusts; elsewhere cancels without writing.
    else if (!sliderRect.current || !findActiveTarget({ x, y }, [{ id: 'slider', kind: 'slider', rect: sliderRect.current }])) dismiss();
  }, [commit, dismiss]);
  const cancel = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    suppressUntil.current = Date.now() + 350;
    selected.current = null;
    setActiveMeal(null);
  }, []);

  useLayoutEffect(() => {
    onGestureReady?.({ start, update, finish, cancel });
    return () => onGestureReady?.(null);
  }, [onGestureReady, start, update, finish, cancel]);

  // RNGH stores these callbacks for future gesture events; none run during render.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => Gesture.Pan().enabled(!onGestureReady).minDistance(4).maxPointers(1).shouldCancelWhenOutside(false)
    .onStart(event => { scheduleOnRN(start, event.absoluteX, event.absoluteY); })
    .onUpdate(event => { scheduleOnRN(update, event.absoluteX, event.absoluteY); })
    .onEnd((event, success) => { scheduleOnRN(finish, event.absoluteX, event.absoluteY, success); })
    .onFinalize(() => { scheduleOnRN(cancel); }), [start, update, finish, cancel, onGestureReady]);
  /* eslint-enable react-hooks/refs */

  const setMealNode = useCallback((meal: LogMeal, node: ComponentRef<typeof View> | null) => {
    if (node) mealNodes.current.set(meal, node);
    else { mealNodes.current.delete(meal); targets.current.delete(meal); }
  }, []);
  const canTap = useCallback(() => !dragging.current && Date.now() >= suppressUntil.current, []);
  const multiRow = resolvedMeals.length > 4;

  return <GestureDetector gesture={gesture}>
    <Animated.View style={[styles.panel, style]} onLayout={measure} onAccessibilityEscape={dismiss}>
      <View style={styles.heading}>
        <DoopIcon name={inferFoodGlyph(foodLabel)} size={18} color={colors.muted} />
        <View style={styles.headingCopy}><Text numberOfLines={2} style={styles.title}>{foodLabel}</Text><Text style={styles.muted}>{portionLabel} · Hold to log</Text></View>
        <View style={styles.total}><Text accessibilityLiveRegion="polite" style={styles.kcal}>{number(energyValue(kcalForMultiplier(multiplier), energyUnit))}</Text><Text style={styles.energyUnit}>{energyUnit}</Text></View>
      </View>
      <View ref={slider} collapsable={false} onLayout={measure} style={styles.slider}
        accessibilityRole="adjustable" accessibilityLabel="Servings" accessibilityValue={{ min: 0.5, max: 2, now: multiplier, text: `${multiplier} servings` }}
        accessibilityActions={[{ name: 'increment', label: 'Increase servings' }, { name: 'decrement', label: 'Decrease servings' }]}
        onAccessibilityAction={event => {
          const direction = event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0;
          if (direction) changeServing(snapServingStop((SERVING_STOPS.indexOf(value.current) + direction) / 3));
        }}>
        <View pointerEvents="none" style={styles.track}><Animated.View style={[styles.fill, fillStyle]} /></View>
        {SERVING_STOPS.map((stop, index) => <Pressable key={stop} accessibilityRole="button" accessibilityLabel={`${stop} servings`}
          accessibilityState={{ selected: stop === multiplier }} onPress={() => { if (canTap()) changeServing(stop); }} style={styles.stop}>
          <View style={[styles.dot, stop === multiplier && styles.dotSelected]} />
          <Text style={[styles.stopLabel, stop === multiplier && styles.selectedText]}>{servingLabels[index]}</Text>
        </Pressable>)}
      </View>
      <View style={styles.divider} />
      <View style={[styles.meals, multiRow && styles.mealsWrap]}>
        {resolvedMeals.map(meal => (
          <View key={meal} ref={node => setMealNode(meal, node)} collapsable={false} onLayout={measure} style={multiRow ? styles.mealSlotWrap : styles.mealSlot}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Log ${foodLabel} to ${meal}, ${multiplier} servings`}
              accessibilityState={{ selected: activeMeal === meal }} onPress={() => { if (canTap()) commit(meal); }}
              style={styles.meal}>
              <View style={[styles.mealCircle, activeMeal === meal && styles.mealSelected]}><DoopIcon name={mealDaypartGlyph(meal)} size={18} color={activeMeal === meal ? colors.onAccent : colors.muted} /></View>
              <Text numberOfLines={1} style={[styles.mealLabel, activeMeal === meal && { color: colors.ink }]}>{meal}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </Animated.View>
  </GestureDetector>;
}

const styles = StyleSheet.create({
  panel: { paddingTop: 15, paddingBottom: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, headingCopy: { flex: 1, gap: 1 },
  title: { ...fontFace('semibold'), fontSize: 16, color: colors.ink }, muted: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  total: { flexDirection: 'row', alignItems: 'baseline', gap: 4 }, kcal: { ...fontFace('bold'), fontSize: 28, color: colors.ink, letterSpacing: -0.8, fontVariant: [...tabularNums.fontVariant] }, energyUnit: { ...fontFace('semibold'), fontSize: 10, color: colors.muted },
  slider: { marginTop: 8, height: 46, flexDirection: 'row', justifyContent: 'space-between' },
  track: { position: 'absolute', top: 9, left: 22, right: 22, height: 4, borderRadius: 999, backgroundColor: colors.track },
  fill: { height: '100%', borderRadius: 999, backgroundColor: colors.accent },
  stop: { width: 44, height: 46, alignItems: 'center', paddingTop: 6, gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 999, backgroundColor: colors.border },
  dotSelected: { width: 20, height: 20, marginTop: -5, marginBottom: -6, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.surface, boxShadow: '0 0 0 4px rgba(122,162,247,0.15)' },
  stopLabel: { ...fontFace('semibold'), color: colors.muted, fontSize: 10.5 }, selectedText: { color: colors.ink },
  divider: { height: 1, marginTop: 8, backgroundColor: colors.hairline },
  meals: { flexDirection: 'row', gap: 4, marginTop: 10 },
  mealsWrap: { flexWrap: 'wrap', rowGap: 8 },
  mealSlot: { flex: 1, minWidth: 44 },
  mealSlotWrap: { flexGrow: 1, flexBasis: '23%', minWidth: 68 },
  meal: { height: 62, alignItems: 'center', gap: 4 }, mealCircle: { width: 44, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  mealSelected: { backgroundColor: colors.accent, borderColor: colors.accent, boxShadow: '0 0 0 5px rgba(122,162,247,0.16)' },
  mealLabel: { ...fontFace('semibold'), color: colors.muted, fontSize: 10, lineHeight: 14 },
});
