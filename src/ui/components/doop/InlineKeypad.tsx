import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

const DIGITS = '0123456789';
const BACKSPACE = '⌫';
const DECIMAL = '.';

export interface LibV2UnitRailProps {
  units: string[];
  selectedUnit?: string | undefined;
  onSelectUnit: (unit: string) => void;
}

/** Horizontal pill rail for switching the unit a keypad edits. */
export function LibV2UnitRail({ units, selectedUnit, onSelectUnit }: LibV2UnitRailProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.unitRail}
      contentContainerStyle={styles.unitRailContent}
    >
      {units.map(unit => {
        const selected = unit === selectedUnit;
        return (
          <Pressable
            key={unit}
            accessibilityRole="button"
            accessibilityLabel={`Use ${unit}`}
            accessibilityState={{ selected }}
            onPress={() => onSelectUnit(unit)}
            style={({ pressed }) => [
              styles.unitPill,
              selected && styles.unitPillSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.unitPillLabel, selected && styles.unitPillLabelSelected]}>
              {unit}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export interface InlineKeypadProps {
  value: string;
  onChange: (next: string) => void;
  units?: string[] | undefined;
  selectedUnit?: string | undefined;
  onSelectUnit?: ((unit: string) => void) | undefined;
  onDone?: (() => void) | undefined;
  doneLabel?: string | undefined;
  maxDecimals?: number | undefined;
  allowDecimal?: boolean | undefined;
  /** Hide the numeric readout when the surrounding panel already shows it. */
  showReadout?: boolean | undefined;
  /** Drop the card chrome so the keypad can sit inside another card. */
  bare?: boolean | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [DECIMAL, '0', BACKSPACE],
];

/** Group the integer part without disturbing a decimal that is still being typed. */
function formatReadout(value: string): string {
  if (value === '' || value === '.') return '0';
  const dot = value.indexOf('.');
  const whole = dot < 0 ? value : value.slice(0, dot);
  const fraction = dot < 0 ? '' : value.slice(dot + 1);
  const grouped = whole === '' ? '0' : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dot < 0 ? grouped : `${grouped}.${fraction}`;
}

function clampDecimals(value: string, maxDecimals: number | undefined): string {
  if (maxDecimals == null || maxDecimals < 0) return value;
  const dot = value.indexOf('.');
  if (dot < 0) return value;
  const decimals = value.slice(dot + 1);
  if (decimals.length <= maxDecimals) return value;
  return value.slice(0, dot + 1 + maxDecimals);
}

/**
 * Pure numeric-entry state machine shared by every keypad surface.
 * Leading zeros collapse, a second decimal point is ignored, and backspace
 * bottoms out at `0` so the readout is always parseable.
 */
export function applyKeypadKey(current: string, key: string, allowDecimal = true): string {
  const base = current.replace(/^0+(?=\d)/, '');

  if (key === BACKSPACE) {
    const trimmed = base.slice(0, -1);
    return trimmed === '' ? '0' : trimmed;
  }

  if (key === DECIMAL) {
    if (!allowDecimal || base.includes(DECIMAL)) return base;
    return base === '' ? '0.' : `${base}.`;
  }

  if (key.length !== 1 || !DIGITS.includes(key)) return base;

  if (base === '' || base === '0') return key;
  return `${base}${key}`;
}

/** Doop "LibV2" numeric keypad with an optional unit rail and done action. */
export function InlineKeypad({
  value,
  onChange,
  units,
  selectedUnit,
  onSelectUnit,
  onDone,
  doneLabel,
  maxDecimals,
  allowDecimal,
  showReadout,
  bare,
  style,
}: InlineKeypadProps) {
  const decimalLimit = maxDecimals != null && maxDecimals >= 0 ? maxDecimals : undefined;
  const acceptsDecimal = allowDecimal !== false && (decimalLimit == null || decimalLimit > 0);
  const readoutVisible = showReadout !== false;
  const display = formatReadout(value);
  const readoutLabel = selectedUnit ? `${display} ${selectedUnit}` : display;

  const handleKey = (key: string) => {
    if (key === DECIMAL && !acceptsDecimal) return;
    onChange(clampDecimals(applyKeypadKey(value, key, acceptsDecimal), decimalLimit));
  };

  return (
    <View style={bare === true ? [styles.cardBare, style] : [styles.card, style]}>
      {(readoutVisible || onDone != null) && (
        <View style={styles.readoutRow}>
          {readoutVisible ? (
            <View style={styles.readoutValue}>
              <Text
                accessibilityLabel={readoutLabel}
                accessibilityLiveRegion="polite"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={styles.readoutNumber}
              >
                {display}
              </Text>
              {selectedUnit ? <Text style={styles.readoutUnit}>{selectedUnit}</Text> : null}
            </View>
          ) : (
            <View style={styles.readoutSpacer} />
          )}
          {onDone != null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={doneLabel ?? 'Done'}
              onPress={onDone}
              style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
            >
              <Text style={styles.doneLabel}>{doneLabel ?? 'Done'}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {units != null && units.length > 0 && onSelectUnit != null ? (
        <LibV2UnitRail
          units={units}
          selectedUnit={selectedUnit}
          onSelectUnit={onSelectUnit}
        />
      ) : null}

      <View style={styles.grid}>
        {KEYPAD_ROWS.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.gridRow}>
            {row.map(key => {
              const muted = key === BACKSPACE;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={
                    key === BACKSPACE ? 'Delete last digit' : key === DECIMAL ? 'Decimal point' : key
                  }
                  onPress={() => handleKey(key)}
                  style={({ pressed }) => [styles.key, pressed && styles.pressed]}
                >
                  <Text style={[styles.keyLabel, muted && styles.keyLabelMuted]}>{key}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Doop design-system alias. */
export const LibV2Keypad = InlineKeypad;
export type LibV2KeypadProps = InlineKeypadProps;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.r20,
    padding: spacing.s12,
    gap: spacing.s12,
  },
  cardBare: {
    gap: spacing.s8,
  },
  readoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s8,
    minHeight: MIN_TOUCH_TARGET,
  },
  readoutValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s6,
    minWidth: 0,
  },
  readoutSpacer: { flex: 1 },
  readoutNumber: {
    color: colors.ink,
    fontSize: fontSize.t32,
    fontWeight: fontWeight.extrabold,
    fontVariant: [...tabularNums.fontVariant],
  },
  readoutUnit: {
    color: colors.muted,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  doneButton: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.s16,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneLabel: {
    color: colors.onAccent,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.bold,
  },
  unitRail: { flexGrow: 0 },
  unitRailContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s8,
    paddingRight: spacing.s4,
  },
  unitPill: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.s16,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitPillSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  unitPillLabel: {
    color: colors.muted,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  unitPillLabelSelected: {
    color: colors.onAccent,
    fontWeight: fontWeight.bold,
  },
  grid: { gap: spacing.s6 },
  gridRow: { flexDirection: 'row', gap: spacing.s6 },
  key: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {
    color: colors.ink,
    fontSize: fontSize.t20,
    fontWeight: fontWeight.semibold,
    fontVariant: [...tabularNums.fontVariant],
  },
  keyLabelMuted: { color: colors.muted },
  pressed: { opacity: 0.65 },
});
