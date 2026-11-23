import { useState } from 'react';
import { router } from 'expo-router';
import { Image, Text, View } from 'react-native';
import { useAction, useActiveDraft, useAIStatus, useAppRuntime, useOfflinePhotoDrafts, usePreferences, useTodayDiary, useTodaySuggestions, useTodayWater } from '../../src/app/AppRuntimeContext';
import { defaultQuantity, localDate, MEALS, type TodaySuggestion } from '../../src/app/controller';
import { generateId, sumNutrients } from '../../src/domain';
import { Budget, UndoToast } from '../../src/ui/components/Diary';
import { QuickAddPanel, WaterCard } from '../../src/ui/components/doop';
import { AIFailedCard, DraftAskChips, DraftItemCard, MealDraftPanel, pickMealImage, SparklePromptRow, type PickedMealImage } from '../../src/ui/components/capture';
import { MealHoldFan, PetalHubLauncher } from '../../src/ui/components/gestures';
import { Button, Card, energy, ErrorMessage, Heading, Input, Label, Muted, number, Page, ui } from '../../src/ui/components/primitives';
import { colors, spacing, TwoPane } from '../../src/ui/tokens';

export default function Today() {
  const { controller } = useAppRuntime();
  const diary = useTodayDiary();
  const preferences = usePreferences();
  const suggestions = useTodaySuggestions(3);
  const action = useAction();
  const ai = useAIStatus();
  const activeDraft = useActiveDraft();
  const water = useTodayWater();
  const offlinePhotos = useOfflinePhotoDrafts();
  const [quickMeal, setQuickMeal] = useState<string | null>(null);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [captureMeal, setCaptureMeal] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PickedMealImage | null>(null);
  const [notice, setNotice] = useState('');
  const retryInput = activeDraft.lastCapture;
  const meals = preferences.value?.mealSections ?? [...MEALS];
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const goToLibrary = (meal = meals[0] ?? 'Breakfast') => router.push({ pathname: '/(tabs)/library', params: { meal } });
  const draft = activeDraft.draft;
  const describeMeal = captureMeal ?? meals[0] ?? 'Lunch';
  const lastWater = water.value?.logs[water.value.logs.length - 1];
  const capture = (input: Parameters<typeof activeDraft.capture>[0] = { text: description, ...(photo ? { imageDataUrl: photo.imageDataUrl } : {}), meal: describeMeal }) => {
    if (!ai.value || ai.loading) return;
    if (ai.value.mode === 'disconnected' || !ai.value.consentAccepted) { router.push('/chatgpt'); return; }
    void activeDraft.capture(input).then(proposal => {
      if (proposal) { setDescribeOpen(false); setDescription(''); setPhoto(null); }
    });
  };
  const pickPhoto = (source: 'camera' | 'library') => void action.run(async () => {
    const picked = await pickMealImage(source);
    if (picked) { setPhoto(picked); setNotice(''); }
  });
  const commit = (suggestion: TodaySuggestion, meal = meals[0] ?? 'Breakfast') => void action.run(async () => {
    if (suggestion.kind === 'saved_meal') await controller.logSavedMeal(suggestion.id, meal, generateId());
    else await controller.confirm({ food: suggestion.food, quantity: defaultQuantity(suggestion.food), meal, idempotencyKey: generateId() });
  });
  return <Page compact footer={<UndoToast />}>
    <View style={[ui.row, { justifyContent: 'space-between', minHeight: 44 }]}>
      <View style={[ui.row, { gap: spacing.s4 }]}>{preferences.value && !preferences.value.onboardingCompleted && <Button label="Set goals" onPress={() => router.push('/onboarding')} />}
        <Button label="Photo" accessibilityLabel="Describe or photograph a meal" quiet onPress={() => setDescribeOpen(value => !value)} /></View>
      <View style={[ui.row, { gap: spacing.s4 }]}><Button label="Recipes" quiet onPress={() => router.push('/recipes')} /><Button label="Settings" quiet onPress={() => router.push('/settings')} /></View>
    </View>
    <ErrorMessage message={action.error ?? diary.error ?? preferences.error ?? suggestions.error ?? water.error ?? offlinePhotos.error} />
    {!!notice && <Text accessibilityLiveRegion="polite" style={ui.muted}>{notice}</Text>}
    {diary.loading && <Muted>Loading diary…</Muted>}
    {/* Pane identities stay stable as TwoPane changes direction, preserving every open form. */}
    <TwoPane gap={spacing.s12} primary={<View style={{ gap: spacing.s12 }}>
    {diary.value && <Budget totals={diary.value.totals} goal={diary.value.goal} leadMetric={preferences.value?.leadMetric ?? 'calories'} waterMl={water.value?.totalMl ?? 0} />}
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
      <Input label={photo ? 'Meal description (optional)' : 'Meal description'} value={description} onChangeText={setDescription} multiline placeholder="2 rotis and 1 katori dal tadka"
        style={{ minHeight: 88, textAlignVertical: 'top' }} editable={!activeDraft.busy} />
      <Muted>Type, dictate, or attach a photo. Only this description and attached photo are sent when you use AI.</Muted>
      <View style={ui.wrap}><Button label="Take photo" disabled={action.busy || activeDraft.busy} onPress={() => pickPhoto('camera')} />
        <Button label="Choose photo" disabled={action.busy || activeDraft.busy} onPress={() => pickPhoto('library')} /></View>
      {photo && <><Image source={{ uri: photo.uri }} accessibilityLabel="Attached meal photo" style={{ width: '100%', height: 160, borderRadius: 12 }} resizeMode="cover" />
        <View style={ui.wrap}><Button label="Remove photo" disabled={action.busy || activeDraft.busy} onPress={() => setPhoto(null)} />
          <Button label="Save photo draft offline" disabled={action.busy || activeDraft.busy} onPress={() => void action.run(async () => {
            await controller.saveOfflinePhotoDraft({ meal: describeMeal, note: description, imageDataUrl: photo.imageDataUrl });
            setPhoto(null); setDescription(''); setDescribeOpen(false); setNotice('Photo draft saved on this device. Analyze it when you are ready.');
          })} /></View></>}
      <View style={ui.wrap}>{meals.map(meal => <Button key={meal} label={meal} selected={describeMeal === meal} disabled={activeDraft.busy} onPress={() => setCaptureMeal(meal)} />)}</View>
      <SparklePromptRow summary={ai.value?.mode !== 'disconnected' && ai.value?.consentAccepted ? 'Draft this meal with AI' : 'Connect ChatGPT to draft this meal'}
        busy={activeDraft.busy} disabled={(!description.trim() && !photo) || action.busy || ai.loading || !ai.value} onPress={() => capture()} />
      <ErrorMessage message={ai.error} /><Button label="Close description" onPress={() => setDescribeOpen(false)} />
    </Card>}
    {draft && <MealDraftPanel mealLabel={draft.meal} draftEnergyText={energy(draft.proposal.totals.nutrients?.kcal, unit)}
      itemCount={draft.proposal.items.length} confirming={activeDraft.busy || action.busy}
      fiberNote={draft.proposal.totals.unknownCount.fiber_g ? 'Fiber is unknown for some items.' : null}
      onConfirmAll={() => void activeDraft.confirmAll()} onDismissAll={activeDraft.discard}
      onSaveAsMeal={name => void action.run(async () => {
        const saved = await activeDraft.saveAsMeal(name); setNotice(`Saved ${saved.name} to your meals.`);
      })}>
      {draft.proposal.items.map((item, index) => <View key={`${index}:${item.food.id}`} style={{ gap: spacing.s4 }}>
        <DraftItemCard name={item.food.name} sourceLabel={item.sourceLabel} isEstimatedSource={item.provenance_kind === 'ai_estimate'}
          portionText={`${number(item.quantity.amount, 2)} ${item.quantity.unit} · ${item.portion_certainty}`}
          portionCertainty={item.portion_certainty} estimateRangeText={item.estimate_range ? `${number(item.estimate_range.min_g, 1)}–${number(item.estimate_range.max_g, 1)} g · ${energy(item.estimate_range.min_kcal, unit)}–${energy(item.estimate_range.max_kcal, unit)}` : null}
          energyText={energy(item.nutrients.kcal, unit)} macrosText={`P ${number(item.nutrients.protein_g, 1)} · C ${number(item.nutrients.carbs_g, 1)} · F ${number(item.nutrients.fat_g, 1)} g`}
          fiberUnknown={item.unknownCount.fiber_g > 0} currentAmount={item.quantity.amount} currentUnit={item.quantity.unit}
          {...(!activeDraft.busy && !action.busy ? { onRemove: () => activeDraft.removeItem(String(index)), onChangeAmount: (amount: number) => activeDraft.updateItemQuantity(index, { ...item.quantity, amount }) } : {})} />
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
    {!!offlinePhotos.value?.length && <Card><Heading>Offline photo drafts</Heading><Muted>Stored on this device until you analyze or discard them.</Muted>
      {offlinePhotos.value.map(saved => <View key={saved.id} style={{ gap: spacing.s8 }}>
        <Image source={{ uri: saved.image_data_url }} accessibilityLabel={`Saved photo for ${saved.meal}`} style={{ width: '100%', height: 120, borderRadius: 8 }} resizeMode="cover" />
        <Label>{saved.meal} · {saved.date}</Label>{!!saved.note && <Muted>{saved.note}</Muted>}
        <View style={ui.wrap}><Button label="Analyze now" disabled={activeDraft.busy || action.busy || ai.loading || !ai.value} onPress={() => {
          if (ai.value?.mode === 'disconnected' || !ai.value?.consentAccepted) { router.push('/chatgpt'); return; }
          void action.run(async () => {
            const analyzed = await activeDraft.capture({ text: saved.note, imageDataUrl: saved.image_data_url, meal: saved.meal, date: saved.date });
            if (analyzed) await controller.deleteOfflinePhotoDraft(saved.id);
          });
        }} /><Button label="Discard" disabled={action.busy || activeDraft.busy} onPress={() => void action.run(() => controller.deleteOfflinePhotoDraft(saved.id))} /></View>
      </View>)}
    </Card>}
    </View>} secondary={<View style={{ gap: spacing.s12 }}>
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
    <WaterCard totalMl={water.value?.totalMl ?? 0} disabled={action.busy || water.loading}
      onAdd={amount => void action.run(() => controller.addWater(amount))}
      {...(lastWater ? { lastAmountMl: lastWater.amount_ml, onUndo: () => void action.run(() => controller.deleteWaterLog(lastWater.id)) } : {})} />
    {quickMeal && <><View style={ui.wrap}>{meals.map(meal => <Button key={meal} label={meal} selected={meal === quickMeal} onPress={() => setQuickMeal(meal)} />)}<Button label="Close quick add" onPress={() => setQuickMeal(null)} /></View>
      <QuickAddPanel mealLabel={quickMeal} energyUnit={unit} disabled={action.busy} onAdd={entry => void action.run(async () => {
        await controller.quickAdd({ kcal: entry.kcal, proteinG: entry.proteinG ?? null, carbsG: entry.carbsG ?? null, fatG: entry.fatG ?? null, meal: quickMeal, idempotencyKey: generateId() }); setQuickMeal(null);
      })} /></>}
    </View>} />
  </Page>;
}
