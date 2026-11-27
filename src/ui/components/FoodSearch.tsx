import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { useAction, useAppRuntime, useAsyncResource, usePreferences } from '../../app/AppRuntimeContext';
import { availableUnits, defaultQuantity, localDate, MEALS, mealsForDay } from '../../app/controller';
import { calculateNutrition, generateId, resolveQuantityToBasis } from '../../domain';
import type { DiaryEntrySnapshot, FoodRecord, FoodUnit, NutrientProfile, Quantity } from '../../domain';
import type { SearchCandidate } from '../../catalog';
import { foodKey } from '../../storage';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../haptics';
import { colors, fontFace, radius, tabularNums } from '../tokens';
import { CUSTOM_FOOD_BASIS_OPTIONS, customFoodNutrientFields, parseCustomFoodNutrients, SegmentedSwitch, type CustomFoodBasis } from './capture';
import {
  appendFallbackUnits,
  buildCustomFoodUnit,
  buildPortionCandidates,
  formatQuantityLabel,
  kindOfFood,
  mergeSelectedPortion,
  previewCustomUnitKcal,
  pricePortionCandidates,
  supportedBaseUnits,
  type CustomBaseUnit,
} from './customUnitMath';
import { EntryEditPopover, LearnedPortionChips, MacroProportionBar, MealDestinationPills, NumericEditor } from './doop';
import { AnchoredPopover, measurePopoverAnchor, type PopoverAnchor } from './doop/HistoryControls';
import { SwipeToPinRow } from './gestures';
import { DoopIcon, inferFoodGlyph } from './DoopIcons';
import { energy, energyValue, ErrorMessage, number } from './primitives';

export const GLOBAL_UNITS = 'library:all-foods';
export const PIN_KEY = 'libraryVisualPins';
export const kindOf = kindOfFood;
export const labelOf = formatQuantityLabel;
export const withUnits = appendFallbackUnits;
export function usualQuantity(food: FoodRecord): Quantity {
  const fallback = defaultQuantity(food);
  const factor = resolveQuantityToBasis(food, fallback).factor;
  const named = food.units.find(unit => { try { return Math.abs(resolveQuantityToBasis(food, { amount: 1, unit: unit.label }).factor - factor) < 0.0001; } catch { return false; } });
  return named ? { amount: 1, unit: named.label } : fallback;
}
const UNIT_SCOPE_OPTIONS = [
  { value: 'food', label: 'This food' },
  { value: 'all', label: 'All foods' },
];

/** Compact inline custom-unit creator (`1 [name] = [amount] [base ▾]`) that stays inside the open card. */
export function InlineCustomUnitForm({
  food,
  showScope = false,
  onSaved,
  onCancel,
  onEnsureVisible,
}: {
  food: FoodRecord;
  showScope?: boolean;
  onSaved: (food: FoodRecord, unit: string) => void;
  onCancel: () => void;
  onEnsureVisible?: ((node: ComponentRef<typeof View> | null) => void) | undefined;
}) {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const action = useAction();
  const baseUnits = useMemo(() => supportedBaseUnits(food), [food]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [scope, setScope] = useState<'food' | 'all'>('food');
  const [selectedBase, setSelectedBase] = useState<CustomBaseUnit>(() => baseUnits[0] ?? 'g');
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const formRef = useRef<ComponentRef<typeof View> | null>(null);
  const amountRef = useRef<ComponentRef<typeof TextInput> | null>(null);

  useEffect(() => {
    onEnsureVisible?.(formRef.current);
    return () => {
      onEnsureVisible?.(null);
    };
  }, [basePickerOpen, onEnsureVisible]);

  const baseUnit: CustomBaseUnit = baseUnits.includes(selectedBase) ? selectedBase : (baseUnits[0] ?? 'g');
  const numericAmount = Number(amount);
  const canSave = name.trim().length > 0 && Number.isFinite(numericAmount) && numericAmount > 0 && !action.busy;
  const previewKcal = useMemo(
    () => previewCustomUnitKcal(food, name, amount, baseUnit),
    [amount, baseUnit, food, name],
  );

  const submit = () => {
    void action.run(async () => {
      const { unit, updatedFood } = buildCustomFoodUnit(food, name, Number(amount), baseUnit);
      await controller.savePersonalUnit(food, unit);
      if (showScope && scope === 'all') {
        await controller.deps.library.upsertUserFoodUnit(GLOBAL_UNITS, unit);
        controller.refresh();
      }
      Keyboard.dismiss();
      hapticSuccess();
      onSaved(updatedFood, unit.label);
    });
  };

  return (
    <View ref={formRef} collapsable={false} style={styles.unitForm} accessibilityLabel="Add custom portion unit">
      <View style={styles.unitEqRow}>
        <Text style={styles.unitEqLabel}>1</Text>
        <TextInput
          autoFocus
          accessibilityLabel="Custom unit name"
          placeholder="bowl"
          placeholderTextColor={colors.muted}
          value={name}
          onChangeText={setName}
          onFocus={() => onEnsureVisible?.(formRef.current)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => amountRef.current?.focus()}
          style={[styles.unitEqInput, styles.unitNameInput]}
        />
        <Text style={styles.unitEqLabel}>=</Text>
        <TextInput
          ref={amountRef}
          accessibilityLabel="Custom unit amount"
          placeholder={baseUnit === 'serving' ? '1' : '250'}
          placeholderTextColor={colors.muted}
          value={amount}
          onChangeText={setAmount}
          onFocus={() => onEnsureVisible?.(formRef.current)}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={() => { if (canSave) submit(); }}
          style={[styles.unitEqInput, styles.unitAmountInput]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Base unit ${baseUnit}`}
          accessibilityState={baseUnits.length > 1 ? { expanded: basePickerOpen } : undefined}
          disabled={baseUnits.length <= 1}
          onPress={() => setBasePickerOpen(open => !open)}
          style={({ pressed }) => [
            styles.baseUnitTrigger,
            basePickerOpen && styles.baseUnitTriggerOpen,
            pressed && baseUnits.length > 1 && { opacity: 0.72 },
          ]}
        >
          <Text style={[styles.baseUnitText, basePickerOpen && styles.accent]}>{baseUnit}</Text>
          {baseUnits.length > 1 ? (
            <View style={basePickerOpen ? { transform: [{ rotate: '180deg' }] } : undefined}>
              <DoopIcon name="chevronDown" size={12} color={basePickerOpen ? colors.accent : colors.muted} />
            </View>
          ) : null}
        </Pressable>
      </View>

      {basePickerOpen && baseUnits.length > 1 ? (
        <View style={styles.baseUnitMenu} accessibilityLabel="Select base unit">
          {baseUnits.map(option => {
            const active = option === baseUnit;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={`Base unit ${option}`}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  hapticSelection();
                  setSelectedBase(option);
                  setBasePickerOpen(false);
                }}
                style={({ pressed }) => [
                  styles.baseUnitOption,
                  active && styles.baseUnitOptionActive,
                  pressed && { opacity: 0.72 },
                ]}
              >
                <Text style={[styles.baseUnitOptionText, active && styles.onAccent]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {showScope ? (
        <SegmentedSwitch
          options={UNIT_SCOPE_OPTIONS}
          value={scope}
          disabled={action.busy}
          onChange={value => setScope(value as 'food' | 'all')}
        />
      ) : null}

      <View style={styles.unitFooterRow}>
        <Text numberOfLines={1} style={previewKcal != null ? styles.unitPreviewText : styles.unitHintText}>
          {previewKcal != null
            ? `1 ${name.trim() || 'unit'} · ${energy(previewKcal, energyUnit)}`
            : `e.g. 1 bowl = ${baseUnit === 'serving' ? '0.5 serving' : `250 ${baseUnit}`}`}
        </Text>
        <View style={styles.unitActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel custom unit"
            disabled={action.busy}
            onPress={() => {
              Keyboard.dismiss();
              onCancel();
            }}
            style={({ pressed }) => [styles.unitCancelBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.unitCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save custom unit"
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            onPress={submit}
            style={({ pressed }) => [
              styles.unitSaveBtn,
              !canSave && styles.unitSaveBtnDisabled,
              pressed && canSave && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.unitSaveText}>{action.busy ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
      </View>
      <ErrorMessage message={action.error} />
    </View>
  );
}

const HOLD_OPEN_DELAY_MS = 380;
const HOLD_VISUAL_GRACE_MS = 90;

/** Quiet dashed orbital ring + top dot echoing Today's hold-gesture language. */
function HoldOrbitMark({ size, strokeWidth = 1.15, opacity = 0.55 }: { size: number; strokeWidth?: number; opacity?: number }) {
  const half = size / 2;
  const r = half - strokeWidth - 0.8;
  const dotR = size >= 24 ? 1.5 : 1.1;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} pointerEvents="none">
      <Circle
        cx={half}
        cy={half}
        r={r}
        fill="none"
        stroke={colors.border}
        strokeWidth={strokeWidth}
        strokeOpacity={opacity}
        strokeDasharray={size >= 24 ? '3 3.5' : '2 2.2'}
      />
      <Circle cx={half} cy={half - r} r={dotR} fill={colors.muted} fillOpacity={Math.min(1, opacity + 0.15)} />
    </Svg>
  );
}

interface PortionEditorProps {
  food: FoodRecord; meal: string; date?: string; quantity?: Quantity; onQuantityChange?: (quantity: Quantity) => void;
  onFoodChange?: (food: FoodRecord) => void;
  onPreviewChange?: (live: { quantity: Quantity; nutrients: NutrientProfile | undefined } | null) => void;
  entries?: DiaryEntrySnapshot[]; entriesReady?: boolean; onClose?: () => void;
  onDetailHoldStart?: () => void; onDetailHoldEnd?: () => void; onDetailHoldOpen?: () => void;
  onEnsureVisible?: ((node: ComponentRef<typeof View> | null) => void) | undefined;
}
export function PortionEditor({ food: original, meal, date, quantity, onQuantityChange, onFoodChange, onPreviewChange, entries = [], entriesReady = true, onDetailHoldStart, onDetailHoldEnd, onDetailHoldOpen, onEnsureVisible }: PortionEditorProps) {
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const meals = mealsForDay(preferences.value?.mealSections ?? [...MEALS], entries, [meal]);
  const [ownQuantity, setOwnQuantity] = useState(() => usualQuantity(original));
  const [customFoodOverride, setCustomFoodOverride] = useState<{ base: FoodRecord; food: FoodRecord } | null>(null);
  const food = customFoodOverride?.base === original ? customFoodOverride.food : original;
  const validUnits = useMemo(() => availableUnits(food), [food]);
  const rawSelected = quantity ?? ownQuantity;
  const selected = useMemo(
    () => (validUnits.includes(rawSelected.unit) ? rawSelected : usualQuantity(food)),
    [food, rawSelected, validUnits],
  );
  const [typedState, setTypedState] = useState<{ unit: string; value: string } | null>(null);
  const typed = typedState && validUnits.includes(typedState.unit) ? typedState.value : null;
  const hasTyped = typed != null && typed.trim() !== '';
  const current = useMemo(
    () => (hasTyped ? { amount: Number(typed), unit: selected.unit } : selected),
    [hasTyped, selected, typed],
  );
  const [addingUnit, setAddingUnit] = useState(false);
  const canAddCustomUnit = useMemo(() => supportedBaseUnits(food).length > 0, [food]);
  const action = useAction();
  const revision = controller.getRevision();
  const valid = Number.isFinite(current.amount) && current.amount > 0;
  const change = (next: Quantity) => { setOwnQuantity(next); onQuantityChange?.(next); };
  const data = useAsyncResource(useCallback(async () => {
    void revision;
    const learned = await controller.getLearnedPortions(food);
    const unique = buildPortionCandidates(food, usualQuantity(food), validUnits, learned);
    const portions = await Promise.all(
      unique.map(async portion => {
        const result = await controller.preview(food, portion).catch(() => null);
        return { ...portion, kcal: result?.nutrients?.kcal };
      }),
    );
    const parts = kindOf(food) === 'recipe' ? (await controller.getRecipe(food.id.slice(7)))?.ingredients
      : kindOf(food) === 'meal' ? (await controller.deps.library.getSavedMeal(food.id.slice(5)))?.items : undefined;
    return { portions, parts };
  }, [controller, food, revision, validUnits]), foodKey(food));
  const fallbackPortions = useMemo(() => {
    const unique = buildPortionCandidates(food, usualQuantity(food), validUnits);
    return pricePortionCandidates(food, unique);
  }, [food, validUnits]);
  const preview = useAsyncResource(
    useCallback(async () => (valid ? controller.preview(food, current) : null), [controller, food, current, valid]),
    `${foodKey(food)}:${current.amount}:${current.unit}`,
  );
  const nutrients = useMemo(() => {
    if (preview.value?.nutrients) return preview.value.nutrients;
    if (!valid) return undefined;
    try { return calculateNutrition(food, current); } catch { return undefined; }
  }, [current, food, preview.value, valid]);

  useEffect(() => {
    onPreviewChange?.(valid ? { quantity: current, nutrients } : null);
  }, [current, nutrients, onPreviewChange, valid]);
  useEffect(() => () => { onPreviewChange?.(null); }, [onPreviewChange]);

  const selectPortion = (next: Quantity) => {
    setAddingUnit(false);
    setTypedState(null);
    change(next);
  };
  const selectUnit = (unit: string) => {
    setAddingUnit(false);
    if (typed != null) setTypedState({ unit, value: typed });
    const nextAmount = hasTyped ? (Number(typed) || 1) : (unit === 'g' || unit === 'ml' ? 100 : 1);
    change({ amount: nextAmount, unit });
  };
  const toggleMeal = (destination: string) => void action.run(async () => {
    if (!entriesReady) return;
    const logged = entries.filter(entry => entry.meal === destination);
    if (logged.length) { await controller.deleteEntries(logged.map(entry => entry.id)); return; }
    if (!valid) throw new Error('Enter an amount greater than zero.');
    await controller.confirm({ food, quantity: current, meal: destination, ...(date ? { date } : {}), idempotencyKey: generateId() });
    change(current); setTypedState(null); setAddingUnit(false);
  });
  const basePortions = useMemo(() => {
    const validSet = new Set(validUnits);
    const filtered = (data.value?.portions ?? fallbackPortions).filter(portion => validSet.has(portion.unit));
    return filtered.length > 0 ? filtered : fallbackPortions;
  }, [data.value?.portions, fallbackPortions, validUnits]);
  const displayedPortions = useMemo(
    () => mergeSelectedPortion(basePortions, food, selected),
    [basePortions, food, selected],
  );
  const partNames = data.value?.parts?.map(part => part.food.name).join(' · ') ?? '';
  const isRecipe = kindOf(food) === 'recipe';

  return <View style={styles.expanded}>
    <LearnedPortionChips
      variant="calm"
      portions={displayedPortions.map(portion => ({
        label: labelOf(portion, food),
        energyLabel: energy(portion.kcal, energyUnit),
        selected: !hasTyped && current.amount === portion.amount && current.unit === portion.unit,
      }))}
      onSelect={index => {
        const portion = displayedPortions[index];
        if (portion) selectPortion({ amount: portion.amount, unit: portion.unit });
      }}
      moreExpanded={typed != null}
      onMore={() => {
        setAddingUnit(false);
        setTypedState(old => (old && validUnits.includes(old.unit) ? null : { unit: selected.unit, value: '' }));
      }}
    />
    {typed != null && (
      <NumericEditor
        value={typed}
        placeholder={number(selected.amount, 2)}
        onChange={value => setTypedState({ unit: selected.unit, value })}
        units={validUnits}
        selectedUnit={selected.unit}
        onSelectUnit={selectUnit}
        onAddUnit={canAddCustomUnit ? () => setAddingUnit(open => !open) : undefined}
        addUnitActive={addingUnit}
        unitEditor={
          <InlineCustomUnitForm
            food={food}
            onEnsureVisible={onEnsureVisible}
            onCancel={() => setAddingUnit(false)}
            onSaved={(updated, unit) => {
              setCustomFoodOverride({ base: original, food: updated });
              onFoodChange?.(updated);
              setAddingUnit(false);
              setTypedState(null);
              change({ amount: 1, unit });
            }}
          />
        }
        maxDecimals={2}
        allowEmpty
        confirmDisabled={!hasTyped || !valid || action.busy}
        confirmLabel="Apply custom portion"
        cancelLabel="Close custom portion"
        onConfirm={() => {
          if (!valid) return;
          selectPortion(current);
        }}
        onCancel={() => {
          setAddingUnit(false);
          setTypedState(null);
        }}
        style={{ marginTop: 10 }}
      />
    )}
    <Pressable
      delayLongPress={HOLD_OPEN_DELAY_MS}
      onPressIn={onDetailHoldStart}
      onPressOut={onDetailHoldEnd}
      onLongPress={onDetailHoldOpen}
    >
      <MacroProportionBar proteinG={nutrients?.protein_g ?? 0} carbsG={nutrients?.carbs_g ?? 0} fatG={nutrients?.fat_g ?? 0} height={4} gap={2} style={styles.macroBar} />
      <View style={styles.macroWordsRow}>
        <View style={styles.macroWords}>
          {([
            ['protein', 'protein_g', colors.lavender],
            ['carbs', 'carbs_g', colors.mint],
            ['fat', 'fat_g', colors.peach],
          ] as const).map(([label, key, color]) => (
            <View key={key} style={styles.macroWord}>
              <View style={[styles.macroDot, { backgroundColor: color }]} />
              <Text style={styles.macroWordText}>{`${number(nutrients?.[key], 0)} g ${label}`}</Text>
            </View>
          ))}
        </View>
      </View>
    </Pressable>
    <View style={styles.mealGap}>
      <MealDestinationPills
        variant="calm"
        meals={meals}
        selectedMeals={entries.map(entry => entry.meal)}
        suggestedMeal={meal}
        mode="toggle"
        disabled={!valid || !entriesReady || action.busy || preview.loading || addingUnit}
        onPress={toggleMeal}
      />
    </View>
    {partNames ? (
      <View style={styles.footerRow}>
        {isRecipe ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open recipe ${food.name}`}
            onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: food.id.slice(7), meal, ...(date ? { date } : {}) } })}
            style={({ pressed }) => [styles.partsLink, pressed && { opacity: 0.7 }]}
          >
            <Text numberOfLines={1} style={styles.partsText}>{partNames}</Text>
            <DoopIcon name="chevronRight" size={16} color={colors.muted} />
          </Pressable>
        ) : (
          <Text numberOfLines={1} style={[styles.partsText, styles.partsSaved]}>{partNames}</Text>
        )}
      </View>
    ) : null}
    <ErrorMessage message={data.error ?? preview.error ?? action.error} />
  </View>;
}

export interface LibrarySharedContext {
  ready: boolean;
  globalUnits: FoodUnit[];
  entriesByFoodKey: Map<string, DiaryEntrySnapshot[]>;
  pinIds: Set<string>;
  savedMealPins: Set<string>;
  learnedByFoodKey: Map<string, Quantity[]>;
  energyUnit: 'kcal' | 'kJ';
  meals: string[];
}

type LivePreviewState = { quantity: Quantity; nutrients: NutrientProfile | undefined } | null;

function sameLivePreview(a: LivePreviewState, b: LivePreviewState): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.quantity.amount === b.quantity.amount &&
    a.quantity.unit === b.quantity.unit &&
    a.nutrients?.kcal === b.nutrients?.kcal &&
    a.nutrients?.protein_g === b.nutrients?.protein_g &&
    a.nutrients?.carbs_g === b.nutrients?.carbs_g &&
    a.nutrients?.fat_g === b.nutrients?.fat_g
  );
}

export function FoodRow({
  candidate,
  expanded,
  onToggle,
  meal,
  date,
  searchResult = false,
  shared,
  onEnsureVisible,
}: {
  candidate: SearchCandidate;
  expanded: boolean;
  onToggle: () => void;
  meal: string;
  date?: string;
  searchResult?: boolean;
  shared?: LibrarySharedContext | undefined;
  onEnsureVisible?: ((node: ComponentRef<typeof View> | null) => void) | undefined;
}) {
  const { food: candidateFood } = candidate;
  const [updatedFood, setUpdatedFood] = useState<{ base: FoodRecord; food: FoodRecord } | null>(null);
  const key = foodKey(candidateFood);
  const original = updatedFood?.base === candidateFood ? updatedFood.food : candidateFood;
  const { controller } = useAppRuntime();
  const hasShared = shared !== undefined;
  const ownPreferences = useAsyncResource(
    useCallback(async () => (hasShared ? null : controller.getPreferences()), [controller, hasShared]),
    hasShared ? 'shared-prefs' : 'row-prefs',
  );
  const energyUnit = shared?.energyUnit ?? ownPreferences.value?.energyUnit ?? 'kcal';
  const meals = shared?.meals ?? ownPreferences.value?.mealSections ?? [...MEALS];
  const [editAnchor, setEditAnchor] = useState<PopoverAnchor | null>(null);
  const [livePreview, setLivePreviewRaw] = useState<LivePreviewState>(null);
  const setLivePreview = useCallback((next: LivePreviewState) => {
    setLivePreviewRaw(prev => (sameLivePreview(prev, next) ? prev : next));
  }, []);
  const addButtonRef = useRef<ComponentRef<typeof View> | null>(null);
  const [chosen, setChosen] = useState<Quantity | null>(null);
  const action = useAction();
  const revision = controller.getRevision();
  const targetDate = date ?? localDate();

  const rowMeta = useAsyncResource(useCallback(async () => {
    void revision;
    if (hasShared) return null;
    const [globalUnits, learned, dayData, pins, saved] = await Promise.all([
      controller.deps.library.listUserFoodUnits(GLOBAL_UNITS),
      controller.deps.library.listLearnedPortions(key),
      controller.day(targetDate),
      controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', PIN_KEY),
      kindOf(candidateFood) === 'meal' ? controller.deps.library.getSavedMeal(candidateFood.id.slice(5)) : Promise.resolve(null),
    ]);
    const pinIds: string[] = pins ? JSON.parse(pins.value_json) : [];
    return {
      learned,
      fallbackGlobalUnits: globalUnits,
      fallbackEntries: dayData.day?.entries.filter(entry => foodKey(entry.food) === key) ?? [],
      fallbackPinned: saved?.pinned ?? pinIds.includes(key),
    };
  }, [candidateFood, controller, hasShared, key, revision, targetDate]), `${key}:${hasShared ? 'shared' : targetDate}`);

  const globalUnits = shared ? shared.globalUnits : rowMeta.value?.fallbackGlobalUnits;
  const food = useMemo(
    () => (globalUnits && globalUnits.length > 0 ? withUnits(original, globalUnits) : original),
    [globalUnits, original],
  );
  const validUnits = useMemo(() => availableUnits(food), [food]);
  const learnedList = shared ? shared.learnedByFoodKey.get(key) : rowMeta.value?.learned;
  const learnedPortion = useMemo(() => {
    if (!learnedList?.length) return null;
    const usual = learnedList.find(item => validUnits.includes(item.unit));
    return usual ? { amount: usual.amount, unit: usual.unit } : null;
  }, [learnedList, validUnits]);
  const safeChosen = useMemo(
    () => (chosen && validUnits.includes(chosen.unit) ? chosen : null),
    [chosen, validUnits],
  );
  const portion = useMemo(
    () => safeChosen ?? learnedPortion ?? usualQuantity(food),
    [food, learnedPortion, safeChosen],
  );
  const localNutrients = useMemo(() => {
    try {
      return calculateNutrition(food, portion);
    } catch {
      return undefined;
    }
  }, [food, portion]);

  const metaReady = shared ? shared.ready : Boolean(rowMeta.value);
  const entries = shared ? (shared.entriesByFoodKey.get(key) ?? []) : (rowMeta.value?.fallbackEntries ?? []);
  const pickerMeals = mealsForDay(meals, entries, [meal]);
  const logged = entries.find(entry => entry.meal === meal) ?? entries[0];
  const activeQuantity = expanded && livePreview ? livePreview.quantity : portion;
  const display = expanded && livePreview ? livePreview.quantity : (logged?.quantity ?? portion);
  const nutrients = expanded && livePreview ? livePreview.nutrients : (logged?.nutrients ?? localNutrients);
  const pinned = shared
    ? (kindOf(food) === 'meal' ? shared.savedMealPins.has(food.id) : shared.pinIds.has(key))
    : (rowMeta.value?.fallbackPinned ?? false);
  const pin = useCallback(() => {
    void action.run(() => controller.toggleFoodPin(food, !pinned));
  }, [action, controller, food, pinned]);
  const suppressTapUntilRef = useRef(0);
  const reducedMotion = useReducedMotion();
  const detailCharge = useSharedValue(0);
  const detailScale = useSharedValue(1);
  const startDetailHold = useCallback(() => {
    if (Date.now() < suppressTapUntilRef.current) return;
    cancelAnimation(detailCharge);
    cancelAnimation(detailScale);
    if (reducedMotion) {
      detailCharge.set(withDelay(HOLD_VISUAL_GRACE_MS, withTiming(1, { duration: 120 })));
      return;
    }
    const chargeMs = HOLD_OPEN_DELAY_MS - HOLD_VISUAL_GRACE_MS;
    detailCharge.set(withDelay(HOLD_VISUAL_GRACE_MS, withTiming(1, { duration: chargeMs, easing: Easing.out(Easing.cubic) })));
    detailScale.set(withDelay(HOLD_VISUAL_GRACE_MS, withTiming(0.982, { duration: chargeMs, easing: Easing.out(Easing.cubic) })));
  }, [detailCharge, detailScale, reducedMotion]);
  const cancelDetailHold = useCallback(() => {
    cancelAnimation(detailCharge);
    cancelAnimation(detailScale);
    detailCharge.set(withTiming(0, { duration: 150, easing: Easing.out(Easing.cubic) }));
    detailScale.set(reducedMotion ? 1 : withSpring(1, { damping: 22, stiffness: 340, mass: 0.7 }));
  }, [detailCharge, detailScale, reducedMotion]);
  const handleSwipeStart = useCallback(() => {
    suppressTapUntilRef.current = Infinity;
    setEditAnchor(null);
    cancelDetailHold();
  }, [cancelDetailHold]);
  const handleSwipeEnd = useCallback(() => {
    if (suppressTapUntilRef.current === Infinity) {
      suppressTapUntilRef.current = Date.now() + 260;
    }
  }, []);
  const openFullDetail = useCallback(() => {
    if (Date.now() < suppressTapUntilRef.current) return;
    setEditAnchor(null);
    hapticMedium();
    cancelAnimation(detailCharge);
    cancelAnimation(detailScale);
    detailCharge.set(withTiming(0, { duration: 180 }));
    if (!reducedMotion) {
      detailScale.set(withSequence(
        withTiming(1.018, { duration: 95, easing: Easing.out(Easing.cubic) }),
        withSpring(1, { damping: 20, stiffness: 320, mass: 0.75 }),
      ));
    }
    const validAmount = Number.isFinite(display.amount) && display.amount > 0;
    router.push({
      pathname: '/food',
      params: {
        id: food.id,
        ...(food.source_pack_id ? { packId: food.source_pack_id } : {}),
        meal,
        date: targetDate,
        ...(validAmount ? { amount: String(display.amount), unit: display.unit } : {}),
      },
    });
  }, [detailCharge, detailScale, display.amount, display.unit, food.id, food.source_pack_id, meal, reducedMotion, targetDate]);
  const cardScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: detailScale.value }],
  }));
  const holdWashStyle = useAnimatedStyle(() => ({
    opacity: detailCharge.value,
  }));
  const holdRingStyle = useAnimatedStyle(() => ({
    opacity: detailCharge.value,
    transform: [{ scale: interpolate(detailCharge.value, [0, 1], [1.18, 1]) }],
  }));
  const holdBarStyle = useAnimatedStyle(() => ({
    opacity: detailCharge.value > 0.01 ? 1 : 0,
    width: `${detailCharge.value * 100}%`,
  }));
  return <View style={[styles.item, (Boolean(editAnchor) || expanded) && { zIndex: 10 }]}>
    <SwipeToPinRow
      pinned={pinned}
      disabled={action.busy || !metaReady}
      onTogglePin={pin}
      onSwipeStart={handleSwipeStart}
      onSwipeEnd={handleSwipeEnd}
      cardStyle={[styles.cardShell, cardScaleStyle]}
      header={
        <>
          <Animated.View pointerEvents="none" style={[styles.holdWash, holdWashStyle]} />
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse ' + food.name : 'Adjust ' + food.name}
              accessibilityHint={`Tap to adjust portion, hold for full nutrition, or slide right to ${pinned ? 'unpin' : 'pin'}`}
              accessibilityState={{ expanded }}
              accessibilityActions={[
                { name: 'longpress', label: 'Open full nutrition and actions' },
                { name: 'togglePin', label: pinned ? 'Unpin food' : 'Pin food' },
              ]}
              onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === 'longpress') openFullDetail();
                else if (event.nativeEvent.actionName === 'togglePin') {
                  hapticLight();
                  pin();
                }
              }}
              delayLongPress={HOLD_OPEN_DELAY_MS}
              onPressIn={startDetailHold}
              onPressOut={cancelDetailHold}
              onLongPress={openFullDetail}
              onPress={() => {
                if (Date.now() < suppressTapUntilRef.current) return;
                hapticSelection();
                setEditAnchor(null);
                onToggle();
              }}
              style={styles.rowBody}
            >
              <View style={styles.iconCol}>
                <View style={styles.glyphWell}>
                  <View style={styles.glyphOrbit} pointerEvents="none">
                    <HoldOrbitMark size={32} />
                  </View>
                  <Animated.View pointerEvents="none" style={[styles.glyphChargeRing, holdRingStyle]} />
                  <DoopIcon name={inferFoodGlyph(food.name, kindOf(food))} size={19} color={colors.muted} />
                </View>
              </View>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowName}>{food.name}</Text>
                <Text numberOfLines={1} style={styles.meta}>
                  {searchResult && !logged ? `${kindOf(food) === 'meal' ? 'Saved meal' : candidate.sourceLabel} · ` : ''}
                  {labelOf(display, food)}
                  {logged ? <> · <Text style={styles.loggedMeal}>{logged.meal}</Text></> : null}
                </Text>
              </View>
              <Text style={styles.rowKcal}>{number(energyValue(nutrients?.kcal, energyUnit))}</Text>
            </Pressable>
            <View ref={addButtonRef} collapsable={false}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={logged ? 'Edit logged ' + food.name : 'Log ' + food.name + ' to ' + meal}
                disabled={action.busy || !metaReady || (!logged && ((expanded && !livePreview) || !nutrients))}
                onPress={() => {
                  if (!metaReady || Date.now() < suppressTapUntilRef.current) return;
                  if (logged) {
                    hapticLight();
                    measurePopoverAnchor(addButtonRef.current, setEditAnchor);
                    return;
                  }
                  void action.run(async () => {
                    await controller.confirm({ food, quantity: activeQuantity, meal, date: targetDate, idempotencyKey: generateId() });
                    hapticSuccess();
                  });
                }}
                style={styles.addHit}
              >
                <View style={[styles.addCircle, logged && styles.mealLogged]}>
                  <DoopIcon name={logged ? 'check' : 'plus'} size={18} strokeWidth={logged ? 2.6 : 2} color={logged ? colors.onAccent : colors.muted} />
                </View>
              </Pressable>
            </View>
            {!expanded && <View style={styles.rowRule} />}
          </View>
          <View pointerEvents="none" style={styles.holdTrack}>
            <Animated.View style={[styles.holdProgress, holdBarStyle]} />
          </View>
        </>
      }
      expandedBody={
        expanded ? (
          <PortionEditor
            food={food}
            meal={meal}
            date={targetDate}
            quantity={safeChosen ?? logged?.quantity ?? portion}
            onQuantityChange={setChosen}
            onFoodChange={next => setUpdatedFood({ base: candidateFood, food: next })}
            onPreviewChange={setLivePreview}
            entries={entries}
            entriesReady={metaReady}
            onClose={onToggle}
            onDetailHoldStart={startDetailHold}
            onDetailHoldEnd={cancelDetailHold}
            onDetailHoldOpen={openFullDetail}
            onEnsureVisible={onEnsureVisible}
          />
        ) : null
      }
    />
    <AnchoredPopover anchor={logged ? editAnchor : null} onClose={() => setEditAnchor(null)} width={304} label="Edit entry">
      {logged ? (
        <EntryEditPopover
          entry={logged}
          meals={pickerMeals}
          energyUnit={energyUnit}
          busy={action.busy}
          onUpdateQuantity={quantity => void action.run(() => controller.updateEntryQuantity(logged, quantity))}
          onMoveMeal={destination => void action.run(async () => {
            if (destination !== logged.meal) await controller.moveEntry(logged, destination);
            setEditAnchor(null);
          })}
          onRemove={() => void action.run(async () => {
            await controller.deleteEntry(logged.id);
            setEditAnchor(null);
          })}
        />
      ) : null}
    </AnchoredPopover>
    <ErrorMessage message={action.error ?? rowMeta.error} />
  </View>;
}

export function NewCustomFood({
  onEnsureVisible,
}: {
  onEnsureVisible?: ((node: ComponentRef<typeof View> | null) => void) | undefined;
} = {}) {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<CustomFoodBasis>('per_100g');
  const [fields, setFields] = useState({ kcal: '', proteinG: '', carbsG: '', fatG: '', fiberG: '' });
  const formRef = useRef<ComponentRef<typeof View> | null>(null);
  const action = useAction();
  const nutrientFields = customFoodNutrientFields(energyUnit, false);
  useEffect(() => {
    if (open) onEnsureVisible?.(formRef.current);
  }, [onEnsureVisible, open]);
  return <View>
    <Pressable accessibilityRole="button" onPress={() => setOpen(value => !value)} style={styles.recipeLink}>
      <Text style={styles.recipeText}>{open ? 'Close custom food' : '+ New custom food'}</Text>
    </Pressable>
    {open && <View ref={formRef} collapsable={false} style={styles.customForm}>
      <View style={styles.customField}>
        <Text style={styles.customLabel}>NAME</Text>
        <TextInput accessibilityLabel="Food name" placeholder="e.g. Millet cookies" placeholderTextColor={colors.muted} value={name} onChangeText={setName} onFocus={() => onEnsureVisible?.(formRef.current)} style={styles.customInput} />
      </View>
      <SegmentedSwitch options={CUSTOM_FOOD_BASIS_OPTIONS} value={basis} disabled={action.busy} onChange={value => setBasis(value as CustomFoodBasis)} />
      <View style={styles.customGrid}>
        {nutrientFields.map(field => (
          <View key={field.key} style={styles.customCell}>
            <Text style={styles.customLabel}>{field.label.toUpperCase()}</Text>
            <View style={styles.customCellVal}>
              <TextInput accessibilityLabel={`${field.label} (${field.unit})`} placeholder={field.required ? '—' : 'unknown'} placeholderTextColor={colors.muted}
                value={fields[field.key as keyof typeof fields]} keyboardType="decimal-pad" onFocus={() => onEnsureVisible?.(formRef.current)} onChangeText={value => setFields(old => ({ ...old, [field.key]: value }))} style={styles.customCellInput} />
              <Text style={styles.tiny}>{field.unit}</Text>
            </View>
          </View>
        ))}
      </View>
      <ErrorMessage message={action.error} />
      <Pressable accessibilityRole="button" disabled={action.busy} onPress={() => void action.run(async () => {
        if (!name.trim()) throw new Error('Enter a food name before saving.');
        const nutrients = parseCustomFoodNutrients(fields, energyUnit);
        await controller.saveCustomFood({ id: generateId(), name: name.trim(), basis, prep_state: 'unknown', provenance_kind: 'user', nutrients });
        hapticSuccess();
        setName(''); setFields({ kcal: '', proteinG: '', carbsG: '', fatG: '', fiberG: '' }); setOpen(false);
      })} style={[styles.customSave, action.busy && { opacity: 0.45 }]}>
        <Text style={styles.customSaveText}>Save food</Text>
      </Pressable>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  item: { position: 'relative', backgroundColor: colors.ground },
  cardShell: { position: 'relative' },
  holdWash: { position: 'absolute', top: 2, bottom: 2, left: 0, right: 0, borderRadius: radius.r12, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(122,162,247,0.34)' },
  holdTrack: { position: 'absolute', bottom: 0, left: 38, right: 0, height: 2, overflow: 'hidden', borderRadius: 1 },
  holdProgress: { height: '100%', backgroundColor: colors.accent, borderRadius: 1 },
  row: { height: 68, flexDirection: 'row', alignItems: 'center' },
  rowBody: { flex: 1, minWidth: 0, height: '100%', flexDirection: 'row', alignItems: 'center' },
  iconCol: { width: 38, alignItems: 'flex-start', justifyContent: 'center' },
  glyphWell: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -3 },
  glyphOrbit: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  glyphChargeRing: { position: 'absolute', inset: 0, borderRadius: 16, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.12)' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { ...fontFace('semibold'), color: colors.ink, fontSize: 17, lineHeight: 21 },
  meta: { ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 14, lineHeight: 18, marginTop: 3 },
  loggedMeal: { ...fontFace('medium'), color: colors.success },
  rowKcal: { marginHorizontal: 14, textAlign: 'right', color: colors.ink, ...fontFace('semibold'), ...tabularNums, fontSize: 17 },
  addHit: { width: 44, height: 44, marginRight: -2, alignItems: 'center', justifyContent: 'center' },
  addCircle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  rowRule: { position: 'absolute', bottom: 0, left: 38, right: 0, height: 1, backgroundColor: colors.hairline },
  expanded: { position: 'relative', marginLeft: 38, paddingTop: 2, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  macroBar: { marginTop: 16 },
  macroWordsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  macroWords: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4 },
  macroWord: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  macroDot: { width: 7, height: 7, borderRadius: 3.5 },
  macroWordText: { ...fontFace('medium'), ...tabularNums, fontSize: 13, color: colors.muted },
  mealGap: { marginTop: 14 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  partsLink: { flex: 1, minWidth: 0, minHeight: 44, marginVertical: -10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  partsSaved: { flex: 1, minWidth: 0 },
  partsText: { ...fontFace('medium'), fontSize: 14, color: colors.muted, flexShrink: 1 },
  mealLogged: { backgroundColor: colors.accent, borderColor: colors.accent },
  onAccent: { color: colors.onAccent },
  accent: { color: colors.accent },
  unitForm: { gap: 10 },
  unitEqRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unitEqLabel: { ...fontFace('semibold'), ...tabularNums, fontSize: 14, color: colors.muted },
  unitEqInput: { height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r12, backgroundColor: colors.dock, color: colors.ink, ...fontFace('semibold'), fontSize: 14, paddingHorizontal: 10, paddingVertical: 0 },
  unitNameInput: { flex: 1.35, minWidth: 72 },
  unitAmountInput: { flex: 0.9, minWidth: 56, textAlign: 'center', ...tabularNums },
  baseUnitTrigger: { height: 40, minWidth: 56, paddingHorizontal: 10, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  baseUnitTriggerOpen: { borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.14)' },
  baseUnitText: { ...fontFace('semibold'), fontSize: 13, color: colors.ink },
  baseUnitMenu: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  baseUnitOption: { height: 34, minWidth: 46, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground, alignItems: 'center', justifyContent: 'center' },
  baseUnitOptionActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  baseUnitOptionText: { ...fontFace('semibold'), fontSize: 12.5, color: colors.muted },
  unitFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  unitPreviewText: { ...fontFace('semibold'), ...tabularNums, fontSize: 12.5, color: colors.accent, flex: 1, minWidth: 0 },
  unitHintText: { ...fontFace('medium'), fontSize: 12, color: colors.muted, flex: 1, minWidth: 0 },
  unitActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unitCancelBtn: { height: 36, paddingHorizontal: 10, borderRadius: radius.r12, alignItems: 'center', justifyContent: 'center' },
  unitCancelText: { ...fontFace('semibold'), fontSize: 13, color: colors.muted },
  unitSaveBtn: { height: 36, paddingHorizontal: 14, borderRadius: radius.r12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  unitSaveBtnDisabled: { opacity: 0.4 },
  unitSaveText: { ...fontFace('bold'), fontSize: 13, color: colors.onAccent },
  tiny: { ...fontFace('semibold'), color: colors.muted, fontSize: 10 },
  recipeLink: { minHeight: 44, justifyContent: 'center' },
  recipeText: { ...fontFace('semibold'), fontSize: 13, color: colors.accent },
  customForm: { gap: 12, paddingTop: 6, paddingBottom: 14, borderTopWidth: 1, borderTopColor: colors.hairline },
  customField: { borderBottomWidth: 1, borderBottomColor: colors.hairline, paddingVertical: 6, gap: 3 },
  customLabel: { ...fontFace('semibold'), fontSize: 10, letterSpacing: 0.7, color: colors.muted },
  customInput: { ...fontFace('semibold'), fontSize: 15, color: colors.ink, paddingVertical: 4 },
  customGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  customCell: { width: '31.2%', minHeight: 54, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 7, justifyContent: 'space-between' },
  customCellVal: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  customCellInput: { ...fontFace('bold'), ...tabularNums, fontSize: 15, color: colors.ink, padding: 0, flex: 1, minWidth: 0 },
  customSave: { height: 44, borderRadius: radius.r12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  customSaveText: { ...fontFace('bold'), fontSize: 14, color: colors.onAccent },
});
