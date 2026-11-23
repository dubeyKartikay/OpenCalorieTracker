import { describe, expect, it, vi } from 'vitest';
import { entry, nutrients, weighIn } from '../../domain/__tests__/fixtures';
import type { WeighIn } from '../../domain/types';
import {
  APP_HEALTH_SOURCE_ID, createUnavailableHealthPort, getDefaultHealthCapability,
  HealthSyncEngine, HealthUnavailableError,
} from '..';
import type {
  ExternalWeightSample, HealthCapability, HealthPlatformKind, HealthPlatformPort,
  HealthSyncRecord, HealthSyncRecordPort, HealthWeightStorePort,
} from '../types';

function harness(platform: HealthPlatformKind = 'apple_health') {
  const capability: HealthCapability = { platform, available: true, label: 'Test Health', description: 'Linked test adapter' };
  const permissions = { nutritionWrite: true, weightRead: true };
  const enabled = { nutrition: true, weight: true };
  const samples: ExternalWeightSample[] = [];
  const mappings = new Map<string, HealthSyncRecord>();
  const weighIns: WeighIn[] = [];
  const port = {
    getCapability: vi.fn<HealthPlatformPort['getCapability']>(() => ({ ...capability })),
    getPermissions: vi.fn<HealthPlatformPort['getPermissions']>(async () => ({ ...permissions })),
    requestPermissions: vi.fn<HealthPlatformPort['requestPermissions']>(async () => ({ ...permissions })),
    writeNutrition: vi.fn<HealthPlatformPort['writeNutrition']>(async () => ({ externalRecordId: 'external-nutrition-1' })),
    deleteNutrition: vi.fn<HealthPlatformPort['deleteNutrition']>(async () => {}),
    readWeightSamples: vi.fn<HealthPlatformPort['readWeightSamples']>(async () => samples),
  };
  const records = {
    getRecord: vi.fn<HealthSyncRecordPort['getRecord']>(async id => mappings.get(id) ?? null),
    upsertRecord: vi.fn<HealthSyncRecordPort['upsertRecord']>(async record => { mappings.set(record.entry_id, record); }),
    deleteRecord: vi.fn<HealthSyncRecordPort['deleteRecord']>(async id => { mappings.delete(id); }),
  };
  const weights = {
    listWeighIns: vi.fn<HealthWeightStorePort['listWeighIns']>(async () => [...weighIns]),
    recordWeighIn: vi.fn<HealthWeightStorePort['recordWeighIn']>(async value => { weighIns.push(value); return value; }),
  };
  const engine = new HealthSyncEngine({
    port, records, weights,
    isNutritionWriteEnabled: () => enabled.nutrition,
    isWeightReadEnabled: () => enabled.weight,
  });
  return { engine, port, records, weights, mappings, weighIns, samples, capability, permissions, enabled };
}

function sample(overrides: Partial<ExternalWeightSample> = {}): ExternalWeightSample {
  return { externalId: 'weight-1', date: '2026-11-23', measuredAt: '2026-11-23T07:00:00+05:30', weightKg: 72.4, sourceAppId: 'another.app', ...overrides };
}

describe('Health nutrition synchronization', () => {
  it.each(['apple_health', 'health_connect'] as const)('writes confirmed snapshot nutrients to %s and omits every unknown optional field', async platform => {
    const h = harness(platform);
    const snapshot = entry();
    expect(await h.engine.syncEntryConfirmed(snapshot)).toEqual({ synced: true });
    expect(h.port.writeNutrition).toHaveBeenCalledExactlyOnceWith({
      entryId: snapshot.id, occurredAt: snapshot.occurred_at, meal: snapshot.meal,
      foodName: snapshot.food.name, kcal: 200, proteinG: 10, carbsG: 20, fatG: 8,
      sourceAppId: APP_HEALTH_SOURCE_ID,
    }, undefined);
    const payload = h.port.writeNutrition.mock.calls[0]?.[0];
    for (const field of ['fiberG', 'sugarG', 'satFatG', 'sodiumMg', 'calciumMg', 'ironMg', 'potassiumMg']) {
      expect(payload).not.toHaveProperty(field);
    }
    expect(h.mappings.get(snapshot.id)).toEqual({
      entry_id: snapshot.id, platform, external_record_id: 'external-nutrition-1',
      synced_at: expect.any(String), status: 'synced',
    });
    expect(Number.isFinite(Date.parse(h.mappings.get(snapshot.id)?.synced_at ?? ''))).toBe(true);
    expect(h.port.requestPermissions).not.toHaveBeenCalled();
  });

  it('preserves explicit zero and maps all known optional nutrients from the diary snapshot', async () => {
    const h = harness();
    await h.engine.syncEntryConfirmed(entry({ nutrients: nutrients({ fiber_g: 0, sugar_g: 1, sat_fat_g: 2, sodium_mg: 3, calcium_mg: 4, iron_mg: 5, potassium_mg: 6 }) }));
    expect(h.port.writeNutrition.mock.calls[0]?.[0]).toMatchObject({ fiberG: 0, sugarG: 1, satFatG: 2, sodiumMg: 3, calciumMg: 4, ironMg: 5, potassiumMg: 6 });
  });

  it('propagates edits with the original external ID and persists the adapter replacement ID', async () => {
    const h = harness();
    const snapshot = entry();
    await h.engine.syncEntryConfirmed(snapshot);
    h.port.writeNutrition.mockResolvedValueOnce({ externalRecordId: 'replacement-2' });
    expect(await h.engine.syncEntryConfirmed({ ...snapshot, nutrients: nutrients({ kcal: 300 }) })).toEqual({ synced: true });
    expect(h.port.writeNutrition).toHaveBeenLastCalledWith(expect.objectContaining({ kcal: 300 }), 'external-nutrition-1');
    expect(h.mappings.get(snapshot.id)?.external_record_id).toBe('replacement-2');
  });

  it('deletes the exact linked external ID and removes its local mapping', async () => {
    const h = harness();
    const snapshot = entry();
    await h.engine.syncEntryConfirmed(snapshot);
    expect(await h.engine.syncEntryDeleted(snapshot.id)).toEqual({ synced: true });
    expect(h.port.deleteNutrition).toHaveBeenCalledExactlyOnceWith('external-nutrition-1');
    expect(h.mappings.has(snapshot.id)).toBe(false);
    expect(await h.engine.syncEntryDeleted(snapshot.id)).toEqual({ synced: false });
    expect(h.port.deleteNutrition).toHaveBeenCalledTimes(1);
  });

  it.each(['unavailable', 'disabled', 'denied', 'draft'] as const)('does not write when %s', async reason => {
    const h = harness();
    if (reason === 'unavailable') h.capability.available = false;
    if (reason === 'disabled') h.enabled.nutrition = false;
    if (reason === 'denied') h.permissions.nutritionWrite = false;
    expect(await h.engine.syncEntryConfirmed(entry({ draft_state: reason === 'draft' ? 'draft' : 'confirmed' }))).toEqual({ synced: false });
    expect(h.port.writeNutrition).not.toHaveBeenCalled();
    expect(h.port.requestPermissions).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'disabled', 'denied', 'wrong-platform'] as const)('retains the delete mapping when %s', async reason => {
    const h = harness();
    const snapshot = entry();
    await h.engine.syncEntryConfirmed(snapshot);
    if (reason === 'unavailable') h.capability.available = false;
    if (reason === 'disabled') h.enabled.nutrition = false;
    if (reason === 'denied') h.permissions.nutritionWrite = false;
    if (reason === 'wrong-platform') h.capability.platform = 'health_connect';
    expect(await h.engine.syncEntryDeleted(snapshot.id)).toEqual({ synced: false });
    expect(h.port.deleteNutrition).not.toHaveBeenCalled();
    expect(h.mappings.has(snapshot.id)).toBe(true);
  });

  it('does not overwrite a mapping from a different platform', async () => {
    const h = harness();
    const snapshot = entry();
    await h.engine.syncEntryConfirmed(snapshot);
    h.capability.platform = 'health_connect';
    expect(await h.engine.syncEntryConfirmed(snapshot)).toEqual({ synced: false, error: expect.any(String) });
    expect(h.port.writeNutrition).toHaveBeenCalledTimes(1);
    expect(h.mappings.get(snapshot.id)?.platform).toBe('apple_health');
  });

  it.each(['apple_health', 'health_connect'] as const)('contains %s write failures without blocking local diary confirmation', async platform => {
    const h = harness(platform);
    h.port.writeNutrition.mockRejectedValueOnce(new Error('Native write failed'));
    await expect(h.engine.syncEntryConfirmed(entry())).resolves.toEqual({ synced: false, error: 'Native write failed' });
    expect(h.records.upsertRecord).not.toHaveBeenCalled();
  });

  it('retains mappings after a native delete failure so deletion can be retried', async () => {
    const h = harness();
    const snapshot = entry();
    await h.engine.syncEntryConfirmed(snapshot);
    h.port.deleteNutrition.mockRejectedValueOnce(new Error('Native delete failed'));
    await expect(h.engine.syncEntryDeleted(snapshot.id)).resolves.toEqual({ synced: false, error: 'Native delete failed' });
    expect(h.mappings.has(snapshot.id)).toBe(true);
    expect(await h.engine.syncEntryDeleted(snapshot.id)).toEqual({ synced: true });
  });

  it('contains permission, capability and mapping-store failures', async () => {
    const h = harness();
    h.port.getCapability.mockImplementationOnce(() => { throw new Error('Capability failed'); });
    expect(await h.engine.syncEntryConfirmed(entry())).toEqual({ synced: false, error: 'Capability failed' });
    h.port.getPermissions.mockRejectedValueOnce(new Error('Permission failed'));
    expect(await h.engine.syncEntryConfirmed(entry())).toEqual({ synced: false, error: 'Permission failed' });
    h.records.upsertRecord.mockRejectedValueOnce(new Error('Mapping failed'));
    expect(await h.engine.syncEntryConfirmed(entry())).toEqual({ synced: false, error: 'Mapping failed' });
    h.records.getRecord.mockRejectedValueOnce(new Error('Read mapping failed'));
    expect(await h.engine.syncEntryDeleted('entry-1')).toEqual({ synced: false, error: 'Read mapping failed' });
  });
});

describe('Health weight imports', () => {
  it.each(['apple_health', 'health_connect'] as const)('imports %s samples with the platform source and forwards the date filter', async platform => {
    const h = harness(platform);
    h.samples.push(sample());
    expect(await h.engine.importWeightSamples('2026-11-01')).toEqual({ imported: 1, skippedDuplicates: 0, skippedOwnWrites: 0 });
    expect(h.port.readWeightSamples).toHaveBeenCalledExactlyOnceWith('2026-11-01');
    expect(h.weighIns[0]).toMatchObject({ date: '2026-11-23', measured_at: '2026-11-23T07:00:00+05:30', weight_kg: 72.4, source: platform, external_source_id: 'weight-1' });
    expect(h.weighIns[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('prevents echo imports from this app', async () => {
    const h = harness();
    h.samples.push(sample({ sourceAppId: APP_HEALTH_SOURCE_ID }), sample({ externalId: 'other', sourceAppId: null }));
    expect(await h.engine.importWeightSamples()).toEqual({ imported: 1, skippedDuplicates: 0, skippedOwnWrites: 1 });
    expect(h.weighIns.map(item => item.external_source_id)).toEqual(['other']);
  });

  it('deduplicates both repeated samples in one batch and a second import', async () => {
    const h = harness();
    h.samples.push(sample(), sample());
    expect(await h.engine.importWeightSamples()).toEqual({ imported: 1, skippedDuplicates: 1, skippedOwnWrites: 0 });
    expect(await h.engine.importWeightSamples()).toEqual({ imported: 0, skippedDuplicates: 2, skippedOwnWrites: 0 });
    expect(h.weights.recordWeighIn).toHaveBeenCalledTimes(1);
  });

  it('deduplicates against persisted external IDs while keeping manual weigh-ins', async () => {
    const h = harness();
    h.weighIns.push(weighIn('2026-11-23', 70), weighIn('2026-11-23', 72.4, { source: 'health', external_source_id: 'weight-1' }));
    h.samples.push(sample());
    expect(await h.engine.importWeightSamples()).toEqual({ imported: 0, skippedDuplicates: 1, skippedOwnWrites: 0 });
    expect(h.weights.recordWeighIn).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity])('does not persist invalid weight %s', async weightKg => {
    const h = harness();
    h.samples.push(sample({ weightKg }));
    expect((await h.engine.importWeightSamples()).imported).toBe(0);
    expect(h.weights.recordWeighIn).not.toHaveBeenCalled();
  });

  it('skips malformed dates and empty external identifiers', async () => {
    const h = harness();
    h.samples.push(sample({ date: '2026-02-30' }), sample({ measuredAt: 'yesterday' }), sample({ externalId: '' }));
    expect((await h.engine.importWeightSamples()).imported).toBe(0);
    expect(h.weights.recordWeighIn).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'disabled', 'denied'] as const)('does not read weights when %s', async reason => {
    const h = harness();
    if (reason === 'unavailable') h.capability.available = false;
    if (reason === 'disabled') h.enabled.weight = false;
    if (reason === 'denied') h.permissions.weightRead = false;
    expect(await h.engine.importWeightSamples()).toEqual({ imported: 0, skippedDuplicates: 0, skippedOwnWrites: 0 });
    expect(h.port.readWeightSamples).not.toHaveBeenCalled();
    expect(h.port.requestPermissions).not.toHaveBeenCalled();
  });

  it('contains read errors', async () => {
    const h = harness();
    h.port.readWeightSamples.mockRejectedValueOnce(new Error('Health Connect read failed'));
    await expect(h.engine.importWeightSamples()).resolves.toEqual({ imported: 0, skippedDuplicates: 0, skippedOwnWrites: 0, error: 'Health Connect read failed' });
  });

  it('reports partial progress if a store write fails and retries without duplicating saved samples', async () => {
    const h = harness();
    h.samples.push(sample(), sample({ externalId: 'weight-2' }));
    h.weights.recordWeighIn.mockImplementationOnce(async value => { h.weighIns.push(value); return value; });
    h.weights.recordWeighIn.mockRejectedValueOnce(new Error('Local storage failed'));
    expect(await h.engine.importWeightSamples()).toEqual({ imported: 1, skippedDuplicates: 0, skippedOwnWrites: 0, error: 'Local storage failed' });
    expect(await h.engine.importWeightSamples()).toEqual({ imported: 1, skippedDuplicates: 1, skippedOwnWrites: 0 });
    expect(h.weighIns).toHaveLength(2);
  });
});

describe('Unavailable health port', () => {
  it.each([
    ['ios', 'apple_health', 'HealthKit'],
    ['android', 'health_connect', 'native development build'],
    ['web', null, 'web preview'],
    ['windows', null, 'only in iOS and Android'],
  ] as const)('truthfully reports %s availability and denies permissions without crashing', async (os, platform, description) => {
    const port = createUnavailableHealthPort(os);
    expect(port.getCapability()).toEqual(getDefaultHealthCapability(os));
    expect(port.getCapability()).toMatchObject({ available: false, platform });
    expect(port.getCapability().description).toContain(description);
    expect(await port.getPermissions()).toEqual({ nutritionWrite: false, weightRead: false });
    expect(await port.requestPermissions(['nutrition_write', 'weight_read'])).toEqual({ nutritionWrite: false, weightRead: false });
    await expect(port.readWeightSamples()).rejects.toBeInstanceOf(HealthUnavailableError);
    await expect(port.deleteNutrition('external')).rejects.toBeInstanceOf(HealthUnavailableError);
    await expect(port.writeNutrition({ entryId: 'entry', occurredAt: '2026-11-23T07:00:00Z', meal: 'Lunch', foodName: 'Rice', kcal: 200, proteinG: 10, carbsG: 20, fatG: 8, sourceAppId: APP_HEALTH_SOURCE_ID })).rejects.toBeInstanceOf(HealthUnavailableError);
  });

  it('defaults to unavailable web capability and isolates its capability object', () => {
    const port = createUnavailableHealthPort();
    port.getCapability().available = true;
    expect(port.getCapability()).toMatchObject({ platform: null, available: false });
  });

  it('lets all engine methods safely no-op without directly invoking unavailable native operations', async () => {
    const h = harness();
    const engine = new HealthSyncEngine({ port: createUnavailableHealthPort('ios'), records: h.records, weights: h.weights, isNutritionWriteEnabled: () => true, isWeightReadEnabled: () => true });
    expect(await engine.syncEntryConfirmed(entry())).toEqual({ synced: false });
    expect(await engine.syncEntryDeleted('entry')).toEqual({ synced: false });
    expect(await engine.importWeightSamples()).toEqual({ imported: 0, skippedDuplicates: 0, skippedOwnWrites: 0 });
  });
});
