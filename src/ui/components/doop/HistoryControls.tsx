import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ComponentRef, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { DiaryEntrySnapshot, Quantity } from '../../../domain';
import { calculateNutrition, resolveQuantityToBasis } from '../../../domain';
import { availableUnits } from '../../../app/controller';
import {
  colors,
  fontFace,
  fontSize,
  fontWeight,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';
import { hapticLight, hapticSelection, hapticWarning } from '../../haptics';
import { InlineKeypad } from './InlineKeypad';
import { RevealPanel } from './Motion';
import { DoopIcon } from '../DoopIcons';
import { energyValue, number } from '../primitives';

export interface PopoverAnchor { x: number; y: number; width: number; height: number }

export function measurePopoverAnchor(node: ComponentRef<typeof View> | null, onMeasure: (anchor: PopoverAnchor) => void) {
  node?.measureInWindow((x, y, width, height) => onMeasure({ x, y, width, height }));
}

/** Window-measured anchor keeps menus attached to their control even inside a scrolled pane, with crisp open/close motion. */
export function AnchoredPopover({ anchor, onClose, children, width = 214, label, surface = false, preferAbove = false }: {
  anchor: PopoverAnchor | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  label: string;
  surface?: boolean;
  preferAbove?: boolean;
}) {
  const window = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [contentHeight, setContentHeight] = useState(0);
  const [mounted, setMounted] = useState(Boolean(anchor));
  const [savedAnchor, setSavedAnchor] = useState<PopoverAnchor | null>(anchor);
  const progress = useSharedValue(anchor ? 1 : 0);

  if (anchor && !mounted) {
    setMounted(true);
  } else if (!anchor && mounted && reducedMotion) {
    setMounted(false);
  }
  if (anchor && anchor !== savedAnchor) {
    setSavedAnchor(anchor);
  }

  useEffect(() => {
    if (anchor) {
      if (reducedMotion) {
        progress.set(1);
      } else {
        progress.set(withSpring(1, { damping: 23, stiffness: 350, mass: 0.76 }));
      }
      return;
    }

    if (!mounted) return;
    if (reducedMotion) {
      progress.set(0);
      return;
    }
    progress.set(
      withTiming(
        0,
        { duration: 140, easing: Easing.out(Easing.cubic) },
        finished => {
          if (finished) scheduleOnRN(setMounted, false);
        },
      ),
    );
  }, [anchor, mounted, progress, reducedMotion]);

  const activeAnchor = anchor ?? savedAnchor;
  const actualWidth = Math.min(width, window.width - 24);
  const left = activeAnchor ? Math.max(12, Math.min(activeAnchor.x + activeAnchor.width / 2 - actualWidth / 2, window.width - actualWidth - 12)) : 12;
  const maxHeight = Math.max(100, window.height - 40);
  const height = Math.min(contentHeight + 2, maxHeight);
  const below = activeAnchor ? activeAnchor.y + activeAnchor.height + 10 : 80;
  const above = activeAnchor ? activeAnchor.y - height - 10 : 80;
  const fitsBelow = below + height <= window.height - 20;
  const fitsAbove = above >= 20;
  const placeBelow = preferAbove ? !fitsAbove && fitsBelow : fitsBelow || !fitsAbove;
  const top = placeBelow ? Math.min(below, window.height - height - 20) : Math.max(20, above);
  const caretX = activeAnchor ? Math.max(8, Math.min(actualWidth - 18, activeAnchor.x + activeAnchor.width / 2 - left - 5)) : 12;
  const slideOffset = placeBelow ? -8 : 8;

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.75, 1], [0, 0.96, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [slideOffset, 0], Extrapolation.CLAMP) },
      { scale: interpolate(progress.value, [0, 1], [0.94, 1], Extrapolation.CLAMP) },
    ],
  }));

  if (!mounted || !activeAnchor) return null;

  return <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
    <View style={{ flex: 1 }} pointerEvents={anchor ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, surface ? styles.popoverScrim : undefined, scrimStyle]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss ${label}`} onPress={onClose} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View accessibilityViewIsModal accessibilityLabel={label} onAccessibilityEscape={onClose} style={[{ position: 'absolute', left, top, width: actualWidth, maxHeight, minHeight: anchor ? undefined : Math.min(contentHeight, maxHeight), borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: surface ? colors.surface : colors.raised, boxShadow: '0 18px 36px rgba(0,0,0,0.45)' }, cardStyle]}>
        <View pointerEvents="none" style={{ position: 'absolute', left: caretX, ...(placeBelow ? { top: -5 } : { bottom: -5 }), width: 10, height: 10, backgroundColor: surface ? colors.surface : colors.raised, borderLeftWidth: placeBelow ? 1 : 0, borderTopWidth: placeBelow ? 1 : 0, borderRightWidth: placeBelow ? 0 : 1, borderBottomWidth: placeBelow ? 0 : 1, borderColor: colors.border, transform: [{ rotate: '45deg' }] }} />
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} onContentSizeChange={(_, h) => { if (h > 0) setContentHeight(h); }} style={{ maxHeight }}>
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  </Modal>;
}

export interface EntryEditPopoverProps {
  entry: DiaryEntrySnapshot;
  date?: string | undefined;
  today?: string | undefined;
  dateLabel?: string | undefined;
  meals: string[];
  energyUnit: 'kcal' | 'kJ';
  busy?: boolean | undefined;
  onUpdateQuantity: (quantity: Quantity) => void;
  onMoveMeal: (meal: string) => void;
  onMoveToday?: (() => void) | undefined;
  onPickDate?: (() => void) | undefined;
  onRemove: () => void;
}

function roundQty(value: number): number {
  return Math.round(value * 100) / 100;
}

function availableUnitsForEntry(entry: DiaryEntrySnapshot): string[] {
  const validUnits = availableUnits(entry.food);
  return [...new Set([entry.quantity.unit, ...validUnits])].filter(unit => {
    try {
      resolveQuantityToBasis(entry.food, { amount: 1, unit });
      return true;
    } catch {
      return unit === entry.quantity.unit;
    }
  });
}

/** Doop LibV2EditPopover: live −/+/amount/unit stepper, inline keypad, 2×2 meal chips, Move to row, and Remove. */
export function EntryEditPopover({
  entry,
  date,
  today,
  dateLabel,
  meals,
  energyUnit,
  busy = false,
  onUpdateQuantity,
  onMoveMeal,
  onMoveToday,
  onPickDate,
  onRemove,
}: EntryEditPopoverProps) {
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [unitMenuOpen, setUnitMenuOpen] = useState(false);
  const syncKey = `${entry.id}:${entry.quantity.amount}:${entry.quantity.unit}`;
  const [lastSyncKey, setLastSyncKey] = useState(syncKey);
  const [draftAmount, setDraftAmount] = useState(() => String(roundQty(entry.quantity.amount)));
  const [draftUnit, setDraftUnit] = useState(entry.quantity.unit);
  const [draftEdited, setDraftEdited] = useState(false);

  if (syncKey !== lastSyncKey) {
    setLastSyncKey(syncKey);
    setDraftAmount(String(roundQty(entry.quantity.amount)));
    setDraftUnit(entry.quantity.unit);
    setDraftEdited(false);
  }

  const units = availableUnitsForEntry(entry);
  const canSwitchUnit = units.length > 1;
  const parsedDraft = Number(draftAmount);
  const validDraft = Number.isFinite(parsedDraft) && parsedDraft > 0;
  const effectiveAmount = draftEdited ? (validDraft ? parsedDraft : entry.quantity.amount) : entry.quantity.amount;
  const previewQty: Quantity = {
    amount: effectiveAmount,
    unit: draftUnit,
  };

  let basisValid = !draftEdited || validDraft;
  let previewKcal = entry.nutrients.kcal;
  try {
    resolveQuantityToBasis(entry.food, previewQty);
    const calculated = calculateNutrition(entry.food, previewQty);
    if (calculated.kcal != null) previewKcal = calculated.kcal;
  } catch {
    basisValid = false;
    if (entry.quantity.amount > 0 && (!draftEdited || validDraft) && draftUnit === entry.quantity.unit) {
      previewKcal = (entry.nutrients.kcal ?? 0) * (effectiveAmount / entry.quantity.amount);
      basisValid = true;
    }
  }

  const commitDraft = () => {
    if (!basisValid) return;
    if (!draftEdited && draftUnit === entry.quantity.unit) return;
    if (!validDraft) return;
    if (parsedDraft !== entry.quantity.amount || draftUnit !== entry.quantity.unit) {
      onUpdateQuantity({ amount: parsedDraft, unit: draftUnit });
    }
    setDraftEdited(false);
  };

  const cancelDraft = () => {
    setDraftAmount(String(roundQty(entry.quantity.amount)));
    setDraftUnit(entry.quantity.unit);
    setDraftEdited(false);
    setKeypadOpen(false);
  };

  const stepAmount = (dir: -1 | 1) => {
    if (busy) return;
    hapticSelection();
    const isMassOrVol = draftUnit === 'g' || draftUnit === 'ml';
    const base = effectiveAmount;
    const delta = isMassOrVol ? 10 * dir : (base < 2 || !Number.isInteger(base) ? 0.5 : 1) * dir;
    const min = isMassOrVol ? 5 : 0.25;
    const next = roundQty(Math.max(min, base + delta));
    setDraftAmount(String(next));
    setDraftEdited(false);
    onUpdateQuantity({ amount: next, unit: draftUnit });
  };

  const selectUnit = (nextUnit: string) => {
    setUnitMenuOpen(false);
    if (nextUnit === draftUnit) return;
    hapticSelection();
    const nextAmount = nextUnit === 'g' || nextUnit === 'ml'
      ? (draftUnit === 'g' || draftUnit === 'ml' ? (validDraft ? parsedDraft : 100) : 100)
      : (draftUnit === 'g' || draftUnit === 'ml' ? 1 : (validDraft ? parsedDraft : 1));
    setDraftUnit(nextUnit);
    setDraftAmount(String(nextAmount));
    setDraftEdited(false);
    onUpdateQuantity({ amount: nextAmount, unit: nextUnit });
  };

  const isToday = date === today;

  return <View style={styles.editRoot}>
    <View style={styles.editStepRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="One less"
        disabled={busy || keypadOpen}
        onPress={() => stepAmount(-1)}
        style={({ pressed }) => [styles.editStepBtn, (busy || keypadOpen) && { opacity: 0.45 }, pressed && styles.pressed]}
      >
        <DoopIcon name="minus" size={14} color={colors.ink} />
      </Pressable>

      <View style={styles.editAmtWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Type an amount"
          accessibilityState={{ expanded: keypadOpen }}
          onPress={() => {
            setUnitMenuOpen(false);
            if (!keypadOpen) {
              setKeypadOpen(true);
            }
          }}
          style={({ pressed }) => [styles.editNumBtn, pressed && styles.pressed]}
        >
          <Text numberOfLines={1} style={[styles.editNumText, keypadOpen && styles.editNumTextActive]}>
            {draftAmount || '0'}
          </Text>
          {keypadOpen ? <View style={styles.editCaret} /> : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canSwitchUnit ? `Change unit, ${draftUnit}` : draftUnit}
          disabled={!canSwitchUnit || keypadOpen}
          onPress={() => {
            if (!canSwitchUnit || keypadOpen) return;
            setUnitMenuOpen(open => !open);
          }}
          style={({ pressed }) => [styles.editUnitBtn, keypadOpen && { opacity: 0.45 }, canSwitchUnit && pressed && styles.pressed]}
        >
          <View style={canSwitchUnit ? styles.editUnitUnderline : undefined}>
            <Text numberOfLines={1} style={styles.editUnitText}>{draftUnit}</Text>
          </View>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="One more"
        disabled={busy || keypadOpen}
        onPress={() => stepAmount(1)}
        style={({ pressed }) => [styles.editStepBtn, (busy || keypadOpen) && { opacity: 0.45 }, pressed && styles.pressed]}
      >
        <DoopIcon name="plus" size={14} color={colors.ink} />
      </Pressable>

      <View style={styles.editKcalWrap}>
        <Text numberOfLines={1} style={styles.editKcalNum}>{number(energyValue(previewKcal, energyUnit))}</Text>
        <Text style={styles.editKcalUnit}>{energyUnit}</Text>
      </View>
    </View>

    <RevealPanel visible={unitMenuOpen} direction="down">
      <View style={styles.editUnitList}>
        {units.map(unitOption => {
          const active = unitOption === draftUnit;
          return <Pressable
            key={unitOption}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => selectUnit(unitOption)}
            style={({ pressed }) => [styles.editUnitItem, active && styles.editUnitItemActive, pressed && styles.pressed]}
          >
            <Text style={[styles.editUnitItemText, active && styles.editUnitItemTextActive]}>{unitOption}</Text>
            {active ? <DoopIcon name="check" size={14} color={colors.accent} /> : null}
          </Pressable>;
        })}
      </View>
    </RevealPanel>

    <RevealPanel visible={keypadOpen} direction="down">
      <View style={styles.editKeypadWrap}>
        <View style={styles.editKeypadActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel amount edit"
            onPress={cancelDraft}
            style={({ pressed }) => [styles.editKeypadCancel, pressed && styles.pressed]}
          >
            <Text style={styles.editKeypadCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Apply amount"
            accessibilityState={{ disabled: busy || !basisValid }}
            disabled={busy || !basisValid}
            onPress={() => {
              hapticLight();
              commitDraft();
              setKeypadOpen(false);
            }}
            style={({ pressed }) => [
              styles.editKeypadApply,
              (busy || !basisValid) && { opacity: 0.4 },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.editKeypadApplyText}>Apply</Text>
          </Pressable>
        </View>
        <InlineKeypad
          bare
          showReadout={false}
          value={draftAmount}
          onChange={next => {
            setDraftEdited(true);
            setDraftAmount(next);
          }}
          maxDecimals={draftUnit === 'g' || draftUnit === 'ml' ? 1 : 2}
          allowEmpty
        />
      </View>
    </RevealPanel>

    <View style={styles.editMealsGrid}>
      {meals.map(meal => {
        const selectedMeal = entry.meal === meal;
        return <Pressable
          key={meal}
          accessibilityRole="button"
          accessibilityLabel={`Move to ${meal}`}
          accessibilityState={{ selected: selectedMeal, disabled: busy || keypadOpen }}
          disabled={busy || keypadOpen}
          onPress={() => {
            hapticSelection();
            onMoveMeal(meal);
          }}
          style={({ pressed }) => [
            styles.editMealChip,
            selectedMeal && styles.editMealChipActive,
            keypadOpen && { opacity: 0.45 },
            pressed && styles.pressed,
          ]}
        >
          <Text numberOfLines={1} style={[styles.editMealChipText, selectedMeal && styles.editMealChipTextActive]}>{meal}</Text>
        </Pressable>;
      })}
    </View>

    {(onMoveToday || onPickDate) ? (
      <View style={styles.editDayRow}>
        <Text style={styles.editDayLabel}>Move to</Text>
        {onMoveToday ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Move to Today"
            accessibilityState={{ selected: isToday, disabled: busy || isToday || keypadOpen }}
            disabled={busy || isToday || keypadOpen}
            onPress={onMoveToday}
            style={({ pressed }) => [
              styles.editTodayChip,
              isToday && styles.editTodayChipActive,
              keypadOpen && { opacity: 0.45 },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.editTodayText, isToday && styles.editTodayTextActive]}>Today</Text>
          </Pressable>
        ) : null}
        {onPickDate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pick a date, currently ${dateLabel ?? ''}`}
            accessibilityState={{ disabled: busy || keypadOpen }}
            disabled={busy || keypadOpen}
            onPress={onPickDate}
            style={({ pressed }) => [styles.editDateChip, keypadOpen && { opacity: 0.45 }, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.editDateText}>{dateLabel ?? ''}</Text>
            <DoopIcon name="chevronDown" size={12} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    ) : null}

    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove ${entry.food.name}`}
      disabled={busy}
      onPress={() => {
        hapticWarning();
        onRemove();
      }}
      style={({ pressed }) => [styles.editRemoveBtn, pressed && styles.pressed]}
    >
      <Text style={styles.editRemoveText}>Remove</Text>
    </Pressable>
  </View>;
}

type SelectActionTone = 'default' | 'danger' | 'primary';

function SelectAction({
  label,
  onPress,
  tone = 'default',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: SelectActionTone | undefined;
  disabled?: boolean | undefined;
}) {
  const primary = tone === 'primary';
  const danger = tone === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (danger) hapticWarning();
        else hapticLight();
        onPress();
      }}
      style={({ pressed }) => [
        styles.selectAction,
        primary && styles.selectActionPrimary,
        danger && styles.selectActionDanger,
        disabled && { opacity: 0.45 },
        !disabled && pressed && styles.pressed,
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
  disabled?: boolean | undefined;
  copyDisabled?: boolean | undefined;
  onCopyToToday: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDone: () => void;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Floating pill bar that takes over from bottom navigation during selection. */
export function MultiSelectBar({
  count,
  disabled = false,
  copyDisabled = false,
  onCopyToToday,
  onMove,
  onDelete,
  onDone,
  style,
}: MultiSelectBarProps) {
  const empty = count === 0;
  return (
    <View style={[styles.selectBar, style]}>
      <Text accessibilityLiveRegion="polite" style={[styles.selectCount, fontFace('bold')]}>
        {`${count} selected`}
      </Text>
      <View style={styles.selectActions}>
        <SelectAction label="Copy to Today" disabled={disabled || copyDisabled || empty} onPress={onCopyToToday} />
        <SelectAction label="Move" disabled={disabled || empty} onPress={onMove} />
        <SelectAction label="Delete" disabled={disabled || empty} onPress={onDelete} tone="danger" />
        <Pressable accessibilityRole="button" accessibilityLabel="Done selecting" onPress={onDone} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><DoopIcon name="close" size={16} color={colors.muted} /></Pressable>
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

const styles = StyleSheet.create({
  selectBar: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    paddingHorizontal: 4,
    height: 52,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
  },
  selectCount: {
    paddingHorizontal: 4,
    color: colors.ink,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  selectActions: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 2,
    flexShrink: 1,
  },
  selectAction: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: radius.full,
  },
  selectActionPrimary: { backgroundColor: colors.accent },
  selectActionDanger: {},
  selectActionLabel: {
    ...fontFace('semibold'),
    color: colors.ink,
    fontSize: fontSize.t11,
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
  popoverScrim: {
    backgroundColor: 'rgba(10,11,18,0.28)',
  },
  editRoot: {
    padding: 8,
    gap: 6,
  },
  editStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  editStepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editAmtWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 4,
  },
  editNumBtn: {
    minWidth: 32,
    height: 44,
    paddingHorizontal: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  editNumText: {
    ...fontFace('bold'),
    ...tabularNums,
    fontSize: 17,
    color: colors.ink,
  },
  editNumTextActive: {
    fontSize: 24,
    letterSpacing: -0.4,
    color: colors.accent,
  },
  editCaret: {
    width: 2,
    height: 22,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  editUnitBtn: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  editUnitUnderline: {
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    borderBottomColor: colors.muted,
    paddingBottom: 1,
  },
  editUnitText: {
    ...fontFace('semibold'),
    fontSize: 13,
    color: colors.muted,
  },
  editKcalWrap: {
    minWidth: 56,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 2,
  },
  editKcalNum: {
    ...fontFace('bold'),
    ...tabularNums,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  editKcalUnit: {
    ...fontFace('semibold'),
    fontSize: 10,
    color: colors.muted,
  },
  editUnitList: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.ground,
    padding: 4,
    gap: 2,
  },
  editUnitItem: {
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editUnitItemActive: {
    backgroundColor: 'rgba(122,162,247,0.14)',
  },
  editUnitItemText: {
    ...fontFace('semibold'),
    fontSize: 13,
    color: colors.ink,
  },
  editUnitItemTextActive: {
    color: colors.accent,
  },
  editKeypadWrap: {
    paddingTop: 4,
    paddingBottom: 2,
    gap: 6,
  },
  editKeypadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  editKeypadCancel: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editKeypadCancelText: {
    ...fontFace('semibold'),
    fontSize: fontSize.t12,
    color: colors.muted,
  },
  editKeypadApply: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editKeypadApplyText: {
    ...fontFace('bold'),
    fontSize: fontSize.t12,
    color: colors.onAccent,
  },
  editMealsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  editMealChip: {
    width: '48.8%',
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  editMealChipActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(122,162,247,0.16)',
  },
  editMealChipText: {
    ...fontFace('semibold'),
    fontSize: 12,
    color: colors.ink,
  },
  editMealChipTextActive: {
    ...fontFace('bold'),
    color: colors.accent,
  },
  editDayRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editDayLabel: {
    ...fontFace('semibold'),
    fontSize: 11,
    color: colors.muted,
  },
  editTodayChip: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editTodayChipActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(122,162,247,0.16)',
  },
  editTodayText: {
    ...fontFace('semibold'),
    fontSize: 11,
    color: colors.ink,
  },
  editTodayTextActive: {
    ...fontFace('bold'),
    color: colors.accent,
  },
  editDateChip: {
    flex: 1,
    minWidth: 0,
    height: 40,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  editDateText: {
    ...fontFace('semibold'),
    ...tabularNums,
    fontSize: 11,
    color: colors.ink,
    flexShrink: 1,
  },
  editRemoveBtn: {
    height: 44,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editRemoveText: {
    ...fontFace('semibold'),
    fontSize: 13,
    color: colors.danger,
  },
  pressed: { opacity: 0.7 },
});
