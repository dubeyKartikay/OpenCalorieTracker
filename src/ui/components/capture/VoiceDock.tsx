import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  cancelNativeSpeech,
  getNativeSpeechCapability,
  getNativeSpeechPermission,
  isNativeSpeechLinked,
  requestNativeSpeechPermission,
  startNativeSpeech,
  stopNativeSpeech,
  subscribeNativeSpeech,
} from '../../../../modules/oct-speech';
import { hapticLight, hapticSelection } from '../../haptics';
import { colors, SCREEN_GUTTER } from '../../tokens';

const BAR_COUNT = 24;
const DOCK_HEIGHT = 212;

/** Exact Doop SysKeyboard (.kb-wf i) 24-bar height weights. */
const BAR_WEIGHTS: readonly number[] = Array.from({ length: BAR_COUNT }, (_, index) => {
  const n = index + 1;
  let weight = 0.22;
  if (n % 3 === 0) weight = 0.64;
  if (n % 4 === 0) weight = 0.92;
  if (n % 5 === 0) weight = 0.36;
  if (n % 7 === 0) weight = 0.74;
  return weight;
});

/** Cleanly joins dictated speech onto any existing text in the focused field. */
export function mergeDictatedTranscript(prefix: string, spoken: string): string {
  const base = prefix.trim();
  const addition = spoken.trim().replace(/\s+/g, ' ');
  if (!addition) return base;
  if (!base) return addition;
  return `${base} ${addition}`;
}

interface WebSpeechRecognitionEvent {
  results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }>;
}

interface WebSpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type WebSpeechRecognitionCtor = new () => WebSpeechRecognitionInstance;

function getWebSpeechRecognitionCtor(): WebSpeechRecognitionCtor | null {
  if (Platform.OS !== 'web') return null;
  const g = globalThis as unknown as {
    SpeechRecognition?: WebSpeechRecognitionCtor;
    webkitSpeechRecognition?: WebSpeechRecognitionCtor;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

export interface UseVoiceDictationOptions {
  onText: (value: string) => void;
  onError?: (message: string) => void;
}

export interface VoiceDictationController {
  status: 'idle' | 'starting' | 'listening';
  active: boolean;
  level: number;
  start: (initialText?: string) => Promise<boolean>;
  stop: () => void;
  cancel: () => void;
}

export function useVoiceDictation({ onText, onError }: UseVoiceDictationOptions): VoiceDictationController {
  const [status, setStatus] = useState<'idle' | 'starting' | 'listening'>('idle');
  const [level, setLevel] = useState(0);
  const onTextRef = useRef(onText);
  const onErrorRef = useRef(onError);
  const prefixRef = useRef('');
  const attemptIdRef = useRef(0);
  const sessionIdRef = useRef(0);
  const stoppingAttemptRef = useRef<number | null>(null);
  const webRecognitionRef = useRef<WebSpeechRecognitionInstance | null>(null);

  useEffect(() => {
    onTextRef.current = onText;
    onErrorRef.current = onError;
  }, [onError, onText]);

  useEffect(() => {
    if (!isNativeSpeechLinked()) return;
    return subscribeNativeSpeech({
      onState: event => {
        if (event.sessionId !== sessionIdRef.current) return;
        const isStopping = stoppingAttemptRef.current === attemptIdRef.current;
        if (event.state === 'ended') {
          if (isStopping) sessionIdRef.current = 0;
          stoppingAttemptRef.current = null;
          setStatus('idle');
          setLevel(0);
        } else if (!isStopping) {
          setStatus(event.state);
        }
      },
      onVolume: event => {
        if (event.sessionId !== sessionIdRef.current || stoppingAttemptRef.current === attemptIdRef.current) return;
        setLevel(Math.max(0, Math.min(1, event.level)));
      },
      onPartial: event => {
        if (event.sessionId !== sessionIdRef.current || stoppingAttemptRef.current === attemptIdRef.current) return;
        onTextRef.current(mergeDictatedTranscript(prefixRef.current, event.text));
      },
      onResult: event => {
        if (event.sessionId !== sessionIdRef.current) return;
        onTextRef.current(mergeDictatedTranscript(prefixRef.current, event.text));
        if (stoppingAttemptRef.current === attemptIdRef.current) {
          sessionIdRef.current = 0;
          stoppingAttemptRef.current = null;
        }
      },
      onError: event => {
        if (event.sessionId !== sessionIdRef.current) return;
        const wasStopping = stoppingAttemptRef.current === attemptIdRef.current;
        stoppingAttemptRef.current = null;
        sessionIdRef.current = 0;
        setStatus('idle');
        setLevel(0);
        if (!wasStopping && event.message) {
          onErrorRef.current?.(event.message);
        }
      },
    });
  }, []);

  const cancel = useCallback(() => {
    const activeSession = sessionIdRef.current;
    attemptIdRef.current += 1;
    sessionIdRef.current = 0;
    stoppingAttemptRef.current = null;
    setStatus('idle');
    setLevel(0);
    if (webRecognitionRef.current) {
      const prior = webRecognitionRef.current;
      webRecognitionRef.current = null;
      prior.onstart = null;
      prior.onend = null;
      prior.onerror = null;
      prior.onresult = null;
      try {
        prior.abort();
      } catch {
        // Ignore browser abort errors.
      }
    }
    if (isNativeSpeechLinked() && activeSession > 0) {
      void cancelNativeSpeech(activeSession);
    }
  }, []);

  const stop = useCallback(() => {
    const activeAttempt = attemptIdRef.current;
    const activeSession = sessionIdRef.current;
    stoppingAttemptRef.current = activeAttempt;
    setStatus('idle');
    setLevel(0);
    if (webRecognitionRef.current) {
      const activeRecognition = webRecognitionRef.current;
      webRecognitionRef.current = null;
      try {
        activeRecognition.stop();
      } catch {
        // Ignore browser stop errors.
      }
      return;
    }
    if (isNativeSpeechLinked()) {
      if (activeSession === 0) {
        // Permission or startup still pending — invalidate attempt so start() cancels only its own sessionId on resolve.
        attemptIdRef.current += 1;
        stoppingAttemptRef.current = null;
      } else {
        void stopNativeSpeech(activeSession);
      }
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async (initialText = ''): Promise<boolean> => {
    Keyboard.dismiss();
    const myAttempt = ++attemptIdRef.current;
    sessionIdRef.current = 0;
    stoppingAttemptRef.current = null;
    prefixRef.current = initialText;

    if (Platform.OS === 'web') {
      const Ctor = getWebSpeechRecognitionCtor();
      if (!Ctor) {
        onErrorRef.current?.('Voice dictation is not supported in this browser.');
        return false;
      }
      if (webRecognitionRef.current) {
        const prior = webRecognitionRef.current;
        webRecognitionRef.current = null;
        prior.onstart = null;
        prior.onend = null;
        prior.onerror = null;
        prior.onresult = null;
        try {
          prior.abort();
        } catch {
          // Ignore prior session cleanup errors.
        }
      }
      const recognition = new Ctor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => {
        if (attemptIdRef.current !== myAttempt || webRecognitionRef.current !== recognition) return;
        setStatus('listening');
      };
      recognition.onend = () => {
        if (webRecognitionRef.current === recognition) webRecognitionRef.current = null;
        if (attemptIdRef.current !== myAttempt) return;
        stoppingAttemptRef.current = null;
        setStatus('idle');
        setLevel(0);
      };
      recognition.onerror = event => {
        if (webRecognitionRef.current === recognition) webRecognitionRef.current = null;
        if (attemptIdRef.current !== myAttempt) return;
        const wasStopping = stoppingAttemptRef.current === myAttempt;
        stoppingAttemptRef.current = null;
        setStatus('idle');
        setLevel(0);
        if (!wasStopping && event.error !== 'aborted') {
          onErrorRef.current?.(
            event.error === 'not-allowed'
              ? 'Microphone permission is required for voice dictation.'
              : 'Voice dictation could not hear speech. Tap the mic to try again.',
          );
        }
      };
      recognition.onresult = event => {
        if (attemptIdRef.current !== myAttempt) return;
        const isStopping = stoppingAttemptRef.current === myAttempt;
        const parts: string[] = [];
        let hasFinal = false;
        for (let i = 0; i < event.results.length; i += 1) {
          const item = event.results[i];
          const transcript = item?.[0]?.transcript;
          if (transcript) parts.push(transcript);
          if (item?.isFinal) hasFinal = true;
        }
        if (isStopping && !hasFinal) return;
        onTextRef.current(mergeDictatedTranscript(prefixRef.current, parts.join(' ')));
        if (isStopping) {
          stoppingAttemptRef.current = null;
          attemptIdRef.current += 1;
        } else {
          setLevel(0.65);
        }
      };
      webRecognitionRef.current = recognition;
      setStatus('starting');
      try {
        recognition.start();
        return true;
      } catch {
        if (webRecognitionRef.current === recognition) webRecognitionRef.current = null;
        if (attemptIdRef.current === myAttempt) setStatus('idle');
        onErrorRef.current?.('Could not start browser voice dictation.');
        return false;
      }
    }

    if (!isNativeSpeechLinked()) {
      onErrorRef.current?.('Native voice dictation requires the installed app build.');
      return false;
    }

    const capability = getNativeSpeechCapability();
    if (!capability.available) {
      onErrorRef.current?.(capability.reason ?? 'No speech recognition service is available on this device.');
      return false;
    }

    let granted = await getNativeSpeechPermission();
    if (attemptIdRef.current !== myAttempt) return false;
    if (!granted) {
      granted = await requestNativeSpeechPermission();
      if (attemptIdRef.current !== myAttempt) return false;
    }
    if (!granted) {
      onErrorRef.current?.('Microphone permission is required for voice dictation.');
      return false;
    }

    setStatus('starting');
    setLevel(0);
    try {
      const sessionId = await startNativeSpeech();
      if (attemptIdRef.current !== myAttempt) {
        void cancelNativeSpeech(sessionId);
        return false;
      }
      sessionIdRef.current = sessionId;
      return true;
    } catch (error) {
      if (attemptIdRef.current === myAttempt) {
        setStatus('idle');
        setLevel(0);
        onErrorRef.current?.(error instanceof Error ? error.message : 'Could not start voice dictation.');
      }
      return false;
    }
  }, []);

  return {
    status,
    active: status !== 'idle',
    level,
    start,
    stop,
    cancel,
  };
}

interface WaveformBarProps {
  index: number;
  weight: number;
  phase: SharedValue<number>;
  smoothLevel: SharedValue<number>;
  openProgress: SharedValue<number>;
  reducedMotion: boolean;
}

/** Single UI-thread animated bar that blooms outward from center on open and collapses cleanly on close. */
function WaveformBar({ index, weight, phase, smoothLevel, openProgress, reducedMotion }: WaveformBarProps) {
  const centerDist = Math.abs(index - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2); // 0 at center, 1 at edges
  const gaussian = Math.exp(-centerDist * centerDist * 1.45);

  const barStyle = useAnimatedStyle(() => {
    // Center bars bloom first on open and linger slightly on close for a liquid ribbon effect.
    const staggerStart = centerDist * 0.34;
    const bloom = interpolate(
      openProgress.value,
      [staggerStart, Math.min(1, staggerStart + 0.66)],
      [0, 1],
      Extrapolation.CLAMP,
    );

    if (reducedMotion) {
      return {
        opacity: 0.9 * bloom,
        transform: [{ scaleY: Math.max(0.08, weight * bloom) }],
      };
    }

    const t = phase.value;
    const waveA = 0.5 + 0.5 * Math.sin(t * 2.4 + index * 0.52);
    const waveB = 0.5 + 0.5 * Math.sin(t * 3.7 - index * 0.37 + 1.1);
    const harmonic = waveA * 0.65 + waveB * 0.35;

    const live = smoothLevel.value;
    const idleHeight = 0.16 + weight * (0.42 + 0.26 * harmonic);
    const liveBoost = live * (0.34 + 0.62 * gaussian) * (0.58 + 0.42 * harmonic);
    const targetScale = Math.max(0.14, Math.min(1, idleHeight + liveBoost));

    return {
      opacity: interpolate(bloom, [0, 0.4, 1], [0, 0.65, 0.84 + live * 0.16], Extrapolation.CLAMP),
      transform: [{ scaleY: Math.max(0.06, targetScale * bloom) }],
    };
  });

  return <Animated.View style={[styles.bar, barStyle]} />;
}

export interface VoiceMicRingProps {
  /** Whether voice dictation is currently active on this button. */
  active: boolean;
  /** Button width/height in dp (e.g. 40 on Today, 32 on Library). */
  size: number;
  /** Button corner radius in dp (e.g. 20 on Today, 10 on Library). */
  borderRadius: number;
}

/** Dual concentric sonar rings pulsing softly around an active mic button. */
export function VoiceMicRing({ active, size, borderRadius }: VoiceMicRingProps) {
  const reducedMotion = useReducedMotion();
  const ringA = useSharedValue(0);
  const ringB = useSharedValue(0);

  useEffect(() => {
    if (active && !reducedMotion) {
      ringA.set(0);
      ringB.set(0);
      ringA.set(withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }), -1, false));
      ringB.set(withDelay(750, withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }), -1, false)));
    } else {
      cancelAnimation(ringA);
      cancelAnimation(ringB);
      ringA.set(withTiming(0, { duration: 180 }));
      ringB.set(withTiming(0, { duration: 180 }));
    }
    return () => {
      cancelAnimation(ringA);
      cancelAnimation(ringB);
    };
  }, [active, reducedMotion, ringA, ringB]);

  const styleA = useAnimatedStyle(() => ({
    opacity: active && !reducedMotion ? interpolate(ringA.value, [0, 0.15, 1], [0, 0.55, 0], Extrapolation.CLAMP) : 0,
    transform: [{ scale: interpolate(ringA.value, [0, 1], [1, 1.56], Extrapolation.CLAMP) }],
  }));

  const styleB = useAnimatedStyle(() => ({
    opacity: active && !reducedMotion ? interpolate(ringB.value, [0, 0.15, 1], [0, 0.45, 0], Extrapolation.CLAMP) : 0,
    transform: [{ scale: interpolate(ringB.value, [0, 1], [1, 1.56], Extrapolation.CLAMP) }],
  }));

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.micSonar,
          { width: size, height: size, borderRadius },
          styleA,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.micSonar,
          { width: size, height: size, borderRadius },
          styleB,
        ]}
      />
    </>
  );
}

export interface VoiceDockProps {
  /** Controls smooth animated open & close transitions. */
  visible: boolean;
  /** Normalized live microphone volume in [0, 1]. */
  level: number;
  /** Called when the user taps the red Stop button. */
  onStop: () => void;
  /** Optional negative horizontal margin to bleed flush edge-to-edge inside padded footers. */
  flushMarginHorizontal?: number;
  /** Optional negative bottom margin to sit flush against the tab bar inside padded footers. */
  flushMarginBottom?: number;
}

/**
 * Exact Doop SysKeyboard (data-mode="listening") 24-bar reactive waveform pill + Stop button,
 * with choreographed Reanimated UI-thread open/close and center-bloom bar animations.
 */
export function VoiceDock({
  visible,
  level,
  onStop,
  flushMarginHorizontal = -SCREEN_GUTTER,
  flushMarginBottom = -8,
}: VoiceDockProps) {
  const reducedMotion = useReducedMotion();
  const [rendered, setRendered] = useState(visible);
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible && !rendered) setRendered(true);
  }
  const openProgress = useSharedValue(visible ? 1 : 0);
  const stopProgress = useSharedValue(visible ? 1 : 0);
  const stopPressScale = useSharedValue(1);
  const smoothLevel = useSharedValue(0);
  const phase = useSharedValue(0);
  const prevVisibleRef = useRef(visible);

  // Smooth VU-meter damping: fast attack on speech, organic decay on silence.
  useEffect(() => {
    const clamped = Math.max(0, Math.min(1, level));
    const rising = clamped > smoothLevel.value;
    smoothLevel.set(
      withTiming(clamped, {
        duration: rising ? 65 : 170,
        easing: rising ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      }),
    );
  }, [level, smoothLevel]);

  // Choreographed open & close transitions.
  useEffect(() => {
    const changed = prevVisibleRef.current !== visible;
    prevVisibleRef.current = visible;

    if (visible) {
      if (changed) {
        hapticLight();
      }
      if (reducedMotion) {
        openProgress.set(1);
        stopProgress.set(1);
      } else {
        openProgress.set(withSpring(1, { damping: 22, stiffness: 260, mass: 0.85 }));
        stopProgress.set(withDelay(55, withSpring(1, { damping: 18, stiffness: 280, mass: 0.8 })));
        phase.set(0);
        phase.set(withRepeat(withTiming(Math.PI * 200, { duration: 180_000, easing: Easing.linear }), -1, false));
      }
    } else if (rendered) {
      if (changed) {
        hapticSelection();
      }
      if (reducedMotion) {
        cancelAnimation(phase);
        openProgress.set(0);
        stopProgress.set(0);
        // Defer unmount slightly outside render.
        const t = setTimeout(() => setRendered(false), 0);
        return () => clearTimeout(t);
      }
      stopProgress.set(withTiming(0, { duration: 150, easing: Easing.in(Easing.cubic) }));
      openProgress.set(
        withTiming(0, { duration: 240, easing: Easing.inOut(Easing.cubic) }, finished => {
          if (finished) {
            cancelAnimation(phase);
            runOnJS(setRendered)(false);
          }
        }),
      );
    }
    return undefined;
  }, [openProgress, phase, reducedMotion, rendered, stopProgress, visible]);

  useEffect(() => {
    return () => {
      cancelAnimation(phase);
      cancelAnimation(openProgress);
      cancelAnimation(stopProgress);
      cancelAnimation(smoothLevel);
    };
  }, [openProgress, phase, smoothLevel, stopProgress]);

  const dockStyle = useAnimatedStyle(() => ({
    height: interpolate(openProgress.value, [0, 1], [0, DOCK_HEIGHT], Extrapolation.CLAMP),
    opacity: interpolate(openProgress.value, [0, 0.25, 1], [0, 0.9, 1], Extrapolation.CLAMP),
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(openProgress.value, [0, 1], [44, 0], Extrapolation.CLAMP) }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(openProgress.value, [0, 0.3, 1], [0, 0.85, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(openProgress.value, [0, 1], [16, 0], Extrapolation.CLAMP) },
      { scale: interpolate(openProgress.value, [0, 1], [0.88, 1], Extrapolation.CLAMP) },
    ],
    borderColor: `rgba(122, 162, 247, ${(0.12 + smoothLevel.value * 0.34) * openProgress.value})`,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(openProgress.value, [0, 0.5, 1], [0, 0.08, 0.14 + smoothLevel.value * 0.18], Extrapolation.CLAMP),
    transform: [{ scale: 0.92 + openProgress.value * 0.08 + smoothLevel.value * 0.1 }],
  }));

  const stopWrapStyle = useAnimatedStyle(() => ({
    opacity: interpolate(stopProgress.value, [0, 0.4, 1], [0, 0.9, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(stopProgress.value, [0, 1], [-10, 0], Extrapolation.CLAMP) },
      { scale: interpolate(stopProgress.value, [0, 1], [0.72, 1], Extrapolation.CLAMP) * stopPressScale.value },
    ],
  }));

  const stopSquareStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(stopProgress.value, [0, 1], [-22, 0], Extrapolation.CLAMP)}deg` }],
  }));

  if (!rendered) return null;

  return (
    <Animated.View
      accessibilityLabel="Voice dictation active"
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.dockOuter,
        {
          marginHorizontal: flushMarginHorizontal,
          marginBottom: flushMarginBottom,
        },
        dockStyle,
      ]}
    >
      <Animated.View style={[styles.dockInner, sheetStyle]}>
        <View style={styles.row}>
          <View style={styles.pillContainer}>
            <Animated.View pointerEvents="none" style={[styles.pillGlow, glowStyle]} />
            <Animated.View style={[styles.pill, pillStyle]} accessible={false}>
              {BAR_WEIGHTS.map((weight, index) => (
                <WaveformBar
                  key={index}
                  index={index}
                  weight={weight}
                  phase={phase}
                  smoothLevel={smoothLevel}
                  openProgress={openProgress}
                  reducedMotion={reducedMotion}
                />
              ))}
            </Animated.View>
          </View>
          <Animated.View style={stopWrapStyle}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop dictation"
              onPressIn={() => {
                stopPressScale.set(withTiming(0.88, { duration: 90 }));
              }}
              onPressOut={() => {
                stopPressScale.set(withSpring(1, { damping: 16, stiffness: 320 }));
              }}
              onPress={onStop}
              style={({ pressed }) => [styles.stop, pressed && styles.stopPressed]}
            >
              <Animated.View style={[styles.stopSquare, stopSquareStyle]} />
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dockOuter: {
    overflow: 'hidden',
    backgroundColor: colors.dock,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  dockInner: {
    height: DOCK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
  },
  pillContainer: {
    position: 'relative',
    width: 266,
    maxWidth: '78%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillGlow: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 4,
    bottom: 4,
    borderRadius: 20,
    backgroundColor: colors.accent,
  },
  pill: {
    width: '100%',
    height: 54,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 162, 247, 0.14)',
    backgroundColor: 'rgba(41, 46, 66, 0.82)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  bar: {
    flex: 1,
    height: 44,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  stop: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  stopPressed: {
    backgroundColor: colors.raised,
  },
  stopSquare: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: colors.danger,
  },
  micSonar: {
    position: 'absolute',
    borderWidth: 1.75,
    borderColor: colors.accent,
  },
});
