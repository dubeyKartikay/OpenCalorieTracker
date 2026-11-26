import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useAction, useAppRuntime, useAsyncResource, usePreferences, useRecipeBatches } from '../../src/app/AppRuntimeContext';
import type { Recipe } from '../../src/domain';
import { DoopIcon } from '../../src/ui/components/DoopIcons';
import { BackHeader, Button, energy, ErrorMessage, formatWeekdayDate, goBackOrReplace, Heading, Input, Label, Muted, number, Page, SectionRule, ui } from '../../src/ui/components/primitives';
import { RecipeEditor, validRecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import type { RecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import { colors } from '../../src/ui/tokens';

function RecipeDetail({ initial, targetMeal, targetDate }: { initial: Recipe; targetMeal?: string | undefined; targetDate?: string | undefined }) {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  const [batchDraft, setBatchDraft] = useState<RecipeDraft | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const batches = useRecipeBatches(saved.id);
  const action = useAction();
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);
  const destinationParams = {
    ...(targetMeal ? { meal: targetMeal } : {}),
    ...(targetDate ? { date: targetDate } : {}),
  };
  const dirty = JSON.stringify({ name: draft.name.trim(), ingredients: draft.ingredients, cooked_weight_g: draft.cooked_weight_g, servings_count: draft.servings_count }) !==
    JSON.stringify({ name: saved.name, ingredients: saved.ingredients, cooked_weight_g: saved.cooked_weight_g, servings_count: saved.servings_count });
  return <Page scrollRef={scrollRef} onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}><BackHeader title={saved.name} onBack={() => goBackOrReplace('/recipes')} right={<Pressable accessibilityRole="button" accessibilityLabel="Recipe actions" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(open => !open)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><DoopIcon name="more" size={20} color={colors.muted} /></Pressable>} />
    {menuOpen && <View style={{ paddingVertical: 6, alignSelf: 'flex-end', borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised }}>
      <Button label="Rename recipe" quiet onPress={() => { setRenaming(true); setMenuOpen(false); }} />
      <Button label="Share…" quiet onPress={() => { setMenuOpen(false); void action.run(() => Share.share({ message: `${saved.name}\n${saved.ingredients.map(item => `${item.food.name}: ${item.quantity.amount} ${item.quantity.unit}`).join('\n')}` })); }} />
    </View>}
    {renaming && <Input label="Recipe name" value={draft.name} onChangeText={name => setDraft(current => ({ ...current, name }))} />}
    <View style={{ marginTop: 12 }}><RecipeEditor value={draft} showName={false} disabled={action.busy} scrollRef={scrollRef} scrollOffsetRef={scrollOffsetRef} onChange={next => { setDraft(next); setSavedNotice(false); }} />
      <Muted>Edits apply to new logs only</Muted>      <ErrorMessage message={action.error} />
      {dirty && <Button label={action.busy ? 'Working…' : 'Save changes'} primary disabled={action.busy || !dirty || !validRecipeDraft(draft)} onPress={() => void action.run(async () => {
        const recipe = await controller.saveRecipe({ ...draft, id: saved.id, name: draft.name.trim(), notes: saved.notes });
        setSaved(recipe); setDraft(recipe); setSavedNotice(true); setRenaming(false);
      })} />}
      {savedNotice && <Muted>Saved as v{saved.version}. Existing batches and diary entries keep their frozen amounts.</Muted>}
    </View>
    <View style={{ marginTop: 12 }}><SectionRule label="Batches" meta={String(batches.value?.length ?? 0)} /><ErrorMessage message={batches.error} />
      {batches.loading && <Muted>Loading batches…</Muted>}
      {batches.value?.length === 0 && <Muted>No batches yet. Save the recipe, then record the amounts you cooked.</Muted>}
      {batches.value?.map(batch => <Pressable key={batch.id} accessibilityRole="button" accessibilityLabel={`Open batch from ${formatWeekdayDate(batch.created_at)}`}
        onPress={() => router.push({ pathname: '/recipes/batch/[batchId]', params: { batchId: batch.id, ...destinationParams } })} style={[ui.row, { minHeight: 48, borderBottomWidth: 1, borderColor: colors.hairline }]}>
        <Label>{formatWeekdayDate(batch.created_at)}</Label>
        <View style={{ flex: 1 }}><Muted>· {batch.cooked_weight_g === null ? 'Cooked weight not set' : `${number(batch.cooked_weight_g, 2)} g`} · {energy(controller.previewRecipeTotals(batch.ingredients).nutrients?.kcal, energyUnit)}</Muted></View><DoopIcon name="chevronRight" size={16} color={colors.muted} />
      </Pressable>)}
      <Button label={batchDraft ? 'Close batch preparation' : '+ Cook a batch'} quiet disabled={action.busy || dirty} onPress={() => setBatchDraft(current => current ? null : { ...saved, ingredients: saved.ingredients.map(item => ({ ...item, quantity: { ...item.quantity } })) })} />
      {dirty && <Muted>Save your recipe changes before starting a new batch.</Muted>}
    </View>
    {batchDraft && <View style={{ gap: 12 }}><Heading>Cook a batch</Heading><Muted>Tweak the actual cooked weight and ingredient amounts. Batch amounts don&apos;t change the recipe.</Muted>
      <RecipeEditor value={batchDraft} onChange={setBatchDraft} showName={false} allowAdd={false} disabled={action.busy} />
      <ErrorMessage message={action.error} />
      <Button label="Save cooked batch" primary disabled={action.busy || dirty || !validRecipeDraft(batchDraft)} onPress={() => void action.run(async () => {
        const batch = await controller.cookBatch({ recipeId: saved.id, ingredients: batchDraft.ingredients,
          cooked_weight_g: batchDraft.cooked_weight_g, servings_count: batchDraft.servings_count });
        setBatchDraft(null);
        router.push({ pathname: '/recipes/batch/[batchId]', params: { batchId: batch.id, ...destinationParams } });
      })} />
    </View>}
  </Page>;
}

export default function RecipeScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; meal?: string | string[]; date?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] ?? '' : params.id ?? '';
  const targetMeal = (Array.isArray(params.meal) ? params.meal[0] : params.meal)?.trim() || undefined;
  const targetDate = (Array.isArray(params.date) ? params.date[0] : params.date)?.trim() || undefined;
  const { controller } = useAppRuntime();
  const recipe = useAsyncResource(useCallback(() => controller.getRecipe(id), [controller, id]), id);
  if (recipe.value) return <RecipeDetail key={recipe.value.id} initial={recipe.value} targetMeal={targetMeal} targetDate={targetDate} />;
  return <Page><BackHeader title="Recipe" onBack={() => goBackOrReplace('/recipes')} />
    <ErrorMessage message={recipe.error} /><Muted>{recipe.loading ? 'Loading recipe…' : recipe.error ? 'Could not load this recipe.' : 'Recipe not found.'}</Muted>
  </Page>;
}
