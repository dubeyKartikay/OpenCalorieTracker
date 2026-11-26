import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAction, useAppRuntime, useAsyncResource, usePreferences } from '../../../src/app/AppRuntimeContext';
import { MEALS, mealsForDay, parseRouteDate, type BatchServingAmount, type UndoAction } from '../../../src/app/controller';
import { generateId, MAX_BATCH_FRACTION } from '../../../src/domain';
import type { DiaryEntrySnapshot, Recipe, RecipeBatch } from '../../../src/domain';
import { LearnedPortionChips, MealDestinationPills } from '../../../src/ui/components/doop';
import { BackHeader, Button, DottedValue, energy, energyValue, ErrorMessage, formatWeekdayDate, goBackOrReplace, Muted, number, Page, SectionRule, ui } from '../../../src/ui/components/primitives';
import { NumericField, NutritionReadout, RecIngredientRow } from '../../../src/ui/components/recipes/RecipeEditor';
import { DoopIcon } from '../../../src/ui/components/DoopIcons';
import { colors, fontFace, macroColors, tabularNums } from '../../../src/ui/tokens';

function BatchDetail({ batch, recipe, targetMeal, targetDate }: { batch: RecipeBatch; recipe: Recipe | null; targetMeal?: string | undefined; targetDate?: string | undefined }) {
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const pickerMeals = mealsForDay(preferences.value?.mealSections ?? [...MEALS], [], [targetMeal]);
  const action = useAction();
  const [amount, setAmount] = useState<BatchServingAmount>(batch.cooked_weight_g === null ? { mode: 'fraction', fraction: 0.25 } : { mode: 'grams', grams: 150 });
  const [customOpen, setCustomOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ entry: DiaryEntrySnapshot; undo: UndoAction | null } | null>(null);
  const total = controller.previewRecipeTotals(batch.ingredients);
  const portion = controller.previewBatchServing(batch, amount);
  const updateAmount = (next: BatchServingAmount) => {
    if (next.mode === 'fraction' && (!Number.isFinite(next.fraction) || next.fraction <= 0 || next.fraction > MAX_BATCH_FRACTION)) return;
    if (next.mode === 'grams' && (!Number.isFinite(next.grams) || next.grams <= 0)) return;
    setAmount(next);
    setReceipt(null);
  };
  const recipeName = recipe?.name ?? 'Saved recipe';
  const choices: { label: string; value: BatchServingAmount }[] = batch.cooked_weight_g === null
    ? [{ label: '¼ batch', value: { mode: 'fraction', fraction: 0.25 } }, { label: '⅓ batch', value: { mode: 'fraction', fraction: 1 / 3 } }, { label: '½ batch', value: { mode: 'fraction', fraction: 0.5 } }]
    : [{ label: '1 katori', value: { mode: 'grams', grams: 150 } }, { label: '½ katori', value: { mode: 'grams', grams: 75 } }, { label: '¼ batch', value: { mode: 'fraction', fraction: 0.25 } }];
  const log = (meal: string) => void action.run(async () => {
    const entry = await controller.logBatchServing({ batch, recipeName, amount, meal, ...(targetDate ? { date: targetDate } : {}), idempotencyKey: generateId() });
    setReceipt({ entry, undo: controller.undoAction });
  });
  return <Page><BackHeader title={`Batch of ${recipeName}`} subtitle={formatWeekdayDate(batch.created_at)} onBack={() => goBackOrReplace('/recipes')} />
    <View style={{ marginTop: 12 }}>
      <View style={styles.yield}><DottedValue value={batch.cooked_weight_g === null ? '—' : number(batch.cooked_weight_g, 2)} size={16} /><Text style={styles.muted}>g cooked</Text></View>
      <NutritionReadout total={total} label="total" />
      {batch.cooked_weight_g !== null && <NutritionReadout total={total} divisor={batch.cooked_weight_g / 100} label="per 100 g" hideMacros />}
      <View style={{ marginTop: 28, marginBottom: 8 }}><SectionRule label="Ingredients" /></View>
      {batch.ingredients.map((ingredient, index) => <RecIngredientRow key={`${index}:${ingredient.food.id}`} ingredient={ingredient}
        original={recipe?.version === batch.recipe_version ? recipe.ingredients.find(item => item.food.id === ingredient.food.id && item.food.source_pack_id === ingredient.food.source_pack_id) : undefined} />)}
      <Text style={styles.note}>Batch amounts don’t change the recipe</Text>
      <View style={{ marginTop: 28, marginBottom: 12 }}><SectionRule label="Portions" /></View>
      <LearnedPortionChips
        portions={choices.map(choice => {
          const preview = controller.previewBatchServing(batch, choice.value);
          return {
            label: choice.label,
            energyLabel: `${choice.value.mode === 'grams' ? `${choice.value.grams} g · ` : ''}${number(energyValue(preview.nutrients?.kcal, energyUnit))}`,
            selected: JSON.stringify(choice.value) === JSON.stringify(amount),
          };
        })}
        disabled={action.busy}
        moreExpanded={customOpen}
        onSelect={index => {
          const picked = choices[index];
          if (picked) updateAmount(picked.value);
        }}
        onMore={() => setCustomOpen(open => !open)}
      />
      {customOpen && <View style={{ marginVertical: 8 }}><View style={ui.wrap}>
        <Button label="By grams" disabled={batch.cooked_weight_g === null} selected={amount.mode === 'grams'} onPress={() => updateAmount({ mode: 'grams', grams: 100 })} />
        <Button label="By fraction" selected={amount.mode === 'fraction'} onPress={() => updateAmount({ mode: 'fraction', fraction: 0.25 })} />
        {batch.servings_count !== null && <Button label="1 serving" disabled={batch.servings_count < 1} onPress={() => updateAmount({ mode: 'fraction', fraction: 1 / batch.servings_count! })} />}
      </View><NumericField label="Custom portion" unit={amount.mode === 'grams' ? 'g' : 'of batch'} minimum={0.001} maximum={amount.mode === 'fraction' ? MAX_BATCH_FRACTION : undefined} value={amount.mode === 'grams' ? amount.grams : amount.fraction} disabled={action.busy}
        onChange={value => { if (value !== null) updateAmount(amount.mode === 'grams' ? { mode: 'grams', grams: value } : { mode: 'fraction', fraction: value }); }} /></View>}
      <View style={styles.macros}><Text style={[styles.macro, { color: macroColors.protein }]}>P {number(portion.nutrients?.protein_g)}</Text><Text style={[styles.macro, { color: macroColors.carbs }]}>C {number(portion.nutrients?.carbs_g)}</Text><Text style={[styles.macro, { color: macroColors.fat }]}>F {number(portion.nutrients?.fat_g)}</Text><Text style={[styles.chipSub, { marginLeft: 'auto' }]}>{energy(portion.nutrients?.kcal, energyUnit)}</Text></View>
      <MealDestinationPills
        meals={pickerMeals}
        selectedMeals={receipt ? [receipt.entry.meal] : []}
        suggestedMeal={targetMeal}
        disabled={action.busy || !!receipt}
        mode="log"
        onPress={log}
        style={{ marginTop: 12 }}
      />
      {receipt && <View accessibilityLiveRegion="polite" style={styles.receipt}><DoopIcon name="check" size={14} color={colors.mint} /><Text style={styles.muted}>{receipt.entry.meal} · {energy(receipt.entry.nutrients.kcal, energyUnit)}</Text>
        <Pressable accessibilityRole="button" disabled={action.busy || !receipt.undo} onPress={() => void action.run(async () => { await receipt.undo?.run(); if (controller.undoAction === receipt.undo) controller.dismissUndo(); else controller.refresh(); setReceipt(null); })} style={styles.undo}><Text style={styles.undoText}>Undo</Text></Pressable>
        <Button label="Log another" quiet onPress={() => setReceipt(null)} />
      </View>}
      <ErrorMessage message={action.error} />
    </View>
  </Page>;
}
export default function BatchScreen() {
  const params = useLocalSearchParams<{ batchId: string | string[]; meal?: string | string[]; date?: string | string[] }>();
  const batchId = Array.isArray(params.batchId) ? params.batchId[0] ?? '' : params.batchId ?? '';
  const targetMeal = (Array.isArray(params.meal) ? params.meal[0] : params.meal)?.trim() || undefined;
  const targetDate = parseRouteDate(params.date);
  const { controller } = useAppRuntime();
  const resource = useAsyncResource(useCallback(async () => { const batch = await controller.getBatch(batchId); if (!batch) return null; return { batch, recipe: await controller.getRecipe(batch.recipe_id) }; }, [batchId, controller]), batchId);
  if (resource.value) return <BatchDetail key={resource.value.batch.id} {...resource.value} targetMeal={targetMeal} targetDate={targetDate} />;
  return <Page><BackHeader title="Cooked batch" onBack={() => goBackOrReplace('/recipes')} /><ErrorMessage message={resource.error} /><Muted>{resource.loading ? 'Loading batch…' : resource.error ? 'Could not load this batch.' : 'Batch not found.'}</Muted></Page>;
}
const styles = StyleSheet.create({
  yield: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 }, muted: { ...fontFace(), color: colors.muted, fontSize: 13 },
  note: { ...fontFace(), fontSize: 11, color: colors.muted, opacity: 0.82, marginTop: 8 },
  chipSub: { ...fontFace(), ...tabularNums, color: colors.muted, fontSize: 10 },
  macros: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 10 }, macro: { ...fontFace('semibold'), ...tabularNums, fontSize: 12 },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderColor: colors.hairline, marginTop: 10 }, undo: { minHeight: 44, justifyContent: 'center', marginLeft: 'auto' }, undoText: { ...fontFace('semibold'), fontSize: 11, color: colors.accent },
});
