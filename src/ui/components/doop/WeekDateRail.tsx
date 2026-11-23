import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  colors,
  fontSize,
  fontWeight,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';
import { CompletenessMark } from './CompletenessMark';
import type { CompletenessStatus } from './CompletenessMark';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const STATUS_LABELS: Record<CompletenessStatus, string> = {
  complete: 'complete',
  partial: 'partially logged',
  none: 'nothing logged',
};

export interface WeekDateRailDay {
  date: string;
  weekdayInitial: string;
  dayNumber: string;
  completeness: CompletenessStatus;
  kcal: number;
}

function formatKcal(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fullDateLabel(day: WeekDateRailDay): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day.date);
  if (!match) return `${day.weekdayInitial} ${day.dayNumber}`;
  const year = Number(match[1] ?? '');
  const month = Number(match[2] ?? '');
  const dayOfMonth = Number(match[3] ?? '');
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (Number.isNaN(date.getTime())) return `${day.weekdayInitial} ${day.dayNumber}`;
  const weekday = WEEKDAY_NAMES[date.getUTCDay()] ?? day.weekdayInitial;
  const monthName = MONTH_NAMES[date.getUTCMonth()] ?? '';
  return `${weekday} ${dayOfMonth} ${monthName}`.trim();
}

function accessibilityLabelFor(day: WeekDateRailDay): string {
  const intake =
    day.completeness === 'none' && !(day.kcal > 0)
      ? 'no intake logged'
      : `${formatKcal(day.kcal)} kcal`;
  return `${fullDateLabel(day)} · ${STATUS_LABELS[day.completeness]} · ${intake}`;
}

export interface RailTrendDayCellProps {
  day: WeekDateRailDay;
  selected: boolean;
  onPress: () => void;
}

/** One weekday column in the seven-day rail. */
export function RailTrendDayCell({ day, selected, onPress }: RailTrendDayCellProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelFor(day)}
      accessibilityState={{ selected }}
      hitSlop={{ left: 2, right: 2 }}
      onPress={onPress}
      style={({ pressed }) => [styles.cell, selected && styles.cellSelected, pressed && styles.pressed]}
    >
      <Text style={styles.cellInitial}>{day.weekdayInitial}</Text>
      <Text style={styles.cellNumber}>{day.dayNumber}</Text>
      <CompletenessMark status={day.completeness} size={9} />
    </Pressable>
  );
}

export interface WeekDateRailProps {
  days: WeekDateRailDay[];
  selectedDate: string;
  rangeLabel: string;
  onSelectDate: (date: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  disableNext?: boolean | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** Seven-day date picker with per-day completeness marks. */
export function WeekDateRail({
  days,
  selectedDate,
  rangeLabel,
  onSelectDate,
  onPrevWeek,
  onNextWeek,
  disableNext,
  style,
}: WeekDateRailProps) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          onPress={onPrevWeek}
          style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
        >
          <Text style={styles.navGlyph}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.rangeLabel}>
          {rangeLabel}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next week"
          accessibilityState={{ disabled: disableNext === true }}
          disabled={disableNext === true}
          onPress={onNextWeek}
          style={({ pressed }) => [
            styles.navButton,
            disableNext === true && styles.navButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.navGlyph}>›</Text>
        </Pressable>
      </View>
      <View style={styles.daysRow}>
        {days.map(day => (
          <RailTrendDayCell
            key={day.date}
            day={day}
            selected={day.date === selectedDate}
            onPress={() => onSelectDate(day.date)}
          />
        ))}
      </View>
    </View>
  );
}

/** Doop design-system alias. */
export const RailWeekPicker = WeekDateRail;
export type RailWeekPickerProps = WeekDateRailProps;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.r16,
    padding: spacing.s8,
    gap: spacing.s4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s8,
  },
  navButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  navButtonDisabled: { opacity: 0.35 },
  navGlyph: {
    color: colors.ink,
    fontSize: fontSize.t20,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  rangeLabel: {
    flex: 1,
    textAlign: 'center',
    color: colors.ink,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  daysRow: {
    flexDirection: 'row',
    gap: spacing.s4,
  },
  cell: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s6,
    paddingVertical: spacing.s8,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  cellSelected: {
    backgroundColor: colors.raised,
    borderColor: colors.accent,
  },
  cellInitial: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
  },
  cellNumber: {
    color: colors.ink,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.bold,
    fontVariant: [...tabularNums.fontVariant],
  },
  pressed: { opacity: 0.7 },
});
