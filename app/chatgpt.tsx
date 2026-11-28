import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { useAction, useAIStatus, useAppRuntime } from '../src/app/AppRuntimeContext';
import { ChatGPTConnectionCard } from '../src/ui/components/capture';
import { BackHeader, Button, ErrorMessage, goBackOrReplace, Muted, Page } from '../src/ui/components/primitives';

export default function ChatGPT() {
  const { controller } = useAppRuntime();
  const status = useAIStatus();
  const action = useAction();
  const [oauthNote, setOAuthNote] = useState<string | null>(null);
  const [connectingOAuth, setConnectingOAuth] = useState(false);
  const leftAppDuringOAuthRef = useRef(false);

  useEffect(() => {
    if (!connectingOAuth || Platform.OS !== 'android') {
      leftAppDuringOAuthRef.current = false;
      return;
    }
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background' || state === 'inactive') {
        leftAppDuringOAuthRef.current = true;
        if (graceTimer !== null) {
          clearTimeout(graceTimer);
          graceTimer = null;
        }
      } else if (state === 'active' && leftAppDuringOAuthRef.current) {
        // Give the loopback redirect a short grace window after returning from Custom Tabs,
        // then cancel cleanly if the user backed out without completing sign-in.
        if (graceTimer !== null) clearTimeout(graceTimer);
        graceTimer = setTimeout(() => {
          graceTimer = null;
          controller.cancelPendingOAuthCallback();
        }, 2500);
      }
    });
    return () => {
      if (graceTimer !== null) clearTimeout(graceTimer);
      sub.remove();
    };
  }, [connectingOAuth, controller]);

  const connectedMode = status.value?.mode;
  const credentialGeneration = status.value?.credentialGeneration;
  useEffect(() => {
    if (connectedMode && connectedMode !== 'disconnected') {
      void controller.refreshAvailableAIModels();
    }
  }, [connectedMode, credentialGeneration, controller]);

  return <Page><BackHeader title="ChatGPT" onBack={() => goBackOrReplace('/settings')} />
    <ErrorMessage message={action.error ?? status.error} />
    {status.loading && <Muted>Checking AI connection…</Muted>}
    {status.value && <ChatGPTConnectionCard mode={status.value.mode} statusLabel={status.value.statusLabel}
      consentChecked={status.value.consentAccepted} busy={action.busy || status.loading}
      onToggleConsent={() => void action.run(() => controller.setAIConsent(!status.value!.consentAccepted))}
      onConnectChatGPT={() => void action.run(async () => {
        setConnectingOAuth(true);
        try {
          const result = await controller.connectChatGPTOAuth();
          setOAuthNote(result.message);
        } finally {
          setConnectingOAuth(false);
        }
      })}
      onSaveApiKey={key => void action.run(async () => {
        if (!status.value?.consentAccepted) throw new Error('Allow meal text and photos to be sent to OpenAI before saving a key.');
        await controller.saveApiKey(key); setOAuthNote(null);
      })}
      maskedKey={status.value.maskedKey} models={status.value.models} selectedModel={status.value.model}
      modelsState={status.value.modelsState} modelsError={status.value.modelsError}
      onRetryModels={() => void controller.refreshAvailableAIModels({ force: true })}
      onSelectModel={model => void action.run(() => controller.setAIModel(model))}
      {...(status.value.mode === 'chatgpt_oauth' ? { onOpenManageUsage: () => void action.run(() => Linking.openURL('https://chatgpt.com/#settings')) } : {})}
      onDisconnect={() => void action.run(async () => {
        const result = await controller.disconnectAI();
        setOAuthNote(result.revokedRemote ? null : 'Signed out on this device. Remote revocation could not be confirmed; you can also revoke access in ChatGPT settings.');
      })}
      oauthNote={oauthNote} />}
    {connectingOAuth && (
      <Button label="Cancel sign-in" quiet onPress={() => controller.cancelChatGPTOAuth()} />
    )}
    {status.value && status.value.mode !== 'disconnected' && !status.value.consentAccepted &&
      <Button label="Allow meal text and photos to be sent to OpenAI" disabled={action.busy}
        onPress={() => void action.run(() => controller.setAIConsent(true))} />}

  </Page>;
}
