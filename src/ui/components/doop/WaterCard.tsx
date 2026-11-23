import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, fontSize, fontWeight, MIN_TOUCH_TARGET, radius, spacing } from '../../tokens';
import { Button, Heading, Input, Muted, number, ui } from '../primitives';

export interface WaterCardProps {
  totalMl: number;
  onAdd: (amountMl: number) => void;
  onUndo?: (() => void) | undefined;
  lastAmountMl?: number | undefined;
  showCustomAmount?: boolean | undefined;
  disabled?: boolean | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

function waterAmount(amountMl: number): string {
  return amountMl >= 1000 ? `${number(amountMl / 1000, 2)} L` : `${number(amountMl)} ml`;
}

/** Local input state only; the parent owns today's total and water entries. */
export function WaterCard({ totalMl, onAdd, onUndo, lastAmountMl, showCustomAmount = true, disabled = false, style }: WaterCardProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const amount = Number(customAmount.trim().replace(',', '.'));
  const canAddCustom = !disabled && customAmount.trim() !== '' && Number.isFinite(amount) && amount > 0;

  const addCustom = () => {
    if (!canAddCustom) return;
    onAdd(amount);
    setCustomAmount('');
    setCustomOpen(false);
  };

  return (
    <View style={[ui.card, style]}>
      <View style={styles.header}>
        <Heading>Water</Heading>
        <Text accessibilityLiveRegion="polite" accessibilityLabel={`Water today, ${waterAmount(totalMl)}`} style={[ui.number, styles.total]}>
          {waterAmount(totalMl)}
        </Text>
      </View>
      <Muted>Logged today. Add a drink whenever you like.</Muted>
      <View style={ui.wrap}>
        <Button label="+250 ml" accessibilityLabel="Add 250 millilitres of water" onPress={() => onAdd(250)} disabled={disabled} />
        <Button label="+500 ml" accessibilityLabel="Add 500 millilitres of water" onPress={() => onAdd(500)} disabled={disabled} />
        {showCustomAmount ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Custom water amount"
            accessibilityState={{ expanded: customOpen, disabled }}
            disabled={disabled}
            onPress={() => setCustomOpen(open => !open)}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed, disabled && styles.disabled]}
          >
            <Text style={ui.number}>{customOpen ? 'Close' : 'Custom amount'}</Text>
          </Pressable>
        ) : null}
      </View>
      {showCustomAmount && customOpen ? (
        <View style={styles.custom}>
          <Input
            label="Water amount (ml)"
            value={customAmount}
            onChangeText={setCustomAmount}
            keyboardType="decimal-pad"
            placeholder="e.g. 350"
            editable={!disabled}
            onSubmitEditing={addCustom}
            returnKeyType="done"
          />
          <Button label="Add water" primary disabled={!canAddCustom} onPress={addCustom} />
        </View>
      ) : null}
      {onUndo ? (
        <Button
          label={lastAmountMl == null ? 'Remove last drink' : `Undo last (${waterAmount(lastAmountMl)})`}
          accessibilityLabel="Remove the last water entry"
          onPress={onUndo}
          disabled={disabled || totalMl <= 0}
          quiet
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s8 },
  total: { fontSize: fontSize.t24, fontWeight: fontWeight.semibold },
  toggle: {
    minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.s12, paddingVertical: spacing.s10,
    justifyContent: 'center', alignItems: 'center', borderRadius: radius.r8,
    backgroundColor: colors.raised,
  },
  custom: { gap: spacing.s8 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
