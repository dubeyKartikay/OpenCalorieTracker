import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAction, useAppRuntime, useAsyncResource, usePreferences, useProgressData, useTodayDiary } from '../../src/app/AppRuntimeContext';
import { localDate, shiftDate } from '../../src/app/controller';
import { calculateWeeklyRate } from '../../src/domain';
import { CalorieBarChart, InlineKeypad, MacroProportionBar, WeightTrendChart } from '../../src/ui/components/doop';
import { Button, Card, energy, ErrorMessage, Heading, Label, Muted, number, Page, ui } from '../../src/ui/components/primitives';
import { colors, macroColors } from '../../src/ui/tokens';

const KG_TO_LB = 2.2046226218;
export default function Progress() {
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  const [range, setRange] = useState(7);
  const [weight, setWeight] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const action = useAction();
  const preferences = usePreferences();
  const today = useTodayDiary();
  const result = useProgressData(range);
  const end = localDate();
  const daily = useAsyncResource(useCallback(async () => {
    void revision;
    return Promise.all(Array.from({ length: range }, async (_, index) => {
      const date = shiftDate(end, index + 1 - range);
      const day = await controller.day(date);
      return { date, shortLabel: date.slice(8), kcal: day.totals.nutrients?.kcal ?? 0, targetKcal: day.goal?.target_kcal ?? null,
        completeness: day.day?.completeness ?? 'none' as const,
        proteinG: day.totals.nutrients?.protein_g, carbsG: day.totals.nutrients?.carbs_g, fatG: day.totals.nutrients?.fat_g };
    }));
  }, [controller, end, range, revision]));
  const value = result.value;
  const unit = preferences.value?.weightUnit ?? 'kg';
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const factor = unit === 'lb' ? KG_TO_LB : 1;
  const visibleTrend = (value?.trend ?? []).filter(point => point.weighIn.date >= shiftDate(end, 1 - range) && point.weighIn.date <= end);
  const latest = value?.trend[value.trend.length - 1];
  const weeklyRate = calculateWeeklyRate(visibleTrend);
  return <Page title="Progress"><View style={ui.wrap}>{[7, 30].map(days => <Button key={days} label={`${days}d`} selected={range === days} onPress={() => { setRange(days); setSelectedDay(null); }} />)}</View>
    <ErrorMessage message={result.error ?? daily.error ?? action.error ?? preferences.error ?? today.error} />
    <Muted>{value?.completeDays ?? '—'} of {range} days complete · partial/unlogged excluded</Muted>
    <ScrollView horizontal showsHorizontalScrollIndicator><View style={{ width: range * 50 + 32 }}>
      <CalorieBarChart days={daily.value ?? []} selectedDate={selectedDay} onSelectDay={setSelectedDay} energyUnit={energyUnit} />
    </View></ScrollView>
    <Card><Heading>Daily averages</Heading><Label style={ui.number}>{energy(value?.averages?.kcal, energyUnit)}</Label>
      <MacroProportionBar proteinG={value?.averages?.protein_g ?? 0} carbsG={value?.averages?.carbs_g ?? 0} fatG={value?.averages?.fat_g ?? 0} />
      {([['P', 'protein_g', macroColors.protein], ['C', 'carbs_g', macroColors.carbs], ['F', 'fat_g', macroColors.fat], ['Fiber', 'fiber_g', colors.muted]] as const).map(([label, key, color]) =>
        <View key={key} style={[ui.row, { justifyContent: 'space-between' }]}><Label style={{ color }}>{label}</Label>
          <Label style={{ ...ui.number, color }}>{number(value?.averages?.[key], 1)} / {number(today.value?.goal?.[key], 1)} g</Label></View>)}
      {!!value?.unknownCount.fiber_g && <Muted>Fiber · {value.unknownCount.fiber_g} unknown</Muted>}
    </Card>
    <Card><Heading>Weight</Heading><View style={ui.wrap}>{(['kg', 'lb'] as const).map(weightUnit => <Button key={weightUnit} label={weightUnit} selected={unit === weightUnit} disabled={action.busy}
      onPress={() => void action.run(async () => { await controller.updatePreferences({ weightUnit }); setWeight(''); })} />)}</View>
      <Label style={ui.number}>{number(latest ? latest.trendKg * factor : null, 1)} {unit} trend</Label>
      <Label style={ui.number}>{number(weeklyRate === null ? null : weeklyRate * factor, 2)} {unit}/week</Label>
      {latest && <Muted>Last measured {latest.weighIn.date}</Muted>}
      <WeightTrendChart points={visibleTrend.map(point => ({ date: point.weighIn.date, shortLabel: point.weighIn.date.slice(5), rawKg: point.weighIn.weight_kg, trendKg: point.trendKg }))}
        unit={unit} showInfo={showInfo} onToggleInfo={() => setShowInfo(value => !value)} />
      <Heading>Quick weigh-in · {unit}</Heading><InlineKeypad value={weight} onChange={setWeight} maxDecimals={2} />
      <Button label="Record weigh-in" primary disabled={action.busy || !(Number(weight) > 0)} onPress={() => void action.run(async () => {
        await controller.weighIn(Number(weight) / factor); setWeight('');
      })} />
    </Card>
  </Page>;
}
