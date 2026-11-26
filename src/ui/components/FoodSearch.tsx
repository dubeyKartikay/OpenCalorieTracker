import { useCallback, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Path } from 'react-native-svg';
import type { HoldToLogGestureControl } from './gestures/HoldToLogPanel';
import { router } from 'expo-router';
import { useAction, useAppRuntime, useAsyncResource, usePreferences } from '../../app/AppRuntimeContext';
import { availableUnits, defaultQuantity, localDate, MEALS, mealsForDay } from '../../app/controller';
import { calculateNutrition, generateId, resolveQuantityToBasis } from '../../domain';
import type { DiaryEntrySnapshot, FoodRecord, FoodUnit, NutrientProfile, Quantity } from '../../domain';
import type { SearchCandidate } from '../../catalog';
import { foodKey } from '../../storage';
import { colors, fontFace, radius, tabularNums } from '../tokens';
import { CUSTOM_FOOD_BASIS_OPTIONS, customFoodNutrientFields, parseCustomFoodNutrients, SegmentedSwitch, type CustomFoodBasis } from './capture';
import { EntryEditPopover, LearnedPortionChips, MacroProportionBar, MealDestinationPills, NumericEditor } from './doop';
import { AnchoredPopover, measurePopoverAnchor, type PopoverAnchor } from './doop/HistoryControls';
import { HoldToLogPanel } from './gestures';
import { DoopIcon, inferFoodGlyph } from './DoopIcons';
import type { DoopIconName } from './DoopIcons';
import { energy, energyValue, ErrorMessage, number } from './primitives';

const GLOBAL_UNITS = 'library:all-foods';
const PIN_KEY = 'libraryVisualPins';
const kindOf = (food: FoodRecord) => !food.source_pack_id && food.id.startsWith('recipe:') ? 'recipe' : !food.source_pack_id && food.id.startsWith('meal:') ? 'meal' : 'food';
const formatAmount = (amount: number) => Math.abs(amount - 0.5) < 0.001 ? '½' : Math.abs(amount - 1.5) < 0.001 ? '1½' : number(amount, 2);
const labelOf = (q: Quantity) => {
  if (q.amount === 1 && /^\d/.test(q.unit)) return q.unit;
  const unit = /^1\s+/.test(q.unit) ? q.unit.replace(/^1\s+/, '') : q.unit;
  return `${formatAmount(q.amount)} ${unit}`;
};
function withUnits(food: FoodRecord, units: FoodUnit[]): FoodRecord {
  return { ...food, units: [...units.filter(unit => !food.units.some(item => item.label === unit.label)), ...food.units] };
}
function usualQuantity(food: FoodRecord): Quantity {
  const fallback = defaultQuantity(food);
  const factor = resolveQuantityToBasis(food, fallback).factor;
  const named = food.units.find(unit => { try { return Math.abs(resolveQuantityToBasis(food, { amount: 1, unit: unit.label }).factor - factor) < 0.0001; } catch { return false; } });
  return named ? { amount: 1, unit: named.label } : fallback;
}
function unitGlyph(unit: string): DoopIconName {
  return unit === 'g' || unit === 'oz' || unit === 'ml' ? 'scale' : unit === 'plate' || unit === 'serving' ? 'plate'
    : unit === 'cup' ? 'cup' : unit === 'tbsp' || unit === 'tsp' ? 'spoon' : unit === 'katori' || unit === 'bowl' ? 'katori' : inferFoodGlyph(unit);
}
function Macros({ nutrients }: { nutrients: NutrientProfile | null | undefined }) {
  return <View style={styles.macros}>{([['P', 'protein_g', colors.lavender], ['C', 'carbs_g', colors.mint], ['F', 'fat_g', colors.peach]] as const).map(([label, key, color]) =>
    <Text key={key} style={[styles.macro, { color }]}>{label} {number(nutrients?.[key], 0)}</Text>)}</View>;
}

/** Unit picker stays anchored to the portion word inside its host panel. */
function UnitMenu({ food, selected, onSelect, onClose, onSaved }: { food: FoodRecord; selected: string; onSelect: (unit: string) => void; onClose: () => void; onSaved: (food: FoodRecord, unit: string) => void }) {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const action = useAction();
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [scope, setScope] = useState<'food' | 'all'>('food');
  const units = availableUnits(food).sort((a, b) => {
    const order = ['plate', 'katori', 'bowl', 'cup', 'tbsp', 'g', 'oz', 'ml', 'serving'];
    return (order.indexOf(a) < 0 ? 20 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 20 : order.indexOf(b));
  });
  return <View style={styles.unitMenu} accessibilityLabel="Choose a portion unit">
    <View style={styles.caret} />
    <View style={styles.unitGrid}>{units.map(unit => {
      const amount = unit === 'g' || unit === 'ml' ? 100 : 1;
      const resolved = resolveQuantityToBasis(food, { amount, unit });
      const kcal = calculateNutrition(food, { amount, unit }).kcal;
      return <Pressable key={unit} accessibilityRole="button" accessibilityState={{ selected: unit === selected }} onPress={() => void action.run(async () => { const personal = food.units.find(item => item.label === unit); if (personal) await controller.savePersonalUnit(food, personal); onSelect(unit); onClose(); })} style={[styles.unitTile, unit === selected && styles.portionActive]}>
        <DoopIcon name={unitGlyph(unit)} size={12} color={unit === selected ? colors.accent : colors.muted} />
        <Text numberOfLines={1} style={[styles.unitName, unit === selected && styles.accent]}>{unit}</Text>
        <Text numberOfLines={1} style={styles.unitMeta}>{number(resolved.amount, 0)} {resolved.unit} · {number(energyValue(kcal, energyUnit))}</Text>
      </Pressable>;
    })}</View>
    <View style={styles.unitDefinition}><View style={styles.definitionRow}>
      <Text style={styles.meta}>1</Text><TextInput accessibilityLabel="Custom unit name" placeholder="bowl" placeholderTextColor={colors.muted} value={name} onChangeText={setName} style={[styles.unitInput, { width: 84 }]} />
      <Text style={styles.meta}>=</Text><TextInput accessibilityLabel="Custom unit weight" placeholder="250" placeholderTextColor={colors.muted} value={grams} onChangeText={setGrams} keyboardType="decimal-pad" style={[styles.unitInput, { width: 52 }]} /><Text style={styles.meta}>{food.basis === 'per_100ml' ? 'ml' : 'g'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Save custom unit" disabled={action.busy} onPress={() => void action.run(async () => {
        const label = name.trim();
        if (!label || !Number.isFinite(Number(grams)) || Number(grams) <= 0) throw new Error('Enter a unit name and a positive weight.');
        if (['g', 'oz', 'ml', 'l', 'serving'].includes(label.toLowerCase())) throw new Error('Choose a unit name such as bowl or katori.');
        const unit: FoodUnit = { label, grams: food.basis === 'per_100ml' ? null : Number(grams), ml: food.basis === 'per_100ml' ? Number(grams) : null };
        const updated = { ...food, units: [...food.units.filter(item => item.label !== label), unit] };
        resolveQuantityToBasis(updated, { amount: 1, unit: label });
        await controller.savePersonalUnit(food, unit);
        if (scope === 'all') await controller.deps.library.upsertUserFoodUnit(GLOBAL_UNITS, unit);
        controller.refresh(); onSaved(updated, label); onClose();
      })} style={styles.unitSave}><DoopIcon name="check" size={16} color={colors.onAccent} /></Pressable>
    </View><View style={styles.scope}>{(['food', 'all'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: scope === value }} onPress={() => setScope(value)} style={[styles.scopeOption, scope === value && styles.mealLogged]}><Text style={[styles.scopeText, scope === value && styles.onAccent]}>{value === 'food' ? 'this food' : 'all foods'}</Text></Pressable>)}</View></View>
    <ErrorMessage message={action.error} />
  </View>;
}

interface PortionEditorProps {
  food: FoodRecord; meal: string; date?: string; quantity?: Quantity; onQuantityChange?: (quantity: Quantity) => void;
  onFoodChange?: (food: FoodRecord) => void;
  entries?: DiaryEntrySnapshot[]; pinned?: boolean; onPin?: () => void; onClose?: () => void;
}
export function PortionEditor({ food: original, meal, date, quantity, onQuantityChange, onFoodChange, entries = [], pinned = false, onPin, onClose }: PortionEditorProps) {
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const meals = mealsForDay(preferences.value?.mealSections ?? [...MEALS], entries, [meal]);
  const [ownQuantity, setOwnQuantity] = useState(() => usualQuantity(original));
  const [customFood, setCustomFood] = useState<FoodRecord | null>(null);
  const food = customFood ?? original;
  const selected = quantity ?? ownQuantity;
  const [typed, setTyped] = useState<string | null>(null);
  const current = useMemo(() => typed == null ? selected : { amount: Number(typed), unit: selected.unit }, [selected, typed]);
  const [unitMenu, setUnitMenu] = useState(false);
  const action = useAction();
  const revision = controller.getRevision();
  const valid = Number.isFinite(current.amount) && current.amount > 0;
  const change = (next: Quantity) => { setOwnQuantity(next); onQuantityChange?.(next); };
  const data = useAsyncResource(useCallback(async () => {
    void revision;
    const learned = (await controller.getLearnedPortions(food))
      .filter(item => availableUnits(food).includes(item.unit))
      .map(item => ({ amount: item.amount, unit: item.unit }));
    const base = usualQuantity(food);
    const alternative = food.units.find(unit => unit.label !== base.unit && availableUnits(food).includes(unit.label));
    const candidates: Quantity[] = [...learned, base, ...(alternative ? [{ amount: 1, unit: alternative.label }] : []), { ...base, amount: base.amount / 2 }, { ...base, amount: base.amount * 2 }];
    const unique = candidates.filter((item, index) => candidates.findIndex(other => other.unit === item.unit && other.amount === item.amount) === index).slice(0, 3);
    const portions = await Promise.all(unique.map(async portion => ({ ...portion, kcal: (await controller.preview(food, { amount: portion.amount, unit: portion.unit }))?.nutrients?.kcal })));
    const parts = kindOf(food) === 'recipe' ? (await controller.getRecipe(food.id.slice(7)))?.ingredients
      : kindOf(food) === 'meal' ? (await controller.deps.library.getSavedMeal(food.id.slice(5)))?.items : undefined;
    return { portions, parts };
  }, [controller, food, revision]), foodKey(food));
  const fallbackPortions = useMemo(() => {
    const base = usualQuantity(food);
    const alternative = food.units.find(unit => unit.label !== base.unit && availableUnits(food).includes(unit.label));
    const candidates: Quantity[] = [base, ...(alternative ? [{ amount: 1, unit: alternative.label }] : []), { ...base, amount: base.amount / 2 }, { ...base, amount: base.amount * 2 }];
    return candidates
      .filter((item, index) => candidates.findIndex(other => other.unit === item.unit && other.amount === item.amount) === index)
      .slice(0, 3)
      .map(portion => {
        try { return { ...portion, kcal: calculateNutrition(food, portion).kcal }; }
        catch { return { ...portion, kcal: undefined }; }
      });
  }, [food]);
  const preview = useAsyncResource(useCallback(async () => valid ? controller.preview(food, current) : null, [controller, food, current, valid]), foodKey(food));
  const nutrients = preview.value?.nutrients ?? (valid ? (() => { try { return calculateNutrition(food, current); } catch { return undefined; } })() : undefined);
  const ratio = valid ? resolveQuantityToBasis(food, current).factor : 0;
  const selectPortion = (next: Quantity) => {
    setTyped(null); change(next);
  };
  const selectUnit = (unit: string) => void action.run(async () => {
    const mapping = food.units.find(item => item.label === unit);
    if (mapping) await controller.savePersonalUnit(food, mapping);
    change({ amount: typed == null ? 1 : Number(typed) || 1, unit });
  });
  const toggleMeal = (destination: string) => void action.run(async () => {
    const logged = entries.filter(entry => entry.meal === destination);
    if (logged.length) { await controller.deleteEntries(logged.map(entry => entry.id)); return; }
    if (!valid) throw new Error('Enter an amount greater than zero.');
    await controller.confirm({ food, quantity: current, meal: destination, ...(date ? { date } : {}), idempotencyKey: generateId() });
    change(current); setTyped(null);
  });
  return <View style={[styles.expanded, unitMenu && { minHeight: 280, zIndex: 20 }]}>
    <View style={styles.expandedHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel={'Collapse ' + food.name} onPress={onClose} style={styles.glyphWell}><DoopIcon name={inferFoodGlyph(food.name, kindOf(food))} size={20} color={colors.accent} /></Pressable>
      <View style={styles.expandedCopy}><Text numberOfLines={1} style={styles.expandedName}>{food.name}</Text>
        <View style={styles.subtitle}><Pressable accessibilityRole="button" accessibilityLabel="Choose portion unit" onPress={() => setUnitMenu(value => !value)} hitSlop={8} style={styles.portionWord}><Text style={styles.dotted}>{labelOf(current)}</Text><DoopIcon name="chevronDown" size={9} /></Pressable><Text style={styles.meta}>·</Text><Macros nutrients={nutrients} /></View>
      </View>
      <View style={styles.total}><Text style={styles.expandedKcal}>{number(energyValue(nutrients?.kcal, energyUnit))}</Text><Text style={styles.tiny}>{energyUnit}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={pinned ? 'Unpin food' : 'Pin food'} accessibilityState={{ selected: pinned }} onPress={onPin} style={styles.pinHit}><DoopIcon name="pin" size={14} color={pinned ? colors.accent : colors.muted} /></Pressable>
    </View>
    <View style={unitMenu && { opacity: 0 }} pointerEvents={unitMenu ? 'none' : 'auto'}>
      {!!data.value?.parts?.length && <View style={styles.parts}>{data.value.parts.map((part, index) => {
        const amount = part.quantity.amount * ratio;
        const partKcal = calculateNutrition(part.food, { ...part.quantity, amount }).kcal;
        let shown = { ...part.quantity, amount };
        if (current.unit === 'g' || current.unit === 'oz') {
          const resolved = resolveQuantityToBasis(part.food, shown);
          const grams = resolved.unit === 'g' ? resolved.amount : resolved.unit === 'serving' && part.food.serving_g != null ? resolved.amount * part.food.serving_g : null;
          if (grams != null) shown = { amount: grams, unit: 'g' };
        }
        return <View key={index} style={styles.part}><Text numberOfLines={1} style={styles.partName}>{part.food.name}</Text><Text style={styles.partAmount}>{labelOf(shown)}</Text><Text style={styles.partKcal}>{energy(partKcal, energyUnit)}</Text></View>;
      })}</View>}
      <MacroProportionBar proteinG={nutrients?.protein_g ?? 0} carbsG={nutrients?.carbs_g ?? 0} fatG={nutrients?.fat_g ?? 0} style={styles.macroBar} />
      <LearnedPortionChips portions={(data.value?.portions ?? fallbackPortions).map((portion, index) => ({ label: labelOf(portion), energyLabel: energy(portion.kcal, energyUnit), rankDots: index === 0 ? 3 : index === 1 ? 2 : 1, selected: typed == null && current.amount === portion.amount && current.unit === portion.unit }))}
        onSelect={index => { const portion = (data.value?.portions ?? fallbackPortions)[index]; if (portion) selectPortion({ amount: portion.amount, unit: portion.unit }); }} moreExpanded={typed != null} onMore={() => setTyped(old => old == null ? '' : null)} />
      {typed != null && (
        <NumericEditor
          value={typed}
          onChange={setTyped}
          units={availableUnits(food)}
          selectedUnit={selected.unit}
          onSelectUnit={selectUnit}
          onAddUnit={() => setUnitMenu(true)}
          maxDecimals={2}
          allowEmpty
          confirmDisabled={!valid || action.busy}
          confirmLabel="Apply custom portion"
          cancelLabel="Close custom portion"
          onConfirm={() => {
            if (!valid) return;
            selectPortion(current);
          }}
          onCancel={() => setTyped(null)}
          style={{ marginTop: 4 }}
        />
      )}
      <View style={styles.mealGap}><MealDestinationPills meals={meals} selectedMeals={entries.map(entry => entry.meal)} suggestedMeal={meal} mode="toggle" disabled={!valid || action.busy || preview.loading || typed != null} onPress={toggleMeal} /></View>
      {kindOf(food) === 'recipe' && <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: food.id.slice(7), meal, ...(date ? { date } : {}) } })} style={styles.recipeLink}><Text style={styles.recipeText}>Open recipe ›</Text></Pressable>}
    </View>
    {unitMenu && <View style={styles.menuAnchor}><UnitMenu food={food} selected={selected.unit} onClose={() => setUnitMenu(false)} onSelect={unit => { setTyped(null); change({ amount: 1, unit }); }} onSaved={(updated, unit) => { setCustomFood(updated); onFoodChange?.(updated); setTyped(null); change({ amount: 1, unit }); }} /></View>}
    <ErrorMessage message={data.error ?? preview.error ?? action.error} />
  </View>;
}

export function FoodRow({ candidate, expanded, onToggle, meal, date, searchResult = false }: { candidate: SearchCandidate; expanded: boolean; onToggle: () => void; meal: string; date?: string; searchResult?: boolean }) {
  const { food: candidateFood } = candidate;
  const [updatedFood, setUpdatedFood] = useState<FoodRecord | null>(null);
  const original = updatedFood ?? candidateFood;
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const meals = preferences.value?.mealSections ?? [...MEALS];
  const [hold, setHold] = useState(false);
  const [editAnchor, setEditAnchor] = useState<PopoverAnchor | null>(null);
  const addButtonRef = useRef<ComponentRef<typeof View> | null>(null);
  const holdControl = useRef<HoldToLogGestureControl | null>(null);
  const holdPoint = useRef({ x: 0, y: 0 });
  const holdRunning = useRef(false);
  const suppressAddUntil = useRef(0);
  const attachHold = useCallback((control: HoldToLogGestureControl | null) => {
    holdControl.current = control;
    if (control && holdRunning.current) control.start(holdPoint.current.x, holdPoint.current.y);
  }, []);
  const beginHold = useCallback((x: number, y: number) => { holdPoint.current = { x, y }; holdRunning.current = true; suppressAddUntil.current = Infinity; setEditAnchor(null); setHold(true); }, []);
  const dragHold = useCallback((x: number, y: number) => { holdPoint.current = { x, y }; holdControl.current?.update(x, y); }, []);
  const endHold = useCallback((x: number, y: number, success: boolean) => { holdRunning.current = false; suppressAddUntil.current = Date.now() + 350; if (holdControl.current) holdControl.current.finish(x, y, success); else setHold(false); }, []);
  const cancelHold = useCallback(() => { if (holdRunning.current) { holdRunning.current = false; suppressAddUntil.current = Date.now() + 350; holdControl.current?.cancel(); setHold(false); } }, []);
  const [chosen, setChosen] = useState<Quantity | null>(null);
  const action = useAction();
  const revision = controller.getRevision();
  const targetDate = date ?? localDate();
  // Keep metadata stable while another item refreshes the Library.
  const foodJson = JSON.stringify(original);
  const stableFood = useMemo<FoodRecord>(() => JSON.parse(foodJson), [foodJson]);
  const data = useAsyncResource(useCallback(async () => {
    void revision;
    const [globalUnits, learned, dayData, pins, saved] = await Promise.all([
      controller.deps.library.listUserFoodUnits(GLOBAL_UNITS), controller.deps.library.listLearnedPortions(foodKey(stableFood)), controller.day(targetDate),
      controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', PIN_KEY),
      kindOf(stableFood) === 'meal' ? controller.deps.library.getSavedMeal(stableFood.id.slice(5)) : Promise.resolve(null),
    ]);
    const food = withUnits(stableFood, globalUnits);
    const pinIds: string[] = pins ? JSON.parse(pins.value_json) : [];
    const usual = learned.find(item => availableUnits(food).includes(item.unit));
    const portion = usual ? { amount: usual.amount, unit: usual.unit } : usualQuantity(food);
    const preview = await controller.preview(food, chosen ?? portion);
    return { food, portion, preview, entries: dayData.day?.entries.filter(entry => foodKey(entry.food) === foodKey(food)) ?? [], pinIds, pinned: saved?.pinned ?? pinIds.includes(foodKey(food)), uses: learned.reduce((sum, item) => sum + item.use_count, 0) };
  }, [controller, stableFood, revision, chosen, targetDate]), `${foodKey(stableFood)}:${targetDate}`);
  const food = updatedFood ? withUnits(stableFood, data.value?.food.units ?? []) : data.value?.food ?? stableFood;
  const portion = chosen ?? data.value?.portion ?? usualQuantity(food);
  const entries = data.value?.entries ?? [];
  const pickerMeals = mealsForDay(meals, entries, [meal]);
  const logged = entries.find(entry => entry.meal === meal) ?? entries[0];
  const display = logged?.quantity ?? portion;
  const nutrients = logged?.nutrients ?? data.value?.preview?.nutrients;
  const pinned = data.value?.pinned ?? false;
  const pin = () => void action.run(async () => {
    if (kindOf(food) === 'meal') await controller.toggleSavedMealPinned(food.id.slice(5), !pinned);
    else {
      const records = await controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryPinnedFoods');
      const foods: FoodRecord[] = records ? JSON.parse(records.value_json) : [];
      const nextFoods = foods.filter(item => foodKey(item) !== foodKey(food)); if (!pinned) nextFoods.push(food);
      await controller.deps.userDb.runAsync('INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', 'libraryPinnedFoods', JSON.stringify(nextFoods), new Date().toISOString());
      const ids = (data.value?.pinIds ?? []).filter(id => id !== foodKey(food)); if (!pinned) ids.push(foodKey(food));
      await controller.deps.userDb.runAsync('INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', PIN_KEY, JSON.stringify(ids), new Date().toISOString()); controller.refresh();
    }
  });
  /* eslint-disable react-hooks/refs -- Gesture callbacks run after render. */
  // Keep minDistance huge so only a real 320ms hold on the + button activates HoldToLogPanel, never a quick tap or scroll.
  const holdGesture = useMemo(() => Gesture.Pan().enabled(!expanded && !logged && !!data.value?.preview?.nutrients).activateAfterLongPress(320).minDistance(10_000).maxPointers(1).shouldCancelWhenOutside(false)
    .onStart(event => { scheduleOnRN(beginHold, event.absoluteX, event.absoluteY); })
    .onUpdate(event => { scheduleOnRN(dragHold, event.absoluteX, event.absoluteY); })
    .onEnd((event, success) => { scheduleOnRN(endHold, event.absoluteX, event.absoluteY, success); })
    .onFinalize(() => { scheduleOnRN(cancelHold); }), [expanded, logged, data.value?.preview?.nutrients, beginHold, dragHold, endHold, cancelHold]);
  /* eslint-enable react-hooks/refs */
  return <View style={[styles.item, (Boolean(editAnchor) || expanded || hold) && { zIndex: 10 }]}>
    {!expanded && !hold && <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={'Adjust ' + food.name} accessibilityState={{ expanded }} onPress={() => { setEditAnchor(null); onToggle(); }} style={styles.rowBody}>
        <DoopIcon name={inferFoodGlyph(food.name, kindOf(food))} size={18} color={colors.muted} />
        <View style={styles.rowCopy}><View style={styles.titleRow}>{pinned && <DoopIcon name="pin" size={12} color={colors.accent} />}<Text numberOfLines={1} style={styles.rowName}>{food.name}</Text>{!searchResult && kindOf(food) !== 'meal' && !food.source_pack_id && <Text style={styles.tag}>{kindOf(food) === 'recipe' ? 'Recipe' : 'Your food'}</Text>}</View>
          <View style={styles.subtitle}>{searchResult && !logged && <><Text style={styles.meta}>{kindOf(food) === 'meal' ? 'Saved meal' : candidate.sourceLabel}</Text><Text style={styles.meta}>·</Text></>}<Text numberOfLines={1} style={styles.meta}>{labelOf(display)}</Text>
            {logged ? <><Text style={styles.meta}>·</Text><DoopIcon name="check" size={10} color={colors.mint} /><Text style={styles.loggedMeal}>{logged.meal}</Text></> : !searchResult && <><Text style={styles.meta}>·</Text><Macros nutrients={nutrients} /><Text style={styles.meta}>· {data.value?.uses ?? 0}×</Text></>}</View>
        </View>
        <Text style={styles.rowKcal}>{number(energyValue(nutrients?.kcal, energyUnit))}</Text>
      </Pressable>
      <GestureDetector gesture={holdGesture}>
        <View ref={addButtonRef} collapsable={false}>
          <Pressable accessibilityRole="button" accessibilityLabel={logged ? 'Edit logged ' + food.name : 'Log ' + food.name + ' to ' + meal} disabled={action.busy || data.loading || !data.value?.preview?.nutrients}
            onPress={() => {
              if (holdRunning.current || Date.now() < suppressAddUntil.current) return;
              if (logged) {
                measurePopoverAnchor(addButtonRef.current, setEditAnchor);
                return;
              }
              void action.run(() => controller.confirm({ food, quantity: portion, meal, date: targetDate, idempotencyKey: generateId() }));
            }}
            style={styles.addHit}>
            {!logged && <Svg pointerEvents="none" width={36} height={36} viewBox="0 0 36 36" style={styles.addAffordance}>
              <Path d="M 4 18 A 14 14 0 0 1 18 4" fill="none" stroke={colors.accent} strokeWidth={1.3} strokeOpacity={0.52} strokeLinecap="round" strokeDasharray="2 3" />
              <Circle cx={8} cy={8} r={1.4} fill={colors.accent} fillOpacity={0.8} />
            </Svg>}
            <View style={[styles.addCircle, logged && styles.mealLogged]}><DoopIcon name={logged ? 'check' : 'plus'} size={14} color={logged ? colors.onAccent : colors.ink} /></View>
          </Pressable>
        </View>
      </GestureDetector><View style={styles.rowRule} />
    </View>}
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
    {hold && <HoldToLogPanel foodLabel={food.name} portionLabel={labelOf(portion)} energyUnit={energyUnit} mealLabels={pickerMeals} kcalForMultiplier={multiplier => (data.value?.preview?.nutrients?.kcal ?? 0) * multiplier}
      onGestureReady={attachHold} onDismiss={() => setHold(false)} onLog={(destination, multiplier) => { setHold(false); void action.run(() => controller.confirm({ food, quantity: { ...portion, amount: portion.amount * multiplier }, meal: destination, date: targetDate, idempotencyKey: generateId() })); }} />}
    {expanded && !hold && <PortionEditor food={food} meal={meal} date={targetDate} quantity={portion} onQuantityChange={setChosen} onFoodChange={setUpdatedFood} entries={entries} pinned={pinned} onPin={pin} onClose={onToggle} />}
    <ErrorMessage message={action.error ?? data.error} />
  </View>;
}

export function NewCustomFood() {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<CustomFoodBasis>('per_100g');
  const [fields, setFields] = useState({ kcal: '', proteinG: '', carbsG: '', fatG: '', fiberG: '' });
  const action = useAction();
  const nutrientFields = customFoodNutrientFields(energyUnit, false);
  return <View>
    <Pressable accessibilityRole="button" onPress={() => setOpen(value => !value)} style={styles.recipeLink}>
      <Text style={styles.recipeText}>{open ? 'Close custom food' : '+ New custom food'}</Text>
    </Pressable>
    {open && <View style={styles.customForm}>
      <View style={styles.customField}>
        <Text style={styles.customLabel}>NAME</Text>
        <TextInput accessibilityLabel="Food name" placeholder="e.g. Millet cookies" placeholderTextColor={colors.muted} value={name} onChangeText={setName} style={styles.customInput} />
      </View>
      <SegmentedSwitch options={CUSTOM_FOOD_BASIS_OPTIONS} value={basis} disabled={action.busy} onChange={value => setBasis(value as CustomFoodBasis)} />
      <View style={styles.customGrid}>
        {nutrientFields.map(field => (
          <View key={field.key} style={styles.customCell}>
            <Text style={styles.customLabel}>{field.label.toUpperCase()}</Text>
            <View style={styles.customCellVal}>
              <TextInput accessibilityLabel={`${field.label} (${field.unit})`} placeholder={field.required ? '—' : 'unknown'} placeholderTextColor={colors.muted}
                value={fields[field.key as keyof typeof fields]} keyboardType="decimal-pad" onChangeText={value => setFields(old => ({ ...old, [field.key]: value }))} style={styles.customCellInput} />
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
        setName(''); setFields({ kcal: '', proteinG: '', carbsG: '', fatG: '', fiberG: '' }); setOpen(false);
      })} style={[styles.customSave, action.busy && { opacity: 0.45 }]}>
        <Text style={styles.customSaveText}>Save food</Text>
      </Pressable>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  item: { position: 'relative', backgroundColor: colors.ground }, row: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 4 }, rowBody: { flex: 1, minWidth: 0, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowCopy: { flex: 1, minWidth: 0, gap: 1 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 }, rowName: { flexShrink: 1, ...fontFace('semibold'), color: colors.ink, fontSize: 14, lineHeight: 18 }, tag: { ...fontFace('medium'), color: colors.muted, fontSize: 10, opacity: 0.7 },
  subtitle: { flexDirection: 'row', alignItems: 'center', gap: 4, overflow: 'hidden' }, meta: { ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 11, lineHeight: 15 }, macros: { flexDirection: 'row', gap: 4 }, macro: { ...fontFace('semibold'), ...tabularNums, fontSize: 10, lineHeight: 15 }, loggedMeal: { ...fontFace('semibold'), fontSize: 11, color: colors.mint },
  rowKcal: { width: 43, textAlign: 'right', color: colors.ink, ...fontFace('semibold'), ...tabularNums, fontSize: 14 }, addHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, addAffordance: { position: 'absolute' }, addCircle: { width: 26, height: 26, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, rowRule: { position: 'absolute', bottom: 0, left: 28, right: 0, height: 1, backgroundColor: colors.hairline },
  expanded: { position: 'relative', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline, paddingTop: 13, paddingBottom: 14, gap: 6 }, expandedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  glyphWell: { width: 40, height: 40, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, expandedCopy: { flex: 1, minWidth: 0, gap: 2 }, expandedName: { ...fontFace('bold'), fontSize: 18, color: colors.ink, letterSpacing: -0.2 }, portionWord: { flexDirection: 'row', alignItems: 'center', gap: 3 }, dotted: { ...fontFace('medium'), ...tabularNums, fontSize: 11, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.muted, borderStyle: 'dotted' },
  total: { flexDirection: 'row', alignItems: 'baseline', gap: 2 }, expandedKcal: { ...fontFace('bold'), ...tabularNums, fontSize: 22, letterSpacing: -0.8, color: colors.ink }, tiny: { ...fontFace('semibold'), color: colors.muted, fontSize: 10 }, pinHit: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  parts: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline, paddingVertical: 5, gap: 1 }, part: { height: 18, flexDirection: 'row', alignItems: 'baseline', gap: 10 }, partName: { flex: 1, ...fontFace('medium'), fontSize: 13, color: colors.ink }, partAmount: { width: 64, textAlign: 'right', ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 11 }, partKcal: { width: 62, textAlign: 'right', ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 11 }, macroBar: { marginTop: 6, marginBottom: 6 }, mealGap: { marginTop: 6 },
  mealLogged: { backgroundColor: colors.accent, borderColor: colors.accent }, onAccent: { color: colors.onAccent }, accent: { color: colors.accent }, portionActive: { borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.12)' },
  menuAnchor: { position: 'absolute', left: 10, right: 10, top: 60, zIndex: 40 }, unitMenu: { padding: 8, gap: 7, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r16, elevation: 14, boxShadow: '0 14px 26px rgba(0,0,0,0.38)' }, caret: { position: 'absolute', left: 24, top: -6, width: 10, height: 10, borderLeftWidth: 1, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, transform: [{ rotate: '45deg' }] }, unitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, unitTile: { width: '32%', height: 46, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.ground, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }, unitName: { ...fontFace('bold'), fontSize: 11, color: colors.ink }, unitMeta: { ...fontFace('medium'), ...tabularNums, fontSize: 9, color: colors.muted },
  unitDefinition: { borderTopWidth: 1, borderColor: colors.hairline, paddingTop: 7, gap: 6 }, definitionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 }, unitInput: { height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r8, backgroundColor: colors.ground, color: colors.ink, ...fontFace('semibold'), fontSize: 11, textAlign: 'center', padding: 2 }, unitSave: { marginLeft: 'auto', width: 40, height: 40, backgroundColor: colors.accent, borderRadius: radius.r8, alignItems: 'center', justifyContent: 'center' }, scope: { width: 186, height: 40, flexDirection: 'row', gap: 2, padding: 2, borderRadius: radius.r8, backgroundColor: colors.ground }, scopeOption: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, scopeText: { ...fontFace('semibold'), color: colors.muted, fontSize: 11 },
  recipeLink: { minHeight: 44, justifyContent: 'center' }, recipeText: { ...fontFace('semibold'), fontSize: 13, color: colors.accent },
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
