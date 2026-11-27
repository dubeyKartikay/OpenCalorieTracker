import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAction, useAppRuntime, useAsyncResource, usePreferences } from '../../../src/app/AppRuntimeContext';
import { MEALS, mealsForDay, parseRouteDate, type BatchServingAmount } from '../../../src/app/controller';
import { generateId, MAX_BATCH_FRACTION } from '../../../src/domain';
import type { Recipe, RecipeBatch } from '../../../src/domain';
import { UndoToast } from '../../../src/ui/components/Diary';
import { SegmentedSwitch } from '../../../src/ui/components/capture';
import { LearnedPortionChips, MealDestinationPills, NumericEditor, RevealPanel } from '../../../src/ui/components/doop';
import { BackHeader, energy, ErrorMessage, formatWeekdayDate, goBackOrReplace, Muted, number, Page, SectionRule } from '../../../src/ui/components/primitives';
import { RecIngredientRow, RecipeHero } from '../../../src/ui/components/recipes/RecipeEditor';
import { formatEnergyDensity } from '../../../src/ui/components/recipes/recipeViewMath';
import { hapticLight, hapticSelection, hapticSuccess } from '../../../src/ui/haptics';
import { SCREEN_GUTTER, spacing } from '../../../src/ui/tokens';

function BatchDetail({
  batch,
  recipe,
  targetMeal,
  targetDate,
}: {
  batch: RecipeBatch;
  recipe: Recipe | null;
  targetMeal?: string | undefined;
  targetDate?: string | undefined;
}) {
  const { controller } = useAppRuntime();
  const insets = useSafeAreaInsets();
  const preferences = usePreferences();
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const pickerMeals = mealsForDay(preferences.value?.mealSections ?? [...MEALS], [], [targetMeal]);
  const action = useAction();
  const [amount, setAmount] = useState<BatchServingAmount>(
    batch.cooked_weight_g === null
      ? { mode: 'fraction', fraction: batch.servings_count && batch.servings_count >= 1 ? 1 / batch.servings_count : 0.25 }
      : { mode: 'grams', grams: 150 },
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [loggedMeals, setLoggedMeals] = useState<string[]>([]);

  const total = controller.previewRecipeTotals(batch.ingredients);
  const portion = controller.previewBatchServing(batch, amount);
  const density = formatEnergyDensity(total.nutrients?.kcal, batch.cooked_weight_g, energyUnit);
  const recipeName = recipe?.name ?? 'Recipe batch';

  const updateAmount = (next: BatchServingAmount) => {
    if (next.mode === 'fraction' && (!Number.isFinite(next.fraction) || next.fraction <= 0 || next.fraction > MAX_BATCH_FRACTION)) return;
    if (next.mode === 'grams' && (!Number.isFinite(next.grams) || next.grams <= 0)) return;
    setAmount(next);
  };

  const choices: { label: string; value: BatchServingAmount }[] = batch.cooked_weight_g === null
    ? ([
        ...(batch.servings_count && batch.servings_count >= 1
          ? [{ label: '1 serving', value: { mode: 'fraction' as const, fraction: 1 / batch.servings_count } }]
          : []),
        { label: '¼ batch', value: { mode: 'fraction' as const, fraction: 0.25 } },
        { label: '⅓ batch', value: { mode: 'fraction' as const, fraction: 1 / 3 } },
        { label: '½ batch', value: { mode: 'fraction' as const, fraction: 0.5 } },
      ] as { label: string; value: BatchServingAmount }[]).slice(0, 3)
    : [
        { label: '150 g', value: { mode: 'grams', grams: 150 } },
        { label: '100 g', value: { mode: 'grams', grams: 100 } },
        batch.servings_count && batch.servings_count >= 1
          ? { label: '1 serving', value: { mode: 'fraction', fraction: 1 / batch.servings_count } }
          : { label: '¼ batch', value: { mode: 'fraction', fraction: 0.25 } },
      ];

  const portionLabel = amount.mode === 'grams'
    ? `${number(amount.grams, 0)} g`
    : `${number(amount.fraction * 100, 0)}% batch`;

  const customNumeric = Number(customDraft);
  const customValid = customDraft.trim() !== ''
    && Number.isFinite(customNumeric)
    && customNumeric > 0
    && (amount.mode === 'grams' || customNumeric <= MAX_BATCH_FRACTION);

  const log = (meal: string) => void action.run(async () => {
    await controller.logBatchServing({
      batch,
      recipeName,
      amount,
      meal,
      ...(targetDate ? { date: targetDate } : {}),
      idempotencyKey: generateId(),
    });
    hapticSuccess();
    setLoggedMeals(prev => (prev.includes(meal) ? prev : [...prev, meal]));
  });

  return (
    <Page
      overlay={
        <View pointerEvents="box-none" style={[styles.toast, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
          <UndoToast />
        </View>
      }
    >
      <BackHeader
        title={recipeName}
        subtitle={formatWeekdayDate(batch.created_at)}
        onBack={() => goBackOrReplace('/recipes')}
      />

      <RecipeHero
        nutrients={portion.nutrients}
        energyUnit={energyUnit}
        rightTop={portionLabel}
        rightSub={density ?? (batch.cooked_weight_g !== null ? `${number(batch.cooked_weight_g, 0)} g batch` : null)}
      />

      <View style={styles.sectionBlock}>
        <SectionRule
          label="Portion"
          meta={batch.cooked_weight_g !== null ? `${number(batch.cooked_weight_g, 0)} g batch` : undefined}
        />
        <LearnedPortionChips
          variant="calm"
          portions={choices.map(choice => {
            const preview = controller.previewBatchServing(batch, choice.value);
            return {
              label: choice.label,
              energyLabel: energy(preview.nutrients?.kcal, energyUnit),
              selected: !customOpen && JSON.stringify(choice.value) === JSON.stringify(amount),
            };
          })}
          disabled={action.busy}
          moreExpanded={customOpen}
          onSelect={index => {
            const picked = choices[index];
            if (picked) {
              setCustomOpen(false);
              updateAmount(picked.value);
            }
          }}
          onMore={() => {
            hapticSelection();
            setCustomDraft(String(amount.mode === 'grams' ? amount.grams : amount.fraction));
            setCustomOpen(open => !open);
          }}
        />

        {customOpen ? (
          <RevealPanel visible direction="down" style={styles.customBox}>
            {batch.cooked_weight_g !== null ? (
              <SegmentedSwitch
                options={[
                  { value: 'grams', label: 'Grams' },
                  { value: 'fraction', label: 'Fraction' },
                ]}
                value={amount.mode}
                disabled={action.busy}
                onChange={nextMode => {
                  hapticSelection();
                  if (nextMode === 'grams') {
                    updateAmount({ mode: 'grams', grams: 100 });
                    setCustomDraft('100');
                  } else {
                    updateAmount({ mode: 'fraction', fraction: 0.25 });
                    setCustomDraft('0.25');
                  }
                }}
              />
            ) : null}
            <NumericEditor
              value={customDraft}
              placeholder={amount.mode === 'grams' ? '150' : '0.25'}
              onChange={setCustomDraft}
              unit={amount.mode === 'grams' ? 'g' : 'batch'}
              maxDecimals={2}
              allowEmpty
              confirmDisabled={action.busy || !customValid}
              confirmLabel="Apply portion"
              cancelLabel="Cancel"
              onConfirm={() => {
                if (!customValid) return;
                hapticLight();
                updateAmount(amount.mode === 'grams' ? { mode: 'grams', grams: customNumeric } : { mode: 'fraction', fraction: customNumeric });
                setCustomOpen(false);
              }}
              onCancel={() => setCustomOpen(false)}
            />
          </RevealPanel>
        ) : null}
      </View>

      <View style={styles.sectionBlock}>
        <SectionRule label="Log to meal" meta={targetDate} />
        <MealDestinationPills
          variant="calm"
          meals={pickerMeals}
          selectedMeals={loggedMeals}
          suggestedMeal={targetMeal}
          disabled={action.busy}
          mode="log"
          onPress={log}
        />
      </View>

      <View style={styles.sectionBlock}>
        <SectionRule label="Ingredients" meta={energy(total.nutrients?.kcal, energyUnit)} />
        <View>
          {batch.ingredients.map((ingredient, index) => (
            <RecIngredientRow
              key={`${index}:${ingredient.food.source_pack_id ?? 'user'}:${ingredient.food.id}`}
              ingredient={ingredient}
              original={
                recipe?.version === batch.recipe_version
                  ? recipe.ingredients.find(
                      item => item.food.id === ingredient.food.id && (item.food.source_pack_id ?? null) === (ingredient.food.source_pack_id ?? null),
                    )
                  : undefined
              }
            />
          ))}
        </View>
      </View>

      <ErrorMessage message={action.error} />
    </Page>
  );
}

export default function BatchScreen() {
  const params = useLocalSearchParams<{ batchId: string | string[]; meal?: string | string[]; date?: string | string[] }>();
  const batchId = Array.isArray(params.batchId) ? params.batchId[0] ?? '' : params.batchId ?? '';
  const targetMeal = (Array.isArray(params.meal) ? params.meal[0] : params.meal)?.trim() || undefined;
  const targetDate = parseRouteDate(params.date);
  const { controller } = useAppRuntime();
  const resource = useAsyncResource(
    useCallback(async () => {
      const batch = await controller.getBatch(batchId);
      if (!batch) return null;
      return { batch, recipe: await controller.getRecipe(batch.recipe_id) };
    }, [batchId, controller]),
    batchId,
  );
  if (resource.value) return <BatchDetail key={resource.value.batch.id} {...resource.value} targetMeal={targetMeal} targetDate={targetDate} />;
  return (
    <Page>
      <BackHeader title="Batch" onBack={() => goBackOrReplace('/recipes')} />
      <ErrorMessage message={resource.error} />
      <Muted>{resource.loading ? 'Loading…' : resource.error ? 'Could not load batch.' : 'Batch not found.'}</Muted>
    </Page>
  );
}

const styles = StyleSheet.create({
  sectionBlock: { gap: spacing.s10 },
  customBox: { gap: spacing.s8, paddingTop: spacing.s6 },
  toast: { position: 'absolute', left: SCREEN_GUTTER, right: SCREEN_GUTTER, bottom: 8 },
});
