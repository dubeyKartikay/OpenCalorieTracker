import { useCallback, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { useAction, useActiveDraft, useAppRuntime, useDateRangeCalendarLoader, useHistoryDay, useOfflinePhotoDrafts, usePreferences, useTodayDiary, useTodaySuggestions, useWeekSummary } from '../../src/app/AppRuntimeContext';
import { defaultQuantity, localDate, MEALS, mealsForDay, parseRouteDate, shiftDate, type TodaySuggestion } from '../../src/app/controller';
import { generateId, type DiaryEntrySnapshot } from '../../src/domain';
import { MealRailShell, UndoToast } from '../../src/ui/components/Diary';
import { EntryEditPopover, MultiSelectBar, RevealPanel, WeekDateRail } from '../../src/ui/components/doop';
import { AnchoredPopover, measurePopoverAnchor } from '../../src/ui/components/doop/HistoryControls';
import type { PopoverAnchor } from '../../src/ui/components/doop/HistoryControls';
import { RailMonthSheet, railRangeLabel, shortRailDate, weekEndForDate } from '../../src/ui/components/doop/WeekDateRail';
import { isDraftForMeal, MealActiveDraftBlock, MealComposerStage, MealDraftAuxBlock, useComposerPushOff, useMealInlineComposer } from '../../src/ui/components/capture';
import { DraggableEntryRow, MealEntryDragProvider, MealHoldFan, useMealEntryDrag } from '../../src/ui/components/gestures';
import { DoopIcon } from '../../src/ui/components/DoopIcons';
import { Button, energyValue, ErrorMessage, Muted, NoticePill, number, Page, ui, useTimedNotice } from '../../src/ui/components/primitives';
import { useAbandonOnTabPress } from '../../src/ui/components/tabAbandon';
import { hapticLight, hapticSelection, hapticSuccess } from '../../src/ui/haptics';
import { colors, fontFace, macroColors, radius, tabularNums, TwoPane } from '../../src/ui/tokens';

const entryTime = (entry: DiaryEntrySnapshot) => {
  const date = new Date(entry.occurred_at);
  if (Number.isNaN(date.getTime())) return '—';
  try { return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: entry.time_zone }); }
  catch { return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
};

export default function History() {
  const params = useLocalSearchParams<{ date?: string; selection?: string }>();
  return <HistoryDay key={`${params.date ?? ''}-${params.selection ?? ''}`} initialDate={parseRouteDate(params.date) ?? localDate()} />;
}

function HistoryDay({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [weekEnd, setWeekEnd] = useState(() => weekEndForDate(initialDate));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const [calendarIntent, setCalendarIntent] = useState<'navigate' | 'move' | 'copy'>('navigate');
  const [copyMeal, setCopyMeal] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const [savedMeal, setSavedMeal] = useState<string | null>(null);
  const [fanMeal, setFanMeal] = useState<string | null>(null);
  const [draggingEntry, setDraggingEntry] = useState(false);
  const [notice, setNotice] = useTimedNotice();
  const totalAnchor = useRef<ComponentRef<typeof View>>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);

  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const todayDiary = useTodayDiary();
  const suggestions = useTodaySuggestions(3);
  const activeDraft = useActiveDraft();
  const offlinePhotos = useOfflinePhotoDrafts();
  const result = useHistoryDay(date);
  const week = useWeekSummary(weekEnd);
  const loadCalendar = useDateRangeCalendarLoader();
  const action = useAction();

  const today = localDate();
  const isToday = date === today;
  const activeDay = result.value ?? (isToday ? todayDiary.value : undefined);
  const entries = activeDay?.day?.entries.filter(entry => entry.draft_state === 'confirmed') ?? [];
  const configuredMeals = preferences.value?.mealSections ?? [...MEALS];
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const draft = activeDraft.draft;
  const draftForDate = Boolean(draft && draft.date === date);
  const failedDraftMeal = activeDraft.actionError?.operation === 'capture' && activeDraft.actionError.date === date ? activeDraft.actionError.meal : null;
  const dayOfflinePhotos = (offlinePhotos.value ?? []).filter(photo => photo.date === date);

  const chooseDateRaw = useCallback((next: string) => {
    setDate(next);
    setWeekEnd(weekEndForDate(next));
    setExpanded(null);
    setAnchor(null);
    setSelected([]);
    setSelecting(false);
    setMoving(false);
  }, []);

  const composer = useMealInlineComposer({
    date,
    returnTab: 'history',
    defaultMeal: configuredMeals[0] ?? 'Breakfast',
    onNotice: setNotice,
    onTargetDateChange: chooseDateRaw,
  });

  const meals = mealsForDay(configuredMeals, entries, [
    composer.fieldMeal,
    draftForDate ? draft?.meal : null,
    failedDraftMeal,
    ...dayOfflinePhotos.map(photo => photo.meal),
  ]);

  const pushOff = useComposerPushOff(composer.fieldMeal, meals);

  const blocked = action.busy || composer.blocked;

  const clearSelection = () => { setSelected([]); setSelecting(false); setMoving(false); };
  const closeMenu = () => { setAnchor(null); };

  useAbandonOnTabPress(() => {
    if (composer.fieldMeal) composer.closeField();
    clearSelection();
    closeMenu();
    setExpanded(null);
    setFanMeal(null);
  });
  const chooseDate = (next: string) => {
    composer.closeField();
    chooseDateRaw(next);
  };
  const openMenu = (value: string, node: ComponentRef<typeof View> | null) => measurePopoverAnchor(node, measured => { setAnchor(measured); setMenu(value); });

  const moveEntry = (entry: DiaryEntrySnapshot, toDate: string, meal = entry.meal) => void action.run(async () => {
    await controller.moveEntries([entry.id], toDate, meal);
    closeMenu();
    setExpanded(null);
  });

  const calendarSelect = (next: string) => {
    if (action.busy) return;
    if (calendarIntent === 'move') {
      if (next === date) {
        closeMenu();
        return;
      }
      const entry = entries.find(item => item.id === expanded);
      if (entry) moveEntry(entry, next);
    } else if (calendarIntent === 'copy' && copyMeal) {
      if (next === date) {
        closeMenu();
        return;
      }
      void action.run(async () => { await controller.copyMeal(date, copyMeal, next, copyMeal); closeMenu(); });
    } else chooseDate(next);
  };

  const commitUsual = (suggestion: TodaySuggestion, meal: string) => void action.run(async () => {
    if (suggestion.kind === 'saved_meal') await controller.logSavedMeal(suggestion.id, meal, date, generateId());
    else await controller.confirm({ food: suggestion.food, quantity: defaultQuantity(suggestion.food), meal, date, idempotencyKey: generateId() });
    hapticSuccess();
  });

  const toggleEntry = (id: string) => {
    hapticSelection();
    setSelected(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  };
  const activeEntry = entries.find(entry => entry.id === expanded);
  const activeMeal = menu?.startsWith('meal:') ? menu.slice(5) : null;
  const mealEntries = activeMeal ? entries.filter(entry => entry.meal === activeMeal) : [];
  const totals = activeDay?.totals.nutrients;
  const days = Array.from({ length: 7 }, (_, index) => {
    const value = shiftDate(weekEnd, index - 6);
    const saved = week.value?.find(day => day.date === value);
    return { date: value, weekdayInitial: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][index] ?? '', dayNumber: value.slice(8), completeness: saved?.completeness ?? 'none' as const, kcal: saved?.kcal ?? 0 };
  });

  const handleDragMoveEntry = (entry: DiaryEntrySnapshot, targetMeal: string) => {
    if (entry.meal === targetMeal) return;
    void action.run(async () => {
      await controller.moveEntries([entry.id], date, targetMeal);
      closeMenu();
      setExpanded(null);
    });
  };

  return <MealEntryDragProvider
    energyUnit={unit}
    disabled={blocked || selecting || Boolean(fanMeal) || Boolean(composer.fieldMeal) || draftForDate || Boolean(anchor)}
    scrollRef={scrollRef}
    scrollOffsetRef={scrollOffsetRef}
    onMoveEntry={handleDragMoveEntry}
    onDraggingChange={setDraggingEntry}
  >
    <Page
      scrollRef={scrollRef}
      scrollEnabled={!fanMeal && !draggingEntry && !composer.fieldMeal}
      contentPointerEvents={composer.fieldMeal ? 'none' : 'auto'}
      onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
      footer={selecting ? (
        <RevealPanel visible={selecting} direction="up">
          <MultiSelectBar
            count={selected.length}
            disabled={action.busy}
            copyDisabled={isToday}
            onCopyToToday={() => { if (selected.length && !isToday) void action.run(async () => { await controller.copyEntries(selected, today); clearSelection(); }); }}
            onMove={() => { if (selected.length) setMoving(value => !value); }}
            onDelete={() => { if (selected.length) void action.run(async () => { await controller.deleteEntries(selected); clearSelection(); }); }}
            onDone={clearSelection}
          />
        </RevealPanel>
      ) : null}
      stage={<MealComposerStage composer={composer} entries={entries} subtitle={isToday ? undefined : shortRailDate(date)} />}
      overlay={!selecting && !composer.fieldMeal ? <UndoToast /> : null}
    >
      <TwoPane gap={28} primary={<Animated.View style={pushOff.pushUpStyle}>
        <WeekDateRail days={days} selectedDate={date} rangeLabel={railRangeLabel(shiftDate(weekEnd, -6), weekEnd)} energyUnit={unit} onSelectDate={chooseDate} maxDate={today}
          onOpenCalendar={node => { setCalendarIntent('navigate'); openMenu('calendar', node); }}
          onPrevWeek={() => chooseDate(shiftDate(date, -7))}
          onNextWeek={() => chooseDate(shiftDate(date, 7) > today ? today : shiftDate(date, 7))} disableNext={weekEnd >= weekEndForDate(today)}
          trailing={<Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={styles.iconButton}><DoopIcon name="settings" size={20} color={colors.muted} /></Pressable>} />
        <View style={styles.summaryBlock}>
          <View style={styles.summaryTopRow}>
            <Pressable ref={totalAnchor} accessibilityRole="button" accessibilityLabel={`Day actions, ${number(energyValue(totals?.kcal, unit))} ${unit}`} accessibilityState={{ expanded: Boolean(anchor) && menu === 'day' }}
              onPress={() => openMenu('day', totalAnchor.current)} style={styles.summary}>
              <View style={styles.totalRow}><Text style={styles.total}>{number(energyValue(totals?.kcal, unit))}</Text><Text style={styles.target}>{`/ ${number(energyValue(activeDay?.goal?.target_kcal, unit))} ${unit}`}</Text><DoopIcon name="chevronDown" size={14} color={colors.muted} /></View>
            </Pressable>
          </View>
          <View style={styles.macros}>{([
            ['Protein', 'protein_g', macroColors.protein], ['Carbs', 'carbs_g', macroColors.carbs], ['Fat', 'fat_g', macroColors.fat],
          ] as const).map(([label, key, color]) => <View key={key} style={styles.macro}><Text style={[styles.macroLabel, { color }]}>{label}</Text><Text style={styles.macroValue}>{number(totals?.[key])}<Text style={styles.macroUnit}>g</Text></Text></View>)}</View>
        </View>
        <ErrorMessage message={action.error ?? composer.action.error ?? result.error ?? week.error ?? preferences.error ?? offlinePhotos.error} />
        <NoticePill message={notice} onDismiss={() => setNotice('')} style={{ marginTop: 8 }} />
        {result.loading && !activeDay ? <Muted>Loading saved day…</Muted> : null}
      </Animated.View>} secondary={<View style={{ zIndex: fanMeal ? 100 : 0 }}>
        <RevealPanel visible={moving} direction="down" style={styles.movePanel}>
          <Text style={styles.menuTitle}>Move selected entries</Text>
          <View style={ui.wrap}>{configuredMeals.map(meal => <Button key={meal} label={meal} disabled={action.busy} onPress={() => void action.run(async () => { await controller.moveEntries(selected, date, meal); clearSelection(); })} />)}</View>
        </RevealPanel>
        {meals.map((meal, index) => {
          const logged = entries.filter(entry => entry.meal === meal).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
          const nextMeal = meals[index + 1];
          const nextLogged = !!nextMeal && entries.some(entry => entry.meal === nextMeal);
          const kcal = logged.reduce((total, entry) => total + entry.nutrients.kcal, 0);
          const usual = suggestions.value?.[Math.min(index, (suggestions.value?.length ?? 1) - 1)];
          const showDraft = isDraftForMeal(draft, meal, date);

          return <Animated.View key={meal} style={[styles.meal, { zIndex: fanMeal === meal ? 100 : meals.length - index }, index < pushOff.splitIndex ? pushOff.pushUpStyle : pushOff.pushDownStyle]}>
            {showDraft ? (
              <MealActiveDraftBlock
                meal={meal}
                date={date}
                entries={logged}
                energyUnit={unit}
                blocked={blocked}
                onSavedAsMeal={name => setNotice(`Saved ${name} to your meals.`)}
              />
            ) : (
              <HistoryMealSection
                meal={meal}
                logged={logged}
                kcal={kcal}
                unit={unit}
                hasNext={index < meals.length - 1 && !draftForDate}
                nextLogged={nextLogged}
                selecting={selecting}
                selected={selected}
                expandedEntryId={Boolean(anchor) && menu === 'entry' ? expanded : null}
                blocked={blocked}
                onOpenMealMenu={node => { setSavedMeal(null); openMenu(`meal:${meal}`, node); }}
                onPressEntry={(entry, node) => {
                  if (selecting) toggleEntry(entry.id);
                  else { setExpanded(entry.id); openMenu('entry', node); }
                }}
                ending={
                  <MealHoldFan
                    accessibilityLabel={`Add to ${meal}`}
                    empty={!logged.length}
                    disabled={blocked}
                    onOpenChange={open => setFanMeal(current => open ? meal : current === meal ? null : current)}
                    onTapAdd={() => composer.openField(meal)}
                    onSelectAction={kind => {
                      if (kind === 'camera') composer.openCamera(meal);
                      else if (kind === 'voice') composer.voice(meal);
                      else if (kind === 'barcode') composer.openBarcode(meal);
                      else composer.openField(meal, kind === 'quick-add');
                    }}
                    {...(usual ? { usual: { id: usual.id, label: usual.name }, onSelectUsual: () => { if (!blocked) commitUsual(usual, meal); } } : {})}
                  />
                }
              />
            )}
            <MealDraftAuxBlock meal={meal} date={date} blocked={blocked} composer={composer} offlinePhotos={dayOfflinePhotos} />
          </Animated.View>;
        })}
      </View>} />
      <AnchoredPopover anchor={menu ? anchor : null} onClose={closeMenu} width={menu === 'calendar' ? 350 : menu === 'entry' ? 304 : 214} label={menu === 'calendar' ? 'Choose date' : menu === 'entry' ? 'Edit entry' : menu === 'day' ? 'Day actions' : 'Meal actions'} surface={menu === 'calendar'}>
        {menu === 'calendar' ? <RailMonthSheet selectedDate={date} maxDate={today} days={days} loadMonth={loadCalendar} onSelectDate={calendarSelect} onClose={closeMenu} /> : null}
        {menu === 'day' ? <View style={styles.menu}>
          <Pressable disabled={action.busy || isToday || !entries.length} accessibilityRole="button" accessibilityLabel="Copy day to Today" accessibilityState={{ disabled: action.busy || isToday || !entries.length }} onPress={() => void action.run(async () => { await controller.copyEntries(entries.map(entry => entry.id), today); hapticSuccess(); closeMenu(); })} style={[styles.menuRow, (action.busy || isToday || !entries.length) && styles.menuRowDisabled]}><DoopIcon name="today" size={16} color={colors.muted} /><Text style={styles.menuText}>Copy day to Today</Text></Pressable>
          <Pressable disabled={action.busy || !entries.length} accessibilityRole="button" accessibilityLabel="Select entries" accessibilityState={{ disabled: action.busy || !entries.length }} onPress={() => { hapticLight(); closeMenu(); setExpanded(null); setSelecting(true); setSelected([]); }} style={[styles.menuRow, (action.busy || !entries.length) && styles.menuRowDisabled]}><DoopIcon name="check" size={16} color={colors.muted} /><Text style={styles.menuText}>Select entries</Text></Pressable>
        </View> : null}
        {activeMeal ? <View style={styles.menu}>
          <Pressable disabled={action.busy || isToday || !mealEntries.length} accessibilityRole="button" accessibilityLabel="Copy to Today" accessibilityState={{ disabled: action.busy || isToday || !mealEntries.length }} onPress={() => void action.run(async () => { await controller.copyMeal(date, activeMeal, today, activeMeal); hapticSuccess(); closeMenu(); })} style={[styles.menuRow, (action.busy || isToday || !mealEntries.length) && styles.menuRowDisabled]}><DoopIcon name="today" size={16} color={colors.muted} /><Text style={styles.menuText}>Copy to Today</Text></Pressable>
          <Pressable disabled={action.busy || !mealEntries.length} accessibilityRole="button" accessibilityLabel="Copy to another date" accessibilityState={{ disabled: action.busy || !mealEntries.length }} onPress={() => { hapticLight(); setCalendarIntent('copy'); setCopyMeal(activeMeal); setMenu('calendar'); }} style={[styles.menuRow, (action.busy || !mealEntries.length) && styles.menuRowDisabled]}><DoopIcon name="today" size={16} color={colors.muted} /><Text style={styles.menuText}>Copy to…</Text><DoopIcon name="chevronDown" size={14} color={colors.muted} /></Pressable>
          <Pressable disabled={action.busy || !mealEntries.length || savedMeal === activeMeal} accessibilityRole="button" accessibilityLabel={savedMeal === activeMeal ? 'Saved as meal' : 'Save as meal'} accessibilityState={{ disabled: action.busy || !mealEntries.length || savedMeal === activeMeal }} onPress={() => void action.run(async () => { await controller.saveSavedMeal({ name: activeMeal, items: mealEntries.map(({ food, quantity }) => ({ food, quantity })) }); hapticSuccess(); setSavedMeal(activeMeal); })} style={[styles.menuRow, (action.busy || !mealEntries.length || savedMeal === activeMeal) && styles.menuRowDisabled]}><DoopIcon name={savedMeal === activeMeal ? 'check' : 'pin'} size={16} color={savedMeal === activeMeal ? colors.success : colors.muted} /><Text style={styles.menuText}>{savedMeal === activeMeal ? 'Saved as meal' : 'Save as meal'}</Text></Pressable>
        </View> : null}
        {menu === 'entry' && activeEntry ? (
          <EntryEditPopover
            entry={activeEntry}
            date={date}
            today={today}
            dateLabel={shortRailDate(date)}
            meals={configuredMeals}
            energyUnit={unit}
            busy={action.busy}
            onUpdateQuantity={quantity => void action.run(() => controller.updateEntryQuantity(activeEntry, quantity))}
            onMoveMeal={meal => void action.run(async () => {
              if (meal !== activeEntry.meal) await controller.moveEntries([activeEntry.id], date, meal);
              closeMenu();
            })}
            onMoveToday={() => moveEntry(activeEntry, today)}
            onPickDate={() => { setCalendarIntent('move'); setMenu('calendar'); }}
            onRemove={() => void action.run(async () => { await controller.deleteEntry(activeEntry.id); closeMenu(); setExpanded(null); })}
          />
        ) : null}
        {menu ? <View style={{ paddingHorizontal: 12 }}><ErrorMessage message={action.error} /></View> : null}
      </AnchoredPopover>
    </Page>
  </MealEntryDragProvider>;
}

function HistoryMealSection({
  meal,
  logged,
  kcal,
  unit,
  hasNext,
  nextLogged,
  selecting,
  selected,
  expandedEntryId,
  blocked,
  onOpenMealMenu,
  onPressEntry,
  ending,
}: {
  meal: string;
  logged: DiaryEntrySnapshot[];
  kcal: number;
  unit: 'kcal' | 'kJ';
  hasNext: boolean;
  nextLogged: boolean;
  selecting: boolean;
  selected: string[];
  expandedEntryId: string | null;
  blocked: boolean;
  onOpenMealMenu: (node: ComponentRef<typeof View> | null) => void;
  onPressEntry: (entry: DiaryEntrySnapshot, node: ComponentRef<typeof View> | null) => void;
  ending: ReactNode;
}) {
  const drag = useMealEntryDrag();

  return (
    <MealRailShell
      meal={meal}
      logged={logged.length > 0}
      totalText={logged.length ? number(energyValue(kcal, unit)) : '—'}
      hasNext={hasNext}
      nextLogged={nextLogged}
      accessibilityLabel={`Actions for ${meal}`}
      onPressHeader={onOpenMealMenu}
      ending={ending}
    >
      {logged.length ? (
        <View style={styles.entries}>
          {logged.map(entry => {
            const checked = selected.includes(entry.id);
            return (
              <HistoryEntryRow
                key={entry.id}
                entry={entry}
                meal={meal}
                unit={unit}
                selecting={selecting}
                checked={checked}
                expanded={expandedEntryId === entry.id}
                disabled={selecting || blocked}
                onPress={node => {
                  if (drag?.shouldSuppressTap()) return;
                  onPressEntry(entry, node);
                }}
              />
            );
          })}
        </View>
      ) : null}
    </MealRailShell>
  );
}

function HistoryEntryRow({
  entry,
  meal,
  unit,
  selecting,
  checked,
  expanded,
  disabled,
  onPress,
}: {
  entry: DiaryEntrySnapshot;
  meal: string;
  unit: 'kcal' | 'kJ';
  selecting: boolean;
  checked: boolean;
  expanded: boolean;
  disabled: boolean;
  onPress: (node: ComponentRef<typeof View> | null) => void;
}) {
  const rowRef = useRef<ComponentRef<typeof View> | null>(null);
  return (
    <DraggableEntryRow entry={entry} sourceMeal={meal} disabled={disabled}>
      <Pressable
        ref={rowRef}
        accessibilityRole={selecting ? 'checkbox' : 'button'}
        accessibilityLabel={`${entry.food.name}, ${entryTime(entry)}, ${number(energyValue(entry.nutrients.kcal, unit))} ${unit}`}
        accessibilityHint={selecting ? 'Tap to change selection' : 'Tap to edit; hold and drag to move to another meal'}
        accessibilityState={selecting ? { checked } : { expanded }}
        onPress={() => onPress(rowRef.current)}
        style={({ pressed }) => [styles.entry, pressed && { opacity: 0.65 }]}
      >
        {selecting ? (
          <View style={[styles.checkCircle, checked && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
            {checked ? <DoopIcon name="check" size={12} color={colors.onAccent} /> : null}
          </View>
        ) : (
          <View style={styles.dragGrip} accessible={false}>
            <DoopIcon name="grip" size={14} color={colors.muted} />
          </View>
        )}
        <Text numberOfLines={1} style={styles.entryName}>{entry.food.name}</Text>
        <Text style={styles.time}>{entryTime(entry)}</Text>
        <Text style={styles.entryKcal}>
          {number(energyValue(entry.nutrients.kcal, unit))}
          <Text style={styles.entryUnit}>{` ${unit}`}</Text>
        </Text>
      </Pressable>
    </DraggableEntryRow>
  );
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.r12 },
  summaryBlock: { marginTop: 22, gap: 4 },
  summaryTopRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 10, rowGap: 4 },
  summary: { minHeight: 44, justifyContent: 'center', flexShrink: 1 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  total: { ...fontFace('extrabold'), ...tabularNums, fontSize: 32, lineHeight: 38, letterSpacing: -0.8, color: colors.ink },
  target: { ...fontFace('medium'), ...tabularNums, fontSize: 13, color: colors.muted },
  macros: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 },
  macro: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  macroLabel: { ...fontFace('semibold'), fontSize: 12 },
  macroValue: { ...fontFace('bold'), ...tabularNums, fontSize: 16, color: colors.ink },
  macroUnit: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  meal: { position: 'relative' },
  entries: { marginLeft: 52, marginRight: 52, marginBottom: 6 },
  entry: { height: 42, borderTopWidth: 1, borderTopColor: colors.hairline, flexDirection: 'row', alignItems: 'center', gap: 8 },
  entryName: { ...fontFace('medium'), flex: 1, minWidth: 0, color: colors.ink, fontSize: 14 },
  time: { ...fontFace('medium'), ...tabularNums, fontSize: 12, color: colors.muted },
  entryKcal: { ...fontFace('bold'), ...tabularNums, color: colors.ink, fontSize: 13, textAlign: 'right', minWidth: 46 },
  entryUnit: { ...fontFace('medium'), color: colors.muted, fontSize: 10 },
  checkCircle: { width: 18, height: 18, borderWidth: 1.5, borderColor: colors.border, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dragGrip: { width: 14, alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  menu: { padding: 6 },
  menuRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderRadius: radius.r12 },
  menuRowDisabled: { opacity: 0.45 },
  menuText: { ...fontFace('semibold'), flexShrink: 1, color: colors.ink, fontSize: 13 },
  menuTitle: { ...fontFace('bold'), color: colors.ink, fontSize: 14 },
  movePanel: { gap: 10, marginBottom: 16 },
});
