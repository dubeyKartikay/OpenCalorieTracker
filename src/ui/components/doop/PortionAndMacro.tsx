import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  colors,
  fontFace,
  macroColors,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';
import { hapticLight, hapticMedium, hapticSelection } from '../../haptics';
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
  variant?: 'default' | 'calm' | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Frequency-ranked portion chips with an optional trailing custom-entry chip. */
export function LearnedPortionChips({
  portions,
  onSelect,
  onMore,
  moreExpanded,
  disabled = false,
  variant = 'default',
  style,
}: LearnedPortionChipsProps) {
  const calm = variant === 'calm';
  const portionChips = portions.slice(0, 3).map((portion, index) => {
    const selected = portion.selected === true;
    const dots = portion.rankDots ?? 0;
    return (
      <Pressable
        key={`${portion.label}-${index}`}
        disabled={disabled}
        hitSlop={calm ? { top: 4, bottom: 4 } : undefined}
        accessibilityRole="radio"
        accessibilityLabel={portion.energyLabel ? `${portion.label}, ${portion.energyLabel}` : portion.label}
        accessibilityState={{ checked: selected, selected, disabled }}
        onPress={() => {
          hapticSelection();
          onSelect(index);
        }}
        style={({ pressed }) => [
          calm ? styles.chipCalm : styles.chip,
          selected && (calm ? styles.chipCalmSelected : styles.chipSelected),
          disabled && { opacity: 0.5 },
          pressed && styles.pressed,
        ]}
      >
        <Text numberOfLines={1} style={[calm ? styles.chipCalmLabel : styles.chipLabel, selected && { color: colors.accent }]}>
          {portion.label}
        </Text>
        {!calm ? (
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
        ) : null}
      </Pressable>
    );
  });
  const moreButton = onMore ? (
    <Pressable
      hitSlop={calm ? { top: 4, bottom: 4 } : undefined}
      accessibilityRole="button"
      accessibilityLabel="Custom portion"
      accessibilityState={moreExpanded === undefined ? undefined : { expanded: moreExpanded }}
      disabled={disabled}
      onPress={() => {
        hapticSelection();
        onMore();
      }}
      style={({ pressed }) => [
        calm ? styles.moreChipCalm : styles.moreChip,
        moreExpanded && (calm ? styles.chipCalmSelected : styles.chipSelected),
        pressed && styles.pressed,
      ]}
    >
      <DoopIcon name="more" size={calm ? 16 : 18} color={moreExpanded ? colors.accent : colors.muted} />
    </Pressable>
  ) : null;
  if (calm) {
    return (
      <View style={[styles.portionCalmRow, style]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.portionScrollCalm}
          contentContainerStyle={styles.portionRailCalm}
        >
          {portionChips}
        </ScrollView>
        {moreButton}
      </View>
    );
  }
  return <View style={[styles.portionRail, style]}>{portionChips}{moreButton}</View>;
}

export interface MealDestinationPillsProps {
  meals: string[];
  selectedMeals?: string[] | undefined;
  suggestedMeal?: string | undefined;
  mode?: 'log' | 'toggle' | 'move' | 'select' | undefined;
  disabled?: boolean | undefined;
  wrap?: boolean | undefined;
  variant?: 'default' | 'calm' | undefined;
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
  variant = 'default',
  onPress,
  style,
}: MealDestinationPillsProps) {
  const calm = variant === 'calm';
  const selectMode = mode === 'select';
  const shouldWrap = calm || wrap || meals.length > 4;
  return (
    <View style={[calm ? styles.mealRowCalm : styles.mealRow, shouldWrap && styles.mealWrap, style]}>
      {meals.map(meal => {
        const selected = selectedMeals.includes(meal);
        const suggested = !selected && meal === suggestedMeal;
        const actionPrefix =
          mode === 'move'
            ? 'Move to '
            : selectMode
              ? selected
                ? 'Deselect '
                : 'Select '
              : mode === 'toggle' && selected
                ? 'Remove from '
                : 'Add to ';
        return (
          <Pressable
            key={meal}
            hitSlop={calm ? { top: 4, bottom: 4 } : undefined}
            accessibilityRole="button"
            accessibilityLabel={`${actionPrefix}${meal}`}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (selectMode) hapticSelection();
              else if (mode === 'toggle' && selected) hapticLight();
              else hapticMedium();
              onPress(meal);
            }}
            style={({ pressed }) => [
              calm ? styles.mealPillCalm : styles.mealPill,
              !calm && shouldWrap && styles.mealPillWrap,
              suggested && (calm ? styles.mealSuggestedCalm : styles.mealSuggested),
              selected && styles.mealSelected,
              disabled && { opacity: 0.5 },
              pressed && styles.pressed,
            ]}
          >
            {!calm ? (
              <DoopIcon name={selected ? 'check' : 'plus'} size={11} color={selected ? colors.onAccent : colors.muted} />
            ) : null}
            <Text
              numberOfLines={calm ? 2 : 1}
              style={[
                calm ? styles.mealPillCalmLabel : styles.mealPillLabel,
                calm && suggested && styles.mealPillCalmSuggestedLabel,
                selected && styles.mealPillLabelSelected,
              ]}
            >
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
  gap?: number | undefined;
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
  gap = 0,
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
        { height: trackHeight, borderRadius: trackHeight / 2, gap },
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
  portionCalmRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  portionScrollCalm: { flex: 1, minWidth: 0, marginVertical: -4 },
  portionRailCalm: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  chip: { height: 48, flex: 1, minWidth: 0, justifyContent: 'center', alignItems: 'center', gap: 1, paddingHorizontal: 2, borderRadius: 12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground },
  chipSelected: { borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.12)' },
  chipCalm: { height: 36, paddingHorizontal: 11, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
  chipCalmSelected: { borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.14)' },
  chipLabel: { color: colors.ink, ...fontFace('bold'), fontSize: 13, lineHeight: 15 },
  chipCalmLabel: { color: colors.ink, ...fontFace('semibold'), fontSize: 13.5, ...tabularNums },
  chipMeta: { alignItems: 'center', gap: 1 }, chipEnergy: { color: colors.muted, ...fontFace('medium'), fontSize: 10, lineHeight: 11, fontVariant: [...tabularNums.fontVariant] },
  rankDots: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 3, marginTop: 1 }, rankDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.lavender },
  moreChip: { height: 48, flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', borderRadius: radius.r12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.ground },
  moreChipCalm: { height: 36, paddingHorizontal: 11, flexShrink: 0, borderRadius: radius.full, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  mealRow: { flexDirection: 'row', gap: 6 },
  mealRowCalm: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mealWrap: { flexWrap: 'wrap' },
  mealPill: { flex: 1, minWidth: 68, height: 44, paddingHorizontal: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground, flexDirection: 'row', gap: 3, alignItems: 'center', justifyContent: 'center' },
  mealPillCalm: { minHeight: 36, maxWidth: '100%', paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  mealPillWrap: { flexBasis: '47%' },
  mealSuggested: { borderColor: colors.border, backgroundColor: 'rgba(122,162,247,0.07)' },
  mealSuggestedCalm: { borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.14)' },
  mealSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  mealPillLabel: { ...fontFace('semibold'), fontSize: 10, color: colors.muted },
  mealPillCalmLabel: { ...fontFace('semibold'), fontSize: 13.5, color: colors.ink },
  mealPillCalmSuggestedLabel: { color: colors.accent },
  mealPillLabelSelected: { color: colors.onAccent },
  macroTrack: { width: '100%', flexDirection: 'row', backgroundColor: colors.track, overflow: 'hidden', opacity: 0.9 },
  badge: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 22, justifyContent: 'center', borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.s10, paddingVertical: spacing.s2 },
  badgeDashed: { borderStyle: 'dashed' }, badgeLabel: { fontSize: 10, ...fontFace('semibold'), letterSpacing: 0.3, fontVariant: [...tabularNums.fontVariant] },
  pressed: { opacity: 0.7 },
});
