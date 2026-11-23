import { describe, expect, it } from 'vitest';
import { calculateBatchServing, generateId, nutrientKeys } from '../../domain';
import type { Recipe } from '../../domain';
import { exportBundleV1, restoreBundleV1 } from '../exportImport';
import { migrateDatabase } from '../migrations';
import { DiaryRepo } from '../repos/diaryRepo';
import { GoalsRepo } from '../repos/goalsRepo';
import { LibraryRepo } from '../repos/libraryRepo';
import { PacksRepo } from '../repos/packsRepo';
import { at, entry, food, meta, resources } from './fixtures';

const scope = resources();

describe('real user SQLite migrations and transaction isolation', () => {
  it('migrates only once, enables foreign keys and enforces checks', async () => {
    const db = await scope.user();
    const diary = new DiaryRepo(db);
    const snapshot = await diary.confirmEntry(entry());
    await migrateDatabase(db);
    expect(await diary.getEntry(snapshot.id)).toEqual(snapshot);
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 1 });
    expect(await db.getFirstAsync('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    await expect(db.runAsync('INSERT INTO diary_days VALUES(?,?,?)', '2026-01-01', 'invalid', at)).rejects.toThrow();
    await expect(db.runAsync('INSERT INTO user_food_units VALUES(?,?,?,?)', 'rice', 'cup', null, null)).rejects.toThrow();
  });
  it('rejects future migrations without changing their version', async () => {
    const db = scope.open();
    await db.execAsync('PRAGMA user_version=2');
    await expect(migrateDatabase(db)).rejects.toThrow('Unsupported');
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 2 });
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
});
