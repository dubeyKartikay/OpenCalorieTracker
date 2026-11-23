import { View, Text } from 'react-native';
import type { GoalPeriod, NutrientAggregate } from '../../domain';
import { useAction, useAppRuntime, usePreferences } from '../../app/AppRuntimeContext';
import { colors, macroColors, spacing } from '../tokens';
import { Button, Card, energyValue, ErrorMessage, Label, number, ui } from './primitives';
export function MacroRow({ totals, goal }: { totals: NutrientAggregate; goal?: GoalPeriod | null }) {
  return <View style={[ui.row, { alignItems: 'flex-start', gap: spacing.s8 }]}>{([
    ['P', 'protein_g', macroColors.protein], ['C', 'carbs_g', macroColors.carbs], ['F', 'fat_g', macroColors.fat], ['Fiber', 'fiber_g', colors.muted],
  ] as const).map(([label, key, color]) => <View key={key} style={{ flex: 1, minWidth: 0, gap: spacing.s2 }}>
    <Text style={[ui.muted, { color, fontWeight: '700', lineHeight: 16 }]}>{label}</Text>
    <Text style={[ui.number, { fontSize: 12 }]}>{number(totals.nutrients?.[key], 1)}{goal?.[key] != null ? `/${number(goal[key])}` : ''} g</Text>
    {totals.unknownCount[key] > 0 && <Text style={[ui.muted, { fontSize: 10, lineHeight: 14 }]}>· {totals.unknownCount[key]} unknown</Text>}
  </View>)}</View>;
}
export function Budget({ totals, goal, leadMetric = 'calories', waterMl = 0 }: {
  totals: NutrientAggregate; goal: GoalPeriod | null; leadMetric?: 'calories' | 'protein' | 'fiber' | 'water'; waterMl?: number;
}) {
  const unit = usePreferences().value?.energyUnit ?? 'kcal';
  const target = goal?.target_kcal;
  const consumed = totals.nutrients?.kcal;
  const remaining = target != null ? target - (consumed ?? 0) : consumed;
  const leadValue = leadMetric === 'water' ? waterMl : leadMetric === 'protein' ? totals.nutrients?.protein_g : totals.nutrients?.fiber_g;
  const leadLabel = leadMetric === 'water' ? 'ml water' : leadMetric === 'protein' ? 'g protein' : 'g fiber';
  return <Card style={{ padding: spacing.s12, gap: spacing.s8 }}>
    <View style={[ui.row, { alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.s8 }]}>
      {leadMetric !== 'calories' && <Text style={[ui.number, { fontSize: 36, fontWeight: '800', lineHeight: 44 }]}>{number(leadValue, leadMetric === 'water' ? 0 : 1)} <Text style={{ fontSize: 16 }}>{leadLabel}</Text></Text>}
      {leadMetric === 'calories' ? <>
      <Text style={[ui.number, { fontSize: 36, fontWeight: '800', lineHeight: 44 }]}>{number(energyValue(remaining, unit))} <Text style={{ fontSize: 16 }}>{unit}{target != null ? ' left' : ''}</Text></Text>
      {target == null && <Text style={ui.muted}>Observe · no target</Text>}
      </> : <Text style={ui.muted}>{number(energyValue(remaining, unit))} {unit}{target != null ? ' left' : ' · observe'}</Text>}
    </View>
    {target != null && <Text style={ui.muted}>{number(energyValue(consumed, unit))} / {number(energyValue(target, unit))}</Text>}
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
