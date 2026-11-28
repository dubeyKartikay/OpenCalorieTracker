import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fontFace, tabularNums } from '../../tokens';
import { DoopIcon } from '../DoopIcons';
import type { DoopIconName } from '../DoopIcons';

export interface AIModelChoice { id: string; label: string; supportsVision: boolean }
export interface ChatGPTConnectionCardProps {
  mode: 'disconnected' | 'chatgpt_oauth' | 'api_key'; statusLabel: string;
  consentChecked: boolean; onToggleConsent: () => void; onConnectChatGPT: () => void;
  onSaveApiKey: (apiKey: string) => void; maskedKey?: string | null | undefined;
  models: AIModelChoice[]; selectedModel: string; onSelectModel: (modelId: string) => void;
  modelsState?: 'idle' | 'loading' | 'loaded' | 'empty' | 'error' | undefined;
  modelsError?: string | null | undefined;
  onRetryModels?: (() => void) | undefined;
  onOpenManageUsage?: (() => void) | undefined; onDisconnect: () => void;
  oauthNote?: string | null | undefined; busy?: boolean | undefined;
}
const FOOTER = 'Disconnecting deletes nothing · manual logging always works';
const TRUST_ITEMS: readonly { icon: DoopIconName; title: string; detail: string }[] = [
  { icon: 'lock', title: 'Direct to OpenAI', detail: 'Tokens stay in encrypted device storage' },
  { icon: 'sparkle', title: 'Uses your ChatGPT plan', detail: 'Plus, Pro, or Business · set limits on OpenAI' },
  { icon: 'info', title: 'Meal input only', detail: 'Your diary and ChatGPT chats stay separate' },
];

export function ChatGPTConnectionCard(props: ChatGPTConnectionCardProps) {
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState('');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const connected = props.mode !== 'disconnected';
  const model = props.models.find(item => item.id === props.selectedModel)?.label ?? props.selectedModel;
  return <View style={styles.content}>
    {connected ? <>
      <View style={styles.connectedBanner}>
        <View style={styles.status}>
          <View style={[styles.dot, styles.dotOn]} />
          <DoopIcon name="check" size={14} color={colors.success} />
          <Text style={styles.statusLabel}>{props.mode === 'chatgpt_oauth' ? 'Using ChatGPT plan' : 'Using API key'}</Text>
        </View>
        {!!props.maskedKey && <Text style={styles.maskedKey}>{props.maskedKey}</Text>}
      </View>
      <View style={styles.rows}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Model, ${props.modelsState === 'loading' ? 'Loading' : model}`} accessibilityState={{ expanded: modelsOpen }} disabled={props.busy}
          onPress={() => setModelsOpen(open => !open)} style={styles.row}>
          <Text style={styles.rowText}>Model</Text><View style={styles.rowValue}><Text style={styles.modelValue}>{props.modelsState === 'loading' ? 'Loading…' : model}</Text><DoopIcon name="chevronDown" size={16} color={colors.muted} /></View>
        </Pressable>
        {modelsOpen && <View style={styles.models} accessibilityRole="radiogroup" accessibilityLabel="Model">
          {props.modelsState === 'loading' ? (
            <View style={styles.modelStatusRow}>
              <Text style={styles.modelStatusText}>Loading models from OpenAI…</Text>
            </View>
          ) : props.modelsState === 'error' ? (
            <View style={styles.modelStatusRow}>
              <Text style={styles.modelStatusText}>{props.modelsError ?? 'Could not load models from OpenAI.'}</Text>
              {props.onRetryModels && (
                <Pressable accessibilityRole="button" disabled={props.busy} onPress={props.onRetryModels} style={styles.pill}>
                  <Text style={styles.linkLabel}>Retry</Text>
                </Pressable>
              )}
            </View>
          ) : props.modelsState === 'empty' || props.models.length === 0 ? (
            <View style={styles.modelStatusRow}>
              <Text style={styles.modelStatusText}>{props.modelsError ?? 'No compatible models available for this account.'}</Text>
              {props.onRetryModels && (
                <Pressable accessibilityRole="button" disabled={props.busy} onPress={props.onRetryModels} style={styles.pill}>
                  <Text style={styles.linkLabel}>Retry</Text>
                </Pressable>
              )}
            </View>
          ) : (
            props.models.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: item.id === props.selectedModel }} disabled={props.busy}
              onPress={() => { props.onSelectModel(item.id); setModelsOpen(false); }} style={[styles.modelRow, item.id === props.selectedModel && styles.modelSelected]}>
              <Text style={[styles.rowText, { flex: 1, fontSize: 13 }]}>{item.label}</Text>
              {item.supportsVision && <DoopIcon name="camera" size={14} color={colors.muted} />}
              {item.id === props.selectedModel && <DoopIcon name="check" size={14} color={colors.accent} />}
            </Pressable>)
          )}
        </View>}
        {props.onOpenManageUsage && <Pressable accessibilityRole="button" disabled={props.busy} onPress={props.onOpenManageUsage} style={styles.row}>
          <Text style={styles.rowText}>Manage usage</Text><DoopIcon name="external" size={15} color={colors.muted} />
        </Pressable>}
        <Pressable accessibilityRole="button" disabled={props.busy} onPress={() => props.mode === 'chatgpt_oauth' ? props.onConnectChatGPT() : setKeyOpen(open => !open)} style={styles.row}>
          <Text style={styles.rowText}>Reconnect</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: signOutOpen }} disabled={props.busy} onPress={() => setSignOutOpen(open => !open)} style={styles.row}>
          <Text style={styles.rowText}>Sign out</Text>
        </Pressable>
        {signOutOpen && <View style={styles.confirm}>
          <Text style={styles.rowText}>Sign out on this device?</Text><View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Pressable accessibilityRole="button" onPress={() => setSignOutOpen(false)} style={styles.pill}><Text style={styles.linkLabel}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Confirm sign out" disabled={props.busy} onPress={props.onDisconnect} style={[styles.pill, { backgroundColor: colors.raised }]}><Text style={styles.linkLabel}>Sign out</Text></Pressable>
          </View>
        </View>}
      </View>
    </> : <>
      <View style={styles.hero}>
        <View style={styles.emblemRow}>
          <View style={styles.emblem}>
            <DoopIcon name="ringMark" size={20} color={colors.ink} />
          </View>
          <View style={styles.emblemBridge}>
            <DoopIcon name="link" size={14} color={colors.muted} />
          </View>
          <View style={[styles.emblem, styles.emblemAccent]}>
            <DoopIcon name="sparkle" size={20} color={colors.accent} />
          </View>
        </View>
        <Text style={styles.heroTitle}>Connect ChatGPT</Text>
        <Text style={styles.heroSub}>Log meals by text or photo with your ChatGPT plan</Text>
      </View>
      <View style={styles.trustCard}>
        {TRUST_ITEMS.map((item, index) => <View key={item.title} style={[styles.trustRow, index > 0 && styles.trustRowDivided]}>
          <View style={styles.trustIcon}>
            <DoopIcon name={item.icon} size={15} color={colors.accent} />
          </View>
          <View style={styles.trustCopy}>
            <Text style={styles.trustTitle}>{item.title}</Text>
            <Text style={styles.trustDetail}>{item.detail}</Text>
          </View>
        </View>)}
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Use my ChatGPT plan for meal logging" accessibilityState={{ checked: props.consentChecked }} disabled={props.busy} onPress={props.onToggleConsent} style={styles.consent}>
        <View style={[styles.checkbox, props.consentChecked && styles.checkboxOn]}>{props.consentChecked && <DoopIcon name="check" size={13} color={colors.onAccent} />}</View>
        <Text style={styles.consentLabel}>Use my ChatGPT plan for meal logging</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!props.consentChecked || props.busy} onPress={props.onConnectChatGPT}
        style={[styles.primary, (!props.consentChecked || props.busy) && styles.primaryDisabled]}>
        <Text style={[styles.primaryLabel, (!props.consentChecked || props.busy) && styles.primaryLabelDisabled]}>
          {props.busy ? 'Waiting for ChatGPT…' : 'Continue with ChatGPT'}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: keyOpen }} disabled={props.busy} onPress={() => setKeyOpen(open => !open)} style={styles.link}>
        <Text style={styles.linkLabel}>Use an API key instead</Text>
      </Pressable>
    </>}
    {keyOpen && <View style={styles.keyBlock}>
      <View style={styles.keyField}><DoopIcon name="key" size={15} color={colors.muted} />
        <TextInput accessibilityLabel="OpenAI API key" value={key} onChangeText={setKey} autoCapitalize="none" autoCorrect={false} secureTextEntry
          placeholder="sk-proj-…" placeholderTextColor={colors.muted} style={styles.keyInput} editable={!props.busy} />
        <Pressable accessibilityRole="button" accessibilityLabel="Save API key" disabled={props.busy || !key.trim()}
          onPress={() => { if (key.trim()) { props.onSaveApiKey(key.trim()); setKey(''); } }} style={[styles.pill, key.trim() ? styles.checkboxOn : null]}>
          <Text style={[styles.linkLabel, key.trim() ? { color: colors.onAccent } : null]}>Save</Text>
        </Pressable>
      </View><Text style={styles.note}>Billed to the key’s owner · stays on this device</Text>
    </View>}
    {!!props.oauthNote && <View style={styles.noteBox}><Text accessibilityLiveRegion="polite" style={styles.noteText}>{props.oauthNote}</Text></View>}
    <Text style={styles.footer}>{FOOTER}</Text>
  </View>;
}
const styles = StyleSheet.create({
  content: { marginTop: 8 },
  connectedBanner: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, gap: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  dot: { width: 8, height: 8, borderRadius: 4 }, dotOn: { backgroundColor: colors.success },
  statusLabel: { ...fontFace('bold'), color: colors.ink, fontSize: 14 },
  maskedKey: { ...fontFace(), ...tabularNums, fontSize: 12, color: colors.muted, opacity: 0.85, marginLeft: 16 },
  rows: { marginTop: 14 },
  hero: { alignItems: 'center', paddingTop: 10, paddingBottom: 18, paddingHorizontal: 8 },
  emblemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  emblem: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  emblemAccent: { backgroundColor: colors.raised, borderColor: colors.border },
  emblemBridge: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
  heroTitle: { ...fontFace('bold'), fontSize: 20, color: colors.ink, letterSpacing: -0.3 },
  heroSub: { ...fontFace(), fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 5, lineHeight: 19 },
  trustCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: 14, paddingVertical: 4 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  trustRowDivided: { borderTopWidth: 1, borderTopColor: colors.hairline },
  trustIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  trustCopy: { flex: 1, gap: 1 },
  trustTitle: { ...fontFace('semibold'), fontSize: 13, color: colors.ink },
  trustDetail: { ...fontFace(), fontSize: 12, color: colors.muted, opacity: 0.85, lineHeight: 16 },
  consent: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingHorizontal: 2 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  consentLabel: { ...fontFace('semibold'), fontSize: 13, color: colors.ink, flex: 1 },
  primary: { height: 50, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  primaryDisabled: { backgroundColor: colors.raised },
  primaryLabel: { ...fontFace('bold'), fontSize: 14, color: colors.onAccent },
  primaryLabelDisabled: { color: colors.muted, opacity: 0.65 },
  link: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  linkLabel: { ...fontFace('semibold'), fontSize: 13, color: colors.muted },
  row: { height: 50, borderTopWidth: 1, borderTopColor: colors.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { ...fontFace('semibold'), color: colors.ink, fontSize: 14 },
  rowValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelValue: { ...fontFace('bold'), color: colors.ink, fontSize: 13 },
  models: { padding: 6, borderRadius: 16, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  modelRow: { minHeight: 44, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
  modelSelected: { backgroundColor: colors.surface },
  modelStatusRow: { paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  modelStatusText: { ...fontFace(), fontSize: 12, color: colors.muted, flex: 1, lineHeight: 17 },
  confirm: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline, paddingVertical: 14, gap: 12 },
  pill: { height: 40, minWidth: 60, borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, justifyContent: 'center', alignItems: 'center' },
  keyBlock: { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderColor: colors.hairline, gap: 8 },
  keyField: { height: 48, paddingLeft: 12, paddingRight: 3, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  keyInput: { ...fontFace(), ...tabularNums, flex: 1, minWidth: 0, color: colors.ink, fontSize: 13, height: 44 },
  noteBox: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  noteText: { ...fontFace(), fontSize: 12, color: colors.ink, lineHeight: 17 },
  note: { ...fontFace(), fontSize: 11, color: colors.muted, opacity: 0.78, lineHeight: 16 },
  footer: { ...fontFace(), fontSize: 11, color: colors.muted, opacity: 0.72, lineHeight: 16, marginTop: 18, textAlign: 'center' },
});
