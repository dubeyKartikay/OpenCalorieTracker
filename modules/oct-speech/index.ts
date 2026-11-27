import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface SpeechCapability {
  available: boolean;
  onDeviceAvailable: boolean;
  platform: 'android' | 'ios' | 'web';
  reason: string | null;
}

export interface SpeechStartOptions {
  locale?: string;
  preferOffline?: boolean;
}

export type SpeechStateEvent = { state: 'starting' | 'listening' | 'ended'; sessionId: number };
export type SpeechVolumeEvent = { level: number; sessionId: number };
export type SpeechTextEvent = { text: string; sessionId: number };
export type SpeechErrorEvent = { code: number; message: string; recoverable: boolean; sessionId: number };

interface NativeSpeechSubscription {
  remove(): void;
}

interface NativeSpeechModule {
  getCapability(): SpeechCapability;
  getPermissionAsync(): Promise<boolean>;
  requestPermissionAsync(): Promise<boolean | { granted?: boolean; status?: string }>;
  startListeningAsync(options?: SpeechStartOptions): Promise<{ sessionId: number }>;
  stopListeningAsync(sessionId?: number | null): Promise<void>;
  cancelListeningAsync(sessionId?: number | null): Promise<void>;
  addListener(eventName: 'onSpeechState', listener: (event: SpeechStateEvent) => void): NativeSpeechSubscription;
  addListener(eventName: 'onSpeechVolume', listener: (event: SpeechVolumeEvent) => void): NativeSpeechSubscription;
  addListener(eventName: 'onSpeechPartial', listener: (event: SpeechTextEvent) => void): NativeSpeechSubscription;
  addListener(eventName: 'onSpeechResult', listener: (event: SpeechTextEvent) => void): NativeSpeechSubscription;
  addListener(eventName: 'onSpeechError', listener: (event: SpeechErrorEvent) => void): NativeSpeechSubscription;
}

function findNativeSpeechModule(): NativeSpeechModule | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  try {
    return requireOptionalNativeModule<NativeSpeechModule>('OctSpeech');
  } catch {
    return null;
  }
}

const nativeSpeech = findNativeSpeechModule();

function granted(value: boolean | { granted?: boolean; status?: string }): boolean {
  return typeof value === 'boolean' ? value : value.granted === true || value.status === 'granted';
}

export function isNativeSpeechLinked(): boolean {
  return nativeSpeech !== null;
}

export function getNativeSpeechCapability(): SpeechCapability {
  if (nativeSpeech) {
    try {
      return nativeSpeech.getCapability();
    } catch {
      return {
        available: false,
        onDeviceAvailable: false,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        reason: 'Native speech module could not be queried.',
      };
    }
  }
  return {
    available: false,
    onDeviceAvailable: false,
    platform: Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'ios' : 'android',
    reason: 'Native speech recognition requires an Expo dev or release build.',
  };
}

export async function getNativeSpeechPermission(): Promise<boolean> {
  if (!nativeSpeech) return false;
  return nativeSpeech.getPermissionAsync();
}

export async function requestNativeSpeechPermission(): Promise<boolean> {
  if (!nativeSpeech) return false;
  return granted(await nativeSpeech.requestPermissionAsync());
}

export async function startNativeSpeech(options?: SpeechStartOptions): Promise<number> {
  if (!nativeSpeech) throw new Error('Native speech recognition is not linked in this build.');
  const result = await nativeSpeech.startListeningAsync(options);
  return result.sessionId;
}

export async function stopNativeSpeech(sessionId?: number): Promise<void> {
  if (!nativeSpeech) return;
  await nativeSpeech.stopListeningAsync(sessionId ?? null);
}

export async function cancelNativeSpeech(sessionId?: number): Promise<void> {
  if (!nativeSpeech) return;
  await nativeSpeech.cancelListeningAsync(sessionId ?? null);
}

export interface SpeechListeners {
  onState?: (event: SpeechStateEvent) => void;
  onVolume?: (event: SpeechVolumeEvent) => void;
  onPartial?: (event: SpeechTextEvent) => void;
  onResult?: (event: SpeechTextEvent) => void;
  onError?: (event: SpeechErrorEvent) => void;
}

export function subscribeNativeSpeech(listeners: SpeechListeners): () => void {
  if (!nativeSpeech) return () => {};
  const subs: NativeSpeechSubscription[] = [];
  if (listeners.onState) subs.push(nativeSpeech.addListener('onSpeechState', listeners.onState));
  if (listeners.onVolume) subs.push(nativeSpeech.addListener('onSpeechVolume', listeners.onVolume));
  if (listeners.onPartial) subs.push(nativeSpeech.addListener('onSpeechPartial', listeners.onPartial));
  if (listeners.onResult) subs.push(nativeSpeech.addListener('onSpeechResult', listeners.onResult));
  if (listeners.onError) subs.push(nativeSpeech.addListener('onSpeechError', listeners.onError));
  return () => {
    for (const sub of subs) {
      try {
        sub.remove();
      } catch {
        // Ignore cleanup errors on unmount.
      }
    }
  };
}
