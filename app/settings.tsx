import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useAction, useAppRuntime, usePacksManager, useTodayDiary } from '../src/app/AppRuntimeContext';
import { localDate } from '../src/app/controller';
import type { GoalPeriod } from '../src/domain';
import { Badge, Button, Card, ErrorMessage, Heading, Input, Label, Muted, Page, ui } from '../src/ui/components/primitives';
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
function DailyTargets() {
  const { controller } = useAppRuntime();
  const today = useTodayDiary();
  const [mode, setMode] = useState<GoalPeriod['mode']>('observe');
  const [fields, setFields] = useState({ target_kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' });
  const [initialized, setInitialized] = useState(false);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  if (!initialized && today.value) {
    const goal = today.value.goal;
    if (goal) {
      setMode(goal.mode);
      setFields({ target_kcal: goal.target_kcal?.toString() ?? '', protein_g: goal.protein_g?.toString() ?? '',
        carbs_g: goal.carbs_g?.toString() ?? '', fat_g: goal.fat_g?.toString() ?? '', fiber_g: goal.fiber_g?.toString() ?? '' });
    }
    setInitialized(true);
  }
  return <Card><Heading>Daily Targets</Heading><View style={ui.wrap}>{(['lose', 'maintain', 'gain', 'observe'] as const).map(value =>
    <Button key={value} label={value[0]!.toUpperCase() + value.slice(1)} selected={mode === value} onPress={() => { setMode(value); setSaved(false); }} />)}</View>
    {([['target_kcal', 'Calories (kcal)'], ['protein_g', 'Protein (g)'], ['carbs_g', 'Carbs (g)'], ['fat_g', 'Fat (g)'], ['fiber_g', 'Fiber (g)']] as const).map(([key, label]) =>
      <Input key={key} label={label} value={key === 'target_kcal' && mode === 'observe' ? '' : fields[key]} editable={key !== 'target_kcal' || mode !== 'observe'} keyboardType="decimal-pad"
        onChangeText={value => { setSaved(false); setFields(old => ({ ...old, [key]: value })); }} />)}
    <Muted>Effective from {localDate()}. Earlier days keep their targets. Blank macro targets are unset. Observe mode has no calorie budget.</Muted>
    <ErrorMessage message={action.error ?? today.error} /><Button label="Save targets from today" primary disabled={action.busy || !initialized} onPress={() => void action.run(async () => {
      if (mode !== 'observe' && !fields.target_kcal.trim()) throw new Error('Enter a calorie target or choose Observe');
      await controller.saveGoal({ mode, target_kcal: mode === 'observe' ? null : Number(fields.target_kcal),
        protein_g: fields.protein_g.trim() ? Number(fields.protein_g) : null, carbs_g: fields.carbs_g.trim() ? Number(fields.carbs_g) : null,
        fat_g: fields.fat_g.trim() ? Number(fields.fat_g) : null, fiber_g: fields.fiber_g.trim() ? Number(fields.fiber_g) : null }); setSaved(true);
    })} />{saved && <Muted>Targets saved.</Muted>}
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
export default function Settings() {
  return <Page title="Settings" action={<Button label="Done" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />}>
    <FoodDatabases /><DailyTargets /><Backup />
  </Page>;
}
