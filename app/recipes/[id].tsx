import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useAction, useAppRuntime, useAsyncResource, useRecipeBatches } from '../../src/app/AppRuntimeContext';
import type { Recipe } from '../../src/domain';
import { SourceBadge } from '../../src/ui/components/doop';
import { Button, Card, ErrorMessage, Heading, Label, Muted, number, Page, ui } from '../../src/ui/components/primitives';
import { NutritionReadout, RecipeEditor, validRecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import type { RecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import { MIN_TOUCH_TARGET } from '../../src/ui/tokens';

function RecipeDetail({ initial }: { initial: Recipe }) {
  const { controller } = useAppRuntime();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  const [batchDraft, setBatchDraft] = useState<RecipeDraft | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const batches = useRecipeBatches(saved.id);
  const action = useAction();
  const dirty = JSON.stringify({ name: draft.name.trim(), ingredients: draft.ingredients, cooked_weight_g: draft.cooked_weight_g, servings_count: draft.servings_count }) !==
    JSON.stringify({ name: saved.name, ingredients: saved.ingredients, cooked_weight_g: saved.cooked_weight_g, servings_count: saved.servings_count });
  return <Page title={`Recipe · ${saved.name}`} action={<Button label="Back" disabled={action.busy} onPress={() => router.back()} />}>
    <Card><View style={[ui.row, { justifyContent: 'space-between' }]}><View style={{ flex: 1 }}><Heading>{saved.name}</Heading></View><SourceBadge label={`v${saved.version}`} /></View>
      <NutritionReadout total={controller.previewRecipeTotals(draft.ingredients)} label="Total recipe · current amounts" />
      {draft.servings_count !== null && <NutritionReadout total={controller.previewRecipeTotals(draft.ingredients)} divisor={draft.servings_count} label="Per serving" />}
      <Muted>Edits apply to new logs only</Muted>
    </Card>
    <Card><RecipeEditor value={draft} disabled={action.busy} onChange={next => { setDraft(next); setSavedNotice(false); }} />
      <ErrorMessage message={action.error} />
      <Button label={action.busy ? 'Working…' : 'Save changes'} primary disabled={action.busy || !dirty || !validRecipeDraft(draft)} onPress={() => void action.run(async () => {
        const recipe = await controller.saveRecipe({ ...draft, id: saved.id, name: draft.name.trim(), notes: saved.notes });
        setSaved(recipe); setDraft(recipe); setSavedNotice(true);
      })} />
      {savedNotice && <Muted>Saved as v{saved.version}. Existing batches and diary entries keep their frozen amounts.</Muted>}
    </Card>
    <Card><Heading>Cooked batches</Heading><ErrorMessage message={batches.error} />
      {batches.loading && <Muted>Loading batches…</Muted>}
      {batches.value?.length === 0 && <Muted>No batches yet. Save the recipe, then record the amounts you cooked.</Muted>}
      {batches.value?.map(batch => <Pressable key={batch.id} accessibilityRole="button" accessibilityLabel={`Open batch from ${new Date(batch.created_at).toLocaleDateString()}`}
        onPress={() => router.push(`/recipes/batch/${batch.id}`)} style={[ui.button, { alignItems: 'flex-start', minHeight: MIN_TOUCH_TARGET }]}>
        <Label>{new Date(batch.created_at).toLocaleDateString()} · v{batch.recipe_version}</Label>
        <Muted>{batch.cooked_weight_g === null ? 'Cooked weight not set' : `${number(batch.cooked_weight_g, 2)} g cooked`} · {number(controller.previewRecipeTotals(batch.ingredients).nutrients?.kcal)} kcal</Muted>
      </Pressable>)}
      <Button label={batchDraft ? 'Close batch preparation' : '+ Cook a batch'} primary disabled={action.busy || dirty} onPress={() => setBatchDraft(current => current ? null : { ...saved, ingredients: saved.ingredients.map(item => ({ ...item, quantity: { ...item.quantity } })) })} />
      {dirty && <Muted>Save your recipe changes before starting a new batch.</Muted>}
    </Card>
    {batchDraft && <Card><Heading>Cook a batch</Heading><Muted>Tweak the actual cooked weight and ingredient amounts. Batch amounts don&apos;t change the recipe.</Muted>
      <RecipeEditor value={batchDraft} onChange={setBatchDraft} showName={false} allowAdd={false} disabled={action.busy} />
      <ErrorMessage message={action.error} />
      <Button label="Save cooked batch" primary disabled={action.busy || dirty || !validRecipeDraft(batchDraft)} onPress={() => void action.run(async () => {
        const batch = await controller.cookBatch({ recipeId: saved.id, ingredients: batchDraft.ingredients,
          cooked_weight_g: batchDraft.cooked_weight_g, servings_count: batchDraft.servings_count });
        setBatchDraft(null);
        router.push(`/recipes/batch/${batch.id}`);
      })} />
    </Card>}
  </Page>;
}

export default function RecipeScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] ?? '' : params.id ?? '';
  const { controller } = useAppRuntime();
  const recipe = useAsyncResource(useCallback(() => controller.getRecipe(id), [controller, id]));
  if (recipe.value) return <RecipeDetail key={recipe.value.id} initial={recipe.value} />;
  return <Page title="Recipe" action={<Button label="Back" onPress={() => router.back()} />}>
    <ErrorMessage message={recipe.error} /><Muted>{recipe.loading ? 'Loading recipe…' : recipe.error ? 'Could not load this recipe.' : 'Recipe not found.'}</Muted>
  </Page>;
}
