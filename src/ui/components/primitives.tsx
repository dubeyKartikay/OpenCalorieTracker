import React, { useCallback, useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { router, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFace, fontSize, MIN_TOUCH_TARGET, radius, SCREEN_GUTTER, spacing, tabularNums, useLayoutClass } from '../tokens';
import { RevealPanel } from './doop/Motion';
import { DoopIcon, type DoopIconName } from './DoopIcons';

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  content: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingTop: spacing.s12,
    paddingBottom: spacing.s32,
    gap: spacing.s16,
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
  },
  card: { backgroundColor: colors.surface, borderRadius: radius.r16, padding: spacing.s16, gap: spacing.s12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.s12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s8 },
  text: { ...fontFace('medium'), color: colors.ink, fontSize: fontSize.t14, fontVariant: [...tabularNums.fontVariant] },
  muted: { ...fontFace('medium'), color: colors.muted, fontSize: fontSize.t12, lineHeight: 18, fontVariant: [...tabularNums.fontVariant] },
  title: { ...fontFace('bold'), color: colors.ink, fontSize: fontSize.t20, letterSpacing: -0.3, flexShrink: 1 },
  heading: { ...fontFace('bold'), color: colors.ink, fontSize: fontSize.t16, fontVariant: [...tabularNums.fontVariant] },
  number: { ...fontFace('medium'), ...tabularNums, fontVariant: [...tabularNums.fontVariant], color: colors.ink },
  input: {
    ...fontFace('medium'),
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r12,
    backgroundColor: colors.raised,
    color: colors.ink,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    fontSize: fontSize.t14,
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.r12,
    paddingHorizontal: spacing.s16,
    paddingVertical: spacing.s10,
    backgroundColor: colors.raised,
  },
  divider: { height: 1, backgroundColor: colors.hairline },
});

/** Tracks the active soft keyboard height on both iOS and Android (needed for Android 15+ edge-to-edge ScrollViews). */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, event => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return keyboardHeight;
}

export function Page({
  title,
  action,
  footer,
  overlay,
  stage,
  children,
  compact = false,
  scrollRef,
  scrollEnabled = true,
  contentPointerEvents = 'auto',
  onScroll,
}: React.PropsWithChildren<{
  title?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  overlay?: React.ReactNode;
  stage?: React.ReactNode;
  compact?: boolean;
  scrollRef?: React.RefObject<React.ComponentRef<typeof ScrollView> | null>;
  scrollEnabled?: boolean;
  contentPointerEvents?: 'auto' | 'none';
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}>) {
  const { isExpanded } = useLayoutClass();
  const maxWidth = isExpanded ? 1080 : 540;
  const keyboardHeight = useKeyboardHeight();
  const contentHidden = contentPointerEvents === 'none';
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={ui.screen}>
      <ScrollView
        ref={scrollRef}
        scrollEnabled={scrollEnabled}
        pointerEvents={contentPointerEvents}
        importantForAccessibility={contentHidden ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={contentHidden}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          ui.content,
          { maxWidth },
          compact && { gap: spacing.s12, paddingTop: spacing.s8 },
          keyboardHeight > 0 && { paddingBottom: spacing.s32 + keyboardHeight },
        ]}
      >
        {(title || action) && (
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            {title && (
              <Text accessibilityRole="header" style={ui.title}>
                {title}
              </Text>
            )}
            {action}
          </View>
        )}
        {children}
      </ScrollView>
      {footer && (
        <View
          style={{
            paddingHorizontal: SCREEN_GUTTER,
            paddingBottom: spacing.s8,
            width: '100%',
            maxWidth,
            alignSelf: 'center',
          }}
        >
          {footer}
        </View>
      )}
      {stage}
      {overlay && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: spacing.s8,
            paddingHorizontal: SCREEN_GUTTER,
            alignItems: 'center',
          }}
        >
          <View pointerEvents="box-none" style={{ width: '100%', maxWidth: maxWidth - SCREEN_GUTTER * 2 }}>
            {overlay}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

/** Exact Doop centered page header with left back chevron and optional right control. */
export function BackHeader({
  title,
  titleContent,
  subtitle,
  onBack,
  backIcon = 'back',
  backLabel = 'Back',
  right,
}: {
  title: string;
  titleContent?: React.ReactNode;
  subtitle?: string;
  onBack: () => void;
  backIcon?: DoopIconName;
  backLabel?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            marginLeft: -12,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <DoopIcon name={backIcon} size={20} color={colors.muted} strokeWidth={1.8} />
        </Pressable>
        {titleContent ? (
          <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>
            {titleContent}
          </View>
        ) : (
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[
              fontFace('bold'),
              {
                flex: 1,
                textAlign: 'center',
                fontSize: fontSize.t20,
                color: colors.ink,
                letterSpacing: -0.3,
              },
            ]}
          >
            {title}
          </Text>
        )}
        <View style={{ width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' }}>
          {right ?? null}
        </View>
      </View>
      {subtitle ? (
        <Text style={[fontFace('medium'), { textAlign: 'center', fontSize: fontSize.t12, color: colors.muted }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Exact Doop quiet section heading with horizontal hairline rule extending across. */
export function SectionRule({
  label,
  uppercase = false,
  meta,
}: {
  label: string;
  uppercase?: boolean;
  meta?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text
        style={[
          fontFace('semibold'),
          {
            fontSize: uppercase ? fontSize.t10 : fontSize.t12,
            color: colors.muted,
            letterSpacing: uppercase ? 0.8 : 0.1,
            textTransform: uppercase ? 'uppercase' : 'none',
          },
        ]}
      >
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.hairline }} />
      {typeof meta === 'string' ? (
        <Text style={[fontFace('medium'), tabularNums, { fontSize: fontSize.t11, color: colors.muted }]}>{meta}</Text>
      ) : (
        meta ?? null
      )}
    </View>
  );
}

/** Exact Doop dotted-underline tappable numeric value (Settings targets, Recipe yield/amounts, Library portion). */
export function DottedValue({
  value,
  unit,
  onPress,
  active = false,
  size = fontSize.t18,
  accessibilityLabel,
}: {
  value: string;
  unit?: string;
  onPress?: () => void;
  active?: boolean;
  size?: number;
  accessibilityLabel?: string;
}) {
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <View
        style={{
          borderBottomWidth: 1.25,
          borderStyle: 'dotted',
          borderBottomColor: active ? colors.accent : colors.border,
          paddingBottom: 2,
        }}
      >
        <Text
          style={[
            fontFace('bold'),
            tabularNums,
            { fontSize: size, color: active ? colors.accent : colors.ink, letterSpacing: -0.3 },
          ]}
        >
          {value}
        </Text>
      </View>
      {unit ? (
        <Text style={[fontFace('medium'), { fontSize: fontSize.t12, color: colors.muted }]}>{unit}</Text>
      ) : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${value} ${unit ?? ''}`.trim()}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
    >
      {inner}
    </Pressable>
  );
}

export function Card({ children, style }: React.PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[ui.card, style]}>{children}</View>;
}

export function Label({ children, style }: React.PropsWithChildren<{ style?: TextStyle }>) {
  return <Text style={[ui.text, style]}>{children}</Text>;
}

export function Muted({ children, style }: React.PropsWithChildren<{ style?: TextStyle }>) {
  return <Text style={[ui.muted, style]}>{children}</Text>;
}

export function Heading({ children, style }: React.PropsWithChildren<{ style?: TextStyle }>) {
  return (
    <Text accessibilityRole="header" style={[ui.heading, style]}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  primary = false,
  selected = false,
  disabled = false,
  accessibilityLabel,
  quiet = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        quiet && { backgroundColor: 'transparent', paddingHorizontal: spacing.s8 },
        (primary || selected) && { backgroundColor: colors.accent },
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text
        style={[
          fontFace('semibold'),
          tabularNums,
          { fontSize: fontSize.t14, color: primary || selected ? colors.onAccent : colors.ink },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Input({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: spacing.s6 }}>
      <Muted>{label}</Muted>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[ui.input, ui.number, props.style]}
      />
    </View>
  );
}

export function ErrorMessage({ message }: { message?: string | null }) {
  return message ? (
    <Text accessibilityRole="alert" style={[fontFace('medium'), { color: colors.danger, fontSize: fontSize.t13 }]}>
      {message}
    </Text>
  ) : null;
}

export function Badge({ label }: { label: string }) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.hairline,
        borderRadius: radius.full,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: 'transparent',
      }}
    >
      <Text style={[fontFace('semibold'), { color: colors.muted, fontSize: fontSize.t10, letterSpacing: 0.3 }]}>
        {label}
      </Text>
    </View>
  );
}

/** Shared safe back navigation for screens that may be opened via deep link or direct replace. */
export function goBackOrReplace(fallback: Href = '/(tabs)') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** Auto-dismissing notice state shared across diary and library tabs. */
export function useTimedNotice(durationMs = 3200): [string, (next: string) => void] {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, notice]);
  const update = useCallback((next: string) => setNotice(next), []);
  return [notice, update];
}

/** Shared animated dismissible notice pill used across Today, History, and Library. */
export function NoticePill({ message, onDismiss, style }: { message: string; onDismiss: () => void; style?: ViewStyle }) {
  return (
    <RevealPanel visible={Boolean(message)} direction="down" style={style}>
      {message ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notice"
          onPress={onDismiss}
          style={noticeStyles.pill}
        >
          <Text accessibilityLiveRegion="polite" style={[ui.muted, noticeStyles.text]}>
            {message}
          </Text>
          <DoopIcon name="close" size={13} color={colors.muted} />
        </Pressable>
      ) : null}
    </RevealPanel>
  );
}

const noticeStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s8,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s8,
    borderRadius: radius.r12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  text: { flex: 1 },
});

export {
  energy,
  energyValue,
  formatDraftNumber,
  formatShortDate,
  formatWeekdayDate,
  number,
  toCanonicalKcal,
} from '../format';
