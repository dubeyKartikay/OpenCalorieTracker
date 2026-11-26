import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fontFace, tabularNums } from '../../tokens';
import { DoopIcon } from '../DoopIcons';

export interface AIModelChoice { id: string; label: string; supportsVision: boolean }
export interface ChatGPTConnectionCardProps {
  mode: 'disconnected' | 'chatgpt_oauth' | 'api_key'; statusLabel: string;
  consentChecked: boolean; onToggleConsent: () => void; onConnectChatGPT: () => void;
  onSaveApiKey: (apiKey: string) => void; maskedKey?: string | null | undefined;
  models: AIModelChoice[]; selectedModel: string; onSelectModel: (modelId: string) => void;
  onOpenManageUsage?: (() => void) | undefined; onDisconnect: () => void;
  oauthNote?: string | null | undefined; busy?: boolean | undefined;
}
const FOOTER = 'Disconnecting deletes nothing · manual logging always works';
export function ChatGPTConnectionCard(props: ChatGPTConnectionCardProps) {
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState('');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const connected = props.mode !== 'disconnected';
  const model = props.models.find(item => item.id === props.selectedModel)?.label ?? props.selectedModel;
  return <View style={styles.content}>
    <View style={styles.status}>
      <View style={[styles.dot, connected ? styles.dotOn : styles.dotOff]} />
      {connected && <DoopIcon name="check" size={13} color={colors.success} />}
      <Text style={styles.statusLabel}>{!connected ? 'Not connected' : props.mode === 'chatgpt_oauth' ? 'Using ChatGPT plan' : 'Using API key'}</Text>
    </View>
    {connected ? <View style={{ marginTop: 16 }}>
      {!!props.maskedKey && <Text style={styles.note}>{props.maskedKey}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Model, ${model}`} accessibilityState={{ expanded: modelsOpen }} disabled={props.busy}
        onPress={() => setModelsOpen(open => !open)} style={styles.row}>
        <Text style={styles.rowText}>Model</Text><View style={styles.rowValue}><Text style={styles.modelValue}>{model}</Text><DoopIcon name="chevronDown" size={16} color={colors.muted} /></View>
      </Pressable>
      {modelsOpen && <View style={styles.models} accessibilityRole="radiogroup" accessibilityLabel="Model">
        {props.models.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: item.id === props.selectedModel }} disabled={props.busy}
          onPress={() => { props.onSelectModel(item.id); setModelsOpen(false); }} style={[styles.modelRow, item.id === props.selectedModel && styles.modelSelected]}>
          <Text style={[styles.rowText, { flex: 1, fontSize: 13 }]}>{item.label}</Text>
          {item.supportsVision && <DoopIcon name="camera" size={14} color={colors.muted} />}
          {item.id === props.selectedModel && <DoopIcon name="check" size={14} color={colors.accent} />}
        </Pressable>)}
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
    </View> : <>
      <View style={styles.disclosures}>
        {['Works with Plus, Pro and Business', "Shares your plan’s allowance with ChatGPT", 'If it runs out, AI pauses until it resets'].map(line => <Text key={line} style={styles.disclosure}>{line}</Text>)}
      </View>
      <View style={styles.rule} />
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Use my ChatGPT plan for meal logging" accessibilityState={{ checked: props.consentChecked }} disabled={props.busy} onPress={props.onToggleConsent} style={styles.consent}>
        <View style={[styles.checkbox, props.consentChecked && styles.checkboxOn]}>{props.consentChecked && <DoopIcon name="check" size={13} color={colors.onAccent} />}</View>
        <Text style={styles.consentLabel}>Use my ChatGPT plan for meal logging</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!props.consentChecked || props.busy} onPress={props.onConnectChatGPT}
        style={[styles.primary, (!props.consentChecked || props.busy) && { backgroundColor: colors.raised }]}>
        <Text style={[styles.primaryLabel, (!props.consentChecked || props.busy) && { color: colors.muted, opacity: 0.65 }]}>Continue with ChatGPT</Text>
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
    {!!props.oauthNote && <Text accessibilityLiveRegion="polite" style={styles.note}>{props.oauthNote}</Text>}
    <Text style={styles.footer}>{FOOTER}</Text>
  </View>;
}
const styles = StyleSheet.create({
  content: { marginTop: 12 }, status: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  dot: { width: 8, height: 8, borderRadius: 4 }, dotOn: { backgroundColor: colors.success }, dotOff: { borderWidth: 1.5, borderColor: colors.muted, opacity: 0.6 },
  statusLabel: { ...fontFace('bold'), color: colors.ink, fontSize: 13 },
  disclosures: { marginTop: 18, gap: 7 }, disclosure: { ...fontFace(), color: colors.muted, fontSize: 12, lineHeight: 18, opacity: 0.82 },
  rule: { height: 1, backgroundColor: colors.hairline, marginTop: 20, marginBottom: 8 },
  consent: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent }, consentLabel: { ...fontFace('semibold'), fontSize: 13, color: colors.ink, flex: 1 },
  primary: { height: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryLabel: { ...fontFace('bold'), fontSize: 14, color: colors.onAccent },
  link: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, linkLabel: { ...fontFace('semibold'), fontSize: 13, color: colors.muted },
  row: { height: 48, borderTopWidth: 1, borderTopColor: colors.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { ...fontFace('semibold'), color: colors.ink, fontSize: 14 }, rowValue: { flexDirection: 'row', alignItems: 'center', gap: 8 }, modelValue: { ...fontFace('bold'), color: colors.ink, fontSize: 13 },
  models: { padding: 6, borderRadius: 16, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  modelRow: { minHeight: 44, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', gap: 8, alignItems: 'center' }, modelSelected: { backgroundColor: colors.surface },
  confirm: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline, paddingVertical: 14, gap: 12 },
  pill: { height: 40, minWidth: 60, borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, justifyContent: 'center', alignItems: 'center' },
  keyBlock: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: colors.hairline, gap: 8 },
  keyField: { height: 48, paddingLeft: 12, paddingRight: 3, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  keyInput: { ...fontFace(), ...tabularNums, flex: 1, minWidth: 0, color: colors.ink, fontSize: 13, height: 44 },
  note: { ...fontFace(), fontSize: 11, color: colors.muted, opacity: 0.78, lineHeight: 16 }, footer: { ...fontFace(), fontSize: 11, color: colors.muted, opacity: 0.78, lineHeight: 16, marginTop: 20 },
});
