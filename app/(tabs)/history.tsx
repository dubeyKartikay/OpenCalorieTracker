import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useAction, useAppRuntime, useHistoryDay, usePreferences, useWeekSummary } from '../../src/app/AppRuntimeContext';
import { localDate, MEALS, shiftDate, sourceLabel } from '../../src/app/controller';
import type { DiaryEntrySnapshot } from '../../src/domain';
import { MacroRow, UndoToast } from '../../src/ui/components/Diary';
import { ActionSheetPopover, CompletenessMark, InlineKeypad, MultiSelectBar, SourceBadge, WeekDateRail } from '../../src/ui/components/doop';
import { Button, Card, energy, ErrorMessage, Heading, Label, Muted, number, Page, ui } from '../../src/ui/components/primitives';
import { colors, MIN_TOUCH_TARGET } from '../../src/ui/tokens';

const rangeDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export default function History() {
  const [date, setDate] = useState(localDate);
  const [weekEnd, setWeekEnd] = useState(localDate);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const result = useHistoryDay(date);
  const week = useWeekSummary(weekEnd);
  const action = useAction();
  const entries = result.value?.day?.entries.filter(entry => entry.draft_state === 'confirmed') ?? [];
  const configuredMeals = preferences.value?.mealSections ?? [...MEALS];
  const meals = [...new Set([...configuredMeals, ...entries.map(entry => entry.meal)])];
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const clearSelection = () => { setSelected([]); setSelecting(false); setMoving(false); };
  const chooseDate = (next: string) => { setDate(next); setExpanded(null); setMenu(null); clearSelection(); };
  const bulkCopy = async () => { await controller.copyEntries(selected, localDate()); clearSelection(); };
  const renderEntry = (entry: DiaryEntrySnapshot) => <Card key={entry.id} style={{ borderWidth: 1, borderColor: selected.includes(entry.id) ? colors.accent : colors.hairline }}>
    <Pressable accessibilityRole={selecting ? 'checkbox' : 'button'} accessibilityLabel={`${entry.food.name}, ${number(entry.quantity.amount, 2)} ${entry.quantity.unit}, ${energy(entry.nutrients.kcal, unit)}`}
      accessibilityState={selecting ? { checked: selected.includes(entry.id) } : { expanded: expanded === entry.id }}
      onPress={() => {
        if (selecting) setSelected(values => values.includes(entry.id) ? values.filter(id => id !== entry.id) : [...values, entry.id]);
        else { setExpanded(value => value === entry.id ? null : entry.id); setAmount(String(entry.quantity.amount)); }
      }} style={{ minHeight: MIN_TOUCH_TARGET, gap: 8 }}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}><View style={{ flex: 1 }}><Heading>{entry.food.name}</Heading><Muted>{number(entry.quantity.amount, 2)} {entry.quantity.unit}</Muted></View>
        <Label style={ui.number}>{energy(entry.nutrients.kcal, unit)}</Label></View>
      <View style={ui.wrap}><SourceBadge label={sourceLabel(entry.food)} /></View>
      {(entry.nutrients.fiber_g === null || (entry.unknown_nutrient_counts?.fiber_g ?? 0) > 0) && <Muted>Fiber · {entry.unknown_nutrient_counts?.fiber_g || 1} unknown</Muted>}
    </Pressable>
    {!selecting && expanded === entry.id && <><InlineKeypad value={amount} onChange={setAmount} maxDecimals={2} />
      <Button label="Save portion" primary disabled={action.busy || !(Number(amount) > 0)} onPress={() => void action.run(async () => {
        await controller.updateEntryQuantity(entry, { ...entry.quantity, amount: Number(amount) }); setExpanded(null);
      })} /><Muted>Move to</Muted><View style={ui.wrap}>{configuredMeals.map(meal => <Button key={meal} label={meal} selected={entry.meal === meal} disabled={action.busy}
        onPress={() => void action.run(async () => {
          await controller.moveEntry(entry, meal);
          setExpanded(null);
        })} />)}</View><Button label="Delete" disabled={action.busy} onPress={() => void action.run(() => controller.deleteEntry(entry.id))} /></>}
  </Card>;
  return <Page title="History" footer={<View style={{ gap: 8 }}>
    {selecting && <MultiSelectBar count={selected.length} onCopyToToday={() => { if (selected.length) void action.run(bulkCopy); }} onMove={() => { if (selected.length) setMoving(value => !value); }}
      onDelete={() => { if (selected.length) void action.run(async () => { await controller.deleteEntries(selected); clearSelection(); }); }} onDone={clearSelection} />}
    <UndoToast /></View>}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}><WeekDateRail style={{ minWidth: 352 }} days={(week.value ?? []).map(day => ({ date: day.date, weekdayInitial: new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' }), dayNumber: day.date.slice(8), completeness: day.completeness, kcal: day.kcal ?? 0 }))}
      selectedDate={date} rangeLabel={`${rangeDate(shiftDate(weekEnd, -6))} – ${rangeDate(weekEnd)}`} onSelectDate={chooseDate}
      onPrevWeek={() => { const next = shiftDate(weekEnd, -7); setWeekEnd(next); chooseDate(next); }}
      onNextWeek={() => { const next = shiftDate(weekEnd, 7); setWeekEnd(next); chooseDate(next); }} disableNext={weekEnd >= localDate()} /></ScrollView>
    <View style={[ui.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Heading>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</Heading>
      <View style={ui.row}><CompletenessMark status={result.value?.day?.completeness ?? 'none'} /><Button label={energy(result.value?.totals.nutrients?.kcal, unit)} onPress={() => setMenu(value => value === 'day' ? null : 'day')} />
        <Button label={selecting ? 'Done' : 'Select'} selected={selecting} onPress={() => { if (selecting) clearSelection(); else { setSelecting(true); setExpanded(null); } }} /></View></View>
    {menu === 'day' && <ActionSheetPopover title="Day completeness" actions={(['complete', 'partial'] as const).map(value => ({ key: value, label: value === 'complete' ? 'Complete' : 'Partial', selected: result.value?.day?.completeness === value,
      onPress: () => void action.run(async () => { await controller.setCompleteness(date, value); setMenu(null); }) }))} />}
    <ErrorMessage message={action.error ?? result.error ?? week.error ?? preferences.error} />{result.loading && <Muted>Loading saved day…</Muted>}
    {result.value && <Card style={{ padding: 12 }}><MacroRow totals={result.value.totals} /></Card>}
    {moving && <Card><Heading>Move selected entries</Heading><View style={ui.wrap}>{configuredMeals.map(meal => <Button key={meal} label={meal} disabled={action.busy} onPress={() => void action.run(async () => {
      await controller.moveEntries(selected, date, meal); clearSelection();
    })} />)}</View></Card>}
    {!entries.length && !result.loading && <Muted>No logged entries for this day.</Muted>}
    {meals.map(meal => <View key={meal} style={{ gap: 12 }}><View style={[ui.row, { justifyContent: 'space-between' }]}><Heading>{meal}</Heading>
      <Button label="…" accessibilityLabel={`Actions for ${meal}`} onPress={() => setMenu(value => value === `meal:${meal}` ? null : `meal:${meal}`)} /></View>
      {menu === `meal:${meal}` && <ActionSheetPopover title={meal} actions={[
        { key: 'copy', label: 'Copy to Today', onPress: () => void action.run(async () => { await controller.copyMeal(date, meal, localDate(), meal); setMenu(null); }) },
        { key: 'add', label: `Add to ${meal}`, onPress: () => { setMenu(null); router.push({ pathname: '/(tabs)/library', params: { meal } }); } },
      ]} />}{entries.filter(entry => entry.meal === meal).map(renderEntry)}</View>)}
  </Page>;
}
