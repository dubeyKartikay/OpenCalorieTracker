import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useAction, useAppRuntime, usePreferences } from '../src/app/AppRuntimeContext';
import { defaultQuantity } from '../src/app/controller';
import { getFossScannerCapability, type BarcodeResolution, type ParsedNutritionLabel } from '../src/barcode';
import { calculateNutrition, generateId, type FoodRecord, type Quantity } from '../src/domain';
import { UndoToast } from '../src/ui/components/Diary';
import { InlineKeypad } from '../src/ui/components/doop';
import { BarcodeFoundCard, BarcodeNotFoundCard, CustomFoodFormCard, SegmentedSwitch, type CustomFoodFormValues } from '../src/ui/components/capture';
import { Badge, Button, Card, energy, ErrorMessage, Heading, Input, Muted, Page, ui } from '../src/ui/components/primitives';

const samples = [
  { label: 'Amul Milk', code: '8901262010016' },
  { label: 'Millet Cookies', code: '8906012345677' },
  { label: 'UPC-E', code: '04252614', symbology: 'UPC-E' },
  { label: 'Unknown', code: '8909999999994' },
];
const tierLabels = { personal: 'Yours', pack: 'Food pack', off_cache: 'Open Food Facts · cached', off_live: 'Open Food Facts · live' };

function portionChoices(food: FoodRecord) {
  const quantities: Quantity[] = [defaultQuantity(food), { amount: 100, unit: food.basis === 'per_100ml' ? 'ml' : 'g' }, ...food.units.map(unit => ({ amount: 1, unit: unit.label }))];
  const seen = new Set<string>();
  return quantities.flatMap(quantity => {
    const key = `${quantity.amount}:${quantity.unit}`;
    if (seen.has(key)) return [];
    seen.add(key);
    try { return [{ quantity, nutrients: calculateNutrition(food, quantity) }]; } catch { return []; }
  });
}

function numeric(value: string, label: string, required = false): number | null {
  if (!value.trim()) {
    if (required) throw new Error(`Enter ${label} from the label before saving`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Enter a valid non-negative ${label}`);
  return parsed;
}

export default function Barcode() {
  const params = useLocalSearchParams<{ meal?: string }>();
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const meal = params.meal?.trim() || preferences.value?.mealSections[0] || 'Lunch';
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const action = useAction();
  const [mode, setMode] = useState('barcode');
  const [code, setCode] = useState('');
  const [symbology, setSymbology] = useState('');
  const [result, setResult] = useState<BarcodeResolution | null>(null);
  const [selected, setSelected] = useState(0);
  const [labelText, setLabelText] = useState('');
  const [custom, setCustom] = useState<{ id: string; barcode: { rawCode: string; symbology?: string } | null; label: ParsedNutritionLabel | null; energyUnit: 'kcal' | 'kJ' } | null>(null);
  const [notice, setNotice] = useState('');
  const [loggedHere, setLoggedHere] = useState(false);
  const scanner = getFossScannerCapability();
  const changeCode = (value: string) => { setCode(value.replace(/\D/g, '').slice(0, 14)); setSymbology(''); setResult(null); setCustom(null); setNotice(''); };
  const resolve = (rawCode = code, format = symbology) => void action.run(async () => {
    setCustom(null); setNotice(''); setResult(null);
    const resolved = await controller.resolveBarcode(rawCode, rawCode.length === 8 ? format : undefined);
    setResult(resolved); setSelected(0);
  });
  const found = result?.status === 'found' ? result : null;
  const showingOutcome = Boolean(found || result?.status === 'not_found' || custom);
  const portions = found ? portionChoices(found.food) : [];
  const parsed = custom?.label;
  const formUnit = custom?.energyUnit ?? unit;
  // The form displays the chosen energy unit and returns canonical kcal.
  const field = (value: number | null | undefined) => value == null ? '' : String(value);
  const initialValues: Partial<CustomFoodFormValues> = parsed ? {
    ...(parsed.basis ? { basis: parsed.basis } : {}), servingAmount: field(parsed.serving_g),
    kcal: field(parsed.nutrients.kcal === null ? null : parsed.nutrients.kcal * (formUnit === 'kJ' ? 4.184 : 1)),
    proteinG: field(parsed.nutrients.protein_g), carbsG: field(parsed.nutrients.carbs_g), fatG: field(parsed.nutrients.fat_g),
    fiberG: field(parsed.nutrients.fiber_g), sugarG: field(parsed.nutrients.sugar_g),
  } : {};
  const saveCustom = (values: CustomFoodFormValues, log: boolean) => void action.run(async () => {
    if (!custom) return;
    const servingG = values.basis === 'per_serving' ? numeric(values.servingAmount, 'serving weight')
      : custom.label?.basis === values.basis ? custom.label.serving_g : null;
    if (servingG === 0) throw new Error('Serving weight must be greater than zero');
    const food = await controller.saveCustomFoodWithBarcode({
      id: custom.id, name: values.name.trim(), brand: values.brand.trim() || null, basis: values.basis,
      prep_state: 'unknown', provenance_kind: 'user', serving_g: servingG,
      serving_ml: custom.label?.basis === values.basis ? custom.label.serving_ml : null,
      nutrients: {
        ...custom.label?.nutrients,
        kcal: numeric(values.kcal, 'energy', true), protein_g: numeric(values.proteinG, 'protein', true),
        carbs_g: numeric(values.carbsG, 'carbs', true), fat_g: numeric(values.fatG, 'fat', true),
        fiber_g: numeric(values.fiberG, 'fiber'), sugar_g: numeric(values.sugarG, 'sugar'),
      },
    }, custom.barcode);
    if (log) {
      await controller.confirm({ food, quantity: defaultQuantity(food), meal, idempotencyKey: `custom:${custom.id}` });
      setLoggedHere(true);
    }
    setCustom(null); setResult(null); setNotice(log ? `Saved and added to ${meal}.` : 'Custom food saved to your library.');
  });

  return <Page title="Barcode" action={<View style={ui.row}><Badge label={meal} /><Button label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} /></View>} footer={loggedHere ? <UndoToast /> : undefined}>
    <SegmentedSwitch options={[{ value: 'barcode', label: 'Barcode' }, { value: 'label', label: 'Label text' }]} value={mode}
      onChange={value => { if (!action.busy) { setMode(value); setCustom(null); setResult(null); setNotice(''); } }} />
    <ErrorMessage message={action.error ?? preferences.error} />
    {!!notice && <Muted>{notice}</Muted>}
    {mode === 'barcode' ? <>
      {found && <><BarcodeFoundCard name={found.food.name} brand={found.food.brand} sourceLabel={tierLabels[found.tier]}
        basisSummary={`${found.food.basis === 'per_serving' ? 'Per serving' : found.food.basis === 'per_100ml' ? 'Per 100 ml' : 'Per 100 g'} · ${energy(found.food.nutrients.kcal, unit)}`}
        portions={portions.map(({ quantity, nutrients }) => ({ label: quantity.amount === 1 && /^\d/.test(quantity.unit) ? quantity.unit : `${quantity.amount} ${quantity.unit}`, energyText: energy(nutrients.kcal, unit), proteinG: nutrients.protein_g, carbsG: nutrients.carbs_g, fatG: nutrients.fat_g }))}
        selectedIndex={selected} onSelectPortion={setSelected} mealLabel={meal} busy={action.busy}
        onConfirm={() => void action.run(async () => {
          const portion = portions[selected]; if (!portion) throw new Error('Choose a valid portion');
          await controller.confirm({ food: found.food, quantity: portion.quantity, meal, idempotencyKey: generateId() });
          setLoggedHere(true); setResult(null); setNotice(`Added to ${meal}.`);
        })} onRescan={() => { setResult(null); setCustom(null); changeCode(''); }} />
        {found.attribution && <Muted>{found.attribution.name} · {found.attribution.license}{found.attribution.url ? ` · ${found.attribution.url}` : ''}</Muted>}</>}
      {result?.status === 'not_found' && !custom && <BarcodeNotFoundCard code={result.normalized.rawCode}
        liveLookupNote={result.liveLookupAttempted ? result.liveLookupError ? 'Live Open Food Facts lookup was unavailable. You can still create this food offline.' : 'Open Food Facts was checked; no match found.' : 'Live Open Food Facts lookup is off. Only local foods, food packs and the separate cache were checked.'}
        onCreateCustom={() => setCustom({ id: generateId(), barcode: { rawCode: code, ...(symbology ? { symbology } : {}) }, label: null, energyUnit: unit })}
        onTypeAgain={() => changeCode('')} />}
      {!showingOutcome && <>
        <Muted>FOSS scanner · zxing-cpp (Apache-2.0, no ML Kit) · {scanner.liveCamera.description}</Muted>
        <Card><Heading>Type barcode</Heading>
          <Input label="Barcode digits" value={code} keyboardType="number-pad" autoCorrect={false} onChangeText={changeCode} editable={!action.busy} />
          {/* A leading sentinel keeps the numeric keypad from collapsing barcode zeros. */}
          <InlineKeypad value={`1${code}`} showReadout={false} allowDecimal={false}
            onChange={next => { if (!action.busy) changeCode(next.startsWith('1') ? next.slice(1) : ''); }} />
          {code.length === 8 && <><Muted>Choose the eight-digit barcode format printed on the packet.</Muted>
            <SegmentedSwitch options={[{ value: 'EAN-8', label: 'EAN-8' }, { value: 'UPC-E', label: 'UPC-E' }]} value={symbology}
              onChange={value => { if (!action.busy) { setSymbology(value); setResult(null); setCustom(null); } }} /></>}
          <Button label={action.busy ? 'Looking up…' : 'Look up barcode'} primary disabled={action.busy || !code || (code.length === 8 && !symbology)} onPress={() => resolve()} />
        </Card>
        <Muted>Samples use the custom pack in Settings → Food Databases.</Muted>
        <View style={ui.wrap}>{samples.map(sample => <Button key={sample.code} label={`${sample.label} · ${sample.code}`} disabled={action.busy}
          onPress={() => { setCode(sample.code); setSymbology(sample.symbology ?? ''); resolve(sample.code, sample.symbology ?? ''); }} />)}</View>
      </>}
    </> : <Card><Heading>Offline label parser</Heading><Muted>Paste nutrition label text. Nothing leaves this device. Review the detected basis and values before saving.</Muted>
      <Input label="Nutrition label text" value={labelText} onChangeText={value => { setLabelText(value); setCustom(null); }} multiline
        style={{ minHeight: 160, textAlignVertical: 'top' }} placeholder={'Per 100 g\nEnergy 250 kcal\nProtein 8 g\nCarbohydrate 40 g\nFat 6 g'} />
      <Button label="Review label" primary disabled={action.busy || !labelText.trim()} onPress={() => void action.run(async () => {
        setCustom({ id: generateId(), barcode: null, label: controller.parseLabelText(labelText), energyUnit: unit }); setNotice('');
      })} /></Card>}
    {custom && <>{parsed?.warnings.map(warning => <Muted key={warning}>{warning}</Muted>)}
      {parsed?.serving_ml != null && <Muted>Printed serving volume: {parsed.serving_ml} ml. Leave serving weight blank to retain this volume.</Muted>}
      <CustomFoodFormCard key={custom.id} initialBarcode={custom.barcode?.rawCode} initialValues={initialValues} energyUnit={formUnit}
        busy={action.busy} onSaveAndLog={values => saveCustom(values, true)} onSaveOnly={values => saveCustom(values, false)} onCancel={() => setCustom(null)} /></>}
  </Page>;
}
