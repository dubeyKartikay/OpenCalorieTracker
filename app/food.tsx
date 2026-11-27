import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAction, useAppRuntime, useAsyncResource, usePreferences } from '../src/app/AppRuntimeContext';
import { availableUnits, localDate, MEALS, mealsForDay, parseRouteDate } from '../src/app/controller';
import { calculateNutrition, diaryEntrySnapshotSchema, foodRecordSchema, generateId, resolveQuantityToBasis } from '../src/domain';
import type { DiaryEntrySnapshot, FoodRecord, FoodUnit, NutrientProfile, Quantity, RecipeIngredient } from '../src/domain';
import { foodKey } from '../src/storage';
import { UndoToast } from '../src/ui/components/Diary';
import { DoopIcon, inferFoodGlyph } from '../src/ui/components/DoopIcons';
import { GLOBAL_UNITS, InlineCustomUnitForm, kindOf, labelOf, PIN_KEY, usualQuantity, withUnits } from '../src/ui/components/FoodSearch';
import { buildPortionCandidates, mergeSelectedPortion, supportedBaseUnits } from '../src/ui/components/customUnitMath';
import { CUSTOM_FOOD_BASIS_OPTIONS, SegmentedSwitch, useScrollAboveKeyboard, useScrollNodeIntoView, type CustomFoodBasis } from '../src/ui/components/capture';
import { LearnedPortionChips, MacroProportionBar, MealDestinationPills, NumericEditor, RevealPanel } from '../src/ui/components/doop';
import {
  applyInlineFoodDraft,
  buildLivePreviewFood,
  createInlineFoodDraft,
  formatEditedFieldsSummary,
  getReadOnlyEditHint,
  INITIAL_INLINE_EDIT_STATE,
  NUTRIENT_ROWS,
  tapEditableTarget,
  updateInlineFoodDraft,
  type EditableFoodField,
  type EditableTarget,
  type InlineEditModeState,
  type InlineFoodDraft,
  type NutrientRowDescriptor,
} from '../src/ui/components/foodInlineEditMath';
import { BackHeader, energy, energyValue, ErrorMessage, goBackOrReplace, Muted, number, Page, SectionRule } from '../src/ui/components/primitives';
import { macroShare } from '../src/ui/format';
import { hapticLight, hapticSelection, hapticSuccess, hapticWarning } from '../src/ui/haptics';
import { colors, fontFace, fontSize, radius, SCREEN_GUTTER, spacing, tabularNums } from '../src/ui/tokens';

function paramString(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function basisLabel(food: FoodRecord): string {
  if (food.basis === 'per_100g') return 'per 100 g';
  if (food.basis === 'per_100ml') return 'per 100 ml';
  const unitText = kindOf(food) === 'recipe' ? 'whole recipe' : 'serving';
  if (food.serving_g != null) return `per ${unitText} (${number(food.serving_g, 0)} g)`;
  if (food.serving_ml != null) return `per ${unitText} (${number(food.serving_ml, 0)} ml)`;
  return `per ${unitText}`;
}

function prepLabel(prep: FoodRecord['prep_state']): string | null {
  if (prep === 'unknown') return null;
  return prep[0]!.toUpperCase() + prep.slice(1);
}

function formatShareText(
  food: FoodRecord,
  portion: Quantity,
  nutrients: NutrientProfile | undefined,
  energyUnit: 'kcal' | 'kJ',
): string {
  const lines = [`${food.name}${food.brand ? ` (${food.brand})` : ''}`, `Portion: ${labelOf(portion, food)}`];
  if (!nutrients) return lines.join('\n');
  lines.push(`Energy: ${energy(nutrients.kcal, energyUnit)}`);
  lines.push(`Protein: ${number(nutrients.protein_g, 1)} g · Carbs: ${number(nutrients.carbs_g, 1)} g · Fat: ${number(nutrients.fat_g, 1)} g`);
  const extras: [string, number | null, string][] = [
    ['Fiber', nutrients.fiber_g, 'g'],
    ['Sugar', nutrients.sugar_g, 'g'],
    ['Saturated fat', nutrients.sat_fat_g, 'g'],
    ['Sodium', nutrients.sodium_mg, 'mg'],
    ['Potassium', nutrients.potassium_mg, 'mg'],
    ['Calcium', nutrients.calcium_mg, 'mg'],
    ['Iron', nutrients.iron_mg, 'mg'],
  ];
  for (const [label, value, unit] of extras) {
    if (value != null) lines.push(`${label}: ${number(value, 1)} ${unit}`);
  }
  return lines.join('\n');
}

function InlineCommitTick({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Save changes"
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.inlineTickBtn, pressed && styles.pressed]}
    >
      <DoopIcon name="check" size={14} color={colors.accent} strokeWidth={2.4} />
    </Pressable>
  );
}

function NutrientRow({
  row,
  value,
  unit,
  editable,
  armed,
  active,
  editMode,
  dirty,
  draftValue,
  busy,
  onTap,
  onChangeDraft,
  onCommit,
  onEnsureVisible,
}: {
  row: NutrientRowDescriptor;
  value: number | null | undefined;
  unit: string;
  editable: boolean;
  armed: boolean;
  active: boolean;
  editMode: boolean;
  dirty: boolean;
  draftValue?: string | undefined;
  busy: boolean;
  onTap?: (() => void) | undefined;
  onChangeDraft?: ((next: string) => void) | undefined;
  onCommit?: (() => void) | undefined;
  onEnsureVisible?: ((node: ComponentRef<typeof View> | null) => void) | undefined;
}) {
  const rowRef = useRef<ComponentRef<typeof View> | null>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  const known = value != null && Number.isFinite(value);
  const formatted = known ? `${number(value, row.digits)} ${unit}` : '—';

  if (editMode) {
    return (
      <Pressable
        disabled={busy}
        onPress={() => inputRef.current?.focus()}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${row.label} (${unit})`}
      >
        <View ref={rowRef} collapsable={false} style={[styles.nutRow, row.sub && styles.nutRowSub, active && styles.nutRowActive]}>
          <Text style={[styles.nutLabel, row.bold && styles.nutLabelBold, row.sub && styles.nutLabelSub]}>{row.label}</Text>
          <View style={styles.nutEditWrap}>
            {!active ? (
              <DoopIcon
                name="edit"
                size={11}
                color={dirty ? colors.accent : colors.muted}
                strokeWidth={1.5}
              />
            ) : null}
            <TextInput
              ref={inputRef}
              accessibilityLabel={`${row.label} (${unit})`}
              autoFocus={active}
              selectTextOnFocus
              value={draftValue ?? ''}
              onChangeText={onChangeDraft}
              onFocus={() => {
                onTap?.();
                onEnsureVisible?.(rowRef.current);
              }}
              onSubmitEditing={onCommit}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              keyboardType="decimal-pad"
              placeholder={row.required ? '0' : '—'}
              placeholderTextColor={colors.muted}
              editable={!busy}
              style={[
                styles.nutInlineInput,
                !active && styles.nutInlineInputIdle,
                row.bold && styles.nutValueBold,
                dirty && styles.nutValueDirty,
              ]}
            />
            <Text style={styles.nutInlineUnit}>{unit}</Text>
            {active && onCommit ? <InlineCommitTick onPress={onCommit} disabled={busy} /> : null}
          </View>
        </View>
      </Pressable>
    );
  }

  const content = (
    <View style={[styles.nutRow, row.sub && styles.nutRowSub, armed && styles.nutRowArmed]}>
      <Text style={[styles.nutLabel, row.bold && styles.nutLabelBold, row.sub && styles.nutLabelSub]}>{row.label}</Text>
      <View style={styles.nutValueWrap}>
        {armed ? (
          <DoopIcon
            name="edit"
            size={13}
            color={colors.accent}
            strokeWidth={1.8}
          />
        ) : null}
        <Text
          style={[
            styles.nutValue,
            !known && styles.nutUnknown,
            row.bold && styles.nutValueBold,
          ]}
        >
          {formatted}
        </Text>
      </View>
    </View>
  );

  if (!onTap) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        editable
          ? armed
            ? `Edit ${row.label}, currently ${formatted}. Tap again to edit.`
            : `${row.label} ${formatted}`
          : `${row.label} ${formatted}, read-only`
      }
      disabled={busy}
      onPress={onTap}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

interface ResolvedFoodData {
  food: FoodRecord;
  personalUnits: FoodUnit[];
  portions: { amount: number; unit: string; kcal: number | undefined }[];
  entries: DiaryEntrySnapshot[];
  pinned: boolean;
  parts: RecipeIngredient[] | undefined;
  sourceName: string;
}

function FoodDetail({
  data,
  initialQuantity,
  targetMeal,
  targetDate,
}: {
  data: ResolvedFoodData;
  initialQuantity: Quantity;
  targetMeal: string;
  targetDate: string;
}) {
  const { controller } = useAppRuntime();
  const insets = useSafeAreaInsets();
  const preferences = usePreferences();
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const meals = mealsForDay(preferences.value?.mealSections ?? [...MEALS], data.entries, [targetMeal]);
  const [foodOverride, setFoodOverride] = useState<{ base: FoodRecord; food: FoodRecord } | null>(null);
  const food = foodOverride?.base === data.food ? foodOverride.food : data.food;
  const kind = kindOf(food);
  const isCustomFood = !food.source_pack_id && kind === 'food';
  const isDatabaseFood = Boolean(food.source_pack_id);
  const canEditName = !isDatabaseFood;
  const canEditNutrition = isCustomFood;
  const [selected, setSelected] = useState<Quantity>(initialQuantity);
  const [typedState, setTypedState] = useState<{ unit: string; value: string } | null>(null);
  const [addingInlineUnit, setAddingInlineUnit] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);
  const canAddCustomUnit = useMemo(() => supportedBaseUnits(food).length > 0, [food]);
  const [editState, setEditState] = useState<InlineEditModeState>(INITIAL_INLINE_EDIT_STATE);
  const [editDraft, setEditDraft] = useState<InlineFoodDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [readOnlyHintTick, setReadOnlyHintTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnlyHint = useMemo(() => getReadOnlyEditHint(kind, isDatabaseFood), [isDatabaseFood, kind]);
  useEffect(() => {
    if (readOnlyHintTick === 0) return;
    const timer = setTimeout(() => setReadOnlyHintTick(0), 4500);
    return () => clearTimeout(timer);
  }, [readOnlyHintTick]);
  const action = useAction();
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);
  const ensureVisible = useScrollAboveKeyboard(scrollRef, scrollOffsetRef);
  const personalUnitsRef = useRef<ComponentRef<typeof View> | null>(null);
  const brandRowRef = useRef<ComponentRef<typeof View> | null>(null);
  const nameInputRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  const heroKcalInputRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  const brandInputRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  const getPersonalUnitsNode = useCallback(() => personalUnitsRef.current, []);
  useScrollNodeIntoView(scrollRef, scrollOffsetRef, getPersonalUnitsNode, addingUnit ? 'personal-units' : null);

  const isEditMode = canEditName && editState.mode === 'edit' && editDraft !== null;
  const isNutritionEditMode = canEditNutrition && isEditMode;
  const armedTarget = canEditName && editState.mode === 'normal' ? editState.armedTarget : null;
  const activeTarget = isEditMode ? editState.activeTarget : null;

  const validUnits = useMemo(() => availableUnits(food), [food]);
  const activeSelected = useMemo(
    () => (validUnits.includes(selected.unit) ? selected : usualQuantity(food)),
    [food, selected, validUnits],
  );
  const typed = typedState && validUnits.includes(typedState.unit) ? typedState.value : null;
  const hasTyped = typed != null && typed.trim() !== '';
  const current = useMemo(
    () => (hasTyped ? { amount: Number(typed), unit: activeSelected.unit } : activeSelected),
    [activeSelected, hasTyped, typed],
  );
  const valid = Number.isFinite(current.amount) && current.amount > 0;
  const basisFactor = useMemo(() => {
    if (!valid) return 1;
    try {
      const resolved = resolveQuantityToBasis(food, current);
      return resolved.factor > 0 ? resolved.factor : 1;
    } catch {
      return 1;
    }
  }, [current, food, valid]);
  const preview = useAsyncResource(
    useCallback(async () => (valid ? controller.preview(food, current) : null), [controller, food, current, valid]),
    `${foodKey(food)}:${current.amount}:${current.unit}`,
  );
  const baseNutrients = useMemo(() => {
    if (preview.value?.nutrients) return preview.value.nutrients;
    if (!valid) return undefined;
    try {
      return calculateNutrition(food, current);
    } catch {
      return undefined;
    }
  }, [current, food, preview.value, valid]);

  const displayedFood = useMemo(
    () => (isEditMode && editDraft ? buildLivePreviewFood(food, editDraft, basisFactor, energyUnit) : food),
    [basisFactor, editDraft, energyUnit, food, isEditMode],
  );
  const nutrients = useMemo(() => {
    if (!isEditMode) return baseNutrients;
    if (!valid) return displayedFood.nutrients;
    try {
      return calculateNutrition(displayedFood, current);
    } catch {
      return displayedFood.nutrients;
    }
  }, [baseNutrients, current, displayedFood, isEditMode, valid]);

  const resolvedMetric = useMemo(() => {
    if (!valid) return null;
    try {
      const resolved = resolveQuantityToBasis(food, current);
      if (resolved.unit === current.unit && Math.abs(resolved.amount - current.amount) < 0.01) return null;
      if (resolved.unit === 'serving') return labelOf(resolved, food);
      return `${number(resolved.amount, 0)} ${resolved.unit}`;
    } catch {
      return null;
    }
  }, [current, food, valid]);

  const shares = macroShare(nutrients?.protein_g ?? 0, nutrients?.carbs_g ?? 0, nutrients?.fat_g ?? 0);
  const loggedMeals = data.entries.map(entry => entry.meal);

  const disarm = () => {
    if (editState.mode === 'normal' && editState.armedTarget !== null) {
      setEditState(INITIAL_INLINE_EDIT_STATE);
    }
  };
  const exitEditMode = () => {
    Keyboard.dismiss();
    setEditState(INITIAL_INLINE_EDIT_STATE);
    setEditDraft(null);
    setEditError(null);
  };
  const openRecipeEditor = () => {
    setReadOnlyHintTick(0);
    router.push({ pathname: '/recipes/[id]', params: { id: food.id.slice(7), meal: targetMeal, date: targetDate } });
  };
  const saveAsCustomCopy = () => void action.run(async () => {
    setReadOnlyHintTick(0);
    const copy = await controller.saveCustomFood({
      ...food,
      id: generateId(),
      provenance_kind: 'user',
      source_pack_id: null,
      source_id: null,
      source_version: null,
    });
    hapticSuccess();
    router.replace({
      pathname: '/food',
      params: { id: copy.id, meal: targetMeal, date: targetDate, amount: String(current.amount), unit: current.unit },
    });
  });
  const onTapReadOnly = () => {
    if (!readOnlyHint || action.busy) return;
    hapticSelection();
    setReadOnlyHintTick(tick => tick + 1);
  };
  const onTapEditable = (target: EditableTarget) => {
    const targetEditable = target === 'name' ? canEditName : canEditNutrition;
    if (!targetEditable) {
      onTapReadOnly();
      return;
    }
    if (action.busy) return;
    const { next, transition } = tapEditableTarget(editState, target);
    if (transition === 'noop') return;
    setEditError(null);
    if (transition === 'armed') {
      hapticSelection();
      setEditState(next);
      return;
    }
    if (transition === 'enter-edit') {
      hapticLight();
      setReadOnlyHintTick(0);
      setAddingInlineUnit(false);
      setAddingUnit(false);
      setTypedState(null);
      setConfirmDelete(false);
      setEditDraft(createInlineFoodDraft(food, baseNutrients, energyUnit));
      setEditState(next);
      return;
    }
    hapticSelection();
    setEditState(next);
  };
  const onDraftChange = (field: EditableFoodField, value: string) => {
    setEditError(null);
    setEditDraft(old => (old ? updateInlineFoodDraft(old, field, value) : old));
  };
  const commitEdit = () => {
    if (!isEditMode || !editDraft || action.busy) return;
    try {
      setEditError(null);
      if (!canEditNutrition) {
        const trimmed = editDraft.name.trim();
        if (!trimmed) throw new Error(`Enter a ${kind === 'recipe' ? 'recipe' : 'meal'} name before saving.`);
        if (trimmed === food.name) {
          hapticSelection();
          exitEditMode();
          return;
        }
        Keyboard.dismiss();
        void action.run(async () => {
          if (kind === 'recipe') await controller.renameRecipe(food.id.slice(7), trimmed);
          else await controller.renameSavedMeal(food.id.slice(5), trimmed);
          hapticSuccess();
          setFoodOverride({ base: data.food, food: { ...food, name: trimmed } });
          setEditState(INITIAL_INLINE_EDIT_STATE);
          setEditDraft(null);
          setEditError(null);
        });
        return;
      }
      const result = applyInlineFoodDraft(food, editDraft, basisFactor, energyUnit);
      if (!result.changed) {
        hapticSelection();
        exitEditMode();
        return;
      }
      Keyboard.dismiss();
      const undoLabel = formatEditedFieldsSummary(result.changedFields);
      void action.run(async () => {
        const saved = await controller.saveCustomFood(result.updated, { undoLabel });
        hapticSuccess();
        setFoodOverride({ base: data.food, food: saved });
        setEditState(INITIAL_INLINE_EDIT_STATE);
        setEditDraft(null);
        setEditError(null);
      });
    } catch (reason) {
      hapticWarning();
      setEditError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const selectPortion = (next: Quantity) => {
    disarm();
    setAddingInlineUnit(false);
    setTypedState(null);
    setSelected(next);
  };
  const selectUnit = (unit: string) => {
    disarm();
    setAddingInlineUnit(false);
    if (typed != null) setTypedState({ unit, value: typed });
    const nextAmount = hasTyped ? (Number(typed) || 1) : (unit === 'g' || unit === 'ml' ? 100 : 1);
    setSelected({ amount: nextAmount, unit });
  };
  const displayedPortions = useMemo(() => {
    const validSet = new Set(validUnits);
    const filtered = data.portions.filter(portion => validSet.has(portion.unit));
    return mergeSelectedPortion(filtered, food, activeSelected);
  }, [activeSelected, data.portions, food, validUnits]);
  const toggleMeal = (destination: string) => void action.run(async () => {
    disarm();
    const logged = data.entries.filter(entry => entry.meal === destination);
    if (logged.length) {
      await controller.deleteEntries(logged.map(entry => entry.id));
      return;
    }
    if (!valid) throw new Error('Enter an amount greater than zero.');
    await controller.confirm({ food, quantity: current, meal: destination, date: targetDate, idempotencyKey: generateId() });
    setTypedState(null);
  });

  const reducedMotion = useReducedMotion();
  const enterProgress = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      enterProgress.set(1);
      return;
    }
    enterProgress.set(withSpring(1, { damping: 24, stiffness: 300, mass: 0.78 }));
  }, [enterProgress, reducedMotion]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: interpolate(enterProgress.value, [0, 0.7, 1], [0.25, 0.96, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(enterProgress.value, [0, 1], [16, 0], Extrapolation.CLAMP) },
      { scale: interpolate(enterProgress.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
  }));

  const subtitleParts = [
    data.sourceName,
    displayedFood.brand,
    displayedFood.category,
    prepLabel(displayedFood.prep_state),
  ].filter((part, index, list): part is string => Boolean(part) && list.findIndex(item => item?.toLowerCase() === part?.toLowerCase()) === index);

  const nameDirty = Boolean(editDraft?.dirtyFields.has('name'));
  const brandDirty = Boolean(editDraft?.dirtyFields.has('brand'));
  const basisDirty = Boolean(editDraft?.dirtyFields.has('basis'));
  const kcalDirty = Boolean(editDraft?.dirtyFields.has('kcal'));

  const showReadOnlyHint = Boolean(readOnlyHint && readOnlyHintTick > 0 && !controller.undoAction);

  return (
    <Page
      scrollRef={scrollRef}
      onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
      overlay={
        <View pointerEvents="box-none" style={[styles.toast, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
          <UndoToast />
          <RevealPanel visible={showReadOnlyHint} direction="up">
            {showReadOnlyHint && readOnlyHint ? (
              <View accessibilityLiveRegion="polite" style={styles.readOnlyPill}>
                <DoopIcon name="lock" size={14} color={colors.muted} />
                <Text numberOfLines={1} style={styles.readOnlyText}>{readOnlyHint.message}</Text>
                {readOnlyHint.actionLabel ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={readOnlyHint.actionLabel}
                    disabled={action.busy}
                    onPress={() => {
                      hapticLight();
                      if (readOnlyHint.actionKind === 'copy-custom') saveAsCustomCopy();
                      else if (readOnlyHint.actionKind === 'edit-recipe') openRecipeEditor();
                    }}
                    style={({ pressed }) => [styles.readOnlyAction, pressed && styles.pressed]}
                  >
                    <Text style={styles.readOnlyActionText}>{readOnlyHint.actionLabel}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss hint"
                  onPress={() => setReadOnlyHintTick(0)}
                  style={styles.readOnlyClose}
                >
                  <DoopIcon name="close" size={14} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
          </RevealPanel>
        </View>
      }
    >
      <Animated.View style={[styles.pageMotion, enterStyle]}>
      <BackHeader
        title={displayedFood.name}
        backIcon={isEditMode ? 'close' : 'back'}
        backLabel={isEditMode ? 'Discard edits' : 'Back'}
        onBack={() => {
          if (isEditMode) {
            hapticSelection();
            exitEditMode();
            return;
          }
          goBackOrReplace('/(tabs)/library');
        }}
        titleContent={
          canEditName ? (
            isEditMode && editDraft ? (
              <Pressable
                disabled={action.busy}
                onPress={() => nameInputRef.current?.focus()}
                style={styles.headerNameEditWrap}
              >
                <TextInput
                  ref={nameInputRef}
                  accessibilityLabel={kind === 'recipe' ? 'Recipe name' : kind === 'meal' ? 'Meal name' : 'Food name'}
                  autoFocus={activeTarget === 'name'}
                  selectTextOnFocus
                  value={editDraft.name}
                  onChangeText={value => onDraftChange('name', value)}
                  onFocus={() => onTapEditable('name')}
                  onSubmitEditing={commitEdit}
                  returnKeyType="done"
                  submitBehavior="blurAndSubmit"
                  placeholder={kind === 'recipe' ? 'Recipe name' : kind === 'meal' ? 'Meal name' : 'Food name'}
                  placeholderTextColor={colors.muted}
                  editable={!action.busy}
                  style={[
                    styles.headerNameInput,
                    activeTarget !== 'name' && styles.headerNameInputIdle,
                    nameDirty && styles.nutValueDirty,
                  ]}
                />
                {activeTarget !== 'name' ? (
                  <DoopIcon
                    name="edit"
                    size={12}
                    color={nameDirty ? colors.accent : colors.muted}
                    strokeWidth={1.5}
                  />
                ) : null}
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  armedTarget === 'name'
                    ? `Edit ${displayedFood.name}. Tap again to edit.`
                    : displayedFood.name
                }
                disabled={action.busy}
                onPress={() => onTapEditable('name')}
                style={({ pressed }) => [
                  styles.headerTitleTap,
                  armedTarget === 'name' && styles.headerTitleArmed,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  accessibilityRole="header"
                  numberOfLines={1}
                  style={styles.headerTitleText}
                >
                  {displayedFood.name}
                </Text>
                {armedTarget === 'name' ? (
                  <DoopIcon
                    name="edit"
                    size={14}
                    color={colors.accent}
                    strokeWidth={1.85}
                  />
                ) : null}
              </Pressable>
            )
          ) : (
            <Pressable
              accessibilityRole="header"
              accessibilityLabel={displayedFood.name}
              disabled={action.busy}
              onPress={onTapReadOnly}
              style={({ pressed }) => [styles.headerTitleTap, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={styles.headerTitleText}>{displayedFood.name}</Text>
            </Pressable>
          )
        }
        right={
          isEditMode ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save changes"
              disabled={action.busy}
              onPress={commitEdit}
              style={({ pressed }) => [styles.iconHit, pressed && styles.pressed]}
            >
              <View style={styles.headerTickPill}>
                <DoopIcon name="check" size={17} color={colors.accent} strokeWidth={2.4} />
              </View>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={data.pinned ? 'Unpin food' : 'Pin food'}
              accessibilityState={{ selected: data.pinned }}
              disabled={action.busy}
              onPress={() => {
                disarm();
                hapticLight();
                void action.run(() => controller.toggleFoodPin(food, !data.pinned));
              }}
              style={styles.iconHit}
            >
              <DoopIcon name="pin" size={18} color={data.pinned ? colors.accent : colors.muted} />
            </Pressable>
          )
        }
      />

      <ErrorMessage message={editError} />

      <View style={styles.subtitleRow}>
        <DoopIcon name={inferFoodGlyph(displayedFood.name, kind)} size={18} color={colors.muted} />
        <Text numberOfLines={2} style={styles.subtitleText}>{subtitleParts.join(' · ')}</Text>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          {isCustomFood && isEditMode && editDraft ? (
            <Pressable
              disabled={action.busy}
              onPress={() => heroKcalInputRef.current?.focus()}
              style={styles.heroEnergyEditRow}
            >
              <TextInput
                ref={heroKcalInputRef}
                accessibilityLabel={`Energy (${energyUnit})`}
                autoFocus={activeTarget === 'hero_kcal'}
                selectTextOnFocus
                value={editDraft.nutrients.kcal}
                onChangeText={value => onDraftChange('kcal', value)}
                onFocus={() => onTapEditable('hero_kcal')}
                onSubmitEditing={commitEdit}
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.muted}
                editable={!action.busy}
                style={[
                  styles.heroEnergyInput,
                  activeTarget !== 'hero_kcal' && styles.heroEnergyInputIdle,
                  kcalDirty && styles.nutValueDirty,
                ]}
              />
              <Text style={styles.heroEnergyUnit}>{energyUnit}</Text>
              {activeTarget === 'hero_kcal' ? (
                <InlineCommitTick onPress={commitEdit} disabled={action.busy} />
              ) : (
                <DoopIcon
                  name="edit"
                  size={13}
                  color={kcalDirty ? colors.accent : colors.muted}
                  strokeWidth={1.5}
                />
              )}
            </Pressable>
          ) : isCustomFood ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                armedTarget === 'hero_kcal'
                  ? `Edit energy ${number(energyValue(nutrients?.kcal, energyUnit))} ${energyUnit}. Tap again to edit.`
                  : `Energy ${number(energyValue(nutrients?.kcal, energyUnit))} ${energyUnit}`
              }
              disabled={action.busy}
              onPress={() => onTapEditable('hero_kcal')}
              style={({ pressed }) => [
                styles.heroEnergyRow,
                styles.heroEnergyTap,
                armedTarget === 'hero_kcal' && styles.heroEnergyArmed,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.heroEnergyValue}>
                {number(energyValue(nutrients?.kcal, energyUnit))}
              </Text>
              <Text style={styles.heroEnergyUnit}>{energyUnit}</Text>
              {armedTarget === 'hero_kcal' ? (
                <DoopIcon
                  name="edit"
                  size={15}
                  color={colors.accent}
                  strokeWidth={1.85}
                />
              ) : null}
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Energy ${number(energyValue(nutrients?.kcal, energyUnit))} ${energyUnit}, read-only`}
              disabled={action.busy}
              onPress={onTapReadOnly}
              style={({ pressed }) => [styles.heroEnergyRow, styles.heroEnergyTap, pressed && styles.pressed]}
            >
              <Text style={styles.heroEnergyValue}>{number(energyValue(nutrients?.kcal, energyUnit))}</Text>
              <Text style={styles.heroEnergyUnit}>{energyUnit}</Text>
            </Pressable>
          )}
          <View style={styles.heroPortion}>
            <Text style={styles.heroPortionMain}>{labelOf(valid ? current : activeSelected, displayedFood)}</Text>
            {resolvedMetric ? <Text style={styles.heroPortionSub}>{resolvedMetric}</Text> : null}
          </View>
        </View>

        <MacroProportionBar
          proteinG={nutrients?.protein_g ?? 0}
          carbsG={nutrients?.carbs_g ?? 0}
          fatG={nutrients?.fat_g ?? 0}
          height={6}
          gap={2}
          style={styles.heroBar}
        />

        <View style={styles.heroRule} />

        <View style={styles.macroCols}>
          {([
            ['Protein', nutrients?.protein_g, shares.protein, colors.lavender],
            ['Carbs', nutrients?.carbs_g, shares.carbs, colors.mint],
            ['Fat', nutrients?.fat_g, shares.fat, colors.peach],
          ] as const).map(([label, grams, pct, dotColor]) => (
            <View key={label} style={styles.macroCol}>
              <View style={styles.macroColHead}>
                <View style={[styles.macroDot, { backgroundColor: dotColor }]} />
                <Text style={styles.macroColLabel}>{label}</Text>
              </View>
              <Text style={styles.macroColVal}>
                {number(grams, 1)} g
                {pct > 0 ? <Text style={styles.macroColPct}> · {pct}%</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.sectionBlock, isEditMode && styles.sectionDimmed]} pointerEvents={isEditMode ? 'none' : 'auto'}>
        <SectionRule label="Portion" meta={resolvedMetric ?? basisLabel(displayedFood)} />
        <LearnedPortionChips
          variant="calm"
          portions={displayedPortions.map(portion => ({
            label: labelOf(portion, food),
            energyLabel: energy(portion.kcal, energyUnit),
            selected: !hasTyped && current.amount === portion.amount && current.unit === portion.unit,
          }))}
          onSelect={index => {
            const portion = displayedPortions[index];
            if (portion) selectPortion({ amount: portion.amount, unit: portion.unit });
          }}
          moreExpanded={typed != null}
          onMore={() => {
            disarm();
            setAddingInlineUnit(false);
            setTypedState(old => (old && validUnits.includes(old.unit) ? null : { unit: activeSelected.unit, value: '' }));
          }}
        />
        {typed != null && (
          <NumericEditor
            value={typed}
            placeholder={number(activeSelected.amount, 2)}
            onChange={value => setTypedState({ unit: activeSelected.unit, value })}
            units={validUnits}
            selectedUnit={activeSelected.unit}
            onSelectUnit={selectUnit}
            onAddUnit={canAddCustomUnit ? () => setAddingInlineUnit(open => !open) : undefined}
            addUnitActive={addingInlineUnit}
            unitEditor={
              <InlineCustomUnitForm
                food={food}
                onEnsureVisible={ensureVisible}
                onCancel={() => setAddingInlineUnit(false)}
                onSaved={(updated, unit) => {
                  setFoodOverride({ base: data.food, food: updated });
                  setAddingInlineUnit(false);
                  setTypedState(null);
                  setSelected({ amount: 1, unit });
                }}
              />
            }
            maxDecimals={2}
            allowEmpty
            confirmDisabled={!hasTyped || !valid || action.busy}
            confirmLabel="Apply custom portion"
            cancelLabel="Close custom portion"
            onConfirm={() => {
              if (!valid) return;
              selectPortion(current);
            }}
            onCancel={() => {
              setAddingInlineUnit(false);
              setTypedState(null);
            }}
            style={{ marginTop: 6 }}
          />
        )}
      </View>

      <View style={[styles.sectionBlock, isEditMode && styles.sectionDimmed]} pointerEvents={isEditMode ? 'none' : 'auto'}>
        <SectionRule label="Log to meal" meta={loggedMeals.length ? `Logged · ${loggedMeals.join(', ')}` : targetDate} />
        <MealDestinationPills
          variant="calm"
          meals={meals}
          selectedMeals={loggedMeals}
          suggestedMeal={targetMeal}
          mode="toggle"
          disabled={!valid || action.busy || preview.loading || addingInlineUnit || isEditMode}
          onPress={toggleMeal}
        />
      </View>

      <View style={styles.sectionBlock}>
        <SectionRule label="Nutrition" meta={labelOf(valid ? current : activeSelected, displayedFood)} />
        <View style={[styles.nutCard, isNutritionEditMode && styles.nutCardEdit]}>
          {NUTRIENT_ROWS.map(row => {
            const rawValue = row.key === 'kcal' ? energyValue(nutrients?.kcal, energyUnit) : nutrients?.[row.key];
            return (
              <View key={row.key}>
                <NutrientRow
                  row={row}
                  value={rawValue}
                  unit={row.unit(energyUnit)}
                  editable={canEditNutrition}
                  armed={armedTarget === row.key}
                  active={activeTarget === row.key}
                  editMode={isNutritionEditMode}
                  dirty={Boolean(editDraft?.dirtyFields.has(row.key))}
                  draftValue={editDraft?.nutrients[row.key]}
                  busy={action.busy}
                  onTap={() => onTapEditable(row.key)}
                  onChangeDraft={value => onDraftChange(row.key, value)}
                  onCommit={commitEdit}
                  onEnsureVisible={ensureVisible}
                />
                {row.ruleAfter ? <View style={styles.nutRule} /> : null}
              </View>
            );
          })}
        </View>
        <View style={styles.metaGrid}>
          {isCustomFood ? (
            activeTarget === 'basis' && editDraft ? (
              <View style={styles.metaEditBlock}>
                <View style={styles.metaEditHeader}>
                  <Text style={styles.metaLine}>Reference basis</Text>
                  <InlineCommitTick onPress={commitEdit} disabled={action.busy} />
                </View>
                <SegmentedSwitch
                  options={CUSTOM_FOOD_BASIS_OPTIONS}
                  value={editDraft.basis}
                  disabled={action.busy}
                  onChange={value => {
                    hapticSelection();
                    onDraftChange('basis', value as CustomFoodBasis);
                  }}
                />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  armedTarget === 'basis'
                    ? `Edit reference basis ${basisLabel(displayedFood)}. Tap again to edit.`
                    : `Reference basis: ${basisLabel(displayedFood)}`
                }
                disabled={action.busy}
                onPress={() => onTapEditable('basis')}
                style={({ pressed }) => [styles.metaTapRow, armedTarget === 'basis' && styles.metaRowArmed, pressed && styles.pressed]}
              >
                <Text style={styles.metaLine}>
                  Reference basis:{' '}
                  <Text style={[basisDirty && styles.nutValueDirty, isEditMode && styles.editableValueDotted]}>
                    {basisLabel(displayedFood)}
                  </Text>
                </Text>
                {(armedTarget === 'basis' || isEditMode) ? (
                  <DoopIcon
                    name="edit"
                    size={armedTarget === 'basis' ? 12 : 11}
                    color={armedTarget === 'basis' || basisDirty ? colors.accent : colors.muted}
                  />
                ) : null}
              </Pressable>
            )
          ) : (
            <Text style={styles.metaLine}>Reference basis: {basisLabel(displayedFood)}</Text>
          )}

          {isCustomFood && (displayedFood.brand || isEditMode || armedTarget === 'brand') ? (
            isEditMode && editDraft ? (
              <Pressable
                disabled={action.busy}
                onPress={() => brandInputRef.current?.focus()}
              >
                <View ref={brandRowRef} collapsable={false} style={styles.metaInlineEditRow}>
                  <Text style={styles.metaLine}>Brand:</Text>
                  <TextInput
                    ref={brandInputRef}
                    accessibilityLabel="Brand"
                    autoFocus={activeTarget === 'brand'}
                    selectTextOnFocus
                    value={editDraft.brand}
                    onChangeText={value => onDraftChange('brand', value)}
                    onFocus={() => {
                      onTapEditable('brand');
                      ensureVisible(brandRowRef.current);
                    }}
                    onSubmitEditing={commitEdit}
                    returnKeyType="done"
                    submitBehavior="blurAndSubmit"
                    placeholder="Add brand"
                    placeholderTextColor={colors.muted}
                    editable={!action.busy}
                    style={[
                      styles.metaInlineInput,
                      activeTarget !== 'brand' && styles.metaInlineInputIdle,
                      brandDirty && styles.nutValueDirty,
                    ]}
                  />
                  {activeTarget === 'brand' ? (
                    <InlineCommitTick onPress={commitEdit} disabled={action.busy} />
                  ) : (
                    <DoopIcon
                      name="edit"
                      size={11}
                      color={brandDirty ? colors.accent : colors.muted}
                    />
                  )}
                </View>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  armedTarget === 'brand'
                    ? `Edit brand ${displayedFood.brand ?? 'none'}. Tap again to edit.`
                    : `Brand: ${displayedFood.brand ?? 'Add brand'}`
                }
                disabled={action.busy}
                onPress={() => onTapEditable('brand')}
                style={({ pressed }) => [styles.metaTapRow, armedTarget === 'brand' && styles.metaRowArmed, pressed && styles.pressed]}
              >
                <Text style={styles.metaLine}>
                  Brand: {displayedFood.brand || 'Add brand'}
                </Text>
                {armedTarget === 'brand' ? (
                  <DoopIcon
                    name="edit"
                    size={12}
                    color={colors.accent}
                  />
                ) : null}
              </Pressable>
            )
          ) : displayedFood.brand ? (
            <Text style={styles.metaLine}>Brand: {displayedFood.brand}</Text>
          ) : null}

          {displayedFood.category ? <Text style={styles.metaLine}>Category: {displayedFood.category}</Text> : null}
          {prepLabel(displayedFood.prep_state) ? <Text style={styles.metaLine}>Preparation: {prepLabel(displayedFood.prep_state)}</Text> : null}
          <Text style={styles.metaLine}>Source: {data.sourceName}</Text>
        </View>
      </View>

      {data.parts && data.parts.length > 0 && (
        <View style={styles.sectionBlock}>
          <SectionRule label="Ingredients" meta={`${data.parts.length} items`} />
          <View>
            {data.parts.map((part, index) => {
              let partKcal: number | undefined;
              try {
                partKcal = calculateNutrition(part.food, part.quantity).kcal;
              } catch {
                partKcal = undefined;
              }
              return (
                <View key={`${part.food.id}-${index}`} style={styles.partRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.partName}>{part.food.name}</Text>
                    <Text style={styles.partQty}>{labelOf(part.quantity, part.food)}</Text>
                  </View>
                  <Text style={styles.partKcal}>{energy(partKcal, energyUnit)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View ref={personalUnitsRef} collapsable={false} style={[styles.sectionBlock, addingUnit && styles.unitSectionOpen]}>
        <SectionRule label="Personal units" meta={data.personalUnits.length ? String(data.personalUnits.length) : undefined} />
        <View style={styles.unitChipsRow}>
          {data.personalUnits.map(unit => (
            <View key={unit.label} style={styles.savedUnitPill}>
              <Text style={styles.savedUnitText}>
                {unit.label} · {unit.grams != null ? `${number(unit.grams, 0)} g` : `${number(unit.ml, 0)} ml`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove unit ${unit.label}`}
                disabled={action.busy}
                onPress={() => void action.run(async () => {
                  hapticWarning();
                  setFoodOverride(null);
                  if (selected.unit === unit.label) setTypedState(null);
                  await controller.deletePersonalUnit(food, unit.label);
                })}
                hitSlop={8}
                style={styles.savedUnitRemove}
              >
                <DoopIcon name="close" size={12} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          {canAddCustomUnit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={addingUnit ? 'Close custom unit form' : 'Add custom unit'}
              accessibilityState={{ expanded: addingUnit }}
              disabled={action.busy}
              onPress={() => {
                if (addingUnit) Keyboard.dismiss();
                setAddingUnit(open => !open);
              }}
              style={[styles.addUnitButton, addingUnit && styles.addUnitButtonActive]}
            >
              <DoopIcon name={addingUnit ? 'close' : 'plus'} size={14} color={colors.accent} />
              <Text style={styles.addUnitText}>{addingUnit ? 'Close' : 'Add custom unit'}</Text>
            </Pressable>
          ) : null}
        </View>
        {addingUnit && canAddCustomUnit && (
          <RevealPanel visible direction="down" style={styles.unitForm}>
            <InlineCustomUnitForm
              food={food}
              showScope
              onEnsureVisible={ensureVisible}
              onCancel={() => setAddingUnit(false)}
              onSaved={(updated, unit) => {
                setFoodOverride({ base: data.food, food: updated });
                setTypedState(null);
                setSelected({ amount: 1, unit });
                setAddingUnit(false);
              }}
            />
          </RevealPanel>
        )}
      </View>

      <View style={styles.sectionBlock}>
        <SectionRule label="Actions" />
        <View>
          <Pressable
            accessibilityRole="button"
            disabled={action.busy}
            onPress={() => { hapticLight(); void action.run(() => controller.toggleFoodPin(food, !data.pinned)); }}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          >
            <DoopIcon name="pin" size={17} color={data.pinned ? colors.accent : colors.muted} />
            <Text style={styles.actionText}>{data.pinned ? 'Unpin from Library' : 'Pin to top of Library'}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={action.busy}
            onPress={() => void action.run(() => Share.share({ message: formatShareText(food, valid ? current : selected, nutrients, energyUnit) }))}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          >
            <DoopIcon name="external" size={17} color={colors.muted} />
            <Text style={styles.actionText}>Share nutrition summary</Text>
          </Pressable>

          {kind === 'recipe' && (
            <Pressable
              accessibilityRole="link"
              onPress={openRecipeEditor}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <DoopIcon name="recipe" size={17} color={colors.accent} />
              <Text style={[styles.actionText, { color: colors.accent }]}>Edit recipe & cook batch</Text>
              <DoopIcon name="chevronRight" size={16} color={colors.muted} />
            </Pressable>
          )}

          {isDatabaseFood && (
            <Pressable
              accessibilityRole="button"
              disabled={action.busy}
              onPress={saveAsCustomCopy}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <DoopIcon name="plus" size={17} color={colors.accent} />
              <Text style={[styles.actionText, { color: colors.accent }]}>Save as editable custom copy</Text>
            </Pressable>
          )}

          {(isCustomFood || kind === 'meal') && (
            <Pressable
              accessibilityRole="button"
              disabled={action.busy}
              onPress={() => {
                if (!confirmDelete) {
                  hapticWarning();
                  setConfirmDelete(true);
                  return;
                }
                hapticWarning();
                void action.run(async () => {
                  if (kind === 'meal') await controller.deleteSavedMeal(food.id.slice(5));
                  else await controller.deleteCustomFood(food.id);
                  goBackOrReplace('/(tabs)/library');
                });
              }}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <DoopIcon name="trash" size={17} color={colors.danger} />
              <Text style={[styles.actionText, { color: colors.danger }]}>
                {confirmDelete ? `Tap again to delete ${kind === 'meal' ? 'saved meal' : 'custom food'}` : `Delete ${kind === 'meal' ? 'saved meal' : 'custom food'}`}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <ErrorMessage message={action.error ?? preview.error} />
      </Animated.View>
    </Page>
  );
}

export default function FoodDetailScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    packId?: string | string[];
    meal?: string | string[];
    date?: string | string[];
    amount?: string | string[];
    unit?: string | string[];
  }>();
  const id = paramString(params.id);
  const packId = paramString(params.packId) || null;
  const preferences = usePreferences();
  const meals = preferences.value?.mealSections ?? [...MEALS];
  const targetMeal = paramString(params.meal) || meals[0] || 'Breakfast';
  const targetDate = parseRouteDate(params.date) ?? localDate();
  const paramAmount = Number(paramString(params.amount));
  const paramUnit = paramString(params.unit);

  const { controller } = useAppRuntime();
  const revision = controller.getRevision();

  const resource = useAsyncResource(
    useCallback(async (): Promise<ResolvedFoodData | null> => {
      void revision;
      if (!id) return null;
      let baseFood = await controller.deps.catalog.getById(packId, id);
      let fromFallback = false;
      if (!baseFood) {
        const pinnedFoodsRow = await controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryPinnedFoods');
        const pinnedFoods: FoodRecord[] = pinnedFoodsRow ? (JSON.parse(pinnedFoodsRow.value_json) as unknown[]).map(item => foodRecordSchema.parse(item)) : [];
        baseFood = pinnedFoods.find(item => item.id === id && (item.source_pack_id ?? null) === packId) ?? null;
        if (baseFood) fromFallback = true;
      }
      if (!baseFood) {
        const recent = await controller.deps.userDb.getAllAsync<{ snapshot_json: string }>(
          "SELECT snapshot_json FROM diary_entries WHERE draft_state='confirmed' ORDER BY occurred_at DESC LIMIT 200",
        );
        for (const row of recent) {
          const entry = diaryEntrySnapshotSchema.parse(JSON.parse(row.snapshot_json));
          if (entry.food.id === id && (entry.food.source_pack_id ?? null) === packId) {
            baseFood = entry.food;
            fromFallback = true;
            break;
          }
        }
      }
      if (!baseFood) return null;

      const key = foodKey(baseFood);
      const [globalUnits, personalUnits, learned, dayData, pinsRow, savedMeal, recipe, packs] = await Promise.all([
        controller.deps.library.listUserFoodUnits(GLOBAL_UNITS),
        controller.deps.library.listUserFoodUnits(key),
        controller.getLearnedPortions(baseFood),
        controller.day(targetDate),
        controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', PIN_KEY),
        kindOf(baseFood) === 'meal' ? controller.deps.library.getSavedMeal(baseFood.id.slice(5)) : Promise.resolve(null),
        kindOf(baseFood) === 'recipe' ? controller.getRecipe(baseFood.id.slice(7)) : Promise.resolve(null),
        baseFood.source_pack_id ? controller.listPacks() : Promise.resolve([]),
      ]);

      const withPersonal = fromFallback
        ? { ...baseFood, units: [...new Map([...baseFood.units, ...personalUnits].map(item => [item.label, item])).values()] }
        : baseFood;
      const food = withUnits(withPersonal, globalUnits);
      const pinIds: string[] = pinsRow ? JSON.parse(pinsRow.value_json) : [];
      const pinned = savedMeal?.pinned ?? pinIds.includes(key);
      const entries = dayData.day?.entries.filter(entry => foodKey(entry.food) === key) ?? [];
      const unique = buildPortionCandidates(food, usualQuantity(food), availableUnits(food), learned);
      const portions = await Promise.all(
        unique.map(async portion => {
          const result = await controller.preview(food, portion).catch(() => null);
          return {
            ...portion,
            kcal: result?.nutrients?.kcal,
          };
        }),
      );
      const kind = kindOf(food);
      const packMeta = food.source_pack_id ? packs.find(item => item.pack_id === food.source_pack_id) : undefined;
      const sourceName = kind === 'recipe'
        ? 'Recipe'
        : kind === 'meal'
          ? 'Saved meal'
          : packMeta?.meta.name ?? food.source_pack_id ?? 'Your food';

      return {
        food,
        personalUnits,
        portions,
        entries,
        pinned,
        parts: recipe?.ingredients ?? savedMeal?.items,
        sourceName,
      };
    }, [controller, id, packId, revision, targetDate]),
    `${packId ?? 'user'}:${id}:${targetDate}`,
  );

  if (resource.value) {
    const { food, portions, entries } = resource.value;
    const validParam = Number.isFinite(paramAmount) && paramAmount > 0 && paramUnit && availableUnits(food).includes(paramUnit);
    const logged = entries.find(entry => entry.meal === targetMeal) ?? entries[0];
    const initialQuantity: Quantity = validParam
      ? { amount: paramAmount, unit: paramUnit }
      : logged?.quantity ?? (portions[0] ? { amount: portions[0].amount, unit: portions[0].unit } : usualQuantity(food));
    return (
      <FoodDetail
        key={foodKey(food)}
        data={resource.value}
        initialQuantity={initialQuantity}
        targetMeal={targetMeal}
        targetDate={targetDate}
      />
    );
  }

  return (
    <Page>
      <BackHeader title="Food" onBack={() => goBackOrReplace('/(tabs)/library')} />
      <ErrorMessage message={resource.error} />
      <Muted>{resource.loading ? 'Loading food…' : resource.error ? 'Could not load this food.' : 'Food not found.'}</Muted>
    </Page>
  );
}

const styles = StyleSheet.create({
  pageMotion: { gap: spacing.s16 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s8, marginTop: -spacing.s8 },
  subtitleText: { flex: 1, ...fontFace('medium'), fontSize: 13, color: colors.muted, lineHeight: 18 },
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
  headerNameEditWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
  },
  headerNameInput: {
    ...fontFace('bold'),
    fontSize: fontSize.t20,
    color: colors.ink,
    letterSpacing: -0.3,
    textAlign: 'center',
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
  },
  headerNameInputIdle: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hero: { paddingTop: spacing.s4, paddingBottom: spacing.s4 },
  heroTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.s12 },
  heroEnergyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroEnergyTap: { paddingHorizontal: 6, paddingVertical: 2, marginLeft: -6, borderRadius: radius.r8, alignItems: 'center' },
  heroEnergyArmed: { backgroundColor: 'rgba(122,162,247,0.12)', borderWidth: 1, borderColor: 'rgba(122,162,247,0.38)' },
  heroEnergyEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  heroEnergyInput: {
    ...fontFace('bold'),
    ...tabularNums,
    fontSize: 34,
    lineHeight: 40,
    color: colors.ink,
    letterSpacing: -0.6,
    minWidth: 72,
    paddingHorizontal: 4,
    paddingVertical: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
  },
  heroEnergyInputIdle: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  heroEnergyValue: { ...fontFace('bold'), ...tabularNums, fontSize: 36, lineHeight: 40, color: colors.ink, letterSpacing: -0.6 },
  heroEnergyUnit: { ...fontFace('semibold'), fontSize: 15, color: colors.muted },
  heroPortion: { alignItems: 'flex-end', flexShrink: 1 },
  heroPortionMain: { ...fontFace('semibold'), ...tabularNums, fontSize: 15, color: colors.ink },
  heroPortionSub: { ...fontFace('medium'), ...tabularNums, fontSize: 12, color: colors.muted, marginTop: 2 },
  heroBar: { marginTop: spacing.s12 },
  heroRule: { height: 1, backgroundColor: colors.hairline, marginTop: spacing.s16, marginBottom: spacing.s12 },
  macroCols: { flexDirection: 'row', gap: spacing.s12 },
  macroCol: { flex: 1, gap: 4 },
  macroColHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  macroDot: { width: 7, height: 7, borderRadius: 3.5 },
  macroColLabel: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  macroColVal: { ...fontFace('semibold'), ...tabularNums, fontSize: 15, color: colors.ink },
  macroColPct: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  sectionBlock: { gap: spacing.s10 },
  sectionDimmed: { opacity: 0.45 },
  nutCard: { backgroundColor: colors.surface, borderRadius: radius.r16, paddingHorizontal: spacing.s16, paddingVertical: spacing.s8, borderWidth: 1, borderColor: colors.hairline },
  nutCardEdit: { borderColor: 'rgba(122,162,247,0.32)' },
  nutRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s12, borderRadius: radius.r8, paddingHorizontal: 6, marginHorizontal: -6 },
  nutRowSub: { minHeight: 34, paddingLeft: spacing.s16 + 6 },
  nutRowArmed: { backgroundColor: 'rgba(122,162,247,0.10)' },
  nutRowActive: { backgroundColor: 'rgba(122,162,247,0.12)', paddingVertical: 4 },
  nutLabel: { ...fontFace('medium'), fontSize: 14, color: colors.ink },
  nutLabelBold: { ...fontFace('semibold') },
  nutLabelSub: { fontSize: 13, color: colors.muted },
  nutValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nutValue: { ...fontFace('medium'), ...tabularNums, fontSize: 14, color: colors.ink },
  nutValueBold: { ...fontFace('semibold') },
  nutValueDirty: { color: colors.accent },
  editableValueDotted: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.border },
  nutUnknown: { color: colors.muted },
  nutEditWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nutInlineInput: {
    ...fontFace('semibold'),
    ...tabularNums,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'right',
    minWidth: 52,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
  },
  nutInlineInputIdle: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  nutInlineUnit: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  inlineTickBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: 'rgba(122,162,247,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(122,162,247,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nutRule: { height: 1, backgroundColor: colors.hairline, marginVertical: spacing.s4 },
  metaGrid: { gap: 4, paddingHorizontal: 2 },
  metaLine: { ...fontFace('medium'), fontSize: 12, color: colors.muted, lineHeight: 17 },
  metaTapRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 3, marginLeft: -6, borderRadius: radius.r8 },
  metaRowArmed: { backgroundColor: 'rgba(122,162,247,0.12)' },
  metaInlineEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  metaInlineInput: {
    ...fontFace('medium'),
    fontSize: 13,
    color: colors.ink,
    flex: 1,
    minWidth: 100,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
  },
  metaInlineInputIdle: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  metaEditBlock: { gap: spacing.s8, paddingVertical: spacing.s4 },
  metaEditHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  partRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s12, paddingVertical: spacing.s8, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  partName: { ...fontFace('semibold'), fontSize: 15, color: colors.ink },
  partQty: { ...fontFace('medium'), ...tabularNums, fontSize: 13, color: colors.muted, marginTop: 2 },
  partKcal: { ...fontFace('semibold'), ...tabularNums, fontSize: 15, color: colors.ink },
  unitChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s8, alignItems: 'center' },
  unitSectionOpen: { paddingBottom: 140 },
  savedUnitPill: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  savedUnitText: { ...fontFace('medium'), ...tabularNums, fontSize: 13, color: colors.ink },
  savedUnitRemove: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  addUnitButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  addUnitButtonActive: { borderStyle: 'solid', borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.12)' },
  addUnitText: { ...fontFace('semibold'), fontSize: 13, color: colors.accent },
  unitForm: { paddingTop: spacing.s8, paddingBottom: spacing.s8, borderTopWidth: 1, borderTopColor: colors.hairline, gap: spacing.s12 },
  actionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.s12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  actionText: { flex: 1, ...fontFace('semibold'), fontSize: 15, color: colors.ink },
  pressed: { opacity: 0.7 },
  readOnlyPill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: radius.r12,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  readOnlyText: {
    flex: 1,
    ...fontFace('medium'),
    fontSize: 13,
    color: colors.ink,
  },
  readOnlyAction: {
    minHeight: 36,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readOnlyActionText: {
    ...fontFace('semibold'),
    fontSize: 13,
    color: colors.accent,
  },
  readOnlyClose: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toast: { position: 'absolute', left: SCREEN_GUTTER, right: SCREEN_GUTTER, bottom: 8 },
});
