/**
 * Reusable Doop Tokyo Night primitives.
 *
 * Every component is presentational: it takes plain props, renders with the
 * shared token set, and never reaches into app state or persistence.
 */
export { applyKeypadKey, InlineKeypad, LibV2Keypad, LibV2UnitRail } from './InlineKeypad';
export type {
  InlineKeypadProps,
  LibV2KeypadProps,
  LibV2UnitRailProps,
} from './InlineKeypad';

export { CompletenessMark, RailTrendDayMark } from './CompletenessMark';
export type {
  CompletenessMarkProps,
  CompletenessStatus,
  RailTrendDayMarkProps,
} from './CompletenessMark';

export { RailTrendDayCell, RailWeekPicker, WeekDateRail } from './WeekDateRail';
export type {
  RailTrendDayCellProps,
  RailWeekPickerProps,
  WeekDateRailDay,
  WeekDateRailProps,
} from './WeekDateRail';

export { CalorieBarChart, ProgDayPop, ProgTrendPop, WeightTrendChart } from './ProgressCharts';
export type {
  CalorieBarChartDay,
  CalorieBarChartProps,
  ProgDayPopProps,
  ProgTrendPopProps,
  WeightTrendChartProps,
  WeightTrendPoint,
} from './ProgressCharts';

export {
  BarSourceChip,
  LearnedPortionChips,
  LibV2MacroBar,
  LibV2PortionChip,
  MacroProportionBar,
  SourceBadge,
} from './PortionAndMacro';
export type {
  BarSourceChipProps,
  LearnedPortion,
  LearnedPortionChipsProps,
  LibV2MacroBarProps,
  LibV2PortionChipProps,
  MacroProportionBarProps,
  SourceBadgeProps,
  SourceTone,
} from './PortionAndMacro';

export {
  ActionSheetPopover,
  MultiSelectBar,
  QuickAddPanel,
  RailSelectBar,
} from './HistoryControls';
export type {
  ActionSheetPopoverAction,
  ActionSheetPopoverProps,
  ActionSheetTone,
  MultiSelectBarProps,
  QuickAddEntry,
  QuickAddPanelProps,
  RailSelectBarProps,
} from './HistoryControls';
