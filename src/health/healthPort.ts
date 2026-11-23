import type { HealthCapability, HealthPlatformPort } from './types';

export const APP_HEALTH_SOURCE_ID = 'org.opencalorietracker.app';

/** OS support is not evidence that a native adapter is linked or authorized. */
export function getDefaultHealthCapability(os: 'ios' | 'android' | 'web' | string): HealthCapability {
  if (os === 'ios') {
    return {
      platform: 'apple_health', available: false, label: 'Apple Health',
      description: 'Apple Health (HealthKit) requires a native development build with a linked adapter and HealthKit entitlement. Unavailable in Expo Go and unlinked builds.',
    };
  }
  if (os === 'android') {
    return {
      platform: 'health_connect', available: false, label: 'Health Connect',
      description: 'Health Connect requires a native development build with a linked adapter and Health Connect support on the device. Unavailable in Expo Go and unlinked builds.',
    };
  }
  return {
    platform: null, available: false, label: 'Health connection unavailable',
    description: os === 'web'
      ? 'OS health connections are not applicable on the web preview. Use the iOS or Android app with a linked native adapter.'
      : 'OS health connections are supported only in iOS and Android apps with a linked native adapter.',
  };
}

export class HealthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HealthUnavailableError';
  }
}

/** Safe fallback for web previews, Expo Go, and builds without native adapters. */
export function createUnavailableHealthPort(os: string = 'web'): HealthPlatformPort {
  const capability = getDefaultHealthCapability(os);
  const unavailable = async (): Promise<never> => {
    throw new HealthUnavailableError(capability.description);
  };
  return {
    getCapability: () => ({ ...capability }),
    getPermissions: async () => ({ nutritionWrite: false, weightRead: false }),
    requestPermissions: async () => ({ nutritionWrite: false, weightRead: false }),
    writeNutrition: unavailable,
    deleteNutrition: unavailable,
    readWeightSamples: unavailable,
  };
}
