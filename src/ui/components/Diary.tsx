import { View, Text } from 'react-native';
import type { GoalPeriod, NutrientAggregate } from '../../domain';
import { useAction, useAppRuntime, usePreferences } from '../../app/AppRuntimeContext';
import { colors, macroColors, spacing } from '../tokens';
import { Button, Card, energy, energyValue, ErrorMessage, Label, Muted, number, ui } from './primitives';
export function MacroRow({ totals, goal }: { totals: NutrientAggregate; goal?: GoalPeriod | null }) {
  return <View style={ui.wrap}>{([
    ['P', 'protein_g', macroColors.protein], ['C', 'carbs_g', macroColors.carbs], ['F', 'fat_g', macroColors.fat], ['Fiber', 'fiber_g', colors.muted],
  ] as const).map(([label, key, color]) => <View key={key} style={{ flexGrow: 1, gap: spacing.s4 }}>
    <Text style={[ui.number, { color, fontWeight: '700' }]}>{label} {number(totals.nutrients?.[key], 1)}{goal?.[key] != null ? `/${number(goal[key])}` : ''} g</Text>
    {totals.unknownCount[key] > 0 && <Muted>· {totals.unknownCount[key]} unknown</Muted>}
  </View>)}</View>;
}
export function Budget({ totals, goal }: { totals: NutrientAggregate; goal: GoalPeriod | null }) {
  const unit = usePreferences().value?.energyUnit ?? 'kcal';
  const target = goal?.target_kcal;
  const consumed = totals.nutrients?.kcal;
  const remaining = target != null ? target - (consumed ?? 0) : consumed;
  return <Card><Muted>{target == null ? 'CONSUMED · OBSERVE' : 'REMAINING'}</Muted>
    <Text style={[ui.number, { fontSize: 40, fontWeight: '800' }]}>{number(energyValue(remaining, unit))} <Text style={{ fontSize: 16 }}>{unit}</Text></Text>
    <Label style={ui.number}>{energy(consumed, unit)} logged{target != null ? ` / ${energy(target, unit)} target` : ''}</Label>
    {target != null && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: target, now: consumed ?? 0 }} style={{ height: 4, backgroundColor: colors.track }}>
      <View style={{ height: 4, width: `${Math.min(100, Math.max(0, (consumed ?? 0) / target * 100))}%`, backgroundColor: (consumed ?? 0) > target ? colors.danger : colors.accent }} />
    </View>}
    <MacroRow totals={totals} goal={goal} />
  </Card>;
}
export function UndoToast() {
  const { controller } = useAppRuntime();
  const action = useAction();
  const undo = controller.undoAction;
  if (!undo) return null;
  return <Card><View accessibilityLiveRegion="polite" style={[ui.row, { justifyContent: 'space-between' }]}>
    <Label>{undo.label}</Label><Button label="Undo" disabled={action.busy} onPress={() => void action.run(() => controller.undo())} />
    <Button label="×" accessibilityLabel="Dismiss undo" onPress={controller.dismissUndo} />
  </View><ErrorMessage message={action.error} /></Card>;
}
