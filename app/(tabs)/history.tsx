import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAction, useAppRuntime, useHistoryDay } from '../../src/app/AppRuntimeContext';
import { localDate, MEALS, shiftDate, sourceLabel } from '../../src/app/controller';
import type { DiaryEntrySnapshot } from '../../src/domain';
import { Budget, UndoToast } from '../../src/ui/components/Diary';
import { Badge, Button, Card, ErrorMessage, Heading, Label, Muted, number, Page, ui } from '../../src/ui/components/primitives';
export default function History() {
  const [date, setDate] = useState(localDate);
  const [moving, setMoving] = useState<string | null>(null);
  const { controller } = useAppRuntime();
  const result = useHistoryDay(date);
  const action = useAction();
  const entries = result.value?.day?.entries.filter(entry => entry.draft_state === 'confirmed') ?? [];
  const other = entries.filter(entry => !MEALS.includes(entry.meal as typeof MEALS[number]));
  const renderEntry = (entry: DiaryEntrySnapshot) => <Card key={entry.id}><Heading>{entry.food.name}</Heading>
    <View style={[ui.row, { justifyContent: 'space-between' }]}><Label style={ui.number}>{number(entry.quantity.amount, 2)} {entry.quantity.unit}</Label>
      <Label style={ui.number}>{number(entry.nutrients.kcal)} kcal</Label></View>
    <View style={ui.wrap}><Badge label={sourceLabel(entry.food)} /></View>
    {(entry.nutrients.fiber_g === null || (entry.unknown_nutrient_counts?.fiber_g ?? 0) > 0) && <Muted>Fiber · {entry.unknown_nutrient_counts?.fiber_g || 1} unknown</Muted>}
    <View style={ui.wrap}><Button label="Delete" disabled={action.busy} onPress={() => void action.run(() => controller.deleteEntry(entry.id))} />
      <Button label="Move meal" onPress={() => setMoving(old => old === entry.id ? null : entry.id)} /></View>
    {moving === entry.id && <View style={ui.wrap}>{MEALS.map(meal => <Button key={meal} label={meal} selected={entry.meal === meal} disabled={action.busy}
      onPress={() => void action.run(async () => { await controller.moveEntry(entry, meal); setMoving(null); })} />)}</View>}
  </Card>;
  return <Page title="History"><View style={[ui.row, { justifyContent: 'space-between' }]}>
    <Button label="‹" accessibilityLabel="Previous day" onPress={() => setDate(value => shiftDate(value, -1))} />
    <Label style={ui.number}>{date}</Label><Button label="›" accessibilityLabel="Next day" onPress={() => setDate(value => shiftDate(value, 1))} /></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.wrap}>{Array.from({ length: 7 }, (_, index) => shiftDate(localDate(), index - 6)).map(day =>
      <Button key={day} label={day.slice(5)} selected={date === day} accessibilityLabel={`Show ${day}`} onPress={() => setDate(day)} />)}</ScrollView>
    <View style={ui.wrap}>{(['complete', 'partial'] as const).map(value => <Button key={value} label={value === 'complete' ? 'Complete' : 'Partial'} selected={result.value?.day?.completeness === value}
      disabled={action.busy || result.loading} onPress={() => void action.run(() => controller.setCompleteness(date, value))} />)}</View>
    <ErrorMessage message={action.error ?? result.error} />{result.loading && <Muted>Loading saved day…</Muted>}
    {result.value && <Budget totals={result.value.totals} goal={result.value.goal} />}
    {!entries.length && !result.loading && <Muted>No logged entries for this day.</Muted>}
    {MEALS.map(meal => entries.some(entry => entry.meal === meal) ? <View key={meal} style={{ gap: 12 }}><Heading>{meal}</Heading>{entries.filter(entry => entry.meal === meal).map(renderEntry)}</View> : null)}
    {other.length > 0 && <><Heading>Other meals</Heading>{other.map(renderEntry)}</>}<UndoToast />
  </Page>;
}
