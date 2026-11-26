import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, fontFace, tabularNums } from '../../tokens';
import { DoopIcon } from '../DoopIcons';
import { Button, number, ui } from '../primitives';
import { NumericEditor } from './InlineKeypad';
import { RevealPanel } from './Motion';

export interface WaterCardProps {
  totalMl: number;
  goalMl?: number | null | undefined;
  onAdd: (amountMl: number) => void;
  onUndo?: (() => void) | undefined;
  onClear?: (() => void) | undefined;
  lastAmountMl?: number | undefined;
  showCustomAmount?: boolean | undefined;
  disabled?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Tapping anywhere on the water row opens the shared NumericEditor to log an exact ml amount. */
export function WaterCard({
  totalMl,
  goalMl = 2000,
  onAdd,
  onUndo,
  onClear,
  lastAmountMl,
  showCustomAmount = true,
  disabled = false,
  onOpenChange,
  style,
}: WaterCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const amount = Number(customAmount.trim());
  const canAdd = !disabled && customAmount.trim() !== '' && Number.isFinite(amount) && amount > 0;

  const setOpen = (next: boolean) => {
    if (next) Keyboard.dismiss();
    setExpanded(next);
    onOpenChange?.(next);
  };

  const addCustom = () => {
    if (!canAdd) return;
    onAdd(amount);
    setCustomAmount('');
    setOpen(false);
  };

  return (
    <View style={[styles.strip, style]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Water, ${number(totalMl)}${goalMl != null ? ` of ${number(goalMl)}` : ''} ml. Tap to enter exact amount`}
          accessibilityState={{ expanded }}
          onPress={() => setOpen(!expanded)}
          style={({ pressed }) => [styles.rowTrigger, pressed && styles.pressed]}
        >
          <DoopIcon name="water" size={18} color={expanded ? colors.accent : colors.muted} />
          <Text style={[styles.label, expanded && styles.labelActive]}>Water</Text>
          <Text accessibilityLiveRegion="polite" style={styles.total}>
            {number(totalMl)}
            {goalMl != null ? ` / ${number(goalMl)}` : ''} ml
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add 250 millilitres of water"
          disabled={disabled}
          onPress={() => onAdd(250)}
          style={({ pressed }) => [styles.pill, disabled && { opacity: 0.45 }, pressed && styles.pressed]}
        >
          <Text style={styles.pillLabel}>+250</Text>
        </Pressable>
      </View>

      <RevealPanel visible={expanded} direction="down" style={styles.options}>
        {showCustomAmount && (
          <NumericEditor
            value={customAmount}
            onChange={setCustomAmount}
            unit="ml"
            allowDecimal={false}
            maxLength={5}
            allowEmpty
            confirmDisabled={!canAdd}
            confirmLabel="Log water amount"
            cancelLabel="Close water keypad"
            onConfirm={addCustom}
            onCancel={() => {
              setCustomAmount('');
              setOpen(false);
            }}
          />
        )}
        <View style={ui.wrap}>
          <Button
            label="+500 ml"
            quiet
            disabled={disabled}
            onPress={() => {
              onAdd(500);
              setOpen(false);
            }}
          />
          {onUndo && (
            <Button
              label={lastAmountMl == null ? 'Undo last' : `Undo ${number(lastAmountMl)} ml`}
              quiet
              disabled={disabled || totalMl <= 0}
              onPress={onUndo}
            />
          )}
          {onClear && (
            <Button
              label="Clear water"
              quiet
              disabled={disabled || totalMl <= 0}
              onPress={onClear}
            />
          )}
        </View>
      </RevealPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: 16, paddingBottom: 10 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTrigger: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...fontFace('semibold'), color: colors.muted, fontSize: 12 },
  labelActive: { color: colors.accent },
  total: { ...fontFace('medium'), fontVariant: [...tabularNums.fontVariant], flex: 1, textAlign: 'right', color: colors.muted, fontSize: 12 },
  pill: { height: 30, minWidth: 52, borderRadius: 15, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pillLabel: { ...fontFace('semibold'), color: colors.ink, fontSize: 12 },
  options: { gap: 10, paddingBottom: 12 },
  pressed: { opacity: 0.7 },
});
