import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ComponentRef, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { hapticLight, hapticSelection } from '../../haptics';
import { colors, fontFace, tabularNums } from '../../tokens';
import { DoopIcon } from '../DoopIcons';
import { energy, formatShortDate } from '../primitives';
import { CompletenessMark } from './CompletenessMark';
import type { CompletenessStatus } from './CompletenessMark';

const INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dateObject = (date: string) => new Date(`${date}T12:00:00`);
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const shortRailDate = formatShortDate;

export function weekEndForDate(date: string): string {
  const value = dateObject(date);
  value.setDate(value.getDate() + (7 - value.getDay()) % 7);
  return isoDate(value);
}

export function railRangeLabel(start: string, end: string): string {
  const a = dateObject(start);
  const b = dateObject(end);
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${a.getDate()}–${b.getDate()} ${b.toLocaleDateString('en-GB', { month: 'short' })}`
    : `${shortRailDate(start)} – ${shortRailDate(end)}`;
}

export interface WeekDateRailDay {
  date: string;
  weekdayInitial: string;
  dayNumber: string;
  completeness: CompletenessStatus;
  kcal: number;
}
export interface RailTrendDayCellProps {
  day: WeekDateRailDay;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean | undefined;
  energyUnit?: 'kcal' | 'kJ' | undefined;
}

export function RailTrendDayCell({ day, selected, onPress, disabled, energyUnit = 'kcal' }: RailTrendDayCellProps) {
  const label = dateObject(day.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${day.completeness === 'none' ? 'nothing logged' : 'logged'}, ${energy(day.kcal, energyUnit)}`}
    accessibilityState={{ selected, disabled: !!disabled }} disabled={disabled} onPress={() => { hapticSelection(); onPress(); }}
    style={({ pressed }) => [styles.cell, selected && styles.cellSelected, pressed && styles.pressed]}>
    <Text style={styles.initial}>{day.weekdayInitial}</Text>
    <Text style={[styles.date, selected && { color: colors.accent }]}>{Number(day.dayNumber)}</Text>
    <View style={[styles.mark, disabled && { opacity: 0 }]}><CompletenessMark status={day.completeness} /></View>
  </Pressable>;
}

export interface WeekDateRailProps {
  days: WeekDateRailDay[];
  selectedDate: string;
  rangeLabel: string;
  energyUnit?: 'kcal' | 'kJ' | undefined;
  onSelectDate: (date: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onOpenCalendar?: ((anchor: ComponentRef<typeof View>) => void) | undefined;
  trailing?: ReactNode;
  disableNext?: boolean | undefined;
  maxDate?: string | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

export function WeekDateRail({ days, selectedDate, rangeLabel, energyUnit = 'kcal', onSelectDate, onPrevWeek, onNextWeek, onOpenCalendar, trailing, disableNext, maxDate, style }: WeekDateRailProps) {
  const rangeAnchor = useRef<ComponentRef<typeof View>>(null);
  return <View style={[styles.rail, style]}>
    <View style={styles.head}>
      <Pressable ref={rangeAnchor} accessibilityRole="button" accessibilityLabel={`Choose date, ${rangeLabel}`} accessibilityHint="Opens the month calendar"
        onPress={() => { if (rangeAnchor.current) { hapticLight(); onOpenCalendar?.(rangeAnchor.current); } }} style={({ pressed }) => [styles.range, pressed && styles.pressed]}>
        <Text numberOfLines={1} style={styles.rangeText}>{rangeLabel}</Text><DoopIcon name="chevronDown" size={14} color={colors.muted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => { hapticSelection(); onPrevWeek(); }} style={styles.nav}><DoopIcon name="chevronLeft" size={18} color={colors.muted} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Next week" accessibilityState={{ disabled: !!disableNext }} disabled={disableNext} onPress={() => { hapticSelection(); onNextWeek(); }} style={[styles.nav, disableNext && { opacity: 0.34 }]}><DoopIcon name="chevronRight" size={18} color={colors.muted} /></Pressable>
      <View style={{ flex: 1 }} />{trailing}
    </View>
    <View style={styles.days}>{days.map(day => <RailTrendDayCell key={day.date} day={day} energyUnit={energyUnit} selected={day.date === selectedDate} disabled={maxDate ? day.date > maxDate : false} onPress={() => onSelectDate(day.date)} />)}</View>
  </View>;
}

export type CalendarDay = Pick<WeekDateRailDay, 'date' | 'completeness'>;
export interface RailMonthSheetProps {
  selectedDate: string;
  maxDate: string;
  days?: CalendarDay[] | undefined;
  loadMonth?: ((start: string, end: string) => Promise<CalendarDay[]>) | undefined;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}

/** Calendar content for the shared anchored date popover, grouped into explicit Mon–Sun week rows. */
export function RailMonthSheet({ selectedDate, maxDate, days = [], loadMonth, onSelectDate, onClose }: RailMonthSheetProps) {
  const [month, setMonth] = useState(() => selectedDate.slice(0, 7));
  const [loaded, setLoaded] = useState<CalendarDay[]>([]);
  const [loadError, setLoadError] = useState(false);
  const first = dateObject(`${month}-01`);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  const offset = (first.getDay() + 6) % 7;
  const totalSlots = Math.ceil((offset + last.getDate()) / 7) * 7;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - offset, 12);
  const gridEnd = new Date(first.getFullYear(), first.getMonth(), totalSlots - offset, 12);
  const gridStartIso = isoDate(gridStart);
  const gridEndIso = isoDate(gridEnd);

  useEffect(() => {
    let active = true;
    if (loadMonth) {
      void loadMonth(gridStartIso, gridEndIso)
        .then(value => { if (active) setLoaded(value); })
        .catch(() => { if (active) setLoadError(true); });
    }
    return () => { active = false; };
  }, [gridEndIso, gridStartIso, loadMonth]);

  const weeks: { weekStart: string; weekEnd: string; dates: { iso: string; day: number; inMonth: boolean }[] }[] = [];
  for (let w = 0; w < totalSlots / 7; w++) {
    const rowDates = Array.from({ length: 7 }, (_, col) => {
      const current = new Date(first.getFullYear(), first.getMonth(), 1 - offset + w * 7 + col, 12);
      const iso = isoDate(current);
      return { iso, day: current.getDate(), inMonth: iso.startsWith(month) };
    });
    weeks.push({
      weekStart: rowDates[0]!.iso,
      weekEnd: rowDates[6]!.iso,
      dates: rowDates,
    });
  }

  const selectedWeekEnd = weekEndForDate(selectedDate);
  const selectedWeekStart = (() => {
    const d = dateObject(selectedWeekEnd);
    d.setDate(d.getDate() - 6);
    return isoDate(d);
  })();
  const selectedDayLabel = dateObject(selectedDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const selectedWeekRange = railRangeLabel(selectedWeekStart, selectedWeekEnd);

  const step = (amount: number) => {
    hapticSelection();
    setLoaded([]); setLoadError(false);
    setMonth(isoDate(new Date(first.getFullYear(), first.getMonth() + amount, 1, 12)).slice(0, 7));
  };

  return <View style={styles.calendar}>
    <View style={styles.head}>
      <Text style={styles.monthTitle}>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => step(-1)} style={styles.nav}><DoopIcon name="chevronLeft" size={18} color={colors.muted} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={month >= maxDate.slice(0, 7)} accessibilityState={{ disabled: month >= maxDate.slice(0, 7) }} onPress={() => step(1)} style={[styles.nav, month >= maxDate.slice(0, 7) && { opacity: 0.34 }]}><DoopIcon name="chevronRight" size={18} color={colors.muted} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Close calendar" onPress={onClose} style={styles.nav}><DoopIcon name="close" size={16} color={colors.muted} /></Pressable>
    </View>
    <View style={styles.contextRow}>
      <Text style={styles.contextDay}>{selectedDayLabel}</Text>
      <Text style={styles.contextWeek}>{`Week · ${selectedWeekRange}`}</Text>
    </View>
    <View style={styles.weekdayRow}>
      {INITIALS.map((initial, i) => <Text key={i} style={styles.calendarInitial}>{initial}</Text>)}
    </View>
    <View style={styles.weeksWrap}>
      {weeks.map(week => {
        const isSelectedWeek = selectedDate >= week.weekStart && selectedDate <= week.weekEnd;
        return <View key={week.weekStart} style={[styles.weekRow, isSelectedWeek && styles.weekRowSelected]}>
          {week.dates.map(cell => {
            const isFuture = cell.iso > maxDate;
            const isSelected = cell.iso === selectedDate;
            const status = [...loaded, ...days].find(day => day.date === cell.iso)?.completeness ?? 'none';
            return <Pressable
              key={cell.iso}
              accessibilityRole="button"
              accessibilityLabel={`${cell.iso}, ${isFuture ? 'upcoming' : status === 'none' ? 'nothing logged' : status}`}
              accessibilityState={{ selected: isSelected, disabled: isFuture }}
              disabled={isFuture}
              onPress={() => { hapticSelection(); onSelectDate(cell.iso); }}
              style={[
                styles.calendarCell,
                isSelected && styles.calendarSelected,
                !cell.inMonth && !isSelected && styles.calendarOutside,
                isFuture && styles.calendarFuture,
              ]}
            >
              <Text style={[styles.calendarNumber, isSelected && styles.calendarNumberSelected, !cell.inMonth && !isSelected && styles.calendarNumberOutside]}>
                {cell.day}
              </Text>
              <View style={styles.calendarMarkSlot}>
                {!isFuture ? <CompletenessMark status={status} size={6} /> : null}
              </View>
            </Pressable>;
          })}
        </View>;
      })}
    </View>
    {loadError ? <Text accessibilityRole="alert" style={styles.calendarNote}>Log status unavailable</Text> : null}
    <Pressable accessibilityRole="button" onPress={() => { hapticSelection(); onSelectDate(maxDate); }} style={styles.latest}><Text style={[styles.rangeText, { color: colors.accent }]}>Latest week</Text></Pressable>
  </View>;
}

export const RailWeekPicker = WeekDateRail;
export type RailWeekPickerProps = WeekDateRailProps;

const styles = StyleSheet.create({
  rail: { width: '100%', gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  range: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, flexShrink: 1 },
  rangeText: { ...fontFace('semibold'), ...tabularNums, fontSize: 14, color: colors.ink },
  nav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  days: { flexDirection: 'row', width: '100%' },
  cell: { flex: 1, minWidth: 0, height: 84, paddingTop: 10, gap: 4, alignItems: 'center', borderWidth: 1, borderColor: 'transparent', borderRadius: 14 },
  cellSelected: { backgroundColor: colors.surface, borderColor: colors.hairline },
  initial: { ...fontFace('semibold'), fontSize: 11, lineHeight: 14, color: colors.muted },
  date: { ...fontFace('bold'), ...tabularNums, fontSize: 15, lineHeight: 20, color: colors.ink },
  mark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  calendar: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 8 },
  monthTitle: { ...fontFace('bold'), ...tabularNums, flex: 1, color: colors.ink, fontSize: 16, paddingLeft: 8 },
  contextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 8, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  contextDay: { ...fontFace('semibold'), ...tabularNums, fontSize: 12, color: colors.ink },
  contextWeek: { ...fontFace('semibold'), ...tabularNums, fontSize: 12, color: colors.accent },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: 2, marginBottom: 4 },
  calendarInitial: { ...fontFace('semibold'), flex: 1, height: 22, lineHeight: 22, textAlign: 'center', color: colors.muted, fontSize: 11 },
  weeksWrap: { gap: 4 },
  weekRow: { flexDirection: 'row', alignItems: 'center', padding: 2, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', backgroundColor: 'rgba(255,255,255,0.02)' },
  weekRowSelected: { backgroundColor: 'rgba(122,162,247,0.10)', borderColor: 'rgba(122,162,247,0.32)' },
  calendarCell: { flex: 1, height: 42, gap: 3, paddingTop: 5, alignItems: 'center', justifyContent: 'flex-start', borderRadius: 9, borderWidth: 1, borderColor: 'transparent' },
  calendarSelected: { backgroundColor: 'rgba(122,162,247,0.22)', borderColor: colors.accent },
  calendarOutside: { opacity: 0.42 },
  calendarFuture: { opacity: 0.3 },
  calendarNumber: { ...fontFace('semibold'), ...tabularNums, fontSize: 13, lineHeight: 16, color: colors.ink },
  calendarNumberSelected: { ...fontFace('bold'), color: colors.accent },
  calendarNumberOutside: { color: colors.muted },
  calendarMarkSlot: { height: 8, alignItems: 'center', justifyContent: 'center' },
  calendarNote: { ...fontFace('medium'), fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 4 },
  latest: { height: 44, marginTop: 8, borderTopWidth: 1, borderTopColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
});
