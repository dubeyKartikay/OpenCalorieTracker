import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export interface LearnedPortion {
  label: string;
  energyLabel: string;
  rankDots: 1 | 2 | 3;
  selected?: boolean | undefined;
}

export interface LearnedPortionChipsProps {
  portions: LearnedPortion[];
  onSelect: (index: number) => void;
  onMore: () => void;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Frequency-ranked portion chips with a trailing custom-entry chip. */
export function LearnedPortionChips({
  portions,
  onSelect,
  onMore,
  style,
}: LearnedPortionChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.portionScroll, style]}
      contentContainerStyle={styles.portionRail}
    >
      {portions.map((portion, index) => {
        const selected = portion.selected === true;
        return (
          <Pressable
            key={`${portion.label}-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`${portion.label}, ${portion.energyLabel}`}
            accessibilityState={{ selected }}
            onPress={() => onSelect(index)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={styles.chipLabel}>
              {portion.label}
            </Text>
            <View style={styles.chipMeta}>
              <Text numberOfLines={1} style={styles.chipEnergy}>
                {portion.energyLabel}
              </Text>
              <View style={styles.rankDots}>
                {[0, 1, 2].map(dot => {
                  const filled = dot < portion.rankDots;
                  const dotColor = filled ? (selected ? colors.accent : colors.muted) : colors.track;
                  return (
                    <View
                      key={`dot-${dot}`}
                      style={[styles.rankDot, { backgroundColor: dotColor }]}
                    />
                  );
                })}
              </View>
            </View>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Custom portion"
        onPress={onMore}
        style={({ pressed }) => [styles.moreChip, pressed && styles.pressed]}
      >
        <Text style={styles.moreGlyph}>…</Text>
      </Pressable>
    </ScrollView>
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
  portionScroll: { flexGrow: 0 },
  portionRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s8,
    paddingVertical: spacing.s2,
    paddingRight: spacing.s4,
  },
  chip: {
    minHeight: 52,
    minWidth: 88,
    maxWidth: 190,
    justifyContent: 'center',
    gap: spacing.s4,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s8,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  chipSelected: {
    borderColor: colors.accent,
  },
  chipLabel: {
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  chipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s8,
  },
  chipEnergy: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSize.t11,
    fontVariant: [...tabularNums.fontVariant],
  },
  rankDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rankDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  moreChip: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  moreGlyph: {
    color: colors.muted,
    fontSize: fontSize.t20,
    fontWeight: fontWeight.semibold,
  },
  macroTrack: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  badge: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 22,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s2,
  },
  badgeDashed: { borderStyle: 'dashed' },
  badgeLabel: {
    fontSize: fontSize.t10,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.3,
    fontVariant: [...tabularNums.fontVariant],
  },
  pressed: { opacity: 0.7 },
});
