import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

function androidHaptic(primary: Haptics.AndroidHaptics, fallback?: Haptics.AndroidHaptics): void {
  void Haptics.performAndroidHapticsAsync(primary).catch(() => {
    if (fallback) {
      void Haptics.performAndroidHapticsAsync(fallback).catch(() => {});
    }
  });
}

/** Crisp micro-tick for selections: tabs, chips, keypad keys, steppers, date cells, segmented switches. */
export function hapticSelection(): void {
  if (Platform.OS === 'android') {
    androidHaptic(Haptics.AndroidHaptics.Clock_Tick);
    return;
  }
  if (Platform.OS === 'ios') {
    void Haptics.selectionAsync().catch(() => {});
  }
}

/** Crisp tap for soft actions: opening menus/editors, pinning, +water, undo, range switches. */
export function hapticLight(): void {
  if (Platform.OS === 'android') {
    androidHaptic(Haptics.AndroidHaptics.Context_Click);
    return;
  }
  if (Platform.OS === 'ios') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

/** Firm detent for high-intent transitions: hold activation, drag lift, meal toggle, detail open. */
export function hapticMedium(): void {
  if (Platform.OS === 'android') {
    androidHaptic(Haptics.AndroidHaptics.Long_Press);
    return;
  }
  if (Platform.OS === 'ios') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }
}

/** Distinct confirmation feedback: logging meals/foods, saving custom units/foods/goals, day complete, drop landed. */
export function hapticSuccess(): void {
  if (Platform.OS === 'android') {
    androidHaptic(Haptics.AndroidHaptics.Confirm, Haptics.AndroidHaptics.Context_Click);
    return;
  }
  if (Platform.OS === 'ios') {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
}

/** Distinct warning detent for destructive actions: deleting entries/foods/units, discarding drafts, clearing water. */
export function hapticWarning(): void {
  if (Platform.OS === 'android') {
    androidHaptic(Haptics.AndroidHaptics.Reject, Haptics.AndroidHaptics.Long_Press);
    return;
  }
  if (Platform.OS === 'ios') {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }
}
