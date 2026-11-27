import type { ComponentRef } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useActiveDraft, useAIStatus, useAppRuntime, useAsyncResource, useCatalogSearch, usePreferences } from '../../src/app/AppRuntimeContext';
import { looksLikeMultiFoodCapture } from '../../src/ai';
import { localDate, MEALS, mealsForDay, parseRouteDate } from '../../src/app/controller';
import { diaryEntrySnapshotSchema, foodRecordSchema, type DiaryEntrySnapshot, type FoodUnit, type Quantity } from '../../src/domain';
import { foodKey } from '../../src/storage';
import type { SearchCandidate } from '../../src/catalog';
import { UndoToast } from '../../src/ui/components/Diary';
import { FoodRow, GLOBAL_UNITS, NewCustomFood, PIN_KEY, type LibrarySharedContext } from '../../src/ui/components/FoodSearch';
import { DoopIcon, mealDaypartGlyph } from '../../src/ui/components/DoopIcons';
import { SparklePromptRow, useScrollAboveKeyboard, useVoiceDictation, VoiceDock, VoiceMicRing } from '../../src/ui/components/capture';
import { ErrorMessage, Muted, NoticePill, useKeyboardHeight, useTimedNotice } from '../../src/ui/components/primitives';
import { hapticSelection } from '../../src/ui/haptics';
import { colors, fontFace, radius, SCREEN_GUTTER, useLayoutClass } from '../../src/ui/tokens';

const DEFAULT_MEALS: string[] = [...MEALS];
const EMPTY_UNITS: FoodUnit[] = [];
const EMPTY_ENTRIES_MAP = new Map<string, DiaryEntrySnapshot[]>();
const EMPTY_STRING_SET = new Set<string>();
const EMPTY_LEARNED_MAP = new Map<string, Quantity[]>();

function SectionLabel({ label }: { label: string }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionText}>{label}</Text>
    </View>
  );
}

export default function Library() {
  const params = useLocalSearchParams<{ meal?: string; q?: string; date?: string }>();
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  const preferences = usePreferences();
  const ai = useAIStatus();
  const activeDraft = useActiveDraft();
  const meals = useMemo(() => preferences.value?.mealSections ?? DEFAULT_MEALS, [preferences.value?.mealSections]);
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const requestedMeal = params.meal?.trim();
  const meal = requestedMeal || meals[0] || 'Breakfast';
  const chooserMeals = mealsForDay(meals, [], [meal]);
  const todayIso = localDate();
  const targetDate = parseRouteDate(params.date) ?? todayIso;
  const [query, setQuery] = useState(params.q ?? '');
  const [lastParamQ, setLastParamQ] = useState(params.q);
  if (params.q !== lastParamQ) {
    setLastParamQ(params.q);
    if (params.q !== undefined) setQuery(params.q);
  }
  const [focused, setFocused] = useState(false);
  const [filter, setFilter] = useState('All');
  const [chooser, setChooser] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useTimedNotice();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);
  const keyboardHeight = useKeyboardHeight();
  const ensureVisible = useScrollAboveKeyboard(scrollRef, scrollOffsetRef);
  const voiceSession = useVoiceDictation({
    onText: setQuery,
    onError: message => setNotice(message),
  });
  const cancelVoice = voiceSession.cancel;
  useFocusEffect(useCallback(() => () => cancelVoice(), [cancelVoice]));
  const { isExpanded } = useLayoutClass();
  const search = useCatalogSearch(query);
  const shared = useAsyncResource(useCallback(async () => {
    void revision;
    const [globalUnits, dayData, pinnedRow, savedMeals, learnedRows] = await Promise.all([
      controller.deps.library.listUserFoodUnits(GLOBAL_UNITS),
      controller.day(targetDate),
      controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', PIN_KEY),
      controller.listSavedMeals(),
      controller.deps.library.listAllLearnedPortions(),
    ]);
    const entriesByFoodKey = new Map<string, DiaryEntrySnapshot[]>();
    for (const entry of dayData.day?.entries ?? []) {
      const k = foodKey(entry.food);
      const list = entriesByFoodKey.get(k);
      if (list) list.push(entry);
      else entriesByFoodKey.set(k, [entry]);
    }
    const learnedByFoodKey = new Map<string, Quantity[]>();
    for (const item of learnedRows) {
      const list = learnedByFoodKey.get(item.food_key);
      const qty = { amount: item.amount, unit: item.unit };
      if (list) list.push(qty);
      else learnedByFoodKey.set(item.food_key, [qty]);
    }
    const pinIds = new Set<string>(pinnedRow ? JSON.parse(pinnedRow.value_json) : []);
    const savedMealPins = new Set<string>(savedMeals.filter(item => item.pinned).map(item => 'meal:' + item.id));
    return { globalUnits, entriesByFoodKey, pinIds, savedMealPins, learnedByFoodKey };
  }, [controller, revision, targetDate]), `library-shared:${targetDate}`);
  const sharedContext = useMemo<LibrarySharedContext>(() => ({
    ready: Boolean(shared.value),
    globalUnits: shared.value?.globalUnits ?? EMPTY_UNITS,
    entriesByFoodKey: shared.value?.entriesByFoodKey ?? EMPTY_ENTRIES_MAP,
    pinIds: shared.value?.pinIds ?? EMPTY_STRING_SET,
    savedMealPins: shared.value?.savedMealPins ?? EMPTY_STRING_SET,
    learnedByFoodKey: shared.value?.learnedByFoodKey ?? EMPTY_LEARNED_MAP,
    energyUnit,
    meals,
  }), [energyUnit, meals, shared.value]);
  const resting = useAsyncResource(useCallback(async () => {
    void revision;
    const [foods, recipes, saved, recent, pinnedRow, pinnedFoodsRow] = await Promise.all([
      controller.deps.library.listCustomFoods(), controller.listRecipes(), controller.listSavedMeals(),
      controller.deps.userDb.getAllAsync<{ snapshot_json: string }>("SELECT snapshot_json FROM diary_entries WHERE draft_state='confirmed' ORDER BY occurred_at DESC LIMIT 120"),
      controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryVisualPins'),
      controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryPinnedFoods'),
    ]);
    const diaryEntries = recent.map(row => diaryEntrySnapshotSchema.parse(JSON.parse(row.snapshot_json)));
    const pinnedIds = new Set<string>(pinnedRow ? JSON.parse(pinnedRow.value_json) : []);
    const pinnedFoods = pinnedFoodsRow ? (JSON.parse(pinnedFoodsRow.value_json) as unknown[]).map(food => foodRecordSchema.parse(food)) : [];
    const requests = new Map<string, { packId: string | null; id: string; fallback?: typeof pinnedFoods[number] }>();
    const addRequest = (packId: string | null, id: string, fallback?: typeof pinnedFoods[number]) => {
      const k = `${packId ?? 'user'}:${id}`;
      if (!requests.has(k)) requests.set(k, { packId, id, ...(fallback ? { fallback } : {}) });
    };
    for (const item of pinnedFoods) addRequest(item.source_pack_id, item.id, item);
    for (const item of saved) addRequest(null, 'meal:' + item.id);
    for (const item of recipes) addRequest(null, 'recipe:' + item.id);
    for (const item of foods) addRequest(null, item.id);
    for (const item of diaryEntries) addRequest(item.food.source_pack_id, item.food.id, item.food);
    const records = await Promise.all(
      [...requests.values()].map(req =>
        controller.deps.catalog.getById(req.packId, req.id).then(food => food ?? req.fallback ?? null),
      ),
    );
    const unique = new Map<string, SearchCandidate>();
    for (const food of records) if (food) unique.set(foodKey(food), { food, bucket: food.source_pack_id ? 'database' : 'yours', sourceLabel: food.source_pack_id ?? 'Yours', packPriority: 0, matchTier: 0, prepStateMatch: true, withinPackRank: unique.size, matchedAlias: null });
    const savedPins = new Set(saved.filter(item => item.pinned).map(item => 'meal:' + item.id));
    const isPinned = (candidate: SearchCandidate) => pinnedIds.has(foodKey(candidate.food)) || savedPins.has(candidate.food.id);
    const all = [...unique.values()];
    return {
      pinned: all.filter(isPinned),
      rest: all.filter(candidate => !isPinned(candidate)),
    };
  }, [controller, revision]));
  const matchesFilter = ({ food }: SearchCandidate) => filter === 'All' || (filter === 'Meals' ? !food.source_pack_id && food.id.startsWith('meal:')
    : filter === 'Recipes' ? !food.source_pack_id && food.id.startsWith('recipe:') : !!food.source_pack_id || !/^(recipe:|meal:)/.test(food.id));
  const yours = search.value?.yours.filter(matchesFilter) ?? [];
  const database = search.value?.database.filter(matchesFilter) ?? [];
  const pinnedItems = (resting.value?.pinned ?? []).filter(matchesFilter);
  const likelyItems = (resting.value?.rest ?? []).filter(matchesFilter);
  const totalResting = (resting.value?.pinned.length ?? 0) + (resting.value?.rest.length ?? 0);
  const typing = query.trim().length > 0;
  const renderRow = (candidate: SearchCandidate) => <FoodRow key={foodKey(candidate.food)} candidate={candidate} meal={meal} date={targetDate} searchResult={typing} shared={sharedContext}
    expanded={expanded === foodKey(candidate.food)} onEnsureVisible={ensureVisible} onToggle={() => { Keyboard.dismiss(); setExpanded(old => old === foodKey(candidate.food) ? null : foodKey(candidate.food)); }} />;
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <ScrollView
      ref={scrollRef}
      scrollEventThrottle={16}
      onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.content,
        { maxWidth: isExpanded ? 760 : 540 },
        keyboardHeight > 0 && { paddingBottom: 36 + keyboardHeight },
      ]}
    >
      <View style={styles.searchRow}>
        <View style={[styles.search, (typing || focused || voiceSession.active) && styles.searchActive]}>
          <DoopIcon name="search" size={18} color={colors.muted} />
          <TextInput ref={input} accessibilityLabel="Search library" placeholder="Search" placeholderTextColor={colors.muted} value={query}
            onChangeText={setQuery} showSoftInputOnFocus={!voiceSession.active} onPressIn={() => { if (voiceSession.active) voiceSession.stop(); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoCapitalize="none" autoCorrect={false} style={styles.input} />
          {typing && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => { voiceSession.cancel(); setQuery(''); input.current?.focus(); }} style={styles.clear}><DoopIcon name="close" size={16} color={colors.muted} /></Pressable>}
          <View style={styles.capturePair}>
            <Pressable accessibilityRole="button" accessibilityLabel="Open camera for barcode or photo" onPress={() => { voiceSession.cancel(); router.push({ pathname: '/barcode', params: { meal, date: targetDate, mode: 'barcode', returnTo: 'library' } }); }} style={styles.captureHit}><DoopIcon name="camera" size={20} color={colors.muted} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={voiceSession.active ? 'Stop voice dictation' : 'Search by voice'} accessibilityState={{ selected: voiceSession.active }} onPress={() => { if (voiceSession.active) voiceSession.stop(); else { setNotice(''); void voiceSession.start(query); } }} style={styles.captureHit}><View style={[styles.micWrap, voiceSession.active && styles.micActive]}><VoiceMicRing active={voiceSession.active} size={34} borderRadius={17} /><DoopIcon name="mic" size={20} color={voiceSession.active ? colors.onAccent : colors.muted} /></View></Pressable>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => { voiceSession.cancel(); router.push('/settings'); }} style={styles.gear}><DoopIcon name="settings" size={22} color={colors.muted} /></Pressable>
      </View>
      <NoticePill message={notice} onDismiss={() => setNotice('')} style={{ marginTop: 8 }} />
      <View style={styles.filtersRow}>
        <View style={styles.filters}>{['All', 'Meals', 'Foods', 'Recipes'].map(value => {
          const active = filter === value;
          return <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { if (!active) hapticSelection(); setFilter(value); }} style={styles.filterHit}>
            <View style={[styles.filterTab, active && styles.filterTabActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{value}</Text></View>
          </Pressable>;
        })}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={'Destination ' + meal} accessibilityState={{ expanded: chooser }} onPress={() => { hapticSelection(); setChooser(value => !value); }} style={styles.mealControl}>
          <DoopIcon name={mealDaypartGlyph(meal)} size={18} color={colors.muted} strokeWidth={1.5} /><Text numberOfLines={1} style={styles.mealName}>{meal}</Text><DoopIcon name="chevronDown" size={14} color={colors.muted} />
        </Pressable>
        {chooser && <View style={styles.chooser}>{chooserMeals.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: meal === value }} onPress={() => { hapticSelection(); router.setParams({ meal: value }); setChooser(false); }} style={[styles.mealOption, meal === value && styles.chooserActive]}><Text style={[styles.optionText, meal === value && styles.accent]}>{value}</Text>{meal === value && <DoopIcon name="check" size={12} color={colors.accent} />}</Pressable>)}</View>}
      </View>
      {filter === 'Recipes' && <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/recipes', params: { meal, date: targetDate } })} style={styles.recipeLink}><Text style={styles.linkText}>+ New recipe</Text></Pressable>}
      {looksLikeMultiFoodCapture(query) && <SparklePromptRow summary="Break down with AI" busy={activeDraft.busy} disabled={ai.loading || !ai.value} onPress={() => {
        if (ai.value?.mode === 'disconnected' || !ai.value?.consentAccepted) { router.push('/chatgpt'); return; }
        void activeDraft.capture({ text: query, meal, date: targetDate });
        if (targetDate !== todayIso) router.push({ pathname: '/(tabs)/history', params: { date: targetDate } });
        else router.push('/(tabs)');
      }} />}
      <ErrorMessage message={search.error ?? resting.error ?? shared.error ?? preferences.error ?? ai.error ?? activeDraft.error} />
      {typing ? <>
        {!!yours.length && <><SectionLabel label="Your items" />{yours.map(renderRow)}</>}
        {!!database.length && <><SectionLabel label="Food database" />{database.map(renderRow)}</>}
        {(search.loading || search.debouncing) && <Muted>Searching local foods…</Muted>}
        {!search.loading && !search.debouncing && !yours.length && !database.length && <Muted>No matching foods.</Muted>}
      </> : <>
        {!!pinnedItems.length && <><SectionLabel label="Pinned" />{pinnedItems.map(renderRow)}</>}
        {!!likelyItems.length && <><SectionLabel label="Likely now" />{likelyItems.map(renderRow)}</>}
        {!resting.loading && totalResting === 0 && <Muted style={styles.emptyNote}>Your saved foods and meals will appear here. Search to find food.</Muted>}
        <View style={styles.create}><NewCustomFood key={energyUnit} onEnsureVisible={ensureVisible} /></View>
      </>}
    </ScrollView>
    <View pointerEvents="box-none" style={styles.toast}><UndoToast /></View>
    <VoiceDock visible={voiceSession.active} level={voiceSession.level} onStop={voiceSession.stop} flushMarginHorizontal={0} flushMarginBottom={0} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  content: { width: '100%', alignSelf: 'center', paddingHorizontal: SCREEN_GUTTER, paddingTop: 8, paddingBottom: 36 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  search: { flex: 1, minWidth: 0, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 4, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.r16, backgroundColor: colors.surface },
  searchActive: { borderColor: colors.accent },
  input: { flex: 1, minWidth: 0, padding: 0, height: 44, color: colors.ink, ...fontFace('medium'), fontSize: 16, ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null) },
  capturePair: { flexDirection: 'row', alignItems: 'center' },
  captureHit: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  micWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  micActive: { backgroundColor: colors.accent },
  clear: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  gear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filtersRow: { height: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 10, zIndex: 30 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 20, flexShrink: 1 },
  filterHit: { height: 48, justifyContent: 'center' },
  filterTab: { paddingTop: 10, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  filterTabActive: { borderBottomColor: colors.accent },
  filterText: { color: colors.muted, ...fontFace('semibold'), fontSize: 15 },
  filterTextActive: { color: colors.ink },
  accent: { color: colors.accent },
  mealControl: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  mealName: { ...fontFace('semibold'), fontSize: 15, color: colors.ink, flexShrink: 1 },
  chooser: { position: 'absolute', right: 0, top: 48, width: 196, flexDirection: 'row', flexWrap: 'wrap', padding: 6, gap: 4, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, elevation: 10, boxShadow: '0 18px 38px rgba(0,0,0,0.46)' },
  chooserActive: { backgroundColor: 'rgba(122,162,247,0.16)' },
  mealOption: { width: '48%', height: 44, borderRadius: radius.r8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionText: { ...fontFace('semibold'), fontSize: 11, color: colors.ink },
  section: { height: 40, justifyContent: 'flex-end', paddingBottom: 4 },
  sectionText: { ...fontFace('semibold'), fontSize: 12.5, color: 'rgba(169, 177, 214, 0.58)', letterSpacing: 0.25 },
  emptyNote: { marginTop: 12 },
  create: { marginTop: 20 },
  recipeLink: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.hairline },
  linkText: { ...fontFace('semibold'), color: colors.accent, fontSize: 13 },
  toast: { position: 'absolute', left: SCREEN_GUTTER, right: SCREEN_GUTTER, bottom: 8 },
});
