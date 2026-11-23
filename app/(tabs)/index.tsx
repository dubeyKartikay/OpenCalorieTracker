import { useState } from 'react';
import { router } from 'expo-router';
import { View, Text } from 'react-native';
import { useAction, useAppRuntime, usePreferences, useTodayDiary, useTodaySuggestions } from '../../src/app/AppRuntimeContext';
import { defaultQuantity, localDate, MEALS, type TodaySuggestion } from '../../src/app/controller';
import { generateId, sumNutrients } from '../../src/domain';
import { Budget, UndoToast } from '../../src/ui/components/Diary';
import { QuickAddPanel } from '../../src/ui/components/doop';
import { MealHoldFan, PetalHubLauncher } from '../../src/ui/components/gestures';
import { Button, Card, energy, ErrorMessage, Heading, Label, Muted, Page, ui } from '../../src/ui/components/primitives';
import { colors, spacing } from '../../src/ui/tokens';

export default function Today() {
  const { controller } = useAppRuntime();
  const diary = useTodayDiary();
  const preferences = usePreferences();
  const suggestions = useTodaySuggestions(3);
  const action = useAction();
  const [status, setStatus] = useState('');
  const [quickMeal, setQuickMeal] = useState<string | null>(null);
  const meals = preferences.value?.mealSections ?? [...MEALS];
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const goToLibrary = (meal = meals[0] ?? 'Breakfast') => router.push({ pathname: '/(tabs)/library', params: { meal } });
  const captureNotice = () => setStatus('Camera/barcode and AI voice capture arrive in Slice 3 — use Search or Quick add now');
  const commit = (suggestion: TodaySuggestion, meal = meals[0] ?? 'Breakfast') => void action.run(async () => {
    if (suggestion.kind === 'saved_meal') await controller.logSavedMeal(suggestion.id, meal, generateId());
    else await controller.confirm({ food: suggestion.food, quantity: defaultQuantity(suggestion.food), meal, idempotencyKey: generateId() });
    setStatus('');
  });
  return <Page title="Today" action={<Button label="Settings" onPress={() => router.push('/settings')} />} footer={<UndoToast />}>
    <View style={ui.wrap}><Button label="Recipes →" onPress={() => router.push('/recipes')} />
      {preferences.value && !preferences.value.onboardingCompleted && <Button label="Set goals" onPress={() => router.push('/onboarding')} />}</View>
    <ErrorMessage message={action.error ?? diary.error ?? preferences.error ?? suggestions.error} />
    {diary.loading && <Muted>Loading diary…</Muted>}
    {diary.value && <Budget totals={diary.value.totals} goal={diary.value.goal} />}
    {!!status && <Card><Text accessibilityLiveRegion="polite" style={ui.muted}>{status}</Text><Button label="Dismiss" onPress={() => setStatus('')} /></Card>}
    <PetalHubLauncher suggestions={(suggestions.value ?? []).map(suggestion => ({ id: `${suggestion.kind}:${suggestion.id}`, label: suggestion.name, subtitle: suggestion.kind === 'saved_meal' ? 'Saved meal' : 'Default portion' }))}
      onTapAddMeal={() => goToLibrary()} onSelectCapture={capture => capture === 'search' ? goToLibrary() : captureNotice()}
      onCommitSuggestion={pick => { const suggestion = suggestions.value?.find(item => `${item.kind}:${item.id}` === pick.id); if (suggestion && !action.busy) commit(suggestion); }} />
    <View style={[ui.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Heading>Today · {new Date(`${localDate()}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</Heading>
      <Button label="Quick add" onPress={() => setQuickMeal(value => value ? null : meals[0] ?? 'Breakfast')} /></View>
    <Card style={{ padding: 0, gap: 0 }}>{meals.map((meal, index) => {
      const entries = diary.value?.day?.entries.filter(entry => entry.meal === meal && entry.draft_state === 'confirmed') ?? [];
      const latest = entries[entries.length - 1];
      const usual = suggestions.value?.[0];
      return <View key={`${meal}:${index}`} style={[ui.row, { padding: spacing.s12, borderBottomWidth: index === meals.length - 1 ? 0 : 1, borderBottomColor: colors.hairline, zIndex: meals.length - index }]}>
        <View style={{ flex: 1, gap: spacing.s4 }}><Heading>{meal}</Heading><Muted>{latest ? `${latest.food.name}${entries.length > 1 ? ` · ${entries.length - 1} more` : ''}` : 'No entries'}</Muted></View>
        <Label style={ui.number}>{entries.length ? energy(sumNutrients(entries).nutrients?.kcal, unit) : '—'}</Label>
        <MealHoldFan accessibilityLabel={`Add to ${meal}`} onTapAdd={() => goToLibrary(meal)}
          onSelectAction={kind => kind === 'search' ? goToLibrary(meal) : kind === 'quick-add' ? setQuickMeal(meal) : captureNotice()}
          {...(usual ? { usual: { id: usual.id, label: usual.name }, onSelectUsual: () => { if (!action.busy) commit(usual, meal); } } : {})} />
      </View>;
    })}</Card>
    {quickMeal && <><View style={ui.wrap}>{meals.map(meal => <Button key={meal} label={meal} selected={meal === quickMeal} onPress={() => setQuickMeal(meal)} />)}<Button label="Close quick add" onPress={() => setQuickMeal(null)} /></View>
      <QuickAddPanel mealLabel={quickMeal} energyUnit={unit} disabled={action.busy} onAdd={entry => void action.run(async () => {
        await controller.quickAdd({ kcal: entry.kcal, proteinG: entry.proteinG ?? null, carbsG: entry.carbsG ?? null, fatG: entry.fatG ?? null, meal: quickMeal, idempotencyKey: generateId() }); setQuickMeal(null);
      })} /></>}
  </Page>;
}
