import { useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useAction, useActiveDraft, useAIStatus, useAppRuntime, usePreferences, useTodayDiary, useTodaySuggestions } from '../../src/app/AppRuntimeContext';
import { defaultQuantity, localDate, MEALS, type TodaySuggestion } from '../../src/app/controller';
import { generateId, sumNutrients } from '../../src/domain';
import { Budget, UndoToast } from '../../src/ui/components/Diary';
import { QuickAddPanel } from '../../src/ui/components/doop';
import { AIFailedCard, DraftAskChips, DraftItemCard, MealDraftPanel, SparklePromptRow } from '../../src/ui/components/capture';
import { MealHoldFan, PetalHubLauncher } from '../../src/ui/components/gestures';
import { Button, Card, energy, ErrorMessage, Heading, Input, Label, Muted, number, Page, ui } from '../../src/ui/components/primitives';
import { colors, spacing } from '../../src/ui/tokens';

export default function Today() {
  const { controller } = useAppRuntime();
  const diary = useTodayDiary();
  const preferences = usePreferences();
  const suggestions = useTodaySuggestions(3);
  const action = useAction();
  const ai = useAIStatus();
  const activeDraft = useActiveDraft();
  const [quickMeal, setQuickMeal] = useState<string | null>(null);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [captureMeal, setCaptureMeal] = useState<string | null>(null);
  const retryInput = activeDraft.lastCapture;
  const meals = preferences.value?.mealSections ?? [...MEALS];
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const goToLibrary = (meal = meals[0] ?? 'Breakfast') => router.push({ pathname: '/(tabs)/library', params: { meal } });
  const draft = activeDraft.draft;
  const describeMeal = captureMeal ?? meals[0] ?? 'Lunch';
  const capture = (input = { text: description, meal: describeMeal }) => {
    if (!ai.value || ai.loading) return;
    if (ai.value.mode === 'disconnected' || !ai.value.consentAccepted) { router.push('/chatgpt'); return; }
    void activeDraft.capture(input);
  };
  const commit = (suggestion: TodaySuggestion, meal = meals[0] ?? 'Breakfast') => void action.run(async () => {
    if (suggestion.kind === 'saved_meal') await controller.logSavedMeal(suggestion.id, meal, generateId());
    else await controller.confirm({ food: suggestion.food, quantity: defaultQuantity(suggestion.food), meal, idempotencyKey: generateId() });
  });
  return <Page compact footer={<UndoToast />}>
    <View style={[ui.row, { justifyContent: 'space-between', minHeight: 44 }]}>
      <View>{preferences.value && !preferences.value.onboardingCompleted && <Button label="Set goals" onPress={() => router.push('/onboarding')} />}</View>
      <View style={[ui.row, { gap: spacing.s4 }]}><Button label="Recipes" quiet onPress={() => router.push('/recipes')} /><Button label="Settings" quiet onPress={() => router.push('/settings')} /></View>
    </View>
    <ErrorMessage message={action.error ?? diary.error ?? preferences.error ?? suggestions.error} />
    {diary.loading && <Muted>Loading diary…</Muted>}
    {diary.value && <Budget totals={diary.value.totals} goal={diary.value.goal} />}
    <PetalHubLauncher suggestions={(suggestions.value ?? []).map(suggestion => {
      const portion = suggestion.kind === 'saved_meal' ? null : defaultQuantity(suggestion.food);
      return { id: `${suggestion.kind}:${suggestion.id}`, label: suggestion.name, ...(portion ? { subtitle: `${number(portion.amount, 2)} ${portion.unit}` } : {}) };
    })}
      onTapAddMeal={() => goToLibrary()} onSelectCapture={kind => {
        if (kind === 'search') goToLibrary();
        else if (kind === 'camera') router.push('/barcode');
        else { setDescribeOpen(true); setCaptureMeal(meals[0] ?? 'Lunch'); }
      }}
      onCommitSuggestion={pick => { const suggestion = suggestions.value?.find(item => `${item.kind}:${item.id}` === pick.id); if (suggestion && !action.busy) commit(suggestion); }} />
    {describeOpen && <Card><Heading>Describe meal</Heading>
      <Input label="Meal description" value={description} onChangeText={setDescription} multiline placeholder="2 rotis and 1 katori dal tadka"
        style={{ minHeight: 88, textAlignVertical: 'top' }} editable={!activeDraft.busy} />
      <Muted>Type or use your device keyboard’s dictation. Only this description is sent when you use AI.</Muted>
      <View style={ui.wrap}>{meals.map(meal => <Button key={meal} label={meal} selected={describeMeal === meal} disabled={activeDraft.busy} onPress={() => setCaptureMeal(meal)} />)}</View>
      <SparklePromptRow summary={ai.value?.mode !== 'disconnected' && ai.value?.consentAccepted ? 'Draft this meal with AI' : 'Connect ChatGPT to draft this meal'}
        busy={activeDraft.busy} disabled={!description.trim() || ai.loading || !ai.value} onPress={() => capture()} />
      <ErrorMessage message={ai.error} /><Button label="Close description" onPress={() => setDescribeOpen(false)} />
    </Card>}
    {draft && <MealDraftPanel mealLabel={draft.meal} draftEnergyText={energy(draft.proposal.totals.nutrients?.kcal, unit)}
      itemCount={draft.proposal.items.length} confirming={activeDraft.busy}
      fiberNote={draft.proposal.totals.unknownCount.fiber_g ? 'Fiber is unknown for some items.' : null}
      onConfirmAll={() => void activeDraft.confirmAll()} onDismissAll={activeDraft.discard}>
      {draft.proposal.items.map((item, index) => <View key={`${index}:${item.food.id}`} style={{ gap: spacing.s4 }}>
        <DraftItemCard name={item.food.name} sourceLabel={item.sourceLabel} isEstimatedSource={item.provenance_kind === 'ai_estimate'}
          portionText={`${number(item.quantity.amount, 2)} ${item.quantity.unit} · ${item.portion_certainty}`}
          portionCertainty={item.portion_certainty} estimateRangeText={item.estimate_range ? `${number(item.estimate_range.min_g, 1)}–${number(item.estimate_range.max_g, 1)} g · ${energy(item.estimate_range.min_kcal, unit)}–${energy(item.estimate_range.max_kcal, unit)}` : null}
          energyText={energy(item.nutrients.kcal, unit)} macrosText={`P ${number(item.nutrients.protein_g, 1)} · C ${number(item.nutrients.carbs_g, 1)} · F ${number(item.nutrients.fat_g, 1)} g`}
          fiberUnknown={item.unknownCount.fiber_g > 0} {...(!activeDraft.busy ? { onRemove: () => activeDraft.removeItem(String(index)) } : {})} />
        {item.assumption_note && <Muted>{item.assumption_note}</Muted>}
      </View>)}
      {draft.proposal.clarifying_questions.slice(0, 2).map(question => <DraftAskChips key={question.id} questionId={question.id} label={question.label}
        options={question.options.map(option => ({ id: option.id, label: option.label, selected: draft.proposal.answers[question.id] === option.id }))}
        onSelect={(questionId, optionId) => { if (!activeDraft.busy) void activeDraft.answerQuestion(questionId, optionId); }} />)}
    </MealDraftPanel>}
    {activeDraft.error && <AIFailedCard mealLabel={retryInput?.meal ?? draft?.meal ?? describeMeal} reasonText={activeDraft.error}
      {...(retryInput ? { onRetry: () => { if (!activeDraft.busy) capture(retryInput); } } : {})}
      onSearchInstead={() => goToLibrary(retryInput?.meal ?? draft?.meal ?? describeMeal)}
      onQuickAdd={() => setQuickMeal(retryInput?.meal ?? draft?.meal ?? describeMeal)} onDismiss={activeDraft.clearError} />}
    <View style={[ui.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Heading>Today · {new Date(`${localDate()}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</Heading>
      <Button label="Quick add" onPress={() => setQuickMeal(value => value ? null : meals[0] ?? 'Breakfast')} /></View>
    <Card style={{ padding: 0, gap: 0 }}>{meals.map((meal, index) => {
      const entries = diary.value?.day?.entries.filter(entry => entry.meal === meal && entry.draft_state === 'confirmed') ?? [];
      const latest = entries[entries.length - 1];
      const usual = suggestions.value?.[0];
      return <View key={`${meal}:${index}`} style={[ui.row, { minHeight: 56, paddingHorizontal: spacing.s12, paddingVertical: spacing.s6, borderBottomWidth: index === meals.length - 1 ? 0 : 1, borderBottomColor: colors.hairline, zIndex: meals.length - index }]}>
        <View style={{ flex: 1, minWidth: 0, gap: spacing.s2 }}><Heading>{meal}</Heading><Text numberOfLines={1} style={[ui.muted, { lineHeight: 16 }]}>{latest ? `${latest.food.name}${entries.length > 1 ? ` · ${entries.length - 1} more` : ''}` : 'No entries'}</Text></View>
        <Label style={ui.number}>{entries.length ? energy(sumNutrients(entries).nutrients?.kcal, unit) : '—'}</Label>
        <MealHoldFan accessibilityLabel={`Add to ${meal}`} onTapAdd={() => goToLibrary(meal)}
          onSelectAction={kind => kind === 'search' ? goToLibrary(meal) : kind === 'quick-add' ? setQuickMeal(meal) : router.push({ pathname: '/barcode', params: { meal } })}
          {...(usual ? { usual: { id: usual.id, label: usual.name }, onSelectUsual: () => { if (!action.busy) commit(usual, meal); } } : {})} />
      </View>;
    })}</Card>
    {quickMeal && <><View style={ui.wrap}>{meals.map(meal => <Button key={meal} label={meal} selected={meal === quickMeal} onPress={() => setQuickMeal(meal)} />)}<Button label="Close quick add" onPress={() => setQuickMeal(null)} /></View>
      <QuickAddPanel mealLabel={quickMeal} energyUnit={unit} disabled={action.busy} onAdd={entry => void action.run(async () => {
        await controller.quickAdd({ kcal: entry.kcal, proteinG: entry.proteinG ?? null, carbsG: entry.carbsG ?? null, fatG: entry.fatG ?? null, meal: quickMeal, idempotencyKey: generateId() }); setQuickMeal(null);
      })} /></>}
  </Page>;
}
