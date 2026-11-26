import { useEffect, useLayoutEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, fontFace } from '../../tokens';
import { DoopIcon } from '../DoopIcons';
import { useHoldTargets } from './PetalHubLauncher';

export type MealFanAction = 'search' | 'camera' | 'voice' | 'quick-add' | 'barcode';
export interface MealFanUsual { id: string; label: string }
export interface MealHoldFanProps {
  onTapAdd: () => void;
  onSelectAction: (action: MealFanAction) => void;
  usual?: MealFanUsual;
  onSelectUsual?: (usual: MealFanUsual) => void;
  accessibilityLabel?: string;
  empty?: boolean;
  undo?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}
const actions = [
  { action: 'search', label: 'Search', glyph: 'search', x: -104, y: -60 },
  { action: 'camera', label: 'Camera', glyph: 'camera', x: -60, y: -104 },
  { action: 'voice', label: 'Voice', glyph: 'mic', x: 0, y: -120 },
] as const;

export function MealHoldFan({ onTapAdd, onSelectAction, usual, onSelectUsual, accessibilityLabel = 'Add to meal', empty = false, undo = false, disabled = false, onOpenChange }: MealHoldFanProps) {
  const {
    open, activeId, origin: originRef, gesture, overlayStyle, scrimStyle, chargeStyle, pulseStyle, handleAnimStyle,
    bindTarget, measure, show, close, tap, choose,
  } = useHoldTargets(id => {
    if (id === 'usual' && usual) onSelectUsual?.(usual);
    else { const action = actions.find(item => item.action === id); if (action) onSelectAction(action.action); }
  }, ['usual', ...actions.map(item => item.action)]);
  const openChanged = useRef(onOpenChange);
  useLayoutEffect(() => { openChanged.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => { openChanged.current?.(open); }, [open]);

  return <View style={[styles.root, open && styles.open]} onLayout={measure}>
    {open && <>
      <Animated.View pointerEvents="none" style={[styles.backdrop, scrimStyle]} />
      <Animated.View pointerEvents="box-none" style={[styles.fan, overlayStyle]} onAccessibilityEscape={close}>
        <Svg pointerEvents="none" style={styles.guide} width={150} height={150} viewBox="0 0 150 150"><Path d="M30 150 A120 120 0 0 1 150 30" stroke={colors.accent} strokeWidth={1} strokeDasharray="4 5" fill="none" opacity={0.75} /></Svg>
        {usual && onSelectUsual && <View ref={bindTarget('usual')} collapsable={false} onLayout={measure} style={styles.usual}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Log usual: ${usual.label}`} accessibilityState={{ selected: activeId === 'usual' }} onPress={() => choose('usual')} style={[styles.pill, activeId === 'usual' && styles.selected]}>
            <Text numberOfLines={1} style={[styles.label, activeId === 'usual' && { color: colors.onAccent }]}>{usual.label}</Text>
          </Pressable>
        </View>}
        {actions.map(({ action, label, glyph, x, y }) => <View key={action} ref={bindTarget(action)} collapsable={false} onLayout={measure} style={[styles.actionSlot, { left: 1 + x, top: 1 + y }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: activeId === action }} onPress={() => choose(action)} style={[styles.action, activeId === action && styles.selected]}>
            <DoopIcon name={glyph} size={18} color={activeId === action ? colors.onAccent : colors.ink} />
          </Pressable>
        </View>)}
      </Animated.View>
    </>}
    <GestureDetector gesture={gesture.enabled(!undo && !disabled)}>
      <Animated.View ref={originRef} collapsable={false} style={[styles.root, handleAnimStyle]}>
        {/* Quiet tap+hold visual language: upper-left segmented hold-arc matching the fan direction */}
        {!open && !undo && <Svg pointerEvents="none" width={54} height={54} viewBox="0 0 54 54" style={styles.affordance}>
          <Path d="M 3 27 A 24 24 0 0 1 27 3" fill="none" stroke={colors.accent} strokeWidth={1.4} strokeOpacity={0.5} strokeLinecap="round" strokeDasharray="2.5 4" />
          <Circle cx={10} cy={10} r={1.7} fill={colors.accent} fillOpacity={0.75} />
        </Svg>}
        <Animated.View pointerEvents="none" style={[styles.chargeRing, chargeStyle]} />
        <Animated.View pointerEvents="none" style={[styles.pulseRing, pulseStyle]} />
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled}
          accessibilityHint={undo ? 'Undo the last add' : 'Tap to add, or hold and slide to choose an action'}
          accessibilityActions={[{ name: 'activate', label: undo ? 'Undo' : 'Add to meal' }, ...(!undo ? [{ name: 'longpress', label: 'Show meal actions' }] : [])]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') show(); else if (event.nativeEvent.actionName === 'activate') tap(onTapAdd); }}
          onAccessibilityEscape={close} onPress={() => tap(onTapAdd)} style={[styles.add, empty && styles.empty, (open || undo) && styles.selected, disabled && { opacity: 0.45 }]}>
          <DoopIcon name={undo ? 'undo' : 'plus'} size={undo ? 17 : 16} color={open || undo ? colors.onAccent : empty ? colors.accent : colors.muted} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  </View>;
}
const styles = StyleSheet.create({
  root: { width: 44, height: 44, overflow: 'visible', alignItems: 'center', justifyContent: 'center' },
  open: { zIndex: 120, elevation: 24 },
  affordance: { position: 'absolute', left: -5, top: -5 },
  chargeRing: { position: 'absolute', width: 52, height: 52, borderRadius: 26, borderWidth: 1.8, borderColor: colors.accent },
  pulseRing: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.accent },
  add: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground },
  empty: { borderColor: 'rgba(122,162,247,0.55)' },
  backdrop: { position: 'absolute', left: -3000, right: -3000, top: -3000, bottom: -3000, backgroundColor: 'rgba(10,11,18,0.78)' },
  fan: { position: 'absolute', left: 0, top: 0, width: 44, height: 44, overflow: 'visible' },
  guide: { position: 'absolute', left: -128, top: -128 },
  actionSlot: { position: 'absolute', width: 42, height: 42 },
  action: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1.25, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  usual: { position: 'absolute', right: 117, top: 5, minWidth: 96, maxWidth: 156, height: 34 },
  pill: { height: 34, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1.25, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  label: { ...fontFace('semibold'), color: colors.ink, fontSize: 12 },
  selected: { borderColor: colors.accent, backgroundColor: colors.accent },
});
