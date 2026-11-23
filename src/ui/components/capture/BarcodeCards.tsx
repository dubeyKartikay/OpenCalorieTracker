import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  colors,
  fontSize,
  fontWeight,
  macroColors,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';
import { InlineKeypad, MacroProportionBar, SourceBadge } from '../doop';

export interface SegmentedSwitchOption {
  value: string;
  label: string;
}

export interface SegmentedSwitchProps {
  options: SegmentedSwitchOption[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Two-to-three way switch on a single raised track. The active pill fills with
 * the accent so the choice is legible without a second colour or a shadow.
 */
export function SegmentedSwitch({ options, value, onChange }: SegmentedSwitchProps) {
  return (
    <View style={styles.switchTrack} accessibilityRole="radiogroup">
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.switchPill,
              selected && styles.switchPillSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.switchLabel, selected && styles.switchLabelSelected]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Doop design-system alias. */
export const BarSeg = SegmentedSwitch;
export type BarSegProps = SegmentedSwitchProps;

export interface BarcodePortion {
  label: string;
  subLabel?: string | undefined;
  energyText: string;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface BarcodeFoundCardProps {
  name: string;
  brand?: string | null | undefined;
  sourceLabel: string;
  basisSummary: string;
  portions: BarcodePortion[];
  selectedIndex: number;
  onSelectPortion: (index: number) => void;
  mealLabel: string;
  onConfirm: () => void;
  onRescan: () => void;
  busy?: boolean | undefined;
}

function formatGrams(grams: number): string {
  if (!Number.isFinite(grams)) return '—';
  const rounded = Math.round(grams * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function MacroPill({
  letter,
  label,
  grams,
  color,
}: {
  letter: string;
  label: string;
  grams: number;
  color: string;
}) {
  const value = formatGrams(grams);
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${value} grams`}
      style={[styles.macroPill, { borderColor: color }]}
    >
      <Text style={[styles.macroLetter, { color }]}>{letter}</Text>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroUnit}>g</Text>
    </View>
  );
}

/**
 * Resolved barcode product. Product identity is read once at the top; the
 * choice below is purely about how much of it is going into the meal, so each
 * portion chip carries its own energy and the selected one repeats its macros.
 */
export function BarcodeFoundCard({
  name,
  brand,
  sourceLabel,
  basisSummary,
  portions,
  selectedIndex,
  onSelectPortion,
  mealLabel,
  onConfirm,
  onRescan,
  busy,
}: BarcodeFoundCardProps) {
  const blocked = busy === true;
  const selected = portions[selectedIndex] ?? portions[0];
  const hasBrand = brand != null && brand !== '';

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text numberOfLines={2} style={styles.productName}>
          {name}
        </Text>
        {hasBrand ? (
          <Text numberOfLines={1} style={styles.productBrand}>
            {brand}
          </Text>
        ) : null}
        <SourceBadge label={sourceLabel} />
      </View>

      <Text numberOfLines={2} style={styles.basis}>
        {basisSummary}
      </Text>

      <View style={styles.portionWrap} accessibilityRole="radiogroup" accessibilityLabel="Portion">
        {portions.map((portion, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Pressable
              key={`${portion.label}-${index}`}
              accessibilityRole="radio"
              accessibilityLabel={`${portion.label}, ${portion.energyText}`}
              accessibilityState={{ checked: isSelected }}
              onPress={() => onSelectPortion(index)}
              style={({ pressed }) => [
                styles.portionChip,
                isSelected && styles.portionChipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.portionLabel, isSelected && styles.portionLabelSelected]}
              >
                {portion.label}
              </Text>
              {portion.subLabel != null && portion.subLabel !== '' ? (
                <Text numberOfLines={1} style={styles.portionSub}>
                  {portion.subLabel}
                </Text>
              ) : null}
              <Text numberOfLines={1} style={styles.portionEnergy}>
                {portion.energyText}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {selected != null ? (
        <View style={styles.selectedBlock}>
          <View style={styles.selectedHead}>
            <Text style={styles.selectedCaption}>Selected portion</Text>
            <Text numberOfLines={1} style={styles.selectedEnergy}>
              {selected.energyText}
            </Text>
          </View>
          <MacroProportionBar
            proteinG={selected.proteinG}
            carbsG={selected.carbsG}
            fatG={selected.fatG}
          />
          <View style={styles.macroPills}>
            <MacroPill
              letter="P"
              label="Protein"
              grams={selected.proteinG}
              color={macroColors.protein}
            />
            <MacroPill letter="C" label="Carbs" grams={selected.carbsG} color={macroColors.carbs} />
            <MacroPill letter="F" label="Fat" grams={selected.fatG} color={macroColors.fat} />
          </View>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add to ${mealLabel}`}
        accessibilityState={{ disabled: blocked, busy: blocked }}
        disabled={blocked}
        onPress={onConfirm}
        style={({ pressed }) => [
          styles.primaryButton,
          blocked && styles.primaryButtonDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryLabel}>{`Add to ${mealLabel}`}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan another"
        disabled={blocked}
        onPress={onRescan}
        style={({ pressed }) => [styles.quietButton, pressed && styles.pressed]}
      >
        <Text style={styles.quietLabel}>Scan another</Text>
      </Pressable>
    </View>
  );
}

export interface BarcodeNotFoundCardProps {
  code: string;
  liveLookupNote?: string | null | undefined;
  canReadLabelWithAI?: boolean | undefined;
  onCreateCustom: () => void;
  onReadLabelWithAI?: (() => void) | undefined;
  onTypeAgain: () => void;
}

/**
 * Dead-end recovery for an unknown barcode. The code is repeated so the user
 * can check it against the packet, and the way forward is to create the food
 * once rather than to scan the same thing again.
 */
export function BarcodeNotFoundCard({
  code,
  liveLookupNote,
  canReadLabelWithAI,
  onCreateCustom,
  onReadLabelWithAI,
  onTypeAgain,
}: BarcodeNotFoundCardProps) {
  const hasNote = liveLookupNote != null && liveLookupNote !== '';
  const showAI = canReadLabelWithAI === true && onReadLabelWithAI != null;

  return (
    <View style={styles.card}>
      <Text accessibilityLabel={`No match for ${code}`} style={styles.notFoundTitle}>
        {'No match for '}
        <Text style={styles.notFoundCode}>{code}</Text>
      </Text>

      {hasNote ? <Text style={styles.notFoundNote}>{liveLookupNote}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create custom food"
        onPress={onCreateCustom}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
      >
        <Text style={styles.primaryLabel}>Create custom food</Text>
      </Pressable>

      {showAI && onReadLabelWithAI != null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Read nutrition label with AI"
          onPress={onReadLabelWithAI}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryLabel}>Read nutrition label (AI)</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Type another barcode"
        onPress={onTypeAgain}
        style={({ pressed }) => [styles.quietButton, pressed && styles.pressed]}
      >
        <Text style={styles.quietLabel}>Type another barcode</Text>
      </Pressable>
    </View>
  );
}

export type CustomFoodBasis = 'per_100g' | 'per_100ml' | 'per_serving';

export interface CustomFoodFormValues {
  name: string;
  brand: string;
  basis: CustomFoodBasis;
  /** Serving size in grams; only read when `basis` is `per_serving`. */
  servingAmount: string;
  /** Canonical kcal: a kJ entry is converted before the callbacks fire. */
  kcal: string;
  /** Empty string means unknown. Never coerce a blank nutrient to 0. */
  proteinG: string;
  /** Empty string means unknown. Never coerce a blank nutrient to 0. */
  carbsG: string;
  /** Empty string means unknown. Never coerce a blank nutrient to 0. */
  fatG: string;
  /** Empty string means unknown. Never coerce a blank nutrient to 0. */
  fiberG: string;
  /** Empty string means unknown. Never coerce a blank nutrient to 0. */
  sugarG: string;
}

export interface CustomFoodFormCardProps {
  initialBarcode?: string | null | undefined;
  initialValues?: Partial<CustomFoodFormValues> | undefined;
  energyUnit?: 'kcal' | 'kJ' | undefined;
  onSaveAndLog: (values: CustomFoodFormValues) => void;
  onSaveOnly: (values: CustomFoodFormValues) => void;
  onCancel?: (() => void) | undefined;
  busy?: boolean | undefined;
}

type NutrientField = 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG' | 'sugarG';
type EditableField = NutrientField | 'servingAmount';

interface NutrientSpec {
  field: NutrientField;
  label: string;
  unit: string;
}

interface BarNutrientProps {
  label: string;
  value: string;
  unit: string;
  active: boolean;
  onPress: () => void;
}

/**
 * One editable nutrient cell. A blank field renders an em dash rather than a
 * zero, because unknown and zero are different facts about a food label.
 */
function BarNutrient({ label, value, unit, active, onPress }: BarNutrientProps) {
  const empty = value.trim() === '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${empty ? 'empty' : `${value} ${unit}`}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.nutrientCell,
        active && styles.nutrientCellActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.nutrientLabel}>{label}</Text>
      <View style={styles.nutrientValueRow}>
        <Text numberOfLines={1} style={[styles.nutrientValue, empty && styles.nutrientValueEmpty]}>
          {empty ? '—' : value}
        </Text>
        {empty ? null : <Text style={styles.nutrientUnit}>{unit}</Text>}
      </View>
    </Pressable>
  );
}

/** Two cells per row, energy first so the headline number is the first target. */
const NUTRIENT_ROWS: readonly (readonly NutrientSpec[])[] = [
  [
    { field: 'kcal', label: 'Energy', unit: '' },
    { field: 'proteinG', label: 'Protein', unit: 'g' },
  ],
  [
    { field: 'carbsG', label: 'Carbs', unit: 'g' },
    { field: 'fatG', label: 'Fat', unit: 'g' },
  ],
  [
    { field: 'fiberG', label: 'Fiber', unit: 'g' },
    { field: 'sugarG', label: 'Sugar', unit: 'g' },
  ],
];

const FIELD_DECIMALS: Record<EditableField, number> = {
  kcal: 0,
  proteinG: 1,
  carbsG: 1,
  fatG: 1,
  fiberG: 2,
  sugarG: 2,
  servingAmount: 2,
};

const BASIS_OPTIONS: SegmentedSwitchOption[] = [
  { value: 'per_100g', label: 'per 100 g' },
  { value: 'per_100ml', label: 'per 100 ml' },
  { value: 'per_serving', label: 'per serving' },
];

const KCAL_TO_KJ = 4.184;

function isBasis(value: string): value is CustomFoodBasis {
  return value === 'per_100g' || value === 'per_100ml' || value === 'per_serving';
}

/** Replace exactly one field, keeping the rest of the form untouched. */
function applyFieldValue(
  values: CustomFoodFormValues,
  field: EditableField,
  next: string,
): CustomFoodFormValues {
  switch (field) {
    case 'kcal':
      return { ...values, kcal: next };
    case 'proteinG':
      return { ...values, proteinG: next };
    case 'carbsG':
      return { ...values, carbsG: next };
    case 'fatG':
      return { ...values, fatG: next };
    case 'fiberG':
      return { ...values, fiberG: next };
    case 'sugarG':
      return { ...values, sugarG: next };
    case 'servingAmount':
      return { ...values, servingAmount: next };
  }
}

/**
 * One-off custom food, either from a barcode that had no match or from a blank
 * label. Blank nutrients stay blank on the way out: a missing value is unknown,
 * which is not the same as zero, so the cells show an em dash and the caller
 * receives an empty string to map to null.
 *
 * The form seeds from `initialValues` once, on mount, so typed values are never
 * clobbered by a parent re-render. Mount a fresh instance with a new `key` when
 * a different barcode or food should be pre-filled.
 */
export function CustomFoodFormCard({
  initialBarcode,
  initialValues,
  energyUnit = 'kcal',
  onSaveAndLog,
  onSaveOnly,
  onCancel,
  busy,
}: CustomFoodFormCardProps) {
  const [values, setValues] = useState<CustomFoodFormValues>(() => ({
    name: initialValues?.name ?? '',
    brand: initialValues?.brand ?? '',
    basis: initialValues?.basis ?? 'per_100g',
    servingAmount: initialValues?.servingAmount ?? '',
    kcal: initialValues?.kcal ?? '',
    proteinG: initialValues?.proteinG ?? '',
    carbsG: initialValues?.carbsG ?? '',
    fatG: initialValues?.fatG ?? '',
    fiberG: initialValues?.fiberG ?? '',
    sugarG: initialValues?.sugarG ?? '',
  }));
  const [activeField, setActiveField] = useState<EditableField | null>('kcal');

  const blocked = busy === true;
  const trimmedName = values.name.trim();
  const canSubmit = trimmedName !== '' && !blocked;
  const barcode = initialBarcode != null && initialBarcode !== '' ? initialBarcode : null;

  const setActiveValue = (next: string) => {
    if (activeField == null) return;
    const field = activeField;
    setValues(current => applyFieldValue(current, field, next));
  };

  const toggleField = (field: EditableField) => {
    setActiveField(current => (current === field ? null : field));
  };

  const submit = (handler: (next: CustomFoodFormValues) => void) => {
    if (!canSubmit) return;
    const energy = values.kcal.trim();
    let kcal = energy;
    if (energyUnit === 'kJ' && energy !== '') {
      const energyValue = Number(energy);
      if (Number.isFinite(energyValue)) {
        kcal = String(Math.round((energyValue / KCAL_TO_KJ) * 10) / 10);
      }
    }
    handler({ ...values, name: trimmedName, kcal });
  };

  const renderNutrientCell = (spec: NutrientSpec) => (
    <BarNutrient
      key={spec.field}
      label={spec.label}
      value={values[spec.field]}
      unit={spec.field === 'kcal' ? energyUnit : spec.unit}
      active={activeField === spec.field}
      onPress={() => toggleField(spec.field)}
    />
  );

  return (
    <View style={styles.card}>
      <View style={styles.formHead}>
        <Text style={styles.formTitle}>Custom food</Text>
        {onCancel != null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel custom food"
            hitSlop={4}
            onPress={onCancel}
            style={({ pressed }) => [styles.formCancel, pressed && styles.pressed]}
          >
            <Text style={styles.formCancelGlyph}>×</Text>
          </Pressable>
        ) : null}
      </View>

      {barcode != null ? (
        <View style={styles.barcodePill}>
          <Text style={styles.barcodeLabel}>Barcode</Text>
          <Text numberOfLines={1} style={styles.barcodeValue}>
            {barcode}
          </Text>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          accessibilityLabel="Food name"
          autoCapitalize="words"
          onChangeText={text => setValues(current => ({ ...current, name: text }))}
          placeholder="Food name"
          placeholderTextColor={colors.muted}
          style={styles.textInput}
          value={values.name}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Brand</Text>
        <TextInput
          accessibilityLabel="Brand"
          autoCapitalize="words"
          onChangeText={text => setValues(current => ({ ...current, brand: text }))}
          placeholder="Optional"
          placeholderTextColor={colors.muted}
          style={styles.textInput}
          value={values.brand}
        />
      </View>

      <SegmentedSwitch
        options={BASIS_OPTIONS}
        value={values.basis}
        onChange={next => {
          if (isBasis(next)) setValues(current => ({ ...current, basis: next }));
        }}
      />

      {values.basis === 'per_serving' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            values.servingAmount.trim() === ''
              ? 'Serving size, empty'
              : `Serving size, ${values.servingAmount} grams`
          }
          accessibilityState={{ selected: activeField === 'servingAmount' }}
          onPress={() => toggleField('servingAmount')}
          style={({ pressed }) => [
            styles.servingRow,
            activeField === 'servingAmount' && styles.nutrientCellActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.servingLabel}>Serving size</Text>
          <View style={styles.nutrientValueRow}>
            <Text
              style={[
                styles.servingValue,
                values.servingAmount.trim() === '' && styles.nutrientValueEmpty,
              ]}
            >
              {values.servingAmount.trim() === '' ? '—' : values.servingAmount}
            </Text>
            {values.servingAmount.trim() === '' ? null : (
              <Text style={styles.nutrientUnit}>g</Text>
            )}
          </View>
        </Pressable>
      ) : null}

      <View style={styles.nutrientGrid}>
        {NUTRIENT_ROWS.map((row, rowIndex) => (
          <View key={`nutrient-row-${rowIndex}`} style={styles.nutrientRow}>
            {row.map(spec => renderNutrientCell(spec))}
          </View>
        ))}
      </View>

      <Text style={styles.emptyNote}>
        Blank stays unknown. A missing nutrient is saved as null, never as 0.
      </Text>

      {activeField != null ? (
        <InlineKeypad
          bare
          showReadout={false}
          value={values[activeField]}
          onChange={setActiveValue}
          maxDecimals={FIELD_DECIMALS[activeField]}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save and log"
        accessibilityState={{ disabled: !canSubmit, busy: blocked }}
        disabled={!canSubmit}
        onPress={() => submit(onSaveAndLog)}
        style={({ pressed }) => [
          styles.primaryButton,
          !canSubmit && styles.primaryButtonDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryLabel}>Save & log</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save without logging"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={() => submit(onSaveOnly)}
        style={({ pressed }) => [styles.quietButton, pressed && styles.pressed]}
      >
        <Text style={styles.quietLabel}>Save without logging</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  switchTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    padding: spacing.s2,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  switchPill: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s10,
    borderRadius: radius.full,
  },
  switchPillSelected: {
    backgroundColor: colors.accent,
  },
  switchLabel: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  switchLabelSelected: {
    color: colors.onAccent,
    fontWeight: fontWeight.bold,
  },
  card: {
    gap: spacing.s12,
    padding: spacing.s12,
    borderRadius: radius.r16,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  head: {
    gap: spacing.s4,
  },
  productName: {
    color: colors.ink,
    fontSize: fontSize.t18,
    fontWeight: fontWeight.bold,
  },
  productBrand: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  basis: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  portionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: spacing.s6,
  },
  portionChip: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: 96,
    maxWidth: 200,
    justifyContent: 'center',
    gap: spacing.s2,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s8,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  portionChipSelected: {
    borderColor: colors.accent,
  },
  portionLabel: {
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  portionLabelSelected: {
    color: colors.accent,
  },
  portionSub: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  portionEnergy: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  selectedBlock: {
    gap: spacing.s8,
    padding: spacing.s10,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  selectedHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.s8,
  },
  selectedCaption: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.4,
  },
  selectedEnergy: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.bold,
    fontVariant: [...tabularNums.fontVariant],
  },
  macroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.s6,
  },
  macroPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s4,
    paddingHorizontal: spacing.s8,
    paddingVertical: spacing.s4,
    borderRadius: radius.full,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  macroLetter: {
    fontSize: fontSize.t10,
    fontWeight: fontWeight.bold,
  },
  macroValue: {
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  macroUnit: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s16,
    paddingVertical: spacing.s10,
    borderRadius: radius.r12,
    backgroundColor: colors.accent,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryLabel: {
    color: colors.onAccent,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.bold,
  },
  secondaryButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s16,
    paddingVertical: spacing.s10,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  secondaryLabel: {
    color: colors.accent,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
  },
  quietButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s12,
    borderRadius: radius.r12,
  },
  quietLabel: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  notFoundTitle: {
    color: colors.ink,
    fontSize: fontSize.t16,
    fontWeight: fontWeight.semibold,
  },
  notFoundCode: {
    color: colors.lavender,
    fontWeight: fontWeight.bold,
    fontVariant: [...tabularNums.fontVariant],
  },
  notFoundNote: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  formHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s8,
  },
  formTitle: {
    color: colors.ink,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
  },
  formCancel: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  formCancelGlyph: {
    color: colors.muted,
    fontSize: fontSize.t18,
    fontWeight: fontWeight.semibold,
  },
  barcodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.s8,
    maxWidth: '100%',
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  barcodeLabel: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  barcodeValue: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  field: {
    gap: spacing.s6,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.semibold,
  },
  textInput: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
    color: colors.ink,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.medium,
  },
  servingRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s12,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s8,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  servingLabel: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  servingValue: {
    color: colors.ink,
    fontSize: fontSize.t16,
    fontWeight: fontWeight.bold,
    fontVariant: [...tabularNums.fontVariant],
  },
  nutrientGrid: {
    gap: spacing.s6,
  },
  nutrientRow: {
    flexDirection: 'row',
    gap: spacing.s6,
  },
  nutrientCell: {
    flex: 1,
    minHeight: 56,
    minWidth: 0,
    justifyContent: 'center',
    gap: spacing.s2,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s8,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  nutrientCellActive: {
    borderColor: colors.accent,
  },
  nutrientLabel: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.semibold,
  },
  nutrientValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s4,
  },
  nutrientValue: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSize.t16,
    fontWeight: fontWeight.bold,
    fontVariant: [...tabularNums.fontVariant],
  },
  nutrientValueEmpty: {
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  nutrientUnit: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
  },
  emptyNote: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
  },
  pressed: { opacity: 0.7 },
});
