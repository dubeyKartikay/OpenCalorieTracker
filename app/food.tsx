import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useAction, useAppRuntime, useAsyncResource, usePreferences } from '../src/app/AppRuntimeContext';
import { availableUnits, localDate, MEALS, mealsForDay, parseRouteDate } from '../src/app/controller';
import { calculateNutrition, diaryEntrySnapshotSchema, foodRecordSchema, generateId, resolveQuantityToBasis } from '../src/domain';
import type { DiaryEntrySnapshot, FoodRecord, FoodUnit, NutrientProfile, Quantity, RecipeIngredient } from '../src/domain';
import { foodKey } from '../src/storage';
import { UndoToast } from '../src/ui/components/Diary';
import { DoopIcon, inferFoodGlyph } from '../src/ui/components/DoopIcons';
import { GLOBAL_UNITS, kindOf, labelOf, PIN_KEY, UnitMenu, usualQuantity, withUnits } from '../src/ui/components/FoodSearch';
import { CUSTOM_FOOD_BASIS_OPTIONS, customFoodNutrientFields, parseCustomFoodNutrients, SegmentedSwitch, useScrollNodeIntoView, type CustomFoodBasis } from '../src/ui/components/capture';
import { LearnedPortionChips, MacroProportionBar, MealDestinationPills, NumericEditor, RevealPanel } from '../src/ui/components/doop';
import { BackHeader, Button, energy, energyValue, ErrorMessage, goBackOrReplace, Muted, number, Page, SectionRule } from '../src/ui/components/primitives';
import { colors, fontFace, radius, SCREEN_GUTTER, spacing, tabularNums } from '../src/ui/tokens';

function paramString(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function basisLabel(food: FoodRecord): string {
  if (food.basis === 'per_100g') return 'per 100 g';
  if (food.basis === 'per_100ml') return 'per 100 ml';
  if (food.serving_g != null) return `per serving (${number(food.serving_g, 0)} g)`;
  if (food.serving_ml != null) return `per serving (${number(food.serving_ml, 0)} ml)`;
  return 'per serving';
}

function prepLabel(prep: FoodRecord['prep_state']): string | null {
  if (prep === 'unknown') return null;
  return prep[0]!.toUpperCase() + prep.slice(1);
}

function macroShare(proteinG: number, carbsG: number, fatG: number) {
  const p = Math.max(0, proteinG) * 4;
  const c = Math.max(0, carbsG) * 4;
  const f = Math.max(0, fatG) * 9;
  const total = p + c + f;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: Math.round((p / total) * 100),
    carbs: Math.round((c / total) * 100),
    fat: Math.round((f / total) * 100),
  };
}

function formatShareText(
  food: FoodRecord,
  portion: Quantity,
  nutrients: NutrientProfile | undefined,
  energyUnit: 'kcal' | 'kJ',
): string {
  const lines = [`${food.name}${food.brand ? ` (${food.brand})` : ''}`, `Portion: ${labelOf(portion)}`];
  if (!nutrients) return lines.join('\n');
  lines.push(`Energy: ${energy(nutrients.kcal, energyUnit)}`);
  lines.push(`Protein: ${number(nutrients.protein_g, 1)} g · Carbs: ${number(nutrients.carbs_g, 1)} g · Fat: ${number(nutrients.fat_g, 1)} g`);
  const extras: [string, number | null, string][] = [
    ['Fiber', nutrients.fiber_g, 'g'],
    ['Sugar', nutrients.sugar_g, 'g'],
    ['Saturated fat', nutrients.sat_fat_g, 'g'],
    ['Sodium', nutrients.sodium_mg, 'mg'],
    ['Potassium', nutrients.potassium_mg, 'mg'],
    ['Calcium', nutrients.calcium_mg, 'mg'],
    ['Iron', nutrients.iron_mg, 'mg'],
  ];
  for (const [label, value, unit] of extras) {
    if (value != null) lines.push(`${label}: ${number(value, 1)} ${unit}`);
  }
  return lines.join('\n');
}

function NutrientRow({
  label,
  value,
  unit,
  sub = false,
  bold = false,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  sub?: boolean;
  bold?: boolean;
}) {
  const known = value != null && Number.isFinite(value);
  return (
    <View style={[styles.nutRow, sub && styles.nutRowSub]}>
      <Text style={[styles.nutLabel, bold && styles.nutLabelBold, sub && styles.nutLabelSub]}>{label}</Text>
      <Text style={[styles.nutValue, !known && styles.nutUnknown, bold && styles.nutValueBold]}>
        {known ? `${number(value, unit === 'mg' ? 0 : 1)} ${unit}` : '—'}
      </Text>
    </View>
  );
}

function CustomFoodEditor({
  food,
  energyUnit,
  busy,
  onSave,
  onCancel,
}: {
  food: FoodRecord;
  energyUnit: 'kcal' | 'kJ';
  busy: boolean;
  onSave: (updated: FoodRecord) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(food.name);
  const [brand, setBrand] = useState(food.brand ?? '');
  const [basis, setBasis] = useState<CustomFoodBasis>(food.basis);
  const initialEnergy = energyValue(food.nutrients.kcal, energyUnit);
  const [fields, setFields] = useState({
    kcal: initialEnergy == null ? '' : String(Math.round(initialEnergy * 10) / 10),
    proteinG: String(food.nutrients.protein_g),
    carbsG: String(food.nutrients.carbs_g),
    fatG: String(food.nutrients.fat_g),
    fiberG: food.nutrients.fiber_g == null ? '' : String(food.nutrients.fiber_g),
    sugarG: food.nutrients.sugar_g == null ? '' : String(food.nutrients.sugar_g),
  });
  const [error, setError] = useState<string | null>(null);
  const nutrientFields = customFoodNutrientFields(energyUnit, true);

  const submit = () => {
    try {
      setError(null);
      if (!name.trim()) throw new Error('Enter a food name before saving.');
      const parsed = parseCustomFoodNutrients(fields, energyUnit);
      const updated = foodRecordSchema.parse({
        ...food,
        name: name.trim(),
        brand: brand.trim() || null,
        basis,
        nutrients: {
          ...food.nutrients,
          kcal: parsed.kcal,
          protein_g: parsed.protein_g,
          carbs_g: parsed.carbs_g,
          fat_g: parsed.fat_g,
          fiber_g: parsed.fiber_g,
          sugar_g: parsed.sugar_g ?? null,
        },
      });
      onSave(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <View style={styles.editForm}>
      <View style={styles.editField}>
        <Text style={styles.editLabel}>NAME</Text>
        <TextInput
          accessibilityLabel="Food name"
          value={name}
          onChangeText={setName}
          placeholder="Food name"
          placeholderTextColor={colors.muted}
          style={styles.editInput}
        />
      </View>
      <View style={styles.editField}>
        <Text style={styles.editLabel}>BRAND (OPTIONAL)</Text>
        <TextInput
          accessibilityLabel="Brand"
          value={brand}
          onChangeText={setBrand}
          placeholder="e.g. Homemade"
          placeholderTextColor={colors.muted}
          style={styles.editInput}
        />
      </View>
      <SegmentedSwitch options={CUSTOM_FOOD_BASIS_OPTIONS} value={basis} disabled={busy} onChange={value => setBasis(value as CustomFoodBasis)} />
      <View style={styles.editGrid}>
        {nutrientFields.map(field => (
          <View key={field.key} style={styles.editCell}>
            <Text style={styles.editLabel}>{field.label.toUpperCase()}</Text>
            <View style={styles.editCellVal}>
              <TextInput
                accessibilityLabel={`${field.label} (${field.unit})`}
                placeholder={field.required ? '—' : 'unknown'}
                placeholderTextColor={colors.muted}
                value={fields[field.key]}
                keyboardType="decimal-pad"
                onChangeText={value => setFields(old => ({ ...old, [field.key]: value }))}
                style={styles.editCellInput}
              />
              <Text style={styles.editUnit}>{field.unit}</Text>
            </View>
          </View>
        ))}
      </View>
      <ErrorMessage message={error} />
      <View style={styles.editButtons}>
        <Button label="Cancel" quiet disabled={busy} onPress={onCancel} />
        <Button label={busy ? 'Saving…' : 'Save changes'} primary disabled={busy} onPress={submit} />
      </View>
    </View>
  );
}

const UNIT_SCOPE_OPTIONS = [
  { value: 'food', label: 'This food' },
  { value: 'all', label: 'All foods' },
];

function CustomUnitForm({
  food,
  energyUnit,
  busy,
  onCancel,
  onSave,
}: {
  food: FoodRecord;
  energyUnit: 'kcal' | 'kJ';
  busy: boolean;
  onCancel: () => void;
  onSave: (unit: FoodUnit, scope: 'food' | 'all', updatedFood: FoodRecord) => void;
}) {
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [scope, setScope] = useState<'food' | 'all'>('food');
  const [error, setError] = useState<string | null>(null);
  const measureUnit = food.basis === 'per_100ml' ? 'ml' : 'g';

  const previewEnergy = useMemo(() => {
    const label = name.trim();
    const numeric = Number(weight);
    if (!label || !Number.isFinite(numeric) || numeric <= 0) return null;
    try {
      const unit: FoodUnit = { label, grams: measureUnit === 'ml' ? null : numeric, ml: measureUnit === 'ml' ? numeric : null };
      const updated = { ...food, units: [...food.units.filter(item => item.label !== label), unit] };
      return calculateNutrition(updated, { amount: 1, unit: label }).kcal;
    } catch {
      return null;
    }
  }, [food, measureUnit, name, weight]);

  const submit = () => {
    try {
      setError(null);
      const label = name.trim();
      const numeric = Number(weight);
      if (!label || !Number.isFinite(numeric) || numeric <= 0) throw new Error('Enter a unit name and a positive weight.');
      if (['g', 'oz', 'ml', 'l', 'serving'].includes(label.toLowerCase())) throw new Error('Choose a unit name such as bowl, katori, or scoop.');
      const unit: FoodUnit = { label, grams: measureUnit === 'ml' ? null : numeric, ml: measureUnit === 'ml' ? numeric : null };
      const updated = { ...food, units: [...food.units.filter(item => item.label !== label), unit] };
      resolveQuantityToBasis(updated, { amount: 1, unit: label });
      Keyboard.dismiss();
      onSave(unit, scope, updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <RevealPanel visible direction="down" style={styles.unitForm}>
      <View style={styles.unitFormRow}>
        <View style={[styles.editField, { flex: 1.3 }]}>
          <Text style={styles.editLabel}>UNIT NAME</Text>
          <TextInput
            autoFocus
            accessibilityLabel="Custom unit name"
            placeholder="e.g. bowl, katori"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.editInput}
          />
        </View>
        <View style={[styles.editField, { flex: 1 }]}>
          <Text style={styles.editLabel}>{`WEIGHT (${measureUnit.toUpperCase()})`}</Text>
          <View style={styles.editCellVal}>
            <TextInput
              accessibilityLabel="Custom unit weight"
              placeholder="250"
              placeholderTextColor={colors.muted}
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              onSubmitEditing={submit}
              returnKeyType="done"
              style={[styles.editInput, styles.unitWeightInput]}
            />
            <Text style={styles.unitSuffix}>{measureUnit}</Text>
          </View>
        </View>
      </View>
      {previewEnergy != null ? (
        <Text style={styles.unitPreview}>
          1 {name.trim()} = {number(Number(weight), 0)} {measureUnit} · {energy(previewEnergy, energyUnit)}
        </Text>
      ) : null}
      <SegmentedSwitch
        options={UNIT_SCOPE_OPTIONS}
        value={scope}
        disabled={busy}
        onChange={value => setScope(value as 'food' | 'all')}
      />
      <ErrorMessage message={error} />
      <View style={styles.editButtons}>
        <Button label="Cancel" quiet disabled={busy} onPress={() => { Keyboard.dismiss(); onCancel(); }} />
        <Button label={busy ? 'Saving…' : 'Save unit'} primary disabled={busy} onPress={submit} />
      </View>
    </RevealPanel>
  );
}

interface ResolvedFoodData {
  food: FoodRecord;
  personalUnits: FoodUnit[];
  portions: { amount: number; unit: string; kcal: number | undefined }[];
  entries: DiaryEntrySnapshot[];
  pinned: boolean;
  parts: RecipeIngredient[] | undefined;
  sourceName: string;
}

function FoodDetail({
  data,
  initialQuantity,
  targetMeal,
  targetDate,
}: {
  data: ResolvedFoodData;
  initialQuantity: Quantity;
  targetMeal: string;
  targetDate: string;
}) {
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const meals = mealsForDay(preferences.value?.mealSections ?? [...MEALS], data.entries, [targetMeal]);
  const [updatedFood, setUpdatedFood] = useState<FoodRecord | null>(null);
  const food = updatedFood ?? data.food;
  const kind = kindOf(food);
  const isCustomFood = !food.source_pack_id && kind === 'food';
  const isDatabaseFood = Boolean(food.source_pack_id);
  const [selected, setSelected] = useState<Quantity>(initialQuantity);
  const [typed, setTyped] = useState<string | null>(null);
  const [unitMenu, setUnitMenu] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const action = useAction();
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);
  const personalUnitsRef = useRef<ComponentRef<typeof View> | null>(null);
  const getPersonalUnitsNode = useCallback(() => personalUnitsRef.current, []);
  useScrollNodeIntoView(scrollRef, scrollOffsetRef, getPersonalUnitsNode, addingUnit ? 'personal-units' : null);

  const current = useMemo(() => (typed == null ? selected : { amount: Number(typed), unit: selected.unit }), [selected, typed]);
  const valid = Number.isFinite(current.amount) && current.amount > 0;
  const preview = useAsyncResource(
    useCallback(async () => (valid ? controller.preview(food, current) : null), [controller, food, current, valid]),
    `${foodKey(food)}:${current.amount}:${current.unit}`,
  );
  const nutrients = useMemo(() => {
    if (preview.value?.nutrients) return preview.value.nutrients;
    if (!valid) return undefined;
    try {
      return calculateNutrition(food, current);
    } catch {
      return undefined;
    }
  }, [current, food, preview.value, valid]);

  const resolvedMetric = useMemo(() => {
    if (!valid) return null;
    try {
      const resolved = resolveQuantityToBasis(food, current);
      if (resolved.unit === current.unit && Math.abs(resolved.amount - current.amount) < 0.01) return null;
      return `${number(resolved.amount, 0)} ${resolved.unit}`;
    } catch {
      return null;
    }
  }, [current, food, valid]);

  const shares = macroShare(nutrients?.protein_g ?? 0, nutrients?.carbs_g ?? 0, nutrients?.fat_g ?? 0);
  const loggedMeals = data.entries.map(entry => entry.meal);

  const selectPortion = (next: Quantity) => {
    setTyped(null);
    setSelected(next);
  };
  const selectUnit = (unit: string) => void action.run(async () => {
    const mapping = food.units.find(item => item.label === unit);
    if (mapping) await controller.savePersonalUnit(food, mapping);
    setSelected({ amount: typed == null ? 1 : Number(typed) || 1, unit });
  });
  const toggleMeal = (destination: string) => void action.run(async () => {
    const logged = data.entries.filter(entry => entry.meal === destination);
    if (logged.length) {
      await controller.deleteEntries(logged.map(entry => entry.id));
      return;
    }
    if (!valid) throw new Error('Enter an amount greater than zero.');
    await controller.confirm({ food, quantity: current, meal: destination, date: targetDate, idempotencyKey: generateId() });
    setTyped(null);
  });

  const reducedMotion = useReducedMotion();
  const enterProgress = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      enterProgress.set(1);
      return;
    }
    enterProgress.set(withSpring(1, { damping: 24, stiffness: 300, mass: 0.78 }));
  }, [enterProgress, reducedMotion]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: interpolate(enterProgress.value, [0, 0.7, 1], [0.25, 0.96, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(enterProgress.value, [0, 1], [16, 0], Extrapolation.CLAMP) },
      { scale: interpolate(enterProgress.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
  }));

  const subtitleParts = [
    data.sourceName,
    food.brand,
    food.category,
    prepLabel(food.prep_state),
  ].filter((part, index, list): part is string => Boolean(part) && list.findIndex(item => item?.toLowerCase() === part?.toLowerCase()) === index);

  return (
    <Page
      scrollRef={scrollRef}
      onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
      overlay={<View pointerEvents="box-none" style={styles.toast}><UndoToast /></View>}
    >
      <Animated.View style={[styles.pageMotion, enterStyle]}>
      <BackHeader
        title={food.name}
        onBack={() => goBackOrReplace('/(tabs)/library')}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={data.pinned ? 'Unpin food' : 'Pin food'}
            accessibilityState={{ selected: data.pinned }}
            disabled={action.busy}
            onPress={() => void action.run(() => controller.toggleFoodPin(food, !data.pinned))}
            style={styles.iconHit}
          >
            <DoopIcon name="pin" size={18} color={data.pinned ? colors.accent : colors.muted} />
          </Pressable>
        }
      />

      <View style={styles.subtitleRow}>
        <DoopIcon name={inferFoodGlyph(food.name, kind)} size={18} color={colors.muted} />
        <Text numberOfLines={2} style={styles.subtitleText}>{subtitleParts.join(' · ')}</Text>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroEnergyRow}>
            <Text style={styles.heroEnergyValue}>{number(energyValue(nutrients?.kcal, energyUnit))}</Text>
            <Text style={styles.heroEnergyUnit}>{energyUnit}</Text>
          </View>
          <View style={styles.heroPortion}>
            <Text style={styles.heroPortionMain}>{labelOf(valid ? current : selected)}</Text>
            {resolvedMetric ? <Text style={styles.heroPortionSub}>{resolvedMetric}</Text> : null}
          </View>
        </View>

        <MacroProportionBar
          proteinG={nutrients?.protein_g ?? 0}
          carbsG={nutrients?.carbs_g ?? 0}
          fatG={nutrients?.fat_g ?? 0}
          height={6}
          gap={2}
          style={styles.heroBar}
        />

        <View style={styles.heroRule} />

        <View style={styles.macroCols}>
          {([
            ['Protein', nutrients?.protein_g, shares.protein, colors.lavender],
            ['Carbs', nutrients?.carbs_g, shares.carbs, colors.mint],
            ['Fat', nutrients?.fat_g, shares.fat, colors.peach],
          ] as const).map(([label, grams, pct, dotColor]) => (
            <View key={label} style={styles.macroCol}>
              <View style={styles.macroColHead}>
                <View style={[styles.macroDot, { backgroundColor: dotColor }]} />
                <Text style={styles.macroColLabel}>{label}</Text>
              </View>
              <Text style={styles.macroColVal}>
                {number(grams, 1)} g
                {pct > 0 ? <Text style={styles.macroColPct}> · {pct}%</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.sectionBlock, unitMenu && { zIndex: 20 }]}>
        <SectionRule label="Portion" meta={resolvedMetric ?? basisLabel(food)} />
        <LearnedPortionChips
          variant="calm"
          portions={data.portions.map(portion => ({
            label: labelOf(portion),
            energyLabel: energy(portion.kcal, energyUnit),
            selected: typed == null && current.amount === portion.amount && current.unit === portion.unit,
          }))}
          onSelect={index => {
            const portion = data.portions[index];
            if (portion) selectPortion({ amount: portion.amount, unit: portion.unit });
          }}
          moreExpanded={typed != null}
          onMore={() => setTyped(old => (old == null ? '' : null))}
        />
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
            style={{ marginTop: 6 }}
          />
        )}
        {unitMenu && (
          <View style={styles.unitMenuWrap}>
            <UnitMenu
              food={food}
              selected={selected.unit}
              onClose={() => setUnitMenu(false)}
              onSelect={unit => {
                setTyped(null);
                setSelected({ amount: 1, unit });
              }}
              onSaved={(updated, unit) => {
                setUpdatedFood(updated);
                setTyped(null);
                setSelected({ amount: 1, unit });
              }}
            />
          </View>
        )}
      </View>

      <View style={styles.sectionBlock}>
        <SectionRule label="Log to meal" meta={loggedMeals.length ? `Logged · ${loggedMeals.join(', ')}` : targetDate} />
        <MealDestinationPills
          variant="calm"
          meals={meals}
          selectedMeals={loggedMeals}
          suggestedMeal={targetMeal}
          mode="toggle"
          disabled={!valid || action.busy || preview.loading || typed != null}
          onPress={toggleMeal}
        />
      </View>

      <View style={styles.sectionBlock}>
        <SectionRule label="Nutrition" meta={labelOf(valid ? current : selected)} />
        <View style={styles.nutCard}>
          <NutrientRow label="Energy" value={energyValue(nutrients?.kcal, energyUnit)} unit={energyUnit} bold />
          <View style={styles.nutRule} />
          <NutrientRow label="Protein" value={nutrients?.protein_g} unit="g" bold />
          <NutrientRow label="Carbohydrates" value={nutrients?.carbs_g} unit="g" bold />
          <NutrientRow label="Fiber" value={nutrients?.fiber_g} unit="g" sub />
          <NutrientRow label="Sugar" value={nutrients?.sugar_g} unit="g" sub />
          <NutrientRow label="Fat" value={nutrients?.fat_g} unit="g" bold />
          <NutrientRow label="Saturated fat" value={nutrients?.sat_fat_g} unit="g" sub />
          <View style={styles.nutRule} />
          <NutrientRow label="Sodium" value={nutrients?.sodium_mg} unit="mg" />
          <NutrientRow label="Potassium" value={nutrients?.potassium_mg} unit="mg" />
          <NutrientRow label="Calcium" value={nutrients?.calcium_mg} unit="mg" />
          <NutrientRow label="Iron" value={nutrients?.iron_mg} unit="mg" />
        </View>
        <View style={styles.metaGrid}>
          <Text style={styles.metaLine}>Reference basis: {basisLabel(food)}</Text>
          {food.brand ? <Text style={styles.metaLine}>Brand: {food.brand}</Text> : null}
          {food.category ? <Text style={styles.metaLine}>Category: {food.category}</Text> : null}
          {prepLabel(food.prep_state) ? <Text style={styles.metaLine}>Preparation: {prepLabel(food.prep_state)}</Text> : null}
          <Text style={styles.metaLine}>Source: {data.sourceName}</Text>
        </View>
      </View>

      {data.parts && data.parts.length > 0 && (
        <View style={styles.sectionBlock}>
          <SectionRule label="Ingredients" meta={`${data.parts.length} items`} />
          <View>
            {data.parts.map((part, index) => {
              let partKcal: number | undefined;
              try {
                partKcal = calculateNutrition(part.food, part.quantity).kcal;
              } catch {
                partKcal = undefined;
              }
              return (
                <View key={`${part.food.id}-${index}`} style={styles.partRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.partName}>{part.food.name}</Text>
                    <Text style={styles.partQty}>{labelOf(part.quantity)}</Text>
                  </View>
                  <Text style={styles.partKcal}>{energy(partKcal, energyUnit)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View ref={personalUnitsRef} collapsable={false} style={[styles.sectionBlock, addingUnit && styles.unitSectionOpen]}>
        <SectionRule label="Personal units" meta={data.personalUnits.length ? String(data.personalUnits.length) : undefined} />
        <View style={styles.unitChipsRow}>
          {data.personalUnits.map(unit => (
            <View key={unit.label} style={styles.savedUnitPill}>
              <Text style={styles.savedUnitText}>
                {unit.label} · {unit.grams != null ? `${number(unit.grams, 0)} g` : `${number(unit.ml, 0)} ml`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove unit ${unit.label}`}
                disabled={action.busy}
                onPress={() => void action.run(() => controller.deletePersonalUnit(food, unit.label))}
                hitSlop={8}
                style={styles.savedUnitRemove}
              >
                <DoopIcon name="close" size={12} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addingUnit ? 'Close custom unit form' : 'Add custom unit'}
            accessibilityState={{ expanded: addingUnit }}
            disabled={action.busy}
            onPress={() => {
              if (addingUnit) Keyboard.dismiss();
              setAddingUnit(open => !open);
            }}
            style={[styles.addUnitButton, addingUnit && styles.addUnitButtonActive]}
          >
            <DoopIcon name={addingUnit ? 'close' : 'plus'} size={14} color={colors.accent} />
            <Text style={styles.addUnitText}>{addingUnit ? 'Close' : 'Add custom unit'}</Text>
          </Pressable>
        </View>
        {addingUnit && (
          <CustomUnitForm
            food={food}
            energyUnit={energyUnit}
            busy={action.busy}
            onCancel={() => setAddingUnit(false)}
            onSave={(unit, scope, updated) => void action.run(async () => {
              await controller.savePersonalUnit(food, unit);
              if (scope === 'all') await controller.deps.library.upsertUserFoodUnit(GLOBAL_UNITS, unit);
              controller.refresh();
              setUpdatedFood(updated);
              setTyped(null);
              setSelected({ amount: 1, unit: unit.label });
              setAddingUnit(false);
            })}
          />
        )}
      </View>

      <View style={styles.sectionBlock}>
        <SectionRule label="Actions" />
        <View>
          <Pressable
            accessibilityRole="button"
            disabled={action.busy}
            onPress={() => void action.run(() => controller.toggleFoodPin(food, !data.pinned))}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          >
            <DoopIcon name="pin" size={17} color={data.pinned ? colors.accent : colors.muted} />
            <Text style={styles.actionText}>{data.pinned ? 'Unpin from Library' : 'Pin to top of Library'}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={action.busy}
            onPress={() => void action.run(() => Share.share({ message: formatShareText(food, valid ? current : selected, nutrients, energyUnit) }))}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          >
            <DoopIcon name="external" size={17} color={colors.muted} />
            <Text style={styles.actionText}>Share nutrition summary</Text>
          </Pressable>

          {kind === 'recipe' && (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: food.id.slice(7), meal: targetMeal, date: targetDate } })}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <DoopIcon name="recipe" size={17} color={colors.accent} />
              <Text style={[styles.actionText, { color: colors.accent }]}>Edit recipe & cook batch</Text>
              <DoopIcon name="chevronRight" size={16} color={colors.muted} />
            </Pressable>
          )}

          {isCustomFood && (
            <Pressable
              accessibilityRole="button"
              disabled={action.busy}
              onPress={() => setEditing(open => !open)}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <DoopIcon name="info" size={17} color={colors.accent} />
              <Text style={[styles.actionText, { color: colors.accent }]}>{editing ? 'Close editor' : 'Edit custom food'}</Text>
            </Pressable>
          )}

          {isDatabaseFood && (
            <Pressable
              accessibilityRole="button"
              disabled={action.busy}
              onPress={() => void action.run(async () => {
                const copy = await controller.saveCustomFood({
                  ...food,
                  id: generateId(),
                  provenance_kind: 'user',
                  source_pack_id: null,
                  source_id: null,
                  source_version: null,
                });
                router.replace({
                  pathname: '/food',
                  params: { id: copy.id, meal: targetMeal, date: targetDate, amount: String(current.amount), unit: current.unit },
                });
              })}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <DoopIcon name="plus" size={17} color={colors.accent} />
              <Text style={[styles.actionText, { color: colors.accent }]}>Save as editable custom copy</Text>
            </Pressable>
          )}

          {(isCustomFood || kind === 'meal') && (
            <Pressable
              accessibilityRole="button"
              disabled={action.busy}
              onPress={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                void action.run(async () => {
                  if (kind === 'meal') await controller.deleteSavedMeal(food.id.slice(5));
                  else await controller.deleteCustomFood(food.id);
                  goBackOrReplace('/(tabs)/library');
                });
              }}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <DoopIcon name="trash" size={17} color={colors.danger} />
              <Text style={[styles.actionText, { color: colors.danger }]}>
                {confirmDelete ? `Tap again to delete ${kind === 'meal' ? 'saved meal' : 'custom food'}` : `Delete ${kind === 'meal' ? 'saved meal' : 'custom food'}`}
              </Text>
            </Pressable>
          )}
        </View>
        {statusNote ? <Muted>{statusNote}</Muted> : null}
        {editing && isCustomFood && (
          <CustomFoodEditor
            food={food}
            energyUnit={energyUnit}
            busy={action.busy}
            onCancel={() => setEditing(false)}
            onSave={updated => void action.run(async () => {
              const saved = await controller.saveCustomFood(updated);
              setUpdatedFood(saved);
              setEditing(false);
              setStatusNote('Custom food updated. Earlier diary entries keep their original values.');
            })}
          />
        )}
      </View>

      <ErrorMessage message={action.error ?? preview.error} />
      </Animated.View>
    </Page>
  );
}

export default function FoodDetailScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    packId?: string | string[];
    meal?: string | string[];
    date?: string | string[];
    amount?: string | string[];
    unit?: string | string[];
  }>();
  const id = paramString(params.id);
  const packId = paramString(params.packId) || null;
  const preferences = usePreferences();
  const meals = preferences.value?.mealSections ?? [...MEALS];
  const targetMeal = paramString(params.meal) || meals[0] || 'Breakfast';
  const targetDate = parseRouteDate(params.date) ?? localDate();
  const paramAmount = Number(paramString(params.amount));
  const paramUnit = paramString(params.unit);

  const { controller } = useAppRuntime();
  const revision = controller.getRevision();

  const resource = useAsyncResource(
    useCallback(async (): Promise<ResolvedFoodData | null> => {
      void revision;
      if (!id) return null;
      let baseFood = await controller.deps.catalog.getById(packId, id);
      if (!baseFood) {
        const pinnedFoodsRow = await controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryPinnedFoods');
        const pinnedFoods: FoodRecord[] = pinnedFoodsRow ? (JSON.parse(pinnedFoodsRow.value_json) as unknown[]).map(item => foodRecordSchema.parse(item)) : [];
        baseFood = pinnedFoods.find(item => item.id === id && (item.source_pack_id ?? null) === packId) ?? null;
      }
      if (!baseFood) {
        const recent = await controller.deps.userDb.getAllAsync<{ snapshot_json: string }>(
          "SELECT snapshot_json FROM diary_entries WHERE draft_state='confirmed' ORDER BY occurred_at DESC LIMIT 200",
        );
        for (const row of recent) {
          const entry = diaryEntrySnapshotSchema.parse(JSON.parse(row.snapshot_json));
          if (entry.food.id === id && (entry.food.source_pack_id ?? null) === packId) {
            baseFood = entry.food;
            break;
          }
        }
      }
      if (!baseFood) return null;

      const key = foodKey(baseFood);
      const [globalUnits, personalUnits, learned, dayData, pinsRow, savedMeal, recipe, packs] = await Promise.all([
        controller.deps.library.listUserFoodUnits(GLOBAL_UNITS),
        controller.deps.library.listUserFoodUnits(key),
        controller.getLearnedPortions(baseFood),
        controller.day(targetDate),
        controller.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', PIN_KEY),
        kindOf(baseFood) === 'meal' ? controller.deps.library.getSavedMeal(baseFood.id.slice(5)) : Promise.resolve(null),
        kindOf(baseFood) === 'recipe' ? controller.getRecipe(baseFood.id.slice(7)) : Promise.resolve(null),
        baseFood.source_pack_id ? controller.listPacks() : Promise.resolve([]),
      ]);

      const food = withUnits(withUnits(baseFood, personalUnits), globalUnits);
      const pinIds: string[] = pinsRow ? JSON.parse(pinsRow.value_json) : [];
      const pinned = savedMeal?.pinned ?? pinIds.includes(key);
      const entries = dayData.day?.entries.filter(entry => foodKey(entry.food) === key) ?? [];
      const basePortion = usualQuantity(food);
      const alternative = food.units.find(unit => unit.label !== basePortion.unit && availableUnits(food).includes(unit.label));
      const candidates: Quantity[] = [
        ...learned.filter(item => availableUnits(food).includes(item.unit)).map(item => ({ amount: item.amount, unit: item.unit })),
        basePortion,
        ...(alternative ? [{ amount: 1, unit: alternative.label }] : []),
        { ...basePortion, amount: basePortion.amount / 2 },
        { ...basePortion, amount: basePortion.amount * 2 },
      ];
      const unique = candidates
        .filter((item, index) => candidates.findIndex(other => other.unit === item.unit && other.amount === item.amount) === index)
        .slice(0, 3);
      const portions = await Promise.all(
        unique.map(async portion => ({
          ...portion,
          kcal: (await controller.preview(food, portion))?.nutrients?.kcal,
        })),
      );
      const kind = kindOf(food);
      const packMeta = food.source_pack_id ? packs.find(item => item.pack_id === food.source_pack_id) : undefined;
      const sourceName = kind === 'recipe'
        ? 'Recipe'
        : kind === 'meal'
          ? 'Saved meal'
          : packMeta?.meta.name ?? food.source_pack_id ?? 'Your food';

      return {
        food,
        personalUnits,
        portions,
        entries,
        pinned,
        parts: recipe?.ingredients ?? savedMeal?.items,
        sourceName,
      };
    }, [controller, id, packId, revision, targetDate]),
    `${packId ?? 'user'}:${id}:${targetDate}`,
  );

  if (resource.value) {
    const { food, portions, entries } = resource.value;
    const validParam = Number.isFinite(paramAmount) && paramAmount > 0 && paramUnit && availableUnits(food).includes(paramUnit);
    const logged = entries.find(entry => entry.meal === targetMeal) ?? entries[0];
    const initialQuantity: Quantity = validParam
      ? { amount: paramAmount, unit: paramUnit }
      : logged?.quantity ?? (portions[0] ? { amount: portions[0].amount, unit: portions[0].unit } : usualQuantity(food));
    return (
      <FoodDetail
        key={foodKey(food)}
        data={resource.value}
        initialQuantity={initialQuantity}
        targetMeal={targetMeal}
        targetDate={targetDate}
      />
    );
  }

  return (
    <Page>
      <BackHeader title="Food" onBack={() => goBackOrReplace('/(tabs)/library')} />
      <ErrorMessage message={resource.error} />
      <Muted>{resource.loading ? 'Loading food…' : resource.error ? 'Could not load this food.' : 'Food not found.'}</Muted>
    </Page>
  );
}

const styles = StyleSheet.create({
  pageMotion: { gap: spacing.s16 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s8, marginTop: -spacing.s8 },
  subtitleText: { flex: 1, ...fontFace('medium'), fontSize: 13, color: colors.muted, lineHeight: 18 },
  iconHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingTop: spacing.s4, paddingBottom: spacing.s4 },
  heroTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.s12 },
  heroEnergyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroEnergyValue: { ...fontFace('bold'), ...tabularNums, fontSize: 36, lineHeight: 40, color: colors.ink, letterSpacing: -0.6 },
  heroEnergyUnit: { ...fontFace('semibold'), fontSize: 15, color: colors.muted },
  heroPortion: { alignItems: 'flex-end', flexShrink: 1 },
  heroPortionMain: { ...fontFace('semibold'), ...tabularNums, fontSize: 15, color: colors.ink },
  heroPortionSub: { ...fontFace('medium'), ...tabularNums, fontSize: 12, color: colors.muted, marginTop: 2 },
  heroBar: { marginTop: spacing.s12 },
  heroRule: { height: 1, backgroundColor: colors.hairline, marginTop: spacing.s16, marginBottom: spacing.s12 },
  macroCols: { flexDirection: 'row', gap: spacing.s12 },
  macroCol: { flex: 1, gap: 4 },
  macroColHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  macroDot: { width: 7, height: 7, borderRadius: 3.5 },
  macroColLabel: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  macroColVal: { ...fontFace('semibold'), ...tabularNums, fontSize: 15, color: colors.ink },
  macroColPct: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  sectionBlock: { gap: spacing.s10 },
  unitMenuWrap: { marginTop: spacing.s6, zIndex: 30 },
  nutCard: { backgroundColor: colors.surface, borderRadius: radius.r16, paddingHorizontal: spacing.s16, paddingVertical: spacing.s8, borderWidth: 1, borderColor: colors.hairline },
  nutRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s12 },
  nutRowSub: { minHeight: 34, paddingLeft: spacing.s16 },
  nutLabel: { ...fontFace('medium'), fontSize: 14, color: colors.ink },
  nutLabelBold: { ...fontFace('semibold') },
  nutLabelSub: { fontSize: 13, color: colors.muted },
  nutValue: { ...fontFace('medium'), ...tabularNums, fontSize: 14, color: colors.ink },
  nutValueBold: { ...fontFace('semibold') },
  nutUnknown: { color: colors.muted },
  nutRule: { height: 1, backgroundColor: colors.hairline, marginVertical: spacing.s4 },
  metaGrid: { gap: 4, paddingHorizontal: 2 },
  metaLine: { ...fontFace('medium'), fontSize: 12, color: colors.muted, lineHeight: 17 },
  partRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s12, paddingVertical: spacing.s8, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  partName: { ...fontFace('semibold'), fontSize: 15, color: colors.ink },
  partQty: { ...fontFace('medium'), ...tabularNums, fontSize: 13, color: colors.muted, marginTop: 2 },
  partKcal: { ...fontFace('semibold'), ...tabularNums, fontSize: 15, color: colors.ink },
  unitChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s8, alignItems: 'center' },
  unitSectionOpen: { paddingBottom: 140 },
  savedUnitPill: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  savedUnitText: { ...fontFace('medium'), ...tabularNums, fontSize: 13, color: colors.ink },
  savedUnitRemove: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  addUnitButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  addUnitButtonActive: { borderStyle: 'solid', borderColor: colors.accent, backgroundColor: 'rgba(122,162,247,0.12)' },
  addUnitText: { ...fontFace('semibold'), fontSize: 13, color: colors.accent },
  unitForm: { paddingTop: spacing.s8, paddingBottom: spacing.s8, borderTopWidth: 1, borderTopColor: colors.hairline, gap: spacing.s12 },
  unitFormRow: { flexDirection: 'row', gap: spacing.s16 },
  unitWeightInput: { flex: 1, minWidth: 0, ...tabularNums },
  unitSuffix: { ...fontFace('semibold'), fontSize: 13, color: colors.muted },
  unitPreview: { ...fontFace('medium'), ...tabularNums, fontSize: 13, color: colors.muted },
  actionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.s12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  actionText: { flex: 1, ...fontFace('semibold'), fontSize: 15, color: colors.ink },
  pressed: { opacity: 0.7 },
  editForm: { paddingTop: spacing.s8, paddingBottom: spacing.s12, borderTopWidth: 1, borderTopColor: colors.hairline, gap: spacing.s12 },
  editField: { borderBottomWidth: 1, borderBottomColor: colors.hairline, paddingVertical: 4, gap: 3 },
  editLabel: { ...fontFace('semibold'), fontSize: 10, letterSpacing: 0.7, color: colors.muted },
  editInput: { ...fontFace('semibold'), fontSize: 15, color: colors.ink, paddingVertical: 4 },
  editGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editCell: { width: '31.2%', minHeight: 54, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 7, justifyContent: 'space-between' },
  editCellVal: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  editCellInput: { ...fontFace('bold'), ...tabularNums, fontSize: 15, color: colors.ink, padding: 0, flex: 1, minWidth: 0 },
  editUnit: { ...fontFace('semibold'), fontSize: 10, color: colors.muted },
  editButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.s8, marginTop: spacing.s4 },
  toast: { position: 'absolute', left: SCREEN_GUTTER, right: SCREEN_GUTTER, bottom: 8 },
});
