import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { createUnavailableHealthPort } from '../../src/health/healthPort';
import type {
  ExternalNutritionPayload,
  ExternalWeightSample,
  HealthCapability,
  HealthPermissionsState,
  HealthPermissionScope,
  HealthPlatformPort,
} from '../../src/health/types';

interface OctHealthNativeModule {
  getCapability(): HealthCapability;
  getPermissionsAsync(): Promise<HealthPermissionsState>;
  requestPermissionsAsync(scopes: HealthPermissionScope[]): Promise<HealthPermissionsState>;
  writeNutritionAsync(payload: ExternalNutritionPayload, existingExternalId: string | null): Promise<{ externalRecordId: string }>;
  deleteNutritionAsync(externalRecordId: string): Promise<void>;
  readWeightSamplesAsync(sinceIsoDate: string | null): Promise<ExternalWeightSample[]>;
}

const nativeModule = requireOptionalNativeModule<OctHealthNativeModule>('OctHealth');

export function isNativeHealthModuleLinked(): boolean {
  return nativeModule !== null;
}

export function createNativeHealthPort(os: string = Platform.OS): HealthPlatformPort {
  if (nativeModule === null) return createUnavailableHealthPort(os);
  return {
    getCapability: () => nativeModule.getCapability(),
    getPermissions: () => nativeModule.getPermissionsAsync(),
    requestPermissions: scopes => nativeModule.requestPermissionsAsync(scopes),
    writeNutrition: (payload, existingExternalId) => nativeModule.writeNutritionAsync(payload, existingExternalId ?? null),
    deleteNutrition: externalRecordId => nativeModule.deleteNutritionAsync(externalRecordId),
    readWeightSamples: sinceIsoDate => nativeModule.readWeightSamplesAsync(sinceIsoDate ?? null),
  };
}
