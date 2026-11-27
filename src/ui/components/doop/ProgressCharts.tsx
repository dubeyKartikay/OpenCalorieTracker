import { useId, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Pattern, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { hapticSelection } from '../../haptics';
import { colors, fontFace, fontFamily, macroColors, tabularNums } from '../../tokens';
import { DoopIcon } from '../DoopIcons';
import { energyValue, formatShortDate, formatWeekdayDate, number } from '../primitives';
import { CompletenessMark } from './CompletenessMark';
import type { CompletenessStatus } from './CompletenessMark';
import { AnchoredPopover, measurePopoverAnchor } from './HistoryControls';
import type { PopoverAnchor } from './HistoryControls';

const CALORIE_PLOT_HEIGHT = 168;
const TREND_PLOT_HEIGHT = 148;
const KG_TO_LB = 2.2046226218;
const DAY_MS = 86_400_000;
const dateMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const shortDate = formatShortDate;
const fullDate = formatWeekdayDate;
const fmt = number;
const positive = (value: number | undefined) => value != null && Number.isFinite(value) ? Math.max(0, value) : 0;

export interface CalorieBarChartDay {
  date: string;
  shortLabel: string;
  kcal: number;
  targetKcal: number | null;
  completeness: CompletenessStatus;
  proteinG?: number | undefined;
  carbsG?: number | undefined;
  fatG?: number | undefined;
}
export interface ProgDayPopProps {
  day: CalorieBarChartDay;
  energyUnit?: 'kcal' | 'kJ' | undefined;
  onClose?: (() => void) | undefined;
  onOpenHistory?: ((date: string) => void) | undefined;
  onPrevDay?: (() => void) | undefined;
  onNextDay?: (() => void) | undefined;
}

export function ProgDayPop({ day, energyUnit = 'kcal', onClose, onOpenHistory, onPrevDay, onNextDay }: ProgDayPopProps) {
  return <View style={styles.dayPop}>
    <View style={styles.popHeader}><Text accessibilityLiveRegion="polite" style={styles.popDate}>{fullDate(day.date)}</Text><CompletenessMark status={day.completeness} />
      {onClose ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss day summary" onPress={onClose} style={styles.closeButton}><DoopIcon name="close" size={14} color={colors.muted} /></Pressable> : null}
    </View>
    <View style={styles.figures}><Text style={styles.popKcal}>{fmt(energyValue(day.kcal, energyUnit))}</Text><Text style={styles.unit}>{energyUnit}</Text></View>
    <View style={styles.popMacros}>{([
      ['P', day.proteinG, macroColors.protein], ['C', day.carbsG, macroColors.carbs], ['F', day.fatG, macroColors.fat],
    ] as const).map(([label, value, color]) => <View key={label} style={styles.popMacro}><Text style={[styles.macroLetter, { color }]}>{label}</Text><Text style={styles.popMacroValue}>{fmt(value)}<Text style={styles.unit}>g</Text></Text></View>)}</View>
    {(onPrevDay || onNextDay) ? (
      <View style={styles.popNav}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous logged day" accessibilityState={{ disabled: !onPrevDay }} disabled={!onPrevDay} onPress={onPrevDay} style={[styles.popNavBtn, !onPrevDay && styles.popNavDisabled]}>
          <View style={{ transform: [{ rotate: '180deg' }] }}><DoopIcon name="chevronRight" size={14} color={colors.muted} /></View>
          <Text style={styles.popNavText}>Prev</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next logged day" accessibilityState={{ disabled: !onNextDay }} disabled={!onNextDay} onPress={onNextDay} style={[styles.popNavBtn, !onNextDay && styles.popNavDisabled]}>
          <Text style={styles.popNavText}>Next</Text>
          <DoopIcon name="chevronRight" size={14} color={colors.muted} />
        </Pressable>
      </View>
    ) : null}
    <Pressable accessibilityRole="button" onPress={() => {
      onClose?.();
      if (onOpenHistory) onOpenHistory(day.date);
      else router.push({ pathname: '/(tabs)/history', params: { date: day.date, selection: String(Date.now()) } });
    }} style={styles.historyLink}><Text style={styles.linkText}>Open in History</Text><DoopIcon name="chevronRight" size={15} color={colors.accent} /></Pressable>
  </View>;
}

export interface CalorieBarChartProps {
  days: CalorieBarChartDay[];
  energyUnit?: 'kcal' | 'kJ' | undefined;
  selectedDate?: string | null | undefined;
  onSelectDay?: ((date: string | null) => void) | undefined;
  onOpenHistory?: ((date: string) => void) | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

interface TargetChange { index: number; from: number; to: number; date: string; x: number; y: number }

/** Real stacked SVG bars; partial days are hatched, and unlogged days remain gaps. */
export function CalorieBarChart({ days, energyUnit = 'kcal', selectedDate, onSelectDay, onOpenHistory, style }: CalorieBarChartProps) {
  const [width, setWidth] = useState(0);
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const [dayAnchor, setDayAnchor] = useState<PopoverAnchor | null>(null);
  const [targetAnchor, setTargetAnchor] = useState<PopoverAnchor | null>(null);
  const [targetChange, setTargetChange] = useState<TargetChange | null>(null);
  const plotRef = useRef<ComponentRef<typeof View>>(null);
  const targetRefs = useRef<Record<string, ComponentRef<typeof View> | null>>({});
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const hatchId = `partial${id}`;
  const selected = selectedDate === undefined ? localSelection : selectedDate;
  const selectedIndex = days.findIndex(day => day.date === selected);
  const selectedDay = days[selectedIndex];
  const slot = width / Math.max(1, days.length);
  const barWidth = Math.max(0.5, Math.min(days.length <= 7 ? 26 : 9, slot * (days.length <= 7 ? 0.55 : 0.62)));
  const max = Math.max(1, ...days.map(day => Math.max(positive(day.kcal), positive(day.targetKcal ?? undefined)))) * 1.08;
  const y = (value: number) => CALORIE_PLOT_HEIGHT - Math.max(0, value) / max * CALORIE_PLOT_HEIGHT;
  const changes: TargetChange[] = [];
  let targetPath = '';
  days.forEach((day, index) => {
    if (day.targetKcal == null || !Number.isFinite(day.targetKcal)) return;
    const currentY = y(day.targetKcal);
    const prior = days[index - 1];
    const x = index * slot;
    if (!prior || prior.targetKcal == null) targetPath += `M${x},${currentY}`;
    else if (prior.targetKcal !== day.targetKcal) {
      targetPath += `V${currentY}`;
      changes.push({ index, from: prior.targetKcal, to: day.targetKcal, date: day.date, x, y: (y(prior.targetKcal) + currentY) / 2 });
    }
    targetPath += `H${(index + 1) * slot}`;
  });
  const loggedIndices = days.reduce<number[]>((acc, day, index) => {
    if (day.completeness !== 'none') acc.push(index);
    return acc;
  }, []);
  const selectedLoggedPos = loggedIndices.indexOf(selectedIndex);
  const prevLoggedIndex = selectedLoggedPos > 0 ? loggedIndices[selectedLoggedPos - 1] : undefined;
  const nextLoggedIndex = selectedLoggedPos >= 0 && selectedLoggedPos < loggedIndices.length - 1 ? loggedIndices[selectedLoggedPos + 1] : undefined;
  const closeDay = () => { setDayAnchor(null); setLocalSelection(null); onSelectDay?.(null); };
  const inspect = (day: CalorieBarChartDay, index: number, toggleIfSame = true) => {
    setTargetAnchor(null);
    if (toggleIfSame && selected === day.date && dayAnchor) { closeDay(); return; }
    hapticSelection();
    setLocalSelection(day.date); onSelectDay?.(day.date);
    plotRef.current?.measureInWindow((x, top) => setDayAnchor({ x: x + index * slot, y: top + y(positive(day.kcal)), width: Math.max(8, slot), height: CALORIE_PLOT_HEIGHT - y(positive(day.kcal)) }));
  };
  const inspectNearestAtX = (locationX: number) => {
    if (!loggedIndices.length || width <= 0) return;
    let bestIndex = loggedIndices[0]!;
    let bestDist = Infinity;
    for (const index of loggedIndices) {
      const center = (index + 0.5) * slot;
      const dist = Math.abs(center - locationX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = index;
      }
    }
    const day = days[bestIndex];
    if (day) inspect(day, bestIndex, false);
  };
  const densePlot = slot > 0 && slot < 24;
  const axisDays = days.length ? [days[0]!, days[Math.floor(days.length / 2)]!, days[days.length - 1]!] : [];
  return <View style={[styles.chart, style]}>
    <View ref={plotRef} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: CALORIE_PLOT_HEIGHT, width: '100%' }}>
      {width > 0 ? <Svg width={width} height={CALORIE_PLOT_HEIGHT} viewBox={`0 0 ${width} ${CALORIE_PLOT_HEIGHT}`} accessible={false}>
        <Defs><Pattern id={hatchId} patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)"><Line x1={0} y1={0} x2={0} y2={4} stroke={colors.border} strokeWidth={1} /></Pattern>
          {days.map((day, index) => day.completeness === 'complete' ? <ClipPath id={`bar${id}${index}`} key={day.date}><Rect x={index * slot + (slot - barWidth) / 2} y={y(positive(day.kcal))} width={barWidth} height={CALORIE_PLOT_HEIGHT - y(positive(day.kcal))} rx={2} /></ClipPath> : null)}
        </Defs>
        {days.map((day, index) => {
          if (day.completeness === 'none') return null;
          const x = index * slot + (slot - barWidth) / 2;
          const height = CALORIE_PLOT_HEIGHT - y(positive(day.kcal));
          if (day.completeness === 'partial') return <Rect key={day.date} x={x} y={y(positive(day.kcal))} width={barWidth} height={height} rx={2} fill={`url(#${hatchId})`} stroke={colors.border} strokeWidth={0.8} />;
          const p = positive(day.proteinG) * 4;
          const c = positive(day.carbsG) * 4;
          const f = positive(day.fatG) * 9;
          const total = p + c + f;
          if (!total || day.proteinG == null || day.carbsG == null || day.fatG == null) return <Rect key={day.date} x={x} y={y(positive(day.kcal))} width={barWidth} height={height} rx={2} fill={colors.accent} />;
          const fatHeight = f / total * height;
          const carbHeight = c / total * height;
          const proteinHeight = p / total * height;
          return <G key={day.date} clipPath={`url(#bar${id}${index})`}>
            <Rect x={x} y={CALORIE_PLOT_HEIGHT - fatHeight} width={barWidth} height={fatHeight} fill={macroColors.fat} />
            <Rect x={x} y={CALORIE_PLOT_HEIGHT - fatHeight - carbHeight} width={barWidth} height={carbHeight} fill={macroColors.carbs} />
            <Rect x={x} y={y(positive(day.kcal))} width={barWidth} height={proteinHeight} fill={macroColors.protein} />
          </G>;
        })}
        {selectedIndex >= 0 && selectedDay?.completeness !== 'none' ? <Rect x={selectedIndex * slot} y={0} width={Math.max(3, slot)} height={CALORIE_PLOT_HEIGHT} fill={colors.accent} opacity={0.18} /> : null}
        <Path d={targetPath} fill="none" stroke={colors.muted} strokeWidth={1} strokeDasharray="3 4" strokeOpacity={0.7} />
        {changes.map(change => <Polygon key={change.date} points={`${change.x},${change.y - 5} ${change.x + 5},${change.y} ${change.x},${change.y + 5} ${change.x - 5},${change.y}`} fill={colors.ground} stroke={colors.muted} strokeWidth={1} />)}
        <Line x1={0} y1={CALORIE_PLOT_HEIGHT - 0.5} x2={width} y2={CALORIE_PLOT_HEIGHT - 0.5} stroke={colors.hairline} />
      </Svg> : null}
      {densePlot ? (
        loggedIndices.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Inspect logged days, ${loggedIndices.length} days with entries`}
            accessibilityHint="Tap chart to inspect nearest logged day"
            onPress={event => inspectNearestAtX(event.nativeEvent.locationX)}
            style={StyleSheet.absoluteFill}
          />
        ) : null
      ) : (
        days.map((day, index) => day.completeness !== 'none' ? <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`${fullDate(day.date)}, ${day.completeness}, ${fmt(energyValue(day.kcal, energyUnit))} ${energyUnit}`} accessibilityState={{ selected: day.date === selected }} onPress={() => inspect(day, index)} style={{ position: 'absolute', left: index * slot, top: 0, width: slot, height: CALORIE_PLOT_HEIGHT }} /> : null)
      )}
      {days.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>No days to chart</Text></View> : null}
    </View>
    <View style={styles.axis}>{axisDays.map((day, i) => <Text key={i} style={[styles.axisText, { textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center' }]}>{shortDate(day.date)}</Text>)}</View>
    {changes.length > 0 ? (
      <View style={styles.targetStrip}>
        {changes.map(change => (
          <View key={change.date} ref={node => { targetRefs.current[change.date] = node; }} collapsable={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Target changed from ${fmt(energyValue(change.from, energyUnit))} to ${fmt(energyValue(change.to, energyUnit))} ${energyUnit}, ${shortDate(change.date)}`}
              onPress={() => {
                hapticSelection();
                closeDay();
                setTargetChange(change);
                measurePopoverAnchor(targetRefs.current[change.date] ?? null, setTargetAnchor);
              }}
              style={({ pressed }) => [styles.targetChip, pressed && { opacity: 0.72 }]}
            >
              <View style={styles.targetDiamond} />
              <Text style={styles.targetChipText}>{`Target · ${shortDate(change.date)}`}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    ) : null}
    <AnchoredPopover anchor={selectedDay ? dayAnchor : null} onClose={closeDay} width={224} label="Day summary" preferAbove>
      {selectedDay ? (
        <ProgDayPop
          day={selectedDay}
          energyUnit={energyUnit}
          onClose={closeDay}
          onOpenHistory={onOpenHistory}
          onPrevDay={prevLoggedIndex !== undefined ? () => inspect(days[prevLoggedIndex]!, prevLoggedIndex, false) : undefined}
          onNextDay={nextLoggedIndex !== undefined ? () => inspect(days[nextLoggedIndex]!, nextLoggedIndex, false) : undefined}
        />
      ) : null}
    </AnchoredPopover>
    <AnchoredPopover anchor={targetAnchor} onClose={() => setTargetAnchor(null)} width={280} label="Target change">
      {targetChange ? <Text style={styles.targetPop}><Text style={styles.targetValue}>{fmt(energyValue(targetChange.from, energyUnit))}</Text>{' → '}<Text style={styles.targetValue}>{fmt(energyValue(targetChange.to, energyUnit))}</Text>{` · from ${shortDate(targetChange.date)}`}</Text> : null}
    </AnchoredPopover>
  </View>;
}

export interface WeightTrendPoint {
  date: string;
  shortLabel: string;
  rawKg: number;
  trendKg: number;
}
export interface ProgTrendPopProps { onClose?: (() => void) | undefined }
export function ProgTrendPop({ onClose }: ProgTrendPopProps) {
  return <View style={styles.trendPop}>
    <Text style={styles.trendExplanation}>Each weigh-in moves the trend 10% toward the new measurement (exponential moving average), smoothing daily water swings.</Text>
    {onClose ? <Pressable accessibilityRole="button" accessibilityLabel="Close trend explanation" onPress={onClose} style={styles.closeButton}><DoopIcon name="close" size={14} color={colors.muted} /></Pressable> : null}
  </View>;
}
export interface WeightTrendChartProps {
  points: WeightTrendPoint[];
  unit: 'kg' | 'lb';
  startDate?: string | undefined;
  endDate?: string | undefined;
  showInfo?: boolean | undefined;
  onToggleInfo?: (() => void) | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

interface XY { x: number; y: number }
/** Horizontal cubic controls join EWMA observations smoothly without overshooting their values. */
function smoothPath(points: XY[]): string {
  const first = points[0];
  if (!first) return '';
  let path = `M${first.x},${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const mid = (a.x + b.x) / 2;
    path += `C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`;
  }
  return path;
}

/** Raw daily observations over the existing 10% EWMA, with a translucent trend area. */
export function WeightTrendChart({ points, unit, startDate, endDate, showInfo, onToggleInfo, style }: WeightTrendChartProps) {
  const [width, setWidth] = useState(0);
  const [infoAnchor, setInfoAnchor] = useState<PopoverAnchor | null>(null);
  const infoRef = useRef<ComponentRef<typeof View>>(null);
  const factor = unit === 'lb' ? KG_TO_LB : 1;
  const valid = points.filter(p => Number.isFinite(p.rawKg) && Number.isFinite(p.trendKg) && Number.isFinite(dateMs(p.date))).sort((a, b) => a.date.localeCompare(b.date));
  const values = valid.flatMap(p => [p.rawKg * factor, p.trendKg * factor]);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const span = Math.max(rawMax - rawMin, unit === 'lb' ? 0.8 : 0.4);
  const low = (rawMin + rawMax) / 2 - span * 0.57;
  const high = (rawMin + rawMax) / 2 + span * 0.57;
  const rawStep = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normal = rawStep / magnitude;
  const step = (normal <= 1 ? 1 : normal <= 2 ? 2 : normal <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(low / step) * step; v <= high + step * 0.001; v += step) ticks.push(v);
  const start = startDate ?? valid[0]?.date;
  const end = endDate ?? valid[valid.length - 1]?.date;
  const startMs = start ? dateMs(start) : 0;
  const endMs = end ? dateMs(end) : DAY_MS;
  const x = (date: string) => 6 + Math.max(0, Math.min(1, (dateMs(date) - startMs) / Math.max(DAY_MS, endMs - startMs))) * Math.max(0, width - 24);
  const y = (kg: number) => 6 + (high - kg * factor) / (high - low) * (TREND_PLOT_HEIGHT - 12);
  const linePoints = valid.map(p => ({ x: x(p.date), y: y(p.trendKg) }));
  const first = linePoints[0];
  const last = linePoints[linePoints.length - 1];
  const path = smoothPath(linePoints);
  const area = first && last ? `${path}L${last.x},${TREND_PLOT_HEIGHT}L${first.x},${TREND_PLOT_HEIGHT}Z` : '';
  const middleDate = start && end ? new Date(startMs + Math.ceil((endMs - startMs) / DAY_MS / 2) * DAY_MS).toISOString().slice(0, 10) : null;
  return <View style={[styles.chart, style]}>
    {onToggleInfo ? <Pressable ref={infoRef} accessibilityRole="button" accessibilityLabel="How the trend is smoothed" onPress={() => { measurePopoverAnchor(infoRef.current, setInfoAnchor); onToggleInfo(); }} style={styles.standaloneInfo}><DoopIcon name="info" size={16} color={colors.muted} /></Pressable> : null}
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: TREND_PLOT_HEIGHT }}>
      {width > 0 && valid.length ? <Svg width={width} height={TREND_PLOT_HEIGHT} viewBox={`0 0 ${width} ${TREND_PLOT_HEIGHT}`} accessible accessibilityLabel={`${unit} weight trend, ${valid.length} weigh-ins, smoothed with a 10% exponential moving average`}>
        {ticks.map(tick => {
          const top = y(tick / factor);
          return <G key={tick}><Line x1={0} x2={Math.max(0, width - 20)} y1={top} y2={top} stroke={colors.hairline} strokeWidth={1} /><SvgText x={width - 2} y={top - 3} textAnchor="end" fill={colors.muted} opacity={0.65} fontSize={9} fontFamily={fontFamily.body}>{fmt(tick, 1)}</SvgText></G>;
        })}
        <Path d={area} fill="rgba(122,162,247,0.12)" />
        <Path d={path} fill="none" stroke={colors.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {valid.map((p, i) => <Circle key={`${p.date}-${i}`} cx={x(p.date)} cy={y(p.rawKg)} r={2.5} fill={i === valid.length - 1 ? colors.ink : colors.muted} opacity={i === valid.length - 1 ? 1 : 0.6} />)}
      </Svg> : <View style={styles.empty}><Text style={styles.emptyText}>Log a weigh-in to see your trend</Text></View>}
    </View>
    <View style={styles.axis}>{start && end && middleDate ? [start, middleDate, end].map((date, i) => <Text key={i} style={[styles.axisText, { textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center' }]}>{shortDate(date)}</Text>) : null}</View>
    <AnchoredPopover anchor={showInfo ? infoAnchor : null} onClose={() => { setInfoAnchor(null); onToggleInfo?.(); }} width={312} label="How the trend is smoothed"><ProgTrendPop /></AnchoredPopover>
  </View>;
}

const styles = StyleSheet.create({
  chart: { width: '100%', minWidth: 0 },
  axis: { flexDirection: 'row', marginTop: 4, height: 18 },
  axisText: { ...fontFace('medium'), ...tabularNums, flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
  empty: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...fontFace('medium'), color: colors.muted, fontSize: 12 },
  dayPop: { paddingHorizontal: 12, paddingTop: 10 },
  popHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 },
  popDate: { ...fontFace('semibold'), ...tabularNums, color: colors.muted, fontSize: 12, flex: 1 },
  figures: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 3 },
  popKcal: { ...fontFace('extrabold'), ...tabularNums, color: colors.ink, fontSize: 24, letterSpacing: -0.6 },
  unit: { ...fontFace('medium'), color: colors.muted, fontSize: 11 },
  popMacros: { flexDirection: 'row', gap: 11, marginTop: 6 },
  popMacro: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  macroLetter: { ...fontFace('bold'), fontSize: 10 },
  popMacroValue: { ...fontFace('semibold'), ...tabularNums, color: colors.ink, fontSize: 12 },
  popNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 6 },
  popNavBtn: { minHeight: 36, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, flexDirection: 'row', alignItems: 'center', gap: 4 },
  popNavDisabled: { opacity: 0.32 },
  popNavText: { ...fontFace('semibold'), fontSize: 11, color: colors.muted },
  historyLink: { minHeight: 44, marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkText: { ...fontFace('semibold'), color: colors.accent, fontSize: 12 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -12, marginTop: -10, marginBottom: -10 },
  targetPop: { ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 12, paddingVertical: 12, paddingHorizontal: 12 },
  targetValue: { ...fontFace('bold'), color: colors.ink },
  targetStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  targetChip: { minHeight: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6 },
  targetDiamond: { width: 7, height: 7, borderWidth: 1, borderColor: colors.muted, backgroundColor: colors.ground, transform: [{ rotate: '45deg' }] },
  targetChipText: { ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 11 },
  trendPop: { padding: 12, flexDirection: 'row', gap: 8 },
  trendExplanation: { ...fontFace('medium'), flex: 1, color: colors.muted, fontSize: 11, lineHeight: 17 },
  standaloneInfo: { alignSelf: 'flex-end', width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
});
