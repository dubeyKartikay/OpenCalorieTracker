import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAction, useAppRuntime, useRecipes } from '../../src/app/AppRuntimeContext';
import { SourceBadge } from '../../src/ui/components/doop';
import { BackHeader, Button, ErrorMessage, goBackOrReplace, Heading, Muted, number, Page, ui } from '../../src/ui/components/primitives';
import { NutritionReadout, RecipeEditor, validRecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import type { RecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import { colors, MIN_TOUCH_TARGET, spacing } from '../../src/ui/tokens';

export default function Recipes() {
  const params = useLocalSearchParams<{ meal?: string; date?: string }>();
  const { controller } = useAppRuntime();
  const recipes = useRecipes();
  const action = useAction();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<RecipeDraft>({ name: '', ingredients: [], cooked_weight_g: null, servings_count: null });
  const destinationParams = {
    ...(params.meal ? { meal: params.meal } : {}),
    ...(params.date ? { date: params.date } : {}),
  };
  return <Page><BackHeader title="Recipes" onBack={() => goBackOrReplace('/(tabs)/library')} />
    <Button label={creating ? 'Close new recipe' : '+ New recipe'} selected={creating} disabled={action.busy} onPress={() => setCreating(current => !current)} />
    {creating && <View style={{ gap: 12 }}><Heading>New recipe</Heading>
      <RecipeEditor value={draft} onChange={setDraft} disabled={action.busy} />
      <ErrorMessage message={action.error} />
      <Button label={action.busy ? 'Saving…' : 'Save recipe'} primary disabled={action.busy || !validRecipeDraft(draft)} onPress={() => void action.run(async () => {
        const recipe = await controller.saveRecipe({ ...draft, name: draft.name.trim() });
        setDraft({ name: '', ingredients: [], cooked_weight_g: null, servings_count: null }); setCreating(false);
        router.push({ pathname: '/recipes/[id]', params: { id: recipe.id, ...destinationParams } });
      })} />
    </View>}
    <ErrorMessage message={recipes.error} />
    {recipes.loading && <Muted>Loading recipes…</Muted>}
    {recipes.value?.length === 0 && <View style={{ gap: 12 }}><Heading>Your recipes, saved locally</Heading><Muted>Create a recipe from ingredients, then cook batches and log portions.</Muted></View>}
    {recipes.value?.map(recipe => {
      const total = controller.previewRecipeTotals(recipe.ingredients);
      return <Pressable key={recipe.id} accessibilityRole="button" accessibilityLabel={`Open ${recipe.name}, version ${recipe.version}`}
        onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: recipe.id, ...destinationParams } })} style={({ pressed }) => [{ gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.hairline, minHeight: MIN_TOUCH_TARGET, opacity: pressed ? 0.7 : 1 }]}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={[ui.heading, { flex: 1 }]}>{recipe.name}</Text><SourceBadge label={`v${recipe.version}`} /></View>
        <Muted>{recipe.cooked_weight_g === null ? 'Cooked weight not set' : `${number(recipe.cooked_weight_g, 2)} g cooked`}{recipe.servings_count === null ? ' · Servings not set' : ` · Serves ${number(recipe.servings_count, 2)}`}</Muted>
        <NutritionReadout total={total} divisor={recipe.servings_count ?? 1} label={recipe.servings_count === null ? 'Total recipe · set servings for a per-serving preview' : 'Per serving'} />
        <View style={{ height: spacing.s2 }} />
      </Pressable>;
    })}
  </Page>;
}
