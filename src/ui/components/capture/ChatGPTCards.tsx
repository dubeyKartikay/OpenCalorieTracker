import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  colors,
  fontSize,
  fontWeight,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  tabularNums,
} from '../../tokens';

export interface AIModelChoice {
  id: string;
  label: string;
  supportsVision: boolean;
}

export interface ChatGPTConnectionCardProps {
  mode: 'disconnected' | 'chatgpt_oauth' | 'api_key';
  /** Ready-made status line, e.g. `Not connected` or `Connected · ChatGPT plan`. */
  statusLabel: string;
  consentChecked: boolean;
  onToggleConsent: () => void;
  onConnectChatGPT: () => void;
  onSaveApiKey: (apiKey: string) => void;
  maskedKey?: string | null | undefined;
  models: AIModelChoice[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  onOpenManageUsage?: (() => void) | undefined;
  onDisconnect: () => void;
  oauthNote?: string | null | undefined;
  busy?: boolean | undefined;
}

const CONSENT_LABEL = 'Allow meal text and photos to be sent to OpenAI using my plan';

const DISCLOSURES = [
  'Works with eligible ChatGPT plans',
  "Shares your plan's allowance with ChatGPT",
  'If it runs out, AI pauses until it resets',
] as const;

const KEY_NOTE = "Billed to the key's owner · stays on this device";
const DISCONNECT_NOTE = 'Disconnecting deletes nothing · manual logging always works';

/**
 * Doop "ChatGPT" settings card.
 *
 * Disconnected, it explains the trade in three plain facts, takes consent with
 * an explicit checkbox, and keeps the API-key path one tap away instead of
 * competing with the plan button. Connected, it shows what is in use and hides
 * model choice and sign-out behind inline disclosures so the resting state is
 * two lines tall.
 */
export function ChatGPTConnectionCard({
  mode,
  statusLabel,
  consentChecked,
  onToggleConsent,
  onConnectChatGPT,
  onSaveApiKey,
  maskedKey,
  models,
  selectedModel,
  onSelectModel,
  onOpenManageUsage,
  onDisconnect,
  oauthNote,
  busy,
}: ChatGPTConnectionCardProps) {
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const blocked = busy === true;
  const connected = mode !== 'disconnected';
  const hasMaskedKey = maskedKey != null && maskedKey !== '';
  const hasOAuthNote = oauthNote != null && oauthNote !== '';
  const trimmedKey = apiKey.trim();
  const canSaveKey = trimmedKey !== '' && !blocked;
  const selectedModelChoice = models.find(model => model.id === selectedModel);
  const modelLabel =
    selectedModelChoice?.label ?? (selectedModel === '' ? 'Choose a model' : selectedModel);

  const statusDot = connected ? styles.dotConnected : styles.dotIdle;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>ChatGPT</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, statusDot]} />
          <Text numberOfLines={1} style={styles.statusText}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {connected ? (
        <View style={styles.body}>
          {hasMaskedKey ? (
            <Text numberOfLines={1} style={styles.maskedKey}>
              {maskedKey}
            </Text>
          ) : null}

          <View style={styles.rule} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Model, ${modelLabel}`}
            accessibilityState={{ expanded: modelOpen, disabled: blocked }}
            disabled={blocked}
            onPress={() => setModelOpen(open => !open)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.rowLabel}>Model</Text>
            <View style={styles.rowValue}>
              <Text numberOfLines={1} style={styles.rowValueText}>
                {modelLabel}
              </Text>
              <Text style={styles.rowGlyph}>{modelOpen ? '▾' : '›'}</Text>
            </View>
          </Pressable>

          {modelOpen ? (
            <View style={styles.modelList} accessibilityRole="radiogroup" accessibilityLabel="Model">
              {models.map(model => {
                const selected = model.id === selectedModel;
                return (
                  <Pressable
                    key={model.id}
                    accessibilityRole="radio"
                    accessibilityLabel={model.label}
                    accessibilityState={{ checked: selected, disabled: blocked }}
                    disabled={blocked}
                    onPress={() => onSelectModel(model.id)}
                    style={({ pressed }) => [styles.modelRow, pressed && styles.pressed]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.modelLabel, selected && styles.modelLabelSelected]}
                    >
                      {model.label}
                    </Text>
                    <View style={styles.modelMeta}>
                      {model.supportsVision ? (
                        <View style={styles.photoBadge}>
                          <Text style={styles.photoBadgeLabel}>Photo</Text>
                        </View>
                      ) : null}
                      {selected ? <Text style={styles.modelCheck}>✓</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {onOpenManageUsage != null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Manage usage"
              accessibilityState={{ disabled: blocked }}
              disabled={blocked}
              onPress={onOpenManageUsage}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.rowLink}>Manage usage</Text>
              <Text style={styles.rowGlyph}>›</Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            accessibilityState={{ expanded: signOutOpen, disabled: blocked }}
            disabled={blocked}
            onPress={() => setSignOutOpen(open => !open)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.rowDanger}>Sign out</Text>
            <Text style={styles.rowGlyph}>{signOutOpen ? '▾' : '›'}</Text>
          </Pressable>

          {signOutOpen ? (
            <View style={styles.confirmCard}>
              <Text style={styles.confirmNote}>{DISCONNECT_NOTE}</Text>
              <View style={styles.confirmActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel sign out"
                  onPress={() => setSignOutOpen(false)}
                  style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}
                >
                  <Text style={styles.quietLabel}>Cancel</Text>
                </Pressable>
                <View style={styles.confirmDivider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm sign out"
                  disabled={blocked}
                  onPress={onDisconnect}
                  style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}
                >
                  <Text style={styles.dangerLabel}>Sign out</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.bullets}>
            {DISCLOSURES.map(item => (
              <View key={item} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>·</Text>
                <Text style={styles.bulletText}>{item}</Text>
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={CONSENT_LABEL}
            accessibilityState={{ checked: consentChecked, disabled: blocked }}
            disabled={blocked}
            onPress={onToggleConsent}
            style={({ pressed }) => [styles.consentRow, pressed && styles.pressed]}
          >
            <View style={[styles.checkbox, consentChecked && styles.checkboxChecked]}>
              {consentChecked ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <Text style={[styles.consentText, consentChecked && styles.consentTextChecked]}>
              {CONSENT_LABEL}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with ChatGPT"
            accessibilityState={{ disabled: !consentChecked || blocked, busy: blocked }}
            disabled={!consentChecked || blocked}
            onPress={onConnectChatGPT}
            style={({ pressed }) => [
              styles.primaryButton,
              (!consentChecked || blocked) && styles.primaryButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryLabel}>Continue with ChatGPT</Text>
          </Pressable>

          {hasOAuthNote ? <Text style={styles.note}>{oauthNote}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use an API key instead"
            accessibilityState={{ expanded: apiKeyOpen, disabled: blocked }}
            disabled={blocked}
            onPress={() => setApiKeyOpen(open => !open)}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <Text style={styles.linkLabel}>Use an API key instead</Text>
            <Text style={styles.rowGlyph}>{apiKeyOpen ? '▾' : '›'}</Text>
          </Pressable>

          {apiKeyOpen ? (
            <View style={styles.keyBlock}>
              <View style={styles.keyRow}>
                <TextInput
                  accessibilityLabel="OpenAI API key"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setApiKey}
                  placeholder="sk-…"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  style={styles.keyInput}
                  value={apiKey}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save API key"
                  accessibilityState={{ disabled: !canSaveKey }}
                  disabled={!canSaveKey}
                  onPress={() => {
                    if (!canSaveKey) return;
                    onSaveApiKey(trimmedKey);
                    setApiKey('');
                  }}
                  style={({ pressed }) => [
                    styles.keySave,
                    !canSaveKey && styles.keySaveDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.keySaveLabel}>Save</Text>
                </Pressable>
              </View>
              <Text style={styles.keyNote}>{KEY_NOTE}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.s10,
    padding: spacing.s12,
    borderRadius: radius.r16,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  head: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s8,
  },
  title: {
    color: colors.ink,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.semibold,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s6,
    flexShrink: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotIdle: {
    backgroundColor: colors.muted,
  },
  dotConnected: {
    backgroundColor: colors.success,
  },
  statusText: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  body: {
    gap: spacing.s10,
  },
  bullets: {
    gap: spacing.s4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s8,
  },
  bulletDot: {
    width: spacing.s8,
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  bulletText: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  consentRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s10,
    paddingVertical: spacing.s6,
  },
  checkbox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.r8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxMark: {
    color: colors.onAccent,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.bold,
  },
  consentText: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  consentTextChecked: {
    color: colors.ink,
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s16,
    paddingVertical: spacing.s10,
    borderRadius: radius.r12,
    backgroundColor: colors.accent,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryLabel: {
    color: colors.onAccent,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.bold,
  },
  note: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
  },
  linkRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s10,
    paddingHorizontal: spacing.s4,
    borderRadius: radius.r12,
  },
  linkLabel: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  rowGlyph: {
    color: colors.muted,
    fontSize: fontSize.t14,
    fontWeight: fontWeight.semibold,
  },
  keyBlock: {
    gap: spacing.s6,
    padding: spacing.s8,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s6,
  },
  keyInput: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s8,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  keySave: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s16,
    borderRadius: radius.r12,
    backgroundColor: colors.accent,
  },
  keySaveDisabled: {
    opacity: 0.45,
  },
  keySaveLabel: {
    color: colors.onAccent,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.bold,
  },
  keyNote: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.medium,
  },
  maskedKey: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
    fontVariant: [...tabularNums.fontVariant],
  },
  rule: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s12,
    paddingHorizontal: spacing.s4,
    borderRadius: radius.r12,
  },
  rowLabel: {
    color: colors.ink,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s6,
    flexShrink: 1,
    minWidth: 0,
  },
  rowValueText: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  rowLink: {
    color: colors.accent,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  rowDanger: {
    color: colors.danger,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  modelList: {
    gap: spacing.s2,
    paddingVertical: spacing.s4,
    paddingHorizontal: spacing.s4,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  modelRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s8,
    paddingHorizontal: spacing.s8,
    borderRadius: radius.r8,
  },
  modelLabel: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.medium,
  },
  modelLabelSelected: {
    color: colors.ink,
    fontWeight: fontWeight.semibold,
  },
  modelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s6,
  },
  photoBadge: {
    paddingHorizontal: spacing.s8,
    paddingVertical: spacing.s2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoBadgeLabel: {
    color: colors.muted,
    fontSize: fontSize.t10,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.3,
  },
  modelCheck: {
    color: colors.accent,
    fontSize: fontSize.t13,
    fontWeight: fontWeight.bold,
  },
  confirmCard: {
    gap: spacing.s6,
    padding: spacing.s8,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  confirmNote: {
    color: colors.muted,
    fontSize: fontSize.t11,
    fontWeight: fontWeight.medium,
  },
  confirmActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.r8,
  },
  confirmDivider: {
    width: 1,
    height: spacing.s20,
    backgroundColor: colors.border,
  },
  quietLabel: {
    color: colors.muted,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.semibold,
  },
  dangerLabel: {
    color: colors.danger,
    fontSize: fontSize.t12,
    fontWeight: fontWeight.bold,
  },
  pressed: { opacity: 0.7 },
});
