import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { colors, fontFace } from '../../tokens';
import { DoopIcon } from '../DoopIcons';
import { HoldCompletionRing } from './HoldCompletionRing';
import { HoldPowerLines } from './HoldPowerLines';
import { useHoldTargets } from './PetalHubLauncher';
import type { PowerLineOrigin, PowerLineTarget } from './powerLineMath';

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

const MEAL_FAN_ORIGIN: PowerLineOrigin = { x: 22, y: 22, radius: 22 };

export function MealHoldFan({ onTapAdd, onSelectAction, usual, onSelectUsual, accessibilityLabel = 'Add to meal', empty = false, undo = false, disabled = false, onOpenChange }: MealHoldFanProps) {
  const holdEnabled = !undo && !disabled;
  const hasUsual = Boolean(usual && onSelectUsual);
  const {
    open, activeId, origin: originRef, gesture, holdRing, progress, overlayStyle, scrimStyle, pulseStyle, handleAnimStyle,
    bindTarget, measure, show, close, tap, choose,
  } = useHoldTargets(id => {
    if (id === 'usual' && usual) onSelectUsual?.(usual);
    else { const action = actions.find(item => item.action === id); if (action) onSelectAction(action.action); }
  }, ['usual', ...actions.map(item => item.action)], holdEnabled, onOpenChange);

  const powerTargets = useMemo<PowerLineTarget[]>(() => [
    ...actions.map(({ action, x, y }) => ({
      id: action,
      x: 22 + x,
      y: 22 + y,
      radius: 21,
    })),
    ...(hasUsual ? [{ id: 'usual', x: -73, y: 22, radius: 0 }] : []),
  ], [hasUsual]);

  return <View style={[styles.root, open && styles.open]} onLayout={measure}>
    {open && <>
      <Animated.View pointerEvents="none" style={[styles.backdrop, scrimStyle]} />
      <View pointerEvents="box-none" style={styles.fan} onAccessibilityEscape={close}>
        <Animated.View pointerEvents="none" style={overlayStyle}>
          <Svg pointerEvents="none" style={styles.guide} width={150} height={150} viewBox="0 0 150 150"><Path d="M30 150 A120 120 0 0 1 150 30" stroke={colors.accent} strokeWidth={1} strokeDasharray="4 5" fill="none" opacity={0.28} /></Svg>
        </Animated.View>
        <HoldPowerLines
          visible={open}
          origin={MEAL_FAN_ORIGIN}
          targets={powerTargets}
          activeId={activeId}
          openProgress={progress}
          zIndex={1}
        />
        {usual && onSelectUsual && <View ref={bindTarget('usual')} collapsable={false} onLayout={measure} style={styles.usual}>
          <Animated.View style={overlayStyle}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Log usual: ${usual.label}`} accessibilityState={{ selected: activeId === 'usual' }} onPress={() => choose('usual')} style={[styles.pill, activeId === 'usual' && styles.selected]}>
              <Text numberOfLines={1} style={[styles.label, activeId === 'usual' && { color: colors.onAccent }]}>{usual.label}</Text>
            </Pressable>
          </Animated.View>
        </View>}
        {actions.map(({ action, label, glyph, x, y }) => <View key={action} ref={bindTarget(action)} collapsable={false} onLayout={measure} style={[styles.actionSlot, { left: 1 + x, top: 1 + y }]}>
          <Animated.View style={overlayStyle}>
            <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: activeId === action }} onPress={() => choose(action)} style={[styles.action, activeId === action && styles.selected]}>
              <DoopIcon name={glyph} size={18} color={activeId === action ? colors.onAccent : colors.ink} />
            </Pressable>
          </Animated.View>
        </View>)}
      </View>
    </>}
    <GestureDetector gesture={gesture}>
      <Animated.View ref={originRef} collapsable={false} style={[styles.root, handleAnimStyle]}>
        <HoldCompletionRing
          progress={holdRing.progress}
          size={52}
          strokeWidth={2}
          trackOpacity={empty ? 0.34 : 0.22}
          trackStrokeWidth={1.25}
          visible={holdEnabled && !open}
        />
        <Animated.View pointerEvents="none" style={[styles.pulseRing, pulseStyle]} />
        <Animated.View style={holdRing.pressScaleStyle}>
          <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled}
            accessibilityHint={undo ? 'Undo the last add' : 'Tap to add, or hold and slide to choose an action'}
            accessibilityActions={[{ name: 'activate', label: undo ? 'Undo' : 'Add to meal' }, ...(!undo ? [{ name: 'longpress', label: 'Show meal actions' }] : [])]}
            onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') show(); else if (event.nativeEvent.actionName === 'activate') tap(onTapAdd); }}
            onAccessibilityEscape={close} onPress={() => tap(onTapAdd)} style={[styles.add, empty && styles.empty, (open || undo) && styles.selected, disabled && { opacity: 0.45 }]}>
            <DoopIcon name={undo ? 'undo' : 'plus'} size={undo ? 17 : 16} color={open || undo ? colors.onAccent : empty ? colors.accent : colors.muted} />
          </Pressable>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  </View>;
}
const styles = StyleSheet.create({
  root: { width: 44, height: 44, overflow: 'visible', alignItems: 'center', justifyContent: 'center' },
  open: { zIndex: 120, elevation: 24 },
  pulseRing: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.accent },
  add: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground },
  empty: { borderColor: 'rgba(122,162,247,0.55)' },
  backdrop: { position: 'absolute', left: -3000, right: -3000, top: -3000, bottom: -3000, backgroundColor: 'rgba(10,11,18,0.78)' },
  fan: { position: 'absolute', left: 0, top: 0, width: 44, height: 44, overflow: 'visible' },
  guide: { position: 'absolute', left: -128, top: -128 },
  actionSlot: { position: 'absolute', width: 42, height: 42, zIndex: 2 },
  action: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1.25, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  usual: { position: 'absolute', right: 117, top: 5, minWidth: 96, maxWidth: 156, height: 34, zIndex: 2 },
  pill: { height: 34, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1.25, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  label: { ...fontFace('semibold'), color: colors.ink, fontSize: 12 },
  selected: { borderColor: colors.accent, backgroundColor: colors.accent },
});
