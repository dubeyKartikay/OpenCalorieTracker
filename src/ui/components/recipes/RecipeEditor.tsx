import { useCallback, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppRuntime, useCatalogSearch, usePreferences } from '../../../app/AppRuntimeContext';
import { availableUnits, defaultQuantity } from '../../../app/controller';
import { calculateNutrition, scaleNutrients } from '../../../domain';
import type { NutrientAggregate, NutrientProfile, RecipeIngredient } from '../../../domain';
import { macroShare } from '../../format';
import { hapticLight, hapticSelection, hapticWarning } from '../../haptics';
import { colors, fontFace, macroColors, radius, spacing, tabularNums } from '../../tokens';
import { LocalFoodSearchPager, useScrollNodeIntoView } from '../capture';
import { MacroProportionBar, NumericEditor } from '../doop';
import { RevealPanel } from '../doop/Motion';
import { DoopIcon, inferFoodGlyph } from '../DoopIcons';
import { DottedValue, energyValue, number, SectionRule } from '../primitives';
import {
  formatEnergyDensity,
  formatIngredientDelta,
  isValidRecipeDraft,
  type RecipeDraftShape,
} from './recipeViewMath';

export type RecipeDraft = RecipeDraftShape;
export const validRecipeDraft = isValidRecipeDraft;

/** Incomplete keypad input stays local until a valid quantity is applied (also reused by Onboarding & Settings). */
export function NumericField({ label, value, onChange, unit, optional = false, minimum = 0, maximum, integer = false, disabled = false }: {
  label: string; value: number | null; onChange: (value: number | null) => void;
  unit?: string; optional?: boolean; minimum?: number; maximum?: number | undefined; integer?: boolean; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const numeric = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(numeric) && numeric >= minimum && (maximum === undefined || numeric <= maximum) && (!integer || Number.isInteger(numeric));
  const hint = !valid
    ? maximum !== undefined
      ? `Enter ${integer ? 'a whole number' : 'a number'} between ${minimum} and ${maximum}.`
      : `Enter ${integer ? 'a whole number' : 'a number'} of at least ${minimum}.`
    : undefined;
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} accessibilityState={{ expanded: editing, disabled }} disabled={disabled}
      onPress={() => { setDraft(value === null ? '' : String(value)); setEditing(current => !current); }} style={styles.valueButton}>
      <Text style={styles.label}>{label}</Text><DottedValue value={value === null ? 'Not set' : number(value, 2)} {...(unit ? { unit } : {})} size={16} active={editing} />
    </Pressable>
    {editing && (
      <NumericEditor
        value={draft}
        onChange={setDraft}
        unit={unit}
        allowDecimal={!integer}
        maxDecimals={integer ? 0 : 2}
        allowEmpty
        confirmDisabled={disabled || !valid}
        confirmLabel={`Apply ${label}`}
        cancelLabel={`Cancel ${label}`}
        onConfirm={() => {
          if (!valid) return;
          onChange(Number(draft));
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
        {...(optional ? {
          onClear: () => {
            onChange(null);
            setEditing(false);
          },
          clearLabel: `Clear ${label}`,
        } : {})}
        hint={hint}
        style={{ paddingBottom: 8 }}
      />
    )}
  </View>;
}

/** Shared Tokyo Night Hero for Recipe Detail, New Recipe, Cook Batch, and Batch Detail — mirrors Food Detail. */
export function RecipeHero({
  nutrients,
  energyUnit,
  rightTop,
  rightSub,
  basisToggle,
}: {
  nutrients: NutrientProfile | null | undefined;
  energyUnit: 'kcal' | 'kJ';
  rightTop?: string | null | undefined;
  rightSub?: string | null | undefined;
  basisToggle?: { label: string; onPress: () => void } | undefined;
}) {
  const shares = macroShare(nutrients?.protein_g ?? 0, nutrients?.carbs_g ?? 0, nutrients?.fat_g ?? 0);
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.heroEnergyRow}>
          <Text style={styles.heroEnergyValue}>{number(energyValue(nutrients?.kcal, energyUnit))}</Text>
          <Text style={styles.heroEnergyUnit}>{energyUnit}</Text>
        </View>
        <View style={styles.heroRight}>
          {basisToggle ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch summary view, currently ${basisToggle.label}`}
              onPress={() => {
                hapticSelection();
                basisToggle.onPress();
              }}
              style={({ pressed }) => [styles.basisPill, pressed && styles.pressed]}
            >
              <Text style={styles.basisPillText}>{basisToggle.label}</Text>
            </Pressable>
          ) : rightTop ? (
            <Text style={styles.heroRightMain}>{rightTop}</Text>
          ) : null}
          {rightSub ? <Text style={styles.heroRightSub}>{rightSub}</Text> : null}
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
          ['Protein', nutrients?.protein_g, shares.protein, macroColors.protein],
          ['Carbs', nutrients?.carbs_g, shares.carbs, macroColors.carbs],
          ['Fat', nutrients?.fat_g, shares.fat, macroColors.fat],
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
  );
}

/** 1-tap visual yield pills (Weight & Servings) opening NumericEditor directly without double-tap nesting. */
export function RecYieldPills({
  value,
  onChange,
  disabled = false,
  showServings = true,
}: {
  value: RecipeDraft;
  onChange: (value: RecipeDraft) => void;
  disabled?: boolean;
  showServings?: boolean;
}) {
  const [editing, setEditing] = useState<'weight' | 'servings' | null>(null);
  const [draft, setDraft] = useState('');

  const openEditor = (field: 'weight' | 'servings') => {
    if (disabled) return;
    hapticSelection();
    if (editing === field) {
      setEditing(null);
      return;
    }
    const current = field === 'weight' ? value.cooked_weight_g : value.servings_count;
    setDraft(current === null ? '' : String(current));
    setEditing(field);
  };

  const numeric = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(numeric) && numeric >= 0.01;
  const hasWeight = value.cooked_weight_g !== null && value.cooked_weight_g > 0;
  const hasServings = value.servings_count !== null && value.servings_count > 0;

  return (
    <View style={styles.yieldBlock}>
      <View style={styles.yieldPillsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasWeight ? `Cooked weight ${number(value.cooked_weight_g, 1)} g` : 'Set cooked weight'}
          accessibilityState={{ expanded: editing === 'weight', disabled }}
          disabled={disabled}
          onPress={() => openEditor('weight')}
          style={({ pressed }) => [
            styles.yieldPill,
            !hasWeight && styles.yieldPillEmpty,
            editing === 'weight' && styles.yieldPillActive,
            pressed && styles.pressed,
          ]}
        >
          <DoopIcon name="scale" size={14} color={editing === 'weight' || hasWeight ? colors.accent : colors.muted} />
          <Text style={[styles.yieldPillText, !hasWeight && styles.yieldPillTextEmpty]}>
            {hasWeight ? `${number(value.cooked_weight_g, 1)} g cooked` : 'Weight'}
          </Text>
        </Pressable>

        {showServings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasServings ? `Serves ${number(value.servings_count, 1)}` : 'Set servings'}
            accessibilityState={{ expanded: editing === 'servings', disabled }}
            disabled={disabled}
            onPress={() => openEditor('servings')}
            style={({ pressed }) => [
              styles.yieldPill,
              !hasServings && styles.yieldPillEmpty,
              editing === 'servings' && styles.yieldPillActive,
              pressed && styles.pressed,
            ]}
          >
            <DoopIcon name="plate" size={14} color={editing === 'servings' || hasServings ? colors.accent : colors.muted} />
            <Text style={[styles.yieldPillText, !hasServings && styles.yieldPillTextEmpty]}>
              {hasServings ? `${number(value.servings_count, 1)} ${value.servings_count === 1 ? 'serving' : 'servings'}` : 'Servings'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {editing ? (
        <RevealPanel visible direction="down">
          <NumericEditor
            value={draft}
            placeholder={editing === 'weight' ? '1000' : '2'}
            onChange={setDraft}
            unit={editing === 'weight' ? 'g' : 'servings'}
            allowDecimal
            maxDecimals={2}
            allowEmpty
            confirmDisabled={disabled || !valid}
            confirmLabel={editing === 'weight' ? 'Apply cooked weight' : 'Apply servings'}
            cancelLabel="Cancel"
            onConfirm={() => {
              if (!valid) return;
              hapticLight();
              onChange({
                ...value,
                [editing === 'weight' ? 'cooked_weight_g' : 'servings_count']: Number(draft),
              });
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
            {...((editing === 'weight' ? hasWeight : hasServings) ? {
              onClear: () => {
                hapticSelection();
                onChange({
                  ...value,
                  [editing === 'weight' ? 'cooked_weight_g' : 'servings_count']: null,
                });
                setEditing(null);
              },
              clearLabel: editing === 'weight' ? 'Clear weight' : 'Clear servings',
            } : {})}
            style={styles.yieldEditor}
          />
        </RevealPanel>
      ) : null}
    </View>
  );
}

/** Spacious mobile-first ingredient row with food glyph, tappable quantity pill, and inline keypad. */
export function RecIngredientRow({
  ingredient,
  original,
  onChange,
  onRemove,
  disabled = false,
}: {
  ingredient: RecipeIngredient;
  original?: RecipeIngredient | undefined;
  onChange?: ((ingredient: RecipeIngredient) => void) | undefined;
  onRemove?: (() => void) | undefined;
  disabled?: boolean;
}) {
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(ingredient.quantity.amount));
  const [unit, setUnit] = useState(ingredient.quantity.unit);
  const kcal = calculateNutrition(ingredient.food, ingredient.quantity).kcal;
  const valid = amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const delta = formatIngredientDelta(ingredient, original);
  const canEdit = Boolean(onChange && !disabled);

  const toggleEdit = () => {
    if (!canEdit) return;
    hapticSelection();
    if (!editing) {
      setAmount(String(ingredient.quantity.amount));
      setUnit(ingredient.quantity.unit);
    }
    setEditing(current => !current);
  };

  return (
    <View style={styles.ingredient}>
      <Pressable
        accessibilityRole={canEdit ? 'button' : 'text'}
        accessibilityLabel={`${ingredient.food.name}, ${number(ingredient.quantity.amount, 2)} ${ingredient.quantity.unit}, ${number(energyValue(kcal, energyUnit))} ${energyUnit}`}
        accessibilityState={canEdit ? { expanded: editing, disabled } : undefined}
        disabled={!canEdit}
        onPress={toggleEdit}
        style={({ pressed }) => [styles.ingredientLine, pressed && canEdit && styles.pressed]}
      >
        <View style={styles.ingredientGlyph}>
          <DoopIcon name={inferFoodGlyph(ingredient.food.name, 'food')} size={17} color={colors.muted} />
        </View>
        <View style={styles.ingredientMain}>
          <Text numberOfLines={1} style={styles.ingredientName}>{ingredient.food.name}</Text>
          {delta ? <Text style={styles.deltaText}>{delta}</Text> : null}
        </View>
        <View style={[styles.qtyPill, editing && styles.qtyPillActive, delta && styles.qtyPillChanged]}>
          <Text style={[styles.qtyPillText, (editing || delta) && styles.qtyPillTextAccent]}>
            {number(ingredient.quantity.amount, 2)} {ingredient.quantity.unit}
          </Text>
        </View>
        <Text style={styles.ingredientKcal}>{number(energyValue(kcal, energyUnit))}</Text>
      </Pressable>

      {editing && onChange ? (
        <RevealPanel visible direction="down" style={styles.ingredientEditor}>
          <NumericEditor
            value={amount}
            onChange={setAmount}
            units={availableUnits(ingredient.food)}
            selectedUnit={unit}
            onSelectUnit={setUnit}
            maxDecimals={2}
            allowEmpty
            confirmDisabled={!valid || disabled}
            confirmLabel="Apply amount"
            cancelLabel="Cancel"
            onConfirm={() => {
              if (!valid) return;
              hapticLight();
              onChange({ ...ingredient, quantity: { amount: Number(amount), unit } });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${ingredient.food.name}`}
              disabled={disabled}
              onPress={() => {
                hapticWarning();
                setEditing(false);
                onRemove();
              }}
              style={({ pressed }) => [styles.removeRow, pressed && styles.pressed]}
            >
              <DoopIcon name="trash" size={14} color={colors.danger} />
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          ) : null}
        </RevealPanel>
      ) : null}
    </View>
  );
}

function IngredientSearch({
  onAdd,
  onClose,
  disabled,
  energyUnit,
}: {
  onAdd: (ingredient: RecipeIngredient) => void;
  onClose: () => void;
  disabled: boolean;
  energyUnit: 'kcal' | 'kJ';
}) {
  const [query, setQuery] = useState('');
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const liveQuery = query.trim();
  const search = useCatalogSearch(liveQuery);
  const searchPending = Boolean(liveQuery) && (search.debouncing || search.loading);
  const candidates = liveQuery && search.value ? [...search.value.yours, ...search.value.database] : [];

  return (
    <RevealPanel visible direction="down" style={styles.searchComposer}>
      <View style={styles.searchRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close ingredient search"
          disabled={disabled}
          onPress={() => { Keyboard.dismiss(); onClose(); }}
          style={styles.closeCircle}
        >
          <DoopIcon name="close" size={15} color={colors.muted} />
        </Pressable>
        <TextInput
          ref={inputRef}
          autoFocus
          accessibilityLabel="Search ingredients"
          placeholder="Search ingredient"
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          value={query}
          onChangeText={text => {
            setQuery(text);
            if (text.trim()) setLastAdded(null);
          }}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear ingredient search"
            disabled={disabled}
            onPress={() => { setQuery(''); inputRef.current?.focus(); }}
            style={styles.clearBtn}
          >
            <DoopIcon name="close" size={14} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {lastAdded && !liveQuery ? (
        <View style={styles.addedPill}>
          <DoopIcon name="check" size={13} color={colors.success} />
          <Text numberOfLines={1} style={styles.addedText}>{lastAdded}</Text>
        </View>
      ) : null}
      <LocalFoodSearchPager
        query={liveQuery}
        candidates={candidates}
        pending={searchPending}
        error={search.error}
        energyUnit={energyUnit}
        disabled={disabled}
        emptyMessage="No matches"
        addLabel={food => `Add ${food.name}`}
        onAdd={food => {
          hapticLight();
          onAdd({ food, quantity: defaultQuantity(food) });
          setLastAdded(food.name);
          setQuery('');
          inputRef.current?.focus();
        }}
      />
    </RevealPanel>
  );
}

export function RecipeEditor({
  value,
  onChange,
  originalIngredients,
  showName = true,
  allowAdd = true,
  disabled = false,
  scrollRef,
  scrollOffsetRef,
}: {
  value: RecipeDraft;
  onChange: (value: RecipeDraft) => void;
  originalIngredients?: readonly RecipeIngredient[] | undefined;
  showName?: boolean;
  allowAdd?: boolean;
  disabled?: boolean;
  scrollRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
  scrollOffsetRef?: RefObject<number>;
}) {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [adding, setAdding] = useState(false);
  const [viewMode, setViewMode] = useState<'serving' | 'total'>('serving');
  const searchAnchorRef = useRef<ComponentRef<typeof View> | null>(null);
  const getSearchAnchor = useCallback(() => searchAnchorRef.current, []);
  useScrollNodeIntoView(scrollRef, scrollOffsetRef, getSearchAnchor, allowAdd && adding ? 'recipe-ingredient-search' : null);

  const total: NutrientAggregate = controller.previewRecipeTotals(value.ingredients);
  const hasServings = value.servings_count !== null && value.servings_count > 0;
  const effectiveView = hasServings ? viewMode : 'total';
  const displayedNutrients = total.nutrients
    ? effectiveView === 'serving' && value.servings_count
      ? scaleNutrients(total.nutrients, 1 / value.servings_count)
      : total.nutrients
    : null;
  const density = formatEnergyDensity(total.nutrients?.kcal, value.cooked_weight_g, energyUnit);

  return (
    <View style={styles.editorRoot}>
      {showName ? (
        <TextInput
          accessibilityLabel="Recipe name"
          placeholder="Recipe name"
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          value={value.name}
          editable={!disabled}
          onChangeText={name => onChange({ ...value, name })}
          returnKeyType="done"
          style={styles.nameInput}
        />
      ) : null}

      <RecipeHero
        nutrients={displayedNutrients}
        energyUnit={energyUnit}
        basisToggle={
          hasServings
            ? {
                label: effectiveView === 'serving' ? 'Per serving' : 'Total',
                onPress: () => setViewMode(mode => (mode === 'serving' ? 'total' : 'serving')),
              }
            : undefined
        }
        rightTop={!hasServings ? 'Total' : undefined}
        rightSub={density}
      />

      <RecYieldPills value={value} onChange={onChange} disabled={disabled} />

      <View style={styles.ingredientsSection}>
        <SectionRule
          label="Ingredients"
          meta={value.ingredients.length ? String(value.ingredients.length) : undefined}
        />

        {value.ingredients.map((ingredient, index) => {
          const original = originalIngredients?.[index]
            ?? originalIngredients?.find(
              item => item.food.id === ingredient.food.id && (item.food.source_pack_id ?? null) === (ingredient.food.source_pack_id ?? null),
            );
          return (
            <RecIngredientRow
              key={`${index}:${ingredient.food.source_pack_id ?? 'user'}:${ingredient.food.id}`}
              ingredient={ingredient}
              original={original}
              disabled={disabled}
              onChange={next => onChange({
                ...value,
                ingredients: value.ingredients.map((item, position) => (position === index ? next : item)),
              })}
              onRemove={allowAdd ? () => onChange({
                ...value,
                ingredients: value.ingredients.filter((_, position) => position !== index),
              }) : undefined}
            />
          );
        })}

        {allowAdd ? (
          <View ref={searchAnchorRef} collapsable={false} style={adding ? styles.searchAnchorOpen : styles.addWrap}>
            {adding ? (
              <IngredientSearch
                disabled={disabled}
                energyUnit={energyUnit}
                onClose={() => setAdding(false)}
                onAdd={ingredient => onChange({ ...value, ingredients: [...value.ingredients, ingredient] })}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add ingredient"
                disabled={disabled}
                onPress={() => {
                  hapticSelection();
                  setAdding(true);
                }}
                style={({ pressed }) => [styles.addPill, pressed && styles.pressed]}
              >
                <DoopIcon name="plus" size={14} color={colors.accent} />
                <Text style={styles.addPillText}>Ingredient</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editorRoot: { gap: spacing.s16 },
  nameInput: {
    ...fontFace('bold'),
    fontSize: 22,
    letterSpacing: -0.4,
    color: colors.ink,
    paddingVertical: spacing.s6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  hero: { paddingTop: spacing.s2, paddingBottom: spacing.s2 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s12 },
  heroEnergyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroEnergyValue: { ...fontFace('bold'), ...tabularNums, fontSize: 36, lineHeight: 40, color: colors.ink, letterSpacing: -0.6 },
  heroEnergyUnit: { ...fontFace('semibold'), fontSize: 15, color: colors.muted },
  heroRight: { alignItems: 'flex-end', gap: 4, flexShrink: 1 },
  heroRightMain: { ...fontFace('semibold'), fontSize: 14, color: colors.ink },
  heroRightSub: { ...fontFace('medium'), ...tabularNums, fontSize: 12, color: colors.muted },
  basisPill: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(122,162,247,0.42)',
    backgroundColor: 'rgba(122,162,247,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  basisPillText: { ...fontFace('semibold'), fontSize: 12, color: colors.accent },
  heroBar: { marginTop: spacing.s12 },
  heroRule: { height: 1, backgroundColor: colors.hairline, marginTop: spacing.s16, marginBottom: spacing.s10 },
  macroCols: { flexDirection: 'row', gap: spacing.s12 },
  macroCol: { flex: 1, gap: 4 },
  macroColHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  macroDot: { width: 7, height: 7, borderRadius: 3.5 },
  macroColLabel: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  macroColVal: { ...fontFace('semibold'), ...tabularNums, fontSize: 15, color: colors.ink },
  macroColPct: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  yieldBlock: { gap: spacing.s8 },
  yieldPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s8 },
  yieldPill: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  yieldPillEmpty: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  yieldPillActive: {
    borderStyle: 'solid',
    borderColor: colors.accent,
    backgroundColor: 'rgba(122,162,247,0.12)',
  },
  yieldPillText: { ...fontFace('semibold'), ...tabularNums, fontSize: 13, color: colors.ink },
  yieldPillTextEmpty: { color: colors.muted },
  yieldEditor: { paddingTop: spacing.s4 },
  ingredientsSection: { gap: spacing.s6 },
  ingredient: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  ingredientLine: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  ingredientGlyph: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ingredientMain: { flex: 1, minWidth: 0, gap: 1 },
  ingredientName: { ...fontFace('semibold'), color: colors.ink, fontSize: 14 },
  deltaText: { ...fontFace('semibold'), ...tabularNums, fontSize: 11, color: colors.accent },
  qtyPill: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyPillActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(122,162,247,0.14)',
  },
  qtyPillChanged: {
    borderColor: 'rgba(122,162,247,0.45)',
    backgroundColor: 'rgba(122,162,247,0.10)',
  },
  qtyPillText: { ...fontFace('semibold'), ...tabularNums, fontSize: 12, color: colors.ink },
  qtyPillTextAccent: { color: colors.accent },
  ingredientKcal: { ...fontFace('bold'), ...tabularNums, minWidth: 38, textAlign: 'right', color: colors.ink, fontSize: 14 },
  ingredientEditor: { paddingBottom: spacing.s10, gap: spacing.s6 },
  removeRow: {
    alignSelf: 'flex-start',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  removeText: { ...fontFace('semibold'), fontSize: 13, color: colors.danger },
  addWrap: { paddingTop: spacing.s6 },
  addPill: {
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
  addPillText: { ...fontFace('semibold'), fontSize: 13, color: colors.accent },
  searchAnchorOpen: { paddingTop: 6, paddingBottom: 160 },
  searchComposer: { gap: 6 },
  searchRow: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  closeCircle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(192,202,245,0.10)', alignItems: 'center', justifyContent: 'center' },
  searchInput: { ...fontFace('semibold'), flex: 1, minWidth: 0, height: 44, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.r12, backgroundColor: colors.dock, paddingHorizontal: 11, paddingVertical: 0, color: colors.ink, fontSize: 16, letterSpacing: -0.16 },
  clearBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  addedPill: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  addedText: { ...fontFace('medium'), flex: 1, fontSize: 12, color: colors.muted },
  valueButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { ...fontFace(), color: colors.muted, fontSize: 13 },
  pressed: { opacity: 0.7 },
});
