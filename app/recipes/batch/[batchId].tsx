import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useAction, useAppRuntime, useAsyncResource } from '../../../src/app/AppRuntimeContext';
import { MEALS } from '../../../src/app/controller';
import type { BatchServingAmount, Meal, UndoAction } from '../../../src/app/controller';
import { generateId } from '../../../src/domain';
import type { DiaryEntrySnapshot, RecipeBatch } from '../../../src/domain';
import { SourceBadge } from '../../../src/ui/components/doop';
import { Button, Card, ErrorMessage, Heading, Label, Muted, number, Page, ui } from '../../../src/ui/components/primitives';
import { NumericField, NutritionReadout, RecIngredientRow } from '../../../src/ui/components/recipes/RecipeEditor';
import { spacing } from '../../../src/ui/tokens';

function BatchDetail({ batch, recipeName }: { batch: RecipeBatch; recipeName: string }) {
  const { controller } = useAppRuntime();
  const action = useAction();
  const [amount, setAmount] = useState<BatchServingAmount>(batch.cooked_weight_g === null ? { mode: 'fraction', fraction: 0.25 } : { mode: 'grams', grams: 100 });
  const [meal, setMeal] = useState<Meal>('Lunch');
  const [receipt, setReceipt] = useState<{ entry: DiaryEntrySnapshot; undo: UndoAction | null } | null>(null);
  const [undone, setUndone] = useState(false);
  const total = controller.previewRecipeTotals(batch.ingredients);
  const portion = controller.previewBatchServing(batch, amount);
  const updateAmount = (next: BatchServingAmount) => { setAmount(next); setUndone(false); };
  return <Page title={`Batch of ${recipeName}`} action={<Button label="Back" disabled={action.busy} onPress={() => router.back()} />}>
    <Card><Heading>{new Date(batch.created_at).toLocaleDateString()}</Heading><SourceBadge label={`Recipe v${batch.recipe_version}`} />
      <Muted>Batch amounts don&apos;t change the recipe</Muted>
      <Label>{batch.cooked_weight_g === null ? 'Cooked weight not set' : `${number(batch.cooked_weight_g, 2)} g cooked`}{batch.servings_count !== null ? ` · Serves ${number(batch.servings_count, 2)}` : ''}</Label>
      <NutritionReadout total={total} label="Frozen batch total" />
    </Card>
    <Card><Heading>Frozen ingredients</Heading><Muted>These amounts and nutrition stay as they were when this batch was cooked.</Muted>
      {batch.ingredients.map((ingredient, index) => <RecIngredientRow key={`${index}:${ingredient.food.id}`} ingredient={ingredient} />)}
    </Card>
    <Card><Heading>Log a portion</Heading>
      {receipt ? <View accessibilityLiveRegion="polite" style={{ gap: spacing.s12 }}>
        <Heading>Logged to {receipt.entry.meal}</Heading>
        <Label>{number(receipt.entry.nutrients.kcal)} kcal · {number(receipt.entry.quantity.amount, 2)} {receipt.entry.quantity.unit === 'serving' ? 'of batch' : receipt.entry.quantity.unit}</Label>
        <Muted>{recipeName} · {receipt.entry.date}</Muted>
        <Button label="Undo" disabled={action.busy || !receipt.undo} onPress={() => void action.run(async () => {
          await receipt.undo?.run();
          if (controller.undoAction === receipt.undo) controller.dismissUndo(); else controller.refresh();
          setReceipt(null); setUndone(true);
        })} />
        <Button label="Log another portion" disabled={action.busy} onPress={() => { setReceipt(null); setUndone(false); }} />
      </View> : <>
        {undone && <Muted>Entry removed. You can adjust the portion and log again.</Muted>}
        <View style={ui.wrap}>
          <Button label="By grams" selected={amount.mode === 'grams'} disabled={action.busy || batch.cooked_weight_g === null} onPress={() => updateAmount({ mode: 'grams', grams: 100 })} />
          <Button label="By fraction" selected={amount.mode === 'fraction'} disabled={action.busy} onPress={() => updateAmount({ mode: 'fraction', fraction: 0.25 })} />
        </View>
        {batch.cooked_weight_g === null && <Muted>Gram portions need a cooked weight. Log a fraction of this batch instead.</Muted>}
        {amount.mode === 'grams' ? <>
          <View style={ui.wrap}>{[100, 150, 200, 250].map(grams => <Button key={grams} label={`${grams} g`} selected={amount.grams === grams} disabled={action.busy} onPress={() => updateAmount({ mode: 'grams', grams })} />)}</View>
          <NumericField label="Custom portion" unit="g" minimum={0.01} value={amount.grams} disabled={action.busy} onChange={grams => { if (grams !== null) updateAmount({ mode: 'grams', grams }); }} />
        </> : <View style={ui.wrap}>
          {([{ label: '¼ batch', fraction: 1 / 4 }, { label: '⅓ batch', fraction: 1 / 3 }, { label: '½ batch', fraction: 1 / 2 }] as const).map(item =>
            <Button key={item.label} label={item.label} selected={amount.fraction === item.fraction} disabled={action.busy} onPress={() => updateAmount({ mode: 'fraction', fraction: item.fraction })} />)}
          {batch.servings_count !== null && <Button label="1 serving" selected={amount.fraction === 1 / batch.servings_count} disabled={action.busy || batch.servings_count < 1}
            onPress={() => updateAmount({ mode: 'fraction', fraction: 1 / batch.servings_count! })} />}
        </View>}
        <NutritionReadout total={portion} label="This portion" />
        <View style={ui.wrap}>{MEALS.map(value => <Button key={value} label={value} selected={meal === value} disabled={action.busy} onPress={() => setMeal(value)} />)}</View>
        <Button label={action.busy ? 'Logging…' : `Log to ${meal}`} primary disabled={action.busy} onPress={() => void action.run(async () => {
          const entry = await controller.logBatchServing({ batch, recipeName, amount, meal, idempotencyKey: generateId() });
          setReceipt({ entry, undo: controller.undoAction }); setUndone(false);
        })} />
      </>}
      <ErrorMessage message={action.error} />
    </Card>
  </Page>;
}

export default function BatchScreen() {
  const params = useLocalSearchParams<{ batchId: string | string[] }>();
  const batchId = Array.isArray(params.batchId) ? params.batchId[0] ?? '' : params.batchId ?? '';
  const { controller } = useAppRuntime();
  const resource = useAsyncResource(useCallback(async () => {
    const batch = await controller.getBatch(batchId);
    if (!batch) return null;
    const recipe = await controller.getRecipe(batch.recipe_id);
    return { batch, recipeName: recipe?.name ?? 'Saved recipe' };
  }, [batchId, controller]));
  if (resource.value) return <BatchDetail key={resource.value.batch.id} {...resource.value} />;
  return <Page title="Cooked batch" action={<Button label="Back" onPress={() => router.back()} />}>
    <ErrorMessage message={resource.error} /><Muted>{resource.loading ? 'Loading batch…' : resource.error ? 'Could not load this batch.' : 'Batch not found.'}</Muted>
  </Page>;
}
