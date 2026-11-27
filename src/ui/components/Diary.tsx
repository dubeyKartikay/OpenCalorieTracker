import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { DiaryEntrySnapshot, GoalPeriod, NutrientAggregate } from '../../domain';
import { sumNutrients } from '../../domain';
import { useAction, useAppRuntime, usePreferences } from '../../app/AppRuntimeContext';
import { MEALS } from '../../app/controller';
import { hapticLight, hapticSelection, hapticSuccess, hapticWarning } from '../haptics';
import { colors, fontFace, macroColors, radius, tabularNums } from '../tokens';
import { AnchoredPopover, EntryEditPopover, measurePopoverAnchor, type PopoverAnchor } from './doop/HistoryControls';
import type { CompletenessStatus } from './doop/CompletenessMark';
import { RevealPanel } from './doop/Motion';
import { DraggableEntryRow, MealDropBadge, MealDropHighlight, mealDropStyles, useMealEntryDrag } from './gestures';
import { DoopIcon, mealDaypartGlyph } from './DoopIcons';
import { energyValue, ErrorMessage, number } from './primitives';

export function MacroRow({ totals, goal }: { totals: NutrientAggregate; goal?: GoalPeriod | null }) {
  return <View style={styles.macros}>{([
    ['Protein', 'protein_g', macroColors.protein], ['Carbs', 'carbs_g', macroColors.carbs],
    ['Fat', 'fat_g', macroColors.fat], ['Fiber', 'fiber_g', colors.muted],
  ] as const).map(([label, key, color]) => <View key={key} style={styles.macro}>
    <View style={styles.macroHeading}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.macroLabel}>{label}</Text></View>
    <Text style={styles.macroValue}>{number(totals.nutrients?.[key])}<Text style={styles.macroTarget}>{goal?.[key] != null ? `/${number(goal[key])} g` : ' g'}</Text></Text>
    {key === 'fiber_g' && totals.unknownCount[key] > 0 && <Text style={styles.partial}>· partial</Text>}
  </View>)}</View>;
}

export function Budget({ totals, goal, leadMetric = 'calories', waterMl = 0 }: {
  totals: NutrientAggregate; goal: GoalPeriod | null; leadMetric?: 'calories' | 'protein' | 'fiber' | 'water'; waterMl?: number;
}) {
  const unit = usePreferences().value?.energyUnit ?? 'kcal';
  const reducedMotion = useReducedMotion();
  const target = goal?.target_kcal;
  const consumed = totals.nutrients?.kcal ?? 0;
  const remaining = target != null ? target - consumed : totals.nutrients?.kcal;
  const value = leadMetric === 'calories' ? energyValue(remaining, unit) : leadMetric === 'water' ? waterMl
    : leadMetric === 'protein' ? totals.nutrients?.protein_g : totals.nutrients?.fiber_g;
  const suffix = leadMetric === 'calories' ? `${unit}${target != null ? ' left' : ''}` : leadMetric === 'water' ? 'ml water' : leadMetric === 'protein' ? 'g protein' : 'g fiber';

  const hasTarget = target != null && target > 0;
  const targetRatio = hasTarget ? Math.min(1, Math.max(0, consumed / target)) : 0;
  const fillProgress = useSharedValue(targetRatio);

  useEffect(() => {
    if (reducedMotion) fillProgress.set(targetRatio);
    else fillProgress.set(withTiming(targetRatio, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, [fillProgress, reducedMotion, targetRatio]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fillProgress.value * 100}%`,
  }));

  const pKcal = Math.max(0, totals.nutrients?.protein_g ?? 0) * 4;
  const cKcal = Math.max(0, totals.nutrients?.carbs_g ?? 0) * 4;
  const fKcal = Math.max(0, totals.nutrients?.fat_g ?? 0) * 9;
  const macroKcalSum = pKcal + cKcal + fKcal;

  return <View style={styles.budget}>
    <View style={styles.budgetHeading}>
      <View style={styles.budgetLeft}><Text style={styles.hero}>{number(value)}</Text><Text style={styles.budgetUnit}>{suffix}</Text></View>
      <Text style={styles.budgetRatio}>{number(energyValue(totals.nutrients?.kcal, unit))}{target != null ? ` / ${number(energyValue(target, unit))}` : ` ${unit} logged`}</Text>
    </View>
    {hasTarget ? (
      <View accessibilityRole="progressbar" accessibilityLabel="Daily energy" accessibilityValue={{ min: 0, max: target, now: consumed }} style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: consumed > target ? colors.warning : colors.accent }, fillStyle]} />
      </View>
    ) : (
      <View accessibilityRole="progressbar" accessibilityLabel={consumed > 0 ? 'Logged macro balance' : 'Daily energy progress'} accessibilityValue={{ min: 0, max: Math.max(1, Math.round(consumed)), now: Math.round(consumed) }} style={[styles.track, styles.macroTrack]}>
        {macroKcalSum > 0 ? <>
          <View style={[styles.macroSegment, { flex: pKcal, backgroundColor: macroColors.protein }]} />
          <View style={[styles.macroSegment, { flex: cKcal, backgroundColor: macroColors.carbs }]} />
          <View style={[styles.macroSegment, { flex: fKcal, backgroundColor: macroColors.fat }]} />
        </> : consumed > 0 ? (
          <View style={[styles.fill, { width: '100%', backgroundColor: colors.accent }]} />
        ) : null}
      </View>
    )}
    <View style={styles.macroDivider}><MacroRow totals={totals} goal={goal} /></View>
  </View>;
}

export interface MealRailShellProps {
  meal: string;
  logged: boolean;
  totalText: string;
  hasNext: boolean;
  nextLogged: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string | undefined;
  accessibilityExpanded?: boolean | undefined;
  subtitle?: ReactNode | undefined;
  onPressHeader: (node: ComponentRef<typeof View> | null) => void;
  onLongPressHeader?: (() => void) | undefined;
  dragEntry?: DiaryEntrySnapshot | null | undefined;
  dragDisabled?: boolean | undefined;
  ending: ReactNode;
  children?: ReactNode | undefined;
}

/** Shared Doop icon-rail meal section shell used by both Today and History tabs. */
export function MealRailShell({
  meal,
  logged,
  totalText,
  hasNext,
  nextLogged,
  accessibilityLabel,
  accessibilityHint,
  accessibilityExpanded,
  subtitle,
  onPressHeader,
  onLongPressHeader,
  dragEntry,
  dragDisabled = false,
  ending,
  children,
}: MealRailShellProps) {
  const drag = useMealEntryDrag();
  const headerRef = useRef<ComponentRef<typeof View> | null>(null);
  const isDropEligible = Boolean(drag?.isDragging && drag.draggingFromMeal && drag.draggingFromMeal !== meal);
  const isDropHovered = isDropEligible && drag?.hoveredMeal === meal;
  const isLanded = drag?.recentlyDroppedMeal === meal;
  const dropState = isDropHovered ? 'hovered' : isDropEligible ? 'eligible' : isLanded ? 'landed' : 'none';

  const headerBody = (
    <Pressable
      ref={headerRef}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityExpanded === undefined ? undefined : { expanded: accessibilityExpanded }}
      onLongPress={onLongPressHeader}
      onPress={() => {
        if (drag?.shouldSuppressTap()) return;
        onPressHeader(headerRef.current);
      }}
      style={styles.mealBody}
    >
      <View style={[styles.node, !logged && styles.emptyNode, isDropHovered && mealDropStyles.iconWellHovered]}>
        <DoopIcon name={mealDaypartGlyph(meal)} size={27} color={isDropHovered ? colors.accent : logged ? colors.ink : colors.muted} />
      </View>
      <View style={styles.mealCopy}>
        <Text numberOfLines={1} style={styles.mealName}>{meal}</Text>
        {subtitle}
      </View>
      <Text style={[styles.mealKcal, !logged && { color: colors.muted }]}>{totalText}</Text>
    </Pressable>
  );

  return (
    <View ref={drag?.registerDropZone(meal)} collapsable={false}>
      <MealDropHighlight state={dropState} />
      {hasNext && <View pointerEvents="none" style={[styles.rail, { backgroundColor: logged && nextLogged ? colors.accent : colors.hairline }]} />}
      <View style={styles.mealRow}>
        {dragEntry ? (
          <DraggableEntryRow entry={dragEntry} sourceMeal={meal} disabled={dragDisabled} style={styles.mealBodyWrap}>
            {headerBody}
          </DraggableEntryRow>
        ) : (
          headerBody
        )}
        {isDropEligible ? <MealDropBadge active={isDropHovered} /> : ending}
      </View>
      {children}
    </View>
  );
}

/** The rail stays behind the icon wells while details expand in the same flow. */
export function TodayMealRow({
  meal,
  entries,
  ending,
  hasNext,
  nextLogged,
  expanded: controlledExpanded,
  onExpandedChange,
  children,
}: {
  meal: string;
  entries: DiaryEntrySnapshot[];
  ending: ReactNode;
  hasNext: boolean;
  nextLogged: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children?: ReactNode;
}) {
  const { controller } = useAppRuntime();
  const action = useAction();
  const preferences = usePreferences();
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const configuredMeals = preferences.value?.mealSections ?? [...MEALS];
  const drag = useMealEntryDrag();
  const [localExpanded, setLocalExpanded] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editAnchor, setEditAnchor] = useState<PopoverAnchor | null>(null);
  const logged = entries.length > 0;
  const expanded = (controlledExpanded ?? localExpanded) && logged;
  const setExpanded = (next: boolean) => {
    if (onExpandedChange) onExpandedChange(next);
    else setLocalExpanded(next);
  };
  const latest = entries[entries.length - 1];
  const singleEntry = !expanded && entries.length === 1 ? entries[0] : null;
  const activeEntry = entries.find(item => item.id === editingEntryId) ?? null;

  const closeEditor = () => setEditAnchor(null);

  return (
    <MealRailShell
      meal={meal}
      logged={logged}
      totalText={logged ? number(energyValue(sumNutrients(entries).nutrients?.kcal, unit)) : '—'}
      hasNext={hasNext}
      nextLogged={nextLogged}
      accessibilityLabel={`${meal}, ${logged ? `${number(energyValue(sumNutrients(entries).nutrients?.kcal, unit))} ${unit}, ${entries.length} entries. Show details` : 'no entries'}`}
      accessibilityHint={singleEntry ? 'Tap to expand, or hold and drag to move to another meal' : logged ? 'Tap to expand entries' : undefined}
      accessibilityExpanded={expanded}
      subtitle={latest ? (
        <View style={styles.previewRow}>
          <Text numberOfLines={1} style={styles.preview}>{latest.food.name}</Text>
          {entries.length > 1 && <Text style={styles.previewMore}>· {entries.length - 1} more</Text>}
        </View>
      ) : undefined}
      dragEntry={singleEntry}
      dragDisabled={action.busy}
      onLongPressHeader={!expanded && entries.length > 1 ? () => {
        setExpanded(true);
        hapticSelection();
      } : undefined}
      onPressHeader={() => {
        if (logged) {
          hapticSelection();
          setExpanded(!expanded);
        }
      }}
      ending={ending}
    >
      <RevealPanel visible={expanded} direction="down" style={styles.entries}>
        {entries.map(entry => (
          <TodayEntryItem
            key={entry.id}
            entry={entry}
            meal={meal}
            unit={unit}
            busy={action.busy}
            isEditing={Boolean(editAnchor) && editingEntryId === entry.id}
            onEdit={(node) => {
              if (drag?.shouldSuppressTap()) return;
              measurePopoverAnchor(node, measured => {
                setEditingEntryId(entry.id);
                setEditAnchor(measured);
              });
            }}
            onDelete={() => {
              hapticWarning();
              void action.run(() => controller.deleteEntry(entry.id));
            }}
          />
        ))}
        <ErrorMessage message={action.error} />
      </RevealPanel>
      <AnchoredPopover anchor={activeEntry ? editAnchor : null} onClose={closeEditor} width={304} label="Edit entry">
        {activeEntry ? (
          <EntryEditPopover
            entry={activeEntry}
            meals={configuredMeals}
            energyUnit={unit}
            busy={action.busy}
            onUpdateQuantity={quantity => void action.run(() => controller.updateEntryQuantity(activeEntry, quantity))}
            onMoveMeal={destination => void action.run(async () => {
              if (destination !== activeEntry.meal) await controller.moveEntries([activeEntry.id], activeEntry.date, destination);
              closeEditor();
            })}
            onRemove={() => void action.run(async () => {
              await controller.deleteEntry(activeEntry.id);
              closeEditor();
              setEditingEntryId(null);
            })}
          />
        ) : null}
      </AnchoredPopover>
      {children}
    </MealRailShell>
  );
}

function TodayEntryItem({
  entry,
  meal,
  unit,
  busy,
  isEditing,
  onEdit,
  onDelete,
}: {
  entry: DiaryEntrySnapshot;
  meal: string;
  unit: 'kcal' | 'kJ';
  busy: boolean;
  isEditing: boolean;
  onEdit: (node: ComponentRef<typeof View> | null) => void;
  onDelete: () => void;
}) {
  const rowRef = useRef<ComponentRef<typeof View> | null>(null);
  return (
    <DraggableEntryRow entry={entry} sourceMeal={meal} disabled={busy || isEditing} style={styles.entry}>
      <View ref={rowRef} collapsable={false} style={styles.entryLine}>
        <View style={styles.dragGrip} accessible={false}>
          <DoopIcon name="grip" size={14} color={colors.muted} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${entry.food.name}`}
          accessibilityHint="Tap to edit, or hold and drag to move to another meal"
          accessibilityState={{ expanded: isEditing }}
          style={styles.entryCopy}
          onPress={() => onEdit(rowRef.current)}
        >
          <Text style={styles.entryName}>{entry.food.name}</Text>
          <Text style={styles.preview}>{number(entry.quantity.amount, 2)} {entry.quantity.unit}</Text>
        </Pressable>
        <Text style={styles.entryName}>{number(energyValue(entry.nutrients.kcal, unit))}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${entry.food.name}`}
          disabled={busy}
          onPress={onDelete}
          style={styles.iconButton}
        >
          <DoopIcon name="close" size={15} color={colors.muted} />
        </Pressable>
      </View>
    </DraggableEntryRow>
  );
}

export function DayCompletenessToggle({
  status,
  disabled = false,
  onToggle,
}: {
  status: CompletenessStatus;
  disabled?: boolean | undefined;
  onToggle: (next: 'complete' | 'partial') => void;
}) {
  const isComplete = status === 'complete';
  const nextStatus: 'complete' | 'partial' = isComplete ? 'partial' : 'complete';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isComplete ? 'Day complete' : 'Mark day complete'}
      accessibilityHint={isComplete ? 'Tap to revert day to draft' : 'Tap to mark day complete'}
      accessibilityState={{ selected: isComplete, disabled }}
      disabled={disabled}
      onPress={() => {
        if (nextStatus === 'complete') hapticSuccess();
        else hapticSelection();
        onToggle(nextStatus);
      }}
      style={({ pressed }) => [
        styles.completenessHit,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.completenessCircle, isComplete && styles.completenessCircleComplete]}>
        <DoopIcon
          name="check"
          size={16}
          strokeWidth={isComplete ? 2.2 : 1.7}
          color={isComplete ? colors.success : colors.muted}
        />
      </View>
    </Pressable>
  );
}

export function UndoToast() {
  const { controller } = useAppRuntime();
  const action = useAction();
  const undo = controller.undoAction;
  return <RevealPanel visible={!!undo} direction="up">
    {undo ? <View style={styles.undo}><View accessibilityLiveRegion="polite" style={styles.undoLine}>
      <Text numberOfLines={1} style={[styles.entryName, { flex: 1 }]}>{undo.label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Undo: ${undo.label}`} disabled={action.busy} onPress={() => { hapticLight(); void action.run(() => controller.undo()); }} style={styles.iconButton}><DoopIcon name="undo" color={colors.accent} size={17} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss undo" onPress={controller.dismissUndo} style={styles.iconButton}><DoopIcon name="close" color={colors.muted} size={15} /></Pressable>
    </View><ErrorMessage message={action.error} /></View> : null}
  </RevealPanel>;
}

const styles = StyleSheet.create({
  budget: { paddingTop: 4 },
  budgetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  budgetLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  hero: { ...fontFace('extrabold'), fontVariant: [...tabularNums.fontVariant], fontSize: 48, lineHeight: 58, letterSpacing: -1.5, color: colors.ink },
  budgetUnit: { ...fontFace('medium'), fontSize: 13, color: colors.muted },
  budgetRatio: { ...fontFace('semibold'), fontVariant: [...tabularNums.fontVariant], fontSize: 13, color: colors.muted },
  track: { height: 8, borderRadius: radius.full, overflow: 'hidden', backgroundColor: colors.track, marginTop: 8 },
  macroTrack: { flexDirection: 'row', gap: 1.5 },
  macroSegment: { height: '100%' },
  fill: { height: '100%', borderRadius: radius.full },
  macroDivider: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.hairline },
  macros: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  macro: { flex: 1, minWidth: 0, gap: 4 },
  macroHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  macroLabel: { ...fontFace('semibold'), fontSize: 12, color: colors.muted },
  macroValue: { ...fontFace('bold'), fontVariant: [...tabularNums.fontVariant], fontSize: 18, lineHeight: 22, color: colors.ink, letterSpacing: -0.3 },
  macroTarget: { ...fontFace('medium'), fontSize: 12, color: colors.muted, letterSpacing: 0 },
  partial: { ...fontFace('semibold'), fontSize: 10, color: colors.muted },
  rail: { position: 'absolute', left: 19.25, top: 53, bottom: -13, width: 1.5 },
  mealRow: { height: 66, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mealBodyWrap: { flex: 1, minWidth: 0, height: '100%' },
  mealBody: { flex: 1, minWidth: 0, height: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 },
  node: { width: 40, height: 40, borderRadius: radius.r20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center' },
  emptyNode: { backgroundColor: colors.ground, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(122,162,247,0.45)' },
  mealCopy: { flex: 1, minWidth: 0, gap: 1 },
  mealName: { ...fontFace('semibold'), fontSize: 16, lineHeight: 20, letterSpacing: -0.16, color: colors.ink },
  previewRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  preview: { ...fontFace('medium'), fontSize: 12, lineHeight: 16, color: colors.muted, flexShrink: 1 },
  previewMore: { ...fontFace('medium'), fontSize: 12, lineHeight: 16, color: colors.muted },
  mealKcal: { ...fontFace('bold'), fontVariant: [...tabularNums.fontVariant], fontSize: 24, lineHeight: 34, letterSpacing: -0.48, color: colors.ink, textAlign: 'right', minWidth: 48 },
  entries: { marginLeft: 52 },
  entry: { borderTopWidth: 1, borderTopColor: colors.hairline },
  entryLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  dragGrip: { width: 16, alignItems: 'center', justifyContent: 'center', opacity: 0.65 },
  entryCopy: { flex: 1, paddingVertical: 8 },
  entryName: { ...fontFace('semibold'), fontSize: 13, color: colors.ink },
  iconButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  undo: { borderRadius: radius.r12, backgroundColor: colors.surface, paddingLeft: 12 },
  undoLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  completenessHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  completenessCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.25,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completenessCircleComplete: {
    borderStyle: 'solid',
    borderColor: 'rgba(158, 206, 106, 0.52)',
    backgroundColor: 'rgba(158, 206, 106, 0.16)',
  },
});
