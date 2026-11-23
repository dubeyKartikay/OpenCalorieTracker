import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useAction, useAppRuntime, useAsyncResource, usePreferences } from '../../app/AppRuntimeContext';
import { availableUnits, defaultQuantity, MEALS, sourceLabel } from '../../app/controller';
import { generateId, resolveQuantityToBasis } from '../../domain';
import type { FoodRecord } from '../../domain';
import type { SearchCandidate } from '../../catalog';
import { MIN_TOUCH_TARGET, spacing } from '../tokens';
import { InlineKeypad, LearnedPortionChips, MacroProportionBar, SourceBadge } from './doop';
import { HoldToLogPanel } from './gestures';
import { MacroRow } from './Diary';
import { Badge, Button, Card, energy, ErrorMessage, Heading, Input, Label, Muted, number, ui } from './primitives';

export function PortionEditor({ food, meal }: { food: FoodRecord; meal: string }) {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const initial = defaultQuantity(food);
  const [amount, setAmount] = useState(String(initial.amount));
  const [unit, setUnit] = useState(initial.unit);
  const [key, setKey] = useState(generateId);
  const [keypad, setKeypad] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);
  const [unitLabel, setUnitLabel] = useState('');
  const [unitSize, setUnitSize] = useState('');
  const [unitBasis, setUnitBasis] = useState<'g' | 'ml'>(food.basis === 'per_100ml' ? 'ml' : 'g');
  const action = useAction();
  const revision = controller.getRevision();
  const learned = useAsyncResource(useCallback(async () => {
    void revision;
    return Promise.all((await controller.getLearnedPortions(food)).map(async portion => ({ ...portion, kcal: (await controller.preview(food, portion))?.nutrients?.kcal })));
  }, [controller, food, revision]));
  const valid = amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const preview = useAsyncResource(useCallback(async () => {
    if (!valid) throw new Error('Enter an amount greater than zero');
    return controller.preview(food, { amount: Number(amount), unit });
  }, [controller, food, amount, unit, valid]));
  const changeAmount = (next: string) => { setAmount(next); setKey(generateId()); };
  const changeUnit = (next: string) => { setUnit(next); setKey(generateId()); };
  const nutrients = preview.value?.nutrients;
  return <View style={{ gap: spacing.s12 }}><View style={ui.divider} />
    <MacroProportionBar proteinG={nutrients?.protein_g ?? 0} carbsG={nutrients?.carbs_g ?? 0} fatG={nutrients?.fat_g ?? 0} />
    {(learned.value?.length ?? 0) > 0 && <LearnedPortionChips portions={(learned.value ?? []).map((portion, index) => ({
      label: `${number(portion.amount, 2)} ${portion.unit}`, energyLabel: energy(portion.kcal, energyUnit), rankDots: index === 0 ? 3 : index === 1 ? 2 : 1,
      selected: Number(amount) === portion.amount && unit === portion.unit,
    }))} onSelect={index => { const portion = learned.value?.[index]; if (portion) { changeAmount(String(portion.amount)); changeUnit(portion.unit); } }} onMore={() => setKeypad(value => !value)} />}
    <View style={ui.wrap}>{availableUnits(food).map(label => <Button key={label} label={label} selected={unit === label} onPress={() => changeUnit(label)} />)}
      <Button label="+ Unit" selected={addingUnit} onPress={() => setAddingUnit(value => !value)} /></View>
    {addingUnit && <Card><Input label="Unit label" placeholder="katori, roti…" value={unitLabel} onChangeText={setUnitLabel} />
      <View style={ui.wrap}>{(['g', 'ml'] as const).map(basis => <Button key={basis} label={basis} selected={unitBasis === basis} onPress={() => setUnitBasis(basis)} />)}</View>
      <Input label={`1 ${unitLabel || 'unit'} equals (${unitBasis})`} keyboardType="decimal-pad" value={unitSize} onChangeText={setUnitSize} />
      <Button label="Save unit" disabled={action.busy} onPress={() => void action.run(async () => {
        if (!unitLabel.trim() || !(Number(unitSize) > 0) || !Number.isFinite(Number(unitSize))) throw new Error('Enter a label and a positive unit size');
        if (['g', 'oz', 'ml', 'serving'].includes(unitLabel.trim().toLowerCase())) throw new Error('Choose a personal unit label such as katori or roti');
        const personalUnit = { label: unitLabel.trim(), grams: unitBasis === 'g' ? Number(unitSize) : null, ml: unitBasis === 'ml' ? Number(unitSize) : null };
        resolveQuantityToBasis({ ...food, units: [...food.units.filter(item => item.label !== personalUnit.label), personalUnit] }, { amount: 1, unit: personalUnit.label });
        await controller.savePersonalUnit(food, personalUnit);
        changeUnit(unitLabel.trim()); changeAmount('1'); setAddingUnit(false); setUnitLabel(''); setUnitSize('');
      })} /></Card>}
    <Button label={`${number(valid ? Number(amount) : null, 2)} ${unit} · Adjust amount`} onPress={() => setKeypad(value => !value)} />
    {keypad && <InlineKeypad value={amount} onChange={changeAmount} maxDecimals={2} onDone={() => setKeypad(false)} />}
    <ErrorMessage message={preview.error ?? learned.error ?? action.error} />
    {nutrients && <><Label style={ui.number}>{energy(nutrients.kcal, energyUnit)}</Label><MacroRow totals={preview.value!} />
      {nutrients.fiber_g === null && <Muted>Fiber unknown</Muted>}</>}
    <Muted>Source · {sourceLabel(food)}{food.source_version ? ` · v${food.source_version}` : ''}</Muted>
    <Button label={`Add to ${meal}`} primary disabled={!valid || !nutrients || action.busy || preview.loading}
      onPress={() => void action.run(async () => { await controller.confirm({ food, quantity: { amount: Number(amount), unit }, meal, idempotencyKey: key }); setKey(generateId()); })} />
  </View>;
}
export function FoodRow({ candidate, expanded, onToggle, meal }: { candidate: SearchCandidate; expanded: boolean; onToggle: () => void; meal: string }) {
  const { food } = candidate;
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const meals = preferences.value?.mealSections ?? [...MEALS];
  const portion = defaultQuantity(food);
  const [hold, setHold] = useState(false);
  const action = useAction();
  const base = useAsyncResource(useCallback(() => controller.preview(food, defaultQuantity(food)), [controller, food]));
  return <Card><View style={[ui.row, { alignItems: 'center', gap: spacing.s8 }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Adjust ${food.name}`} accessibilityState={{ expanded }} onPress={onToggle}
      onLongPress={() => { if (!action.busy && base.value?.nutrients) setHold(true); }} delayLongPress={300}
      style={{ flex: 1, minWidth: 0, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', gap: spacing.s4 }}>
      <Heading>{food.name}</Heading>
      <Muted>{food.prep_state} · {number(portion.amount, 1)} {portion.unit}</Muted>
      <View style={ui.wrap}><SourceBadge label={sourceLabel(food)} tone={food.provenance_kind === 'user' ? 'personal' : 'neutral'} />
        {candidate.matchedAlias && <Badge label={`Alias · ${candidate.matchedAlias}`} />}</View>
    </Pressable>
    <View style={{ alignItems: 'flex-end', gap: spacing.s4 }}>
      <Label style={ui.number}>{energy(base.value?.nutrients?.kcal, energyUnit)}</Label>
      <Button label="Hold" disabled={action.busy || !base.value?.nutrients} onPress={() => setHold(value => !value)} />
    </View>
  </View>
    <ErrorMessage message={action.error ?? base.error} />
    {hold && <HoldToLogPanel foodLabel={food.name} energyUnit={energyUnit} mealLabels={meals} kcalForMultiplier={multiplier => (base.value?.nutrients?.kcal ?? 0) * multiplier}
      onDismiss={() => setHold(false)} onLog={(destination, multiplier) => { setHold(false); void action.run(async () => {
        const index = ['breakfast', 'lunch', 'snack', 'dinner'].indexOf(destination);
        await controller.confirm({ food, quantity: { ...portion, amount: portion.amount * multiplier }, meal: meals[index] ?? meal, idempotencyKey: generateId() }); setHold(false);
      }); }} />}
    {expanded && <PortionEditor food={food} meal={meal} />}</Card>;
}
export function NewCustomFood() {
  const { controller } = useAppRuntime();
  const energyUnit = usePreferences().value?.energyUnit ?? 'kcal';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<'per_100g' | 'per_100ml' | 'per_serving'>('per_100g');
  const [fields, setFields] = useState({ kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' });
  const action = useAction();
  return <Card><Button label={open ? 'Close custom food' : 'New custom food'} onPress={() => setOpen(value => !value)} />
    {open && <><Input label="Food name" value={name} onChangeText={setName} /><View style={ui.wrap}>
      {(['per_100g', 'per_100ml', 'per_serving'] as const).map(value => <Button key={value} label={value.replaceAll('_', ' ')} selected={basis === value} onPress={() => setBasis(value)} />)}</View>
      {([['kcal', `Energy (${energyUnit})`], ['protein_g', 'Protein (g)'], ['carbs_g', 'Carbs (g)'], ['fat_g', 'Fat (g)'], ['fiber_g', 'Fiber (g) · blank if unknown']] as const).map(([key, label]) =>
        <Input key={key} label={label} value={fields[key]} keyboardType="decimal-pad" onChangeText={value => setFields(old => ({ ...old, [key]: value }))} />)}
      <ErrorMessage message={action.error} /><Button primary label="Save to Yours" disabled={action.busy} onPress={() => void action.run(async () => {
        if (['kcal', 'protein_g', 'carbs_g', 'fat_g'].some(key => !fields[key as keyof typeof fields].trim())) throw new Error('Enter energy, protein, carbs and fat. Use 0 only when known.');
        await controller.saveCustomFood({ id: generateId(), name, basis, prep_state: 'unknown', provenance_kind: 'user',
          nutrients: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim() ? Number(value) / (key === 'kcal' && energyUnit === 'kJ' ? 4.184 : 1) : null])) });
        setName(''); setFields({ kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' }); setOpen(false);
      })} /></>}
  </Card>;
}
