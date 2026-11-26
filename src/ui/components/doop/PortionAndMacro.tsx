import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  colors,
  fontFace,
  macroColors,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';
import { DoopIcon } from '../DoopIcons';

export interface LearnedPortion {
  label: string;
  energyLabel: string;
  rankDots?: 0 | 1 | 2 | 3 | undefined;
  selected?: boolean | undefined;
}

export interface LearnedPortionChipsProps {
  portions: LearnedPortion[];
  onSelect: (index: number) => void;
  onMore?: (() => void) | undefined;
  moreExpanded?: boolean | undefined;
  disabled?: boolean | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Frequency-ranked portion chips with an optional trailing custom-entry chip. */
export function LearnedPortionChips({
  portions,
  onSelect,
  onMore,
  moreExpanded,
  disabled = false,
  style,
}: LearnedPortionChipsProps) {
  return (
    <View style={[styles.portionRail, style]}>
      {portions.slice(0, 3).map((portion, index) => {
        const selected = portion.selected === true;
        const dots = portion.rankDots ?? 0;
        return (
          <Pressable
            key={`${portion.label}-${index}`}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`${portion.label}, ${portion.energyLabel}`}
            accessibilityState={{ checked: selected, selected, disabled }}
            onPress={() => onSelect(index)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              disabled && { opacity: 0.5 },
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={[styles.chipLabel, selected && { color: colors.accent }]}>
              {portion.label}
            </Text>
            <View style={styles.chipMeta}>
              <Text numberOfLines={1} style={styles.chipEnergy}>
                {portion.energyLabel}
              </Text>
              {dots > 0 ? (
                <View style={styles.rankDots}>
                  {Array.from({ length: dots }, (_, dot) => <View key={dot} style={styles.rankDot} />)}
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      {onMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Custom portion"
          accessibilityState={moreExpanded === undefined ? undefined : { expanded: moreExpanded }}
          disabled={disabled}
          onPress={onMore}
          style={({ pressed }) => [styles.moreChip, moreExpanded && styles.chipSelected, pressed && styles.pressed]}
        >
          <DoopIcon name="more" size={18} color={moreExpanded ? colors.accent : colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export interface MealDestinationPillsProps {
  meals: string[];
  selectedMeals?: string[] | undefined;
  suggestedMeal?: string | undefined;
  mode?: 'log' | 'toggle' | 'move' | undefined;
  disabled?: boolean | undefined;
  wrap?: boolean | undefined;
  onPress: (meal: string) => void;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Shared meal-destination pill row used across Library, Barcode, and Recipe batches. */
export function MealDestinationPills({
  meals,
  selectedMeals = [],
  suggestedMeal,
  mode = 'log',
  disabled = false,
  wrap = false,
  onPress,
  style,
}: MealDestinationPillsProps) {
  return (
    <View style={[styles.mealRow, (wrap || meals.length > 4) && styles.mealWrap, style]}>
      {meals.map(meal => {
        const selected = selectedMeals.includes(meal);
        const suggested = !selected && meal === suggestedMeal;
        const actionPrefix = mode === 'move' ? 'Move to ' : mode === 'toggle' && selected ? 'Remove from ' : 'Add to ';
        return (
          <Pressable
            key={meal}
            accessibilityRole="button"
            accessibilityLabel={`${actionPrefix}${meal}`}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onPress(meal)}
            style={({ pressed }) => [
              styles.mealPill,
              (wrap || meals.length > 4) && styles.mealPillWrap,
              suggested && styles.mealSuggested,
              selected && styles.mealSelected,
              disabled && { opacity: 0.5 },
              pressed && styles.pressed,
            ]}
          >
            <DoopIcon name={selected ? 'check' : 'plus'} size={11} color={selected ? colors.onAccent : colors.muted} />
            <Text numberOfLines={1} style={[styles.mealPillLabel, selected && styles.mealPillLabelSelected]}>
              {meal}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Doop design-system alias. */
export const LibV2PortionChip = LearnedPortionChips;
export type LibV2PortionChipProps = LearnedPortionChipsProps;

export interface MacroProportionBarProps {
  proteinG: number;
  carbsG: number;
  fatG: number;
  height?: number | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

function energyWeight(grams: number, kcalPerGram: number): number {
  return Number.isFinite(grams) ? Math.max(0, grams) * kcalPerGram : 0;
}

/** Split track showing macro energy share as 4P : 4C : 9F. */
export function MacroProportionBar({
  proteinG,
  carbsG,
  fatG,
  height = 4,
  style,
}: MacroProportionBarProps) {
  const proteinWeight = energyWeight(proteinG, 4);
  const carbsWeight = energyWeight(carbsG, 4);
  const fatWeight = energyWeight(fatG, 9);
  const total = proteinWeight + carbsWeight + fatWeight;
  const trackHeight = Math.max(1, height);
  const percent = (weight: number) => Math.round((weight / total) * 100);
  const valueText =
    total > 0
      ? `Protein ${percent(proteinWeight)}%, carbs ${percent(carbsWeight)}%, fat ${percent(fatWeight)}%`
      : 'No macros logged';

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Macro energy split"
      accessibilityValue={{ text: valueText }}
      style={[
        styles.macroTrack,
        { height: trackHeight, borderRadius: trackHeight / 2 },
        style,
      ]}
    >
      {total > 0
        ? [
            { key: 'protein', weight: proteinWeight, color: macroColors.protein },
            { key: 'carbs', weight: carbsWeight, color: macroColors.carbs },
            { key: 'fat', weight: fatWeight, color: macroColors.fat },
          ].map(segment =>
            segment.weight > 0 ? (
              <View
                key={segment.key}
                style={{
                  flexGrow: segment.weight,
                  flexBasis: 0,
                  backgroundColor: segment.color,
                }}
              />
            ) : null,
          )
        : null}
    </View>
  );
}

/** Doop design-system alias. */
export const LibV2MacroBar = MacroProportionBar;
export type LibV2MacroBarProps = MacroProportionBarProps;

export type SourceTone = 'neutral' | 'personal' | 'estimated';

export interface SourceBadgeProps {
  label: string;
  tone?: SourceTone | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Compact provenance pill. Estimated sources are outlined with a dash pattern. */
export function SourceBadge({ label, tone = 'neutral', style }: SourceBadgeProps) {
  const color =
    tone === 'personal' ? colors.accent : tone === 'estimated' ? colors.lavender : colors.muted;
  const borderColor =
    tone === 'personal' ? colors.accent : tone === 'estimated' ? colors.lavender : colors.border;

  return (
    <View style={[styles.badge, { borderColor }, tone === 'estimated' && styles.badgeDashed, style]}>
      <Text numberOfLines={1} style={[styles.badgeLabel, { color }]}>
        {label}
      </Text>
    </View>
  );
}

/** Doop design-system alias. */
export const BarSourceChip = SourceBadge;
export type BarSourceChipProps = SourceBadgeProps;

const styles = StyleSheet.create({
  portionRail: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { height: 48, flex: 1, minWidth: 0, justifyContent: 'center', alignItems: 'center', gap: 1, paddingHorizontal: 2, borderRadius: 12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground },
  chipSelected: { borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.12)' },
  chipLabel: { color: colors.ink, ...fontFace('bold'), fontSize: 13, lineHeight: 15 },
  chipMeta: { alignItems: 'center', gap: 1 }, chipEnergy: { color: colors.muted, ...fontFace('medium'), fontSize: 10, lineHeight: 11, fontVariant: [...tabularNums.fontVariant] },
  rankDots: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 3, marginTop: 1 }, rankDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.lavender },
  moreChip: { height: 48, flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', borderRadius: radius.r12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.ground },
  mealRow: { flexDirection: 'row', gap: 6 },
  mealWrap: { flexWrap: 'wrap' },
  mealPill: { flex: 1, minWidth: 68, height: 44, paddingHorizontal: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground, flexDirection: 'row', gap: 3, alignItems: 'center', justifyContent: 'center' },
  mealPillWrap: { flexBasis: '47%' },
  mealSuggested: { borderColor: colors.border, backgroundColor: 'rgba(122,162,247,0.07)' },
  mealSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  mealPillLabel: { ...fontFace('semibold'), fontSize: 10, color: colors.muted },
  mealPillLabelSelected: { color: colors.onAccent },
  macroTrack: { width: '100%', flexDirection: 'row', backgroundColor: colors.track, overflow: 'hidden', opacity: 0.9 },
  badge: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 22, justifyContent: 'center', borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.s10, paddingVertical: spacing.s2 },
  badgeDashed: { borderStyle: 'dashed' }, badgeLabel: { fontSize: 10, ...fontFace('semibold'), letterSpacing: 0.3, fontVariant: [...tabularNums.fontVariant] },
  pressed: { opacity: 0.7 },
});
