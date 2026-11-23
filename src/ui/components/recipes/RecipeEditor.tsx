import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppRuntime, useCatalogSearch } from '../../../app/AppRuntimeContext';
import { availableUnits, defaultQuantity, sourceLabel } from '../../../app/controller';
import { calculateNutrition, scaleNutrients } from '../../../domain';
import type { NutrientAggregate, RecipeIngredient } from '../../../domain';
import { colors, fontSize, fontWeight, macroColors, MIN_TOUCH_TARGET, radius, spacing, tabularNums } from '../../tokens';
import { InlineKeypad, MacroProportionBar, SourceBadge } from '../doop';
import { Button, ErrorMessage, Heading, Input, Label, Muted, number, ui } from '../primitives';

export interface RecipeDraft {
  name: string;
  ingredients: RecipeIngredient[];
  cooked_weight_g: number | null;
  servings_count: number | null;
}

/** Keep incomplete keypad input local so previews only receive valid quantities. */
export function NumericField({ label, value, onChange, unit, optional = false, minimum = 0, integer = false, disabled = false }: {
  label: string; value: number | null; onChange: (value: number | null) => void;
  unit?: string; optional?: boolean; minimum?: number; integer?: boolean; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const valid = draft.trim() !== '' && Number.isFinite(Number(draft)) && Number(draft) >= minimum && (!integer || Number.isInteger(Number(draft)));
  return <View style={styles.field}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} accessibilityState={{ expanded: editing, disabled }} disabled={disabled}
      onPress={() => { setDraft(value === null ? '' : String(value)); setEditing(current => !current); }} style={styles.valueButton}>
      <Text style={ui.muted}>{label}</Text>
      <Text style={[ui.number, styles.editable]}>{value === null ? 'Not set' : number(value, 2)}{value !== null && unit ? ` ${unit}` : ''}</Text>
    </Pressable>
    {editing && <>
      <InlineKeypad value={draft} onChange={setDraft} selectedUnit={unit} allowDecimal={!integer} maxDecimals={integer ? 0 : 2} />
      {!valid && <Muted>Enter {integer ? 'a whole number' : 'a number'} of at least {minimum}.</Muted>}
      <View style={ui.wrap}>
        <Button label={`Apply ${label}`} disabled={disabled || !valid} onPress={() => { onChange(Number(draft)); setEditing(false); }} />
        {optional && <Button label={`Clear ${label}`} disabled={disabled} onPress={() => { onChange(null); setEditing(false); }} />}
        <Button label="Cancel" onPress={() => setEditing(false)} />
      </View>
    </>}
  </View>;
}

export function NutritionReadout({ total, divisor = 1, label }: { total: NutrientAggregate; divisor?: number; label?: string }) {
  const nutrients = total.nutrients ? scaleNutrients(total.nutrients, 1 / divisor) : null;
  return <View style={{ gap: spacing.s8 }}>
    {label && <Muted>{label}</Muted>}
    <Text style={[ui.number, styles.energy]}>{number(nutrients?.kcal)} <Text style={styles.energyUnit}>kcal</Text></Text>
    <View style={ui.wrap}>
      <Label style={{ color: macroColors.protein }}>P {number(nutrients?.protein_g, 1)} g</Label>
      <Label style={{ color: macroColors.carbs }}>C {number(nutrients?.carbs_g, 1)} g</Label>
      <Label style={{ color: macroColors.fat }}>F {number(nutrients?.fat_g, 1)} g</Label>
    </View>
    <MacroProportionBar proteinG={nutrients?.protein_g ?? 0} carbsG={nutrients?.carbs_g ?? 0} fatG={nutrients?.fat_g ?? 0} />
    {total.unknownCount.fiber_g > 0
      ? <Muted>Fiber · {total.unknownCount.fiber_g} unknown{nutrients?.fiber_g != null ? ` · ${number(nutrients.fiber_g, 1)} g known subtotal` : ''}</Muted>
      : <Muted>Fiber · {number(nutrients?.fiber_g, 1)} g</Muted>}
  </View>;
}

export function RecYieldRow({ value, onChange, disabled = false }: { value: RecipeDraft; onChange: (value: RecipeDraft) => void; disabled?: boolean }) {
  return <View style={{ gap: spacing.s8 }}>
    <Heading>Yield</Heading>
    <Muted>Optional. Cooked weight enables gram portions; servings enables per-serving nutrition.</Muted>
    <NumericField label="Cooked weight (g)" unit="g" value={value.cooked_weight_g} minimum={0.01} optional disabled={disabled}
      onChange={cooked_weight_g => onChange({ ...value, cooked_weight_g })} />
    <NumericField label="Serves N" unit="servings" value={value.servings_count} minimum={0.01} optional disabled={disabled}
      onChange={servings_count => onChange({ ...value, servings_count })} />
  </View>;
}

export function RecIngredientRow({ ingredient, onChange, onRemove, disabled = false }: {
  ingredient: RecipeIngredient; onChange?: (ingredient: RecipeIngredient) => void; onRemove?: (() => void) | undefined; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(ingredient.quantity.amount));
  const [unit, setUnit] = useState(ingredient.quantity.unit);
  const kcal = calculateNutrition(ingredient.food, ingredient.quantity).kcal;
  const valid = amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0;
  return <View style={styles.ingredient}>
    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
      <View style={{ flex: 1, gap: spacing.s6 }}><Label>{ingredient.food.name}</Label>
        <SourceBadge label={sourceLabel(ingredient.food)} />
      </View>
      <Label style={ui.number}>{number(kcal)} kcal</Label>
    </View>
    <View style={ui.wrap}>
      {onChange ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit amount of ${ingredient.food.name}`}
        accessibilityState={{ expanded: editing, disabled }} disabled={disabled} style={styles.amountButton}
        onPress={() => { setAmount(String(ingredient.quantity.amount)); setUnit(ingredient.quantity.unit); setEditing(current => !current); }}>
        <Text style={[ui.number, styles.editable]}>{number(ingredient.quantity.amount, 2)} {ingredient.quantity.unit}</Text>
      </Pressable> : <Label>{number(ingredient.quantity.amount, 2)} {ingredient.quantity.unit}</Label>}
      {onRemove && <Button label="Remove" accessibilityLabel={`Remove ${ingredient.food.name}`} disabled={disabled} onPress={onRemove} />}
    </View>
    {editing && onChange && <>
      <InlineKeypad value={amount} onChange={setAmount} units={availableUnits(ingredient.food)} selectedUnit={unit} onSelectUnit={setUnit} maxDecimals={2} />
      {!valid && <Muted>Enter an amount greater than zero.</Muted>}
      <View style={ui.wrap}><Button label="Apply amount" disabled={!valid || disabled} onPress={() => {
        onChange({ ...ingredient, quantity: { amount: Number(amount), unit } }); setEditing(false);
      }} /><Button label="Cancel" onPress={() => setEditing(false)} /></View>
    </>}
  </View>;
}

function IngredientSearch({ onAdd, disabled }: { onAdd: (ingredient: RecipeIngredient) => void; disabled: boolean }) {
  const [query, setQuery] = useState('');
  const search = useCatalogSearch(query);
  const candidates = search.value ? [...search.value.yours, ...search.value.database] : [];
  return <View style={{ gap: spacing.s12 }}>
    <Input label="Search ingredients" placeholder="Search local foods and your library" value={query} onChangeText={setQuery} editable={!disabled} autoFocus />
    <Muted>Searches enabled local food packs and your saved foods.</Muted>
    <ErrorMessage message={search.error} />
    {query.trim() && search.loading ? <Muted>Searching…</Muted> : null}
    {query.trim() && !search.loading && candidates.length === 0 && !search.error ? <Muted>No ingredients found. Try another name or enable a food pack in Settings.</Muted> : null}
    {candidates.map(({ food }) => <View key={`${food.source_pack_id ?? 'user'}:${food.id}`} style={styles.searchResult}>
      <Label>{food.name}</Label><SourceBadge label={sourceLabel(food)} />
      <Button label={`Add ${food.name}`} disabled={disabled} onPress={() => {
        onAdd({ food, quantity: defaultQuantity(food) }); setQuery('');
      }} />
    </View>)}
  </View>;
}

export function RecipeEditor({ value, onChange, showName = true, allowAdd = true, disabled = false }: {
  value: RecipeDraft; onChange: (value: RecipeDraft) => void; showName?: boolean; allowAdd?: boolean; disabled?: boolean;
}) {
  const { controller } = useAppRuntime();
  const [adding, setAdding] = useState(false);
  const total = controller.previewRecipeTotals(value.ingredients);
  return <View style={{ gap: spacing.s20 }}>
    {showName && <Input label="Recipe name" placeholder="e.g. Dal tadka" value={value.name} editable={!disabled} onChangeText={name => onChange({ ...value, name })} />}
    <RecYieldRow value={value} onChange={onChange} disabled={disabled} />
    <Heading>Ingredients</Heading>
    {!value.ingredients.length && <Muted>Add your first ingredient to see nutrition.</Muted>}
    {value.ingredients.map((ingredient, index) => <RecIngredientRow key={`${index}:${ingredient.food.source_pack_id}:${ingredient.food.id}`} ingredient={ingredient} disabled={disabled}
      onChange={next => onChange({ ...value, ingredients: value.ingredients.map((item, position) => position === index ? next : item) })}
      onRemove={allowAdd ? () => onChange({ ...value, ingredients: value.ingredients.filter((_, position) => position !== index) }) : undefined} />)}
    {allowAdd && <Button label={adding ? 'Close ingredient search' : '+ Add ingredient'} selected={adding} disabled={disabled} onPress={() => setAdding(current => !current)} />}
    {allowAdd && adding && <IngredientSearch disabled={disabled} onAdd={ingredient => onChange({ ...value, ingredients: [...value.ingredients, ingredient] })} />}
    {total.nutrients && <>
      <NutritionReadout total={total} label="Total recipe" />
      {value.servings_count !== null && <NutritionReadout total={total} divisor={value.servings_count} label={`Per serving · serves ${number(value.servings_count, 2)}`} />}
    </>}
  </View>;
}

export const validRecipeDraft = (draft: RecipeDraft) => draft.name.trim().length > 0 && draft.ingredients.length > 0;

const styles = StyleSheet.create({
  field: { gap: spacing.s8 },
  valueButton: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, paddingVertical: spacing.s8, gap: spacing.s6 },
  editable: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', color: colors.accent },
  energy: { fontSize: fontSize.t28, fontWeight: fontWeight.bold, fontVariant: [...tabularNums.fontVariant] },
  energyUnit: { fontSize: fontSize.t14, fontWeight: fontWeight.medium, color: colors.muted },
  ingredient: { gap: spacing.s8, paddingVertical: spacing.s12, borderBottomWidth: 1, borderBottomColor: colors.border },
  amountButton: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.s8 },
  searchResult: { gap: spacing.s8, padding: spacing.s12, backgroundColor: colors.raised, borderRadius: radius.r12 },
});
