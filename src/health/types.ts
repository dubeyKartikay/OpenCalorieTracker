import type { WeighIn } from '../domain/types';

export type HealthPlatformKind = 'apple_health' | 'health_connect';
export type HealthPermissionScope = 'nutrition_write' | 'weight_read';
export interface HealthPermissionsState { nutritionWrite: boolean; weightRead: boolean }
export interface HealthCapability {
  platform: HealthPlatformKind | null;
  available: boolean;
  label: string;
  description: string;
}

/** Unknown optional nutrients must be omitted, rather than exported as zero. */
export interface ExternalNutritionPayload {
  entryId: string;
  occurredAt: string;
  meal: string;
  foodName: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
  satFatG?: number;
  sodiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  potassiumMg?: number;
  sourceAppId: string;
}

export interface ExternalWeightSample {
  externalId: string;
  date: string;
  measuredAt: string;
  weightKg: number;
  sourceAppId?: string | null;
}

/** Native adapters report actual linked availability and OS permission state. */
export interface HealthPlatformPort {
  getCapability(): HealthCapability;
  getPermissions(): Promise<HealthPermissionsState>;
  requestPermissions(scopes: HealthPermissionScope[]): Promise<HealthPermissionsState>;
  writeNutrition(payload: ExternalNutritionPayload, existingExternalId?: string): Promise<{ externalRecordId: string }>;
  deleteNutrition(externalRecordId: string): Promise<void>;
  readWeightSamples(sinceIsoDate?: string): Promise<ExternalWeightSample[]>;
}

export interface HealthSyncRecord {
  entry_id: string;
  platform: HealthPlatformKind;
  external_record_id: string;
  synced_at: string;
  status: 'synced' | 'deleted';
}

/** Narrow persistence boundaries; composition wires repositories into these. */
export interface HealthSyncRecordPort {
  getRecord(entryId: string): Promise<HealthSyncRecord | null>;
  upsertRecord(record: HealthSyncRecord): Promise<void>;
  deleteRecord(entryId: string): Promise<void>;
}

export interface HealthWeightStorePort {
  listWeighIns(): Promise<WeighIn[]>;
  recordWeighIn(weighIn: WeighIn): Promise<WeighIn>;
}
