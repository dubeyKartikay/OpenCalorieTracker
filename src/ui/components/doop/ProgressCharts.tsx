import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import {
  colors,
  fontSize,
  fontWeight,
  macroColors,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';
import type { CompletenessStatus } from './CompletenessMark';

const CALORIE_PLOT_HEIGHT = 150;
const TREND_PLOT_HEIGHT = 130;
const TREND_AXIS_WIDTH = 44;
const TREND_INSET_X = 7;
const TREND_INSET_Y = 8;
const TREND_SEGMENT_HEIGHT = 2;
const TREND_MARKER_SIZE = 9;
const TREND_LABEL_WIDTH = 36;
const KG_TO_LB = 2.2046226218;
const KCAL_TO_KJ = 4.184;

function displayEnergy(kcal: number, energyUnit: 'kcal' | 'kJ'): number {
  return energyUnit === 'kJ' ? Math.round(kcal * KCAL_TO_KJ) : Math.round(kcal);
}

const TARGET_DASHES = Array.from({ length: 20 }, (_, index) => index);

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const STATUS_LABEL: Record<CompletenessStatus, string> = {
  complete: 'Complete',
  partial: 'Partially logged',
  none: 'Nothing logged',
};

const STATUS_COLOR: Record<CompletenessStatus, string> = {
  complete: colors.success,
  partial: colors.warning,
  none: colors.muted,
};

function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatChartDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const year = Number(match[1] ?? '');
  const month = Number(match[2] ?? '');
  const day = Number(match[3] ?? '');
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return value;
  const weekday = WEEKDAY_SHORT[date.getUTCDay()] ?? '';
  const monthName = MONTH_SHORT[date.getUTCMonth()] ?? '';
  return `${weekday} ${day} ${monthName}`.trim();
}

function safeKcal(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function formatMacro(value: number | undefined): string {
  return value == null ? '—' : `${formatNumber(value, 1)} g`;
}

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
}

function PopMacro({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  return (
    <View style={styles.popMacro}>
      <Text style={[styles.popMacroLabel, { color }]}>{label}</Text>
      <Text style={styles.popMacroValue}>{formatMacro(value)}</Text>
    </View>
  );
}

/** Inline summary for the day selected in the calorie chart. */
export function ProgDayPop({ day, energyUnit = 'kcal', onClose }: ProgDayPopProps) {
  const energyValue =
    day.completeness === 'none' && !(day.kcal > 0)
      ? '—'
      : formatNumber(displayEnergy(day.kcal, energyUnit));
  return (
    <View style={styles.pop} accessibilityLiveRegion="polite">
      <View style={styles.popHead}>
        <View style={styles.popHeadText}>
          <Text style={styles.popDate}>{formatChartDate(day.date)}</Text>
          <Text style={[styles.popStatus, { color: STATUS_COLOR[day.completeness] }]}>
            {STATUS_LABEL[day.completeness]}
          </Text>
        </View>
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss day summary"
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.popFigures}>
        <Text style={styles.popKcal}>{energyValue}</Text>
        <Text style={styles.popKcalUnit}>{energyUnit}</Text>
        {day.targetKcal != null ? (
          <Text style={styles.popTarget}>
            {`/ ${formatNumber(displayEnergy(day.targetKcal, energyUnit))} target`}
          </Text>
        ) : null}
      </View>
      <View style={styles.popMacros}>
        <PopMacro label="P" value={day.proteinG} color={macroColors.protein} />
        <PopMacro label="C" value={day.carbsG} color={macroColors.carbs} />
        <PopMacro label="F" value={day.fatG} color={macroColors.fat} />
      </View>
    </View>
  );
}

export interface CalorieBarChartProps {
  days: CalorieBarChartDay[];
  energyUnit?: 'kcal' | 'kJ' | undefined;
  selectedDate?: string | null | undefined;
  onSelectDay?: ((date: string | null) => void) | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Seven-ish day calorie bars with a dashed target line and tap-to-inspect pop. */
export function CalorieBarChart({
  days,
  energyUnit = 'kcal',
  selectedDate,
  onSelectDay,
  style,
}: CalorieBarChartProps) {
  const targetRef = days.find(day => day.targetKcal != null)?.targetKcal ?? null;
  const scaleMax =
    Math.max(1, ...days.map(day => Math.max(safeKcal(day.kcal), day.targetKcal ?? 0))) * 1.08;
  const targetTop =
    targetRef == null ? null : CALORIE_PLOT_HEIGHT - (targetRef / scaleMax) * CALORIE_PLOT_HEIGHT;
  const selectedDay =
    selectedDate == null ? null : (days.find(day => day.date === selectedDate) ?? null);

  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{energyUnit === 'kJ' ? 'ENERGY' : 'CALORIES'}</Text>
        <Text style={styles.cardMeta}>
          {targetRef == null
            ? 'no target'
            : `target ${formatNumber(displayEnergy(targetRef, energyUnit))} ${energyUnit}`}
        </Text>
      </View>

      {days.length === 0 ? (
        <View style={styles.chartEmpty}>
          <Text style={styles.emptyLabel}>No days to chart</Text>
        </View>
      ) : (
        <>
          <View style={styles.plot}>
            <View style={styles.bars}>
              {days.map(day => {
                const selected = day.date === selectedDate;
                const height =
                  day.completeness === 'none'
                    ? 0
                    : Math.max(3, (safeKcal(day.kcal) / scaleMax) * CALORIE_PLOT_HEIGHT);
                const targetText =
                  day.targetKcal == null
                    ? null
                    : `target ${formatNumber(displayEnergy(day.targetKcal, energyUnit))} ${energyUnit}`;
                const hasIntake = day.completeness !== 'none' || day.kcal > 0;
                const label = [
                  formatChartDate(day.date),
                  STATUS_LABEL[day.completeness],
                  ...(hasIntake
                    ? [`${formatNumber(displayEnergy(safeKcal(day.kcal), energyUnit))} ${energyUnit}`]
                    : []),
                  ...(targetText == null ? [] : [targetText]),
                ].join(' · ');
                return (
                  <Pressable
                    key={day.date}
                    accessibilityRole={onSelectDay ? 'button' : undefined}
                    accessibilityLabel={label}
                    accessibilityState={{ selected }}
                    hitSlop={{ left: 3, right: 3 }}
                    onPress={() => onSelectDay?.(selected ? null : day.date)}
                    style={({ pressed }) => [
                      styles.barColumn,
                      selected && styles.barColumnSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    {day.completeness === 'none' ? (
                      <View style={styles.emptyTick} />
                    ) : (
                      <View
                        style={[
                          styles.bar,
                          day.completeness === 'complete' ? styles.barComplete : styles.barPartial,
                          { height },
                        ]}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>
            {targetTop == null ? null : (
              <View pointerEvents="none" style={[styles.targetLine, { top: targetTop }]}>
                {TARGET_DASHES.map(dash => (
                  <View key={`dash-${dash}`} style={styles.targetDash} />
                ))}
              </View>
            )}
          </View>

          <View style={styles.axisRow}>
            {days.map(day => (
              <Text
                key={`axis-${day.date}`}
                numberOfLines={1}
                style={[styles.axisLabel, day.date === selectedDate && styles.axisLabelSelected]}
              >
                {day.shortLabel}
              </Text>
            ))}
          </View>
        </>
      )}

      {selectedDay == null ? null : (
        <ProgDayPop
          day={selectedDay}
          energyUnit={energyUnit}
          onClose={onSelectDay ? () => onSelectDay(null) : undefined}
        />
      )}
    </View>
  );
}

export interface WeightTrendPoint {
  date: string;
  shortLabel: string;
  rawKg: number;
  trendKg: number;
}

export interface ProgTrendPopProps {
  onClose?: (() => void) | undefined;
}

/** Explains why the plotted trend differs from the raw weigh-ins. */
export function ProgTrendPop({ onClose }: ProgTrendPopProps) {
  return (
    <View style={styles.pop} accessibilityLiveRegion="polite">
      <View style={styles.popHead}>
        <Text style={styles.popDate}>EWMA · 10% weight</Text>
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close trend explanation"
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.popBody}>
        {
          "Smoothed with EWMA (10% weight per weigh-in) so daily water swings don't look like fat change."
        }
      </Text>
    </View>
  );
}

export interface WeightTrendChartProps {
  points: WeightTrendPoint[];
  unit: 'kg' | 'lb';
  showInfo?: boolean | undefined;
  onToggleInfo?: (() => void) | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Raw weigh-in dots joined by an EWMA trend line, scaled to the visible range. */
export function WeightTrendChart({
  points,
  unit,
  showInfo,
  onToggleInfo,
  style,
}: WeightTrendChartProps) {
  const [plotWidth, setPlotWidth] = useState(0);
  const plotPoints = points.filter(
    point => Number.isFinite(point.rawKg) && Number.isFinite(point.trendKg),
  );

  const allKg = plotPoints.flatMap(point => [point.rawKg, point.trendKg]);
  let minKg = allKg.length > 0 ? Math.min(...allKg) : 0;
  let maxKg = allKg.length > 0 ? Math.max(...allKg) : 1;
  if (maxKg - minKg < 0.4) {
    const middle = (maxKg + minKg) / 2;
    minKg = middle - 0.2;
    maxKg = middle + 0.2;
  }
  const padding = (maxKg - minKg) * 0.08;
  minKg -= padding;
  maxKg += padding;
  const span = Math.max(0.0001, maxKg - minKg);

  const toDisplay = (kg: number) => (unit === 'lb' ? kg * KG_TO_LB : kg);
  const usableHeight = TREND_PLOT_HEIGHT - TREND_INSET_Y * 2;
  const usableWidth = Math.max(0, plotWidth - TREND_INSET_X * 2);
  const xFor = (index: number) =>
    plotPoints.length <= 1
      ? plotWidth / 2
      : TREND_INSET_X + (index / (plotPoints.length - 1)) * usableWidth;
  const yFor = (kg: number) =>
    TREND_INSET_Y + (1 - (kg - minKg) / span) * usableHeight;

  const handlePlotLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setPlotWidth(current => (Math.abs(current - nextWidth) > 0.5 ? nextWidth : current));
  };

  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>WEIGHT</Text>
        <View style={styles.headRight}>
          <Text style={styles.cardMeta}>{unit.toUpperCase()}</Text>
          {onToggleInfo ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="About the weight trend"
              accessibilityState={{ expanded: showInfo === true }}
              onPress={onToggleInfo}
              style={({ pressed }) => [styles.infoButton, pressed && styles.pressed]}
            >
              <View style={[styles.infoRing, showInfo === true && styles.infoRingActive]}>
                <Text style={[styles.infoGlyph, showInfo === true && styles.infoGlyphActive]}>i</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>

      {plotPoints.length === 0 ? (
        <View style={styles.trendEmpty}>
          <Text style={styles.emptyLabel}>No weigh-ins in this range</Text>
        </View>
      ) : (
        <>
          <View style={styles.trendBody}>
            <View style={styles.trendAxis}>
              <Text style={styles.axisValue}>{formatNumber(toDisplay(maxKg), 1)}</Text>
              <Text style={styles.axisValue}>{formatNumber(toDisplay(minKg), 1)}</Text>
            </View>
            <View style={styles.trendPlotArea} onLayout={handlePlotLayout}>
              {plotWidth > 0 ? (
                <>
                  {plotPoints.map((point, index) => (
                    <View
                      key={`raw-${point.date}-${index}`}
                      pointerEvents="none"
                      style={[
                        styles.rawDot,
                        { left: xFor(index) - 3, top: yFor(point.rawKg) - 3 },
                      ]}
                    />
                  ))}
                  {plotPoints.map((point, index) => {
                    const next = plotPoints[index + 1];
                    if (!next) return null;
                    const x1 = xFor(index);
                    const y1 = yFor(point.trendKg);
                    const x2 = xFor(index + 1);
                    const y2 = yFor(next.trendKg);
                    const length = Math.hypot(x2 - x1, y2 - y1);
                    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
                    return (
                      <View
                        key={`trend-${point.date}-${index}`}
                        pointerEvents="none"
                        style={[
                          styles.trendSegment,
                          {
                            width: length,
                            left: (x1 + x2) / 2 - length / 2,
                            top: (y1 + y2) / 2 - TREND_SEGMENT_HEIGHT / 2,
                            transform: [{ rotate: `${angle}deg` }],
                          },
                        ]}
                      />
                    );
                  })}
                  {plotPoints.map((point, index) => (
                    <View
                      key={`marker-${point.date}-${index}`}
                      pointerEvents="none"
                      style={[
                        styles.trendMarker,
                        {
                          left: xFor(index) - TREND_MARKER_SIZE / 2,
                          top: yFor(point.trendKg) - TREND_MARKER_SIZE / 2,
                        },
                      ]}
                    />
                  ))}
                </>
              ) : null}
            </View>
          </View>

          <View style={styles.trendAxisRow}>
            <View style={styles.axisSpacer} />
            <View style={styles.trendLabels}>
              {plotWidth > 0
                ? plotPoints.map((point, index) => (
                    <Text
                      key={`label-${point.date}-${index}`}
                      numberOfLines={1}
                      style={[styles.trendTick, { left: xFor(index) - TREND_LABEL_WIDTH / 2 }]}
                    >
                      {point.shortLabel}
                    </Text>
                  ))
                : null}
            </View>
          </View>
        </>
      )}

      {showInfo === true ? <ProgTrendPop onClose={onToggleInfo} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.r16,
    padding: spacing.s16,
    gap: spacing.s12,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s8,
    minHeight: 24,
  },
  cardTitle: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
  },
  cardMeta: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  headRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s4,
  },
  chartEmpty: {
    height: CALORIE_PLOT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plot: {
    height: CALORIE_PLOT_HEIGHT,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CALORIE_PLOT_HEIGHT,
    gap: spacing.s6,
  },
  barColumn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderRadius: radius.r8,
  },
  barColumnSelected: {
    backgroundColor: colors.raised,
  },
  bar: {
    width: '56%',
    maxWidth: 30,
    minWidth: 8,
    borderTopLeftRadius: radius.r8,
    borderTopRightRadius: radius.r8,
  },
  barComplete: {
    backgroundColor: colors.accent,
  },
  barPartial: {
    backgroundColor: colors.track,
    borderWidth: 1,
    borderColor: colors.muted,
  },
  emptyTick: {
    width: 10,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.border,
  },
  targetLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: spacing.s4,
    zIndex: 1,
  },
  targetDash: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  axisRow: {
    flexDirection: 'row',
    gap: spacing.s6,
    marginTop: -spacing.s4,
  },
  axisLabel: {
    flex: 1,
    textAlign: 'center',
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  axisLabelSelected: {
    color: colors.ink,
    fontWeight: fontWeight.bold,
  },
  pop: {
    backgroundColor: colors.raised,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.s12,
    gap: spacing.s8,
  },
  popHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s8,
  },
  popHeadText: {
    flex: 1,
    gap: spacing.s2,
  },
  popDate: {
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  popStatus: {
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  closeButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  closeGlyph: {
    color: colors.muted,
    fontSize: fontSize.t18,
    fontWeight: fontWeight.medium,
  },
  popFigures: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s6,
  },
  popKcal: {
    color: colors.ink,
    fontSize: fontSize.t24,
    fontWeight: fontWeight.extrabold,
    fontVariant: [...tabularNums.fontVariant],
  },
  popKcalUnit: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  popTarget: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontVariant: [...tabularNums.fontVariant],
  },
  popMacros: {
    flexDirection: 'row',
    gap: spacing.s6,
  },
  popMacro: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s4,
    backgroundColor: colors.surface,
    borderRadius: radius.r8,
    paddingHorizontal: spacing.s8,
    paddingVertical: spacing.s6,
  },
  popMacroLabel: {
    fontSize: fontSize.t11,
    fontWeight: fontWeight.bold,
  },
  popMacroValue: {
    color: colors.ink,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  popBody: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
    lineHeight: 19,
  },
  trendBody: {
    flexDirection: 'row',
    gap: spacing.s8,
  },
  trendAxis: {
    width: TREND_AXIS_WIDTH,
    height: TREND_PLOT_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  axisValue: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  trendPlotArea: {
    flex: 1,
    height: TREND_PLOT_HEIGHT,
    position: 'relative',
  },
  trendEmpty: {
    height: TREND_PLOT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderStyle: 'dashed',
  },
  emptyLabel: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  rawDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.muted,
    opacity: 0.55,
  },
  trendSegment: {
    position: 'absolute',
    height: TREND_SEGMENT_HEIGHT,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  trendMarker: {
    position: 'absolute',
    width: TREND_MARKER_SIZE,
    height: TREND_MARKER_SIZE,
    borderRadius: TREND_MARKER_SIZE / 2,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  trendAxisRow: {
    flexDirection: 'row',
    gap: spacing.s8,
    marginTop: -spacing.s4,
  },
  axisSpacer: { width: TREND_AXIS_WIDTH },
  trendLabels: {
    flex: 1,
    height: 16,
    position: 'relative',
  },
  trendTick: {
    position: 'absolute',
    width: TREND_LABEL_WIDTH,
    textAlign: 'center',
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  infoButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRing: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRingActive: {
    borderColor: colors.accent,
  },
  infoGlyph: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.bold,
  },
  infoGlyphActive: {
    color: colors.accent,
  },
  pressed: { opacity: 0.7 },
});
