import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { colors, fontFamily, fontSize, fontWeight, radius, spacing } from '../../tokens';
import { useHoldTargets } from './PetalHubLauncher';

export type MealFanAction = 'search' | 'quick-add' | 'barcode';
export interface MealFanUsual { id: string; label: string }
export interface MealHoldFanProps {
  onTapAdd: () => void;
  onSelectAction: (action: MealFanAction) => void;
  usual?: MealFanUsual;
  onSelectUsual?: (usual: MealFanUsual) => void;
  accessibilityLabel?: string;
}

const actions: { action: MealFanAction; label: string }[] = [
  { action: 'search', label: 'Search' },
  { action: 'quick-add', label: 'Quick add' },
  { action: 'barcode', label: 'Barcode' },
];

export function MealHoldFan({ onTapAdd, onSelectAction, usual, onSelectUsual, accessibilityLabel = 'Add to meal' }: MealHoldFanProps) {
  const [tapFallback, setTapFallback] = useState(false);
  const { open, activeId, origin: originRef, gesture, overlayStyle, bindTarget, measure, show, close, tap, choose } = useHoldTargets(id => {
    if (id === 'usual' && usual) onSelectUsual?.(usual);
    else {
      const action = actions.find(item => item.action === id);
      if (action) onSelectAction(action.action);
    }
  }, ['usual', ...actions.map(item => item.action)]);

  // Native hit testing needs the expanded fan inside its parent's touch bounds.
  // Accessibility long-press opens an inline fan that stays available for taps.
  return <View style={[styles.root, open && styles.open, open && tapFallback && styles.inlineFan]} onLayout={measure}>
    {open && <Animated.View style={[styles.fan, overlayStyle]} onAccessibilityEscape={close}>
      {usual && onSelectUsual && <View ref={bindTarget('usual')} collapsable={false} onLayout={measure}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Log usual: ${usual.label}`} accessibilityState={{ selected: activeId === 'usual' }}
          onPress={() => choose('usual')} style={[styles.pill, activeId === 'usual' && styles.selected]}>
          <Text numberOfLines={1} style={styles.label}>{usual.label}</Text>
        </Pressable>
      </View>}
      <View style={styles.actions}>
        {actions.map(({ action, label }) => <View key={action} ref={bindTarget(action)} collapsable={false} onLayout={measure} style={styles.actionSlot}>
          <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: activeId === action }}
            onPress={() => choose(action)} style={[styles.action, activeId === action && styles.selected]}>
            <Text style={styles.label}>{label}</Text>
          </Pressable>
        </View>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel meal actions" onPress={close} style={styles.cancel}>
        <Text style={styles.muted}>Cancel</Text>
      </Pressable>
    </Animated.View>}
    <GestureDetector gesture={gesture}>
      <Animated.View ref={originRef} collapsable={false} style={styles.root}>
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint="Tap to add, or hold and slide to choose an action"
          accessibilityActions={[{ name: 'activate', label: 'Add to meal' }, { name: 'longpress', label: 'Show meal actions' }]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') { setTapFallback(true); show(); } else if (event.nativeEvent.actionName === 'activate') tap(onTapAdd); }}
          onPressIn={() => setTapFallback(false)}
          onAccessibilityEscape={close} onPress={() => tap(onTapAdd)} style={styles.add}>
          <Text accessible={false} style={styles.plus}>+</Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  </View>;
}

const styles = StyleSheet.create({
  root: { width: spacing.s44, height: spacing.s44, overflow: 'visible' },
  open: { zIndex: 20 },
  inlineFan: { width: 264, height: 224, alignItems: 'flex-end', justifyContent: 'flex-end' },
  add: { width: spacing.s44, height: spacing.s44, borderRadius: radius.full, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: fontSize.t24, color: colors.accent },
  fan: { position: 'absolute', bottom: spacing.s56, right: 0, width: 264, padding: spacing.s8, gap: spacing.s8, borderRadius: radius.r20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, zIndex: 20 },
  actions: { flexDirection: 'row', gap: spacing.s6 },
  actionSlot: { flex: 1 },
  action: { minHeight: spacing.s48, paddingHorizontal: spacing.s4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.r12, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  pill: { minHeight: spacing.s44, paddingHorizontal: spacing.s12, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.ink, fontFamily: fontFamily.body, fontSize: fontSize.t12, fontWeight: fontWeight.semibold },
  muted: { color: colors.muted, fontFamily: fontFamily.body, fontSize: fontSize.t11 },
  selected: { borderColor: colors.accent, transform: [{ scale: 1.04 }] },
  cancel: { minHeight: spacing.s44, alignItems: 'center', justifyContent: 'center' },
});
