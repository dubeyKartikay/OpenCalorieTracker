import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCatalogSearch, useTodayDiary } from '../../src/app/AppRuntimeContext';
import { MEALS, type Meal } from '../../src/app/controller';
import { foodKey } from '../../src/storage';
import { UndoToast } from '../../src/ui/components/Diary';
import { FoodRow, NewCustomFood } from '../../src/ui/components/FoodSearch';
import { Button, ErrorMessage, Heading, Input, Muted, number, Page, ui } from '../../src/ui/components/primitives';
export default function Library() {
  const params = useLocalSearchParams<{ meal?: string }>();
  const meal = MEALS.includes(params.meal as Meal) ? params.meal as Meal : 'Breakfast';
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const search = useCatalogSearch(query);
  const today = useTodayDiary();
  const target = today.value?.goal?.target_kcal;
  return <Page title="Library"><Input label="Search your foods and databases" placeholder="Search oats, egg, dal…" value={query} onChangeText={setQuery} autoCapitalize="none" />
    <View style={ui.wrap}>{MEALS.map(value => <Button key={value} label={value} selected={meal === value} onPress={() => router.setParams({ meal: value })} />)}</View>
    <Muted>{target != null ? `${number(target - (today.value?.totals.nutrients?.kcal ?? 0))} kcal remaining` : 'Observe mode · no calorie target'}</Muted>
    <ErrorMessage message={search.error ?? today.error} />{search.loading && <Muted>Searching local foods…</Muted>}
    {search.value?.yours.length ? <><Heading>Yours</Heading>{search.value.yours.map(candidate => <FoodRow key={foodKey(candidate.food)} candidate={candidate} meal={meal}
      expanded={expanded === foodKey(candidate.food)} onToggle={() => setExpanded(old => old === foodKey(candidate.food) ? null : foodKey(candidate.food))} />)}</> : null}
    <Heading>Food database</Heading>{search.value?.database.map(candidate => <FoodRow key={foodKey(candidate.food)} candidate={candidate} meal={meal}
      expanded={expanded === foodKey(candidate.food)} onToggle={() => setExpanded(old => old === foodKey(candidate.food) ? null : foodKey(candidate.food))} />)}
    {!query.trim() && <Muted>Search the bundled USDA pack. Add another database in Settings.</Muted>}
    {query.trim() && !search.loading && search.value && !search.value.yours.length && !search.value.database.length ? <Muted>No matching foods. Try another name or create your own.</Muted> : null}
    <NewCustomFood /><UndoToast />
  </Page>;
}
