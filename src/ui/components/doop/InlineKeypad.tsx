import { useEffect, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  colors,
  fontFace,
  fontSize,
  fontWeight,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';

import { DoopIcon } from '../DoopIcons';
import { applyKeypadKey, formatDraftNumber } from '../../format';

export { applyKeypadKey };

const BACKSPACE = '⌫';
const DECIMAL = '.';

export interface LibV2UnitRailProps {
  units: string[];
  selectedUnit?: string | undefined;
  onSelectUnit: (unit: string) => void;
  onAddUnit?: (() => void) | undefined;
}

/** Horizontal pill rail for switching the unit a keypad edits. */
export function LibV2UnitRail({ units, selectedUnit, onSelectUnit, onAddUnit }: LibV2UnitRailProps) {
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
      {onAddUnit && <Pressable accessibilityRole="button" accessibilityLabel="More units" onPress={onAddUnit} style={styles.addUnit}><DoopIcon name="plus" size={14} color={colors.muted} /></Pressable>}
    </ScrollView>
  );
}

export interface InlineKeypadProps {
  value: string;
  onChange: (next: string) => void;
  units?: string[] | undefined;
  selectedUnit?: string | undefined;
  onSelectUnit?: ((unit: string) => void) | undefined;
  onAddUnit?: (() => void) | undefined;
  onDone?: (() => void) | undefined;
  doneLabel?: string | undefined;
  doneDisabled?: boolean | undefined;
  maxDecimals?: number | undefined;
  allowDecimal?: boolean | undefined;
  /** Optional character cap for numeric input (e.g. 5 for ml, 8 for quick add). */
  maxLength?: number | undefined;
  /** When true, backspacing the final digit returns `''` instead of `'0'`. */
  allowEmpty?: boolean | undefined;
  /** Preserve leading zeros as a literal digit string (e.g. barcodes). */
  digitString?: boolean | undefined;
  /** Hide the numeric readout when the surrounding panel already shows it. */
  showReadout?: boolean | undefined;
  /** Drop the card chrome so the keypad can sit inside another card. */
  bare?: boolean | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3', BACKSPACE],
  ['4', '5', '6', DECIMAL],
  ['7', '8', '9', '0'],
];

function clampDecimals(value: string, maxDecimals: number | undefined): string {
  if (maxDecimals == null || maxDecimals < 0) return value;
  const dot = value.indexOf('.');
  if (dot < 0) return value;
  const decimals = value.slice(dot + 1);
  if (decimals.length <= maxDecimals) return value;
  return value.slice(0, dot + 1 + maxDecimals);
}

/** Doop "LibV2" numeric keypad with an optional unit rail and done action. */
export function InlineKeypad({
  value,
  onChange,
  units,
  selectedUnit,
  onSelectUnit,
  onAddUnit,
  onDone,
  doneLabel,
  doneDisabled = false,
  maxDecimals,
  allowDecimal,
  maxLength,
  allowEmpty = false,
  digitString = false,
  showReadout,
  bare,
  style,
}: InlineKeypadProps) {
  const caretOpacity = useState(() => new Animated.Value(1))[0];
  useEffect(() => {
    const blink = Animated.loop(Animated.sequence([Animated.delay(550), Animated.timing(caretOpacity, { toValue: 0.12, duration: 0, useNativeDriver: true }), Animated.delay(500), Animated.timing(caretOpacity, { toValue: 1, duration: 0, useNativeDriver: true })]));
    blink.start(); return () => blink.stop();
  }, [caretOpacity]);
  const decimalLimit = maxDecimals != null && maxDecimals >= 0 ? maxDecimals : undefined;
  const acceptsDecimal = !digitString && allowDecimal !== false && (decimalLimit == null || decimalLimit > 0);
  const readoutVisible = showReadout !== false;
  const display = digitString ? (value || '—') : formatDraftNumber(value);
  const readoutLabel = selectedUnit ? `${display} ${selectedUnit}` : display;

  const handleKey = (key: string) => {
    if (key === DECIMAL && !acceptsDecimal) return;
    const raw = clampDecimals(applyKeypadKey(value, key, acceptsDecimal, allowEmpty, digitString), decimalLimit);
    if (maxLength != null && raw.length > maxLength && key !== BACKSPACE) return;
    onChange(raw);
  };

  return (
    <View style={bare === true ? [styles.cardBare, style] : [styles.card, style]}>
      {(readoutVisible || onDone != null || onSelectUnit != null) && (
        <View style={styles.readoutRow}>
          {readoutVisible ? (
            <View style={[styles.readoutValue, !(units != null && units.length > 0 && onSelectUnit != null) && styles.readoutValueGrow]}>
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
              <Animated.View style={[styles.caret, { opacity: caretOpacity }]} />
              {selectedUnit && !onSelectUnit ? <Text style={styles.readoutUnit}>{selectedUnit}</Text> : null}
            </View>
          ) : (
            <View style={styles.readoutSpacer} />
          )}
          {units != null && units.length > 0 && onSelectUnit != null && <LibV2UnitRail units={units} selectedUnit={selectedUnit} onSelectUnit={onSelectUnit} onAddUnit={onAddUnit} />}
          {onDone != null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={doneLabel ?? 'Done'}
              accessibilityState={{ disabled: doneDisabled }}
              disabled={doneDisabled}
              onPress={onDone}
              style={({ pressed }) => [styles.doneButton, doneDisabled && styles.doneButtonDisabled, pressed && styles.pressed]}
            >
              <Text style={styles.doneLabel}>{doneLabel ?? 'Done'}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={styles.grid}>
        {KEYPAD_ROWS.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.gridRow}>
            {row.map(key => {
              const decimalDisabled = key === DECIMAL && !acceptsDecimal;
              const muted = key === BACKSPACE;
              return (
                <Pressable
                  key={key}
                  disabled={decimalDisabled}
                  accessibilityRole="button"
                  accessibilityState={decimalDisabled ? { disabled: true } : undefined}
                  accessibilityLabel={
                    key === BACKSPACE ? 'Delete last digit' : key === DECIMAL ? 'Decimal point' : key
                  }
                  onPress={() => handleKey(key)}
                  style={({ pressed }) => [styles.key, decimalDisabled && styles.keyDisabled, pressed && styles.pressed]}
                >
                  {muted ? <DoopIcon name="backspace" size={18} color={colors.muted} /> : <Text style={[styles.keyLabel, decimalDisabled && styles.keyLabelMuted]}>{key}</Text>}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

export interface NumericEditorProps {
  value: string;
  onChange: (next: string) => void;
  unit?: string | undefined;
  units?: string[] | undefined;
  selectedUnit?: string | undefined;
  onSelectUnit?: ((unit: string) => void) | undefined;
  onAddUnit?: (() => void) | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  onClear?: (() => void) | undefined;
  confirmDisabled?: boolean | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  clearLabel?: string | undefined;
  headerRight?: React.ReactNode | undefined;
  hint?: string | undefined;
  allowDecimal?: boolean | undefined;
  maxDecimals?: number | undefined;
  maxLength?: number | undefined;
  allowEmpty?: boolean | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/**
 * Shared inline numeric editor shell: readout with accent caret, confirm/cancel icon
 * buttons, optional unit rail or trailing switch, and the bare 3x4 InlineKeypad grid.
 */
export function NumericEditor({
  value,
  onChange,
  unit,
  units,
  selectedUnit,
  onSelectUnit,
  onAddUnit,
  onConfirm,
  onCancel,
  onClear,
  confirmDisabled = false,
  confirmLabel = 'Confirm value',
  cancelLabel = 'Cancel',
  clearLabel = 'Clear',
  headerRight,
  hint,
  allowDecimal = true,
  maxDecimals,
  maxLength,
  allowEmpty = true,
  style,
}: NumericEditorProps) {
  const display = formatDraftNumber(value);
  const shownUnit = selectedUnit ?? unit;
  return (
    <View style={[styles.editorRoot, style]}>
      <View style={styles.editorRow}>
        <View style={styles.editorReadout}>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={shownUnit ? `${display} ${shownUnit}` : display}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            style={[styles.editorValue, value === '' && styles.editorPlaceholder]}
          >
            {display}
          </Text>
          <View style={styles.editorCaret} />
          {shownUnit && !onSelectUnit ? <Text style={styles.editorUnit}>{shownUnit}</Text> : null}
        </View>
        {headerRight}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          accessibilityState={{ disabled: confirmDisabled }}
          disabled={confirmDisabled}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.editorBtn,
            styles.editorConfirmBtn,
            confirmDisabled && styles.doneButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          <DoopIcon name="check" size={18} color={colors.onAccent} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={onCancel}
          style={({ pressed }) => [styles.editorBtn, pressed && styles.pressed]}
        >
          <DoopIcon name="close" size={16} color={colors.muted} />
        </Pressable>
      </View>
      {units != null && units.length > 0 && onSelectUnit != null ? (
        <LibV2UnitRail units={units} selectedUnit={selectedUnit} onSelectUnit={onSelectUnit} onAddUnit={onAddUnit} />
      ) : null}
      <View style={styles.editorKeypadWrap}>
        <InlineKeypad
          bare
          showReadout={false}
          value={value}
          onChange={onChange}
          allowDecimal={allowDecimal}
          maxDecimals={maxDecimals}
          maxLength={maxLength}
          allowEmpty={allowEmpty}
        />
      </View>
      {(hint || onClear) ? (
        <View style={styles.editorFooter}>
          {hint ? <Text style={styles.editorHint}>{hint}</Text> : <View style={{ flex: 1 }} />}
          {onClear ? (
            <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} onPress={onClear} style={styles.editorClearBtn}>
              <Text style={styles.editorClearText}>{clearLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Doop design-system alias. */
export const LibV2Keypad = InlineKeypad;
export type LibV2KeypadProps = InlineKeypadProps;

const styles = StyleSheet.create({
  caret: { width: 2, height: 26, borderRadius: 1, backgroundColor: colors.accent },
  addUnit: { width: 40, height: 40, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.r20,
    padding: spacing.s12,
    gap: spacing.s12,
  },
  cardBare: {
    gap: 6,
  },
  readoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s8,
    minHeight: MIN_TOUCH_TARGET,
  },
  readoutValue: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s6,
    minWidth: 0,
  },
  readoutValueGrow: { flex: 1 },
  readoutSpacer: { flex: 1 },
  readoutNumber: {
    color: colors.ink,
    fontSize: fontSize.t32,
    ...fontFace('bold'),
    fontVariant: [...tabularNums.fontVariant],
  },
  readoutUnit: {
    color: colors.muted,
    fontSize: fontSize.t11,
    ...fontFace('semibold'),
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
  doneButtonDisabled: { opacity: 0.4 },
  doneLabel: {
    color: colors.onAccent,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.bold,
  },
  unitRail: { flex: 1, minWidth: 0 },
  unitRailContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 0,
  },
  unitPill: {
    height: 40,
    minWidth: 34,
    paddingHorizontal: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitPillSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  unitPillLabel: {
    color: colors.muted,
    fontSize: fontSize.t11,
    ...fontFace('semibold'),
    fontVariant: [...tabularNums.fontVariant],
  },
  unitPillLabelSelected: {
    color: colors.onAccent,
    fontWeight: fontWeight.bold,
  },
  grid: { gap: 4 },
  gridRow: { flexDirection: 'row', gap: 4 },
  key: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDisabled: { opacity: 0.3 },
  keyLabel: {
    color: colors.ink,
    fontSize: fontSize.t16,
    ...fontFace('semibold'),
    fontVariant: [...tabularNums.fontVariant],
  },
  keyLabelMuted: { color: colors.muted },
  pressed: { opacity: 0.65 },
  editorRoot: { gap: 10 },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editorReadout: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  editorValue: { ...fontFace('extrabold'), ...tabularNums, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.ink },
  editorPlaceholder: { color: colors.muted },
  editorCaret: { width: 2, height: 24, borderRadius: 1, backgroundColor: colors.accent, alignSelf: 'center' },
  editorUnit: { ...fontFace('medium'), fontSize: 13, color: colors.muted, marginLeft: 2 },
  editorBtn: { width: 40, height: 40, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  editorConfirmBtn: { backgroundColor: colors.accent, borderColor: colors.accent },
  editorKeypadWrap: { paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.hairline },
  editorFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  editorHint: { ...fontFace('medium'), fontSize: fontSize.t11, color: colors.muted, flex: 1 },
  editorClearBtn: { minHeight: 36, paddingHorizontal: 8, justifyContent: 'center' },
  editorClearText: { ...fontFace('semibold'), fontSize: fontSize.t12, color: colors.muted },
});
