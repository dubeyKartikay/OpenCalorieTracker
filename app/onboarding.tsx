import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PropsWithChildren } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DoopIcon } from '../src/ui/components/DoopIcons';
import { useAction, useAppRuntime } from '../src/app/AppRuntimeContext';
import type { GoalPeriod, TargetEstimate } from '../src/domain';
import { SegmentedSwitch } from '../src/ui/components/capture';
import { BackHeader, Button, energy, energyValue, ErrorMessage, Heading, Label, Muted, number, Page, toCanonicalKcal, ui } from '../src/ui/components/primitives';
import { NumericField } from '../src/ui/components/recipes/RecipeEditor';
import { colors, fontFace, spacing } from '../src/ui/tokens';

function Card({ children }: PropsWithChildren) { return <View style={{ gap: 12, paddingVertical: 12 }}>{children}</View>; }

const activities = [
  { factor: 1.2, label: 'Low' }, { factor: 1.375, label: 'Light' },
  { factor: 1.55, label: 'Moderate' }, { factor: 1.725, label: 'High' },
] as const;
const modes = [
  { mode: 'lose', label: 'Lose', detail: 'A gradual daily deficit' },
  { mode: 'maintain', label: 'Maintain', detail: 'An estimated maintenance target' },
  { mode: 'gain', label: 'Gain', detail: 'A gradual daily surplus' },
  { mode: 'observe', label: 'Observe', detail: 'Track without targets' },
] as const;
type Macros = Pick<GoalPeriod, 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'>;

export default function Onboarding() {
  const { controller } = useAppRuntime();
  const action = useAction();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [under18, setUnder18] = useState(false);
  const [mode, setMode] = useState<GoalPeriod['mode'] | null>(null);
  const [energyUnit, setEnergyUnit] = useState<'kcal' | 'kJ'>('kcal');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [ageYears, setAgeYears] = useState<number | null>(null);
  const [coefficient, setCoefficient] = useState<5 | -161 | null>(null);
  const [activity, setActivity] = useState<(typeof activities)[number] | null>(null);
  const [rate, setRate] = useState(0.4);
  const [manualKcal, setManualKcal] = useState<number | null>(null);
  const [macros, setMacros] = useState<Macros>({ protein_g: null, carbs_g: null, fat_g: null, fiber_g: null });
  const preview = useMemo<{ estimate: TargetEstimate | null; error: string | null }>(() => {
    if (!mode || mode === 'observe' || weightKg === null || heightCm === null || ageYears === null || coefficient === null || activity === null) return { estimate: null, error: null };
    try {
      return { estimate: controller.estimateTargetPreview({ adultConfirmed: true, ageYears, weightKg, heightCm,
        equationCoefficient: coefficient, activityFactor: activity.factor, activityAssumption: activity.label, mode, weeklyRateKg: rate }), error: null };
    } catch (error) { return { estimate: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [activity, ageYears, coefficient, controller, heightCm, mode, rate, weightKg]);
  const targetKcal = manualKcal ?? preview.estimate?.targetKcal ?? null;
  const canFinish = mode !== null && (mode === 'observe' || (targetKcal !== null && targetKcal > 0));
  const chooseMode = (next: GoalPeriod['mode']) => { setMode(next); setManualKcal(null); };
  const startTracking = () => void action.run(async () => {
    if (mode === null || !canFinish) return;
    await controller.completeOnboarding({ ageConfirmed18Plus: true, energyUnit, weightUnit,
      goal: { mode, target_kcal: mode === 'observe' ? null : targetKcal,
        ...(mode === 'observe' ? { protein_g: null, carbs_g: null, fat_g: null, fiber_g: null } : macros) } });
    router.replace('/(tabs)');
  });
  const units = <View style={{ gap: spacing.s12 }}><Heading>Units</Heading><View style={[ui.row, { gap: 8 }]}>
    <View style={{ flex: 1 }}><SegmentedSwitch options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={weightUnit} onChange={value => setWeightUnit(value as 'kg' | 'lb')} /></View>
    <View style={{ flex: 1 }}><SegmentedSwitch options={[{ value: 'kcal', label: 'kcal' }, { value: 'kJ', label: 'kJ' }]} value={energyUnit} onChange={value => setEnergyUnit(value as 'kcal' | 'kJ')} /></View>
  </View></View>;
  if (step === 1) return <SafeAreaView style={styles.ageScreen}>
    <Text style={styles.brand}>OPENCALORIETRACKER</Text>
    <View style={styles.hero}>
      <DoopIcon name="ringMark" size={44} color={colors.border} strokeWidth={1.5} />
      <Text accessibilityRole="header" style={styles.headline}>{'Track what you eat.\nNo account needed.'}</Text>
    </View>
    <View style={styles.ageActions}>
      <Pressable accessibilityRole="button" onPress={() => { setUnder18(false); setStep(2); }} style={styles.agePrimary}><Text style={styles.agePrimaryText}>I&apos;m 18 or older</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: under18 }} onPress={() => setUnder18(value => !value)} style={styles.under}><Text style={styles.underText}>I&apos;m under 18</Text></Pressable>
      {under18 && <Text accessibilityLiveRegion="polite" style={styles.ageNote}>This app is for adults. Nothing was saved.</Text>}
    </View>
  </SafeAreaView>;
  return <Page><BackHeader title={step === 2 ? 'Your goal' : step === 3 ? 'Your setup' : 'Ready'} onBack={() => setStep(current => (current - 1) as 1 | 2 | 3)} />    {step === 2 && <><Heading>What would you like to do?</Heading><View style={styles.tiles}>
      {modes.map(item => <Pressable key={item.mode} accessibilityRole="button" accessibilityLabel={`${item.label} — ${item.detail}`} accessibilityState={{ selected: mode === item.mode }}
        onPress={() => chooseMode(item.mode)} style={({ pressed }) => [styles.tile, mode === item.mode && styles.selectedTile, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={[styles.goalIcon, mode === item.mode && { backgroundColor: colors.accent }]}><DoopIcon name={item.mode === 'lose' ? 'minus' : item.mode === 'gain' ? 'plus' : item.mode === 'maintain' ? 'plate' : 'ringMark'} size={22} color={mode === item.mode ? colors.onAccent : colors.muted} /></View><View style={{ gap: 3 }}><Text style={[ui.heading, { fontSize: 18 }]}>{item.label}</Text><Text style={[ui.muted, { fontSize: 11 }]}>{item.detail}</Text></View>
      </Pressable>)}
    </View><Button label="Continue" primary disabled={mode === null} onPress={() => setStep(3)} /></>}
    {step === 3 && <>
      {mode === 'observe' ? <Card><Heading>Targets off — log freely with no daily limit</Heading><Muted>Your diary works without a calorie budget or macro targets.</Muted>{units}</Card> : <>
        <Card><Heading>Mifflin–St Jeor estimate</Heading><Muted>Choose your inputs to see the equation, or enter a daily target directly below.</Muted>{units}
          <NumericField label="Weight" unit={weightUnit} minimum={0.01} value={weightKg === null ? null : weightUnit === 'lb' ? weightKg * 2.2046226218 : weightKg}
            onChange={value => setWeightKg(value === null ? null : weightUnit === 'lb' ? value / 2.2046226218 : value)} />
          <NumericField label="Height" unit="cm" minimum={0.01} value={heightCm} onChange={setHeightCm} />
          <NumericField label="Age" unit="years" minimum={18} integer value={ageYears} onChange={setAgeYears} />
          <Heading>Sex for equation: M | F</Heading><Muted>This selects the equation coefficient. It is never inferred from gender identity.</Muted>
          <View style={ui.wrap}><Button label="M · +5" selected={coefficient === 5} onPress={() => setCoefficient(5)} /><Button label="F · −161" selected={coefficient === -161} onPress={() => setCoefficient(-161)} /></View>
          <Muted>Activity</Muted><View style={styles.activity}>{activities.map(value => <Pressable key={value.factor} accessibilityRole="radio" accessibilityState={{ checked: activity?.factor === value.factor }} onPress={() => setActivity(value)} style={[styles.activityPill, activity?.factor === value.factor && styles.selectedTile]}><Text style={[styles.activityText, activity?.factor === value.factor && { color: colors.accent }]}>{value.factor}</Text></Pressable>)}</View>
          {(mode === 'lose' || mode === 'gain') && <><Heading>Weekly rate</Heading><View style={ui.wrap}>{[0.25, 0.4, 0.5].map(value => <Button key={value} label={`${value} kg/wk`} selected={rate === value} onPress={() => setRate(value)} />)}</View></>}
        </Card>
        <Card><Heading>How the estimate works</Heading>
          <Muted>BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age + equation coefficient.</Muted>
          {preview.estimate ? <>
            <Label>BMR {number(preview.estimate.bmrKcal)} × activity {preview.estimate.breakdown.activityFactor} {preview.estimate.breakdown.dailyAdjustmentKcal < 0 ? '−' : '+'} {number(Math.abs(preview.estimate.breakdown.dailyAdjustmentKcal))} kcal {mode === 'lose' ? 'deficit' : mode === 'gain' ? 'surplus' : 'adjustment'} = {number(preview.estimate.breakdown.uncappedTargetKcal)} kcal before floor</Label>
            <Label>Estimated target · {number(preview.estimate.targetKcal)} kcal{energyUnit === 'kJ' ? ` · ${energy(preview.estimate.targetKcal, 'kJ')}` : ''}</Label>
            <Muted>Maintenance · {energy(preview.estimate.maintenanceKcal, energyUnit)}. Applied rate · {number(preview.estimate.appliedWeeklyRateKg, 2)} kg/wk. Adjustment uses 7,700 kcal/kg ÷ 7 days.</Muted>
            {preview.estimate.notices.length > 0 && <><Heading>1,500 kcal floor · max 1% body weight/wk</Heading>{preview.estimate.notices.map(notice => <Muted key={notice}>{notice}</Muted>)}</>}
          </> : <Muted>Complete the estimator inputs above to see your calculated target.</Muted>}
          <ErrorMessage message={preview.error} />
          <Muted>Starter estimate policy: 1,500 kcal floor · max 1% body weight/wk. This is an editable starting point.</Muted>
          <Muted>Equation: Mifflin et al., 1990 · pubmed.ncbi.nlm.nih.gov/2305711/</Muted>
        </Card>
        <Card><Heading>Your daily targets</Heading><Muted>Tap a value to edit it. Macro targets are optional; unset values stay unset.</Muted>
          <NumericField label={`Energy target (${energyUnit})`} unit={energyUnit} value={energyValue(targetKcal, energyUnit)} minimum={1} onChange={value => setManualKcal(value === null ? null : toCanonicalKcal(value, energyUnit))} />
          {manualKcal !== null && <><Muted>Using your manual target. Changing estimator inputs won&apos;t replace it.</Muted><Button label="Use estimated target" disabled={preview.estimate === null} onPress={() => setManualKcal(null)} /></>}
          {([['protein_g', 'Protein'], ['carbs_g', 'Carbs'], ['fat_g', 'Fat'], ['fiber_g', 'Fiber']] as const).map(([key, label]) =>
            <NumericField key={key} label={label} unit="g" value={macros[key]} optional onChange={value => setMacros(current => ({ ...current, [key]: value }))} />)}
        </Card>
      </>}
      <ErrorMessage message={action.error} />
      <Button label={mode === 'observe' ? action.busy ? 'Starting…' : 'Start tracking' : 'Review setup'} primary disabled={action.busy || !canFinish}
        onPress={mode === 'observe' ? startTracking : () => setStep(4)} />
    </>}
    {step === 4 && <Card><Heading>Ready to start tracking</Heading>
      <Label>{modes.find(item => item.mode === mode)?.label}{mode === 'observe' ? ' — targets off' : ` · ${energy(targetKcal, energyUnit)}/day`}</Label>
      {mode === 'observe' ? <Muted>Targets off — log freely with no daily limit</Muted> : <>
        <Muted>{manualKcal === null ? 'Using your Mifflin–St Jeor estimate.' : 'Using your manually entered target.'}</Muted>
        <Label>Protein {number(macros.protein_g, 1)} g · Carbs {number(macros.carbs_g, 1)} g · Fat {number(macros.fat_g, 1)} g · Fiber {number(macros.fiber_g, 1)} g</Label>
      </>}
      <Muted>Energy in {energyUnit} · Weight in {weightUnit}. You can change your setup in Settings.</Muted>
      <ErrorMessage message={action.error} />
      <Button label={action.busy ? 'Starting…' : 'Start tracking'} primary disabled={action.busy || !canFinish} onPress={startTracking} />
    </Card>}
  </Page>;
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s12 },
  tile: { flexGrow: 1, flexBasis: '45%', minHeight: 168, padding: spacing.s16, gap: spacing.s8,
    backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border, borderRadius: 20 },
    selectedTile: { borderColor: colors.accent, backgroundColor: colors.ground },
  goalIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  activity: { flexDirection: 'row', padding: 2, height: 44, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, gap: 2 },
  activityPill: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
  activityText: { ...fontFace('semibold'), fontSize: 11, color: colors.muted },
  ageScreen: { flex: 1, backgroundColor: colors.ground, paddingHorizontal: 20 },
  brand: { ...fontFace('semibold'), color: colors.muted, opacity: 0.7, fontSize: 11, letterSpacing: 1.4, marginTop: 10 },
  hero: { flex: 1, justifyContent: 'center', gap: 28, paddingBottom: 16 },
  headline: { ...fontFace('bold'), color: colors.ink, fontSize: 32, lineHeight: 37, letterSpacing: -1.1 },
  ageActions: { paddingBottom: 28, gap: 6 },
  agePrimary: { height: 52, borderRadius: 14, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  agePrimaryText: { ...fontFace('bold'), fontSize: 14, color: colors.onAccent },
  under: { height: 44, justifyContent: 'center', alignItems: 'center' },
  underText: { ...fontFace('semibold'), fontSize: 13, color: colors.muted },
  ageNote: { ...fontFace(), fontSize: 11, lineHeight: 16, color: colors.muted, textAlign: 'center' },
});
