import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useAction, useAppRuntime, useAsyncResource } from '../../app/AppRuntimeContext';
import { availableUnits, defaultQuantity, type Meal, sourceLabel } from '../../app/controller';
import { calculateNutrition, generateId } from '../../domain';
import type { FoodRecord } from '../../domain';
import type { SearchCandidate } from '../../catalog';
import { MIN_TOUCH_TARGET, spacing } from '../tokens';
import { MacroRow } from './Diary';
import { Badge, Button, Card, ErrorMessage, Heading, Input, Label, Muted, number, ui } from './primitives';

export function PortionEditor({ food, meal }: { food: FoodRecord; meal: Meal }) {
  const { controller } = useAppRuntime();
  const initial = defaultQuantity(food);
  const [amount, setAmount] = useState(String(initial.amount));
  const [unit, setUnit] = useState(initial.unit);
  const [key, setKey] = useState(generateId);
  const action = useAction();
  const valid = amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const preview = useAsyncResource(useCallback(async () => {
    if (!valid) throw new Error('Enter an amount greater than zero');
    return controller.preview(food, { amount: Number(amount), unit });
  }, [controller, food, amount, unit, valid]));
  return <View style={{ gap: spacing.s12 }}>
    <View style={ui.divider} /><View style={ui.wrap}>{availableUnits(food).map(label => <Button key={label} label={label} selected={unit === label}
      onPress={() => { setUnit(label); setKey(generateId()); }} />)}</View>
    <Input label="Amount" value={amount} keyboardType="decimal-pad" onChangeText={value => { setAmount(value); setKey(generateId()); }} />
    <ErrorMessage message={preview.error ?? action.error} />
    {preview.value?.nutrients && <><Label style={ui.number}>{number(preview.value.nutrients.kcal)} kcal</Label><MacroRow totals={preview.value} />
      {preview.value.nutrients.fiber_g === null && <Muted>Fiber unknown</Muted>}</>}
    <Muted>Source · {sourceLabel(food)}{food.source_version ? ` · v${food.source_version}` : ''}</Muted>
    <Button label={`Add to ${meal}`} primary disabled={!valid || !preview.value?.nutrients || action.busy || preview.loading}
      onPress={() => void action.run(async () => { await controller.confirm({ food, quantity: { amount: Number(amount), unit }, meal, idempotencyKey: key }); setKey(generateId()); })} />
  </View>;
}
export function FoodRow({ candidate, expanded, onToggle, meal }: { candidate: SearchCandidate; expanded: boolean; onToggle: () => void; meal: Meal }) {
  const { food } = candidate;
  const portion = defaultQuantity(food);
  const kcal = calculateNutrition(food, portion).kcal;
  return <Card><Pressable accessibilityRole="button" accessibilityLabel={`Adjust ${food.name}`} accessibilityState={{ expanded }} onPress={onToggle}
    style={[ui.row, { minHeight: MIN_TOUCH_TARGET }]}>
    <View style={{ flex: 1, gap: spacing.s4 }}><Heading>{food.name}</Heading>
      <Muted>{food.prep_state} · {number(portion.amount, 1)} {portion.unit}</Muted>
      <View style={ui.wrap}><Badge label={sourceLabel(food)} /></View>
      {candidate.matchedAlias && <Muted>Matched alias · {candidate.matchedAlias}</Muted>}
    </View><Label style={ui.number}>{number(kcal)} kcal</Label>
  </Pressable>{expanded && <PortionEditor food={food} meal={meal} />}</Card>;
}
export function NewCustomFood() {
  const { controller } = useAppRuntime();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<'per_100g' | 'per_100ml' | 'per_serving'>('per_100g');
  const [fields, setFields] = useState({ kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' });
  const action = useAction();
  return <Card><Button label={open ? 'Close custom food' : 'New custom food'} onPress={() => setOpen(value => !value)} />
    {open && <><Input label="Food name" value={name} onChangeText={setName} /><View style={ui.wrap}>
      {(['per_100g', 'per_100ml', 'per_serving'] as const).map(value => <Button key={value} label={value.replaceAll('_', ' ')} selected={basis === value} onPress={() => setBasis(value)} />)}</View>
      {([['kcal', 'Energy (kcal)'], ['protein_g', 'Protein (g)'], ['carbs_g', 'Carbs (g)'], ['fat_g', 'Fat (g)'], ['fiber_g', 'Fiber (g) · blank if unknown']] as const).map(([key, label]) =>
        <Input key={key} label={label} value={fields[key]} keyboardType="decimal-pad" onChangeText={value => setFields(old => ({ ...old, [key]: value }))} />)}
      <ErrorMessage message={action.error} /><Button primary label="Save to Yours" disabled={action.busy} onPress={() => void action.run(async () => {
        if (['kcal', 'protein_g', 'carbs_g', 'fat_g'].some(key => !fields[key as keyof typeof fields].trim())) throw new Error('Enter energy, protein, carbs and fat. Use 0 only when known.');
        await controller.saveCustomFood({ id: generateId(), name, basis, prep_state: 'unknown', provenance_kind: 'user',
          nutrients: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim() ? Number(value) : null])) });
        setName(''); setFields({ kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' }); setOpen(false);
      })} /></>}
  </Card>;
}
