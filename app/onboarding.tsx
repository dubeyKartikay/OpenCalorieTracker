import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAction, useAppRuntime } from '../src/app/AppRuntimeContext';
import { kcalToKj, kjToKcal } from '../src/domain';
import type { GoalPeriod, TargetEstimate } from '../src/domain';
import { Button, Card, ErrorMessage, Heading, Label, Muted, number, Page, ui } from '../src/ui/components/primitives';
import { NumericField } from '../src/ui/components/recipes/RecipeEditor';
import { colors, MIN_TOUCH_TARGET, radius, spacing } from '../src/ui/tokens';

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
  const displayEnergy = (kcal: number | null) => kcal === null ? null : energyUnit === 'kJ' ? kcalToKj(kcal) : kcal;
  const chooseMode = (next: GoalPeriod['mode']) => { setMode(next); setManualKcal(null); };
  const startTracking = () => void action.run(async () => {
    if (mode === null || !canFinish) return;
    await controller.completeOnboarding({ ageConfirmed18Plus: true, energyUnit, weightUnit,
      goal: { mode, target_kcal: mode === 'observe' ? null : targetKcal,
        ...(mode === 'observe' ? { protein_g: null, carbs_g: null, fat_g: null, fiber_g: null } : macros) } });
    router.replace('/(tabs)');
  });
  const units = <View style={{ gap: spacing.s12 }}><Heading>Units</Heading><View style={ui.wrap}>
    {(['kcal', 'kJ'] as const).map(value => <Button key={value} label={value} selected={energyUnit === value} onPress={() => setEnergyUnit(value)} />)}
  </View><View style={ui.wrap}>
    {(['kg', 'lb'] as const).map(value => <Button key={value} label={value} selected={weightUnit === value} onPress={() => setWeightUnit(value)} />)}
  </View></View>;
  return <Page title="Welcome" action={step > 1 ? <Button label="Back" disabled={action.busy} onPress={() => setStep(current => (current - 1) as 1 | 2 | 3)} />
    : <Button label={router.canGoBack() ? 'Close' : 'Skip'} quiet onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />}>
    <Muted>Step {step} of 4 · {step === 1 ? 'Adults only' : step === 2 ? 'Your goal' : step === 3 ? 'Your setup' : 'Ready'}</Muted>
    <Heading>Track what you eat. No account needed.</Heading>
    {step === 1 && (under18 ? <Card><Heading>This app is for adults. Nothing was saved.</Heading><Muted>Your choice hasn&apos;t created a profile or saved any health information.</Muted>
      <Button label="Back" onPress={() => setUnder18(false)} />
    </Card> : <Card><Heading>For adults, 18 and older</Heading><Muted>Confirm your age before setting up your local diary.</Muted>
      <Button label="I am 18 or older" primary onPress={() => setStep(2)} />
      <Button label="I'm under 18" onPress={() => setUnder18(true)} />
    </Card>)}
    {step === 2 && <><Heading>What would you like to do?</Heading><View style={styles.tiles}>
      {modes.map(item => <Pressable key={item.mode} accessibilityRole="button" accessibilityLabel={`${item.label} — ${item.detail}`} accessibilityState={{ selected: mode === item.mode }}
        onPress={() => chooseMode(item.mode)} style={({ pressed }) => [styles.tile, mode === item.mode && styles.selectedTile, { opacity: pressed ? 0.7 : 1 }]}>
        <Text style={ui.heading}>{item.label}</Text><Text style={ui.muted}>{item.detail}</Text>
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
          <Heading>Activity</Heading><View style={ui.wrap}>{activities.map(value => <Button key={value.factor} label={`${value.factor} ${value.label}`} selected={activity?.factor === value.factor} onPress={() => setActivity(value)} />)}</View>
          {(mode === 'lose' || mode === 'gain') && <><Heading>Weekly rate</Heading><View style={ui.wrap}>{[0.25, 0.4, 0.5].map(value => <Button key={value} label={`${value} kg/wk`} selected={rate === value} onPress={() => setRate(value)} />)}</View></>}
        </Card>
        <Card><Heading>How the estimate works</Heading>
          <Muted>BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age + equation coefficient.</Muted>
          {preview.estimate ? <>
            <Label>BMR {number(preview.estimate.bmrKcal)} × activity {preview.estimate.breakdown.activityFactor} {preview.estimate.breakdown.dailyAdjustmentKcal < 0 ? '−' : '+'} {number(Math.abs(preview.estimate.breakdown.dailyAdjustmentKcal))} kcal {mode === 'lose' ? 'deficit' : mode === 'gain' ? 'surplus' : 'adjustment'} = {number(preview.estimate.breakdown.uncappedTargetKcal)} kcal before floor</Label>
            <Label>Estimated target · {number(preview.estimate.targetKcal)} kcal{energyUnit === 'kJ' ? ` · ${number(displayEnergy(preview.estimate.targetKcal))} kJ` : ''}</Label>
            <Muted>Maintenance · {number(preview.estimate.maintenanceKcal)} kcal. Applied rate · {number(preview.estimate.appliedWeeklyRateKg, 2)} kg/wk. Adjustment uses 7,700 kcal/kg ÷ 7 days.</Muted>
            {preview.estimate.notices.length > 0 && <><Heading>1,500 kcal floor · max 1% body weight/wk</Heading>{preview.estimate.notices.map(notice => <Muted key={notice}>{notice}</Muted>)}</>}
          </> : <Muted>Complete the estimator inputs above to see your calculated target.</Muted>}
          <ErrorMessage message={preview.error} />
          <Muted>Starter estimate policy: 1,500 kcal floor · max 1% body weight/wk. This is an editable starting point.</Muted>
          <Muted>Equation: Mifflin et al., 1990 · pubmed.ncbi.nlm.nih.gov/2305711/</Muted>
        </Card>
        <Card><Heading>Your daily targets</Heading><Muted>Tap a value to edit it. Macro targets are optional; unset values stay unset.</Muted>
          <NumericField label={`Energy target (${energyUnit})`} unit={energyUnit} value={displayEnergy(targetKcal)} minimum={1} onChange={value => setManualKcal(value === null ? null : energyUnit === 'kJ' ? kjToKcal(value) : value)} />
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
      <Label>{modes.find(item => item.mode === mode)?.label}{mode === 'observe' ? ' — targets off' : ` · ${number(displayEnergy(targetKcal))} ${energyUnit}/day`}</Label>
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
  tile: { flexGrow: 1, flexBasis: '45%', minHeight: MIN_TOUCH_TARGET, padding: spacing.s20, gap: spacing.s8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r16 },
  selectedTile: { borderColor: colors.accent, backgroundColor: colors.raised },
});
