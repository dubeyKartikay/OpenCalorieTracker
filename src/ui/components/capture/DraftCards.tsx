import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFace, radius, tabularNums } from '../../tokens';
import { DoopIcon, mealDaypartGlyph } from '../DoopIcons';
import { Button, Input, Muted, ui } from '../primitives';

export interface SparklePromptRowProps {
  summary: string;
  onPress: () => void;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
}
export function SparklePromptRow({ summary, onPress, busy, disabled }: SparklePromptRowProps) {
  return <Pressable accessibilityRole="button" accessibilityLabel={summary} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.sparkleRow, pressed && styles.pressed]}>
    <DoopIcon name="sparkle" size={17} color={colors.lavender} /><Text numberOfLines={1} style={styles.sparkleSummary}>{summary}</Text><Text style={styles.sparkleEnd}>{busy ? '…' : '↵'}</Text>
  </Pressable>;
}
export type DraftPortionCertainty = 'stated' | 'estimated';
export interface DraftItemCardProps {
  name: string;
  sourceLabel: string;
  isEstimatedSource?: boolean | undefined;
  portionText: string;
  portionCertainty: DraftPortionCertainty;
  estimateRangeText?: string | null | undefined;
  energyText: string;
  macrosText?: string | undefined;
  fiberUnknown?: boolean | undefined;
  onPressEdit?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  currentAmount?: number | undefined;
  currentUnit?: string | undefined;
  onChangeAmount?: ((nextAmount: number) => void) | undefined;
}
export function DraftItemCard({ name, sourceLabel, isEstimatedSource, portionText, portionCertainty, estimateRangeText, energyText, macrosText, fiberUnknown, onPressEdit, onRemove, currentAmount, currentUnit, onChangeAmount }: DraftItemCardProps) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const estimated = portionCertainty === 'estimated';
  const toggleEdit = () => { if (onPressEdit) onPressEdit(); else if (onChangeAmount) { setAmount(String(currentAmount ?? '')); setEditing(value => !value); } };
  return <View style={styles.item}>
    <View style={styles.itemRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${name}`} disabled={!onPressEdit && !onChangeAmount} onPress={toggleEdit} style={styles.itemCopy}>
        <View style={styles.nameRow}><Text numberOfLines={1} style={styles.name}>{name}</Text><View style={styles.badge}><Text numberOfLines={1} style={styles.badgeText}>{isEstimatedSource ? 'AI ESTIMATE' : /^ifct/i.test(sourceLabel) ? 'IFCT' : sourceLabel.toUpperCase()}</Text></View></View>
        <View style={styles.portionRow}><View style={[styles.dot, estimated && styles.estimateDot]} /><Text numberOfLines={1} style={styles.portion}>{estimated && estimateRangeText ? estimateRangeText : portionText}</Text></View>
      </Pressable>
      <Text style={styles.itemEnergy}>{estimated && !/^[≈~]/.test(energyText) ? '≈' : ''}{energyText}</Text>
      {onRemove && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} onPress={onRemove} style={styles.iconButton}><DoopIcon name="close" size={14} color={colors.muted} /></Pressable>}
    </View>
    {editing && onChangeAmount && <View style={styles.editBlock}>
      <Input label={`Amount${currentUnit ? ` (${currentUnit})` : ''}`} value={amount} keyboardType="decimal-pad" onChangeText={next => { setAmount(next); const value = Number(next.trim().replace(',', '.')); if (next.trim() && Number.isFinite(value) && value > 0) onChangeAmount(value); }} />
      {macrosText && <Muted>{macrosText}</Muted>}{fiberUnknown && <Muted>Fiber unknown</Muted>}
      <Button label="Done" quiet onPress={() => setEditing(false)} />
    </View>}
  </View>;
}
export interface DraftAskOption { id: string; label: string; selected?: boolean | undefined }
export interface DraftAskChipsProps { questionId: string; label: string; options: DraftAskOption[]; onSelect: (questionId: string, optionId: string) => void }
export function DraftAskChips({ questionId, label, options, onSelect }: DraftAskChipsProps) {
  return <View style={styles.askRow} accessibilityRole="radiogroup" accessibilityLabel={label}><Text style={styles.askLabel}>{label.replace(/:$/, '')}:</Text>
    <View style={styles.askOptions}>{options.map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: !!option.selected }} onPress={() => onSelect(questionId, option.id)} style={styles.chipTouch}>
      <View style={[styles.chip, option.selected && styles.chipSelected]}><Text style={[styles.chipLabel, option.selected && { color: colors.lavender }]}>{option.label}</Text></View>
    </Pressable>)}</View>
  </View>;
}
export interface MealDraftPanelProps {
  mealLabel: string;
  draftEnergyText: string;
  loggedEnergyText?: string | undefined;
  photoUri?: string | null | undefined;
  fiberNote?: string | null | undefined;
  itemCount: number;
  onConfirmAll: () => void;
  onDismissAll: () => void;
  confirming?: boolean | undefined;
  children?: ReactNode | undefined;
  onSaveAsMeal?: ((name: string) => void) | undefined;
}
export function MealDraftPanel({ mealLabel, draftEnergyText, loggedEnergyText = '—', photoUri, fiberNote, itemCount, onConfirmAll, onDismissAll, confirming, children, onSaveAsMeal }: MealDraftPanelProps) {
  const [naming, setNaming] = useState(false);
  const [mealName, setMealName] = useState('');
  const [disclosure, setDisclosure] = useState(true);
  return <View>
    <View style={styles.panelHead}>
      <View style={styles.node}><DoopIcon name={mealDaypartGlyph(mealLabel)} size={27} color={colors.ink} /></View>
      <Text numberOfLines={1} style={styles.mealName}>{mealLabel}</Text>
      <Text style={styles.loggedEnergy}>{loggedEnergyText}</Text><Text accessibilityLabel={`Draft total ${draftEnergyText}`} style={styles.draftEnergy}>+{draftEnergyText}</Text>
      {onSaveAsMeal && <Pressable accessibilityRole="button" accessibilityLabel="Save this set as a meal" disabled={confirming} onPress={() => setNaming(value => !value)} style={styles.iconButton}><DoopIcon name="pin" size={17} color={naming ? colors.lavender : colors.muted} /></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Confirm to ${mealLabel}`} accessibilityState={{ disabled: !!confirming || itemCount === 0, busy: !!confirming }} disabled={confirming || itemCount === 0} onPress={onConfirmAll} style={[styles.confirm, (confirming || itemCount === 0) && styles.disabled]}><DoopIcon name="check" size={20} color={colors.onAccent} /></Pressable>
    </View>
    <View style={styles.panel}>
      {disclosure && <View style={styles.disclosureRow}><Text style={styles.disclosure}>Estimates can be wrong. Not medical advice.</Text><Pressable accessibilityRole="button" accessibilityLabel="Dismiss estimate notice" onPress={() => setDisclosure(false)} style={styles.iconButton}><DoopIcon name="close" size={12} color={colors.muted} /></Pressable></View>}
      {photoUri && <View style={styles.photoRow}><Image source={{ uri: photoUri }} accessibilityLabel={`Attached photo for ${mealLabel}`} style={styles.photo} /><Text style={styles.portion}>{mealLabel} · 1 photo</Text></View>}
      {children}
      {fiberNote && <Text style={styles.fiberNote}>{fiberNote}</Text>}
      {naming && onSaveAsMeal && <View style={styles.editBlock}><Input label="Saved meal name" value={mealName} onChangeText={setMealName} editable={!confirming} placeholder="My usual lunch" /><Button label="Save reviewed meal" quiet disabled={confirming || !mealName.trim() || !itemCount} onPress={() => onSaveAsMeal(mealName.trim())} /></View>}
      <Pressable accessibilityRole="button" accessibilityLabel="Discard drafts" disabled={confirming} onPress={onDismissAll} style={styles.discard}><Text style={styles.discardLabel}>Discard drafts</Text></Pressable>
    </View>
  </View>;
}
export interface AIFailedCardProps {
  mealLabel?: string | undefined;
  reasonText: string;
  onRetry?: (() => void) | undefined;
  onSearchInstead: () => void;
  onQuickAdd: () => void;
  onDismiss?: (() => void) | undefined;
}
export function AIFailedCard({ mealLabel, reasonText, onRetry, onSearchInstead, onQuickAdd, onDismiss }: AIFailedCardProps) {
  return <View style={styles.failed}>
    <View style={styles.failedHead}><DoopIcon name="sparkle" size={17} color={colors.lavender} /><Text style={styles.failedLabel}>{mealLabel ? `${mealLabel} · ` : ''}Draft not ready</Text>{onDismiss && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss AI notice" onPress={onDismiss} style={styles.iconButton}><DoopIcon name="close" size={14} color={colors.muted} /></Pressable>}</View>
    <Text style={styles.reason}>{reasonText}</Text>
    <View style={ui.wrap}>{onRetry && <Button label="Retry" quiet onPress={onRetry} />}<Button label="Search instead" quiet onPress={onSearchInstead} /><Button label="Quick add" quiet onPress={onQuickAdd} /></View>
  </View>;
}
const styles = StyleSheet.create({
  sparkleRow: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(187,154,247,0.58)', backgroundColor: 'rgba(187,154,247,0.09)' },
  sparkleSummary: { ...fontFace('semibold'), flex: 1, color: colors.ink, fontSize: 13 },
  sparkleEnd: { ...fontFace('bold'), color: colors.lavender, fontSize: 11 },
  item: { borderBottomWidth: 1, borderBottomColor: colors.border, borderStyle: 'dashed' },
  itemRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 2 },
  itemCopy: { flex: 1, minWidth: 0, gap: 3, paddingVertical: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...fontFace('semibold'), flexShrink: 1, color: colors.ink, fontSize: 14 },
  badge: { maxWidth: 104, borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { ...fontFace('bold'), color: colors.muted, fontSize: 9, letterSpacing: 0.36 },
  portionRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.mint },
  estimateDot: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lavender },
  portion: { ...fontFace('medium'), flexShrink: 1, color: colors.muted, fontSize: 11 },
  itemEnergy: { ...fontFace('semibold'), fontVariant: [...tabularNums.fontVariant], color: colors.muted, fontSize: 13, paddingLeft: 8 },
  iconButton: { width: 36, height: 40, justifyContent: 'center', alignItems: 'center' },
  editBlock: { gap: 8, paddingVertical: 8 },
  askRow: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2 },
  askLabel: { ...fontFace('semibold'), color: colors.muted, fontSize: 11, marginRight: 4 },
  askOptions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2, flexShrink: 1 },
  chipTouch: { minHeight: 40, justifyContent: 'center' },
  chip: { height: 28, paddingHorizontal: 11, borderRadius: 14, borderWidth: 1, borderColor: colors.hairline, justifyContent: 'center' },
  chipSelected: { borderColor: colors.lavender, backgroundColor: 'rgba(187,154,247,0.14)' },
  chipLabel: { ...fontFace('semibold'), fontSize: 11, color: colors.muted },
  panelHead: { height: 72, flexDirection: 'row', alignItems: 'center', gap: 6 },
  node: { width: 40, height: 40, borderRadius: radius.r20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.well, justifyContent: 'center', alignItems: 'center', marginRight: 6 },
  mealName: { ...fontFace('semibold'), fontSize: 16, color: colors.ink, flex: 1, minWidth: 0 },
  loggedEnergy: { ...fontFace('bold'), fontVariant: [...tabularNums.fontVariant], fontSize: 24, color: colors.ink, letterSpacing: -0.48 },
  draftEnergy: { ...fontFace('bold'), fontVariant: [...tabularNums.fontVariant], fontSize: 13, color: colors.lavender },
  confirm: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  panel: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, marginTop: 4, marginBottom: 10, paddingHorizontal: 0, overflow: 'hidden' },
  disclosureRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40, borderBottomWidth: 1, borderBottomColor: colors.border, borderStyle: 'dashed' },
  disclosure: { ...fontFace('medium'), color: colors.muted, fontSize: 11, flex: 1 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, borderStyle: 'dashed' },
  photo: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  fiberNote: { ...fontFace('medium'), color: colors.muted, fontSize: 11, paddingVertical: 8 },
  discard: { minHeight: 32, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 10 },
  discardLabel: { ...fontFace('medium'), fontSize: 10, color: colors.muted },
  failed: { gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, padding: 12, marginVertical: 8 },
  failedHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  failedLabel: { ...fontFace('semibold'), color: colors.ink, fontSize: 13, flex: 1 },
  reason: { ...fontFace('medium'), color: colors.muted, fontSize: 12 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
