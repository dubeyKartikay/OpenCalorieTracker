import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useAction, useAIStatus, useAppRuntime, usePacksManager, usePreferences, useTodayDiary } from '../src/app/AppRuntimeContext';
import { localDate, type AppPreferences } from '../src/app/controller';
import type { GoalPeriod, TargetEstimate } from '../src/domain';
import { InlineKeypad } from '../src/ui/components/doop';
import { Badge, Button, Card, energy, ErrorMessage, Heading, Input, Label, Muted, number, Page, ui } from '../src/ui/components/primitives';
import { colors, MIN_TOUCH_TARGET } from '../src/ui/tokens';

function FoodDatabases() {
  const { runtime, value: packs, error } = usePacksManager();
  const action = useAction();
  const reorder = async (index: number, direction: number) => {
    const current = packs?.[index]; const next = packs?.[index + direction];
    if (!current || !next) return;
    // Lower numbers rank first. Normalize all priorities so imported ties reorder too.
    const ordered = [...(packs ?? [])];
    [ordered[index], ordered[index + direction]] = [next, current];
    for (const [position, pack] of ordered.entries()) {
      if (pack.mounted) await runtime.controller.setPackPriority(pack.pack_id, (position + 1) * 100);
    }
  };
  return <Card><Heading>Food Databases</Heading><Muted>Higher in this list ranks first when search matches are equivalent.</Muted>
    {runtime.notices.map(notice => <ErrorMessage key={notice} message={notice} />)}
    {packs?.map((pack, index) => <View key={pack.pack_id} style={{ gap: 8 }}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}><View style={{ flex: 1 }}><Heading>{pack.meta.name}</Heading>
        <Muted>v{pack.meta.version} · {pack.foodCount ?? '—'} foods · priority {pack.priority}</Muted></View>
        <View style={{ minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' }}>
          <Switch accessibilityLabel={`Enable ${pack.meta.name}`} value={pack.enabled && pack.mounted} disabled={action.busy || !pack.mounted}
            trackColor={{ false: colors.track, true: colors.accent }} thumbColor={colors.ink}
            onValueChange={enabled => void action.run(() => runtime.controller.setPackEnabled(pack.pack_id, enabled))} />
        </View></View><View style={ui.wrap}><Badge label={pack.meta.license} /></View>
      <Muted>{pack.meta.attribution_text}{pack.meta.attribution_url ? ` · ${pack.meta.attribution_url}` : ''}</Muted>
      {!pack.mounted && <Muted>File unavailable. Import the pack again to enable it.</Muted>}
      <View style={ui.wrap}><Button label="Priority up" disabled={action.busy || index === 0 || !pack.mounted || !packs[index - 1]?.mounted} onPress={() => void action.run(() => reorder(index, -1))} />
        <Button label="Priority down" disabled={action.busy || index === packs.length - 1 || !pack.mounted || !packs[index + 1]?.mounted} onPress={() => void action.run(() => reorder(index, 1))} /></View>
      <View style={ui.divider} />
    </View>)}
    <ErrorMessage message={action.error ?? error} />
    <Button label="Import .octpack.sqlite file" disabled={action.busy} onPress={() => void action.run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (!picked.canceled && picked.assets[0]) await runtime.importPackFromFile(picked.assets[0].uri);
    })} />
    <Button label="Import sample custom pack" disabled={action.busy} onPress={() => void action.run(() => runtime.importSampleCustomPack())} />
  </Card>;
}
function DailyTargets({ goal, preferences }: { goal: GoalPeriod | null; preferences: AppPreferences }) {
  const { controller } = useAppRuntime();
  const [mode, setMode] = useState<GoalPeriod['mode']>(goal?.mode ?? 'observe');
  const [fields, setFields] = useState({ target_kcal: goal?.target_kcal?.toString() ?? '', protein_g: goal?.protein_g?.toString() ?? '', carbs_g: goal?.carbs_g?.toString() ?? '', fat_g: goal?.fat_g?.toString() ?? '', fiber_g: goal?.fiber_g?.toString() ?? '' });
  const [editing, setEditing] = useState<keyof typeof fields | null>(null);
  const [entry, setEntry] = useState('');
  const [estimator, setEstimator] = useState(false);
  const [adult, setAdult] = useState(preferences.ageConfirmed18Plus);
  const [coefficient, setCoefficient] = useState<5 | -161 | null>(null);
  const [inputs, setInputs] = useState({ age: '', height: '', weight: '', activity: '1.2', rate: '0.25' });
  const [estimate, setEstimate] = useState<TargetEstimate | null>(null);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const energyUnit = preferences.energyUnit;
  const weightFactor = preferences.weightUnit === 'lb' ? 2.2046226218 : 1;
  const makeGoal = (target = fields.target_kcal) => ({ mode, target_kcal: mode === 'observe' ? null : target.trim() ? Number(target) : null,
    protein_g: fields.protein_g.trim() ? Number(fields.protein_g) : null, carbs_g: fields.carbs_g.trim() ? Number(fields.carbs_g) : null,
    fat_g: fields.fat_g.trim() ? Number(fields.fat_g) : null, fiber_g: fields.fiber_g.trim() ? Number(fields.fiber_g) : null });
  const changeInputs = (key: keyof typeof inputs, value: string) => { setInputs(old => ({ ...old, [key]: value })); setEstimate(null); };
  return <Card><Heading>Goals &amp; Estimator</Heading><View style={ui.wrap}>{(['lose', 'maintain', 'gain', 'observe'] as const).map(value =>
    <Button key={value} label={value[0]!.toUpperCase() + value.slice(1)} selected={mode === value} onPress={() => { setMode(value); setEstimate(null); setSaved(false); }} />)}</View>
    {([['target_kcal', 'Energy'], ['protein_g', 'Protein'], ['carbs_g', 'Carbs'], ['fat_g', 'Fat'], ['fiber_g', 'Fiber']] as const).map(([key, label]) =>
      <Button key={key} label={`${label} · ${key === 'target_kcal' && mode === 'observe' ? 'Observe' : key === 'target_kcal' ? energy(fields[key] ? Number(fields[key]) : null, energyUnit) : `${number(fields[key] ? Number(fields[key]) : null, 1)} g`}`}
        disabled={key === 'target_kcal' && mode === 'observe'} onPress={() => {
          setEditing(value => value === key ? null : key);
          setEntry(fields[key] ? String(key === 'target_kcal' && energyUnit === 'kJ' ? Number(fields[key]) * 4.184 : Number(fields[key])) : '');
        }} />)}
    {editing && <><Muted>{editing === 'target_kcal' ? energyUnit : 'grams'}</Muted><InlineKeypad value={entry} onChange={setEntry} maxDecimals={1} />
      <View style={ui.wrap}><Button label="Apply value" onPress={() => {
        setFields(old => ({ ...old, [editing]: entry.trim() && entry !== '.' ? String(Number(entry) / (editing === 'target_kcal' && energyUnit === 'kJ' ? 4.184 : 1)) : '' })); setEditing(null); setSaved(false);
      }} /><Button label="Clear target" onPress={() => { setFields(old => ({ ...old, [editing]: '' })); setEditing(null); setSaved(false); }} /></View></>}
    <Muted>Effective from {localDate()}. Earlier days retain their targets.</Muted>
    <Button label="Save targets from today" primary disabled={action.busy} onPress={() => void action.run(async () => {
      if (mode !== 'observe' && !fields.target_kcal.trim()) throw new Error('Enter an energy target or choose Observe');
      await controller.saveGoal(makeGoal()); setSaved(true);
    })} />{saved && <Muted>Targets saved.</Muted>}
    <Button label={estimator ? 'Close estimator' : 'Mifflin–St Jeor estimator'} selected={estimator} onPress={() => setEstimator(value => !value)} />
    {estimator && <><Button label="I am 18 or older" selected={adult} onPress={() => { setAdult(value => !value); setEstimate(null); }} />
      <Input label="Age (years)" keyboardType="decimal-pad" value={inputs.age} onChangeText={value => changeInputs('age', value)} />
      <Input label="Height (cm)" keyboardType="decimal-pad" value={inputs.height} onChangeText={value => changeInputs('height', value)} />
      <Input label={`Weight (${preferences.weightUnit})`} keyboardType="decimal-pad" value={inputs.weight} onChangeText={value => changeInputs('weight', value)} />
      <Muted>Equation coefficient</Muted><View style={ui.wrap}>{([5, -161] as const).map(value => <Button key={value} label={value === 5 ? '+5' : '−161'} selected={coefficient === value} onPress={() => { setCoefficient(value); setEstimate(null); }} />)}</View>
      <Input label="Activity multiplier (1–3)" keyboardType="decimal-pad" value={inputs.activity} onChangeText={value => changeInputs('activity', value)} />
      {(mode === 'lose' || mode === 'gain') && <Input label={`Weekly change (${preferences.weightUnit}/week)`} keyboardType="decimal-pad" value={inputs.rate} onChangeText={value => changeInputs('rate', value)} />}
      <Muted>BMR = 10 × kg + 6.25 × cm − 5 × age + coefficient. Maintenance = BMR × activity. Target adjusts maintenance by weekly change × 7,700 ÷ 7.</Muted>
      <Muted>Starter estimate · {energy(1500, energyUnit)} floor · 1% body weight/week cap.</Muted>
      <Button label="Preview estimate" disabled={action.busy || !adult || coefficient === null} onPress={() => void action.run(async () => {
        if (!adult || coefficient === null) throw new Error('Confirm adult age and select an equation coefficient');
        if (![inputs.age, inputs.height, inputs.weight, inputs.activity].every(value => value.trim())) throw new Error('Enter age, height, weight and activity');
        setEstimate(controller.estimateTargetPreview({ adultConfirmed: true, ageYears: Number(inputs.age), heightCm: Number(inputs.height), weightKg: Number(inputs.weight) / weightFactor,
          equationCoefficient: coefficient, activityFactor: Number(inputs.activity), activityAssumption: 'User selected activity multiplier', mode, weeklyRateKg: mode === 'lose' || mode === 'gain' ? Number(inputs.rate) / weightFactor : 0 }));
      })} />
      {estimate && <><Label style={ui.number}>BMR {energy(estimate.bmrKcal, energyUnit)} · Maintenance {energy(estimate.maintenanceKcal, energyUnit)}</Label>
        <Heading>{estimate.targetKcal === null ? 'Observe · no energy budget' : energy(estimate.targetKcal, energyUnit)}</Heading>
        {estimate.notices.map(notice => <Muted key={notice}>{notice}</Muted>)}
        <Button label="Use estimate" primary disabled={action.busy} onPress={() => void action.run(async () => {
          const target = estimate.targetKcal?.toString() ?? '';
          await controller.saveGoal(makeGoal(target)); setFields(old => ({ ...old, target_kcal: target })); setSaved(true);
        })} /></>}
    </>}
    <ErrorMessage message={action.error} />
  </Card>;
}
function Preferences({ preferences }: { preferences: AppPreferences }) {
  const { controller } = useAppRuntime();
  const [meals, setMeals] = useState(preferences.mealSections);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  return <Card><Heading>Preferences</Heading><Muted>Energy</Muted><View style={ui.wrap}>{(['kcal', 'kJ'] as const).map(energyUnit =>
    <Button key={energyUnit} label={energyUnit} selected={preferences.energyUnit === energyUnit} disabled={action.busy} onPress={() => void action.run(() => controller.updatePreferences({ energyUnit }))} />)}</View>
    <Muted>Weight</Muted><View style={ui.wrap}>{(['kg', 'lb'] as const).map(weightUnit =>
      <Button key={weightUnit} label={weightUnit} selected={preferences.weightUnit === weightUnit} disabled={action.busy} onPress={() => void action.run(() => controller.updatePreferences({ weightUnit }))} />)}</View>
    <Heading>Meal sections</Heading>{meals.map((meal, index) => <View key={index} style={[ui.row, { alignItems: 'flex-end' }]}><View style={{ flex: 1 }}><Input label={`Meal ${index + 1}`} value={meal} onChangeText={value => { setMeals(old => old.map((item, position) => position === index ? value : item)); setSaved(false); }} /></View>
      <Button label="×" accessibilityLabel={`Remove meal ${index + 1}`} disabled={meals.length === 1} onPress={() => { setMeals(old => old.filter((_, position) => position !== index)); setSaved(false); }} /></View>)}
    <View style={ui.wrap}><Button label="+ Meal section" onPress={() => { setMeals(old => [...old, '']); setSaved(false); }} />
      <Button label="Save meal sections" disabled={action.busy} onPress={() => void action.run(async () => {
        const mealSections = meals.map(meal => meal.trim());
        if (mealSections.some(meal => !meal) || new Set(mealSections).size !== mealSections.length) throw new Error('Give each meal section a unique, non-empty name');
        await controller.updatePreferences({ mealSections }); setSaved(true);
      })} /></View>{saved && <Muted>Meal sections saved.</Muted>}
    <View style={ui.wrap}><Button label="Run onboarding" onPress={() => router.push('/onboarding')} /><Button label="Recipes & batches" onPress={() => router.push('/recipes')} /></View>
    <ErrorMessage message={action.error} />
  </Card>;
}
function Backup() {
  const runtime = useAppRuntime();
  const [json, setJson] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof runtime.controller.previewRestore> | null>(null);
  const [path, setPath] = useState('');
  const [message, setMessage] = useState('');
  const action = useAction();
  const updateJson = (text: string) => { setJson(text); setPreview(null); setMessage(''); };
  return <Card><Heading>Data &amp; Backup</Heading>
    <Button label="Export JSON (v1)" disabled={action.busy} onPress={() => void action.run(async () => {
      const exported = await runtime.controller.exportJson();
      updateJson(exported); setPreview(runtime.controller.previewRestore(exported));
      setPath(await runtime.saveBackup(exported));
    })} />
    {!!path && <Text selectable style={ui.muted}>Saved backup: {path}</Text>}
    <Muted>V1 includes frozen diary snapshots, custom foods, recipes, batches, goals, weigh-ins and pack metadata. Pack files, saved meals, personal units, barcode links, learned portions and local settings are not included.</Muted>
    <Button label="Open JSON backup file" disabled={action.busy} onPress={() => void action.run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (!picked.canceled && picked.assets[0]) updateJson(await runtime.readTextFile(picked.assets[0].uri));
    })} />
    <Input label="Backup JSON · copy or paste" value={json} onChangeText={updateJson} multiline autoCapitalize="none" autoCorrect={false} style={{ minHeight: 160, maxHeight: 320, textAlignVertical: 'top' }} />
    <Button label="Validate & preview restore" disabled={action.busy || !json.trim()} onPress={() => void action.run(async () => { setPreview(runtime.controller.previewRestore(json)); })} />
    {preview && <><Label style={ui.number}>{preview.days} days · {preview.entries} entries · {preview.foods} foods · {preview.packs} pack records</Label>
      <Muted>{preview.bundle.recipes.length} recipes · {preview.bundle.recipe_batches.length} batches · {preview.goals} goals · {preview.weighIns} weigh-ins</Muted>
      <Muted>Merge keeps existing records on conflicts. Replace clears existing personal data and local settings. Restored pack metadata needs its pack file imported again.</Muted>
      <View style={ui.wrap}>{(['merge', 'replace'] as const).map(mode => <Button key={mode} label={`Restore JSON · ${mode === 'merge' ? 'Merge' : 'Replace'}`} disabled={action.busy}
        onPress={() => void action.run(async () => { await runtime.controller.restoreJson(json, mode); setPreview(null); setMessage('Backup restored.'); })} />)}</View>
    </>}
    <ErrorMessage message={action.error} />{!!message && <Muted>{message}</Muted>}
  </Card>;
}
function AIAndPrivacy({ preferences }: { preferences: AppPreferences | undefined }) {
  const { controller } = useAppRuntime();
  const ai = useAIStatus();
  const action = useAction();
  return <>
    <Card><Heading>AI · ChatGPT</Heading>
      <View style={ui.row}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ai.value && ai.value.mode !== 'disconnected' ? colors.success : colors.muted }} />
        <Muted>{ai.loading ? 'Checking connection…' : ai.value?.mode === 'api_key' ? 'Connected · API key' : ai.value?.mode === 'chatgpt_oauth' ? 'Connected · ChatGPT plan' : 'Not connected'}</Muted></View>
      <Button label="ChatGPT settings →" onPress={() => router.push('/chatgpt')} /><ErrorMessage message={ai.error} />
    </Card>
    <Card><Heading>Barcode</Heading><View style={[ui.row, { justifyContent: 'space-between' }]}>
      <View style={{ flex: 1 }}><Label>Look up unknown barcodes on Open Food Facts</Label></View>
      <View style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
        <Switch accessibilityLabel="Look up unknown barcodes on Open Food Facts" value={preferences?.allowLiveOffLookup ?? false}
          disabled={!preferences || action.busy} trackColor={{ false: colors.track, true: colors.accent }} thumbColor={colors.ink}
          onValueChange={allowLiveOffLookup => void action.run(() => controller.updatePreferences({ allowLiveOffLookup }))} />
      </View></View><Muted>Sends barcode digits only to world.openfoodfacts.org; results cached separately</Muted>
      <ErrorMessage message={action.error} />
    </Card>
    <Card><Heading>What&apos;s sent where</Heading>
      <Label>OpenAI</Label><Muted>Meal text or photo, only when you use AI. Never your diary.</Muted>
      <Label>Open Food Facts</Label><Muted>Barcode digits only, if live lookup is turned on.</Muted>
      <Label>Food packs</Label><Muted>Stored locally on this device. Zero search traffic.</Muted>
      <Label>Dictation</Label><Muted>Handled by your device keyboard.</Muted>
    </Card>
  </>;
}
export default function Settings() {
  const today = useTodayDiary();
  const preferences = usePreferences();
  return <Page title="Settings" action={<Button label="Done" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />}>
    <ErrorMessage message={today.error ?? preferences.error} />
    {today.value && preferences.value && <><DailyTargets key={`${today.value.goal?.id ?? 'new'}:${preferences.value.energyUnit}:${preferences.value.weightUnit}`} goal={today.value.goal} preferences={preferences.value} /><Preferences key={preferences.value.mealSections.join('|')} preferences={preferences.value} /></>}
    <FoodDatabases /><AIAndPrivacy preferences={preferences.value} /><Backup />
  </Page>;
}
