import { router, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useMemo, useState, type PropsWithChildren } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useAction, useAIStatus, useAppRuntime, useHealthStatus, usePacksManager, usePreferences, useTodayDiary } from '../src/app/AppRuntimeContext';
import { localDate, type AppPreferences } from '../src/app/controller';
import type { GoalPeriod, TargetEstimate } from '../src/domain';
import type { HealthPermissionScope } from '../src/health';
import { SegmentedSwitch } from '../src/ui/components/capture';
import { NumericEditor } from '../src/ui/components/doop';
import { DoopIcon } from '../src/ui/components/DoopIcons';
import { BackHeader, Badge, Button, DottedValue, energy, energyValue, ErrorMessage, goBackOrReplace, Input, Label, Muted, number, Page, SectionRule, toCanonicalKcal, ui } from '../src/ui/components/primitives';
import { hapticSelection, hapticSuccess } from '../src/ui/haptics';
import { colors, fontFace, radius, tabularNums } from '../src/ui/tokens';
import { NumericField } from '../src/ui/components/recipes/RecipeEditor';

function Card({ children }: PropsWithChildren) { return <View style={{ gap: 10 }}>{children}</View>; }
function Pill({ label, selected = false, filled = false, disabled = false, onPress }: { label: string; selected?: boolean; filled?: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => { if (!selected) hapticSelection(); onPress(); }}
    style={[styles.pill, selected && styles.pillSelected, selected && filled && styles.pillFilled, disabled && { opacity: 0.45 }]}>
    <Text style={[styles.pillText, selected && { color: filled ? colors.onAccent : colors.accent }]}>{label}</Text>
  </Pressable>;
}
function NavRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.nav}><Text style={styles.label}>{label}</Text><View style={[ui.row, { marginLeft: 'auto', gap: 5 }]}>
    {!!value && <Text style={styles.note}>{value}</Text>}<DoopIcon name="chevronRight" size={16} color={colors.muted} /></View></Pressable>;
}
function FoodDatabases() {
  const { runtime, value: packs, error } = usePacksManager();
  const action = useAction();
  const reorder = async (index: number, direction: number) => {
    const current = packs?.[index]; const next = packs?.[index + direction]; if (!current || !next) return;
    const ordered = [...(packs ?? [])]; [ordered[index], ordered[index + direction]] = [next, current];
    for (const [position, pack] of ordered.entries()) if (pack.mounted) await runtime.controller.setPackPriority(pack.pack_id, (position + 1) * 100);
  };
  return <Card><SectionRule label="Food databases" uppercase /><Muted>Higher in this list ranks first when search matches are equivalent.</Muted>
    {runtime.notices.map(notice => <ErrorMessage key={notice} message={notice} />)}
    {packs?.map((pack, index) => <View key={pack.pack_id} style={{ gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.hairline }}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}><View style={{ flex: 1 }}><Label>{pack.meta.name}</Label><Muted>v{pack.meta.version} · {pack.foodCount ?? '—'} foods · priority {pack.priority}</Muted></View>
        <Switch accessibilityLabel={`Enable ${pack.meta.name}`} value={pack.enabled && pack.mounted} disabled={action.busy || !pack.mounted} trackColor={{ false: colors.track, true: colors.accent }} thumbColor={colors.ink}
          onValueChange={enabled => void action.run(() => runtime.controller.setPackEnabled(pack.pack_id, enabled))} />
      </View><View style={ui.wrap}><Badge label={pack.meta.license} /></View><Muted>{pack.meta.attribution_text}{pack.meta.attribution_url ? ` · ${pack.meta.attribution_url}` : ''}</Muted>
      {!pack.mounted && <Muted>File unavailable. Import the pack again to enable it.</Muted>}
      <View style={ui.wrap}><Button label="Priority up" quiet disabled={action.busy || index === 0 || !pack.mounted || !packs[index - 1]?.mounted} onPress={() => void action.run(() => reorder(index, -1))} />
        <Button label="Priority down" quiet disabled={action.busy || index === packs.length - 1 || !pack.mounted || !packs[index + 1]?.mounted} onPress={() => void action.run(() => reorder(index, 1))} /></View>
    </View>)}
    <ErrorMessage message={action.error ?? error} />
    <Button label="Import .octpack.sqlite file" quiet disabled={action.busy} onPress={() => void action.run(async () => { const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true }); if (!picked.canceled && picked.assets[0]) await runtime.importPackFromFile(picked.assets[0].uri); })} />
    <Button label="Import sample custom pack" quiet disabled={action.busy} onPress={() => void action.run(() => runtime.importSampleCustomPack())} />
  </Card>;
}
function DailyTargets({ goal, preferences }: { goal: GoalPeriod | null; preferences: AppPreferences }) {
  const { controller } = useAppRuntime();
  const action = useAction();
  const [mode, setMode] = useState<GoalPeriod['mode']>(goal?.mode ?? 'observe');
  const [fields, setFields] = useState({ target_kcal: goal?.target_kcal?.toString() ?? '', protein_g: goal?.protein_g?.toString() ?? '', carbs_g: goal?.carbs_g?.toString() ?? '', fat_g: goal?.fat_g?.toString() ?? '', fiber_g: goal?.fiber_g?.toString() ?? '' });
  const [editing, setEditing] = useState<keyof typeof fields | null>(null);
  const [entry, setEntry] = useState('');
  const [dirty, setDirty] = useState(false);
  const [estimator, setEstimator] = useState(false);
  const [adult, setAdult] = useState(preferences.ageConfirmed18Plus);
  const [coefficient, setCoefficient] = useState<5 | -161 | null>(null);
  const [inputs, setInputs] = useState({ age: null as number | null, height: null as number | null, weight: null as number | null, activity: 1.2, rate: 0.4 });
  const estimate = useMemo<{ value: TargetEstimate | null; error: string | null }>(() => {
    if (!adult || coefficient === null || inputs.age === null || inputs.height === null || inputs.weight === null) return { value: null, error: null };
    try { return { value: controller.estimateTargetPreview({ adultConfirmed: true, ageYears: inputs.age, heightCm: inputs.height, weightKg: inputs.weight / (preferences.weightUnit === 'lb' ? 2.2046226218 : 1),
      equationCoefficient: coefficient, activityFactor: inputs.activity, activityAssumption: 'User selected activity multiplier', mode, weeklyRateKg: mode === 'lose' || mode === 'gain' ? inputs.rate : 0 }), error: null }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [adult, coefficient, controller, inputs, mode, preferences.weightUnit]);
  const makeGoal = (target = fields.target_kcal) => ({ mode, target_kcal: mode === 'observe' ? null : target.trim() ? Number(target) : null,
    protein_g: fields.protein_g.trim() ? Number(fields.protein_g) : null, carbs_g: fields.carbs_g.trim() ? Number(fields.carbs_g) : null,
    fat_g: fields.fat_g.trim() ? Number(fields.fat_g) : null, fiber_g: fields.fiber_g.trim() ? Number(fields.fiber_g) : null });
  const edit = (key: keyof typeof fields) => {
    setEditing(current => current === key ? null : key);
    if (!fields[key]) { setEntry(''); return; }
    const displayed = key === 'target_kcal' ? energyValue(Number(fields[key]), preferences.energyUnit) : Number(fields[key]);
    setEntry(displayed == null ? '' : String(Math.round(displayed * 10) / 10));
  };
  return <View>
    <Text style={styles.sectionLabel}>Goal</Text><View style={styles.goalTrack}>{(['lose', 'maintain', 'gain', 'observe'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: mode === value }}
      onPress={() => { if (mode !== value) hapticSelection(); setMode(value); setDirty(true); }} style={[styles.goalPill, mode === value && styles.pillSelected]}><Text style={[styles.pillText, mode === value && { color: colors.accent }]}>{value[0]!.toUpperCase() + value.slice(1)}</Text></Pressable>)}</View>
    {(mode === 'lose' || mode === 'gain') && <View style={[ui.row, { gap: 6, marginTop: 10 }]}>{[0.25, 0.4, 0.5].map(rate => <Pill key={rate} label={String(rate)} selected={inputs.rate === rate} onPress={() => setInputs(old => ({ ...old, rate }))} />)}<Text style={styles.note}>kg/wk</Text></View>}
    <View style={{ marginTop: 28 }}><Text style={styles.sectionLabel}>Daily targets</Text>
      <View style={styles.targetRow}><Text style={styles.label}>Calories</Text><DottedValue size={16} value={mode === 'observe' ? 'Off' : number(fields.target_kcal ? energyValue(Number(fields.target_kcal), preferences.energyUnit) : null)} unit={mode === 'observe' ? '' : preferences.energyUnit} onPress={() => { if (mode !== 'observe') edit('target_kcal'); }} /></View>
      <View style={styles.targetRow}><Pressable accessibilityRole="button" accessibilityLabel="How the estimate is worked out" onPress={() => setEstimator(open => !open)} style={[ui.row, { gap: 5, minHeight: 44 }]}>
        <Text style={styles.note}>Estimate {energy(estimate.value?.targetKcal, preferences.energyUnit)}</Text><DoopIcon name="info" size={14} color={colors.muted} /></Pressable>
        <Pressable accessibilityRole="button" disabled={action.busy} onPress={() => { if (!estimate.value) { setEstimator(true); return; } void action.run(async () => { const target = estimate.value!.targetKcal?.toString() ?? ''; await controller.saveGoal(makeGoal(target)); setFields(old => ({ ...old, target_kcal: target })); setDirty(false); }); }} style={styles.textButton}><Text style={styles.accentText}>Use</Text></Pressable>
      </View>
      {estimator && <View style={styles.estimator}><Text style={[styles.label, fontFace('bold')]}>Mifflin–St Jeor</Text>
        {!adult && <Button label="I am 18 or older" quiet selected={adult} onPress={() => setAdult(value => !value)} />}
        <View style={ui.row}><Text style={styles.note}>Sex for equation</Text><Pill label="M" selected={coefficient === 5} onPress={() => setCoefficient(5)} /><Pill label="F" selected={coefficient === -161} onPress={() => setCoefficient(-161)} /></View>
        <NumericField label="Age" unit="years" value={inputs.age} minimum={18} integer onChange={age => setInputs(old => ({ ...old, age }))} />
        <NumericField label="Height" unit="cm" value={inputs.height} minimum={0.01} onChange={height => setInputs(old => ({ ...old, height }))} />
        <NumericField label="Weight" unit={preferences.weightUnit} value={inputs.weight} minimum={0.01} onChange={weight => setInputs(old => ({ ...old, weight }))} />
        <Text style={styles.note}>Activity</Text><View style={[ui.row, { gap: 4 }]}>{[1.2, 1.375, 1.55, 1.725].map(activity => <Pill key={activity} label={String(activity)} selected={inputs.activity === activity} onPress={() => setInputs(old => ({ ...old, activity }))} />)}</View>
        <Text style={styles.note}>BMR = 10 × kg + 6.25 × cm − 5 × age + {coefficient ?? 'coefficient'}</Text>
        {estimate.value && <><Text style={styles.note}>BMR {energy(estimate.value.bmrKcal, preferences.energyUnit)} × {inputs.activity} = {energy(estimate.value.maintenanceKcal, preferences.energyUnit)} maintenance</Text>{estimate.value.notices.map(notice => <Text key={notice} style={styles.note}>{notice}</Text>)}</>}
        <Text style={styles.note}>1,500 kcal floor · max 1% of weight per week</Text><ErrorMessage message={estimate.error} />
        <View style={styles.targetRow}><Text style={styles.label}>Fiber target</Text><DottedValue value={number(fields.fiber_g ? Number(fields.fiber_g) : null, 1)} unit="g" size={16} onPress={() => edit('fiber_g')} /></View>
      </View>}
      <View style={[ui.row, { marginTop: 20, gap: 6 }]}>{([['protein_g', 'Protein'], ['carbs_g', 'Carbs'], ['fat_g', 'Fat']] as const).map(([key, label]) => <View key={key} style={{ flex: 1, gap: 3 }}><Text style={styles.microLabel}>{label}</Text><DottedValue value={number(fields[key] ? Number(fields[key]) : null, 1)} unit="g" size={16} onPress={() => edit(key)} /></View>)}</View>
      <Text style={[styles.note, { textAlign: 'right', marginTop: 14 }]}>= {energy(fields.protein_g && fields.carbs_g && fields.fat_g ? Number(fields.protein_g) * 4 + Number(fields.carbs_g) * 4 + Number(fields.fat_g) * 9 : null, preferences.energyUnit)}</Text>
      {editing && (
        <View style={styles.estimator}>
          <NumericEditor
            value={entry}
            onChange={setEntry}
            unit={editing === 'target_kcal' ? preferences.energyUnit : 'g'}
            maxDecimals={1}
            allowEmpty
            confirmDisabled={!!entry.trim() && (!Number.isFinite(Number(entry)) || Number(entry) < 0)}
            confirmLabel="Apply value"
            cancelLabel="Cancel"
            clearLabel="Clear target"
            onConfirm={() => {
              const raw = entry.trim();
              const nextValue = raw && raw !== '.'
                ? String(editing === 'target_kcal' ? toCanonicalKcal(Number(raw), preferences.energyUnit) : Number(raw))
                : '';
              setFields(old => ({ ...old, [editing]: nextValue }));
              setEditing(null);
              setDirty(true);
            }}
            onClear={() => {
              setFields(old => ({ ...old, [editing]: '' }));
              setEditing(null);
              setDirty(true);
            }}
            onCancel={() => setEditing(null)}
          />
        </View>
      )}
      {dirty && <><Text style={styles.note}>Effective from {localDate()}. Earlier days retain their targets.</Text><Button label="Save targets" primary disabled={action.busy} onPress={() => void action.run(async () => { if (mode !== 'observe' && !fields.target_kcal.trim()) throw new Error('Enter an energy target or choose Observe'); await controller.saveGoal(makeGoal()); hapticSuccess(); setDirty(false); })} /></>}
      <ErrorMessage message={action.error} />
    </View>
  </View>;
}
function Preferences({ preferences }: { preferences: AppPreferences }) {
  const { controller } = useAppRuntime(); const action = useAction();
  const [meals, setMeals] = useState(preferences.mealSections); const [editing, setEditing] = useState(false);
  const saveMeals = () => void action.run(async () => { const mealSections = meals.map(meal => meal.trim()); if (mealSections.some(meal => !meal) || new Set(mealSections).size !== mealSections.length) throw new Error('Give each meal section a unique, non-empty name'); await controller.updatePreferences({ mealSections }); setEditing(false); });
  return <View><Text style={styles.sectionLabel}>Units</Text><View style={[ui.row, { gap: 8 }]}>
    <View style={{ flex: 1 }}><SegmentedSwitch options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={preferences.weightUnit} disabled={action.busy} onChange={weightUnit => void action.run(() => controller.updatePreferences({ weightUnit: weightUnit as 'kg' | 'lb' }))} /></View>
    <View style={{ flex: 1 }}><SegmentedSwitch options={[{ value: 'kcal', label: 'kcal' }, { value: 'kJ', label: 'kJ' }]} value={preferences.energyUnit} disabled={action.busy} onChange={energyUnit => void action.run(() => controller.updatePreferences({ energyUnit: energyUnit as 'kcal' | 'kJ' }))} /></View>
  </View>
    <View style={{ marginTop: 28 }}><View style={[ui.row, { justifyContent: 'space-between', marginBottom: 8 }]}><Text style={styles.sectionLabel}>Meals</Text><Pressable accessibilityRole="button" disabled={action.busy} onPress={() => editing ? saveMeals() : setEditing(true)} style={styles.textButton}><Text style={styles.note}>{editing ? 'Done' : 'Edit'}</Text></Pressable></View>
      {meals.map((meal, index) => <View key={index} style={styles.mealRow}>{editing ? <TextInput accessibilityLabel={`Meal ${index + 1}`} value={meal} onChangeText={value => setMeals(old => old.map((item, position) => position === index ? value : item))} style={styles.mealInput} /> : <Text style={[styles.label, { flex: 1 }]}>{meal}</Text>}
        {editing && <Pressable accessibilityRole="button" accessibilityLabel={`Remove meal ${index + 1}`} disabled={meals.length === 1} onPress={() => setMeals(old => old.filter((_, position) => position !== index))} style={styles.iconButton}><DoopIcon name="trash" size={15} color={colors.muted} /></Pressable>}
        <View style={styles.iconButton}><DoopIcon name="grip" size={14} color={colors.border} /></View>
      </View>)}
      <Pressable accessibilityRole="button" onPress={() => { setEditing(true); setMeals(old => [...old, '']); }} style={[styles.textButton, { alignSelf: 'flex-start', flexDirection: 'row', gap: 6 }]}><DoopIcon name="plus" size={14} color={colors.accent} /><Text style={styles.accentText}>Section</Text></Pressable>
    </View><ErrorMessage message={action.error} />
  </View>;
}
function Backup() {
  const runtime = useAppRuntime(); const action = useAction();
  const [json, setJson] = useState(''); const [preview, setPreview] = useState<ReturnType<typeof runtime.controller.previewRestore> | null>(null);
  const [path, setPath] = useState(''); const [lastExport, setLastExport] = useState<{ contents: string; filename: string } | null>(null);
  const [message, setMessage] = useState(''); const [csv, setCsv] = useState(''); const [importOpen, setImportOpen] = useState(false); const [csvOpen, setCsvOpen] = useState(false);
  const updateJson = (text: string) => { setJson(text); setPreview(null); setMessage(''); };
  const exportCsv = (kind: 'diary' | 'weight') => void action.run(async () => {
    const filename = `open-calorie-tracker-${kind}.csv`;
    const contents = kind === 'diary' ? await runtime.controller.exportDiaryCsv() : await runtime.controller.exportWeightCsv();
    setCsv(contents);
    setLastExport({ contents, filename });
    setPath(await runtime.saveBackup(contents, filename));
  });
  return <View style={{ marginTop: 28 }}><SectionRule label="Export & import" uppercase />
    <View style={[styles.targetRow, { minHeight: 64 }]}><Text style={styles.label}>Export</Text><View style={ui.row}>
      <Pill label="JSON" disabled={action.busy} onPress={() => void action.run(async () => {
        const filename = 'open-calorie-tracker-backup-v1.json';
        const exported = await runtime.controller.exportJson();
        updateJson(exported);
        setLastExport({ contents: exported, filename });
        setPath(await runtime.saveBackup(exported, filename));
      })} />
      <Pill label="CSV" disabled={action.busy} onPress={() => setCsvOpen(open => !open)} /></View></View>
    <Text style={styles.note}>API keys and ChatGPT sign-in are never exported</Text>
    {csvOpen && <View style={ui.wrap}><Button label="Diary CSV" quiet disabled={action.busy} onPress={() => exportCsv('diary')} /><Button label="Weight CSV" quiet disabled={action.busy} onPress={() => exportCsv('weight')} /></View>}
    {!!path && <Text selectable style={styles.note}>Saved: {path}</Text>}
    {!!lastExport && runtime.shareBackup && (
      <View style={ui.wrap}>
        <Button
          label={Platform.OS === 'android' ? 'Save copy to folder' : 'Share export file'}
          quiet
          disabled={action.busy}
          onPress={() => void action.run(async () => {
            const dest = await runtime.shareBackup!(lastExport.contents, lastExport.filename, path || undefined);
            if (dest) setMessage(Platform.OS === 'android' ? 'Export saved to selected folder.' : 'Export shared.');
          })}
        />
      </View>
    )}
    {!!csv && <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled><Text selectable style={styles.note}>{csv}</Text></ScrollView>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: importOpen }} onPress={() => setImportOpen(open => !open)} style={[styles.nav, { marginTop: 14 }]}><Text style={styles.label}>Import JSON backup</Text><DoopIcon name="chevronDown" size={16} color={colors.muted} /></Pressable>
    {importOpen && <View style={styles.estimator}><Button label="Open JSON backup file" quiet disabled={action.busy} onPress={() => void action.run(async () => { const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true }); if (!picked.canceled && picked.assets[0]) updateJson(await runtime.readTextFile(picked.assets[0].uri)); })} />
      <Input label="Backup JSON · copy or paste" value={json} onChangeText={updateJson} multiline autoCapitalize="none" autoCorrect={false} style={{ minHeight: 120, maxHeight: 240, textAlignVertical: 'top' }} />
      <Button label="Validate & preview restore" disabled={action.busy || !json.trim()} onPress={() => void action.run(async () => { setPreview(runtime.controller.previewRestore(json)); })} />
      <Text style={styles.note}>Includes diary snapshots, water logs, custom foods, barcode links, saved meals, personal units, learned portions, recipes, batches, goals, weigh-ins and pack metadata. Pack files, offline photo drafts, health sync links and local settings are not included.</Text>
      {preview && <><Label>{preview.days} days · {preview.entries} entries · {preview.foods} foods · {preview.packs} pack records</Label><Text style={styles.note}>{preview.bundle.recipes.length} recipes · {preview.bundle.recipe_batches.length} batches · {preview.goals} goals · {preview.weighIns} weigh-ins · {preview.waterLogs} water logs</Text>
        {preview.droppedDuplicateGoals > 0 && <Text style={styles.note}>{`${preview.droppedDuplicateGoals} duplicate same-day goal ${preview.droppedDuplicateGoals === 1 ? 'entry' : 'entries'} in this legacy backup will be deduplicated.`}</Text>}
        <Text style={styles.note}>Merge keeps existing records on conflicts. Replace clears existing personal data and local settings. Bundled food packs remount automatically; third-party packs need re-importing.</Text>
        <View style={ui.wrap}>{(['merge', 'replace'] as const).map(mode => <Button key={mode} label={`Restore · ${mode === 'merge' ? 'Merge' : 'Replace'}`} disabled={action.busy} onPress={() => void action.run(async () => {
          const outcome = await runtime.controller.restoreJson(json, mode);
          setPreview(null);
          setMessage(outcome.packErrors.length ? `Backup restored, but some food packs could not remount: ${outcome.packErrors.join('; ')}` : 'Backup restored.');
        })} />)}</View></>}
    </View>}
    <ErrorMessage message={action.error} />{!!message && <Muted>{message}</Muted>}
  </View>;
}
function OSHealth({ preferences }: { preferences: AppPreferences | undefined }) {
  const { controller } = useAppRuntime(); const health = useHealthStatus(); const action = useAction(); const [message, setMessage] = useState('');
  const available = health.value?.capability.available === true;
  const connected = !!(health.value?.permissions.nutritionWrite || health.value?.permissions.weightRead);
  const scopes: HealthPermissionScope[] = [];
  if (preferences?.healthNutritionWriteEnabled) scopes.push('nutrition_write'); if (preferences?.healthWeightReadEnabled) scopes.push('weight_read');
  const connect = () => void action.run(async () => { const granted = await controller.requestHealthPermissions(scopes.length ? scopes : ['nutrition_write', 'weight_read']); setMessage(`Nutrition write: ${granted.nutritionWrite ? 'granted' : 'not granted'} · Weight read: ${granted.weightRead ? 'granted' : 'not granted'}`); });
  return <View style={{ gap: 8, marginTop: 12 }}><SectionRule label={Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'} uppercase meta={<View style={[ui.row, { gap: 5 }]}>{connected && <DoopIcon name="check" size={13} color={colors.success} />}<Text style={styles.note}>{connected ? 'Connected' : 'Not connected'}</Text></View>} />
    <View style={styles.dataChipRow}><Text style={styles.dataLabel}>WRITE</Text><View style={styles.dataChips}>{['Energy', 'Protein', 'Carbs', 'Fat'].map(label => <View key={label} style={{ width: '48%' }}><Pill label={`${preferences?.healthNutritionWriteEnabled ? '✓ ' : ''}${label}`} filled selected={preferences?.healthNutritionWriteEnabled ?? false} disabled={!preferences || action.busy || !available} onPress={() => void action.run(() => controller.updatePreferences({ healthNutritionWriteEnabled: !preferences?.healthNutritionWriteEnabled }))} /></View>)}</View></View>
    <View style={styles.dataChipRow}><Text style={styles.dataLabel}>READ</Text><View style={{ flex: 1 }}><Pill label={`${preferences?.healthWeightReadEnabled ? '✓ ' : ''}Weight`} filled selected={preferences?.healthWeightReadEnabled ?? false} disabled={!preferences || action.busy || !available} onPress={() => void action.run(() => controller.updatePreferences({ healthWeightReadEnabled: !preferences?.healthWeightReadEnabled }))} /></View><View style={{ flex: 1 }} /></View>
    {available ? <View style={ui.wrap}><Button label={connected ? 'Permissions' : 'Connect'} quiet disabled={action.busy} onPress={connect} />{connected && <Button label="Sync now" quiet disabled={action.busy || !preferences?.healthWeightReadEnabled || !health.value?.permissions.weightRead} onPress={() => void action.run(async () => { const result = await controller.syncWeightFromHealth(); setMessage(`${result.imported} imported · ${result.skippedDuplicates + result.skippedOwnWrites} skipped.${result.error ? ` ${result.error}` : ''}`); })} />}</View>
      : <Text style={styles.note}>{health.loading ? 'Checking health support…' : health.value?.capability.description ?? 'Health status unavailable.'}</Text>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text>}<ErrorMessage message={action.error ?? health.error} />
  </View>;
}
function Privacy({ preferences }: { preferences: AppPreferences | undefined }) {
  const runtime = useAppRuntime(); const { controller } = runtime; const action = useAction();
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  return <><OSHealth preferences={preferences} /><Backup /><View style={{ marginTop: 28 }}><SectionRule label="What’s sent where" uppercase />
    <View style={styles.privacyRow}><Text style={styles.label}>OpenAI</Text><Text style={styles.note}>Meal text or photo, only when you use AI. Never your diary.</Text></View>
    <View style={styles.privacyRow}><Text style={styles.label}>Food databases</Text><Text style={styles.note}>Open Food Facts lookup only when you scan an unknown barcode.</Text><View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={[styles.note, { flex: 1 }]}>Allow barcode lookup · digits only</Text><Switch accessibilityLabel="Look up unknown barcodes on Open Food Facts" value={preferences?.allowLiveOffLookup ?? false} disabled={!preferences || action.busy} trackColor={{ false: colors.track, true: colors.accent }} thumbColor={colors.ink} onValueChange={allowLiveOffLookup => void action.run(() => controller.updatePreferences({ allowLiveOffLookup }))} /></View></View>
    <View style={styles.privacyRow}><Text style={styles.label}>{Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'}</Text><Text style={styles.note}>Confirmed nutrition written and weight read only when you enable each permission.</Text></View>
    <View style={styles.privacyRow}><Text style={styles.label}>Voice dictation</Text><Text style={styles.note}>Processed by your device’s operating-system speech service only when you tap the mic.</Text></View>
  </View>
    <View style={{ marginTop: 28 }}><SectionRule label="Local data" uppercase />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: deleting }} onPress={() => setDeleting(open => !open)} style={styles.nav}><Text style={[styles.label, { color: colors.danger }]}>Delete local data</Text></Pressable>
      {deleting && <View style={styles.estimator}><Text style={styles.note}>Delete this device’s diary, library, recipes, batches, goals, photos, cached barcode lookups, app-owned exports, and settings? Files you saved outside the app and records already synced to Apple Health / Health Connect are not removed. This cannot be undone.</Text><View style={ui.wrap}>
        <Button label="Cancel" quiet disabled={action.busy} onPress={() => setDeleting(false)} />
        <Button label="Delete local data" disabled={action.busy} onPress={() => void action.run(async () => {
          await controller.deleteLocalData({ clearSandboxExports: runtime.clearSandboxExports });
          setDeleting(false); setDeleted(true);
        })} />
      </View></View>}
      {deleted && <Text accessibilityLiveRegion="polite" style={styles.note}>Local data deleted.</Text>}
    </View><ErrorMessage message={action.error} /></>;
}
export default function Settings() {
  const today = useTodayDiary(); const preferences = usePreferences(); const ai = useAIStatus();
  const [view, setView] = useState<'settings' | 'privacy' | 'databases' | 'display'>('settings');
  const { controller } = useAppRuntime(); const action = useAction();
  useFocusEffect(useCallback(() => {
    if (view === 'settings' || Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setView('settings');
      return true;
    });
    return () => sub.remove();
  }, [view]));
  return <Page><BackHeader title={view === 'privacy' ? 'Data & privacy' : view === 'databases' ? 'Food databases' : view === 'display' ? 'Display' : 'Settings'} onBack={() => view !== 'settings' ? setView('settings') : goBackOrReplace('/(tabs)')} />
    <ErrorMessage message={today.error ?? preferences.error} />
    {view === 'settings' && <>
      {today.value && preferences.value && <><DailyTargets key={`${today.value.goal?.id ?? 'new'}:${preferences.value.energyUnit}:${preferences.value.weightUnit}`} goal={today.value.goal} preferences={preferences.value} /><View style={{ marginTop: 12 }}><Preferences key={preferences.value.mealSections.join('|')} preferences={preferences.value} /></View></>}
      <View><NavRow label="ChatGPT" value={ai.value?.mode === 'chatgpt_oauth' ? 'ChatGPT plan' : ai.value?.mode === 'api_key' ? 'API key' : 'Not connected'} onPress={() => router.push('/chatgpt')} />
        <NavRow label="Data & privacy" onPress={() => setView('privacy')} /><NavRow label="Food databases" onPress={() => setView('databases')} /><NavRow label="Display" onPress={() => setView('display')} /><NavRow label="Recipes & batches" onPress={() => router.push('/recipes')} /><NavRow label="Run onboarding" onPress={() => router.push('/onboarding')} /></View>
    </>}
    {view === 'privacy' && <Privacy preferences={preferences.value} />}{view === 'databases' && <FoodDatabases />}
    {view === 'display' && <><SectionRule label="Dashboard lead metric" />{([['calories', 'Calories'], ['protein', 'Protein'], ['fiber', 'Fiber'], ['water', 'Water']] as const).map(([leadMetric, label]) => <Pill key={leadMetric} label={label} selected={preferences.value?.leadMetric === leadMetric} disabled={action.busy} onPress={() => void action.run(() => controller.updatePreferences({ leadMetric }))} />)}<ErrorMessage message={action.error} /></>}
  </Page>;
}
const styles = StyleSheet.create({
  label: { ...fontFace(), color: colors.ink, fontSize: 14 }, sectionLabel: { ...fontFace('semibold'), color: colors.muted, fontSize: 12, marginBottom: 8 },
  note: { ...fontFace(), ...tabularNums, color: colors.muted, fontSize: 11, lineHeight: 16, opacity: 0.82 }, microLabel: { ...fontFace('semibold'), color: colors.muted, fontSize: 10, opacity: 0.72 },
  goalTrack: { flexDirection: 'row', padding: 3, gap: 2, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.full, height: 46 },
  goalPill: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: 'transparent' },
  pill: { minHeight: 40, minWidth: 54, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  pillSelected: { borderColor: colors.accent, backgroundColor: colors.raised }, pillFilled: { backgroundColor: colors.accent }, pillText: { ...fontFace('semibold'), color: colors.muted, fontSize: 12 },
  targetRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, textButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }, accentText: { ...fontFace('semibold'), color: colors.accent, fontSize: 12 },
  estimator: { gap: 8, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline },
  mealRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.hairline }, iconButton: { height: 40, width: 40, justifyContent: 'center', alignItems: 'center' },
  mealInput: { ...fontFace(), flex: 1, color: colors.ink, fontSize: 14, height: 36, borderBottomWidth: 1, borderColor: colors.accent }, nav: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: colors.hairline },
  dataChipRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, dataLabel: { ...fontFace('bold'), width: 38, height: 40, paddingTop: 13, color: colors.muted, opacity: 0.72, fontSize: 10, letterSpacing: 1 }, dataChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  privacyRow: { minHeight: 52, gap: 3, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.hairline },
});
