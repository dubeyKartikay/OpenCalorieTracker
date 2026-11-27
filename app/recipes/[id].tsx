import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAction, useAppRuntime, useAsyncResource, usePreferences, useRecipeBatches } from '../../src/app/AppRuntimeContext';
import type { Recipe } from '../../src/domain';
import { UndoToast } from '../../src/ui/components/Diary';
import { DoopIcon } from '../../src/ui/components/DoopIcons';
import { SegmentedSwitch } from '../../src/ui/components/capture';
import { BackHeader, Button, energy, ErrorMessage, formatWeekdayDate, goBackOrReplace, Muted, number, Page, SectionRule } from '../../src/ui/components/primitives';
import { RecipeEditor, validRecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import type { RecipeDraft } from '../../src/ui/components/recipes/RecipeEditor';
import { isRecipeDraftDirty } from '../../src/ui/components/recipes/recipeViewMath';
import { hapticLight, hapticSelection, hapticSuccess } from '../../src/ui/haptics';
import { colors, fontFace, fontSize, radius, SCREEN_GUTTER, spacing, tabularNums } from '../../src/ui/tokens';

const MODE_OPTIONS = [
  { value: 'recipe', label: 'Recipe' },
  { value: 'batch', label: 'Cook batch' },
];

function RecipeDetail({ initial, targetMeal, targetDate }: { initial: Recipe; targetMeal?: string | undefined; targetDate?: string | undefined }) {
  const { controller } = useAppRuntime();
  const insets = useSafeAreaInsets();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  const [mode, setMode] = useState<'recipe' | 'batch'>('recipe');
  const [batchDraft, setBatchDraft] = useState<RecipeDraft | null>(null);
  const [nameMode, setNameMode] = useState<'normal' | 'armed' | 'edit'>('normal');
  const batches = useRecipeBatches(saved.id);
  const action = useAction();
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);
  const destinationParams = {
    ...(targetMeal ? { meal: targetMeal } : {}),
    ...(targetDate ? { date: targetDate } : {}),
  };

  const dirty = isRecipeDraftDirty(draft, saved);
  const canSaveRecipe = dirty && validRecipeDraft(draft) && !action.busy;

  const saveRecipeChanges = () => {
    if (!canSaveRecipe) {
      if (nameMode === 'edit') {
        Keyboard.dismiss();
        setNameMode('normal');
      }
      return;
    }
    Keyboard.dismiss();
    void action.run(async () => {
      const recipe = await controller.saveRecipe({ ...draft, id: saved.id, name: draft.name.trim(), notes: saved.notes });
      hapticSuccess();
      setSaved(recipe);
      setDraft(recipe);
      setNameMode('normal');
    });
  };

  const switchMode = (next: 'recipe' | 'batch') => {
    if (next === mode) return;
    hapticSelection();
    setNameMode('normal');
    if (next === 'batch') {
      setBatchDraft({
        ...saved,
        ingredients: saved.ingredients.map(item => ({ ...item, quantity: { ...item.quantity } })),
      });
    }
    setMode(next);
  };

  const onTapHeaderName = () => {
    if (mode !== 'recipe' || action.busy) return;
    if (nameMode === 'normal') {
      hapticSelection();
      setNameMode('armed');
      return;
    }
    if (nameMode === 'armed') {
      hapticLight();
      setNameMode('edit');
    }
  };

  const discardNameOrGoBack = () => {
    if (nameMode === 'edit') {
      Keyboard.dismiss();
      hapticSelection();
      setDraft(current => ({ ...current, name: saved.name }));
      setNameMode('normal');
      return;
    }
    if (mode === 'batch') {
      hapticSelection();
      setMode('recipe');
      return;
    }
    goBackOrReplace('/recipes');
  };

  const shareRecipe = () => {
    hapticLight();
    void action.run(() => Share.share({
      message: `${saved.name}\n${saved.ingredients.map(item => `${item.food.name}: ${item.quantity.amount} ${item.quantity.unit}`).join('\n')}`,
    }));
  };

  const saveBatch = () => {
    if (!batchDraft || action.busy || dirty || !validRecipeDraft(batchDraft)) return;
    Keyboard.dismiss();
    void action.run(async () => {
      const batch = await controller.cookBatch({
        recipeId: saved.id,
        ingredients: batchDraft.ingredients,
        cooked_weight_g: batchDraft.cooked_weight_g,
        servings_count: batchDraft.servings_count,
      });
      hapticSuccess();
      setBatchDraft(null);
      setMode('recipe');
      router.push({ pathname: '/recipes/batch/[batchId]', params: { batchId: batch.id, ...destinationParams } });
    });
  };

  return (
    <Page
      scrollRef={scrollRef}
      onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
      overlay={
        <View pointerEvents="box-none" style={[styles.toast, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
          <UndoToast />
        </View>
      }
    >
      <BackHeader
        title={draft.name || saved.name}
        backIcon={nameMode === 'edit' ? 'close' : 'back'}
        backLabel={nameMode === 'edit' ? 'Discard name edit' : 'Back'}
        onBack={discardNameOrGoBack}
        titleContent={
          nameMode === 'edit' ? (
            <TextInput
              accessibilityLabel="Recipe name"
              autoFocus
              selectTextOnFocus
              value={draft.name}
              onChangeText={name => setDraft(current => ({ ...current, name }))}
              onSubmitEditing={saveRecipeChanges}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              placeholder="Recipe name"
              placeholderTextColor={colors.muted}
              editable={!action.busy}
              style={styles.headerNameInput}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={nameMode === 'armed' ? `Edit ${draft.name}. Tap again to rename.` : draft.name}
              disabled={mode !== 'recipe' || action.busy}
              onPress={onTapHeaderName}
              style={({ pressed }) => [
                styles.headerTitleTap,
                nameMode === 'armed' && styles.headerTitleArmed,
                pressed && mode === 'recipe' && styles.pressed,
              ]}
            >
              <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitleText}>
                {draft.name || saved.name}
              </Text>
              {nameMode === 'armed' ? <DoopIcon name="edit" size={14} color={colors.accent} strokeWidth={1.85} /> : null}
            </Pressable>
          )
        }
        right={
          (nameMode === 'edit' || canSaveRecipe) && mode === 'recipe' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save recipe"
              disabled={action.busy || !validRecipeDraft(draft)}
              onPress={saveRecipeChanges}
              style={({ pressed }) => [styles.iconHit, pressed && styles.pressed]}
            >
              <View style={styles.headerTickPill}>
                <DoopIcon name="check" size={17} color={colors.accent} strokeWidth={2.4} />
              </View>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share recipe"
              disabled={action.busy}
              onPress={shareRecipe}
              style={({ pressed }) => [styles.iconHit, pressed && styles.pressed]}
            >
              <DoopIcon name="external" size={18} color={colors.muted} />
            </Pressable>
          )
        }
      />

      <SegmentedSwitch
        options={MODE_OPTIONS}
        value={mode}
        disabled={action.busy}
        onChange={value => switchMode(value as 'recipe' | 'batch')}
      />

      {mode === 'recipe' ? (
        <View style={styles.body}>
          <RecipeEditor
            value={draft}
            showName={false}
            disabled={action.busy}
            scrollRef={scrollRef}
            scrollOffsetRef={scrollOffsetRef}
            onChange={next => {
              if (nameMode === 'armed') setNameMode('normal');
              setDraft(next);
            }}
          />

          <ErrorMessage message={action.error} />

          {dirty ? (
            <Button
              label={action.busy ? 'Saving…' : 'Save changes'}
              primary
              disabled={!canSaveRecipe}
              onPress={saveRecipeChanges}
            />
          ) : null}

          <View style={styles.batchesSection}>
            <SectionRule
              label="Batches"
              meta={batches.value?.length ? String(batches.value.length) : undefined}
            />
            <ErrorMessage message={batches.error} />
            {batches.loading ? <Muted>Loading…</Muted> : null}

            {batches.value?.map(batch => {
              const total = controller.previewRecipeTotals(batch.ingredients);
              return (
                <Pressable
                  key={batch.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open batch from ${formatWeekdayDate(batch.created_at)}`}
                  onPress={() => {
                    hapticSelection();
                    router.push({ pathname: '/recipes/batch/[batchId]', params: { batchId: batch.id, ...destinationParams } });
                  }}
                  style={({ pressed }) => [styles.batchRow, pressed && styles.pressed]}
                >
                  <Text style={styles.batchDate}>{formatWeekdayDate(batch.created_at)}</Text>
                  <Text numberOfLines={1} style={styles.batchMeta}>
                    {batch.cooked_weight_g !== null ? `${number(batch.cooked_weight_g, 0)} g` : `${batch.ingredients.length} items`}
                  </Text>
                  <Text style={styles.batchKcal}>{energy(total.nutrients?.kcal, energyUnit)}</Text>
                  <DoopIcon name="chevronRight" size={16} color={colors.muted} />
                </Pressable>
              );
            })}

            {!batches.loading && (batches.value?.length ?? 0) === 0 ? (
              <Pressable
                accessibilityRole="button"
                disabled={action.busy}
                onPress={() => switchMode('batch')}
                style={({ pressed }) => [styles.cookPill, pressed && styles.pressed]}
              >
                <DoopIcon name="plus" size={14} color={colors.accent} />
                <Text style={styles.cookPillText}>Cook batch</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.body}>
          {dirty ? (
            <View style={styles.unsavedCard}>
              <Text style={styles.unsavedText}>Save recipe changes first</Text>
              <Button
                label={action.busy ? 'Saving…' : 'Save & cook'}
                primary
                disabled={!canSaveRecipe}
                onPress={() => {
                  if (!canSaveRecipe) return;
                  void action.run(async () => {
                    const recipe = await controller.saveRecipe({ ...draft, id: saved.id, name: draft.name.trim(), notes: saved.notes });
                    hapticSuccess();
                    setSaved(recipe);
                    setDraft(recipe);
                    setBatchDraft({
                      ...recipe,
                      ingredients: recipe.ingredients.map(item => ({ ...item, quantity: { ...item.quantity } })),
                    });
                  });
                }}
              />
            </View>
          ) : batchDraft ? (
            <>
              <RecipeEditor
                value={batchDraft}
                onChange={setBatchDraft}
                originalIngredients={saved.ingredients}
                showName={false}
                allowAdd={false}
                disabled={action.busy}
                scrollRef={scrollRef}
                scrollOffsetRef={scrollOffsetRef}
              />
              <ErrorMessage message={action.error} />
              <Button
                label={action.busy ? 'Saving…' : 'Save batch'}
                primary
                disabled={action.busy || !validRecipeDraft(batchDraft)}
                onPress={saveBatch}
              />
            </>
          ) : null}
        </View>
      )}
    </Page>
  );
}

export default function RecipeScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; meal?: string | string[]; date?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] ?? '' : params.id ?? '';
  const targetMeal = (Array.isArray(params.meal) ? params.meal[0] : params.meal)?.trim() || undefined;
  const targetDate = (Array.isArray(params.date) ? params.date[0] : params.date)?.trim() || undefined;
  const { controller } = useAppRuntime();
  const recipe = useAsyncResource(useCallback(() => controller.getRecipe(id), [controller, id]), id);
  if (recipe.value) return <RecipeDetail key={recipe.value.id} initial={recipe.value} targetMeal={targetMeal} targetDate={targetDate} />;
  return (
    <Page>
      <BackHeader title="Recipe" onBack={() => goBackOrReplace('/recipes')} />
      <ErrorMessage message={recipe.error} />
      <Muted>{recipe.loading ? 'Loading…' : recipe.error ? 'Could not load recipe.' : 'Recipe not found.'}</Muted>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.s16 },
  iconHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTickPill: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: 'rgba(122,162,247,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(122,162,247,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleTap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.r8,
  },
  headerTitleArmed: {
    backgroundColor: 'rgba(122,162,247,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122,162,247,0.38)',
  },
  headerTitleText: {
    ...fontFace('bold'),
    fontSize: fontSize.t20,
    color: colors.ink,
    letterSpacing: -0.3,
    flexShrink: 1,
    textAlign: 'center',
  },
  headerNameInput: {
    ...fontFace('bold'),
    fontSize: fontSize.t20,
    color: colors.ink,
    letterSpacing: -0.3,
    textAlign: 'center',
    width: '100%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
  },
  batchesSection: { gap: spacing.s8, paddingTop: spacing.s4 },
  batchRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  batchDate: { ...fontFace('semibold'), fontSize: 14, color: colors.ink },
  batchMeta: { ...fontFace('medium'), ...tabularNums, fontSize: 13, color: colors.muted, flex: 1 },
  batchKcal: { ...fontFace('semibold'), ...tabularNums, fontSize: 14, color: colors.ink },
  cookPill: {
    alignSelf: 'flex-start',
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  cookPillText: { ...fontFace('semibold'), fontSize: 13, color: colors.accent },
  unsavedCard: {
    padding: spacing.s16,
    borderRadius: radius.r16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    gap: spacing.s12,
  },
  unsavedText: { ...fontFace('semibold'), fontSize: 14, color: colors.ink },
  toast: { position: 'absolute', left: SCREEN_GUTTER, right: SCREEN_GUTTER, bottom: 8 },
  pressed: { opacity: 0.7 },
});
