import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateBatchServing, generateId, nutrientKeys } from '../../domain';
import type { HealthSyncRecord, OfflinePhotoDraft, Recipe, WaterLog } from '../../domain';
import { exportBundleV1, restoreBundleV1 } from '../exportImport';
import { migrateDatabase } from '../migrations';
import { DiaryRepo } from '../repos/diaryRepo';
import { GoalsRepo } from '../repos/goalsRepo';
import { LibraryRepo } from '../repos/libraryRepo';
import { PacksRepo } from '../repos/packsRepo';
import { WaterRepo } from '../repos/waterRepo';
import { HealthSyncRepo } from '../repos/healthSyncRepo';
import { PhotoDraftRepo } from '../repos/photoDraftRepo';
import { at, entry, food, meta, resources } from './fixtures';

const scope = resources();
const water = (overrides: Partial<WaterLog> = {}): WaterLog => ({
  id: generateId(), date: '2026-11-23', occurred_at: at, amount_ml: 250, ...overrides,
});
const healthRecord = (overrides: Partial<HealthSyncRecord> = {}): HealthSyncRecord => ({
  entry_id: generateId(), platform: 'apple_health', external_record_id: 'external:1', synced_at: at, status: 'synced', ...overrides,
});
const photoDraft = (overrides: Partial<OfflinePhotoDraft> = {}): OfflinePhotoDraft => ({
  id: generateId(), date: '2026-11-23', meal: 'Lunch', note: 'Review later',
  image_data_url: 'data:image/jpeg;base64,aGVsbG8=', created_at: at, ...overrides,
});

describe('real user SQLite migrations and transaction isolation', () => {
  it('migrates only once, enables foreign keys and enforces checks', async () => {
    const db = await scope.user();
    const diary = new DiaryRepo(db);
    const snapshot = await diary.confirmEntry(entry());
    await migrateDatabase(db);
    expect(await diary.getEntry(snapshot.id)).toEqual(snapshot);
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 2 });
    expect(await db.getFirstAsync('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    await expect(db.runAsync('INSERT INTO diary_days VALUES(?,?,?)', '2026-01-01', 'invalid', at)).rejects.toThrow();
    await expect(db.runAsync('INSERT INTO user_food_units VALUES(?,?,?,?)', 'rice', 'cup', null, null)).rejects.toThrow();
  });
  it('rejects future migrations without changing their version', async () => {
    const db = scope.open();
    await db.execAsync('PRAGMA user_version=3');
    await expect(migrateDatabase(db)).rejects.toThrow('Unsupported');
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 3 });
  });
  it('upgrades a persisted v1 database to v2 while preserving historical data', async () => {
    const path = join(await scope.directory(), 'user.db');
    const v1 = scope.open(path);
    // Run only the frozen first migration to build a real pre-upgrade user.db.
    const firstMigration = readFileSync('src/storage/migrations.ts', 'utf8').match(/String\.raw`([^`]+)`/)![1]!;
    await v1.execAsync(firstMigration);
    await v1.execAsync('PRAGMA user_version=1');
    const snapshot = await new DiaryRepo(v1).confirmEntry(entry());
    await new LibraryRepo(v1).upsertCustomFood(food({ id: 'v1-custom' }));
    await v1.runAsync('INSERT INTO preferences VALUES(?,?,?)', 'theme', '"dark"', at);
    expect(await v1.getFirstAsync("SELECT name FROM sqlite_master WHERE name='water_logs'")).toBeNull();
    await v1.closeAsync();

    const upgraded = scope.open(path);
    await migrateDatabase(upgraded);
    await migrateDatabase(upgraded);
    expect(await upgraded.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 2 });
    expect(await new DiaryRepo(upgraded).getEntry(snapshot.id)).toEqual(snapshot);
    expect(await new LibraryRepo(upgraded).getCustomFood('v1-custom')).toEqual(food({ id: 'v1-custom' }));
    expect(await upgraded.getFirstAsync('SELECT value_json FROM preferences WHERE key=?', 'theme')).toEqual({ value_json: '"dark"' });
    const log = water();
    await new WaterRepo(upgraded).addWaterLog(log);
    expect(await new WaterRepo(upgraded).listWaterLogs()).toEqual([log]);
    expect(await new HealthSyncRepo(upgraded).listRecords()).toEqual([]);
    expect(await new PhotoDraftRepo(upgraded).listDrafts()).toEqual([]);
    expect(await upgraded.getAllAsync("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('water_logs_date','offline_photo_drafts_created') ORDER BY name"))
      .toEqual([{ name: 'offline_photo_drafts_created' }, { name: 'water_logs_date' }]);
  });
  it('rolls back nested work and queues external writes outside a failed transaction', async () => {
    const db = await scope.user();
    const failed = db.withTransactionAsync(async (tx) => {
      await new DiaryRepo(tx).confirmEntry(entry());
      throw new Error('rollback');
    });
    const outside = new DiaryRepo(db).confirmEntry(entry({ meal: 'Dinner' }));
    await expect(failed).rejects.toThrow('rollback');
    const persisted = await outside;
    expect((await new DiaryRepo(db).getDiaryDay(persisted.date))?.entries).toEqual([persisted]);
    expect((await new LibraryRepo(db).listLearnedPortions('usda:rice'))[0]?.use_count).toBe(1);
  });
});

describe('diary commits, Undo and immutable snapshots', () => {
  it('confirms concurrent retries only once, preserves the original confirmed snapshot and learns once', async () => {
    const db = await scope.user();
    const diary = new DiaryRepo(db);
    const draft = entry({ draft_state: 'draft' });
    await diary.upsertDraft(draft);
    expect((await diary.getDiaryDay(draft.date))?.completeness).toBe('none');
    const results = await Promise.all([diary.confirmEntry(draft.id), diary.confirmEntry({ ...draft, id: generateId() }), diary.confirmEntry(draft)]);
    expect(results.every((result) => result.id === draft.id)).toBe(true);
    expect((await diary.getDiaryDay(draft.date))?.entries).toEqual([results[0]]);
    expect((await diary.getDiaryDay(draft.date))?.completeness).toBe('partial');
    expect((await new LibraryRepo(db).listLearnedPortions('usda:rice'))[0]?.use_count).toBe(1);
    expect(await diary.upsertDraft({ ...draft, meal: 'Edited draft retry' })).toEqual(results[0]);
    expect(await diary.confirmEntry({ ...draft, meal: 'Edited confirm retry' })).toEqual(results[0]);
  });
  it('does not downgrade a complete day when adding an entry', async () => {
    const db = await scope.user();
    const diary = new DiaryRepo(db);
    await diary.setDayCompleteness('2026-11-23', 'complete');
    await diary.confirmEntry(entry());
    expect((await diary.getDiaryDay('2026-11-23'))?.completeness).toBe('complete');
  });
  it('deletes with a full Undo payload and restores without learning twice', async () => {
    const db = await scope.user();
    const diary = new DiaryRepo(db);
    const snapshot = await diary.confirmEntry(entry({ unknown_nutrient_counts: Object.fromEntries(nutrientKeys.map((key) => [key, key === 'fiber_g' ? 2 : 0])) as NonNullable<ReturnType<typeof entry>['unknown_nutrient_counts']> }));
    expect(await diary.deleteEntry(snapshot.id)).toEqual(snapshot);
    expect(await diary.getEntry(snapshot.id)).toBeNull();
    expect(await diary.restoreEntry(snapshot)).toEqual(snapshot);
    expect(await diary.restoreEntry(snapshot)).toEqual(snapshot);
    expect((await new LibraryRepo(db).listLearnedPortions('usda:rice'))[0]?.use_count).toBe(1);
    expect(await diary.deleteEntry(generateId())).toBeNull();
  });
  it('updates and moves indexed fields together with the JSON snapshot', async () => {
    const diary = new DiaryRepo(await scope.user());
    const snapshot = await diary.confirmEntry(entry());
    await diary.updateEntry({ ...snapshot, meal: 'Snack', quantity: { amount: 50, unit: 'g' } });
    const moved = await diary.moveEntry(snapshot.id, '2026-11-24', 'Breakfast');
    expect(moved).toMatchObject({ date: '2026-11-24', meal: 'Breakfast', quantity: { amount: 50 } });
    expect((await diary.getDiaryDay(snapshot.date))?.entries).toEqual([]);
    expect((await diary.listDiaryDays('2026-11-24', '2026-11-24'))[0]?.entries).toEqual([moved]);
    await expect(diary.moveEntry(snapshot.id, 'not-a-date')).rejects.toThrow();
  });
  it('rejects malformed snapshots before writing', async () => {
    const diary = new DiaryRepo(await scope.user());
    await expect(diary.confirmEntry(entry({ nutrients: { ...food().nutrients, kcal: -1 } }))).rejects.toThrow();
    expect(await diary.listDiaryDays()).toEqual([]);
  });
});

describe('library, recipes, goals and installed packs', () => {
  it('keeps old cooked batches and diary snapshots isolated from recipe edits', async () => {
    const db = await scope.user();
    const library = new LibraryRepo(db);
    const original: Recipe = { id: generateId(), name: 'Dal', version: 1, ingredients: [{ food: food(), quantity: { amount: 200, unit: 'g' } }], cooked_weight_g: 400, servings_count: 2, notes: null };
    await library.upsertRecipe(original);
    const batch = { id: generateId(), recipe_id: original.id, recipe_version: 1, created_at: at, ingredients: original.ingredients, cooked_weight_g: 400, servings_count: 2, notes: null };
    await library.upsertRecipeBatch(batch);
    const snapshot = await new DiaryRepo(db).confirmEntry(entry());
    const before = calculateBatchServing(batch, 100);
    const edited = await library.upsertRecipe({ ...original, version: 99, cooked_weight_g: 500, ingredients: [{ food: food({ name: 'Changed' }), quantity: { amount: 500, unit: 'g' } }] });
    expect(edited.version).toBe(2);
    expect(await library.getRecipeBatch(batch.id)).toEqual(batch);
    expect(calculateBatchServing((await library.getRecipeBatch(batch.id))!, 100)).toEqual(before);
    expect(await new DiaryRepo(db).getEntry(snapshot.id)).toEqual(snapshot);
    await library.deleteRecipe(original.id);
    expect(await library.listRecipes()).toEqual([]);
    expect(await library.listRecipeBatches(original.id)).toEqual([batch]);
  });
  it('deduplicates concurrent Health imports using external source id', async () => {
    const goals = new GoalsRepo(await scope.user());
    const item = { id: generateId(), measured_at: at, date: '2026-11-23', weight_kg: 70, source: 'health' as const, external_source_id: 'health:123' };
    const results = await Promise.all([goals.recordWeighIn(item), goals.recordWeighIn({ ...item, id: generateId(), weight_kg: 90 })]);
    expect(results[1]).toEqual(results[0]);
    expect(await goals.listWeighIns()).toEqual([item]);
    await goals.recordWeighIn({ ...item, id: generateId(), source: 'manual', external_source_id: null });
    expect(await goals.listWeighIns('2026-11-23', '2026-11-23')).toHaveLength(2);
    expect(await goals.listWeighIns('2026-11-24')).toEqual([]);
  });
  it('stores custom foods, barcode overrides, units, saved meals and learned frequency', async () => {
    const library = new LibraryRepo(await scope.user());
    const custom = food({ id: generateId(), source_pack_id: null, provenance_kind: 'user' });
    await library.upsertCustomFood(custom, { rawCode: '036000291452' });
    await library.upsertCustomFood({ ...custom, name: 'Changed rice' });
    const { normalizeBarcode } = await import('../../domain');
    expect((await library.findCustomFoodByBarcode(normalizeBarcode('036000291452')))?.name).toBe('Changed rice');
    await library.upsertCustomFood(custom, null);
    expect(await library.findCustomFoodByBarcode(normalizeBarcode('036000291452'))).toBeNull();
    await library.upsertUserFoodUnit(custom.id, { label: 'bowl', grams: 150, ml: null });
    await library.upsertUserFoodUnit(custom.id, { label: 'bowl', grams: 180, ml: null });
    expect(await library.listUserFoodUnits(custom.id)).toEqual([{ label: 'bowl', grams: 180, ml: null }]);
    await library.deleteUserFoodUnit(custom.id, 'bowl');
    expect(await library.listUserFoodUnits(custom.id)).toEqual([]);
    const meal = { id: generateId(), name: 'Rice meal', items: [{ food: custom, quantity: { amount: 100, unit: 'g' } }], pinned: true, use_count: 0, last_used_at: null };
    await library.upsertSavedMeal(meal);
    expect(await library.listSavedMeals()).toEqual([meal]);
    expect(await library.getSavedMeal(meal.id)).toEqual(meal);
    await library.deleteSavedMeal(meal.id);
    await library.recordLearnedPortion(custom.id, { amount: 100, unit: 'g' }, '2026-11-21T00:00:00Z');
    await library.recordLearnedPortion(custom.id, { amount: 150, unit: 'g' }, '2026-11-22T00:00:00Z');
    await library.recordLearnedPortion(custom.id, { amount: 100, unit: 'g' }, '2026-11-21T00:00:00Z');
    expect((await library.listLearnedPortions(custom.id)).map((portion) => portion.amount)).toEqual([100, 150]);
    await library.deleteLearnedPortion(custom.id, { amount: 100, unit: 'g' });
    expect((await library.listLearnedPortions(custom.id))[0]?.amount).toBe(150);
    await library.deleteCustomFood(custom.id);
    expect(await library.listCustomFoods()).toEqual([]);
  });
  it('registers, enables, reprioritizes and removes installed packs', async () => {
    const packs = new PacksRepo(await scope.user());
    await packs.registerPack(meta(), '/packs/usda.octpack.sqlite');
    await packs.registerPack(meta('home'), '/packs/home.octpack.sqlite', { priority: 10 });
    await packs.setPackEnabled('usda', false);
    await packs.setPackPriority('usda', 5);
    expect((await packs.listInstalledPacks())[0]).toMatchObject({ pack_id: 'usda', enabled: false, priority: 5, meta: meta() });
    await packs.removePack('usda');
    expect(await packs.listInstalledPacks()).toHaveLength(1);
  });
});

describe('water, health sync and offline photo repositories', () => {
  it('adds, lists, totals and deletes water logs with an Undo payload', async () => {
    const repo = new WaterRepo(await scope.user());
    const first = water({ occurred_at: '2026-11-23T07:00:00Z', amount_ml: 125.5 });
    const second = water({ occurred_at: '2026-11-23T08:00:00Z' });
    const nextDay = water({ date: '2026-11-24', occurred_at: '2026-11-24T07:00:00Z' });
    expect(await repo.getDailyWaterMl(first.date)).toBe(0);
    expect(await repo.addWaterLog(second)).toEqual(second);
    await repo.addWaterLog(nextDay);
    await repo.addWaterLog(first);
    expect(await repo.listWaterLogs()).toEqual([first, second, nextDay]);
    expect(await repo.listWaterLogs(first.date)).toEqual([first, second]);
    expect(await repo.listWaterLogs('2026-11-25')).toEqual([]);
    expect(await repo.getDailyWaterMl(first.date)).toBe(375.5);
    expect(await repo.deleteWaterLog(first.id)).toEqual(first);
    expect(await repo.getDailyWaterMl(first.date)).toBe(250);
    expect(await repo.deleteWaterLog(first.id)).toBeNull();
    await repo.addWaterLog(first);
    expect(await repo.getDailyWaterMl(first.date)).toBe(375.5);
  });

  it('rejects invalid water values and dates without writing', async () => {
    const db = await scope.user();
    const repo = new WaterRepo(db);
    for (const amount_ml of [0, -1, NaN, Infinity]) await expect(repo.addWaterLog(water({ amount_ml }))).rejects.toThrow();
    await expect(repo.addWaterLog(water({ occurred_at: 'invalid' }))).rejects.toThrow();
    await expect(repo.listWaterLogs('invalid')).rejects.toThrow();
    await expect(repo.getDailyWaterMl('invalid')).rejects.toThrow();
    await expect(db.runAsync('INSERT INTO water_logs VALUES(?,?,?,?)', generateId(), '2026-11-23', at, 0)).rejects.toThrow();
    expect(await repo.listWaterLogs()).toEqual([]);
  });

  it('upserts, filters and deletes health sync records independently of diary rows', async () => {
    const repo = new HealthSyncRepo(await scope.user());
    const apple = healthRecord();
    const connect = healthRecord({ platform: 'health_connect', external_record_id: 'connect:1' });
    expect(await repo.getRecord(apple.entry_id)).toBeNull();
    await repo.upsertRecord(apple);
    await repo.upsertRecord(connect);
    expect(await repo.getRecord(apple.entry_id)).toEqual(apple);
    expect(await repo.listRecords()).toHaveLength(2);
    expect(await repo.listRecords('apple_health')).toEqual([apple]);
    expect(await repo.listRecords('health_connect')).toEqual([connect]);
    const deleted: HealthSyncRecord = { ...apple, external_record_id: 'apple:updated', synced_at: '2026-11-24T00:00:00Z', status: 'deleted' };
    await repo.upsertRecord(deleted);
    expect(await repo.getRecord(apple.entry_id)).toEqual(deleted);
    expect(await repo.listRecords()).toHaveLength(2);
    await repo.deleteRecord(apple.entry_id);
    await repo.deleteRecord(apple.entry_id);
    expect(await repo.getRecord(apple.entry_id)).toBeNull();
    await expect(repo.upsertRecord(healthRecord({ external_record_id: '' }))).rejects.toThrow();
    expect(await repo.listRecords()).toEqual([connect]);
  });

  it('saves, updates, orders and deletes offline photo drafts with their full image payload', async () => {
    const repo = new PhotoDraftRepo(await scope.user());
    const first = photoDraft();
    const latest = photoDraft({ created_at: '2026-11-24T00:00:00Z' });
    expect(await repo.getDraft(first.id)).toBeNull();
    expect(await repo.saveDraft(first)).toEqual(first);
    await repo.saveDraft(latest);
    const edited = { ...first, meal: ' Dinner ', note: 'Edited', image_data_url: 'data:image/png;base64,dXBkYXRlZA==' };
    expect(await repo.saveDraft(edited)).toEqual({ ...edited, meal: 'Dinner' });
    const normalized = { ...edited, meal: 'Dinner' };
    expect(await repo.getDraft(first.id)).toEqual(normalized);
    expect(await repo.listDrafts()).toEqual([latest, normalized]);
    expect(await repo.deleteDraft(first.id)).toEqual(normalized);
    expect(await repo.deleteDraft(first.id)).toBeNull();
    expect(await repo.getDraft(first.id)).toBeNull();
    await expect(repo.saveDraft(photoDraft({ image_data_url: '' }))).rejects.toThrow();
    await expect(repo.saveDraft(photoDraft({ meal: ' ' }))).rejects.toThrow();
    const missingNote = photoDraft();
    Reflect.deleteProperty(missingNote, 'note');
    expect((await repo.saveDraft(missingNote)).note).toBe('');
  });
});

describe('validated atomic export/restore', () => {
  it('round-trips every V1 collection and recipe version exactly', async () => {
    const db = await scope.user();
    const library = new LibraryRepo(db);
    const recipe: Recipe = { id: generateId(), name: 'Rice', version: 7, ingredients: [{ food: food(), quantity: { amount: 200, unit: 'g' } }], cooked_weight_g: 300, servings_count: 2, notes: 'Frozen' };
    await library.upsertRecipe(recipe);
    await library.upsertRecipeBatch({ id: generateId(), recipe_id: recipe.id, recipe_version: 6, created_at: at, ingredients: recipe.ingredients, cooked_weight_g: 320, servings_count: 2, notes: null });
    await library.upsertCustomFood(food({ id: 'custom', source_pack_id: null, provenance_kind: 'user' }));
    await new DiaryRepo(db).confirmEntry(entry());
    await new GoalsRepo(db).upsertGoalPeriod({ id: generateId(), effective_from_date: '2026-11-01', mode: 'maintain', target_kcal: 2000, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null });
    await new GoalsRepo(db).recordWeighIn({ id: generateId(), measured_at: at, date: '2026-11-23', weight_kg: 70, source: 'health', external_source_id: 'health:1' });
    await new PacksRepo(db).registerPack(meta(), '/private/path');
    await new WaterRepo(db).addWaterLog(water());
    const bundle = await exportBundleV1(db, at);
    const fresh = await scope.user();
    await restoreBundleV1(fresh, JSON.parse(JSON.stringify(bundle)), { mode: 'replace' });
    expect(await exportBundleV1(fresh, at)).toEqual(bundle);
    expect((await new PacksRepo(fresh).listInstalledPacks())[0]).toMatchObject({ enabled: false, file_path: '' });
    await restoreBundleV1(fresh, bundle, { mode: 'merge' });
    expect(await exportBundleV1(fresh, at)).toEqual(bundle);
  });
  it('rejects malformed bundles before replace deletes anything', async () => {
    const db = await scope.user();
    const diary = new DiaryRepo(db);
    const snapshot = await diary.confirmEntry(entry());
    const bundle = await exportBundleV1(db, at);
    await expect(restoreBundleV1(db, { ...bundle, schema_version: 2 }, { mode: 'replace' })).rejects.toThrow();
    expect(await diary.getEntry(snapshot.id)).toEqual(snapshot);
  });
  it('rolls back all deletes and inserts when SQLite fails midway through restore', async () => {
    const db = await scope.user();
    await new DiaryRepo(db).confirmEntry(entry());
    const before = await exportBundleV1(db, at);
    const incoming = { ...before, custom_foods: [food({ id: 'reject-me' })] };
    await db.execAsync("CREATE TRIGGER reject_custom BEFORE INSERT ON custom_foods WHEN new.id='reject-me' BEGIN SELECT RAISE(ABORT,'forced failure'); END;");
    await expect(restoreBundleV1(db, incoming, { mode: 'replace' })).rejects.toThrow('forced failure');
    expect(await exportBundleV1(db, at)).toEqual(before);
  });
  it('deduplicates merge on id and idempotency key, retaining local snapshots', async () => {
    const db = await scope.user();
    const diary = new DiaryRepo(db);
    const original = await diary.confirmEntry(entry());
    const bundle = await exportBundleV1(db, at);
    const incoming = { ...bundle, diary_days: [{ ...bundle.diary_days[0]!, entries: [{ ...original, id: generateId(), meal: 'Retry' }, { ...original, idempotency_key: generateId(), meal: 'Same id' }] }] };
    await restoreBundleV1(db, incoming, { mode: 'merge' });
    expect((await diary.getDiaryDay(original.date))?.entries).toEqual([original]);
  });
  it('restores old v1 JSON without water_logs and clears device-local records on replace', async () => {
    const db = await scope.user();
    const snapshot = await new DiaryRepo(db).confirmEntry(entry());
    const bundle = await exportBundleV1(db, at);
    const legacy: Record<string, unknown> = { ...bundle };
    delete legacy.water_logs;
    await new WaterRepo(db).addWaterLog(water());
    await new HealthSyncRepo(db).upsertRecord(healthRecord({ entry_id: snapshot.id }));
    await new PhotoDraftRepo(db).saveDraft(photoDraft());
    await restoreBundleV1(db, JSON.parse(JSON.stringify(legacy)), { mode: 'replace' });
    expect(await new DiaryRepo(db).getEntry(snapshot.id)).toEqual(snapshot);
    expect(await new WaterRepo(db).listWaterLogs()).toEqual([]);
    expect(await new HealthSyncRepo(db).listRecords()).toEqual([]);
    expect(await new PhotoDraftRepo(db).listDrafts()).toEqual([]);
    expect(await exportBundleV1(db, at)).toEqual(bundle);
  });

  it('includes water in v1 backups, excludes device-local data, and merges water idempotently', async () => {
    const db = await scope.user();
    const local = water();
    const sync = healthRecord();
    const draft = photoDraft();
    await new WaterRepo(db).addWaterLog(local);
    await new HealthSyncRepo(db).upsertRecord(sync);
    await new PhotoDraftRepo(db).saveDraft(draft);
    const bundle = await exportBundleV1(db, at);
    expect(bundle.water_logs).toEqual([local]);
    expect(bundle).not.toHaveProperty('health_sync_records');
    expect(bundle).not.toHaveProperty('offline_photo_drafts');
    expect(JSON.stringify(bundle)).not.toContain(draft.image_data_url);
    const extra = water({ occurred_at: '2026-11-23T16:00:00Z', amount_ml: 500 });
    const incoming = { ...bundle, water_logs: [{ ...local, amount_ml: 999 }, extra] };
    await restoreBundleV1(db, JSON.parse(JSON.stringify(incoming)), { mode: 'merge' });
    await restoreBundleV1(db, incoming, { mode: 'merge' });
    expect(await new WaterRepo(db).listWaterLogs()).toEqual([local, extra]);
    expect(await new WaterRepo(db).getDailyWaterMl(local.date)).toBe(750);
    expect(await new HealthSyncRepo(db).listRecords()).toEqual([sync]);
    expect(await new PhotoDraftRepo(db).listDrafts()).toEqual([draft]);
    await restoreBundleV1(db, bundle, { mode: 'replace' });
    expect(await exportBundleV1(db, at)).toEqual(bundle);
    expect(await new HealthSyncRepo(db).listRecords()).toEqual([]);
    expect(await new PhotoDraftRepo(db).listDrafts()).toEqual([]);
  });

  it('validates water before replacing data and rolls back clearing all v2 tables on SQL failure', async () => {
    const db = await scope.user();
    const log = water();
    const sync = healthRecord();
    const draft = photoDraft();
    await new WaterRepo(db).addWaterLog(log);
    await new HealthSyncRepo(db).upsertRecord(sync);
    await new PhotoDraftRepo(db).saveDraft(draft);
    const before = await exportBundleV1(db, at);
    await expect(restoreBundleV1(db, { ...before, water_logs: [{ ...log, amount_ml: 0 }] }, { mode: 'replace' })).rejects.toThrow();
    expect(await new WaterRepo(db).listWaterLogs()).toEqual([log]);
    await db.execAsync("CREATE TRIGGER reject_water BEFORE INSERT ON water_logs BEGIN SELECT RAISE(ABORT,'forced water failure'); END;");
    await expect(restoreBundleV1(db, before, { mode: 'replace' })).rejects.toThrow('forced water failure');
    expect(await exportBundleV1(db, at)).toEqual(before);
    expect(await new HealthSyncRepo(db).listRecords()).toEqual([sync]);
    expect(await new PhotoDraftRepo(db).listDrafts()).toEqual([draft]);
  });
});
