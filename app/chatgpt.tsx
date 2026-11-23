import { useState } from 'react';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import { useAction, useAIStatus, useAppRuntime } from '../src/app/AppRuntimeContext';
import { AI_MODEL_OPTIONS } from '../src/ai';
import { ChatGPTConnectionCard } from '../src/ui/components/capture';
import { Button, ErrorMessage, Muted, Page } from '../src/ui/components/primitives';

export default function ChatGPT() {
  const { controller } = useAppRuntime();
  const status = useAIStatus();
  const action = useAction();
  const [oauthNote, setOAuthNote] = useState<string | null>(null);
  return <Page title="ChatGPT" action={<Button label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} />}>
    <ErrorMessage message={action.error ?? status.error} />
    {status.loading && <Muted>Checking AI connection…</Muted>}
    {status.value && <ChatGPTConnectionCard mode={status.value.mode} statusLabel={status.value.statusLabel}
      consentChecked={status.value.consentAccepted} busy={action.busy || status.loading}
      onToggleConsent={() => void action.run(() => controller.setAIConsent(!status.value!.consentAccepted))}
      onConnectChatGPT={() => void action.run(async () => {
        const result = await controller.connectChatGPTOAuth(); setOAuthNote(result.message);
      })}
      onSaveApiKey={key => void action.run(async () => {
        if (!status.value?.consentAccepted) throw new Error('Allow meal text and photos to be sent to OpenAI before saving a key.');
        await controller.saveApiKey(key); setOAuthNote(null);
      })}
      maskedKey={status.value.maskedKey} models={[...AI_MODEL_OPTIONS]} selectedModel={status.value.model}
      onSelectModel={model => void action.run(() => controller.setAIModel(model))}
      {...(status.value.mode === 'chatgpt_oauth' ? { onOpenManageUsage: () => void action.run(() => Linking.openURL('https://chatgpt.com/#settings')) } : {})}
      onDisconnect={() => void action.run(async () => { await controller.disconnectAI(); setOAuthNote(null); })}
      oauthNote={oauthNote} />}
    {status.value && status.value.mode !== 'disconnected' && !status.value.consentAccepted &&
      <Button label="Allow meal text and photos to be sent to OpenAI" disabled={action.busy}
        onPress={() => void action.run(() => controller.setAIConsent(true))} />}
    <Muted>Meal text or photos are sent to OpenAI only when you use AI. Your diary is never sent. Review every draft before logging.</Muted>
  </Page>;
}
