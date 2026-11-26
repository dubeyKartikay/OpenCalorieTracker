import type { ComponentRef } from 'react';
import { useCallback, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useActiveDraft, useAIStatus, useAppRuntime, useAsyncResource, useCatalogSearch, useHistoryDay, usePreferences } from '../../src/app/AppRuntimeContext';
import { looksLikeMultiFoodCapture } from '../../src/ai';
import { localDate, MEALS, mealsForDay, parseRouteDate } from '../../src/app/controller';
import { diaryEntrySnapshotSchema, foodRecordSchema } from '../../src/domain';
import { foodKey } from '../../src/storage';
import type { SearchCandidate } from '../../src/catalog';
import { UndoToast } from '../../src/ui/components/Diary';
import { FoodRow, NewCustomFood } from '../../src/ui/components/FoodSearch';
import { DoopIcon, mealDaypartGlyph } from '../../src/ui/components/DoopIcons';
import { SparklePromptRow, useVoiceDictation, VoiceDock, VoiceMicRing } from '../../src/ui/components/capture';
import { energyValue, ErrorMessage, Muted, NoticePill, number, SectionRule, useTimedNotice } from '../../src/ui/components/primitives';
import { colors, fontFace, radius, SCREEN_GUTTER, tabularNums, useLayoutClass } from '../../src/ui/tokens';

export default function Library() {
  const params = useLocalSearchParams<{ meal?: string; q?: string; date?: string }>();
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  const preferences = usePreferences();
  const ai = useAIStatus();
  const activeDraft = useActiveDraft();
  const meals = preferences.value?.mealSections ?? [...MEALS];
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
  const voiceSession = useVoiceDictation({
    onText: setQuery,
    onError: message => setNotice(message),
  });
  const { isExpanded } = useLayoutClass();
  const search = useCatalogSearch(query);
  const targetDay = useHistoryDay(targetDate);
  const resting = useAsyncResource(useCallback(async () => {
    void revision;
    const [foods, recipes, saved, recent, pinnedRow, pinnedFoodsRow] = await Promise.all([
      controller.deps.library.listCustomFoods(), controller.listRecipes(), controller.listSavedMeals(),
      controller.deps.userDb.getAllAsync<{ snapshot_json: string }>("SELECT snapshot_json FROM diary_entries WHERE draft_state='confirmed' ORDER BY occurred_at DESC LIMIT 120"),
      controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryVisualPins'),
      controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryPinnedFoods'),
    ]);
    const diaryEntries = recent.map(row => diaryEntrySnapshotSchema.parse(JSON.parse(row.snapshot_json)));
    const pinned: string[] = pinnedRow ? JSON.parse(pinnedRow.value_json) : [];
    const pinnedFoods = pinnedFoodsRow ? (JSON.parse(pinnedFoodsRow.value_json) as unknown[]).map(food => foodRecordSchema.parse(food)) : [];
    const records = await Promise.all([
      ...pinnedFoods.map(item => controller.deps.catalog.getById(item.source_pack_id, item.id).then(food => food ?? item)),
      ...saved.map(item => controller.deps.catalog.getById(null, 'meal:' + item.id)),
      ...recipes.map(item => controller.deps.catalog.getById(null, 'recipe:' + item.id)),
      ...foods.map(item => controller.deps.catalog.getById(null, item.id)),
      ...diaryEntries.map(item => controller.deps.catalog.getById(item.food.source_pack_id, item.food.id).then(food => food ?? item.food)),
    ]);
    const unique = new Map<string, SearchCandidate>();
    for (const food of records) if (food) unique.set(foodKey(food), { food, bucket: food.source_pack_id ? 'database' : 'yours', sourceLabel: food.source_pack_id ?? 'Yours', packPriority: 0, matchTier: 0, prepStateMatch: true, withinPackRank: unique.size, matchedAlias: null });
    const savedPins = new Set(saved.filter(item => item.pinned).map(item => 'meal:' + item.id));
    return [...unique.values()].sort((a, b) => Number(pinned.includes(foodKey(b.food)) || savedPins.has(b.food.id)) - Number(pinned.includes(foodKey(a.food)) || savedPins.has(a.food.id)));
  }, [controller, revision]));
  const matchesFilter = ({ food }: SearchCandidate) => filter === 'All' || (filter === 'Meals' ? !food.source_pack_id && food.id.startsWith('meal:')
    : filter === 'Recipes' ? !food.source_pack_id && food.id.startsWith('recipe:') : !!food.source_pack_id || !/^(recipe:|meal:)/.test(food.id));
  const yours = search.value?.yours.filter(matchesFilter) ?? [];
  const database = search.value?.database.filter(matchesFilter) ?? [];
  const typing = query.trim().length > 0;
  const target = targetDay.value?.goal?.target_kcal;
  const remaining = target == null ? null : target - (targetDay.value?.totals.nutrients?.kcal ?? 0);
  const renderRow = (candidate: SearchCandidate) => <FoodRow key={foodKey(candidate.food)} candidate={candidate} meal={meal} date={targetDate} searchResult={typing}
    expanded={expanded === foodKey(candidate.food)} onToggle={() => { Keyboard.dismiss(); setExpanded(old => old === foodKey(candidate.food) ? null : foodKey(candidate.food)); }} />;
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { maxWidth: isExpanded ? 760 : 540 }]}>
      <View style={styles.searchRow}>
        <View style={[styles.search, (typing || focused || voiceSession.active) && styles.searchActive]}>
          <DoopIcon name="search" size={17} color={colors.muted} />
          <TextInput ref={input} accessibilityLabel="Search library" placeholder="Search library" placeholderTextColor={colors.muted} value={query}
            onChangeText={setQuery} showSoftInputOnFocus={!voiceSession.active} onPressIn={() => { if (voiceSession.active) voiceSession.stop(); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoCapitalize="none" autoCorrect={false} style={styles.input} />
          <View style={styles.capturePair}>
            <Pressable accessibilityRole="button" accessibilityLabel="Open camera for barcode or photo" onPress={() => { voiceSession.cancel(); router.push({ pathname: '/barcode', params: { meal, date: targetDate, mode: 'barcode', returnTo: 'library' } }); }} style={styles.captureHit}><View style={styles.captureTile}><DoopIcon name="camera" size={16} /></View></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={voiceSession.active ? 'Stop voice dictation' : 'Search by voice'} accessibilityState={{ selected: voiceSession.active }} onPress={() => { if (voiceSession.active) voiceSession.stop(); else { setNotice(''); void voiceSession.start(query); } }} style={styles.captureHit}><View style={[styles.captureTile, voiceSession.active && styles.captureTileActive]}><VoiceMicRing active={voiceSession.active} size={32} borderRadius={10} /><DoopIcon name="mic" size={16} color={voiceSession.active ? colors.onAccent : colors.ink} /></View></Pressable>
          </View>
          {typing && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => { voiceSession.cancel(); setQuery(''); input.current?.focus(); }} style={styles.clear}><DoopIcon name="close" size={16} /></Pressable>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => { voiceSession.cancel(); router.push('/settings'); }} style={styles.gear}><DoopIcon name="settings" size={20} color={colors.muted} /></Pressable>
      </View>
      <NoticePill message={notice} onDismiss={() => setNotice('')} style={{ marginTop: 8 }} />
      <View style={styles.filtersRow}>
        <View style={styles.filters}>{['All', 'Meals', 'Foods', 'Recipes'].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={styles.filterHit}>
          <View style={[styles.filterPill, filter === value && styles.filterActive]}><Text style={[styles.filterText, filter === value && styles.accent]}>{value}</Text></View>
        </Pressable>)}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={'Destination ' + meal} accessibilityState={{ expanded: chooser }} onPress={() => setChooser(value => !value)} style={styles.mealControl}>
          <DoopIcon name={mealDaypartGlyph(meal)} size={14} color={colors.muted} /><View><Text style={styles.mealName}>{meal}</Text><Text style={[styles.budget, remaining != null && remaining < 0 && { color: colors.warning }]}>{remaining == null ? 'No target' : `${number(energyValue(Math.abs(remaining), energyUnit))} ${energyUnit}${remaining < 0 ? ' over' : ' left'}`}</Text></View><DoopIcon name="chevronDown" size={10} color={colors.muted} />
        </Pressable>
        {chooser && <View style={styles.chooser}>{chooserMeals.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: meal === value }} onPress={() => { router.setParams({ meal: value }); setChooser(false); }} style={[styles.mealOption, meal === value && styles.filterActive]}><Text style={[styles.optionText, meal === value && styles.accent]}>{value}</Text>{meal === value && <DoopIcon name="check" size={12} color={colors.accent} />}</Pressable>)}</View>}
      </View>
      {filter === 'Recipes' && <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/recipes', params: { meal, date: targetDate } })} style={styles.recipeLink}><Text style={styles.linkText}>+ New recipe</Text></Pressable>}
      {looksLikeMultiFoodCapture(query) && <SparklePromptRow summary="Break down with AI" busy={activeDraft.busy} disabled={ai.loading || !ai.value} onPress={() => {
        if (ai.value?.mode === 'disconnected' || !ai.value?.consentAccepted) { router.push('/chatgpt'); return; }
        void activeDraft.capture({ text: query, meal, date: targetDate });
        if (targetDate !== todayIso) router.push({ pathname: '/(tabs)/history', params: { date: targetDate } });
        else router.push('/(tabs)');
      }} />}
      <ErrorMessage message={search.error ?? resting.error ?? targetDay.error ?? preferences.error ?? ai.error ?? activeDraft.error} />
      {typing ? <>
        {!!yours.length && <><View style={styles.section}><SectionRule label="Your items" /></View>{yours.map(renderRow)}</>}
        {!!database.length && <><View style={styles.section}><SectionRule label="Food database" /></View>{database.map(renderRow)}</>}
        {(search.loading || search.debouncing) && <Muted>Searching local foods…</Muted>}
        {!search.loading && !search.debouncing && !yours.length && !database.length && <Muted>No matching foods.</Muted>}
      </> : <>
        <View style={styles.list}>{(resting.value ?? []).filter(matchesFilter).map(renderRow)}</View>
        {!resting.loading && !resting.value?.length && <Muted>Your saved foods and meals will appear here. Search to find food.</Muted>}
        <View style={styles.create}><NewCustomFood key={energyUnit} /></View>
      </>}
    </ScrollView>
    <View pointerEvents="box-none" style={styles.toast}><UndoToast /></View>
    <VoiceDock visible={voiceSession.active} level={voiceSession.level} onStop={voiceSession.stop} flushMarginHorizontal={0} flushMarginBottom={0} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  content: { width: '100%', alignSelf: 'center', paddingHorizontal: SCREEN_GUTTER, paddingTop: 12, paddingBottom: 32 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.r16, backgroundColor: colors.surface },
  searchActive: { borderColor: colors.accent },
  input: { flex: 1, minWidth: 0, padding: 0, height: 42, color: colors.ink, ...fontFace('medium'), fontSize: 14 },
  capturePair: { flexDirection: 'row', marginRight: 2 }, captureHit: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, captureTile: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }, captureTileActive: { backgroundColor: colors.accent },
  clear: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }, gear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filtersRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, zIndex: 30 },
  filters: { flexDirection: 'row', flexShrink: 1 }, filterHit: { height: 44, justifyContent: 'center' }, filterPill: { height: 32, paddingHorizontal: 10, borderRadius: radius.full, justifyContent: 'center' }, filterActive: { backgroundColor: 'rgba(122,162,247,0.16)' },
  filterText: { color: colors.muted, ...fontFace('semibold'), fontSize: 13 }, accent: { color: colors.accent },
  mealControl: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 5 }, mealName: { ...fontFace('medium'), fontSize: 11, color: colors.muted }, budget: { ...fontFace('bold'), ...tabularNums, fontSize: 11, color: colors.ink },
  chooser: { position: 'absolute', right: 0, top: 44, width: 196, flexDirection: 'row', flexWrap: 'wrap', padding: 6, gap: 4, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, elevation: 10, boxShadow: '0 18px 38px rgba(0,0,0,0.46)' },
  mealOption: { width: '48%', height: 44, borderRadius: radius.r8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, optionText: { ...fontFace('semibold'), fontSize: 11, color: colors.ink },
  section: { height: 30, justifyContent: 'center' }, list: { marginTop: 8 }, create: { marginTop: 20 }, recipeLink: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.hairline }, linkText: { ...fontFace('semibold'), color: colors.accent, fontSize: 12 }, toast: { position: 'absolute', left: SCREEN_GUTTER, right: SCREEN_GUTTER, bottom: 8 },
});
