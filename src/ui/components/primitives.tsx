import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontSize, fontWeight, MIN_TOUCH_TARGET, radius, SCREEN_GUTTER, spacing, tabularNums } from '../tokens';
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  content: { padding: SCREEN_GUTTER, gap: spacing.s20, paddingBottom: spacing.s32, width: '100%', maxWidth: 840, alignSelf: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.r16, padding: spacing.s16, gap: spacing.s12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.s12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s8 },
  text: { color: colors.ink, fontSize: fontSize.t14, fontVariant: [...tabularNums.fontVariant] },
  muted: { color: colors.muted, fontSize: fontSize.t12, lineHeight: 19, fontVariant: [...tabularNums.fontVariant] },
  title: { color: colors.ink, fontSize: fontSize.t28, fontWeight: fontWeight.bold, flexShrink: 1 },
  heading: { color: colors.ink, fontSize: fontSize.t16, fontWeight: fontWeight.bold, fontVariant: [...tabularNums.fontVariant] },
  number: { ...tabularNums, fontVariant: [...tabularNums.fontVariant], color: colors.ink },
  input: { minHeight: MIN_TOUCH_TARGET, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r8,
    backgroundColor: colors.raised, color: colors.ink, paddingHorizontal: spacing.s12, paddingVertical: spacing.s10, fontSize: fontSize.t14 },
  button: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.r8, paddingHorizontal: spacing.s12, paddingVertical: spacing.s10, backgroundColor: colors.raised },
  divider: { height: 1, backgroundColor: colors.hairline },
});
export function Page({ title, action, footer, children, compact = false }: React.PropsWithChildren<{ title?: string; action?: React.ReactNode; footer?: React.ReactNode; compact?: boolean }>) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={ui.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[ui.content, compact && { gap: spacing.s12, paddingTop: spacing.s8 }]}>
    {(title || action) && <View style={[ui.row, { justifyContent: 'space-between' }]}>{title && <Text accessibilityRole="header" style={ui.title}>{title}</Text>}{action}</View>}{children}
  </ScrollView>{footer && <View style={{ paddingHorizontal: SCREEN_GUTTER, paddingBottom: spacing.s8, width: '100%', maxWidth: 840, alignSelf: 'center' }}>{footer}</View>}</SafeAreaView>;
}
export function Card({ children, style }: React.PropsWithChildren<{ style?: ViewStyle }>) { return <View style={[ui.card, style]}>{children}</View>; }
export function Label({ children, style }: React.PropsWithChildren<{ style?: TextStyle }>) { return <Text style={[ui.text, style]}>{children}</Text>; }
export function Muted({ children }: React.PropsWithChildren) { return <Text style={ui.muted}>{children}</Text>; }
export function Heading({ children }: React.PropsWithChildren) { return <Text accessibilityRole="header" style={ui.heading}>{children}</Text>; }
export function Button({ label, onPress, primary = false, selected = false, disabled = false, accessibilityLabel, quiet = false }: {
  label: string; onPress: () => void; primary?: boolean; selected?: boolean; disabled?: boolean; accessibilityLabel?: string; quiet?: boolean;
}) { return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled, selected }}
  disabled={disabled} onPress={onPress} style={({ pressed }) => [ui.button, quiet && { backgroundColor: 'transparent', paddingHorizontal: spacing.s8 }, (primary || selected) && { backgroundColor: colors.accent }, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
  <Text style={[ui.number, { color: primary || selected ? colors.onAccent : colors.ink, fontWeight: fontWeight.semibold }]}>{label}</Text></Pressable>; }
export function Input({ label, ...props }: TextInputProps & { label: string }) { return <View style={{ gap: spacing.s6 }}><Muted>{label}</Muted>
  <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} {...props} style={[ui.input, ui.number, props.style]} /></View>; }
export function ErrorMessage({ message }: { message?: string | null }) { return message ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{message}</Text> : null; }
export function Badge({ label }: { label: string }) { return <Text style={{ color: colors.muted, backgroundColor: colors.raised,
  borderRadius: radius.r8, paddingHorizontal: spacing.s8, paddingVertical: spacing.s4, fontSize: fontSize.t11 }}>{label}</Text>; }
export const number = (value: number | null | undefined, digits = 0) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
export const energyValue = (kcal: number | null | undefined, unit: 'kcal' | 'kJ' = 'kcal') => kcal == null ? null : kcal * (unit === 'kJ' ? 4.184 : 1);
export const energy = (kcal: number | null | undefined, unit: 'kcal' | 'kJ' = 'kcal') => `${number(energyValue(kcal, unit))} ${unit}`;
