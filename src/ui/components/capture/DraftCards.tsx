import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  fontSize,
  fontWeight,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';
import { SourceBadge } from '../doop';

export interface SparklePromptRowProps {
  summary: string;
  onPress: () => void;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
}

/**
 * Dashed lavender prompt that offers an AI draft.
 * It reads as an offer rather than a commitment: the dashed edge keeps it
 * visually quieter than a primary action, and the busy state keeps the same
 * geometry so nothing reflows while a draft is being estimated.
 */
export function SparklePromptRow({ summary, onPress, busy, disabled }: SparklePromptRowProps) {
  const blocked = disabled === true || busy === true;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={summary}
      accessibilityState={{ disabled: blocked, busy: busy === true }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [styles.sparkleRow, pressed && styles.pressed]}
    >
      <Text style={styles.sparkleGlyph}>✦</Text>
      <Text numberOfLines={1} style={styles.sparkleSummary}>
        {summary}
      </Text>
      <Text style={styles.sparkleChevron}>{busy === true ? '…' : '›'}</Text>
    </Pressable>
  );
}

export type DraftPortionCertainty = 'stated' | 'estimated';

export interface DraftItemCardProps {
  name: string;
  sourceLabel: string;
  isEstimatedSource?: boolean | undefined;
  portionText: string;
  portionCertainty: DraftPortionCertainty;
  estimateRangeText?: string | null | undefined;
  energyText: string;
  macrosText?: string | undefined;
  fiberUnknown?: boolean | undefined;
  onPressEdit?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
}

/**
 * One drafted line.
 *
 * The card deliberately splits the two questions a draft raises: *what it is*
 * (name plus provenance pill) sits on top, and *how much* sits underneath,
 * marked either with a solid mint rule for a stated portion or a dashed
 * lavender pill with its estimate range for a guessed one.
 */
export function DraftItemCard({
  name,
  sourceLabel,
  isEstimatedSource,
  portionText,
  portionCertainty,
  estimateRangeText,
  energyText,
  macrosText,
  fiberUnknown,
  onPressEdit,
  onRemove,
}: DraftItemCardProps) {
  const estimated = portionCertainty === 'estimated';
  const showApprox =
    estimated && !energyText.startsWith('≈') && !energyText.startsWith('~');
  const hasRange = estimateRangeText != null && estimateRangeText !== '';
  const hasMacros = macrosText != null && macrosText !== '';

  const detail = (
    <View style={styles.detail}>
      <View style={styles.nameRow}>
        <Text numberOfLines={2} style={styles.name}>
          {name}
        </Text>
        <SourceBadge
          label={sourceLabel}
          tone={isEstimatedSource === true ? 'estimated' : 'neutral'}
        />
      </View>

      {hasMacros ? (
        <Text numberOfLines={1} style={styles.macros}>
          {macrosText}
        </Text>
      ) : null}

      <View style={styles.portionRow}>
        {estimated ? (
          <View style={styles.portionEstimated}>
            <Text numberOfLines={1} style={styles.portionEstimatedText}>
              {portionText}
            </Text>
            {hasRange ? (
              <Text numberOfLines={1} style={styles.portionRange}>
                {estimateRangeText}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.portionStated}>
            <View style={styles.statedDot} />
            <View style={styles.statedRule}>
              <Text numberOfLines={1} style={styles.portionStatedText}>
                {portionText}
              </Text>
            </View>
          </View>
        )}
        {fiberUnknown === true ? <Text style={styles.fiberUnknown}>Fiber unknown</Text> : null}
      </View>
    </View>
  );

  const energy = (
    <View style={styles.energyBox}>
      <Text numberOfLines={1} style={styles.energyValue}>
        {showApprox ? <Text style={styles.energyApprox}>≈</Text> : null}
        {energyText}
      </Text>
    </View>
  );

  return (
    <View style={styles.itemCard}>
      {onPressEdit != null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${name}`}
          onPress={onPressEdit}
          style={({ pressed }) => [styles.itemMain, pressed && styles.pressed]}
        >
          {detail}
          {energy}
        </Pressable>
      ) : (
        <View style={styles.itemMain}>
          {detail}
          {energy}
        </View>
      )}

      {onRemove != null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          hitSlop={4}
          onPress={onRemove}
          style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
        >
          <Text style={styles.removeGlyph}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface DraftAskOption {
  id: string;
  label: string;
  selected?: boolean | undefined;
}

export interface DraftAskChipsProps {
  questionId: string;
  label: string;
  options: DraftAskOption[];
  onSelect: (questionId: string, optionId: string) => void;
}

/**
 * One inline clarifying question, e.g. `Fat: Ghee · Oil · Butter · Not sure`.
 * The row stays on one visual line where it fits and wraps its chips instead
 * of truncating them, because the answer is the point.
 */
export function DraftAskChips({
  questionId,
  label,
  options,
  onSelect,
}: DraftAskChipsProps) {
  const heading = label.endsWith(':') ? label : `${label}:`;

  return (
    <View style={styles.askRow} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.askLabel}>{heading}</Text>
      <View style={styles.askOptions}>
        {options.map(option => {
          const selected = option.selected === true;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected }}
              onPress={() => onSelect(questionId, option.id)}
              style={({ pressed }) => [
                styles.askChip,
                selected && styles.askChipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.askChipLabel, selected && styles.askChipLabelSelected]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export interface MealDraftPanelProps {
  mealLabel: string;
  draftEnergyText: string;
  fiberNote?: string | null | undefined;
  itemCount: number;
  onConfirmAll: () => void;
  onDismissAll: () => void;
  confirming?: boolean | undefined;
  children?: ReactNode | undefined;
}

/**
 * Wrapper for a meal's whole draft set: the items, any clarifying chips, the
 * estimate disclosure, one primary confirmation and a quiet discard.
 * Confirming logs everything; discarding never touches the diary.
 */
export function MealDraftPanel({
  mealLabel,
  draftEnergyText,
  fiberNote,
  itemCount,
  onConfirmAll,
  onDismissAll,
  confirming,
  children,
}: MealDraftPanelProps) {
  const countText = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  const hasFiberNote = fiberNote != null && fiberNote !== '';
  const confirmLabel = `Confirm to ${mealLabel}`;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>Today · drafts</Text>
        <Text style={styles.panelMeal}>{mealLabel}</Text>
      </View>

      <View style={styles.panelSummary}>
        <Text
          numberOfLines={1}
          accessibilityLabel={`Draft total ${draftEnergyText}`}
          style={styles.panelEnergy}
        >
          {draftEnergyText}
        </Text>
        <Text style={styles.panelCount}>{countText}</Text>
      </View>

      {children != null ? <View style={styles.panelItems}>{children}</View> : null}

      {hasFiberNote ? <Text style={styles.panelNote}>{fiberNote}</Text> : null}

      <Text style={styles.disclosure}>Estimates can be wrong. Not medical advice.</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={confirmLabel}
        accessibilityState={{ disabled: confirming === true, busy: confirming === true }}
        disabled={confirming === true}
        onPress={onConfirmAll}
        style={({ pressed }) => [
          styles.primaryButton,
          confirming === true && styles.primaryButtonDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryLabel}>{confirmLabel}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Discard"
        disabled={confirming === true}
        onPress={onDismissAll}
        style={({ pressed }) => [styles.quietButton, pressed && styles.pressed]}
      >
        <Text style={styles.quietLabel}>Discard</Text>
      </Pressable>
    </View>
  );
}

export interface AIFailedCardProps {
  mealLabel?: string | undefined;
  reasonText: string;
  onRetry?: (() => void) | undefined;
  onSearchInstead: () => void;
  onQuickAdd: () => void;
  onDismiss?: (() => void) | undefined;
}

function FailedAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.failedAction, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={styles.failedActionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Quiet failure notice. Nothing was logged and nothing was lost, so the card
 * states the reason once and offers the three exits that still work offline:
 * retry, search the catalog, or type the numbers in by hand.
 */
export function AIFailedCard({
  mealLabel,
  reasonText,
  onRetry,
  onSearchInstead,
  onQuickAdd,
  onDismiss,
}: AIFailedCardProps) {
  return (
    <View style={styles.failedCard}>
      <View style={styles.failedHead}>
        <Text style={styles.failedTitle}>Today · AI failed</Text>
        <View style={styles.failedHeadRight}>
          {mealLabel != null ? (
            <Text numberOfLines={1} style={styles.failedMeal}>
              {mealLabel}
            </Text>
          ) : null}
          {onDismiss != null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss AI notice"
              hitSlop={4}
              onPress={onDismiss}
              style={({ pressed }) => [styles.failedDismiss, pressed && styles.pressed]}
            >
              <Text style={styles.failedDismissGlyph}>×</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Text style={styles.failedReason}>{reasonText}</Text>

      <View style={styles.failedActions}>
        {onRetry != null ? <FailedAction label="Retry" onPress={onRetry} /> : null}
        <FailedAction label="Search instead" onPress={onSearchInstead} />
        <FailedAction label="Quick add" onPress={onQuickAdd} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sparkleRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s10,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.lavender,
    backgroundColor: colors.surface,
  },
  sparkleGlyph: {
    color: colors.lavender,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.semibold,
  },
  sparkleSummary: {
    flex: 1,
    minWidth: 0,
    color: colors.ink,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
  },
  sparkleChevron: {
    color: colors.lavender,
    fontSize: fontSize.t16,
    fontWeight: fontWeight.bold,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s4,
    paddingLeft: spacing.s12,
    paddingRight: spacing.s4,
    paddingVertical: spacing.s10,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s12,
  },
  detail: {
    flex: 1,
    minWidth: 0,
    gap: spacing.s6,
  },
  nameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: spacing.s6,
  },
  name: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.semibold,
  },
  macros: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  portionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.s8,
  },
  portionStated: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s6,
    minHeight: 22,
  },
  statedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.mint,
  },
  statedRule: {
    borderBottomWidth: 1,
    borderBottomColor: colors.mint,
    paddingBottom: 1,
  },
  portionStatedText: {
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  portionEstimated: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s6,
    minHeight: 22,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.lavender,
  },
  portionEstimatedText: {
    flexShrink: 1,
    color: colors.lavender,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  portionRange: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  fiberUnknown: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
  },
  energyBox: {
    alignItems: 'flex-end',
    paddingTop: spacing.s2,
  },
  energyValue: {
    color: colors.ink,
    fontSize: fontSize.t16,
    fontWeight: fontWeight.bold,
    fontVariant: [...tabularNums.fontVariant],
  },
  energyApprox: {
    color: colors.muted,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
  },
  removeButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  removeGlyph: {
    color: colors.muted,
    fontSize: fontSize.t18,
    fontWeight: fontWeight.semibold,
  },
  askRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.s8,
  },
  askLabel: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  askOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.s6,
    flexShrink: 1,
  },
  askChip: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  askChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  askChipLabel: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  askChipLabelSelected: {
    color: colors.onAccent,
    fontWeight: fontWeight.bold,
  },
  panel: {
    gap: spacing.s12,
    padding: spacing.s12,
    borderRadius: radius.r16,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s8,
  },
  panelTitle: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
  },
  panelMeal: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  panelSummary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.s8,
  },
  panelEnergy: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSize.t20,
    fontWeight: fontWeight.extrabold,
    fontVariant: [...tabularNums.fontVariant],
  },
  panelCount: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  panelItems: {
    gap: spacing.s8,
  },
  panelNote: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  disclosure: {
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
  failedCard: {
    gap: spacing.s10,
    padding: spacing.s12,
    borderRadius: radius.r16,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  failedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s8,
  },
  failedTitle: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
  },
  failedHeadRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s4,
    flexShrink: 1,
  },
  failedMeal: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  failedDismiss: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  failedDismissGlyph: {
    color: colors.muted,
    fontSize: fontSize.t18,
    fontWeight: fontWeight.semibold,
  },
  failedReason: {
    color: colors.ink,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.medium,
  },
  failedActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.s6,
  },
  failedAction: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  failedActionLabel: {
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  pressed: { opacity: 0.7 },
});
