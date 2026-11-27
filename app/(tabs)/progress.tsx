import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { router } from 'expo-router';
import { useAction, useAppRuntime, useDateRangeCalendarLoader, usePreferences, useProgressData } from '../../src/app/AppRuntimeContext';
import { localDate, shiftDate } from '../../src/app/controller';
import { calculateWeeklyRate, nutrientKeys, type NutrientKey } from '../../src/domain';
import { SegmentedSwitch } from '../../src/ui/components/capture';
import { CalorieBarChart, MicronutrientsCard, NumericEditor, RevealPanel, WeightTrendChart } from '../../src/ui/components/doop';
import { ProgTrendPop } from '../../src/ui/components/doop/ProgressCharts';
import { AnchoredPopover, measurePopoverAnchor } from '../../src/ui/components/doop/HistoryControls';
import type { PopoverAnchor } from '../../src/ui/components/doop/HistoryControls';
import { RailMonthSheet, shortRailDate, weekEndForDate } from '../../src/ui/components/doop/WeekDateRail';
import { DoopIcon } from '../../src/ui/components/DoopIcons';
import { energyValue, ErrorMessage, number, Page } from '../../src/ui/components/primitives';
import { hapticLight, hapticSelection, hapticSuccess } from '../../src/ui/haptics';
import { colors, fontFace, macroColors, radius, tabularNums, TwoPane } from '../../src/ui/tokens';

const KG_TO_LB = 2.2046226218;
const ZERO_UNKNOWN = Object.fromEntries(nutrientKeys.map(key => [key, 0])) as Record<NutrientKey, number>;
const RANGES = [{ days: 7, label: 'W' }, { days: 30, label: 'M' }, { days: 90, label: '3M' }, { days: 365, label: 'Y' }];
const weightFigure = (value: number | null) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function MacroAverageRow({ label, average, target, color, first }: { label: string; average: number | null | undefined; target: number | null | undefined; color: string; first: boolean }) {
  const max = Math.max(1, (target ?? 0) * 1.06, (average ?? 0) * 1.06);
  return <View style={[styles.macroRow, !first && styles.hairline]}>
    <View style={styles.macroHead}><Text style={[styles.macroLabel, { color }]}>{label}</Text><Text style={styles.macroAverage}>{number(average)}<Text style={styles.macroTarget}>{` / ${number(target)} g`}</Text></Text></View>
    <View accessible accessibilityLabel={`${label} average ${number(average)} grams, target ${number(target)} grams`} style={styles.macroTrack}>
      <View style={[styles.macroFill, { width: `${Math.max(0, (average ?? 0) / max * 100)}%`, backgroundColor: color }]} />
      {target != null ? <View style={[styles.targetTick, { left: `${target / max * 100}%` }]} /> : null}
    </View>
  </View>;
}

export default function Progress() {
  const { controller } = useAppRuntime();
  const [range, setRange] = useState(30);
  const [anchorDate, setAnchorDate] = useState(localDate);
  const [weight, setWeight] = useState('');
  const [loggingWeight, setLoggingWeight] = useState(false);
  const [entryUnit, setEntryUnit] = useState<'kg' | 'lb'>('kg');
  const [calendarAnchor, setCalendarAnchor] = useState<PopoverAnchor | null>(null);
  const [infoAnchor, setInfoAnchor] = useState<PopoverAnchor | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const rangeRef = useRef<ComponentRef<typeof View>>(null);
  const infoRef = useRef<ComponentRef<typeof View>>(null);
  const action = useAction();
  const preferences = usePreferences();
  const today = localDate();
  const end = range === 7 ? weekEndForDate(anchorDate) : anchorDate;
  const start = shiftDate(end, 1 - range);
  const statsEnd = end > today ? today : end;
  const result = useProgressData(range, end);
  const loadCalendar = useDateRangeCalendarLoader();
  const value = result.value;
  const dailyDays = value?.daily ?? [];
  const targetGoal = value?.targetGoal ?? null;
  const unit = preferences.value?.weightUnit ?? 'kg';
  const energyUnit = preferences.value?.energyUnit ?? 'kcal';
  const factor = unit === 'lb' ? KG_TO_LB : 1;
  const visibleTrend = (value?.trend ?? []).filter(point => point.weighIn.date >= start && point.weighIn.date <= statsEnd);
  const availableTrend = (value?.trend ?? []).filter(point => point.weighIn.date <= statsEnd);
  const latest = availableTrend[availableTrend.length - 1];
  const weeklyRate = calculateWeeklyRate(visibleTrend);
  const elapsedDays = Math.min(range, Math.round((Date.parse(`${statsEnd}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1);
  const numericWeight = Number(weight);
  const canSave = weight.trim() !== '' && Number.isFinite(numericWeight) && numericWeight > 0 && !action.busy;
  useEffect(() => {
    if (loggingWeight) Keyboard.dismiss();
  }, [loggingWeight]);
  const saveWeight = () => { if (canSave) void action.run(async () => {
    await controller.weighIn(numericWeight / (entryUnit === 'lb' ? KG_TO_LB : 1), statsEnd);
    if (entryUnit !== unit) await controller.updatePreferences({ weightUnit: entryUnit });
    hapticSuccess();
    setWeight(''); setLoggingWeight(false);
  }); };
  const changeEntryUnit = (next: 'kg' | 'lb') => {
    if (entryUnit === next) return;
    if (weight.trim() && Number.isFinite(numericWeight) && numericWeight > 0) {
      setWeight(String(Math.round(numericWeight * (next === 'lb' ? KG_TO_LB : 1 / KG_TO_LB) * 10) / 10));
    }
    setEntryUnit(next);
  };
  const error = result.error ?? action.error ?? preferences.error;
  return <Page><View>
    <View style={styles.header}>
      <Pressable ref={rangeRef} accessibilityRole="button" accessibilityLabel="Choose date range" accessibilityState={{ expanded: !!calendarAnchor }} onPress={() => measurePopoverAnchor(rangeRef.current, setCalendarAnchor)} style={styles.rangeButton}><Text numberOfLines={1} style={styles.rangeLabel}>{`${shortRailDate(start)} – ${shortRailDate(end)}`}</Text><DoopIcon name="chevronDown" size={14} color={colors.muted} /></Pressable>
      <View accessibilityLabel="Chart range" style={styles.rangeTrack}>{RANGES.map(item => <Pressable key={item.days} accessibilityRole="button" accessibilityLabel={item.days === 7 ? 'Week' : item.days === 30 ? 'Month' : item.days === 90 ? 'Three months' : 'Year'} accessibilityState={{ selected: range === item.days }} onPress={() => { if (range !== item.days) hapticSelection(); setRange(item.days); setSelectedDay(null); }} style={[styles.rangeSegment, range === item.days && styles.rangeActive]}><Text style={[styles.rangeSegmentText, range === item.days && styles.rangeActiveText]}>{item.label}</Text></Pressable>)}</View>
    </View>
    {error ? <View style={{ marginVertical: 8 }}><ErrorMessage message={error} /></View> : null}
    <TwoPane gap={30} primary={<View>
      <View style={styles.calorieHeader}>
        <View><View style={styles.figures}><Text style={styles.largeValue}>{number(energyValue(value?.averages?.kcal, energyUnit))}</Text><Text style={styles.energyUnit}>{`${energyUnit}/day`}</Text></View><Text style={styles.coverage}>{`${value?.completeDays ?? 0} of ${elapsedDays} days`}</Text></View>
        <View style={styles.targetLegend}><Svg width={14} height={4} accessible={false}><Line x1={0} y1={2} x2={14} y2={2} stroke={colors.muted} strokeDasharray="3 3" strokeOpacity={0.7} /></Svg><Text style={styles.targetLabel}>{targetGoal?.target_kcal == null ? 'No target' : `${number(energyValue(targetGoal.target_kcal, energyUnit))} target`}</Text></View>
      </View>
      <CalorieBarChart key={`${range}-${end}`} days={dailyDays} selectedDate={selectedDay} onSelectDay={setSelectedDay} energyUnit={energyUnit} style={{ marginTop: 10 }} onOpenHistory={date => router.push({ pathname: '/(tabs)/history', params: { date, selection: String(Date.now()) } })} />
      <View style={styles.macroSection}>{([
        ['Protein', 'protein_g', macroColors.protein], ['Carbs', 'carbs_g', macroColors.carbs], ['Fat', 'fat_g', macroColors.fat],
      ] as const).map(([label, key, color], index) => <MacroAverageRow key={key} label={label} average={value?.averages?.[key]} target={targetGoal?.[key]} color={color} first={index === 0} />)}</View>
    </View>} secondary={<View>
      {!loggingWeight ? (
        <View style={styles.weightHeader}>
          <View><View style={styles.figures}><Text style={styles.largeValue}>{weightFigure(latest ? latest.trendKg * factor : null)}</Text><Text style={styles.energyUnit}>{unit}</Text></View><Text style={styles.weeklyRate}>{`${weeklyRate != null && weeklyRate > 0 ? '+' : ''}${weightFigure(weeklyRate === null ? null : weeklyRate * factor)} ${unit}/wk`}</Text></View>
          <View style={styles.weightActions}><Pressable accessibilityRole="button" accessibilityLabel="Log a weigh-in" onPress={() => { hapticLight(); Keyboard.dismiss(); setEntryUnit(unit); setWeight(''); setLoggingWeight(true); }} style={[styles.weightButton, { backgroundColor: colors.surface, borderColor: colors.border }]}><DoopIcon name="plus" size={17} color={colors.ink} /></Pressable>
            <Pressable ref={infoRef} accessibilityRole="button" accessibilityLabel="How the trend is smoothed" accessibilityState={{ expanded: !!infoAnchor }} onPress={() => measurePopoverAnchor(infoRef.current, setInfoAnchor)} style={styles.weightButton}><DoopIcon name="info" size={16} color={colors.muted} /></Pressable>
          </View>
        </View>
      ) : null}
      <RevealPanel visible={loggingWeight} direction="down" style={styles.weighInPanel}>
        <Text style={styles.coverage}>{`Weigh-in · ${shortRailDate(statsEnd)}`}</Text>
        <NumericEditor
          value={weight}
          onChange={setWeight}
          unit={entryUnit}
          maxDecimals={2}
          maxLength={6}
          allowEmpty
          confirmDisabled={!canSave}
          confirmLabel="Record weigh-in"
          cancelLabel="Cancel weigh-in"
          onConfirm={saveWeight}
          onCancel={() => { setWeight(''); setLoggingWeight(false); }}
          headerRight={
            <View style={styles.unitSwitchWrap}>
              <SegmentedSwitch
                options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
                value={entryUnit}
                onChange={next => changeEntryUnit(next as 'kg' | 'lb')}
              />
            </View>
          }
        />
        <ErrorMessage message={action.error} />
      </RevealPanel>
      {!loggingWeight ? <WeightTrendChart points={visibleTrend.map(point => ({ date: point.weighIn.date, shortLabel: point.weighIn.date.slice(5), rawKg: point.weighIn.weight_kg, trendKg: point.trendKg }))} unit={unit} startDate={start} endDate={end} style={{ marginTop: 8 }} /> : null}
      <MicronutrientsCard averages={value?.averages ?? null} unknownCount={value?.unknownCount ?? ZERO_UNKNOWN} style={{ marginTop: 30 }} />
    </View>} />
    <AnchoredPopover anchor={calendarAnchor} onClose={() => setCalendarAnchor(null)} width={350} label="Choose date" surface><RailMonthSheet selectedDate={anchorDate} maxDate={today} days={dailyDays} loadMonth={loadCalendar} onSelectDate={date => { setAnchorDate(date); setSelectedDay(null); setCalendarAnchor(null); }} onClose={() => setCalendarAnchor(null)} /></AnchoredPopover>
    <AnchoredPopover anchor={infoAnchor} onClose={() => setInfoAnchor(null)} width={312} label="How the trend is smoothed"><ProgTrendPop /></AnchoredPopover>
  </View></Page>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44, marginBottom: 4 },
  rangeButton: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 6, flex: 1, minWidth: 0 },
  rangeLabel: { ...fontFace('semibold'), ...tabularNums, color: colors.ink, fontSize: 15, flexShrink: 1, letterSpacing: -0.1 },
  rangeTrack: { flexDirection: 'row', height: 44, padding: 2, gap: 2, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface },
  rangeSegment: { width: 40, height: 40, borderRadius: radius.r8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  rangeActive: { backgroundColor: colors.raised, borderColor: colors.border },
  rangeSegmentText: { ...fontFace('semibold'), color: colors.muted, fontSize: 12 },
  rangeActiveText: { ...fontFace('bold'), color: colors.ink },
  calorieHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  figures: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  largeValue: { ...fontFace('extrabold'), ...tabularNums, color: colors.ink, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  energyUnit: { ...fontFace('medium'), color: colors.muted, fontSize: 12 },
  coverage: { ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 11, marginTop: 2 },
  targetLegend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  targetLabel: { ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 12 },
  macroSection: { marginTop: 30 },
  macroRow: { paddingVertical: 10, gap: 7 },
  hairline: { borderTopWidth: 1, borderTopColor: colors.hairline },
  macroHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  macroLabel: { ...fontFace('semibold'), fontSize: 12, letterSpacing: 0.1 },
  macroAverage: { ...fontFace('bold'), ...tabularNums, color: colors.ink, fontSize: 14 },
  macroTarget: { ...fontFace('medium'), color: colors.muted, fontSize: 12 },
  macroTrack: { height: 4, borderRadius: 2, backgroundColor: colors.track },
  macroFill: { position: 'absolute', height: 4, borderRadius: 2, opacity: 0.92 },
  targetTick: { position: 'absolute', top: -3, width: 2, height: 10, marginLeft: -1, borderRadius: 1, backgroundColor: colors.muted },
  weightHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  weeklyRate: { ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 12, marginTop: 2 },
  weightActions: { flexDirection: 'row', gap: 6 },
  weightButton: { width: 40, height: 40, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  weighInPanel: { gap: 8 },
  unitSwitchWrap: { width: 92 },
});
