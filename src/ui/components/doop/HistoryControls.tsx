import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
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
import { InlineKeypad } from './InlineKeypad';

type SelectActionTone = 'default' | 'danger' | 'primary';

function SelectAction({
  label,
  onPress,
  tone = 'default',
}: {
  label: string;
  onPress: () => void;
  tone?: SelectActionTone | undefined;
}) {
  const primary = tone === 'primary';
  const danger = tone === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectAction,
        primary && styles.selectActionPrimary,
        danger && styles.selectActionDanger,
        pressed && styles.pressed,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.selectActionLabel,
          primary && styles.selectActionLabelPrimary,
          danger && styles.selectActionLabelDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface MultiSelectBarProps {
  count: number;
  onCopyToToday: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDone: () => void;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Floating pill bar that takes over from bottom navigation during selection. */
export function MultiSelectBar({
  count,
  onCopyToToday,
  onMove,
  onDelete,
  onDone,
  style,
}: MultiSelectBarProps) {
  return (
    <View style={[styles.selectBar, style]}>
      <Text accessibilityLiveRegion="polite" style={styles.selectCount}>
        {`${count} selected`}
      </Text>
      <View style={styles.selectActions}>
        <SelectAction label="Copy to Today" onPress={onCopyToToday} />
        <SelectAction label="Move" onPress={onMove} />
        <SelectAction label="Delete" onPress={onDelete} tone="danger" />
        <SelectAction label="Done" onPress={onDone} tone="primary" />
      </View>
    </View>
  );
}

/** Doop design-system alias. */
export const RailSelectBar = MultiSelectBar;
export type RailSelectBarProps = MultiSelectBarProps;

export type ActionSheetTone = 'default' | 'danger';

export interface ActionSheetPopoverAction {
  key: string;
  label: string;
  onPress: () => void;
  tone?: ActionSheetTone | undefined;
  selected?: boolean | undefined;
}

export interface ActionSheetPopoverProps {
  title?: string | undefined;
  subtitle?: string | undefined;
  actions: ActionSheetPopoverAction[];
  style?: StyleProp<ViewStyle> | undefined;
}

/** Compact anchored menu with hairline dividers and 44px action rows. */
export function ActionSheetPopover({
  title,
  subtitle,
  actions,
  style,
}: ActionSheetPopoverProps) {
  return (
    <View style={[styles.sheet, style]}>
      {title != null || subtitle != null ? (
        <View style={styles.sheetHead}>
          {title != null ? <Text style={styles.sheetTitle}>{title}</Text> : null}
          {subtitle != null ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {actions.map((action, index) => {
        const selected = action.selected === true;
        const danger = action.tone === 'danger';
        return (
          <View key={action.key}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={action.selected === undefined ? undefined : { selected }}
              onPress={action.onPress}
              style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.sheetActionLabel,
                  danger && styles.sheetActionDanger,
                  selected && styles.sheetActionSelected,
                ]}
              >
                {action.label}
              </Text>
              <Text style={[styles.sheetGlyph, selected && styles.sheetGlyphSelected]}>
                {selected ? '✓' : '›'}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

interface QuickAddValues {
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

type MacroField = 'proteinG' | 'carbsG' | 'fatG';
type QuickAddField = 'kcal' | MacroField;

const EMPTY_VALUES: QuickAddValues = { kcal: '', proteinG: '', carbsG: '', fatG: '' };

const MACRO_META: Record<MacroField, { letter: string; name: string; color: string }> = {
  proteinG: { letter: 'P', name: 'Protein', color: macroColors.protein },
  carbsG: { letter: 'C', name: 'Carbs', color: macroColors.carbs },
  fatG: { letter: 'F', name: 'Fat', color: macroColors.fat },
};

function parseEntry(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** Keep a half-typed decimal visible while grouping the integer part. */
function formatEntry(raw: string): string {
  if (raw === '') return '—';
  const dot = raw.indexOf('.');
  const whole = dot < 0 ? raw : raw.slice(0, dot);
  const fraction = dot < 0 ? '' : raw.slice(dot + 1);
  const grouped = (whole === '' ? '0' : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dot < 0 ? grouped : `${grouped}.${fraction}`;
}

const KCAL_TO_KJ = 4.184;

export interface QuickAddEntry {
  kcal: number;
  proteinG?: number | undefined;
  carbsG?: number | undefined;
  fatG?: number | undefined;
}

export interface QuickAddPanelProps {
  mealLabel: string;
  onAdd: (entry: QuickAddEntry) => void;
  energyUnit?: 'kcal' | 'kJ' | undefined;
  disabled?: boolean | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Compact inline quick add: energy first, macros optional, keypad for any field. */
export function QuickAddPanel({ mealLabel, onAdd, energyUnit = 'kcal', disabled, style }: QuickAddPanelProps) {
  const [values, setValues] = useState<QuickAddValues>(EMPTY_VALUES);
  const [activeField, setActiveField] = useState<QuickAddField>('kcal');

  const energyInput = parseEntry(values.kcal);
  const canAdd = disabled !== true && energyInput != null && energyInput > 0;

  const setActiveValue = (next: string) => {
    setValues(current => {
      if (activeField === 'kcal') return { ...current, kcal: next };
      if (activeField === 'proteinG') return { ...current, proteinG: next };
      if (activeField === 'carbsG') return { ...current, carbsG: next };
      return { ...current, fatG: next };
    });
  };

  const handleAdd = () => {
    if (!canAdd || energyInput == null || energyInput <= 0) return;
    const canonicalKcal = energyUnit === 'kJ' ? Math.round((energyInput / KCAL_TO_KJ) * 10) / 10 : energyInput;
    const entry: QuickAddEntry = { kcal: canonicalKcal };
    const protein = parseEntry(values.proteinG);
    const carbs = parseEntry(values.carbsG);
    const fat = parseEntry(values.fatG);
    if (protein != null) entry.proteinG = protein;
    if (carbs != null) entry.carbsG = carbs;
    if (fat != null) entry.fatG = fat;
    onAdd(entry);
  };

  return (
    <View style={[styles.quickCard, style]}>
      <View style={styles.quickHead}>
        <Text style={styles.cardTitle}>QUICK ADD</Text>
        <Text style={styles.quickMeal}>{mealLabel}</Text>
      </View>

      <View style={styles.quickFields}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            values.kcal === ''
              ? 'Energy, empty'
              : `Energy, ${formatEntry(values.kcal)} ${energyUnit === 'kJ' ? 'kilojoules' : 'kilocalories'}`
          }
          accessibilityState={{ selected: activeField === 'kcal' }}
          onPress={() => setActiveField('kcal')}
          style={({ pressed }) => [
            styles.kcalField,
            activeField === 'kcal' && styles.quickFieldActive,
            pressed && styles.pressed,
          ]}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.kcalValue, values.kcal === '' && styles.emptyValue]}
          >
            {formatEntry(values.kcal)}
          </Text>
          <Text style={styles.kcalUnit}>{energyUnit}</Text>
        </Pressable>

        {(['proteinG', 'carbsG', 'fatG'] as const).map(field => {
          const meta = MACRO_META[field];
          const empty = values[field] === '';
          return (
            <Pressable
              key={field}
              accessibilityRole="button"
              accessibilityLabel={
                empty ? `${meta.name}, empty` : `${meta.name}, ${formatEntry(values[field])} grams`
              }
              accessibilityState={{ selected: activeField === field }}
              onPress={() => setActiveField(field)}
              style={({ pressed }) => [
                styles.macroField,
                activeField === field && styles.quickFieldActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.macroLetter, { color: meta.color }]}>{meta.letter}</Text>
              <View style={styles.macroValueRow}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.macroValue, { color: empty ? colors.muted : meta.color }]}
                >
                  {formatEntry(values[field])}
                </Text>
                <Text style={styles.macroUnit}>g</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <InlineKeypad
        bare
        showReadout={false}
        value={values[activeField]}
        onChange={setActiveValue}
        maxDecimals={activeField === 'kcal' ? 0 : 1}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add to ${mealLabel}`}
        accessibilityState={{ disabled: !canAdd }}
        disabled={!canAdd}
        onPress={handleAdd}
        style={({ pressed }) => [
          styles.addButton,
          !canAdd && styles.addButtonDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.addButtonLabel}>{`Add to ${mealLabel}`}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  selectBar: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s6,
    padding: spacing.s6,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r24,
  },
  selectCount: {
    paddingHorizontal: spacing.s10,
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  selectActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.s4,
    flexShrink: 1,
  },
  selectAction: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s12,
    borderRadius: radius.full,
  },
  selectActionPrimary: { backgroundColor: colors.accent },
  selectActionDanger: { borderWidth: 1, borderColor: colors.danger },
  selectActionLabel: {
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  selectActionLabelPrimary: {
    color: colors.onAccent,
    fontWeight: fontWeight.bold,
  },
  selectActionLabelDanger: { color: colors.danger },
  sheet: {
    alignSelf: 'flex-end',
    minWidth: 220,
    maxWidth: '100%',
    paddingVertical: spacing.s4,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r16,
    overflow: 'hidden',
  },
  sheetHead: {
    gap: spacing.s2,
    paddingHorizontal: spacing.s12,
    paddingTop: spacing.s8,
    paddingBottom: spacing.s6,
  },
  sheetTitle: {
    color: colors.ink,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
  },
  sheetSubtitle: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginHorizontal: spacing.s8,
  },
  sheetRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s12,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s6,
  },
  sheetActionLabel: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.medium,
  },
  sheetActionDanger: { color: colors.danger },
  sheetActionSelected: { color: colors.accent, fontWeight: fontWeight.semibold },
  sheetGlyph: {
    color: colors.muted,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.medium,
  },
  sheetGlyphSelected: { color: colors.accent, fontWeight: fontWeight.bold },
  quickCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.r16,
    padding: spacing.s12,
    gap: spacing.s10,
  },
  quickHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s8,
  },
  cardTitle: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
  },
  quickMeal: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  quickFields: {
    flexDirection: 'row',
    gap: spacing.s6,
  },
  kcalField: {
    flex: 1.6,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
    paddingHorizontal: spacing.s4,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  macroField: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s2,
    paddingHorizontal: spacing.s4,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  quickFieldActive: { borderColor: colors.accent },
  kcalValue: {
    color: colors.ink,
    fontSize: fontSize.t24,
    fontWeight: fontWeight.extrabold,
    fontVariant: [...tabularNums.fontVariant],
  },
  emptyValue: { color: colors.muted },
  kcalUnit: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
  },
  macroLetter: {
    fontSize: fontSize.t10,
    fontWeight: fontWeight.bold,
  },
  macroValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s2,
  },
  macroValue: {
    fontSize: fontSize.t16,
    fontWeight: fontWeight.bold,
    fontVariant: [...tabularNums.fontVariant],
  },
  macroUnit: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
  },
  addButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s16,
    paddingVertical: spacing.s10,
    borderRadius: radius.r12,
    backgroundColor: colors.accent,
  },
  addButtonDisabled: { opacity: 0.4 },
  addButtonLabel: {
    color: colors.onAccent,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.bold,
  },
  pressed: { opacity: 0.7 },
});
