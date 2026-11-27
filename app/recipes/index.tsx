import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAction, useAppRuntime, usePreferences, useRecipes } from '../../src/app/AppRuntimeContext';
import { scaleNutrients } from '../../src/domain';
import { DoopIcon, inferFoodGlyph } from '../../src/ui/components/DoopIcons';
import { MacroProportionBar } from '../../src/ui/components/doop';
import { BackHeader, Button, energyValue, ErrorMessage, goBackOrReplace, Muted, number, Page } from '../../src/ui/components/primitives';
import { RecipeEditor, validRecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import type { RecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import { formatRecipeCardMeta } from '../../src/ui/components/recipes/recipeViewMath';
import { hapticLight, hapticSelection, hapticSuccess } from '../../src/ui/haptics';
import { colors, fontFace, radius, spacing, tabularNums } from '../../src/ui/tokens';

const EMPTY_DRAFT: RecipeDraft = { name: '', ingredients: [], cooked_weight_g: null, servings_count: null };

export default function Recipes() {
  const params = useLocalSearchParams<{ meal?: string; date?: string }>();
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const recipes = useRecipes();
  const action = useAction();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<RecipeDraft>(EMPTY_DRAFT);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);
  const destinationParams = {
    ...(params.meal ? { meal: params.meal } : {}),
    ...(params.date ? { date: params.date } : {}),
  };

  const canSaveNew = validRecipeDraft(draft) && !action.busy;
  const saveNewRecipe = () => {
    if (!canSaveNew) return;
    Keyboard.dismiss();
    void action.run(async () => {
      const recipe = await controller.saveRecipe({ ...draft, name: draft.name.trim() });
      hapticSuccess();
      setDraft(EMPTY_DRAFT);
      setCreating(false);
      router.push({ pathname: '/recipes/[id]', params: { id: recipe.id, ...destinationParams } });
    });
  };

  if (creating) {
    return (
      <Page scrollRef={scrollRef} onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}>
        <BackHeader
          title="New recipe"
          backIcon="close"
          backLabel="Close new recipe"
          onBack={() => {
            Keyboard.dismiss();
            hapticSelection();
            setCreating(false);
          }}
          right={
            canSaveNew ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save recipe"
                onPress={saveNewRecipe}
                style={({ pressed }) => [styles.iconHit, pressed && styles.pressed]}
              >
                <View style={styles.headerAccentCircle}>
                  <DoopIcon name="check" size={17} color={colors.accent} strokeWidth={2.4} />
                </View>
              </Pressable>
            ) : null
          }
        />
        <RecipeEditor
          value={draft}
          onChange={setDraft}
          disabled={action.busy}
          scrollRef={scrollRef}
          scrollOffsetRef={scrollOffsetRef}
        />
        <ErrorMessage message={action.error} />
        <Button
          label={action.busy ? 'Saving…' : 'Save recipe'}
          primary
          disabled={!canSaveNew}
          onPress={saveNewRecipe}
        />
      </Page>
    );
  }

  return (
    <Page scrollRef={scrollRef} onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}>
      <BackHeader
        title="Recipes"
        onBack={() => goBackOrReplace('/(tabs)/library')}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New recipe"
            disabled={action.busy}
            onPress={() => {
              hapticLight();
              setDraft(EMPTY_DRAFT);
              setCreating(true);
            }}
            style={({ pressed }) => [styles.iconHit, pressed && styles.pressed]}
          >
            <View style={styles.headerAccentCircle}>
              <DoopIcon name="plus" size={18} color={colors.accent} />
            </View>
          </Pressable>
        }
      />

      <ErrorMessage message={recipes.error} />
      {recipes.loading ? <Muted>Loading…</Muted> : null}

      {recipes.value?.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <DoopIcon name="recipe" size={26} color={colors.muted} />
          </View>
          <Text style={styles.emptyTitle}>No recipes yet</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              hapticLight();
              setDraft(EMPTY_DRAFT);
              setCreating(true);
            }}
            style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}
          >
            <DoopIcon name="plus" size={15} color={colors.accent} />
            <Text style={styles.emptyActionText}>New recipe</Text>
          </Pressable>
        </View>
      ) : null}

      <View>
        {recipes.value?.map(recipe => {
          const total = controller.previewRecipeTotals(recipe.ingredients);
          const hasServings = recipe.servings_count !== null && recipe.servings_count > 0;
          const shown = total.nutrients
            ? hasServings
              ? scaleNutrients(total.nutrients, 1 / recipe.servings_count!)
              : total.nutrients
            : null;
          return (
            <Pressable
              key={recipe.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${recipe.name}`}
              onPress={() => {
                hapticSelection();
                router.push({ pathname: '/recipes/[id]', params: { id: recipe.id, ...destinationParams } });
              }}
              style={({ pressed }) => [styles.recipeRow, pressed && styles.pressed]}
            >
              <View style={styles.recipeWell}>
                <DoopIcon name={inferFoodGlyph(recipe.name, 'recipe')} size={19} color={colors.ink} />
              </View>
              <View style={styles.recipeMain}>
                <Text numberOfLines={1} style={styles.recipeName}>{recipe.name}</Text>
                <Text numberOfLines={1} style={styles.recipeMeta}>{formatRecipeCardMeta(recipe)}</Text>
                <MacroProportionBar
                  proteinG={shown?.protein_g ?? 0}
                  carbsG={shown?.carbs_g ?? 0}
                  fatG={shown?.fat_g ?? 0}
                  height={3}
                  gap={1.5}
                  style={styles.recipeBar}
                />
              </View>
              <View style={styles.recipeRight}>
                <Text style={styles.recipeKcal}>{number(energyValue(shown?.kcal, energyUnit))}</Text>
                <Text style={styles.recipeUnit}>{hasServings ? `${energyUnit}/srv` : energyUnit}</Text>
              </View>
              <DoopIcon name="chevronRight" size={16} color={colors.muted} />
            </Pressable>
          );
        })}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  iconHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerAccentCircle: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: 'rgba(122,162,247,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(122,162,247,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.s32 * 2,
    gap: spacing.s12,
  },
  emptyCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...fontFace('semibold'), fontSize: 16, color: colors.ink },
  emptyAction: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(122,162,247,0.45)',
    backgroundColor: 'rgba(122,162,247,0.12)',
    marginTop: spacing.s4,
  },
  emptyActionText: { ...fontFace('semibold'), fontSize: 14, color: colors.accent },
  recipeRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  recipeWell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeMain: { flex: 1, minWidth: 0, gap: 3 },
  recipeName: { ...fontFace('semibold'), fontSize: 15, color: colors.ink },
  recipeMeta: { ...fontFace('medium'), ...tabularNums, fontSize: 12, color: colors.muted },
  recipeBar: { marginTop: 3, maxWidth: 132 },
  recipeRight: { alignItems: 'flex-end' },
  recipeKcal: { ...fontFace('bold'), ...tabularNums, fontSize: 18, color: colors.ink, letterSpacing: -0.3 },
  recipeUnit: { ...fontFace('medium'), fontSize: 10, color: colors.muted },
  pressed: { opacity: 0.7 },
});
