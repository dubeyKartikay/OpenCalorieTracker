import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCatalogSearch, usePreferences, useTodayDiary } from '../../src/app/AppRuntimeContext';
import { MEALS } from '../../src/app/controller';
import { foodKey } from '../../src/storage';
import type { SearchCandidate } from '../../src/catalog';
import { UndoToast } from '../../src/ui/components/Diary';
import { FoodRow, NewCustomFood } from '../../src/ui/components/FoodSearch';
import { Button, energy, ErrorMessage, Heading, Input, Muted, Page, ui } from '../../src/ui/components/primitives';

export default function Library() {
  const params = useLocalSearchParams<{ meal?: string }>();
  const preferences = usePreferences();
  const meals = preferences.value?.mealSections ?? [...MEALS];
  const meal = params.meal && meals.includes(params.meal) ? params.meal : meals[0] ?? 'Breakfast';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [expanded, setExpanded] = useState<string | null>(null);
  const search = useCatalogSearch(query);
  const today = useTodayDiary();
  const target = today.value?.goal?.target_kcal;
  const matchesFilter = ({ food }: SearchCandidate) => filter === 'All' || (filter === 'Meals' ? !food.source_pack_id && food.id.startsWith('meal:')
    : filter === 'Recipes' ? !food.source_pack_id && food.id.startsWith('recipe:') : !!food.source_pack_id || !/^(recipe:|meal:)/.test(food.id));
  const yours = search.value?.yours.filter(matchesFilter) ?? [];
  const database = search.value?.database.filter(matchesFilter) ?? [];
  const renderRow = (candidate: SearchCandidate) => <FoodRow key={foodKey(candidate.food)} candidate={candidate} meal={meal}
    expanded={expanded === foodKey(candidate.food)} onToggle={() => setExpanded(old => old === foodKey(candidate.food) ? null : foodKey(candidate.food))} />;
  return <Page title="Library" action={<Button label="Recipes →" onPress={() => router.push('/recipes')} />} footer={<UndoToast />}>
    <Input label="Search your foods and databases" placeholder="Search oats, egg, dal…" value={query} onChangeText={setQuery} autoCapitalize="none" />
    <View style={ui.wrap}>{['All', 'Meals', 'Foods', 'Recipes'].map(value => <Button key={value} label={value} selected={filter === value} onPress={() => setFilter(value)} />)}</View>
    <View style={ui.wrap}>{meals.map((value, index) => <Button key={`${value}:${index}`} label={value} selected={meal === value} onPress={() => router.setParams({ meal: value })} />)}</View>
    <Muted>{target != null ? `${energy(target - (today.value?.totals.nutrients?.kcal ?? 0), preferences.value?.energyUnit)} remaining` : 'Observe mode · no calorie target'}</Muted>
    <ErrorMessage message={search.error ?? today.error ?? preferences.error} />{search.loading && <Muted>Searching local foods…</Muted>}
    {!!yours.length && <><Heading>Yours</Heading>{yours.map(renderRow)}</>}
    {!!database.length && <><Heading>Food database</Heading>{database.map(renderRow)}</>}
    {!query.trim() && !yours.length && !database.length && <Muted>Search your local food databases.</Muted>}
    {!!query.trim() && !search.loading && !yours.length && !database.length && <Muted>No matching foods.</Muted>}
    <NewCustomFood key={preferences.value?.energyUnit ?? 'kcal'} />
  </Page>;
}
