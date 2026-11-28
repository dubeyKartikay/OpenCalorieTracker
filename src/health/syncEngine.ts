import { generateId } from '../domain/ids';
import { weighInSchema } from '../domain/schemas';
import type { DiaryEntrySnapshot } from '../domain/types';
import { APP_HEALTH_SOURCE_ID } from './healthPort';
import type {
  ExternalNutritionPayload, HealthPlatformPort, HealthSyncRecordPort, HealthWeightStorePort,
} from './types';

export interface HealthSyncEngineOptions {
  port: HealthPlatformPort;
  records: HealthSyncRecordPort;
  weights: HealthWeightStorePort;
  isNutritionWriteEnabled: () => boolean | Promise<boolean>;
  isWeightReadEnabled: () => boolean | Promise<boolean>;
}

export interface HealthSyncResult { synced: boolean; error?: string }
export interface HealthWeightImportResult {
  imported: number;
  skippedDuplicates: number;
  skippedOwnWrites: number;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The health connection could not complete this request.';
}

function nutritionPayload(entry: DiaryEntrySnapshot): ExternalNutritionPayload {
  const nutrients = entry.nutrients;
  const payload: ExternalNutritionPayload = {
    entryId: entry.id, occurredAt: entry.occurred_at, meal: entry.meal,
    foodName: entry.food.name, kcal: nutrients.kcal,
    proteinG: nutrients.protein_g, carbsG: nutrients.carbs_g, fatG: nutrients.fat_g,
    sourceAppId: APP_HEALTH_SOURCE_ID,
  };
  const optionalFields = [
    ['fiber_g', 'fiberG'], ['sugar_g', 'sugarG'], ['sat_fat_g', 'satFatG'],
    ['sodium_mg', 'sodiumMg'], ['calcium_mg', 'calciumMg'],
    ['iron_mg', 'ironMg'], ['potassium_mg', 'potassiumMg'],
  ] as const;
  for (const [source, target] of optionalFields) {
    const value = nutrients[source];
    if (value != null) payload[target] = value;
  }
  return payload;
}

/** Best-effort external effects: health failures never block local diary saves. */
export class HealthSyncEngine {
  constructor(private readonly options: HealthSyncEngineOptions) {}

  async syncEntryConfirmed(entry: DiaryEntrySnapshot): Promise<HealthSyncResult> {
    try {
      const { port, records, isNutritionWriteEnabled } = this.options;
      const { available, platform } = port.getCapability();
      if (entry.draft_state !== 'confirmed' || !available || platform === null || !await isNutritionWriteEnabled()) {
        return { synced: false };
      }
      if (!(await port.getPermissions()).nutritionWrite) return { synced: false };
      const record = await records.getRecord(entry.id);
      if (record && record.platform !== platform) {
        return { synced: false, error: 'This entry is linked to a different health platform.' };
      }
      const existingExternalId = record?.status === 'synced' ? record.external_record_id : undefined;
      const { externalRecordId } = await port.writeNutrition(nutritionPayload(entry), existingExternalId);
      await records.upsertRecord({
        entry_id: entry.id, platform, external_record_id: externalRecordId,
        synced_at: new Date().toISOString(), status: 'synced',
      });
      return { synced: true };
    } catch (error) {
      return { synced: false, error: errorMessage(error) };
    }
  }

  async syncEntryDeleted(entryId: string): Promise<HealthSyncResult> {
    try {
      const { port, records, isNutritionWriteEnabled } = this.options;
      const record = await records.getRecord(entryId);
      if (!record) return { synced: false };
      if (record.status !== 'deleted') {
        await records.upsertRecord({ ...record, status: 'deleted' }).catch(() => undefined);
      }
      const { available, platform } = port.getCapability();
      if (!available || platform !== record.platform || !await isNutritionWriteEnabled()) {
        return { synced: false };
      }
      if (!(await port.getPermissions()).nutritionWrite) {
        return { synced: false };
      }
      try {
        await port.deleteNutrition(record.external_record_id);
      } catch (error) {
        return { synced: false, error: errorMessage(error) };
      }
      await records.deleteRecord(entryId);
      return { synced: true };
    } catch (error) {
      return { synced: false, error: errorMessage(error) };
    }
  }

  async flushPendingDeletes(
    schedule?: (entryId: string, run: () => Promise<HealthSyncResult>) => Promise<HealthSyncResult>,
  ): Promise<number> {
    if (!this.options.records.listRecords) return 0;
    try {
      const { available, platform } = this.options.port.getCapability();
      if (!available || platform === null) return 0;
      const all = await this.options.records.listRecords(platform);
      const pending = all.filter(record => record.status === 'deleted');
      const results = await Promise.all(
        pending.map(record => {
          const run = () => this.syncEntryDeleted(record.entry_id);
          return schedule ? schedule(record.entry_id, run) : run();
        }),
      );
      return results.filter(result => result.synced).length;
    } catch {
      return 0;
    }
  }

  async importWeightSamples(sinceIsoDate?: string): Promise<HealthWeightImportResult> {
    const result: HealthWeightImportResult = { imported: 0, skippedDuplicates: 0, skippedOwnWrites: 0 };
    try {
      const { port, weights, isWeightReadEnabled } = this.options;
      const { available, platform } = port.getCapability();
      if (!available || platform === null || !await isWeightReadEnabled()) return result;
      if (!(await port.getPermissions()).weightRead) return result;
      const samples = await port.readWeightSamples(sinceIsoDate);
      const existing = await weights.listWeighIns();
      const seenIds = new Set(existing.flatMap(item => item.external_source_id === null ? [] : [item.external_source_id]));
      for (const sample of samples) {
        if (sample.sourceAppId === APP_HEALTH_SOURCE_ID) {
          result.skippedOwnWrites++;
          continue;
        }
        if (seenIds.has(sample.externalId)) {
          result.skippedDuplicates++;
          continue;
        }
        // Malformed native samples must not create invalid local weigh-ins.
        const parsed = weighInSchema.safeParse({
          id: generateId(), date: sample.date, measured_at: sample.measuredAt,
          weight_kg: sample.weightKg, source: platform, external_source_id: sample.externalId,
        });
        if (!parsed.success) continue;
        await weights.recordWeighIn(parsed.data);
        seenIds.add(sample.externalId);
        result.imported++;
      }
      return result;
    } catch (error) {
      return { ...result, error: errorMessage(error) };
    }
  }
}
