import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppRuntime, useCatalogSearch, usePreferences } from '../../../app/AppRuntimeContext';
import { availableUnits, defaultQuantity, sourceLabel } from '../../../app/controller';
import { calculateNutrition, scaleNutrients } from '../../../domain';
import type { NutrientAggregate, RecipeIngredient } from '../../../domain';
import { colors, fontFace, macroColors, radius, spacing, tabularNums } from '../../tokens';
import { NumericEditor } from '../doop';
import { DoopIcon } from '../DoopIcons';
import { Button, DottedValue, energyValue, ErrorMessage, Input, Label, Muted, number, SectionRule } from '../primitives';

export interface RecipeDraft { name: string; ingredients: RecipeIngredient[]; cooked_weight_g: number | null; servings_count: number | null }

/** Incomplete keypad input stays local until a valid quantity is applied. */
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

export function NutritionReadout({ total, divisor = 1, label, hideMacros = false }: { total: NutrientAggregate; divisor?: number; label?: string; hideMacros?: boolean }) {
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const nutrients = total.nutrients && divisor > 0 ? scaleNutrients(total.nutrients, 1 / divisor) : null;
  return <View style={styles.summary}>
    <Text style={styles.energy}>{number(energyValue(nutrients?.kcal, energyUnit))}<Text style={styles.energyUnit}>{` ${energyUnit}`}</Text></Text>
    {!hideMacros && <View style={styles.macros}><Text style={styles.separator}>·</Text>
      <Text style={[styles.macro, { color: macroColors.protein }]}>P {number(nutrients?.protein_g)}</Text>
      <Text style={[styles.macro, { color: macroColors.carbs }]}>C {number(nutrients?.carbs_g)}</Text>
      <Text style={[styles.macro, { color: macroColors.fat }]}>F {number(nutrients?.fat_g)}</Text>
    </View>}
    {!!label && <Text style={styles.summaryLabel}>{label}</Text>}
  </View>;
}

export function RecYieldRow({ value, onChange, disabled = false, showServings = true }: { value: RecipeDraft; onChange: (value: RecipeDraft) => void; disabled?: boolean; showServings?: boolean }) {
  const [editing, setEditing] = useState<'weight' | 'servings' | null>(null);
  return <View>
    <View style={styles.yieldRow}>
      <DottedValue value={value.cooked_weight_g === null ? 'Set weight' : number(value.cooked_weight_g, 2)} size={16} onPress={() => { if (!disabled) setEditing(current => current === 'weight' ? null : 'weight'); }} accessibilityLabel="Edit cooked weight" />
      <Text style={styles.yieldUnit}>g cooked</Text>
      {showServings && <><Text style={styles.separator}>·</Text><Text style={styles.yieldUnit}>serves</Text>
        <DottedValue value={value.servings_count === null ? '—' : number(value.servings_count, 2)} size={13} onPress={() => { if (!disabled) setEditing(current => current === 'servings' ? null : 'servings'); }} accessibilityLabel="Edit servings" /></>}
    </View>
    {editing && <NumericField key={editing} label={editing === 'weight' ? 'Cooked weight' : 'Servings'} unit={editing === 'weight' ? 'g' : 'servings'} minimum={0.01} optional disabled={disabled}
      value={editing === 'weight' ? value.cooked_weight_g : value.servings_count}
      onChange={next => { onChange({ ...value, [editing === 'weight' ? 'cooked_weight_g' : 'servings_count']: next }); setEditing(null); }} />}
  </View>;
}

export function RecIngredientRow({ ingredient, original, onChange, onRemove, disabled = false }: {
  ingredient: RecipeIngredient; original?: RecipeIngredient | undefined; onChange?: (ingredient: RecipeIngredient) => void; onRemove?: (() => void) | undefined; disabled?: boolean;
}) {
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(ingredient.quantity.amount));
  const [unit, setUnit] = useState(ingredient.quantity.unit);
  const kcal = calculateNutrition(ingredient.food, ingredient.quantity).kcal;
  const valid = amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const differs = original && (original.quantity.amount !== ingredient.quantity.amount || original.quantity.unit !== ingredient.quantity.unit);
  return <View style={styles.ingredient}>
    <View style={styles.ingredientLine}>
      <Text numberOfLines={1} style={styles.ingredientName}>{ingredient.food.name}</Text>
      <DottedValue value={number(ingredient.quantity.amount, 2)} unit={ingredient.quantity.unit} size={13} {...(onChange && !disabled ? { onPress: () => { setAmount(String(ingredient.quantity.amount)); setUnit(ingredient.quantity.unit); setEditing(current => !current); }, accessibilityLabel: `Edit amount of ${ingredient.food.name}` } : {})} />
      {original && <Text style={styles.diff}>{differs ? `≠ ${number(original.quantity.amount, 2)} ${original.quantity.unit}` : ''}</Text>}
      <Text style={styles.ingredientKcal}>{number(energyValue(kcal, energyUnit))}</Text><View style={styles.source}><Text numberOfLines={1} style={styles.sourceText}>{sourceLabel(ingredient.food)}</Text></View>
    </View>
    {editing && onChange && (
      <View style={{ gap: 6, paddingBottom: 8 }}>
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
          hint={!valid ? 'Enter an amount greater than zero.' : undefined}
          onConfirm={() => {
            if (!valid) return;
            onChange({ ...ingredient, quantity: { amount: Number(amount), unit } });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
        {onRemove && <Button label="Remove" accessibilityLabel={`Remove ${ingredient.food.name}`} quiet disabled={disabled} onPress={onRemove} />}
      </View>
    )}
  </View>;
}
function IngredientSearch({ onAdd, disabled }: { onAdd: (ingredient: RecipeIngredient) => void; disabled: boolean }) {
  const [query, setQuery] = useState('');
  const search = useCatalogSearch(query);
  const candidates = search.value ? [...search.value.yours, ...search.value.database] : [];
  return <View style={{ gap: 8 }}>
    <Input label="Search ingredients" placeholder="Ingredient" value={query} onChangeText={setQuery} editable={!disabled} autoFocus />
    <ErrorMessage message={search.error} />
    {query.trim() && (search.loading || search.debouncing) ? <Muted>Searching…</Muted> : null}
    {query.trim() && !search.loading && !search.debouncing && candidates.length === 0 && !search.error ? <Muted>No ingredients found. Try another name or enable a food pack in Settings.</Muted> : null}
    {candidates.map(({ food }) => <Pressable key={`${food.source_pack_id ?? 'user'}:${food.id}`} accessibilityRole="button" accessibilityLabel={`Add ${food.name}`} disabled={disabled}
      style={styles.searchResult} onPress={() => { onAdd({ food, quantity: defaultQuantity(food) }); setQuery(''); }}>
      <Label style={{ flex: 1 }}>{food.name}</Label><Text style={styles.sourceText}>{sourceLabel(food)}</Text><DoopIcon name="plus" size={16} color={colors.accent} />
    </Pressable>)}
  </View>;
}
export function RecipeEditor({ value, onChange, showName = true, allowAdd = true, disabled = false }: {
  value: RecipeDraft; onChange: (value: RecipeDraft) => void; showName?: boolean; allowAdd?: boolean; disabled?: boolean;
}) {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [adding, setAdding] = useState(false);
  const total = controller.previewRecipeTotals(value.ingredients);
  return <View>
    {showName && <Input label="Recipe name" placeholder="e.g. Dal tadka" value={value.name} editable={!disabled} onChangeText={name => onChange({ ...value, name })} style={{ backgroundColor: 'transparent', borderWidth: 0, borderBottomWidth: 1, borderRadius: 0, paddingHorizontal: 0 }} />}
    <RecYieldRow value={value} onChange={onChange} disabled={disabled} />
    <View style={{ marginTop: 10 }}>
      {value.servings_count !== null && <NutritionReadout total={total} divisor={value.servings_count} label="per serving" />}
      <NutritionReadout total={total} label="total" />
    </View>
    <View style={{ marginTop: 28, marginBottom: 8 }}><SectionRule label="Ingredients" {...(value.cooked_weight_g && total.nutrients ? { meta: `${number(energyValue(total.nutrients.kcal / value.cooked_weight_g * 100, energyUnit))} ${energyUnit} / 100 g` } : {})} /></View>
    {!value.ingredients.length && <Muted>Add your first ingredient to see nutrition.</Muted>}
    {value.ingredients.map((ingredient, index) => <RecIngredientRow key={`${index}:${ingredient.food.source_pack_id}:${ingredient.food.id}`} ingredient={ingredient} disabled={disabled}
      onChange={next => onChange({ ...value, ingredients: value.ingredients.map((item, position) => position === index ? next : item) })}
      onRemove={allowAdd ? () => onChange({ ...value, ingredients: value.ingredients.filter((_, position) => position !== index) }) : undefined} />)}
    {allowAdd && <Pressable accessibilityRole="button" disabled={disabled} onPress={() => setAdding(current => !current)} style={styles.add}>
      <DoopIcon name={adding ? 'close' : 'plus'} size={16} color={colors.accent} /><Text style={styles.addLabel}>{adding ? 'Close ingredient search' : 'Ingredient'}</Text>
    </Pressable>}
    {allowAdd && adding && <IngredientSearch disabled={disabled} onAdd={ingredient => onChange({ ...value, ingredients: [...value.ingredients, ingredient] })} />}
  </View>;
}
export const validRecipeDraft = (draft: RecipeDraft) => draft.name.trim().length > 0 && draft.ingredients.length > 0;
const styles = StyleSheet.create({
  valueButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { ...fontFace(), color: colors.muted, fontSize: 13 },
  summary: { minHeight: 28, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  energy: { ...fontFace('bold'), ...tabularNums, color: colors.ink, fontSize: 18, letterSpacing: -0.3 },
  energyUnit: { ...fontFace('semibold'), fontSize: 12, color: colors.muted },
  macros: { flexDirection: 'row', alignItems: 'baseline', gap: 8 }, macro: { ...fontFace('semibold'), ...tabularNums, fontSize: 12 },
  separator: { ...fontFace(), color: colors.border, fontSize: 13 }, summaryLabel: { ...fontFace(), marginLeft: 'auto', fontSize: 11, color: colors.muted },
  yieldRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 6 }, yieldUnit: { ...fontFace(), fontSize: 13, color: colors.muted },
  ingredient: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  ingredientLine: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 6 },
  ingredientName: { ...fontFace('semibold'), color: colors.ink, fontSize: 13, flex: 1 },
  ingredientKcal: { ...fontFace('semibold'), ...tabularNums, width: 40, textAlign: 'right', color: colors.ink, fontSize: 13 },
  diff: { ...fontFace(), ...tabularNums, width: 54, textAlign: 'right', color: colors.muted, opacity: 0.82, fontSize: 10 },
  source: { maxWidth: 48, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.full, borderWidth: 1, borderColor: colors.hairline }, sourceText: { ...fontFace('semibold'), color: colors.muted, fontSize: 10 },
  add: { minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.hairline, flexDirection: 'row', alignItems: 'center', gap: 8 }, addLabel: { ...fontFace('semibold'), color: colors.muted, fontSize: 13 },
  searchResult: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.s8, borderBottomWidth: 1, borderBottomColor: colors.hairline },
});
