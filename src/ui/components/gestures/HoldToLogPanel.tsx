import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, fontFamily, fontSize, fontWeight, radius, spacing, tabularNums } from '../../tokens';
import { findActiveTarget, SERVING_STOPS, snapServingStop } from './hitTest';
import type { GestureTarget, ScreenRect, ServingMultiplier } from './hitTest';

const KCAL_TO_KJ = 4.184;

export type LogMeal = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export interface HoldToLogPanelProps {
  foodLabel: string;
  kcalForMultiplier: (multiplier: ServingMultiplier) => number;
  onLog: (meal: LogMeal, multiplier: ServingMultiplier) => void;
  onDismiss: () => void;
  initialMultiplier?: ServingMultiplier;
  energyUnit?: 'kcal' | 'kJ';
  mealLabels?: string[];
  /** Allows the owner to anchor the panel beside its Library item. */
  style?: StyleProp<ViewStyle>;
}

const meals: { id: LogMeal; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' }, { id: 'lunch', label: 'Lunch' },
  { id: 'snack', label: 'Snack' }, { id: 'dinner', label: 'Dinner' },
];
const servingLabels = ['½', '1', '1½', '2'];

export function HoldToLogPanel({
  foodLabel,
  kcalForMultiplier,
  onLog,
  onDismiss,
  initialMultiplier = 1,
  energyUnit = 'kcal',
  mealLabels,
  style,
}: HoldToLogPanelProps) {
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

  // RNGH stores these callbacks for future gesture events; none run during render.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => Gesture.Pan().minDistance(4).maxPointers(1).shouldCancelWhenOutside(false)
    .onStart(event => { runOnJS(start)(event.absoluteX, event.absoluteY); })
    .onUpdate(event => { runOnJS(update)(event.absoluteX, event.absoluteY); })
    .onEnd((event, success) => { runOnJS(finish)(event.absoluteX, event.absoluteY, success); })
    .onFinalize(() => { runOnJS(cancel)(); }), [start, update, finish, cancel]);
  /* eslint-enable react-hooks/refs */

  const mealRefs = useMemo(() => Object.fromEntries(meals.map(({ id }) => [id,
      (node: ComponentRef<typeof View> | null) => {
        if (node) mealNodes.current.set(id, node);
        else { mealNodes.current.delete(id); targets.current.delete(id); }
      }])) as Record<LogMeal, (node: ComponentRef<typeof View> | null) => void>, []);
  const canTap = () => !dragging.current && Date.now() >= suppressUntil.current;

  return <GestureDetector gesture={gesture}>
    <Animated.View style={[styles.panel, style]} onLayout={measure} onAccessibilityEscape={dismiss}>
      <View style={styles.heading}>
        <Text numberOfLines={2} style={styles.title}>{foodLabel}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel logging food" onPress={() => { if (canTap()) dismiss(); }} style={styles.cancel}>
          <Text style={styles.muted}>Cancel</Text>
        </Pressable>
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.kcal}>
        {Math.round(energyUnit === 'kJ' ? kcalForMultiplier(multiplier) * KCAL_TO_KJ : kcalForMultiplier(multiplier))} {energyUnit}
      </Text>
      <Text style={styles.muted}>Servings</Text>
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
      <View style={styles.meals}>
        {meals.map((meal, index) => {
          const displayLabel = mealLabels?.[index]?.trim() || meal.label;
          return <View key={meal.id} ref={mealRefs[meal.id]} collapsable={false} onLayout={measure} style={styles.mealSlot}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Log ${foodLabel} to ${displayLabel}, ${multiplier} servings`}
              accessibilityState={{ selected: activeMeal === meal.id }} onPress={() => { if (canTap()) commit(meal.id); }}
              style={[styles.meal, activeMeal === meal.id && styles.mealSelected]}>
              <Text numberOfLines={1} style={[styles.mealLabel, activeMeal === meal.id && styles.selectedText]}>{displayLabel}</Text>
            </Pressable>
          </View>;
        })}
      </View>
    </Animated.View>
  </GestureDetector>;
}

const styles = StyleSheet.create({
  panel: { padding: spacing.s16, gap: spacing.s8, borderRadius: radius.r24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s8 },
  title: { flex: 1, fontFamily: fontFamily.body, fontSize: fontSize.t16, fontWeight: fontWeight.bold, color: colors.ink },
  muted: { fontFamily: fontFamily.body, fontSize: fontSize.t12, color: colors.muted },
  kcal: { fontFamily: fontFamily.number, fontSize: fontSize.t28, fontWeight: fontWeight.bold, color: colors.ink, fontVariant: [...tabularNums.fontVariant] },
  cancel: { minWidth: spacing.s44, minHeight: spacing.s44, justifyContent: 'center', alignItems: 'center' },
  slider: { flexDirection: 'row', justifyContent: 'space-between', minHeight: spacing.s56 },
  track: { position: 'absolute', top: spacing.s12, left: spacing.s44 / 2, right: spacing.s44 / 2, height: spacing.s4, borderRadius: radius.full, backgroundColor: colors.track },
  fill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.accent },
  stop: { width: spacing.s44, minHeight: spacing.s56, alignItems: 'center', paddingTop: spacing.s6, gap: spacing.s6 },
  dot: { width: spacing.s16, height: spacing.s16, borderRadius: radius.full, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.raised },
  dotSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  stopLabel: { color: colors.muted, fontFamily: fontFamily.number, fontSize: fontSize.t13 },
  selectedText: { color: colors.accent },
  meals: { flexDirection: 'row', gap: spacing.s4 },
  mealSlot: { flex: 1, minWidth: spacing.s44 },
  meal: { minHeight: spacing.s48, borderRadius: radius.r12, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.s2 },
  mealSelected: { borderColor: colors.accent, transform: [{ scale: 1.04 }] },
  mealLabel: { color: colors.ink, fontFamily: fontFamily.body, fontSize: fontSize.t11, fontWeight: fontWeight.semibold },
});
