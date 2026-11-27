import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { hapticSelection } from '../../haptics';
import { colors, fontFace, macroColors, radius, tabularNums } from '../../tokens';
import { InlineKeypad, LearnedPortionChips, MealDestinationPills } from '../doop';
import { DoopIcon } from '../DoopIcons';
import { number, toCanonicalKcal } from '../primitives';
import { customFoodNutrientFields, type CustomFoodBasis } from './customFoodForm';

export type { CustomFoodBasis };

export interface SegmentedSwitchOption { value: string; label: string }
export interface SegmentedSwitchProps { options: SegmentedSwitchOption[]; value: string; onChange: (value: string) => void; disabled?: boolean | undefined }
export function SegmentedSwitch({ options, value, onChange, disabled = false }: SegmentedSwitchProps) {
  return <View style={styles.switchTrack} accessibilityRole="radiogroup">{options.map(option => <Pressable key={option.value} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: option.value === value, disabled }} onPress={() => { if (option.value !== value) hapticSelection(); onChange(option.value); }} style={[styles.switchPill, option.value === value && { backgroundColor: colors.accent }, disabled && { opacity: 0.5 }]}><Text numberOfLines={1} style={[styles.switchText, option.value === value && { color: colors.onAccent }]}>{option.label}</Text></Pressable>)}</View>;
}
export const BarSeg = SegmentedSwitch;
export type BarSegProps = SegmentedSwitchProps;
export interface BarcodePortion { label: string; subLabel?: string | undefined; energyText: string; proteinG: number; carbsG: number; fatG: number }
export interface BarcodeFoundCardProps {
  name: string; brand?: string | null | undefined; sourceLabel: string; basisSummary: string; portions: BarcodePortion[];
  selectedIndex: number; onSelectPortion: (index: number) => void; mealLabel: string; onConfirm: () => void; onRescan: () => void; busy?: boolean | undefined;
  meals?: string[] | undefined; onConfirmMeal?: ((meal: string) => void) | undefined; onMore?: (() => void) | undefined;
  loggedMeal?: string | null | undefined; onUndo?: (() => void) | undefined;
}
function Macros({ portion }: { portion: BarcodePortion }) {
  return <View style={styles.macros}><Text style={[styles.macro, { color: macroColors.protein }]}>P {number(portion.proteinG)}</Text><Text style={styles.dot}>·</Text><Text style={[styles.macro, { color: macroColors.carbs }]}>C {number(portion.carbsG)}</Text><Text style={styles.dot}>·</Text><Text style={[styles.macro, { color: macroColors.fat }]}>F {number(portion.fatG)}</Text><Text style={styles.portionKcal}>{portion.energyText}</Text></View>;
}
export function BarcodeFoundCard(props: BarcodeFoundCardProps) {
  const portion = props.portions[props.selectedIndex] ?? props.portions[0];
  return <View style={[styles.card, { borderColor: colors.border }]}>
    {(['tl', 'tr', 'bl', 'br'] as const).map(corner => <View key={corner} pointerEvents="none" style={[styles.corner, corner[0] === 't' ? { top: -5, borderTopWidth: 2 } : { bottom: -5, borderBottomWidth: 2 }, corner[1] === 'l' ? { left: -5, borderLeftWidth: 2 } : { right: -5, borderRightWidth: 2 }]} />)}
    <Text numberOfLines={2} style={styles.title}>{props.name}{props.brand ? <Text style={styles.brand}> · {props.brand}</Text> : null}</Text>
    <Text style={styles.note}>{props.sourceLabel} · {props.basisSummary}</Text>
    <LearnedPortionChips
      portions={props.portions.slice(0, 3).map((item, index) => ({
        label: item.label,
        energyLabel: `${item.subLabel ? `${item.subLabel} · ` : ''}${item.energyText.replace(/ (kcal|kJ)$/, '')}`,
        selected: props.selectedIndex === index,
      }))}
      disabled={props.busy || !!props.loggedMeal}
      onSelect={props.onSelectPortion}
      onMore={props.onMore}
      style={{ marginTop: 4 }}
    />
    {portion && <><Macros portion={portion} /><Text style={[styles.note, { fontSize: 10, opacity: 0.66 }]}>per {portion.label}</Text></>}
    <MealDestinationPills
      meals={props.meals ?? ['Breakfast', 'Lunch', 'Snack', 'Dinner']}
      selectedMeals={props.loggedMeal ? [props.loggedMeal] : []}
      disabled={props.busy || !!props.loggedMeal}
      mode="log"
      onPress={meal => props.onConfirmMeal ? props.onConfirmMeal(meal) : props.onConfirm()}
      style={{ marginTop: 4 }}
    />
    {props.loggedMeal && <View style={styles.receipt}><DoopIcon name="check" size={13} color={colors.mint} /><Text style={styles.receiptText}>{props.loggedMeal} · {portion?.energyText.replace(/ (kcal|kJ)$/, '')}</Text><Pressable accessibilityRole="button" disabled={props.busy} onPress={props.onUndo} style={styles.undo}><Text style={styles.undoText}>Undo</Text></Pressable></View>}
  </View>;
}
export interface BarcodeNotFoundCardProps { code: string; liveLookupNote?: string | null | undefined; canReadLabelWithAI?: boolean | undefined; onCreateCustom: () => void; onReadLabelWithAI?: (() => void) | undefined; onTypeAgain: () => void }
export function BarcodeNotFoundCard({ code, liveLookupNote, onCreateCustom, onReadLabelWithAI, canReadLabelWithAI }: BarcodeNotFoundCardProps) {
  const [details, setDetails] = useState(false);
  return <View style={[styles.card, { borderColor: colors.border }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`No match for ${code}. Lookup details`} onPress={() => setDetails(open => !open)} style={styles.notFoundHead}><DoopIcon name="search" size={15} color={colors.muted} /><Text style={styles.notFoundText}>No match for <Text style={fontFace('bold')}>{code}</Text></Text></Pressable>
    {details && !!liveLookupNote && <Text style={styles.note}>{liveLookupNote}</Text>}
    <Pressable accessibilityRole="button" onPress={onCreateCustom} style={styles.primary}><Text style={styles.primaryText}>Create food</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={onReadLabelWithAI} disabled={!onReadLabelWithAI} style={styles.quiet}><Text style={[styles.note, { opacity: 0.6 }]}>{canReadLabelWithAI ? 'Photo of label' : 'Photo of label · needs ChatGPT'}</Text></Pressable>
  </View>;
}
export interface CustomFoodFormValues {
  name: string; brand: string; basis: CustomFoodBasis; servingAmount: string;
  /** Canonical kcal; empty nutrients remain unknown. */
  kcal: string; proteinG: string; carbsG: string; fatG: string; fiberG: string; sugarG: string;
  logMultiplier?: number;
}
export interface CustomFoodFormCardProps {
  initialBarcode?: string | null | undefined; initialValues?: Partial<CustomFoodFormValues> | undefined; energyUnit?: 'kcal' | 'kJ' | undefined;
  onSaveAndLog: (values: CustomFoodFormValues, meal?: string) => void; onSaveOnly: (values: CustomFoodFormValues) => void;
  onCancel?: (() => void) | undefined; busy?: boolean | undefined; meals?: string[] | undefined;
  loggedMeal?: string | null | undefined; receiptEnergy?: string | undefined; onUndo?: (() => void) | undefined;
}
type Editable = 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG' | 'sugarG' | 'servingAmount';
export function CustomFoodFormCard({ initialBarcode, initialValues, energyUnit = 'kcal', onSaveAndLog, onSaveOnly, busy, meals, loggedMeal, receiptEnergy, onUndo }: CustomFoodFormCardProps) {
  const [values, setValues] = useState<CustomFoodFormValues>(() => ({ name: initialValues?.name ?? '', brand: initialValues?.brand ?? '', basis: initialValues?.basis ?? 'per_100g', servingAmount: initialValues?.servingAmount ?? '', kcal: initialValues?.kcal ?? '', proteinG: initialValues?.proteinG ?? '', carbsG: initialValues?.carbsG ?? '', fatG: initialValues?.fatG ?? '', fiberG: initialValues?.fiberG ?? '', sugarG: initialValues?.sugarG ?? '' }));
  const [active, setActive] = useState<Editable | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [brandOpen, setBrandOpen] = useState(!!initialValues?.brand);
  const submit = (handler: (next: CustomFoodFormValues) => void) => {
    if (!values.name.trim() || busy) return;
    const rawEnergy = Number(values.kcal.trim());
    const canonicalKcal = values.kcal.trim() && Number.isFinite(rawEnergy)
      ? String(toCanonicalKcal(rawEnergy, energyUnit))
      : values.kcal;
    handler({ ...values, name: values.name.trim(), logMultiplier: multiplier, kcal: canonicalKcal });
  };
  const fields = customFoodNutrientFields(energyUnit, true);
  return <View style={styles.card}>
    <View style={styles.formHead}><Text style={styles.title}>New food</Text><Pressable accessibilityRole="button" accessibilityLabel="Edit food brand" onPress={() => setBrandOpen(open => !open)} style={styles.source}><DoopIcon name="user" size={11} color={colors.muted} /><Text style={styles.sourceText}>You entered</Text></Pressable></View>
    <View style={styles.field}><Text style={styles.fieldLabel}>NAME</Text><TextInput accessibilityLabel="Food name" value={values.name} onChangeText={name => setValues(old => ({ ...old, name }))} editable={!busy && !loggedMeal} placeholder="Food name" placeholderTextColor={colors.muted} style={styles.input} /></View>
    {brandOpen && <View style={styles.field}><Text style={styles.fieldLabel}>BRAND</Text><TextInput accessibilityLabel="Brand" value={values.brand} onChangeText={brand => setValues(old => ({ ...old, brand }))} editable={!busy && !loggedMeal} placeholder="Optional" placeholderTextColor={colors.muted} style={styles.input} /></View>}
    {!!initialBarcode && <View style={styles.field}><Text style={styles.fieldLabel}>BARCODE</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={styles.inputText}>{initialBarcode}</Text><DoopIcon name="link" size={13} color={colors.muted} /></View></View>}
    <View style={styles.basisRow}><Text style={styles.fieldLabel}>BASIS</Text><View style={{ flex: 1, maxWidth: 240 }}><SegmentedSwitch options={[{ value: values.basis === 'per_100ml' ? 'per_100ml' : 'per_100g', label: values.basis === 'per_100ml' ? 'per 100 ml' : 'per 100 g' }, { value: 'per_serving', label: 'per serving' }]} value={values.basis} disabled={busy || !!loggedMeal} onChange={basis => setValues(old => ({ ...old, basis: basis as CustomFoodBasis }))} /></View></View>
    <Pressable accessibilityRole="button" disabled={busy || !!loggedMeal} accessibilityLabel="Change gram or volume basis" onPress={() => setValues(old => ({ ...old, basis: old.basis === 'per_100ml' ? 'per_100g' : 'per_100ml' }))} style={{ alignSelf: 'flex-end' }}><Text style={[styles.note, { fontSize: 10 }]}>Use {values.basis === 'per_100ml' ? 'grams' : 'millilitres'}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy || !!loggedMeal} onPress={() => setActive(current => current === 'servingAmount' ? null : 'servingAmount')} style={styles.field}><Text style={styles.fieldLabel}>SERVING</Text><Text style={styles.inputText}>{values.servingAmount ? `1 serving = ${values.servingAmount} ${values.basis === 'per_100ml' ? 'ml' : 'g'}` : 'Set serving size (optional)'}</Text></Pressable>
    <View style={styles.nutrientGrid}>{fields.map(field => <Pressable key={field.key} accessibilityRole="button" accessibilityLabel={`${field.label}, ${values[field.key] || 'unknown'}`} disabled={busy || !!loggedMeal} onPress={() => setActive(current => current === field.key ? null : field.key)} style={[styles.nutrient, active === field.key && { borderColor: colors.accent }]}>
      <Text style={styles.fieldLabel}>{field.label.toUpperCase()}</Text><Text style={[styles.nutrientValue, !values[field.key] && styles.unknown]}>{values[field.key] || 'unknown'}{values[field.key] ? <Text style={styles.unit}> {field.unit}</Text> : null}</Text>
    </Pressable>)}</View>
    {active && <View style={{ gap: 4 }}><InlineKeypad bare showReadout={false} allowEmpty value={values[active]} onChange={next => setValues(old => ({ ...old, [active]: next }))} maxDecimals={active === 'kcal' ? 1 : 2} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Pressable accessibilityRole="button" onPress={() => { setValues(old => ({ ...old, [active]: '' })); setActive(null); }} style={styles.quiet}><Text style={styles.note}>Clear</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setActive(null)} style={styles.quiet}><Text style={styles.undoText}>Done</Text></Pressable></View></View>}
    <LearnedPortionChips
      portions={[1, 2].map(value => ({
        label: `${value} serving${value === 1 ? '' : 's'}`,
        energyLabel: values.servingAmount ? `${Number(values.servingAmount) * value} ${values.basis === 'per_100ml' ? 'ml' : 'g'}` : values.basis === 'per_serving' ? `${value} × serving` : `${100 * value} ${values.basis === 'per_100ml' ? 'ml' : 'g'}`,
        selected: multiplier === value,
      }))}
      disabled={busy || !!loggedMeal}
      onSelect={index => setMultiplier(index + 1)}
      style={{ marginTop: 4 }}
    />
    <MealDestinationPills
      meals={meals ?? ['Breakfast', 'Lunch', 'Snack', 'Dinner']}
      selectedMeals={loggedMeal ? [loggedMeal] : []}
      disabled={busy || !!loggedMeal || !values.name.trim()}
      mode="log"
      onPress={meal => submit(next => onSaveAndLog(next, meal))}
      style={{ marginTop: 4 }}
    />
    {loggedMeal && <View accessibilityLiveRegion="polite" style={styles.receipt}><DoopIcon name="check" size={13} color={colors.mint} /><Text style={styles.receiptText}>{loggedMeal} · {receiptEnergy}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={onUndo} style={styles.undo}><Text style={styles.undoText}>Undo</Text></Pressable></View>}
    {!loggedMeal && <Pressable accessibilityRole="button" disabled={busy || !values.name.trim()} onPress={() => submit(onSaveOnly)} style={[styles.quiet, { alignSelf: 'flex-start' }]}><Text style={[styles.note, { textDecorationLine: 'underline' }]}>Save without logging</Text></Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  switchTrack: { flexDirection: 'row', height: 44, padding: 3, gap: 2, borderRadius: radius.full, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground },
  switchPill: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full }, switchText: { ...fontFace('semibold'), fontSize: 12, color: colors.muted },
  card: { padding: 16, gap: 8, borderRadius: radius.r16, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface, width: '100%', maxWidth: 430, alignSelf: 'center' },
  title: { ...fontFace('bold'), color: colors.ink, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 }, brand: { ...fontFace('semibold'), color: colors.muted, fontSize: 12 },
  note: { ...fontFace(), color: colors.muted, fontSize: 11, lineHeight: 15, opacity: 0.86 }, corner: { position: 'absolute', width: 12, height: 14, borderColor: colors.accent, borderRadius: 4 },
  macros: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 }, macro: { ...fontFace('semibold'), ...tabularNums, fontSize: 12 }, dot: { color: colors.muted, opacity: 0.6, fontSize: 10 }, portionKcal: { ...fontFace('bold'), ...tabularNums, color: colors.ink, fontSize: 13, marginLeft: 'auto' },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline, marginTop: 2 }, receiptText: { ...fontFace('bold'), ...tabularNums, color: colors.ink, fontSize: 12, flex: 1 }, undo: { minHeight: 40, minWidth: 44, alignItems: 'center', justifyContent: 'center' }, undoText: { ...fontFace('semibold'), color: colors.accent, fontSize: 11 },
  primary: { minHeight: 44, borderRadius: radius.r12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, primaryText: { ...fontFace('bold'), color: colors.onAccent, fontSize: 14 }, quiet: { minHeight: 40, justifyContent: 'center', alignItems: 'center' },
  notFoundHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 26 }, notFoundText: { ...fontFace('semibold'), fontSize: 14, color: colors.ink, flex: 1 },
  formHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 }, source: { height: 24, paddingHorizontal: 8, flexDirection: 'row', gap: 5, alignItems: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.hairline }, sourceText: { ...fontFace('semibold'), fontSize: 10, color: colors.muted },
  field: { minHeight: 44, paddingBottom: 6, borderBottomWidth: 1, borderColor: colors.hairline, justifyContent: 'center', gap: 1 }, fieldLabel: { ...fontFace('semibold'), color: colors.muted, opacity: 0.72, fontSize: 10, letterSpacing: 0.5 },
  input: { ...fontFace('semibold'), color: colors.ink, fontSize: 14, padding: 0, minHeight: 24 }, inputText: { ...fontFace('semibold'), ...tabularNums, color: colors.ink, fontSize: 14 }, basisRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', minHeight: 44 },
  nutrientGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, nutrient: { width: '32.4%', minHeight: 46, borderRadius: radius.r12, paddingHorizontal: 9, justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground }, nutrientValue: { ...fontFace('bold'), ...tabularNums, color: colors.ink, fontSize: 16 }, unknown: { ...fontFace('semibold'), color: colors.muted, opacity: 0.62, fontSize: 11 }, unit: { ...fontFace('semibold'), color: colors.muted, fontSize: 10 },
});
