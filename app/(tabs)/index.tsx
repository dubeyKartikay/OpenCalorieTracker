import { useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAction, useActiveDraft, useAppRuntime, useOfflinePhotoDrafts, usePreferences, useTodayDiary, useTodaySuggestions, useTodayWater } from '../../src/app/AppRuntimeContext';
import { defaultQuantity, localDate, MEALS, mealsForDay, type TodaySuggestion } from '../../src/app/controller';
import { generateId, type DiaryEntrySnapshot } from '../../src/domain';
import { Budget, DayCompletenessToggle, TodayMealRow, UndoToast } from '../../src/ui/components/Diary';
import { WaterCard } from '../../src/ui/components/doop';
import { isDraftForMeal, MealActiveDraftBlock, MealComposerField, MealComposerFooter, MealDraftAuxBlock, useMealInlineComposer, useScrollToMealComposer } from '../../src/ui/components/capture';
import { MealEntryDragProvider, MealHoldFan, PetalHubLauncher } from '../../src/ui/components/gestures';
import { ErrorMessage, formatWeekdayDate, Muted, NoticePill, Page, useTimedNotice } from '../../src/ui/components/primitives';
import { hapticSuccess } from '../../src/ui/haptics';
import { colors, fontFace, TwoPane } from '../../src/ui/tokens';

export default function Today() {
  const { controller } = useAppRuntime();
  const diary = useTodayDiary();
  const preferences = usePreferences();
  const suggestions = useTodaySuggestions(3);
  const action = useAction();
  const activeDraft = useActiveDraft();
  const water = useTodayWater();
  const offlinePhotos = useOfflinePhotoDrafts();
  const [fanMeal, setFanMeal] = useState<string | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [draggingEntry, setDraggingEntry] = useState(false);
  const [expandedMeals, setExpandedMeals] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useTimedNotice();
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);
  const mealRowRefs = useRef<Record<string, ComponentRef<typeof View> | null>>({});
  const today = localDate();
  const draft = activeDraft.draft;
  const draftForToday = Boolean(draft && draft.date === today);
  const failedDraftMeal = activeDraft.actionError?.operation === 'capture' && activeDraft.actionError.date === today ? activeDraft.actionError.meal : null;
  const todayOfflinePhotos = (offlinePhotos.value ?? []).filter(photo => photo.date === today);
  const confirmedEntries = diary.value?.day?.entries.filter(entry => entry.draft_state === 'confirmed') ?? [];
  const configuredMeals = preferences.value?.mealSections ?? [...MEALS];
  const baseMeals = mealsForDay(configuredMeals, confirmedEntries, [
    draftForToday ? draft?.meal : null,
    failedDraftMeal,
    ...todayOfflinePhotos.map(photo => photo.meal),
  ]);
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const currentHour = new Date().getHours();
  const daypart = currentHour < 11 ? 'Breakfast' : currentHour < 15 ? 'Lunch' : currentHour < 18 ? 'Snack' : 'Dinner';
  const activeMeal = baseMeals.find(meal => meal.toLowerCase() === daypart.toLowerCase()) ?? baseMeals[0] ?? 'Breakfast';

  const composer = useMealInlineComposer({
    date: today,
    returnTab: 'today',
    defaultMeal: activeMeal,
    onNotice: setNotice,
  });

  const meals = mealsForDay(baseMeals, [], [composer.fieldMeal]);

  useScrollToMealComposer(scrollRef, scrollOffsetRef, mealRowRefs, composer);

  const blocked = action.busy || composer.blocked;
  const entriesFor = (meal: string) => confirmedEntries.filter(entry => entry.meal === meal);
  const lastWater = water.value?.logs[water.value.logs.length - 1];

  const commit = (suggestion: TodaySuggestion, meal = activeMeal) => void action.run(async () => {
    if (suggestion.kind === 'saved_meal') await controller.logSavedMeal(suggestion.id, meal, generateId());
    else await controller.confirm({ food: suggestion.food, quantity: defaultQuantity(suggestion.food), meal, idempotencyKey: generateId() });
    hapticSuccess();
  });

  const handleDragMoveEntry = (entry: DiaryEntrySnapshot, targetMeal: string) => {
    if (entry.meal === targetMeal) return;
    void action.run(async () => {
      await controller.moveEntries([entry.id], today, targetMeal);
      setExpandedMeals(current => ({ ...current, [targetMeal]: true }));
    });
  };

  return <MealEntryDragProvider
    energyUnit={unit}
    disabled={blocked || Boolean(fanMeal) || hubOpen || Boolean(composer.fieldMeal) || draftForToday}
    scrollRef={scrollRef}
    scrollOffsetRef={scrollOffsetRef}
    onMoveEntry={handleDragMoveEntry}
    onDraggingChange={setDraggingEntry}
  >
    <Page
      compact
      scrollRef={scrollRef}
      scrollEnabled={!hubOpen && !fanMeal && !draggingEntry}
      onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
      footer={<MealComposerFooter composer={composer} />}
      overlay={!composer.fieldMeal ? <UndoToast /> : null}
    >
      <ErrorMessage message={action.error ?? composer.action.error ?? diary.error ?? preferences.error ?? suggestions.error ?? water.error ?? offlinePhotos.error} />
      <NoticePill message={notice} onDismiss={() => setNotice('')} />
      {diary.loading && !diary.value && <Muted>Loading diary…</Muted>}
      <TwoPane gap={draftForToday ? 0 : 28} primary={<View style={{ zIndex: hubOpen ? 100 : 1 }}>
        {!draftForToday && diary.value && <View style={{ zIndex: 1 }}><Budget totals={diary.value.totals} goal={diary.value.goal} leadMetric={preferences.value?.leadMetric ?? 'calories'} waterMl={water.value?.totalMl ?? 0} /></View>}
        {!draftForToday && <PetalHubLauncher suggestions={(suggestions.value ?? []).map(suggestion => ({ id: `${suggestion.kind}:${suggestion.id}`, label: suggestion.name }))}
          onOpenChange={setHubOpen}
          onTapAddMeal={() => composer.openField()} onSelectCapture={kind => { if (kind === 'camera') composer.openCamera(activeMeal); else if (kind === 'voice') composer.voice(activeMeal); else composer.openField(); }}
          onCommitSuggestion={pick => { const suggestion = suggestions.value?.find(item => `${item.kind}:${item.id}` === pick.id); if (suggestion && !blocked) commit(suggestion); }} />}
      </View>} secondary={<View style={{ zIndex: fanMeal ? 100 : 0 }}>
        <View style={styles.sectionHeading}>
          <View style={styles.sectionHeadingCopy}>
            <Text accessibilityRole="header" style={styles.today}>Today</Text>
            <Text style={styles.date}>{formatWeekdayDate(today)}</Text>
          </View>
          <DayCompletenessToggle
            status={diary.value?.day?.completeness ?? 'none'}
            disabled={action.busy}
            onToggle={next => void action.run(() => controller.setCompleteness(today, next))}
          />
        </View>
        <View style={{ marginTop: 8 }}>{meals.map((meal, index) => {
          const entries = entriesFor(meal);
          const usual = suggestions.value?.[Math.min(index, (suggestions.value?.length ?? 1) - 1)];
          const showDraft = isDraftForMeal(draft, meal, today);
          return <View key={meal} ref={node => { mealRowRefs.current[meal] = node; }} collapsable={false} style={{ zIndex: fanMeal === meal ? 100 : meals.length - index }}>
            {showDraft ? (
              <MealActiveDraftBlock
                meal={meal}
                date={today}
                entries={entries}
                energyUnit={unit}
                blocked={blocked}
                onSavedAsMeal={name => setNotice(`Saved ${name} to your meals.`)}
              />
            ) : composer.fieldMeal === meal ? (
              <MealComposerField composer={composer} meal={meal} />
            ) : (
              <TodayMealRow
                meal={meal}
                entries={entries}
                hasNext={index < meals.length - 1 && !draftForToday}
                nextLogged={!!meals[index + 1] && entriesFor(meals[index + 1]!).length > 0}
                expanded={Boolean(expandedMeals[meal])}
                onExpandedChange={open => setExpandedMeals(current => ({ ...current, [meal]: open }))}
                ending={
                  <MealHoldFan accessibilityLabel={`Add to ${meal}`} empty={!entries.length} disabled={blocked}
                    onOpenChange={open => setFanMeal(current => open ? meal : current === meal ? null : current)}
                    onTapAdd={() => composer.openField(meal)}
                    onSelectAction={kind => { if (kind === 'camera') composer.openCamera(meal); else if (kind === 'voice') composer.voice(meal); else if (kind === 'barcode') composer.openBarcode(meal); else composer.openField(meal, kind === 'quick-add'); }}
                    {...(usual ? { usual: { id: usual.id, label: usual.name }, onSelectUsual: () => { if (!blocked) commit(usual, meal); } } : {})} />
                }
              />
            )}
            <MealDraftAuxBlock meal={meal} date={today} blocked={blocked} composer={composer} offlinePhotos={todayOfflinePhotos} />
          </View>;
        })}</View>
        <WaterCard totalMl={water.value?.totalMl ?? 0} disabled={action.busy || water.loading} onAdd={amount => void action.run(() => controller.addWater(amount))}
          onOpenChange={open => { if (open) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 140); }}
          onClear={() => void action.run(async () => { for (const log of water.value?.logs ?? []) await controller.deleteWaterLog(log.id); })}
          {...(lastWater ? { lastAmountMl: lastWater.amount_ml, onUndo: () => void action.run(() => controller.deleteWaterLog(lastWater.id)) } : {})} />
      </View>} />
    </Page>
  </MealEntryDragProvider>;
}

const styles = StyleSheet.create({
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 10, rowGap: 4 },
  sectionHeadingCopy: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexShrink: 1 },
  today: { ...fontFace('bold'), color: colors.ink, fontSize: 24, letterSpacing: -0.4 },
  date: { ...fontFace('medium'), color: colors.muted, fontSize: 13 },
});
