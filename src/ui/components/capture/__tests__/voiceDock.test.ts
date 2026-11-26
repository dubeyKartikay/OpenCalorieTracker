import { describe, expect, it, vi } from 'vitest';
import {
  getNativeSpeechCapability,
  isNativeSpeechLinked,
} from '../../../../../modules/oct-speech';
import { mergeDictatedTranscript } from '../VoiceDock';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Keyboard: { dismiss() {} },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  Easing: { linear: () => 0, out: () => () => 0, in: () => () => 0, inOut: () => () => 0, quad: () => 0, cubic: () => 0 },
  Extrapolation: { CLAMP: 'clamp' },
  cancelAnimation: () => {},
  interpolate: (_v: number, _i: number[], o: number[]) => o[0] ?? 0,
  runOnJS: <T,>(fn: T) => fn,
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: <T,>(value: T) => ({ value, set() {} }),
  withDelay: (_d: number, v: unknown) => v,
  withRepeat: (v: unknown) => v,
  withSpring: (v: unknown) => v,
  withTiming: (v: unknown) => v,
}));

vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: async () => {},
  selectionAsync: async () => {},
}));

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => null,
}));

describe('mergeDictatedTranscript', () => {
  it('returns cleaned spoken text when field starts empty', () => {
    expect(mergeDictatedTranscript('', '  2 rotis   and dal  ')).toBe('2 rotis and dal');
  });

  it('appends spoken text cleanly to an existing prefix', () => {
    expect(mergeDictatedTranscript('2 rotis ', 'and   dal')).toBe('2 rotis and dal');
  });

  it('keeps the existing prefix when spoken text is blank', () => {
    expect(mergeDictatedTranscript('oats', '   ')).toBe('oats');
  });
});

describe('oct-speech guarded bridge', () => {
  it('reports unavailable safely when native module is not linked', () => {
    expect(isNativeSpeechLinked()).toBe(false);
    expect(getNativeSpeechCapability()).toMatchObject({
      available: false,
      onDeviceAvailable: false,
      platform: 'web',
    });
  });
});
